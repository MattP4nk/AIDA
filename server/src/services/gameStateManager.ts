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
import { shopService } from "./shopService";
import { missionService } from "./missionService";
import { SESSION_TIMEOUT_MS } from "../config/constants";

import { injectable, inject } from "tsyringe";
import { SOCKET_IO, EVENT_SERVICE, COMMAND_PROCESSOR } from "../di/tokens";
import type EventService from "./eventService";
import type CommandProcessor from "./commandProcessor";

@injectable()
class GameStateManager extends EventEmitter {
  private playerSessions: Map<string, PlayerSession>;
  private activeConnections: Map<string, string>; // socketId -> userId
  private serverStates: Map<string, ServerState>;
  private io: SocketIOServer;
  private eventService: EventService;
  private commandProcessor: CommandProcessor;

  constructor(
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(EVENT_SERVICE) eventService: EventService,
    @inject(COMMAND_PROCESSOR) commandProcessor: CommandProcessor,
  ) {
    super();
    this.io = io;
    this.eventService = eventService;
    this.commandProcessor = commandProcessor;
    this.playerSessions = new Map();
    this.activeConnections = new Map();
    this.serverStates = new Map();

    console.log("🎮 GameStateManager initialized");
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
    try {
      // Check if session already exists
      const existingSession = this.playerSessions.get(userId);
      if (existingSession) {
        console.log(
          `⚠️  Session already exists for user ${userId}, updating...`,
        );
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

      this.emit("session:created", { userId, session });
      console.log(`✅ Session created for user ${userId}`);

      return session;
    } catch (error) {
      console.error(`❌ Error creating session for user ${userId}:`, error);
      throw error;
    }
  }

  public async destroySession(userId: string): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) {
        console.log(`⚠️  No session found for user ${userId}`);
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
      console.log(`❌ Session destroyed for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error destroying session for user ${userId}:`, error);
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
      console.log(
        `⚠️  Fixing old home directory for ${username}: /home/user -> ${correctHomeDir}`,
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
        console.log(`⚠️  User or progress not found for ${userId}`);
        return null;
      }

      const session = this.playerSessions.get(userId);

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
        reputation: {
          military: user.progress.repMilitary,
          swordCorp: user.progress.repSwordCorp,
          anons: user.progress.repAnons,
          neutral: user.progress.repNeutral,
        },
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
      const inventoryItems = await shopService.getPlayerInventory(userId);
      const playerMissions = await missionService.getPlayerMissions(userId);
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
      console.error(`❌ Error getting game state for user ${userId}:`, error);
      return null;
    }
  }

  public async broadcastStateUpdate(userId: string): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) {
        console.log(`⚠️  No session found for user ${userId}`);
        return;
      }

      const state = await this.getGameState(userId);
      if (!state) {
        console.log(`⚠️  Could not get game state for user ${userId}`);
        return;
      }

      this.io.to(`user:${userId}`).emit("state:update", {
        fullState: state,
        timestamp: new Date(),
      });

      console.log(`📤 Broadcast full state update to user ${userId}`);
    } catch (error) {
      console.error(`❌ Error broadcasting state update:`, error);
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

      console.log(`📤 Broadcast state delta to user ${userId}: ${path}`);
    } catch (error) {
      console.error(`❌ Error broadcasting state delta:`, error);
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
        console.log(`⚠️  No session found for user ${userId}`);
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
        console.log(`⚠️  Server ${serverId} not found`);
        return false;
      }

      // Update session
      session.currentServerId = serverId;

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
      console.log(`🔌 User ${userId} connected to server ${serverId}`);

      return true;
    } catch (error) {
      console.error(`❌ Error connecting player to server:`, error);
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
      this.emit("player:disconnected_from_server", { userId, serverId });
      console.log(`🔌 User ${userId} disconnected from server ${serverId}`);
    } catch (error) {
      console.error(`❌ Error disconnecting player from server:`, error);
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
      const { fileService } = await import("./fileService");

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
          console.log(
            `⚠ Server with IP ${user.homeIp} already exists (${existingServerWithIp.id}), using it for user ${user.username}`,
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

          console.log(
            `🏠 Created home server for user ${userId}: ${homeServerId}`,
          );

          // Store reference in User record
          await db.client.user.update({
            where: { id: userId },
            data: { homeServerId },
          });
        }
      }

      // Initialize file system for home server
      await fileService.initializeFileSystem(homeServerId, userId);

      // Create user's home directory with some starter files
      await this.createStarterFiles(homeServerId, userId);
    } catch (error) {
      console.error(`❌ Error initializing home file system:`, error);
    }
  }

  private async createStarterFiles(
    homeServerId: string,
    userId: string,
  ): Promise<void> {
    try {
      const { fileService } = await import("./fileService");

      // Get user info
      const user = await db.client.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        console.error(`User ${userId} not found`);
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
        console.log(
          `🏠 Created home directory for user ${user.username}: ${userHomeDir}`,
        );
      } else if (createDirResult.error === "DIRECTORY_EXISTS") {
        // Directory already exists, that's fine
        console.log(
          `🏠 Home directory already exists for user ${user.username}: ${userHomeDir}`,
        );
        return; // Don't recreate starter files
      } else {
        console.error(
          `❌ Failed to create home directory: ${createDirResult.message}`,
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

      console.log(
        `📄 Created starter files for user ${user.username} in ${userHomeDir}`,
      );
    } catch (error) {
      console.error(`❌ Error creating starter files:`, error);
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
      console.error(`❌ Error getting server info:`, error);
      return null;
    }
  }

  // ==================== TERMINAL TAB MANAGEMENT ====================

  public createTerminal(userId: string, label?: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      console.error(`❌ No session found for user ${userId}`);
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
    console.log(`✅ Created terminal ${newTerminal.id} for user ${userId}`);

    return newTerminal;
  }

  public closeTerminal(userId: string, terminalId: string): boolean {
    const session = this.playerSessions.get(userId);
    if (!session) {
      console.error(`❌ No session found for user ${userId}`);
      return false;
    }

    // Don't allow closing the last terminal
    if (session.terminals.length <= 1) {
      console.warn(`⚠️  Cannot close the last terminal for user ${userId}`);
      return false;
    }

    const terminalIndex = session.terminals.findIndex(
      (t) => t.id === terminalId,
    );
    if (terminalIndex === -1) {
      console.error(`❌ Terminal ${terminalId} not found for user ${userId}`);
      return false;
    }

    // Don't allow closing the home terminal (first terminal, index 0)
    if (terminalIndex === 0) {
      console.warn(`⚠️  Cannot close the home terminal for user ${userId}`);
      return false;
    }

    session.terminals.splice(terminalIndex, 1);

    // If we closed the active terminal, switch to the first one (home)
    if (session.activeTerminalId === terminalId) {
      session.activeTerminalId = session.terminals[0]!.id;
    }

    console.log(`✅ Closed terminal ${terminalId} for user ${userId}`);
    return true;
  }

  public switchTerminal(userId: string, terminalId: string): boolean {
    const session = this.playerSessions.get(userId);
    if (!session) {
      console.error(`❌ No session found for user ${userId}`);
      return false;
    }

    const terminal = session.terminals.find((t) => t.id === terminalId);
    if (!terminal) {
      console.error(`❌ Terminal ${terminalId} not found for user ${userId}`);
      return false;
    }

    session.activeTerminalId = terminalId;
    terminal.lastActivity = new Date();
    console.log(`✅ Switched to terminal ${terminalId} for user ${userId}`);

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

  public async cleanup(): Promise<void> {
    console.log("🧹 Cleaning up GameStateManager...");

    try {
      // Destroy all sessions
      const userIds = Array.from(this.playerSessions.keys());
      for (const userId of userIds) {
        await this.destroySession(userId);
      }

      // Clear all maps
      this.playerSessions.clear();
      this.activeConnections.clear();
      this.serverStates.clear();

      console.log("✅ GameStateManager cleanup complete");
    } catch (error) {
      console.error("❌ Error during GameStateManager cleanup:", error);
    }
  }

  // ==================== MONITORING & STATS ====================

  public getStats() {
    return {
      activePlayers: this.playerSessions.size,
      activeConnections: this.activeConnections.size,
      activeServers: this.serverStates.size,
      sessions: Array.from(this.playerSessions.values()).map((session) => ({
        userId: session.userId,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        currentServerId: session.currentServerId,
      })),
    };
  }

  public logStats(): void {
    const stats = this.getStats();
    console.log("📊 GameStateManager Stats:", {
      activePlayers: stats.activePlayers,
      activeServers: stats.activeServers,
    });
  }
}

export default GameStateManager;
