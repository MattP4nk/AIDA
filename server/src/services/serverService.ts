import { GameServer, ServerConnection } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { Logger } from "pino";
import { db } from "../database/client";
import { injectable, inject } from "tsyringe";
import { BACKDOOR_SERVICE, CACHE_SERVICE, CONTENT_QUEUE_SERVICE, FACTION_KNOWLEDGE_SERVICE, LOGGER, MISSION_INTEGRATION_SERVICE, PLAYER_PROGRESS_REPOSITORY, SOCKET_IO } from "../di/tokens";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";
import type { CacheService } from "./cacheService";
import type MissionIntegrationService from "./missionIntegration";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import { safeExecute } from "../utils/safeExecute";

import type { ContentQueueService } from "./contentQueueService";
// ==================== ACCESS BALANCE ====================
// Grounded in the shipped data: GameServer.encryptionLevel spans 0..5 across
// all 44 servers, ServerLink.requiredAccess gates on 0 / 2 / 3 / 5, and a new
// player starts at level 1 with hacking 10 (schema defaults).

/** Player levels required per point of server encryption. enc 0→1, 3→6, 5→10. */
const LEVEL_PER_ENCRYPTION = 2;

/** Hacking skill needed per point of access level, before encryption is subtracted. */
const HACKING_PER_ACCESS_LEVEL = 10;

/** Upper bound on access level. Matches the `Math.min(10, …)` this replaces. */
const MAX_ACCESS_LEVEL = 10;

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, n));

/**
 * Server state interface
 */
// A2 — NAME COLLISION, NOT A DUPLICATE. Do not "reconcile" this with
// `shared/types/game.ts`'s ServerState: that one is
// {serverId, connectedPlayers[], isOnline, lastUpdate, activeConnections} —
// a presence record. This is live load telemetry. They share a name and
// nothing else; merging them would break both.
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
  // `string | null`, not `string | undefined`: the implementation already
  // does `data.ownerId ?? null`, and the NPC-ownership resolver returns
  // `string | null`. The narrower declaration just moved the mismatch out of
  // the compiler's reach at every `getService<any>` call site.
  ownerId?: string | null;
  encryptionLevel?: number;
  accessRules?: any[];
  maxConnections?: number;
}

/**
 * Every column an update may touch.
 *
 * Mirrors what the admin PUT route accepts. It is deliberately wider than
 * `CreateServerData`: creation has defaults for most of these, editing does
 * not, and the narrower type was the reason the route bypassed the service.
 */
interface UpdateServerData {
  name?: string;
  ipAddress?: string;
  type?: string;
  role?: string;
  networkId?: string | null;
  factionId?: string | null;
  ownerId?: string | null;
  securityLevel?: number;
  firewallLevel?: number;
  encryptionLevel?: number;
  discoveryLevel?: number;
  isPublic?: boolean;
  accessMethod?: string;
  accessKey?: string | null;
  isOnline?: boolean;
  maxConnections?: number;
  description?: string;
  motd?: string;
  accessRules?: unknown[];
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
    @inject(PLAYER_PROGRESS_REPOSITORY)
    private playerProgress: PlayerProgressRepository,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
    // INJECTED, not set later. `setSocketIO()` existed and had ZERO callers, so
    // `this.io` was permanently null and all 9 socket emits in this service —
    // server:discovered / alert / created / deleted / updated / disconnected —
    // could never reach a client. Found by driving a real subnet sweep: the
    // process completed and nothing arrived.
    //
    // A setter that must be remembered is a setter that gets forgotten; taking it
    // from the container (as memoryService does) removes the failure mode rather
    // than adding one more call site to forget.
    @inject(SOCKET_IO) io?: SocketIOServer,
  ) {
    this.missionIntegration = missionIntegrationService || null;
    this.factionKnowledge = factionKnowledgeService || null;
    this.io = io || null;
    this.logger.info("ServerService initialized");
  }

  // REMOVED 2026-10-07: `setSocketIO`. Zero callers — `io` is injected, as the
  // constructor note above explains at length. Keeping it contradicted that
  // note: "a setter that must be remembered is a setter that gets forgotten".


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

        // NO EMIT. `createServer`'s only caller is `serverContentService`, which
        // passes the NPC owner from `resolveNpcOwnerId` — so `player:<ownerId>`
        // is a room no socket has ever joined, and this emitted into it on
        // every generated server. Unlike its update/delete siblings it is not
        // worth routing to the owner either: nobody needs telling that a server
        // they do not know about was generated.

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
            const contentQueue = getService<ContentQueueService>(CONTENT_QUEUE_SERVICE);
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
  /**
   * Update a server. THE one path — the admin route delegates here.
   *
   * It used to take `Partial<CreateServerData>`, which covers seven fields,
   * while the admin PUT route edits sixteen. So the route could not delegate
   * without silently dropping most of what an admin had just typed, and
   * instead re-implemented the update inline against raw Prisma — skipping the
   * cache invalidation and the audit log below. Every admin server edit left a
   * stale `server:<id>` cache entry and no audit record.
   *
   * Widening the parameter is what makes delegation possible, so the fix is
   * here rather than a second copy of `cacheService.del` in the route. Same
   * shape as the `rejectDraft` consolidation: two implementations of one
   * transition, only one of which logged.
   */
  public async updateServer(
    serverId: string,
    updates: UpdateServerData,
  ): Promise<ServerDetails> {
    return (await safeExecute({
      fn: async () => {
        const existingServer = await this.prisma.gameServer.findUnique({
          where: { id: serverId },
        });

        if (!existingServer) {
          throw new Error("Server not found");
        }

        // Every editable column, applied only when the caller supplied it.
        //
        // `!== undefined` rather than truthiness for everything that can
        // legitimately be 0, false or "": `securityLevel: 0`, `isPublic:
        // false` and `isOnline: false` would all be silently ignored by a
        // truthy check, which is how a "nothing happened" admin bug hides.
        const updateData: Record<string, unknown> = {};
        const assign = <K extends keyof UpdateServerData>(key: K, column = key as string) => {
          if (updates[key] !== undefined) updateData[column] = updates[key];
        };
        assign("name");
        assign("ipAddress");
        assign("type");
        assign("role");
        assign("networkId");
        assign("factionId");
        assign("securityLevel");
        assign("firewallLevel");
        assign("encryptionLevel");
        assign("discoveryLevel");
        assign("isPublic");
        assign("accessMethod");
        assign("accessKey");
        assign("isOnline");
        assign("maxConnections");
        assign("description");
        assign("motd");
        if (updates.accessRules) updateData.accessRules = updates.accessRules as never;

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

        await this.notifyServerOwner(
          existingServer.ownerId,
          "Server Modified",
          `An administrator modified your server "${server.name}".`,
          server.id,
        );

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

        // Release passive drains BEFORE the delete: Backdoor cascades off
        // GameServer, so after this point nothing can say whose resources the
        // backdoors on this server were costing.
        try {
          const { getService } = await import("../di/container");
          const backdoors =
            getService<import("./backdoorService").default>(BACKDOOR_SERVICE);
          await backdoors.releaseDrainsForServers([serverId]);
        } catch (err) {
          this.logger.warn({ err, serverId }, "Could not release backdoor drains");
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

        await this.notifyServerOwner(
          server.ownerId,
          "Server Removed",
          `An administrator removed your server "${server.name}".`,
          server.id,
        );
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

        const newDiscoveries = servers.length;
        if (newDiscoveries > 0) {
          await this.playerProgress
            .incrementCounter(userId, "serversDiscovered", newDiscoveries)
            .catch(() => {});
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

        // Emit the SAME event the other discovery path uses.
        //
        // This used to emit `server:subnet-scan` with `{count, prefix}` — an
        // event no client has ever listened for, and one my contract check could
        // not even see (its regex did not allow hyphens). Meanwhile the client's
        // discovery handler listens for `server:discovered` with
        // `{count, subnet, servers}`, which is only emitted by `discoverServers`
        // — and that is reached solely from the sweep's dead no-resource fallback.
        //
        // So the live path emitted an event nobody heard, and the event the
        // client heard was emitted only from a path that never runs. One name and
        // one shape for one concept.
        if (this.io) {
          this.io.to(`player:${userId}`).emit("server:discovered", {
            count: servers.length,
            subnet: ipPrefix,
            servers: servers.slice(0, 5).map((s) => ({
              id: s.id,
              name: s.name,
              ipAddress: s.ipAddress,
            })),
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

      // ── D10: close the connection the player is leaving ──────────────────
      // A player is on exactly ONE server at a time: `session.currentServerId`
      // is singular and `connectPlayerToServer` unconditionally disconnects the
      // previous one. But that in-memory disconnect never touched these ROWS —
      // `disconnectFromServer` is the only thing that does, and `connect <ip>`
      // never called it. So every hop left the previous server's row
      // `is_active`, and they accumulated forever. Measured on the live DB
      // before this fix: 95 of 95 rows active, `disconnected_at` null on every
      // one, and every player holding 3 simultaneously "active" servers.
      //
      // That is what made `fragment.steal`'s unscoped `findFirst({ isActive })`
      // able to pick a server the player was not standing on.
      //
      // The servers being LEFT need their count resynced too. Only
      // `syncConnectionCount(server.id)` ran below, so the abandoned server kept
      // a phantom occupant until some unrelated player happened to connect to
      // or disconnect from it — which directly contradicted this method's own
      // claim that the derived count "cannot drift".
      const leaving = await this.prisma.serverConnection.findMany({
        where: { userId, isActive: true, serverId: { not: server.id } },
        select: { serverId: true },
        distinct: ["serverId"],
      });
      await this.prisma.serverConnection.updateMany({
        where: { userId, isActive: true, serverId: { not: server.id } },
        data: { isActive: false, disconnectedAt: new Date() },
      });
      for (const { serverId: leftId } of leaving) {
        await this.syncConnectionCount(leftId);
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
        // The body of this update used to be entirely commented out, which is
        // why reconnecting kept a STALE accessLevel. Take the max rather than
        // overwriting: `canAccessServer` derives a level from skill vs
        // encryption, while `hackService` writes an EARNED one — a plain
        // assignment would silently demote a player who had hacked their way to
        // a higher level than travelling there grants.
        const mergedAccess = Math.max(
          existingConnection.accessLevel,
          accessCheck.accessLevel,
        );
        await this.prisma.serverConnection.update({
          where: { id: existingConnection.id },
          data: {
            accessLevel: mergedAccess,
            sessionData: { accessLevel: mergedAccess } as any,
            // connectedAt deliberately NOT refreshed — it is the arrival time.
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

      // D10: derive the count instead of incrementing it. See syncConnectionCount.
      await this.syncConnectionCount(server.id);

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

          // D10: derive, don't decrement. See syncConnectionCount.
          await this.syncConnectionCount(serverId);

          // Audit log
          await this.auditLog(userId, "SERVER_DISCONNECTED", {
            serverId,
            connectionDuration: Date.now() - connection.connectedAt.getTime(),
          });

          // `server:disconnected` DELETED 2026-10-07. No listener anywhere,
          // and both callers are command paths that say so themselves:
          // networkCommands:996 returns "Returned to home server." and
          // :1292 returns "Disconnected. Returned to home server."
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

        // You always have full access to your own machine.
        //
        // This bypass is REQUIRED now that encryption actually gates access:
        // registration creates the home server with encryptionLevel 1
        // (routes/auth.ts:116) while the player starts at level 1, so without
        // it the level check below would lock every new player out of their own
        // home server on their first connect.
        if (server.ownerId === userId) {
          return {
            canAccess: true,
            accessLevel: MAX_ACCESS_LEVEL,
            reason: "Owner access",
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

        // Check if player's level is sufficient.
        //
        // Was `Math.floor(encryptionLevel / 20)`. encryptionLevel is a small
        // int — 0..5 across every server currently in the game — so the
        // division always yielded 0 and `Math.max(1, 0)` pinned the requirement
        // at 1 for every server in existence. Encryption had no gating effect
        // whatsoever.
        const playerLevel = progress.level;
        const requiredLevel = Math.max(
          1,
          server.encryptionLevel * LEVEL_PER_ENCRYPTION,
        );

        if (playerLevel < requiredLevel) {
          return {
            canAccess: false,
            accessLevel: 0,
            reason: `Insufficient level. Required: ${requiredLevel}, Current: ${playerLevel}`,
            requirements: [`Level ${requiredLevel} or higher`],
          };
        }

        // Calculate access level from hacking skill *relative to* encryption.
        //
        // Was `hacking / Math.max(1, encryptionLevel / 10) * 5`. With
        // encryptionLevel ≤ 10 the divisor `max(1, ≤1)` was always exactly 1,
        // so this reduced to `hacking * 5` — a starting player (hacking 10)
        // scored 50, clamped to the maximum 10, on *every* server including the
        // most encrypted one. Encryption was subtracted from nothing.
        const hackingSkill = progress.hacking || 0;
        const accessLevel = clamp(
          Math.floor(hackingSkill / HACKING_PER_ACCESS_LEVEL) -
            server.encryptionLevel,
          0,
          MAX_ACCESS_LEVEL,
        );

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
  /**
   * D10 — make `GameServer.currentConnections` derived state with ONE writer.
   *
   * It previously had two writers running on the same `connect`, with
   * incompatible models:
   *   - this service, `{ increment: 1 }` / `{ decrement: 1 }` (a delta), and
   *   - `gameStateManager`, `= serverState.activeConnections`, an ABSOLUTE
   *     write from an in-memory Map that starts empty on every boot.
   *
   * The absolute write runs last in the connect flow, so it won. That is why
   * the live DB showed `current_connections = 0` on servers holding 33-38
   * active connection rows: the process had restarted and the in-memory map had
   * forgotten. Two writers, one amnesiac, and the delta arithmetic the audit
   * flagged never even got to matter.
   *
   * Counting is cheap and cannot drift, so both paths now call this.
   *
   * NOTE this is a DISPLAY value: `maxConnections` is not enforced anywhere
   * (`networkCommands` and `adminCommands` only render `current/max`), so the
   * drift was cosmetic — it did not lock anyone out.
   */
  public async syncConnectionCount(serverId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        const count = await this.getActiveConnectionCount(serverId);
        await this.prisma.gameServer.update({
          where: { id: serverId },
          data: { currentConnections: count },
        });
      },
      context: "Sync server connection count",
      logger: this.logger,
    })();
  }

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
   * Tell a server's owner that an admin changed it — if the owner is a player.
   *
   * These were socket emits to `player:<ownerId>` with no client listener. That
   * was harmless while `updateServer`/`deleteServer` had zero callers, and
   * STOPPED being harmless on 2026-10-06 when the admin routes were made to
   * delegate here: `GameServer.ownerId` can be a real player (home servers) and
   * the admin route accepts any id, so the emit started firing at players who
   * had nothing listening. A fix made a dead emit live.
   *
   * `notifyUser` rather than a socket event plus a new client listener: it
   * persists, so an admin acting while the player is offline still reaches
   * them, which matters more here than for ambient events — someone changed
   * their property.
   *
   * NPC owners are skipped. Most servers are owned by the NPC resolved in
   * `resolveNpcOwnerId`, and writing notification rows for accounts that never
   * log in is pure waste.
   */
  private async notifyServerOwner(
    ownerId: string | null,
    title: string,
    message: string,
    serverId: string,
  ): Promise<void> {
    if (!ownerId) return;
    try {
      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { role: true },
      });
      if (!owner || owner.role === "npc") return;
      const { notifyUser } = await import("../utils/notify");
      await notifyUser(this.io, ownerId, {
        type: "admin_action",
        category: "system",
        title,
        message,
        priority: "high",
        data: { serverId },
      });
    } catch (err) {
      this.logger.warn({ err, ownerId, serverId }, "Could not notify server owner");
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
