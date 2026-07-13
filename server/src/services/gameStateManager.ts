import { EventEmitter } from "events";
import { Server as SocketIOServer } from "socket.io";
import { db } from "../database/client";
import {
  PlayerSession,
  ServerState,
  GameState,
  PlayerInfo,
  ValidationResult,
  StateDelta,
  NotificationType,
  NotificationPriority,
  MissionStatus,
  TerminalTab,
} from "../types/game";
import { SESSION_TIMEOUT_MS } from "../config/constants";

import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import {
  LOGGER,
  SOCKET_IO,
  EVENT_SERVICE,
  COMMAND_PROCESSOR,
  SHOP_SERVICE,
  MISSION_SERVICE,
  FACTION_SERVICE,
} from "../di/tokens";
import { getService } from "../di/container";
import type EventService from "./eventService";
import type CommandProcessor from "./commandProcessor";
import type ShopService from "./shopService";
import type MissionService from "./missionService";
import type { FactionService } from "./factionService";

@injectable()
class GameStateManager extends EventEmitter {
  private playerSessions: Map<string, PlayerSession>;
  private activeConnections: Map<string, string>; // socketId -> userId
  private serverStates: Map<string, ServerState>;
  private io: SocketIOServer;
  private eventService: EventService;
  private _commandProcessor: CommandProcessor | null = null;
  private shopService: ShopService;
  private missionService: MissionService;
  private factionService: FactionService;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_SESSIONS = 1000;
  private readonly SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
  private readonly SESSION_LOCK_TTL_MS = 30 * 1000; // 30 seconds — locks expire if holder crashes
  private sessionLocks = new Map<string, number>(); // userId -> lock timestamp

  private get commandProcessor(): CommandProcessor {
    if (!this._commandProcessor) {
      this._commandProcessor = getService<CommandProcessor>(COMMAND_PROCESSOR);
    }
    return this._commandProcessor;
  }

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(EVENT_SERVICE) eventService: EventService,
    @inject(SHOP_SERVICE) shopService: ShopService,
    @inject(MISSION_SERVICE) missionService: MissionService,
    @inject(FACTION_SERVICE) factionService: FactionService,
  ) {
    super();
    this.io = io;
    this.eventService = eventService;
    this.shopService = shopService;
    this.missionService = missionService;
    this.factionService = factionService;
    this.playerSessions = new Map();
    this.activeConnections = new Map();
    this.serverStates = new Map();

    // Start automatic cleanup timer
    this.startCleanupTimer();
  }

  // ==================== PUBLIC ACCESSORS ====================

  public getPlayerSession(userId: string): PlayerSession | undefined {
    return this.playerSessions.get(userId);
  }

  public getAllActiveSessions(): PlayerSession[] {
    return Array.from(this.playerSessions.values());
  }

  // ==================== SESSION MANAGEMENT ====================

  public async createSession(
    userId: string,
    socketId: string,
    ipAddress: string,
  ): Promise<PlayerSession> {
    // Per-user lock to prevent concurrent session creation (with TTL)
    const lockTime = this.sessionLocks.get(userId);
    if (lockTime !== undefined) {
      const lockAge = Date.now() - lockTime;
      if (lockAge < this.SESSION_LOCK_TTL_MS) {
        // Lock is still valid — return existing session or reject
        const existing = this.playerSessions.get(userId);
        if (existing) return existing;
        throw new Error(
          `Session creation already in progress for user ${userId}`,
        );
      }
      // Lock expired — stale lock from a crashed operation, proceed
      this.logger.warn(
        { userId, lockAgeMs: lockAge },
        "Expired stale session lock",
      );
    }

    this.sessionLocks.set(userId, Date.now());
    try {
      // Check if session already exists
      const existingSession = this.playerSessions.get(userId);
      if (existingSession) {
        this.logger.info({ userId }, "Session already exists, updating");
        await this.destroySession(userId);
      }

      // Get or create user's home server
      const user = await db.client.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Use player's home server ID from database (already set during registration or migration)
      const homeServerId =
        user.homeServerId || `home_${user.homeIp.replace(/\./g, "_")}`;

      // Try to load last session directory
      const lastSession = await db.client.userSession.findFirst({
        where: {
          userId,
          isActive: false, // Get the last inactive session
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Create default terminal tab (home terminal)
      const defaultTerminal: TerminalTab = {
        id: `term_${Date.now()}_0`,
        label: `${user.username}@${user.homeIp}`,
        serverId: homeServerId,
        currentDirectory: this.getValidHomeDirectory(
          lastSession?.currentDirectory,
          user.username,
        ),
        commandHistory: [],
        createdAt: new Date(),
        lastActivity: new Date(),
        isProcessing: false,
      };

      const session: PlayerSession = {
        userId,
        socketId,
        connectedAt: new Date(),
        lastActivity: new Date(),
        isActive: true,
        ipAddress,
        homeServerId,
        currentDirectory: defaultTerminal.currentDirectory, // For backwards compatibility
        commandQueue: [],
        terminals: [defaultTerminal],
        activeTerminalId: defaultTerminal.id,
      };

      // Initialize home file system if it doesn't exist
      await this.initializeHomeFileSystem(homeServerId, userId);

      this.playerSessions.set(userId, session);
      this.activeConnections.set(socketId, userId);

      // Update database
      await db.client.user.update({
        where: { id: userId },
        data: {
          isOnline: true,
          lastLogin: new Date(),
        },
      });

      // Check if we've exceeded max sessions and cleanup if needed
      if (this.playerSessions.size > this.MAX_SESSIONS) {
        await this.cleanupIdleSessions();
      }

      this.emit("session:created", { userId, session });

      return session;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error creating session");
      throw error;
    } finally {
      this.sessionLocks.delete(userId);
    }
  }

  public async destroySession(userId: string): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) {
        this.logger.info({ userId }, "No session found for user");
        return;
      }

      // Disconnect from any connected servers
      if (session.currentServerId) {
        await this.disconnectPlayerFromServer(userId);
      }

      // Remove from maps
      this.activeConnections.delete(session.socketId);
      this.playerSessions.delete(userId);

      // Clear command history to prevent memory leaks
      this.commandProcessor.clearHistory(userId);

      // Update database
      await db.client.user.update({
        where: { id: userId },
        data: { isOnline: false },
      });

      this.emit("session:destroyed", { userId });
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error destroying session");
      throw error;
    }
  }

  public getSession(userId: string): PlayerSession | undefined {
    return this.playerSessions.get(userId);
  }

  public getUserBySocket(socketId: string): string | undefined {
    return this.activeConnections.get(socketId);
  }

  public updateLastActivity(userId: string): void {
    const session = this.playerSessions.get(userId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  public getActivePlayers(): string[] {
    return Array.from(this.playerSessions.keys());
  }

  public getPlayerCount(): number {
    return this.playerSessions.size;
  }

  public isPlayerOnline(userId: string): boolean {
    return this.playerSessions.has(userId);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Validate and fix home directory path
   * Ensures old /home/user paths are corrected to /home/{username}
   */
  private getValidHomeDirectory(
    lastDirectory: string | null | undefined,
    username: string,
  ): string {
    const correctHomeDir = `/home/${username}`;

    // If no last directory, use correct home
    if (!lastDirectory) {
      return correctHomeDir;
    }

    // If last directory is the old hardcoded /home/user, fix it
    if (lastDirectory === "/home/user") {
      this.logger.info(
        { username, correctHomeDir },
        "Fixing old home directory",
      );
      return correctHomeDir;
    }

    // If directory is already correct or is a subdirectory, keep it
    return lastDirectory;
  }

  // ==================== GAME STATE QUERIES ====================
  // ==================== STATE SYNCHRONIZATION ====================

  public async getGameState(userId: string): Promise<GameState | null> {
    try {
      const user = await db.client.user.findUnique({
        where: { id: userId },
        include: {
          progress: true,
        },
      });

      if (!user || !user.progress) {
        this.logger.info({ userId }, "User or progress not found");
        return null;
      }

      const session = this.playerSessions.get(userId);

      // Build reputation from FactionStanding (dynamic, not hardcoded)
      const reputationMap = await this.factionService.getReputationMap(userId);

      // Build player info
      const playerInfo: PlayerInfo = {
        id: user.id,
        username: user.username,
        ip: user.homeIp,
        level: user.progress.level,
        experience: user.progress.experience,
        credits: user.progress.credits,
        skills: {
          hacking: user.progress.hacking,
          networking: user.progress.networking,
          cryptography: user.progress.cryptography,
          stealth: user.progress.stealth,
          socialEng: user.progress.socialEng,
          forensics: user.progress.forensics,
        },
        reputation: reputationMap,
      };

      // Get current server info if connected
      let currentServer = undefined;
      if (session?.currentServerId) {
        const serverInfo = await this.getServerInfo(session.currentServerId);
        if (serverInfo) {
          currentServer = serverInfo;
        }
      }

      // Build complete game state
      const inventoryItems = await this.shopService.getPlayerInventory(userId);
      const playerMissions =
        await this.missionService.getPlayerMissions(userId);
      const userEvents = await this.eventService.getUserEvents(userId, 10);

      const gameState: GameState = {
        player: playerInfo,
        currentServer,
        inventory: inventoryItems.map((item) => ({
          id: item.itemId,
          name: item.item.name,
          type: item.item.category,
          description: item.item.description,
          quantity: item.quantity,
          metadata: item.item.effects,
        })),
        missions: playerMissions.map((m) => ({
          id: m.missionId,
          title: (m as any).title || "Unknown Mission",
          description: (m as any).description || "Loading...",
          type: (m as any).type || "hack",
          status: m.status as MissionStatus,
          difficulty: (m as any).difficulty || 1,
          objectives: m.objectives.map((o) => ({
            ...o,
            progress: typeof o.current === "number" ? o.current : 0,
            required: typeof o.target === "number" ? o.target : 1,
            target: o.target?.toString(),
          })),
          reward: (m as any).reward || { credits: 0, experience: 0 },
          timeLimit: (m as any).timeLimit,
          ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}),
        })),
        notifications: userEvents.map((e) => ({
          id: e.id,
          type: e.type as unknown as NotificationType,
          title: e.title,
          message: e.description,
          timestamp: e.timestamp,
          read: false,
          priority:
            e.severity === "critical"
              ? NotificationPriority.CRITICAL
              : NotificationPriority.NORMAL,
          data: e.metadata,
        })),
        stats: {
          totalPlayTime: 0,
          commandsExecuted: 0,
          successfulHacks: 0,
          failedHacks: 0,
          missionsCompleted: 0,
          serversDiscovered: 0,
          filesAccessed: 0,
          messagesSent: 0,
        },
      };

      return gameState;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error getting game state");
      return null;
    }
  }

  public async broadcastStateUpdate(userId: string): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) {
        this.logger.info({ userId }, "No session found for user");
        return;
      }

      const state = await this.getGameState(userId);
      if (!state) {
        this.logger.info({ userId }, "Could not get game state for user");
        return;
      }

      this.io.to(`user:${userId}`).emit("state:update", {
        fullState: state,
        timestamp: new Date(),
      });

      this.logger.info({ userId }, "Broadcast full state update to user");
    } catch (error) {
      this.logger.error({ err: error }, "Error broadcasting state update");
    }
  }

  public async broadcastStateDelta(
    userId: string,
    path: string,
    value: any,
  ): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) return;

      const delta: StateDelta = {
        path,
        value,
        operation: "set",
      };

      this.io.to(`user:${userId}`).emit("state:delta", {
        delta,
        timestamp: new Date(),
      });

      this.logger.info({ userId, path }, "Broadcast state delta to user");
    } catch (error) {
      this.logger.error({ err: error }, "Error broadcasting state delta");
    }
  }

  // ==================== SERVER STATE MANAGEMENT ====================

  public async connectPlayerToServer(
    userId: string,
    serverId: string,
  ): Promise<boolean> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) {
        this.logger.info({ userId }, "No session found for user");
        return false;
      }

      // Disconnect from previous server
      if (session.currentServerId) {
        await this.disconnectPlayerFromServer(userId);
      }

      // Verify server exists
      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        this.logger.info({ serverId }, "Server not found");
        return false;
      }

      // Ensure the target server has a file system (lazy init for game servers)
      const hasFileSystem = await db.client.fileSystemNode.findFirst({
        where: { serverId, parentId: null, type: "directory" },
      });
      if (!hasFileSystem) {
        try {
          const { getService } = await import("../di/container");
          const { FILE_SERVICE } = await import("../di/tokens");
          const fileService = getService<any>(FILE_SERVICE);
          await fileService.initializeFileSystem(
            serverId,
            server.ownerId || userId,
          );
          this.logger.info(
            { serverId, serverName: server.name },
            "Initialized file system for game server on first connect",
          );
        } catch (fsErr) {
          this.logger.error(
            { err: fsErr, serverId },
            "Failed to initialize server file system",
          );
        }
      }

      // Provision thematic server content on first connect.
      // Faction servers get AI-generated content via their faction leader persona;
      // unowned servers (e.g. tutorial network) use The Architect / static templates.
      // Idempotent: skips automatically if content already exists (fileCount > 8).
      if (!server.isPlayerHome && server.type !== "player_home") {
        try {
          const { getService } = await import("../di/container");
          const { SERVER_CONTENT_SERVICE } = await import("../di/tokens");
          const contentService = getService<any>(SERVER_CONTENT_SERVICE);
          await contentService.provisionServerContent(serverId);
        } catch (contentErr) {
          // Fire-and-forget: player can still connect even if provisioning fails
          this.logger.warn(
            { err: contentErr, serverId, serverName: server.name },
            "Server content provisioning failed on connect (non-fatal)",
          );
        }
      }

      // Update session
      session.currentServerId = serverId;

      // Reset working directory to root of the new server
      session.currentDirectory = "/";

      // Update the active terminal to point at the new server
      const activeTerminal = session.terminals.find(
        (t) => t.id === session.activeTerminalId,
      );
      if (activeTerminal) {
        activeTerminal.serverId = serverId;
        activeTerminal.currentDirectory = "/";
      }

      // Update or create server state
      let serverState = this.serverStates.get(serverId);
      if (!serverState) {
        serverState = {
          serverId,
          connectedPlayers: [],
          isOnline: true,
          lastUpdate: new Date(),
          activeConnections: 0,
        };
        this.serverStates.set(serverId, serverState);
      }

      serverState.connectedPlayers.push(userId);
      serverState.activeConnections = serverState.connectedPlayers.length;
      serverState.lastUpdate = new Date();

      // Join socket room
      const socket = this.io.sockets.sockets.get(session.socketId);
      if (socket) {
        socket.join(`server:${serverId}`);
      }

      // Broadcast to others on server
      this.io.to(`server:${serverId}`).emit("server:user_connected", {
        userId,
        serverId,
        timestamp: new Date(),
      });

      // Update database connection count
      await db.client.gameServer.update({
        where: { id: serverId },
        data: {
          currentConnections: serverState.activeConnections,
        },
      });

      this.emit("player:connected_to_server", { userId, serverId });
      this.logger.info({ userId, serverId }, "User connected to server");

      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Error connecting player to server");
      return false;
    }
  }

  public async disconnectPlayerFromServer(userId: string): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session || !session.currentServerId) return;

      const serverId = session.currentServerId;

      // Update server state
      const serverState = this.serverStates.get(serverId);
      if (serverState) {
        serverState.connectedPlayers = serverState.connectedPlayers.filter(
          (id) => id !== userId,
        );
        serverState.activeConnections = serverState.connectedPlayers.length;
        serverState.lastUpdate = new Date();

        // Update database
        await db.client.gameServer.update({
          where: { id: serverId },
          data: {
            currentConnections: serverState.activeConnections,
          },
        });
      }

      // Leave socket room
      const socket = this.io.sockets.sockets.get(session.socketId);
      if (socket) {
        socket.leave(`server:${serverId}`);
      }

      // Broadcast to others on server
      this.io.to(`server:${serverId}`).emit("server:user_disconnected", {
        userId,
        serverId,
        timestamp: new Date(),
      });

      delete session.currentServerId;

      // Restore working directory to the home server context
      if (session.homeServerId) {
        const user = await db.client.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });
        const homeDir = user?.username ? `/home/${user.username}` : "/";
        session.currentDirectory = homeDir;

        const activeTerminal = session.terminals.find(
          (t) => t.id === session.activeTerminalId,
        );
        if (activeTerminal) {
          activeTerminal.serverId = session.homeServerId;
          activeTerminal.currentDirectory = homeDir;
        }
      }

      this.emit("player:disconnected_from_server", { userId, serverId });
      this.logger.info({ userId, serverId }, "User disconnected from server");
    } catch (error) {
      this.logger.error(
        { err: error },
        "Error disconnecting player from server",
      );
    }
  }

  public getServerState(serverId: string): ServerState | undefined {
    return this.serverStates.get(serverId);
  }

  public getConnectedPlayersOnServer(serverId: string): string[] {
    const serverState = this.serverStates.get(serverId);
    return serverState ? serverState.connectedPlayers : [];
  }

  // ==================== VALIDATION ====================

  public async validatePlayerAction(
    userId: string,
    _action: string,
    _data?: any,
  ): Promise<ValidationResult> {
    const session = this.playerSessions.get(userId);

    if (!session) {
      return { valid: false, error: "No active session found" };
    }

    if (!session.isActive) {
      return { valid: false, error: "Session is inactive" };
    }

    // Check session timeout
    const now = new Date();
    const inactiveTime = now.getTime() - session.lastActivity.getTime();
    const timeoutMs = SESSION_TIMEOUT_MS;

    if (inactiveTime > timeoutMs) {
      await this.destroySession(userId);
      return { valid: false, error: "Session timed out" };
    }

    // Update activity
    this.updateLastActivity(userId);

    return { valid: true };
  }

  // ==================== UTILITY METHODS ====================

  private async initializeHomeFileSystem(
    homeServerId: string,
    userId: string,
  ): Promise<void> {
    try {
      // Import fileService
      const { getService } = await import("../di/container");
      const { FILE_SERVICE } = await import("../di/tokens");
      const fileService = getService<any>(FILE_SERVICE);

      // Check if home server exists
      let homeServer = await db.client.gameServer.findUnique({
        where: { id: homeServerId },
      });

      if (!homeServer) {
        // Create home server entry
        const user = await db.client.user.findUnique({
          where: { id: userId },
        });

        if (!user) return;

        // Check if a server with this IP already exists (due to unique constraint)
        const existingServerWithIp = await db.client.gameServer.findUnique({
          where: { ipAddress: user.homeIp },
        });

        if (existingServerWithIp) {
          this.logger.info(
            {
              homeIp: user.homeIp,
              existingServerId: existingServerWithIp.id,
              username: user.username,
            },
            "Server with IP already exists, using it",
          );
          homeServer = existingServerWithIp;

          // Update the user's homeServerId to point to the existing server
          await db.client.user.update({
            where: { id: userId },
            data: { homeServerId: existingServerWithIp.id },
          });
        } else {
          homeServer = await db.client.gameServer.create({
            data: {
              id: homeServerId,
              name: `${user.username}'s Home System`,
              ipAddress: user.homeIp,
              type: "player_home",
              ownerId: userId,
              securityLevel: 1,
              firewallLevel: 1,
              encryptionLevel: 1,
              discoveryLevel: 0,
              isPlayerHome: true,
              isOnline: true,
              maxConnections: 1,
              currentConnections: 0,
            },
          });

          this.logger.info(
            { userId, homeServerId },
            "Created home server for user",
          );

          // Store reference in User record
          await db.client.user.update({
            where: { id: userId },
            data: { homeServerId },
          });
        }
      }

      // Initialize file system for home server
      await fileService.initializeFileSystem(homeServer.id, userId);

      // Create user's home directory with some starter files
      await this.createStarterFiles(homeServer.id, userId);
    } catch (error) {
      this.logger.error({ err: error }, "Error initializing home file system");
    }
  }

  private async createStarterFiles(
    homeServerId: string,
    userId: string,
  ): Promise<void> {
    try {
      const { getService } = await import("../di/container");
      const { FILE_SERVICE } = await import("../di/tokens");
      const fileService = getService<any>(FILE_SERVICE);

      // Get user info
      const user = await db.client.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        this.logger.error({ userId }, "User not found");
        return;
      }

      const userHomeDir = `/home/${user.username}`;

      // Try to create user's home directory (will fail gracefully if exists)
      const createDirResult = await fileService.createDirectory(
        homeServerId,
        userId,
        userHomeDir,
      );

      if (createDirResult.success) {
        this.logger.info(
          { username: user.username, userHomeDir },
          "Created home directory for user",
        );
      } else if (createDirResult.error === "DIRECTORY_EXISTS") {
        // Directory already exists, that's fine
        this.logger.info(
          { username: user.username, userHomeDir },
          "Home directory already exists for user",
        );
        return; // Don't recreate starter files
      } else {
        this.logger.error(
          { message: createDirResult.message },
          "Failed to create home directory",
        );
        return;
      }

      // Create welcome.txt
      await fileService.createFile(
        homeServerId,
        userId,
        `${userHomeDir}/welcome.txt`,
        `Welcome to AIDA - AI-Driven Interactive Adventure

You are now connected to your home terminal system.

Basic Commands:
  help           - Show available commands
  ls             - List files and directories
  cd <path>      - Change directory
  pwd            - Print working directory
  cat <file>     - Read file contents
  status         - View your player status
  missions       - View available missions
  scan           - Scan for nearby servers
  connect <ip>   - Connect to a remote server

Type 'help' for a complete list of commands.
Type 'man <command>' for detailed information about a specific command.

Good luck, hacker.
`,
        false,
      );

      // Create readme.txt
      await fileService.createFile(
        homeServerId,
        userId,
        `${userHomeDir}/readme.txt`,
        `AIDA System Information

Your home IP: Check with 'status' command
Current directory: ${userHomeDir}

File System Structure:
  ${userHomeDir}     - Your personal files
  /bin              - System binaries (protected)
  /etc              - Configuration files (protected)
  /var              - Variable data
  /tmp              - Temporary files
  /logs             - System logs

Tips:
- Use 'scan' to discover servers you can hack
- Complete missions to gain experience and credits
- Visit the shop to buy tools and upgrades
- Use 'forum scan' to discover underground forums
`,
        false,
      );

      this.logger.info(
        { username: user.username, userHomeDir },
        "Created starter files for user",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Error creating starter files");
    }
  }

  private async getServerInfo(serverId: string): Promise<any> {
    try {
      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) return null;

      return {
        id: server.id,
        name: server.name,
        ip: server.ipAddress,
        type: server.type,
        accessLevel: 0, // TODO: Calculate based on player's access
        ownerId: server.ownerId,
        encryptionLevel: server.encryptionLevel,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error getting server info");
      return null;
    }
  }

  // ==================== TERMINAL TAB MANAGEMENT ====================

  public createTerminal(userId: string, label?: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      this.logger.error({ userId }, "No session found for user");
      return null;
    }

    const terminalNumber = session.terminals.length + 1;
    const newTerminal: TerminalTab = {
      id: `term_${Date.now()}_${terminalNumber}`,
      label: label || `Terminal ${terminalNumber}`,
      currentDirectory: `/home/${userId}`,
      commandHistory: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    // Set serverId if homeServerId exists
    if (session.homeServerId) {
      newTerminal.serverId = session.homeServerId;
    }

    session.terminals.push(newTerminal);
    this.logger.info(
      { terminalId: newTerminal.id, userId },
      "Created terminal",
    );

    return newTerminal;
  }

  public closeTerminal(userId: string, terminalId: string): boolean {
    const session = this.playerSessions.get(userId);
    if (!session) {
      this.logger.error({ userId }, "No session found for user");
      return false;
    }

    // Don't allow closing the last terminal
    if (session.terminals.length <= 1) {
      this.logger.warn({ userId }, "Cannot close the last terminal");
      return false;
    }

    const terminalIndex = session.terminals.findIndex(
      (t) => t.id === terminalId,
    );
    if (terminalIndex === -1) {
      this.logger.error({ terminalId, userId }, "Terminal not found for user");
      return false;
    }

    // Don't allow closing the home terminal (first terminal, index 0)
    if (terminalIndex === 0) {
      this.logger.warn({ userId }, "Cannot close the home terminal");
      return false;
    }

    session.terminals.splice(terminalIndex, 1);

    // If we closed the active terminal, switch to the first one (home)
    if (session.activeTerminalId === terminalId) {
      session.activeTerminalId = session.terminals[0]!.id;
    }

    this.logger.info({ terminalId, userId }, "Closed terminal");
    return true;
  }

  public switchTerminal(userId: string, terminalId: string): boolean {
    const session = this.playerSessions.get(userId);
    if (!session) {
      this.logger.error({ userId }, "No session found for user");
      return false;
    }

    const terminal = session.terminals.find((t) => t.id === terminalId);
    if (!terminal) {
      this.logger.error({ terminalId, userId }, "Terminal not found for user");
      return false;
    }

    session.activeTerminalId = terminalId;
    terminal.lastActivity = new Date();
    this.logger.info({ terminalId, userId }, "Switched to terminal");

    return true;
  }

  public getActiveTerminal(userId: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      return null;
    }

    return (
      session.terminals.find((t) => t.id === session.activeTerminalId) ||
      session.terminals[0] ||
      null
    );
  }

  public getTerminal(userId: string, terminalId: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      return null;
    }

    return session.terminals.find((t) => t.id === terminalId) || null;
  }

  public updateTerminalProcessing(
    userId: string,
    terminalId: string,
    isProcessing: boolean,
    command?: string,
  ): void {
    const terminal = this.getTerminal(userId, terminalId);
    if (terminal) {
      terminal.isProcessing = isProcessing;
      if (command !== undefined) {
        terminal.processingCommand = command;
      }
      terminal.lastActivity = new Date();
    }
  }

  // ==================== CLEANUP ====================

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(async () => {
      await this.cleanupIdleSessions();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Stop automatic cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up idle sessions that have exceeded timeout
   */
  public async cleanupIdleSessions(): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    // Collect idle userIds first to avoid modifying the Map during iteration
    const idleUserIds: string[] = [];
    for (const [userId, session] of this.playerSessions.entries()) {
      const idleTime = now - session.lastActivity.getTime();
      if (idleTime > this.SESSION_IDLE_TIMEOUT_MS) {
        idleUserIds.push(userId);
      }
    }

    for (const userId of idleUserIds) {
      try {
        await this.destroySession(userId);
        cleanedCount++;
      } catch (error) {
        this.logger.error({ err: error, userId }, "Error cleaning up session");
      }
    }

    if (cleanedCount > 0) {
      this.emit("sessions:cleaned", { count: cleanedCount });
    }

    return cleanedCount;
  }

  /**
   * Clean up session on disconnect
   */
  public async handleDisconnect(socketId: string): Promise<void> {
    const userId = this.activeConnections.get(socketId);
    if (userId) {
      await this.destroySession(userId);
    }
  }

  /**
   * Full cleanup - destroy all sessions and stop timer
   */
  public async cleanup(): Promise<void> {
    try {
      // Stop the cleanup timer
      this.stopCleanupTimer();

      // Destroy all sessions
      const userIds = Array.from(this.playerSessions.keys());
      for (const userId of userIds) {
        await this.destroySession(userId);
      }

      // Clear all maps
      this.playerSessions.clear();
      this.activeConnections.clear();
      this.serverStates.clear();
    } catch (error) {
      this.logger.error(
        { err: error },
        "Error during GameStateManager cleanup",
      );
    }
  }

  // ==================== MONITORING & STATS ====================

  public getStats() {
    const now = Date.now();
    const sessions = Array.from(this.playerSessions.values());
    const idleSessions = sessions.filter(
      (s) => now - s.lastActivity.getTime() > this.SESSION_IDLE_TIMEOUT_MS,
    );

    return {
      activePlayers: this.playerSessions.size,
      activeConnections: this.activeConnections.size,
      activeServers: this.serverStates.size,
      idleSessions: idleSessions.length,
      maxSessions: this.MAX_SESSIONS,
      cleanupInterval: this.CLEANUP_INTERVAL_MS,
      sessionTimeout: this.SESSION_IDLE_TIMEOUT_MS,
      sessions: sessions.map((session) => ({
        userId: session.userId,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        currentServerId: session.currentServerId,
      })),
    };
  }

  public logStats(): void {
    const stats = this.getStats();
    this.logger.info(
      {
        activePlayers: stats.activePlayers,
        activeServers: stats.activeServers,
      },
      "GameStateManager Stats",
    );
  }
}

export default GameStateManager;
