import { GameServer, ServerConnection } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { db } from "../database/client";
import { injectable, inject } from "tsyringe";
import { CACHE_SERVICE } from "../di/tokens";
import type { CacheService } from "./cacheService";

/**
 * Server state interface
 */
interface ServerState {
  online: boolean;
  load: number;
  connections: number;
  lastActivity: Date;
  alerts: number;
}

/**
 * Create server data interface
 */
interface CreateServerData {
  name: string;
  ipAddress: string;
  type: string;
  ownerId?: string;
  encryptionLevel?: number;
  accessRules?: any[];
  maxConnections?: number;
}

/**
 * Server details interface
 */
interface ServerDetails extends GameServer {
  state: ServerState;
}

/**
 * Server info for discovery
 */
interface ServerInfo {
  id: string;
  name: string;
  ipAddress: string;
  type: string;
  encryptionLevel: number;
  isOnline: boolean;
}

/**
 * Connection result interface
 */
interface ConnectionResult {
  success: boolean;
  serverId: string;
  accessLevel: number;
  message: string;
}

/**
 * Security level interface
 */
interface SecurityLevel {
  firewall: number;
  ids: number;
  encryption: number;
  overall: number;
  rating: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

/**
 * Access check result
 */
interface AccessCheck {
  canAccess: boolean;
  accessLevel: number;
  reason: string;
  requirements?: string[];
}

/**
 * ServerService - Manages game servers, connections, and security
 *
 * Responsibilities:
 * - Server discovery and management
 * - Connection tracking
 * - Security rules and access control
 * - Server state management
 * - Network topology
 */
@injectable()
class ServerService {
  private prisma = db.client;
  private io: SocketIOServer | null = null;

  constructor(
    @inject(CACHE_SERVICE) private cacheService: CacheService
  ) {
    console.log("🖥️  ServerService initialized");
  }

  /**
   * Set Socket.IO instance for real-time events
   * @param io - Socket.IO server instance
   */
  public setSocketIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Create a new game server
   * @param data - Server creation data
   * @returns Created server details
   */
  public async createServer(data: CreateServerData): Promise<ServerDetails> {
    try {
      // Create server in database
      const server = await this.prisma.gameServer.create({
        data: {
          name: data.name,
          ipAddress: data.ipAddress,
          type: data.type,
          ownerId: data.ownerId ?? null,
          encryptionLevel: data.encryptionLevel ?? 0,
          accessRules: (data.accessRules ?? []) as any,
          isOnline: true,
          maxConnections: data.maxConnections ?? 10,
          currentConnections: 0,
        },
      });

      // Audit log
      await this.auditLog(data.ownerId ?? "system", "SERVER_CREATED", {
        serverId: server.id,
        serverName: server.name,
        ipAddress: server.ipAddress,
        type: server.type,
      });

      // Emit Socket.IO event
      if (this.io && data.ownerId) {
        this.io.to(`player:${data.ownerId}`).emit("server:created", {
          serverId: server.id,
          name: server.name,
          ipAddress: server.ipAddress,
        });
      }

      // Generate default state
      const defaultState: ServerState = {
        online: true,
        load: 0,
        connections: 0,
        lastActivity: new Date(),
        alerts: 0,
      };

      return {
        ...server,
        state: defaultState,
      };
    } catch (error) {
      console.error("[ServerService] Error creating server:", error);
      throw new Error(
        `Failed to create server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get server by ID
   * @param serverId - Server ID
   * @returns Server details
   */
  public async getServer(serverId: string): Promise<ServerDetails | null> {
    try {
      // Check cache first
      const cached = this.cacheService.get<ServerDetails>(`server:${serverId}`);
      if (cached) {
        return cached;
      }

      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return null;
      }

      // Generate current state
      const state: ServerState = {
        online: server.isOnline,
        load: Math.min(
          100,
          (server.currentConnections / server.maxConnections) * 100,
        ),
        connections: await this.getActiveConnectionCount(serverId),
        lastActivity: server.updatedAt,
        alerts: 0,
      };

      const result = {
        ...server,
        state,
      };

      // Cache result (TTL 30 seconds)
      this.cacheService.set(`server:${serverId}`, result, 30);

      return result;
    } catch (error) {
      console.error("[ServerService] Error getting server:", error);
      throw new Error(
        `Failed to get server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get server by IP
   * @param ipAddress - Server IP
   * @returns Server details
   */
  public async getServerByIp(ipAddress: string): Promise<ServerDetails | null> {
    try {
      // Check cache first
      const cached = this.cacheService.get<ServerDetails>(`server_ip:${ipAddress}`);
      if (cached) {
        return cached;
      }

      const server = await this.prisma.gameServer.findUnique({
        where: { ipAddress },
      });

      if (!server) {
        return null;
      }

      // Generate current state
      const state: ServerState = {
        online: server.isOnline,
        load: Math.min(
          100,
          (server.currentConnections / server.maxConnections) * 100,
        ),
        connections: await this.getActiveConnectionCount(server.id),
        lastActivity: server.updatedAt,
        alerts: 0,
      };

      const result = {
        ...server,
        state,
      };

      // Cache result
      this.cacheService.set(`server_ip:${ipAddress}`, result, 30);
      // Also cache by ID
      this.cacheService.set(`server:${server.id}`, result, 30);

      return result;
    } catch (error) {
      console.error("[ServerService] Error getting server by IP:", error);
      return null;
    }
  }

  /**
   * Update server properties
   * @param serverId - Server ID
   * @param updates - Partial server data to update
   * @returns Updated server details
   */
  public async updateServer(
    serverId: string,
    updates: Partial<CreateServerData>,
  ): Promise<ServerDetails> {
    try {
      const existingServer = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!existingServer) {
        throw new Error("Server not found");
      }

      // Prepare update data
      const updateData: any = {};
      if (updates.name) updateData.name = updates.name;
      if (updates.type) updateData.type = updates.type;
      if (updates.encryptionLevel !== undefined)
        updateData.encryptionLevel = updates.encryptionLevel;
      if (updates.accessRules)
        updateData.accessRules = updates.accessRules as any;
      if (updates.maxConnections !== undefined)
        updateData.maxConnections = updates.maxConnections;

      const server = await this.prisma.gameServer.update({
        where: { id: serverId },
        data: updateData,
      });

      // Invalidate cache
      this.cacheService.del(`server:${serverId}`);

      // Audit log
      await this.auditLog(
        updates.ownerId ?? existingServer.ownerId ?? "system",
        "SERVER_UPDATED",
        {
          serverId: server.id,
          updates: Object.keys(updates),
        },
      );

      // Emit Socket.IO event
      if (this.io && existingServer.ownerId) {
        this.io.to(`player:${existingServer.ownerId}`).emit("server:updated", {
          serverId: server.id,
          name: server.name,
        });
      }

      return (await this.getServer(serverId)) as ServerDetails;
    } catch (error) {
      console.error("[ServerService] Error updating server:", error);
      throw new Error(
        `Failed to update server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Delete a server
   * @param serverId - Server ID
   */
  public async deleteServer(serverId: string): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        throw new Error("Server not found");
      }

      // Delete all connections first
      await this.prisma.serverConnection.deleteMany({
        where: { serverId },
      });

      // Delete server
      await this.prisma.gameServer.delete({
        where: { id: serverId },
      });

      // Invalidate cache
      this.cacheService.del(`server:${serverId}`);

      // Audit log
      await this.auditLog(server.ownerId ?? "system", "SERVER_DELETED", {
        serverId: server.id,
        serverName: server.name,
      });

      // Emit Socket.IO event
      if (this.io && server.ownerId) {
        this.io.to(`player:${server.ownerId}`).emit("server:deleted", {
          serverId: server.id,
        });
      }
    } catch (error) {
      console.error("[ServerService] Error deleting server:", error);
      throw new Error(
        `Failed to delete server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Discover servers based on player scan level
   * @param userId - User ID
   * @param scanLevel - Scan skill level (0-10)
   * @returns Array of discovered servers
   */
  public async discoverServers(
    userId: string,
    scanLevel: number,
  ): Promise<ServerInfo[]> {
    try {
      // Get player's current level
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      const playerLevel = progress.level;

      // Discover servers within player's range
      // Higher scan level reveals more servers
      const maxEncryption = Math.min(100, playerLevel * 10 + scanLevel * 5);

      const servers = await this.prisma.gameServer.findMany({
        where: {
          isOnline: true,
          encryptionLevel: {
            lte: maxEncryption,
          },
        },
        take: 10 + scanLevel * 5, // More servers with higher scan level
        orderBy: {
          encryptionLevel: "asc",
        },
      });

      // Audit log
      await this.auditLog(userId, "SERVERS_DISCOVERED", {
        count: servers.length,
        scanLevel,
        maxEncryption,
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("server:discovered", {
          count: servers.length,
          servers: servers
            .slice(0, 5)
            .map((s) => ({ id: s.id, name: s.name, ipAddress: s.ipAddress })),
        });
      }

      return servers.map((server) => ({
        id: server.id,
        name: server.name,
        ipAddress: server.ipAddress,
        type: server.type,
        encryptionLevel: server.encryptionLevel,
        isOnline: server.isOnline,
      }));
    } catch (error) {
      console.error("[ServerService] Error discovering servers:", error);
      throw new Error(
        `Failed to discover servers: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Connect player to a server
   * @param userId - User ID
   * @param serverId - Server ID
   * @returns Connection result
   */
  public async connectToServer(
    userId: string,
    idOrIp: string,
  ): Promise<ConnectionResult> {
    try {
      let server = await this.getServer(idOrIp);
      if (!server) {
        // Try by IP
        server = await this.getServerByIp(idOrIp);
      }

      if (!server) {
        return {
          success: false,
          serverId: idOrIp,
          accessLevel: 0,
          message: "Server not found",
        };
      }

      // Check if player can access server
      const accessCheck = await this.canAccessServer(userId, server.id);
      if (!accessCheck.canAccess) {
        return {
          success: false,
          serverId: server.id,
          accessLevel: 0,
          message: accessCheck.reason,
        };
      }

      // Create or update connection
      const existingConnection = await this.prisma.serverConnection.findFirst({
        where: {
          userId,
          serverId: server.id,
          isActive: true,
        },
      });

      if (existingConnection) {
        // Update existing connection
        await this.prisma.serverConnection.update({
          where: { id: existingConnection.id },
          data: {
            // connectedAt: new Date(), // Keep original connectedAt
            // sessionData: { accessLevel: accessCheck.accessLevel } as any, // Update session data if needed
          },
        });
      } else {
        // Create new connection
        await this.prisma.serverConnection.create({
          data: {
            userId,
            serverId: server.id,
            isActive: true,
            accessLevel: accessCheck.accessLevel,
            sessionData: { accessLevel: accessCheck.accessLevel } as any,
          },
        });
      }

      // Update server connection count
      await this.prisma.gameServer.update({
        where: { id: server.id },
        data: {
          currentConnections: {
            increment: 1,
          },
        },
      });

      // Invalidate cache
      this.cacheService.del(`server:${server.id}`);
      if (server.ipAddress) {
        this.cacheService.del(`server_ip:${server.ipAddress}`);
      }

      // Audit log
      await this.auditLog(userId, "SERVER_CONNECT", {
        serverId: server.id,
        serverName: server.name,
        accessLevel: accessCheck.accessLevel,
      });

      return {
        success: true,
        serverId: server.id,
        accessLevel: accessCheck.accessLevel,
        message: `Connected to ${server.name}`,
      };
    } catch (error) {
      console.error("[ServerService] Error connecting to server:", error);
      return {
        success: false,
        serverId: idOrIp,
        accessLevel: 0,
        message: "Connection failed",
      };
    }
  }

  /**
   * Disconnect player from a server
   * @param userId - User ID
   * @param serverId - Server ID
   */
  public async disconnectFromServer(
    userId: string,
    serverId: string,
  ): Promise<void> {
    try {
      const connection = await this.prisma.serverConnection.findFirst({
        where: {
          userId,
          serverId,
          isActive: true,
        },
      });

      if (connection) {
        await this.prisma.serverConnection.update({
          where: { id: connection.id },
          data: {
            isActive: false,
            disconnectedAt: new Date(),
          },
        });

        // Decrement server connections
        await this.prisma.gameServer.update({
          where: { id: serverId },
          data: {
            currentConnections: {
              decrement: 1,
            },
          },
        });

        // Audit log
        await this.auditLog(userId, "SERVER_DISCONNECTED", {
          serverId,
          connectionDuration: Date.now() - connection.connectedAt.getTime(),
        });

        // Emit Socket.IO event
        if (this.io) {
          this.io.to(`player:${userId}`).emit("server:disconnected", {
            serverId,
          });
        }
      }
    } catch (error) {
      console.error("[ServerService] Error disconnecting from server:", error);
      throw new Error(
        `Failed to disconnect from server: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get active connections for a player
   * @param userId - User ID
   * @returns Array of active server connections
   */
  public async getActiveConnections(
    userId: string,
  ): Promise<ServerConnection[]> {
    try {
      const connections = await this.prisma.serverConnection.findMany({
        where: {
          userId,
          isActive: true,
        },
        include: {
          server: true,
        },
        orderBy: {
          connectedAt: "desc",
        },
      });

      return connections;
    } catch (error) {
      console.error("[ServerService] Error getting active connections:", error);
      throw new Error(
        `Failed to get active connections: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get connection history for a player
   * @param userId - User ID
   * @param limit - Maximum number of records to return
   * @returns Array of server connections
   */
  public async getConnectionHistory(
    userId: string,
    limit: number = 50,
  ): Promise<ServerConnection[]> {
    try {
      const connections = await this.prisma.serverConnection.findMany({
        where: {
          userId,
        },
        include: {
          server: true,
        },
        orderBy: {
          connectedAt: "desc",
        },
        take: limit,
      });

      return connections;
    } catch (error) {
      console.error("[ServerService] Error getting connection history:", error);
      throw new Error(
        `Failed to get connection history: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Calculate security level for a server
   * @param server - Game server
   * @returns Security level details
   */
  public calculateSecurityLevel(server: GameServer): SecurityLevel {
    try {
      const encryptionLevel = server.encryptionLevel || 0;

      const firewall = Math.min(100, encryptionLevel * 0.8);
      const ids = Math.min(100, encryptionLevel * 0.6);
      const encryption = encryptionLevel;

      // Calculate overall security (0-100)
      const overall = Math.floor((firewall + ids + encryption) / 3);

      // Determine rating
      let rating: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
      if (overall < 25) rating = "LOW";
      else if (overall < 50) rating = "MEDIUM";
      else if (overall < 75) rating = "HIGH";
      else rating = "CRITICAL";

      return {
        firewall,
        ids,
        encryption,
        overall,
        rating,
      };
    } catch (error) {
      console.error("[ServerService] Error calculating security level:", error);
      return {
        firewall: 50,
        ids: 40,
        encryption: 25,
        overall: 38,
        rating: "MEDIUM",
      };
    }
  }

  /**
   * Check if player can access a server
   * @param userId - User ID
   * @param serverId - Server ID
   * @returns Access check result
   */
  public async canAccessServer(
    userId: string,
    serverId: string,
  ): Promise<AccessCheck> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        return {
          canAccess: false,
          accessLevel: 0,
          reason: "Server not found",
        };
      }

      if (!server.isOnline) {
        return {
          canAccess: false,
          accessLevel: 0,
          reason: "Server is offline",
        };
      }

      // Get player's skills
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          canAccess: false,
          accessLevel: 0,
          reason: "Player not found",
        };
      }

      // Check if player's level is sufficient
      const playerLevel = progress.level;
      const requiredLevel = Math.max(
        1,
        Math.floor(server.encryptionLevel / 20),
      );

      if (playerLevel < requiredLevel) {
        return {
          canAccess: false,
          accessLevel: 0,
          reason: `Insufficient level. Required: ${requiredLevel}, Current: ${playerLevel}`,
          requirements: [`Level ${requiredLevel} or higher`],
        };
      }

      // Calculate access level based on hacking skill and server encryption
      const hackingSkill = progress.hacking || 0;
      const baseAccess = Math.max(
        1,
        Math.floor(
          (hackingSkill / Math.max(1, server.encryptionLevel / 10)) * 5,
        ),
      );
      const accessLevel = Math.min(10, baseAccess);

      return {
        canAccess: true,
        accessLevel,
        reason: "Access granted",
      };
    } catch (error) {
      console.error("[ServerService] Error checking server access:", error);
      return {
        canAccess: false,
        accessLevel: 0,
        reason: "Error checking access",
      };
    }
  }

  /**
   * Trigger a security alert on a server
   * @param serverId - Server ID
   * @param userId - User ID who triggered the alert
   * @param reason - Reason for the alert
   */
  public async triggerSecurityAlert(
    serverId: string,
    userId: string,
    reason: string,
  ): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        throw new Error("Server not found");
      }

      // Log to hack log
      await this.prisma.hackLog.create({
        data: {
          attackerId: userId,
          targetId: server.ownerId || userId,
          targetServerId: serverId,
          method: "SECURITY_ALERT",
          tools: [],
          stealthLevel: 0,
          success: false,
          detected: true,
          accessLevel: 0,
          evidenceLeft: 100,
          counterMeasures: ["ALERT_TRIGGERED"],
          timestamp: new Date(),
          metadata: { reason } as any,
        },
      });

      // Audit log
      await this.auditLog(userId, "SECURITY_ALERT_TRIGGERED", {
        serverId,
        serverName: server.name,
        reason,
      });

      // Emit Socket.IO event to player
      if (this.io) {
        this.io.to(`player:${userId}`).emit("server:alert", {
          serverId,
          serverName: server.name,
          severity: "HIGH",
          message: `Security alert triggered: ${reason}`,
        });

        // Notify server owner if exists
        if (server.ownerId) {
          this.io.to(`player:${server.ownerId}`).emit("server:alert", {
            serverId,
            serverName: server.name,
            severity: "HIGH",
            message: `Security alert: User ${userId} triggered ${reason}`,
            intruderId: userId,
          });
        }
      }
    } catch (error) {
      console.error("[ServerService] Error triggering security alert:", error);
      throw new Error(
        `Failed to trigger security alert: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Update server state
   * @param serverId - Server ID
   * @param state - New server state
   */
  public async updateServerState(
    serverId: string,
    state: Partial<ServerState>,
  ): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        throw new Error("Server not found");
      }

      // Update relevant fields
      const updateData: any = {};
      if (state.online !== undefined) {
        updateData.isOnline = state.online;
      }

      if (Object.keys(updateData).length > 0) {
        await this.prisma.gameServer.update({
          where: { id: serverId },
          data: updateData,
        });

        // Emit Socket.IO event
        if (this.io && server.ownerId) {
          this.io.to(`player:${server.ownerId}`).emit("server:state:changed", {
            serverId,
            state,
          });
        }
      }
    } catch (error) {
      console.error("[ServerService] Error updating server state:", error);
      throw new Error(
        `Failed to update server state: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get current server state
   * @param serverId - Server ID
   * @returns Server state
   */
  public async getServerState(serverId: string): Promise<ServerState> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
      });

      if (!server) {
        throw new Error("Server not found");
      }

      const connectionCount = await this.getActiveConnectionCount(serverId);

      return {
        online: server.isOnline,
        load: Math.min(100, (connectionCount / server.maxConnections) * 100),
        connections: connectionCount,
        lastActivity: server.updatedAt,
        alerts: 0, // Could be tracked separately
      };
    } catch (error) {
      console.error("[ServerService] Error getting server state:", error);
      throw new Error(
        `Failed to get server state: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // ==================== PRIVATE HELPER METHODS ====================

  /**
   * Get count of active connections to a server
   * @param serverId - Server ID
   * @returns Connection count
   */
  private async getActiveConnectionCount(serverId: string): Promise<number> {
    try {
      return await this.prisma.serverConnection.count({
        where: {
          serverId,
          isActive: true,
        },
      });
    } catch (error) {
      console.error("[ServerService] Error getting connection count:", error);
      return 0;
    }
  }

  /**
   * Create audit log entry
   * @param userId - User ID
   * @param action - Action performed
   * @param details - Additional details
   */
  private async auditLog(
    userId: string,
    action: string,
    details: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: userId === "system" ? null : userId,
          action,
          resource: "SERVER",
          metadata: details as any,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error("[ServerService] Error creating audit log:", error);
      // Don't throw - audit log failure shouldn't break main functionality
    }
  }
}

export default ServerService;

// Backward compatibility
import { container } from "../di/container";
import { SERVER_SERVICE } from "../di/tokens";
export const serverService = new Proxy({} as ServerService, {
  get(_target, prop) {
    const instance = container.resolve(SERVER_SERVICE as any);
    return (instance as any)[prop];
  }
});
