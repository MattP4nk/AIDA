import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import {
  PRISMA_CLIENT,
  LOGGER,
  CACHE_SERVICE,
  FACTION_KNOWLEDGE_SERVICE,
} from "../di/tokens";
import { CacheService } from "./cacheService";
import type { FactionKnowledgeService } from "./factionKnowledgeService";

// ── Types ──────────────────────────────────────────────────────────────────

export interface AdjacentServer {
  serverId: string;
  serverName: string;
  serverIp: string;
  serverType: string;
  serverRole: string;
  securityLevel: number;
  networkId: string | null;
  networkName: string | null;
  isPublic: boolean;
  accessMethod: string;
  link: {
    id: string;
    linkType: string;
    latency: number;
    bandwidth: number;
    requiredAccess: number;
    direction: "outbound" | "inbound";
  };
}

export interface TraversalCheck {
  allowed: boolean;
  reason: string;
  linkId?: string;
  linkType?: string;
}

export interface PathHop {
  serverId: string;
  serverName: string;
  serverIp: string;
  serverRole: string;
  linkType: string;
  latency: number;
}

export interface DiscoveryResult {
  server: AdjacentServer;
  isNew: boolean; // true if this link was just discovered
}

export interface TopologyNode {
  serverId: string;
  serverName: string;
  serverIp: string;
  serverRole: string;
  serverType: string;
  securityLevel: number;
  networkName: string | null;
  isCurrentServer: boolean;
}

export interface TopologyEdge {
  fromId: string;
  toId: string;
  linkType: string;
  latency: number;
}

export interface TopologyView {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

// ── Service ────────────────────────────────────────────────────────────────

@injectable()
export class NetworkTopologyService {
  private static readonly ADJ_CACHE_TTL = 30; // 30s adjacency cache
  private static readonly PATH_CACHE_TTL = 30;

  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(CACHE_SERVICE) private cacheService: CacheService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    this.factionKnowledge = factionKnowledgeService || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Adjacency
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get all servers directly linked to the given server (both directions).
   */
  async getAdjacentServers(serverId: string): Promise<AdjacentServer[]> {
    const cacheKey = `topo:adj:${serverId}`;
    const cached = this.cacheService.get<AdjacentServer[]>(cacheKey);
    if (cached) return cached;

    // Outbound links (this server → target)
    const outLinks = await this.prisma.serverLink.findMany({
      where: { sourceId: serverId, isActive: true },
      include: {
        target: { include: { network: true } },
      },
    });

    // Inbound links (source → this server) — traversable in reverse
    const inLinks = await this.prisma.serverLink.findMany({
      where: { targetId: serverId, isActive: true },
      include: {
        source: { include: { network: true } },
      },
    });

    const result: AdjacentServer[] = [];

    for (const link of outLinks) {
      result.push({
        serverId: link.target.id,
        serverName: link.target.name,
        serverIp: link.target.ipAddress,
        serverType: link.target.type,
        serverRole: link.target.role,
        securityLevel: link.target.securityLevel,
        networkId: link.target.networkId,
        networkName: link.target.network?.name || null,
        isPublic: link.target.isPublic,
        accessMethod: link.target.accessMethod,
        link: {
          id: link.id,
          linkType: link.linkType,
          latency: link.latency,
          bandwidth: link.bandwidth,
          requiredAccess: link.requiredAccess,
          direction: "outbound",
        },
      });
    }

    for (const link of inLinks) {
      // Avoid duplicates if bidirectional links exist
      if (result.some((r) => r.serverId === link.source.id)) continue;

      result.push({
        serverId: link.source.id,
        serverName: link.source.name,
        serverIp: link.source.ipAddress,
        serverType: link.source.type,
        serverRole: link.source.role,
        securityLevel: link.source.securityLevel,
        networkId: link.source.networkId,
        networkName: link.source.network?.name || null,
        isPublic: link.source.isPublic,
        accessMethod: link.source.accessMethod,
        link: {
          id: link.id,
          linkType: link.linkType,
          latency: link.latency,
          bandwidth: link.bandwidth,
          requiredAccess: link.requiredAccess,
          direction: "inbound",
        },
      });
    }

    this.cacheService.set(cacheKey, result, NetworkTopologyService.ADJ_CACHE_TTL);
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Traversal
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a player can traverse from one server to another.
   * Checks: link exists, link is active, player meets access requirement.
   */
  async canTraverse(
    userId: string,
    fromServerId: string,
    toServerId: string,
  ): Promise<TraversalCheck> {
    // Check for direct link in either direction
    const link = await this.prisma.serverLink.findFirst({
      where: {
        isActive: true,
        OR: [
          { sourceId: fromServerId, targetId: toServerId },
          { sourceId: toServerId, targetId: fromServerId },
        ],
      },
    });

    if (!link) {
      return { allowed: false, reason: "No direct route between these servers." };
    }

    // Check access requirement
    if (link.requiredAccess > 0) {
      const connection = await this.prisma.serverConnection.findFirst({
        where: {
          userId,
          serverId: fromServerId,
          isActive: true,
        },
        select: { accessLevel: true },
      });

      const playerAccess = connection?.accessLevel ?? 0;
      if (playerAccess < link.requiredAccess) {
        return {
          allowed: false,
          reason: `Insufficient access level on current server (have ${playerAccess}, need ${link.requiredAccess}).`,
        };
      }
    }

    return {
      allowed: true,
      reason: "Route available.",
      linkId: link.id,
      linkType: link.linkType,
    };
  }

  /**
   * Check if a player can bypass topology via an active backdoor.
   */
  async resolveBackdoorBypass(
    userId: string,
    targetServerId: string,
  ): Promise<boolean> {
    const backdoor = await this.prisma.backdoor.findFirst({
      where: {
        installerId: userId,
        serverId: targetServerId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    return !!backdoor;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Pathfinding
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * BFS shortest path between two servers through the link graph.
   * Returns the hop sequence, or null if unreachable.
   */
  async findPath(
    fromServerId: string,
    toServerId: string,
  ): Promise<PathHop[] | null> {
    const cacheKey = `topo:path:${fromServerId}:${toServerId}`;
    const cached = this.cacheService.get<PathHop[] | null>(cacheKey);
    if (cached !== undefined) return cached;

    // Build adjacency map from all active links
    const allLinks = await this.prisma.serverLink.findMany({
      where: { isActive: true },
      include: {
        source: true,
        target: true,
      },
    });

    // Bidirectional adjacency
    const adj = new Map<string, Array<{ serverId: string; linkType: string; latency: number; serverName: string; serverIp: string; serverRole: string }>>();

    for (const link of allLinks) {
      // Forward
      if (!adj.has(link.sourceId)) adj.set(link.sourceId, []);
      adj.get(link.sourceId)!.push({
        serverId: link.targetId,
        linkType: link.linkType,
        latency: link.latency,
        serverName: link.target.name,
        serverIp: link.target.ipAddress,
        serverRole: link.target.role,
      });

      // Reverse
      if (!adj.has(link.targetId)) adj.set(link.targetId, []);
      adj.get(link.targetId)!.push({
        serverId: link.sourceId,
        linkType: link.linkType,
        latency: link.latency,
        serverName: link.source.name,
        serverIp: link.source.ipAddress,
        serverRole: link.source.role,
      });
    }

    // BFS
    const visited = new Set<string>([fromServerId]);
    const parent = new Map<string, { from: string; linkType: string; latency: number; serverName: string; serverIp: string; serverRole: string }>();
    const queue: string[] = [fromServerId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === toServerId) break;

      const neighbors = adj.get(current) || [];
      for (const n of neighbors) {
        if (!visited.has(n.serverId)) {
          visited.add(n.serverId);
          parent.set(n.serverId, {
            from: current,
            linkType: n.linkType,
            latency: n.latency,
            serverName: n.serverName,
            serverIp: n.serverIp,
            serverRole: n.serverRole,
          });
          queue.push(n.serverId);
        }
      }
    }

    if (!parent.has(toServerId)) {
      this.cacheService.set(cacheKey, null, NetworkTopologyService.PATH_CACHE_TTL);
      return null;
    }

    // Reconstruct path
    const path: PathHop[] = [];
    let current = toServerId;
    while (parent.has(current)) {
      const p = parent.get(current)!;
      path.unshift({
        serverId: current,
        serverName: p.serverName,
        serverIp: p.serverIp,
        serverRole: p.serverRole,
        linkType: p.linkType,
        latency: p.latency,
      });
      current = p.from;
    }

    // Add source server as first hop
    const sourceServer = await this.prisma.gameServer.findUnique({
      where: { id: fromServerId },
      select: { name: true, ipAddress: true, role: true },
    });
    if (sourceServer) {
      path.unshift({
        serverId: fromServerId,
        serverName: sourceServer.name,
        serverIp: sourceServer.ipAddress,
        serverRole: sourceServer.role,
        linkType: "origin",
        latency: 0,
      });
    }

    this.cacheService.set(cacheKey, path, NetworkTopologyService.PATH_CACHE_TTL);
    return path;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Discovery
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Discover adjacent servers from current position. Creates DiscoveredLink
   * records for newly found links. Feeds faction knowledge.
   *
   * @param scanLevel - Player's networking skill level (higher = discover more)
   * @returns List of discovered servers with isNew flag
   */
  async discoverNeighbors(
    userId: string,
    serverId: string,
    scanLevel: number,
  ): Promise<DiscoveryResult[]> {
    const adjacent = await this.getAdjacentServers(serverId);

    // Filter by discovery difficulty and visibility
    const discoverable = adjacent.filter((a) => {
      // Private servers don't show in scan — must discover IP through files/intel
      if (!a.isPublic) return false;
      // Hidden links require higher skill
      if (a.link.linkType === "hidden" && scanLevel < 30) return false;
      // VPN links require moderate skill
      if (a.link.linkType === "vpn" && scanLevel < 15) return false;
      return true;
    });

    const results: DiscoveryResult[] = [];

    for (const server of discoverable) {
      // Check if already discovered
      const existing = await this.prisma.discoveredLink.findUnique({
        where: {
          userId_linkId: { userId, linkId: server.link.id },
        },
      });

      const isNew = !existing;

      if (isNew) {
        await this.prisma.discoveredLink.create({
          data: {
            userId,
            linkId: server.link.id,
            source: "scan",
          },
        });

        // Feed faction knowledge
        if (this.factionKnowledge) {
          this.factionKnowledge
            .getPlayerFactionId(userId)
            .then((factionId) => {
              if (factionId) {
                this.factionKnowledge!.addEntry(factionId, {
                  assetType: "server",
                  assetId: server.serverId,
                  assetMeta: {
                    name: server.serverName,
                    ip: server.serverIp,
                    serverType: server.serverType,
                    role: server.serverRole,
                    securityLevel: server.securityLevel,
                    networkName: server.networkName,
                    discoveredFrom: serverId,
                  },
                  source: "server_discovery",
                  confidence: 0.7,
                  discoveredBy: userId,
                });
              }
            })
            .catch((err) =>
              this.logger.error({ err }, "Faction knowledge topology discovery error"),
            );
        }
      }

      results.push({ server, isNew });
    }

    this.logger.debug(
      { userId, serverId, total: results.length, new: results.filter((r) => r.isNew).length },
      "Topology neighbor discovery",
    );

    return results;
  }

  /**
   * Auto-discover links along a path (used by traceroute).
   */
  async discoverPath(userId: string, path: PathHop[]): Promise<void> {
    for (let i = 0; i < path.length - 1; i++) {
      const fromId = path[i]!.serverId;
      const toId = path[i + 1]!.serverId;

      const link = await this.prisma.serverLink.findFirst({
        where: {
          OR: [
            { sourceId: fromId, targetId: toId },
            { sourceId: toId, targetId: fromId },
          ],
        },
      });

      if (link) {
        await this.prisma.discoveredLink.upsert({
          where: { userId_linkId: { userId, linkId: link.id } },
          create: { userId, linkId: link.id, source: "traceroute" },
          update: {},
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Player Topology View
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Get the player's discovered subgraph centered on their current server.
   * Returns nodes and edges up to `depth` hops away.
   */
  async getPlayerTopology(
    userId: string,
    currentServerId: string,
    depth: number = 2,
  ): Promise<TopologyView> {
    // Get all links the player has discovered
    const discoveredLinks = await this.prisma.discoveredLink.findMany({
      where: { userId },
      include: {
        link: {
          include: {
            source: { include: { network: true } },
            target: { include: { network: true } },
          },
        },
      },
    });

    // Build a set of known server IDs and edges
    const knownServers = new Map<string, TopologyNode>();
    const edges: TopologyEdge[] = [];

    for (const dl of discoveredLinks) {
      const link = dl.link;

      const addServer = (s: any) => {
        if (!knownServers.has(s.id)) {
          knownServers.set(s.id, {
            serverId: s.id,
            serverName: s.name,
            serverIp: s.ipAddress,
            serverRole: s.role,
            serverType: s.type,
            securityLevel: s.securityLevel,
            networkName: s.network?.name || null,
            isCurrentServer: s.id === currentServerId,
          });
        }
      };

      addServer(link.source);
      addServer(link.target);

      edges.push({
        fromId: link.sourceId,
        toId: link.targetId,
        linkType: link.linkType,
        latency: link.latency,
      });
    }

    // Filter to depth hops from current server using BFS
    if (depth > 0 && knownServers.size > 0) {
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        if (!adj.has(e.fromId)) adj.set(e.fromId, []);
        if (!adj.has(e.toId)) adj.set(e.toId, []);
        adj.get(e.fromId)!.push(e.toId);
        adj.get(e.toId)!.push(e.fromId);
      }

      const reachable = new Set<string>([currentServerId]);
      let frontier = [currentServerId];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const node of frontier) {
          for (const neighbor of adj.get(node) || []) {
            if (!reachable.has(neighbor)) {
              reachable.add(neighbor);
              next.push(neighbor);
            }
          }
        }
        frontier = next;
      }

      // Filter to reachable nodes
      const filteredNodes = [...knownServers.values()].filter((n) =>
        reachable.has(n.serverId),
      );
      const reachableSet = new Set(filteredNodes.map((n) => n.serverId));
      const filteredEdges = edges.filter(
        (e) => reachableSet.has(e.fromId) && reachableSet.has(e.toId),
      );

      return { nodes: filteredNodes, edges: filteredEdges };
    }

    return { nodes: [...knownServers.values()], edges };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Link Management
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Create a bidirectional link between two servers.
   * Creates two ServerLink records (A→B and B→A).
   */
  async createBidirectionalLink(
    sourceId: string,
    targetId: string,
    options: {
      networkId?: string;
      linkType?: string;
      latency?: number;
      bandwidth?: number;
      requiredAccess?: number;
    } = {},
  ): Promise<void> {
    const data = {
      networkId: options.networkId || null,
      linkType: options.linkType || "lan",
      latency: options.latency || 10,
      bandwidth: options.bandwidth || 100,
      requiredAccess: options.requiredAccess || 0,
    };

    await this.prisma.serverLink.upsert({
      where: { sourceId_targetId: { sourceId, targetId } },
      create: { sourceId, targetId, ...data },
      update: data,
    });

    await this.prisma.serverLink.upsert({
      where: { sourceId_targetId: { sourceId: targetId, targetId: sourceId } },
      create: { sourceId: targetId, targetId: sourceId, ...data },
      update: data,
    });

    // Invalidate adjacency cache
    this.cacheService.del(`topo:adj:${sourceId}`);
    this.cacheService.del(`topo:adj:${targetId}`);
  }

  /**
   * Create a link from player's home server to the Internet Exchange.
   * Called on player registration / home server creation.
   */
  async createHomeLink(homeServerId: string): Promise<void> {
    // Find the Internet Exchange server
    const exchange = await this.prisma.gameServer.findFirst({
      where: { role: "router", networkId: null, name: { contains: "Internet Exchange" } },
    });

    if (!exchange) {
      this.logger.warn("Internet Exchange not found — cannot link home server");
      return;
    }

    await this.createBidirectionalLink(homeServerId, exchange.id, {
      linkType: "wan",
      latency: 50,
      bandwidth: 50,
    });

    this.logger.debug({ homeServerId, exchangeId: exchange.id }, "Home server linked to Internet Exchange");
  }

  /**
   * Get the number of hops from the Internet Exchange to a server.
   * Used for mission difficulty scaling.
   */
  async getNetworkDepth(serverId: string): Promise<number> {
    const exchange = await this.prisma.gameServer.findFirst({
      where: { role: "router", networkId: null, name: { contains: "Internet Exchange" } },
      select: { id: true },
    });

    if (!exchange) return 0;

    const path = await this.findPath(exchange.id, serverId);
    return path ? path.length - 1 : 0; // -1 because path includes source
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Server Access Control
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a player can access a server based on its accessMethod.
   * Returns: { allowed, reason, requiresHack, requiresKey }
   */
  async checkServerAccess(
    userId: string,
    serverId: string,
  ): Promise<{ allowed: boolean; reason: string; requiresHack: boolean; requiresKey: boolean }> {
    const server = await this.prisma.gameServer.findUnique({
      where: { id: serverId },
      select: { accessMethod: true, accessKey: true, name: true, isPlayerHome: true, ownerId: true },
    });

    if (!server) {
      return { allowed: false, reason: "Server not found.", requiresHack: false, requiresKey: false };
    }

    // Owner and home servers — always accessible
    if (server.isPlayerHome || server.ownerId === userId) {
      return { allowed: true, reason: "Owner access.", requiresHack: false, requiresKey: false };
    }

    switch (server.accessMethod) {
      case "open":
        return { allowed: true, reason: "Open access.", requiresHack: false, requiresKey: false };

      case "hackable":
        // Check if player has previously hacked (has a ServerConnection with accessLevel > 0)
        const hackConnection = await this.prisma.serverConnection.findFirst({
          where: { userId, serverId, accessLevel: { gt: 0 } },
        });
        if (hackConnection) {
          return { allowed: true, reason: "Previously hacked.", requiresHack: false, requiresKey: false };
        }
        return { allowed: false, reason: `${server.name} requires hacking to gain access. Use 'hack ${serverId}'.`, requiresHack: true, requiresKey: false };

      case "keycard": {
        const hasKey = await this.playerHasAccessKey(userId, serverId);
        if (hasKey) {
          return { allowed: true, reason: "Access key verified.", requiresHack: false, requiresKey: false };
        }
        return { allowed: false, reason: `${server.name} requires an access key. Find it in server files or earn it from missions.`, requiresHack: false, requiresKey: true };
      }

      case "hack_or_key": {
        const hasKeyOrHack = await this.playerHasAccessKey(userId, serverId);
        if (hasKeyOrHack) {
          return { allowed: true, reason: "Access key verified.", requiresHack: false, requiresKey: false };
        }
        const hackConn = await this.prisma.serverConnection.findFirst({
          where: { userId, serverId, accessLevel: { gt: 0 } },
        });
        if (hackConn) {
          return { allowed: true, reason: "Previously hacked.", requiresHack: false, requiresKey: false };
        }
        return { allowed: false, reason: `${server.name} requires an access key or hacking. Find a key in server files or use 'hack'.`, requiresHack: true, requiresKey: true };
      }

      default:
        return { allowed: true, reason: "Default access.", requiresHack: false, requiresKey: false };
    }
  }

  /**
   * Check if a player has a stored access key for a server.
   */
  async playerHasAccessKey(userId: string, serverId: string): Promise<boolean> {
    const key = await this.prisma.serverAccessKey.findUnique({
      where: { userId_serverId: { userId, serverId } },
    });
    return !!key;
  }

  /**
   * Grant a player an access key for a server.
   * Called when a player reads a file containing credentials/keys.
   */
  async grantAccessKey(
    userId: string,
    serverId: string,
    keyValue: string,
    source: string,
    sourceDetail?: string,
    sourceFileId?: string,
  ): Promise<boolean> {
    try {
      await this.prisma.serverAccessKey.upsert({
        where: { userId_serverId: { userId, serverId } },
        create: { userId, serverId, keyValue, source, sourceDetail: sourceDetail ?? null, sourceFileId: sourceFileId ?? null },
        update: { keyValue, source, sourceDetail: sourceDetail ?? null, sourceFileId: sourceFileId ?? null },
      });
      this.logger.info({ userId, serverId, source }, "Access key granted to player");
      return true;
    } catch (error) {
      this.logger.error({ error, userId, serverId }, "Failed to grant access key");
      return false;
    }
  }
}

export default NetworkTopologyService;
