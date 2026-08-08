import { GameServer, ServerConnection } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { Logger } from "pino";
import { db } from "../database/client";
import { injectable, inject } from "tsyringe";
import {
  LOGGER,
  CACHE_SERVICE,
  MISSION_INTEGRATION_SERVICE,
  FACTION_KNOWLEDGE_SERVICE,
} from "../di/tokens";
import type { CacheService } from "./cacheService";
import type MissionIntegrationService from "./missionIntegration";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import { safeExecute } from "../utils/safeExecute";

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
  private missionIntegration: MissionIntegrationService | null = null;

  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(CACHE_SERVICE) private cacheService: CacheService,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    this.missionIntegration = missionIntegrationService || null;
    this.factionKnowledge = factionKnowledgeService || null;
    this.logger.info("ServerService initialized");
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
    return (await safeExecute({
      fn: async () => {
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

        const result = { ...server, state: defaultState };

        // Queue content generation for the new server
        if (server.type !== "player_home") {
          try {
            const { getService } = await import("../di/container");
            const { CONTENT_QUEUE_SERVICE } = await import("../di/tokens");
            const contentQueue = getService<any>(CONTENT_QUEUE_SERVICE);
            await contentQueue.enqueue(server.id, 5 /* NORMAL */);
          } catch { /* non-critical */ }
        }

        return result;
      },
      context: "Create server",
      logger: this.logger,
      rethrow: true,
    })()) as ServerDetails;
  }

  /**
   * Get server by ID
   * @param serverId - Server ID
   * @returns Server details
   */
  public async getServer(serverId: string): Promise<ServerDetails | null> {
    return (await safeExecute({
      fn: async () => {
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

        // Use live count for both load and connections to stay in sync
        const liveConnections = await this.getActiveConnectionCount(serverId);
        const state: ServerState = {
          online: server.isOnline,
          load: Math.min(100, (liveConnections / server.maxConnections) * 100),
          connections: liveConnections,
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
      },
      context: "Get server",
      logger: this.logger,
      rethrow: true,
    })()) as ServerDetails | null;
  }

  /**
   * Get server by IP
   * @param ipAddress - Server IP
   * @returns Server details
   */
  public async getServerByIp(ipAddress: string): Promise<ServerDetails | null> {
    return (await safeExecute({
      fn: async () => {
        // Check cache first
        const cached = this.cacheService.get<ServerDetails>(
          `server_ip:${ipAddress}`,
        );
        if (cached) {
          return cached;
        }

        const server = await this.prisma.gameServer.findUnique({
          where: { ipAddress },
        });

        if (!server) {
          return null;
        }

        // Use live count for both load and connections to stay in sync
        const liveConnections = await this.getActiveConnectionCount(server.id);
        const state: ServerState = {
          online: server.isOnline,
          load: Math.min(100, (liveConnections / server.maxConnections) * 100),
          connections: liveConnections,
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
      },
      context: "Get server by IP",
      logger: this.logger,
      fallback: null as ServerDetails | null,
    })()) ?? null;
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
    return (await safeExecute({
      fn: async () => {
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
      },
      context: "Update server",
      logger: this.logger,
      rethrow: true,
    })()) as ServerDetails;
  }

  /**
   * Delete a server
   * @param serverId - Server ID
   */
  public async deleteServer(serverId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
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
      },
      context: "Delete server",
      logger: this.logger,
      rethrow: true,
    })();
  }

  /**
   * Extract the subnet prefix from an IP address.
   * Returns the first two octets (e.g. "192.168") which corresponds to the
   * /16 network zones used by this game (player 10.0.x.x, corporate 172.16-31.x.x,
   * government 192.168.x.x, underground 169.254.x.x).
   */
  private getSubnet(ip: string): string {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}`;
  }

  /**
   * Discover servers on the same network as the given IP address.
   *
   * Scans the /16 subnet of `fromIp` for servers the player hasn't visited yet,
   * filtered by the player's skill level and scan depth.
   *
   * @param userId   - User ID
   * @param scanLevel - Scan depth (higher reveals more encrypted servers)
   * @param fromIp   - The IP address to scan from (current server or home server)
   * @returns Array of newly-discovered servers on the same subnet
   */
  public async discoverServers(
    userId: string,
    scanLevel: number,
    fromIp?: string,
  ): Promise<ServerInfo[]> {
    return (await safeExecute({
      fn: async () => {
        // Get player's current level
        const progress = await this.prisma.playerProgress.findUnique({
          where: { userId },
        });

        if (!progress) {
          throw new Error("Player progress not found");
        }

        const playerLevel = progress.level;

        // Max encryption level the player can detect
        const maxEncryption = Math.min(100, playerLevel * 10 + scanLevel * 5);

        // Collect server IDs the player already knows about (owned + visited)
        const ownedServers = await this.prisma.gameServer.findMany({
          where: { ownerId: userId },
          select: { id: true },
        });
        const visitedConnections = await this.prisma.serverConnection.findMany({
          where: { userId },
          select: { serverId: true },
          distinct: ["serverId"],
        });

        const knownIds = new Set<string>();
        for (const s of ownedServers) knownIds.add(s.id);
        for (const c of visitedConnections) knownIds.add(c.serverId);

        // Build the base query — online, within encryption range, not already known
        const whereClause: Record<string, unknown> = {
          isOnline: true,
          encryptionLevel: { lte: maxEncryption },
          id: { notIn: Array.from(knownIds) },
        };

        // If we have a source IP, scope the scan to the same /16 subnet
        let subnet: string | null = null;
        if (fromIp) {
          subnet = this.getSubnet(fromIp);
          whereClause.ipAddress = { startsWith: `${subnet}.` };
        }

        const servers = await this.prisma.gameServer.findMany({
          where: whereClause,
          take: 10 + scanLevel * 5, // More servers with higher scan level
          orderBy: { encryptionLevel: "asc" },
        });

        // Audit log
        await this.auditLog(userId, "SERVERS_DISCOVERED", {
          count: servers.length,
          scanLevel,
          maxEncryption,
          subnet: subnet || "global",
          fromIp: fromIp || "none",
        });

        // Emit Socket.IO event
        if (this.io) {
          this.io.to(`player:${userId}`).emit("server:discovered", {
            count: servers.length,
            subnet: subnet || "global",
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
      },
      context: "Discover servers",
      logger: this.logger,
      rethrow: true,
    })()) as ServerInfo[];
  }

  /**
   * Scan for servers matching a partial IP prefix (subnet scan).
   * Used when players find incomplete IPs and want to scan that subnet
   * to find the network entrance (gateway).
   * @param userId - User ID
   * @param ipPrefix - Partial IP prefix, e.g. "10.10.10." or "192.168."
   * @param scanLevel - Player's scan level
   * @returns Array of discovered server info
   */
  public async scanByPartialIp(
    userId: string,
    ipPrefix: string,
    scanLevel: number,
  ): Promise<ServerInfo[]> {
    return (await safeExecute({
      fn: async () => {
        // Get player's current level
        const progress = await this.prisma.playerProgress.findUnique({
          where: { userId },
        });

        if (!progress) {
          throw new Error("Player progress not found");
        }

        const playerLevel = progress.level;

        // Max encryption level the player can detect
        const maxEncryption = Math.min(100, playerLevel * 10 + scanLevel * 5);

        // Query servers whose IP starts with the given prefix
        const servers = await this.prisma.gameServer.findMany({
          where: {
            ipAddress: { startsWith: ipPrefix },
            isOnline: true,
            encryptionLevel: { lte: maxEncryption },
          },
          orderBy: [{ role: "asc" }, { encryptionLevel: "asc" }],
          take: 5 + scanLevel * 3,
        });

        // Audit log
        await this.auditLog(userId, "SUBNET_SCAN", {
          count: servers.length,
          scanLevel,
          maxEncryption,
          ipPrefix,
        });

        // Emit Socket.IO event
        if (this.io) {
          this.io.to(`player:${userId}`).emit("server:subnet-scan", {
            count: servers.length,
            prefix: ipPrefix,
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
      },
      context: "Scan by partial IP",
      logger: this.logger,
      rethrow: true,
    })()) as ServerInfo[];
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

      // Track for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onServerConnect(userId, server.id, server.type || "unknown", {
            ...(server.networkId ? { networkId: server.networkId } : {}),
            ...(server.role ? { role: server.role } : {}),
          })
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onServerConnect error",
            ),
          );
      }

      // Track server discovery for faction knowledge
      if (this.factionKnowledge) {
        this.factionKnowledge
          .getPlayerFactionId(userId)
          .then((factionId) => {
            if (factionId) {
              this.factionKnowledge!.addEntry(factionId, {
                assetType: "server",
                assetId: server.id,
                assetMeta: {
                  name: server.name,
                  ip: server.ipAddress,
                  serverType: server.type,
                  securityLevel: server.securityLevel,
                  ownerId: server.ownerId,
                },
                source: "server_discovery",
                confidence: 0.8,
                discoveredBy: userId,
              });
            }
          })
          .catch((err) =>
            this.logger.error(
              { err },
              "Faction knowledge server discovery error",
            ),
          );
      }

      return {
        success: true,
        serverId: server.id,
        accessLevel: accessCheck.accessLevel,
        message: `Connected to ${server.name}`,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err, context: "Connect to server" }, `[Connect to server] ${err.message}`);
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
    await safeExecute({
      fn: async () => {
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
      },
      context: "Disconnect from server",
      logger: this.logger,
      rethrow: true,
    })();
  }

  /**
   * Get active connections for a player
   * @param userId - User ID
   * @returns Array of active server connections
   */
  public async getActiveConnections(
    userId: string,
  ): Promise<ServerConnection[]> {
    return (await safeExecute({
      fn: () => this.prisma.serverConnection.findMany({
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
      }),
      context: "Get active connections",
      logger: this.logger,
      rethrow: true,
    })()) as ServerConnection[];
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
    return (await safeExecute({
      fn: () => this.prisma.serverConnection.findMany({
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
      }),
      context: "Get connection history",
      logger: this.logger,
      rethrow: true,
    })()) as ServerConnection[];
  }

  /**
   * Calculate security level for a server
   * @param server - Game server
   * @returns Security level details
   */
  public calculateSecurityLevel(server: GameServer): SecurityLevel {
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
    return (await safeExecute({
      fn: async () => {
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
      },
      context: "Check server access",
      logger: this.logger,
      fallback: { canAccess: false, accessLevel: 0, reason: "Error checking access" } as AccessCheck,
    })()) ?? { canAccess: false, accessLevel: 0, reason: "Error checking access" };
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
    await safeExecute({
      fn: async () => {
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
      },
      context: "Trigger security alert",
      logger: this.logger,
      rethrow: true,
    })();
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
    await safeExecute({
      fn: async () => {
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
      },
      context: "Update server state",
      logger: this.logger,
      rethrow: true,
    })();
  }

  /**
   * Get current server state
   * @param serverId - Server ID
   * @returns Server state
   */
  public async getServerState(serverId: string): Promise<ServerState> {
    return (await safeExecute({
      fn: async () => {
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
      },
      context: "Get server state",
      logger: this.logger,
      rethrow: true,
    })()) as ServerState;
  }

  // ==================== PRIVATE HELPER METHODS ====================

  /**
   * Get count of active connections to a server
   * @param serverId - Server ID
   * @returns Connection count
   */
  private async getActiveConnectionCount(serverId: string): Promise<number> {
    return (await safeExecute({
      fn: () => this.prisma.serverConnection.count({
        where: {
          serverId,
          isActive: true,
        },
      }),
      context: "Get connection count",
      logger: this.logger,
      fallback: 0,
    })()) ?? 0;
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
    await safeExecute({
      fn: () => this.prisma.auditLog.create({
        data: {
          userId: userId === "system" ? null : userId,
          action,
          resource: "SERVER",
          metadata: details as any,
          timestamp: new Date(),
        },
      }),
      context: "Server audit log",
      logger: this.logger,
      silent: true,
    })();
  }
}

export default ServerService;
