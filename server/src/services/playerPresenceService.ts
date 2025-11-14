import { EventEmitter } from "events";
import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../database/client";

/**
 * Online player information
 */
export interface OnlinePlayer {
  userId: string;
  username: string;
  level: number;
  reputation: number;
  currentServerId?: string | undefined;
  currentServerName?: string | undefined;
  connectedAt: Date;
  lastActivity: Date;
  socketId: string;
}

/**
 * Player details for whois command
 */
export interface PlayerDetails extends OnlinePlayer {
  email?: string;
  joinedAt: Date;
  totalHacks: number;
  successfulHacks: number;
  credits: number;
  skills: {
    hacking: number;
    stealth: number;
    networking: number;
    cryptography: number;
    socialEng: number;
    forensics: number;
  };
  reputation: number;
  achievements: string[];
  isNPC: boolean;
}

/**
 * Server occupancy info
 */
export interface ServerOccupancy {
  serverId: string;
  serverName: string;
  players: OnlinePlayer[];
  playerCount: number;
  maxConnections: number;
  isPublic: boolean;
}

/**
 * Presence update types
 */
export type PresenceEvent =
  | "player_online"
  | "player_offline"
  | "player_joined_server"
  | "player_left_server"
  | "player_activity"
  | "status_changed";

/**
 * PlayerPresenceService - Track and broadcast online player status
 *
 * Features:
 * - Real-time online player tracking
 * - Server occupancy monitoring
 * - Player discovery and search
 * - Activity tracking
 * - Presence broadcasting via Socket.IO
 */
export class PlayerPresenceService extends EventEmitter {
  private io: SocketIOServer;
  private onlinePlayers: Map<string, OnlinePlayer>;
  private playersByServer: Map<string, Set<string>>;
  private activityTimeouts: Map<string, NodeJS.Timeout>;
  private readonly ACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  constructor(io: SocketIOServer) {
    super();
    this.io = io;
    this.onlinePlayers = new Map();
    this.playersByServer = new Map();
    this.activityTimeouts = new Map();

    console.log("👥 Player Presence Service initialized");

    // Clean up inactive players every minute
    setInterval(() => this.cleanupInactivePlayers(), 60000);
  }

  // ==================== PLAYER ONLINE STATUS ====================

  /**
   * Mark player as online
   */
  public async playerConnected(
    userId: string,
    socketId: string,
  ): Promise<void> {
    try {
      // Get player data from database
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          progress: true,
        },
      });

      if (!user) {
        console.error(`User ${userId} not found`);
        return;
      }

      const onlinePlayer: OnlinePlayer = {
        userId: user.id,
        username: user.username,
        level: user.progress?.level || 1,
        reputation: user.progress
          ? Math.round(
              (user.progress.repMilitary +
                user.progress.repSwordCorp +
                user.progress.repAnons +
                user.progress.repNeutral) /
                4,
            )
          : 0,
        connectedAt: new Date(),
        lastActivity: new Date(),
        socketId,
      };

      this.onlinePlayers.set(userId, onlinePlayer);

      // Set activity timeout
      this.resetActivityTimeout(userId);

      // Update database
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: true, lastLogin: new Date() },
      });

      // Broadcast to all other players
      this.io.emit("presence:player_online", {
        userId: user.id,
        username: user.username,
        level: user.progress?.level || 1,
        timestamp: new Date(),
      });

      this.emit("player_online", onlinePlayer);
      console.log(`✅ Player ${user.username} is now online`);
    } catch (error) {
      console.error("Error marking player online:", error);
    }
  }

  /**
   * Mark player as offline
   */
  public async playerDisconnected(userId: string): Promise<void> {
    try {
      const player = this.onlinePlayers.get(userId);
      if (!player) return;

      // Remove from server if connected
      if (player.currentServerId) {
        await this.playerLeftServer(userId, player.currentServerId);
      }

      // Clear activity timeout
      const timeout = this.activityTimeouts.get(userId);
      if (timeout) {
        clearTimeout(timeout);
        this.activityTimeouts.delete(userId);
      }

      // Remove from online list
      this.onlinePlayers.delete(userId);

      // Update database
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: false },
      });

      // Broadcast to all players
      this.io.emit("presence:player_offline", {
        userId,
        username: player.username,
        timestamp: new Date(),
      });

      this.emit("player_offline", { userId, username: player.username });
      console.log(`👋 Player ${player.username} is now offline`);
    } catch (error) {
      console.error("Error marking player offline:", error);
    }
  }

  /**
   * Update player activity timestamp
   */
  public updateActivity(userId: string): void {
    const player = this.onlinePlayers.get(userId);
    if (player) {
      player.lastActivity = new Date();
      this.resetActivityTimeout(userId);
    }
  }

  /**
   * Reset activity timeout for player
   */
  private resetActivityTimeout(userId: string): void {
    // Clear existing timeout
    const existing = this.activityTimeouts.get(userId);
    if (existing) clearTimeout(existing);

    // Set new timeout
    const timeout = setTimeout(() => {
      console.log(`⏰ Player ${userId} inactive, marking as away`);
      // Could mark as "away" status here
    }, this.ACTIVITY_TIMEOUT);

    this.activityTimeouts.set(userId, timeout);
  }

  /**
   * Clean up players who have been inactive
   */
  private cleanupInactivePlayers(): void {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30 minutes

    this.onlinePlayers.forEach((player, userId) => {
      const inactiveTime = now - player.lastActivity.getTime();
      if (inactiveTime > timeout) {
        console.log(`🧹 Cleaning up inactive player ${player.username}`);
        this.playerDisconnected(userId);
      }
    });
  }

  // ==================== SERVER OCCUPANCY ====================

  /**
   * Player joined a server
   */
  public async playerJoinedServer(
    userId: string,
    serverId: string,
  ): Promise<void> {
    try {
      const player = this.onlinePlayers.get(userId);
      if (!player) return;

      // Update player's current server
      player.currentServerId = serverId;

      // Get server info
      const server = await prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (server) {
        player.currentServerName = server.name;
      }

      // Add to server player list
      if (!this.playersByServer.has(serverId)) {
        this.playersByServer.set(serverId, new Set());
      }
      this.playersByServer.get(serverId)!.add(userId);

      // Broadcast to players on that server
      const playersOnServer = this.getPlayersOnServer(serverId);
      playersOnServer.forEach((p) => {
        if (p.userId !== userId) {
          this.io.to(p.socketId).emit("presence:player_joined_server", {
            userId: player.userId,
            username: player.username,
            level: player.level,
            serverId,
            serverName: player.currentServerName,
            timestamp: new Date(),
          });
        }
      });

      this.emit("player_joined_server", { userId, serverId });
      console.log(
        `🖥️  Player ${player.username} joined server ${server?.name || serverId}`,
      );
    } catch (error) {
      console.error("Error handling player server join:", error);
    }
  }

  /**
   * Player left a server
   */
  public async playerLeftServer(
    userId: string,
    serverId: string,
  ): Promise<void> {
    try {
      const player = this.onlinePlayers.get(userId);
      if (!player) return;

      // Broadcast to players on that server
      const playersOnServer = this.getPlayersOnServer(serverId);
      playersOnServer.forEach((p) => {
        if (p.userId !== userId) {
          this.io.to(p.socketId).emit("presence:player_left_server", {
            userId: player.userId,
            username: player.username,
            serverId,
            timestamp: new Date(),
          });
        }
      });

      // Remove from server player list
      const serverPlayers = this.playersByServer.get(serverId);
      if (serverPlayers) {
        serverPlayers.delete(userId);
        if (serverPlayers.size === 0) {
          this.playersByServer.delete(serverId);
        }
      }

      // Clear current server
      delete player.currentServerId;
      delete player.currentServerName;

      this.emit("player_left_server", { userId, serverId });
      console.log(`🚪 Player ${player.username} left server ${serverId}`);
    } catch (error) {
      console.error("Error handling player server leave:", error);
    }
  }

  /**
   * Get all players on a specific server
   */
  public getPlayersOnServer(serverId: string): OnlinePlayer[] {
    const playerIds = this.playersByServer.get(serverId);
    if (!playerIds) return [];

    return Array.from(playerIds)
      .map((id) => this.onlinePlayers.get(id))
      .filter((p) => p !== undefined) as OnlinePlayer[];
  }

  /**
   * Get server occupancy info
   */
  public async getServerOccupancy(
    serverId: string,
  ): Promise<ServerOccupancy | null> {
    try {
      const server = await prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) return null;

      const players = this.getPlayersOnServer(serverId);

      return {
        serverId: server.id,
        serverName: server.name,
        players,
        playerCount: players.length,
        maxConnections: server.maxConnections,
        isPublic: true, // Could be based on server.accessRules
      };
    } catch (error) {
      console.error("Error getting server occupancy:", error);
      return null;
    }
  }

  // ==================== PLAYER DISCOVERY ====================

  /**
   * Get all online players
   */
  public getOnlinePlayers(): OnlinePlayer[] {
    return Array.from(this.onlinePlayers.values());
  }

  /**
   * Get online player count
   */
  public getOnlineCount(): number {
    return this.onlinePlayers.size;
  }

  /**
   * Get player by username
   */
  public findPlayerByUsername(username: string): OnlinePlayer | undefined {
    return Array.from(this.onlinePlayers.values()).find(
      (p) => p.username.toLowerCase() === username.toLowerCase(),
    );
  }

  /**
   * Search players by partial username
   */
  public searchPlayers(query: string): OnlinePlayer[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.onlinePlayers.values()).filter((p) =>
      p.username.toLowerCase().includes(lowerQuery),
    );
  }

  /**
   * Get detailed player info (whois)
   */
  public async getPlayerDetails(userId: string): Promise<PlayerDetails | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          progress: true,
        },
      });

      if (!user) return null;

      const onlinePlayer = this.onlinePlayers.get(userId);

      // Count successful hacks
      const hackLogs = await prisma.hackLog.findMany({
        where: { attackerId: userId },
      });

      const successfulHacks = hackLogs.filter((log) => log.success).length;

      const details: PlayerDetails = {
        userId: user.id,
        username: user.username,
        email: user.email, // Only show to admins/self
        level: user.progress?.level || 1,
        reputation: user.progress
          ? Math.round(
              (user.progress.repMilitary +
                user.progress.repSwordCorp +
                user.progress.repAnons +
                user.progress.repNeutral) /
                4,
            )
          : 0,
        joinedAt: user.createdAt,
        totalHacks: hackLogs.length,
        successfulHacks,
        credits: user.progress?.credits || 0,
        skills: {
          hacking: user.progress?.hacking || 10,
          stealth: user.progress?.stealth || 10,
          networking: user.progress?.networking || 10,
          cryptography: user.progress?.cryptography || 5,
          socialEng: user.progress?.socialEng || 5,
          forensics: user.progress?.forensics || 5,
        },
        achievements: user.progress?.achievements || [],
        isNPC: false, // Not available in current schema
        connectedAt: onlinePlayer?.connectedAt || new Date(),
        lastActivity: onlinePlayer?.lastActivity || new Date(),
        currentServerId: onlinePlayer?.currentServerId || undefined,
        currentServerName: onlinePlayer?.currentServerName || undefined,
        socketId: onlinePlayer?.socketId || "",
      };

      return details;
    } catch (error) {
      console.error("Error getting player details:", error);
      return null;
    }
  }

  /**
   * Check if player is online
   */
  public isPlayerOnline(userId: string): boolean {
    return this.onlinePlayers.has(userId);
  }

  /**
   * Get player's socket ID
   */
  public getPlayerSocketId(userId: string): string | undefined {
    return this.onlinePlayers.get(userId)?.socketId;
  }

  // ==================== STATISTICS ====================

  /**
   * Get presence statistics
   */
  public getStats() {
    return {
      totalOnline: this.onlinePlayers.size,
      serversOccupied: this.playersByServer.size,
      averagePlayersPerServer:
        this.playersByServer.size > 0
          ? Array.from(this.playersByServer.values()).reduce(
              (sum, set) => sum + set.size,
              0,
            ) / this.playersByServer.size
          : 0,
    };
  }

  /**
   * Get top players by reputation (online only)
   */
  public getTopPlayers(limit: number = 10): OnlinePlayer[] {
    return Array.from(this.onlinePlayers.values())
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, limit);
  }

  // ==================== UTILITY ====================

  /**
   * Format online players list for terminal output
   */
  public formatOnlinePlayersList(): string {
    const players = this.getOnlinePlayers();

    if (players.length === 0) {
      return "No players currently online.";
    }

    let output = "=== ONLINE PLAYERS ===\n\n";

    players
      .sort((a, b) => b.level - a.level)
      .forEach((player) => {
        const status = player.currentServerName
          ? `@ ${player.currentServerName}`
          : "Idle";
        output += `[Lv${player.level}] ${player.username} - ${status}\n`;
        output += `  Rep: ${player.reputation} | Online for: ${this.getOnlineDuration(player)}\n`;
      });

    output += `\nTotal: ${players.length} player${players.length !== 1 ? "s" : ""} online`;

    return output;
  }

  /**
   * Get how long player has been online
   */
  private getOnlineDuration(player: OnlinePlayer): string {
    const minutes = Math.floor(
      (Date.now() - player.connectedAt.getTime()) / 60000,
    );
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  }

  /**
   * Format server occupancy for terminal
   */
  public formatServerOccupancy(serverId: string): string {
    const players = this.getPlayersOnServer(serverId);

    if (players.length === 0) {
      return "No other players on this server.";
    }

    let output = "=== PLAYERS ON THIS SERVER ===\n\n";

    players.forEach((player) => {
      output += `• [Lv${player.level}] ${player.username}\n`;
    });

    output += `\nTotal: ${players.length} player${players.length !== 1 ? "s" : ""}`;

    return output;
  }
}

// Singleton instance (initialized by server)
let presenceService: PlayerPresenceService | null = null;

export function initializePresenceService(
  io: SocketIOServer,
): PlayerPresenceService {
  presenceService = new PlayerPresenceService(io);
  return presenceService;
}

export function getPresenceService(): PlayerPresenceService {
  if (!presenceService) {
    throw new Error("PlayerPresenceService not initialized");
  }
  return presenceService;
}

export { presenceService };
