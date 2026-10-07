/**
 * Forum discovery, access, live-feed rooms, the proxy network, and honeypots.
 *
 * A8: split out of forumService.ts (3,102 lines). Methods moved verbatim; only
 * calls into another forum domain were re-pointed (`this.x(` -> `this.access.x(`).
 */
import { EventEmitter } from "events";
import { prisma } from "../database/client";
import type { Forum, Post, ForumMember, ProxyConnection } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import type { Server as SocketIOServer } from "socket.io";
import type { Logger } from "pino";
import { safeExecute } from "../utils/safeExecute";
import { KEY_FRAGMENT_SERVICE, LOGGER, REPUTATION_ENGINE, SOCKET_IO } from "../di/tokens";
import type { ReputationEngine } from "./reputationEngine";

export interface ForumWithPosts extends Forum {
  posts: Post[];
  _count?: {
    members: number;
    posts: number;
  };
}

export interface ProxyServer {
  id: string;
  name: string;
  location: string;
  status: "active" | "offline";
  anonymityLevel: number; // 1-5
  speed: "slow" | "medium" | "fast";
}

export interface ForumAccessResult {
  forum: ForumWithPosts;
  posts: Post[];
  isMember: boolean;
  requiresProxy: boolean;
  isHoneypot: boolean;
  canPost: boolean;
}

export interface ScanResult {
  forums: Forum[];
  newDiscoveries: number;
  requiresHigherSkills: string[];
}

@injectable()
export class ForumAccessService extends EventEmitter {
  private io: SocketIOServer;

  // Available proxy servers
  private readonly PROXY_SERVERS: ProxyServer[] = [
    {
      id: "proxy1",
      name: "proxy1.onion",
      location: "Unknown",
      status: "active",
      anonymityLevel: 3,
      speed: "medium",
    },
    {
      id: "proxy2",
      name: "relay7.darknet",
      location: "Netherlands",
      status: "active",
      anonymityLevel: 4,
      speed: "fast",
    },
    {
      id: "proxy3",
      name: "anon-gate.tor",
      location: "Switzerland",
      status: "active",
      anonymityLevel: 5,
      speed: "slow",
    },
    {
      id: "proxy4",
      name: "ghost-relay.i2p",
      location: "Germany",
      status: "offline",
      anonymityLevel: 4,
      speed: "medium",
    },
    {
      id: "proxy5",
      name: "stealth-proxy.onion",
      location: "Iceland",
      status: "active",
      anonymityLevel: 5,
      speed: "medium",
    },
  ];

  constructor(
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(LOGGER) private logger: Logger,
  ) {
    super();
    this.io = io;
  }

  /**
   * Scan for available forums based on player skills and proxy usage
   */
  public async scanForForums(
    userId: string,
    useProxy: boolean = false,
  ): Promise<ScanResult> {
    try {
      // Get player's skills to determine what they can find
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      // Get already discovered forums
      const discovered = await prisma.forumDiscovery.findMany({
        where: { userId },
        select: { forumId: true },
      });

      const discoveredIds = discovered.map((d: any) => d.forumId);

      // Determine what security level player can find
      const maxSecurityLevel = this.calculateMaxSecurityLevel(
        progress.networking,
        progress.hacking,
        useProxy,
      );

      // Find forums player can discover
      const availableForums = await prisma.forum.findMany({
        where: {
          isActive: true,
          securityLevel: {
            lte: maxSecurityLevel,
          },
        },
        include: {
          _count: {
            select: {
              members: true,
              posts: true,
            },
          },
        },
      });

      // Separate into discovered and new
      const alreadyDiscovered = availableForums.filter((f: any) =>
        discoveredIds.includes(f.id),
      );

      const newForums = availableForums.filter(
        (f: any) => !discoveredIds.includes(f.id),
      );

      // Mark new forums as discovered
      for (const forum of newForums) {
        await prisma.forumDiscovery.create({
          data: {
            userId,
            forumId: forum.id,
            method: useProxy ? "scan_proxy" : "scan_direct",
          },
        });
      }

      // Get forums that require higher skills
      const higherLevelForums = await prisma.forum.findMany({
        where: {
          isActive: true,
          securityLevel: {
            gt: maxSecurityLevel,
          },
          id: {
            notIn: discoveredIds,
          },
        },
        select: {
          name: true,
          securityLevel: true,
        },
      });

      // `forum:scan-complete` DELETED 2026-10-07 — no listener anywhere, and
      // `scanForForums`'s one caller (socialCommands:583) renders a FORUM SCAN
      // RESULTS box carrying the same counts.

      return {
        forums: [...alreadyDiscovered, ...newForums],
        newDiscoveries: newForums.length,
        requiresHigherSkills: higherLevelForums.map(
          (f: any) => `${f.name} (Level ${f.securityLevel})`,
        ),
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error scanning forums");
      throw error;
    }
  }

  /**
   * Get all forums discovered by user
   */
  public async getDiscoveredForums(userId: string): Promise<Forum[]> {
    try {
      const discoveries = await prisma.forumDiscovery.findMany({
        where: { userId },
        include: {
          forum: {
            include: {
              _count: {
                select: {
                  members: true,
                  posts: true,
                },
              },
            },
          },
        },
        orderBy: {
          discoveredAt: "desc",
        },
      });

      return discoveries.map((d: any) => d.forum);
    } catch (error) {
      this.logger.error({ err: error }, "Error getting discovered forums");
      throw error;
    }
  }

  /**
   * Mark a forum as discovered by user
   */
  public async discoverForum(
    userId: string,
    forumId: string,
    method: string,
  ): Promise<void> {
    try {
      await prisma.forumDiscovery.upsert({
        where: {
          userId_forumId: {
            userId,
            forumId,
          },
        },
        create: {
          userId,
          forumId,
          method,
        },
        update: {},
      });
    } catch (error) {
      this.logger.error({ err: error }, "Error discovering forum");
      throw error;
    }
  }

  // ==================== FORUM ACCESS ====================

  /**
   * Access a forum and get its content
   */
  public async accessForum(
    userId: string,
    forumId: string,
    useProxy: boolean = false,
  ): Promise<ForumAccessResult> {
    try {
      // Get forum
      const forum = await prisma.forum.findUnique({
        where: { id: forumId },
        include: {
          posts: {
            take: 20,
            orderBy: [
              { isSticky: "desc" },
              { isPinned: "desc" },
              { createdAt: "desc" },
            ],
          },
          _count: {
            select: {
              members: true,
              posts: true,
            },
          },
        },
      });

      if (!forum) {
        throw new Error("Forum not found");
      }

      // Check if forum requires proxy
      if (forum.requiresProxy && !useProxy) {
        throw new Error(
          `Forum requires proxy connection. Use 'proxy connect <id>' first or access with --proxy flag`,
        );
      }

      // Check if player has discovered this forum
      const hasDiscovered = await prisma.forumDiscovery.findUnique({
        where: {
          userId_forumId: {
            userId,
            forumId,
          },
        },
      });

      if (!hasDiscovered) {
        // Auto-discover if they somehow got the ID
        await this.discoverForum(userId, forumId, "direct_access");
      }

      // Check membership
      const membership = await prisma.forumMember.findUnique({
        where: {
          userId_forumId: {
            userId,
            forumId,
          },
        },
      });

      const isMember = !!membership;

      // Check if this is a honeypot and player isn't using proxy
      if (forum.isHoneypot && !useProxy) {
        await this.triggerHoneypot(userId, forumId);
      }

      // `forum:accessed` DELETED 2026-10-07 — no listener anywhere, and
      // `accessForum`'s one caller (socialCommands:620) prints the honeypot
      // warning and the proxy requirement inline.

      return {
        forum: forum as ForumWithPosts,
        posts: forum.posts,
        isMember,
        requiresProxy: forum.requiresProxy,
        isHoneypot: forum.isHoneypot,
        canPost: isMember && !forum.isHoneypot,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error accessing forum");
      throw error;
    }
  }

  /**
   * THE rule for who may receive a forum's live feed, as a Prisma predicate.
   *
   * It is not `accessForum`. That one is request-scoped and interactive: it
   * takes a `useProxy` flag and auto-discovers the forum as a side effect, so
   * running it per forum on every authenticate would mutate state and ask a
   * question a socket join cannot answer.
   *
   * `requiresProxy` forums are excluded outright rather than proxy-checked.
   * Room membership is decided at join time while proxy status changes during
   * a session, so there is no answer that stays true; excluding them keeps the
   * live feed from pushing posts `accessForum` would refuse to show. Those
   * forums are still readable interactively, where the proxy check applies.
   *
   * Stated ONCE because it has four consumers — the authenticate-time join,
   * registration, ban and unban. The first version restated it in two of them
   * and the other two had no rule at all, so a mid-session registration
   * subscribed a player to feeds the authenticate path would have refused, and
   * the same player saw them in one session and not the next.
   */
  private static readonly LIVE_FEED_MEMBERSHIP = {
    isBanned: false,
    forum: { isActive: true, requiresProxy: false },
  } as const;

  public async getLiveFeedForums(userId: string): Promise<string[]> {
    const memberships = await prisma.forumMember.findMany({
      where: { userId, ...ForumAccessService.LIVE_FEED_MEMBERSHIP },
      select: { forumId: true },
    });
    return memberships.map((m) => m.forumId);
  }

  /**
   * Make a player's `forum:<forumId>` room membership match the rule above —
   * joining if they now qualify, leaving if they no longer do.
   *
   * Call this after ANYTHING that can change the answer. A flag flipped in the
   * database only gates the paths that re-check it; a socket already in the
   * room keeps receiving posts until it reconnects, which made `banMember`
   * inert for the rest of a session and `unbanMember` inert in the other
   * direction.
   *
   * Over `user:<id>` so every tab is covered — `socket.join` on one socket
   * would leave the player's other tabs subscribed.
   */
  public async syncLiveFeedRoom(userId: string, forumId: string): Promise<void> {
    try {
      const eligible = await prisma.forumMember.findFirst({
        where: { userId, forumId, ...ForumAccessService.LIVE_FEED_MEMBERSHIP },
        select: { id: true },
      });
      const room = `forum:${forumId}`;
      if (eligible) this.io?.in(`user:${userId}`).socketsJoin(room);
      else this.io?.in(`user:${userId}`).socketsLeave(room);
    } catch (err) {
      this.logger.warn({ err, userId, forumId }, "Could not sync forum live-feed room");
    }
  }

  /**
   * Register an account on a forum
   */

  public async registerForumAccount(
    userId: string,
    forumId: string,
    handle: string,
  ): Promise<ForumMember> {
    try {
      // Check if forum exists
      const forum = await prisma.forum.findUnique({
        where: { id: forumId },
      });

      if (!forum) {
        throw new Error("Forum not found");
      }

      // YOU MUST HAVE FOUND IT FIRST.
      //
      // `forum register <forumId> <handle>` takes a raw id from the player, and
      // this enforced nothing beyond existence — so anyone who learned an id,
      // from a post, a leak or a guess, could create an identity on a forum
      // they had never reached. `accessForum` AUTO-discovers rather than
      // refusing, so the legitimate route is unchanged: access it, then
      // register. The error says so, because "Forum not found" for a forum
      // that plainly exists is the kind of message that reads as a bug.
      const discovered = await prisma.forumDiscovery.findUnique({
        where: { userId_forumId: { userId, forumId } },
        select: { id: true },
      });
      if (!discovered) {
        throw new Error(
          "You have not found this forum yet. Access it first to register.",
        );
      }

      // THE PROXY REQUIREMENT, which only `accessForum` enforced.
      //
      // Reading a proxy-only forum needed a proxy; registering an account on
      // one needed nothing. Checked against the LIVE proxy status rather than
      // against `accessForum`'s `useProxy` flag — there is no flag on this
      // path, and status is the stronger question anyway. The two checks are
      // deliberately not shared: one answers "did this request opt into the
      // proxy", the other "is this player actually behind one", and collapsing
      // them would change `accessForum`'s behaviour as a side effect.
      const proxyStatus = await this.getProxyStatus(userId);
      if (forum.requiresProxy && !proxyStatus.connected) {
        throw new Error(
          "Forum requires proxy connection. Use 'proxy connect <id>' first.",
        );
      }

      // Check if honeypot
      if (forum.isHoneypot && !proxyStatus.connected) {
        await this.triggerHoneypot(userId, forumId);
      }

      // Check if already a member
      const existing = await prisma.forumMember.findUnique({
        where: {
          userId_forumId: {
            userId,
            forumId,
          },
        },
      });

      if (existing) {
        throw new Error("Already registered on this forum");
      }

      // Check if handle is taken on this forum
      const handleTaken = await prisma.forumMember.findFirst({
        where: {
          forumId,
          handle,
        },
      });

      if (handleTaken) {
        throw new Error("Handle already taken on this forum");
      }

      // Create membership
      const member = await prisma.forumMember.create({
        data: {
          userId,
          forumId,
          handle,
          reputation: 0,
          postCount: 0,
        },
      });

      // `forum:registered` DELETED 2026-10-07 — no listener anywhere, and
      // `registerForumAccount`'s one caller (socialCommands:702) returns
      // "Successfully registered on forum as '<handle>'".

      // Subscribe to the live feed if — and only if — this membership
      // qualifies. Joining unconditionally here handed the player feeds that
      // the authenticate-time join excludes, so the same forum streamed in
      // this session and went quiet in the next.
      await this.syncLiveFeedRoom(userId, forumId);
      return member;
    } catch (error) {
      this.logger.error({ err: error }, "Error registering forum account");
      throw error;
    }
  }

  // ==================== POST MANAGEMENT ====================

  /**
   * Get list of available proxy servers
   */
  public async listProxyServers(_userId: string): Promise<ProxyServer[]> {
    return this.PROXY_SERVERS;
  }

  /**
   * Connect to a proxy server
   */
  public async connectToProxy(
    userId: string,
    proxyId: string,
  ): Promise<ProxyConnection> {
    try {
      // Find proxy server
      const proxy = this.PROXY_SERVERS.find((p) => p.id === proxyId);

      if (!proxy) {
        throw new Error("Proxy server not found");
      }

      if (proxy.status === "offline") {
        throw new Error("Proxy server is offline");
      }

      // Check if already connected
      const existing = await prisma.proxyConnection.findUnique({
        where: { userId },
      });

      if (existing && existing.active) {
        // Disconnect old, connect new
        await this.disconnectProxy(userId);
      }

      // Create connection (expires in 1 hour)
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1);

      const connection = await prisma.proxyConnection.create({
        data: {
          userId,
          proxyServer: proxy.name,
          location: proxy.location,
          active: true,
          expiresAt,
        },
      });

      // `proxy:connected` DELETED 2026-10-07 — no listener anywhere, and
      // `connectToProxy`'s one caller (socialCommands:1419) renders a PROXY
      // CONNECTED box with Status/Server/Location/Expires, a superset of this.

      return connection;
    } catch (error) {
      this.logger.error({ err: error }, "Error connecting to proxy");
      throw error;
    }
  }

  /**
   * Disconnect from proxy
   */
  public async disconnectProxy(userId: string): Promise<void> {
    try {
      await prisma.proxyConnection.deleteMany({
        where: { userId },
      });

      // `proxy:disconnected` DELETED 2026-10-07 — no listener anywhere, it
      // carried an EMPTY payload, and `disconnectProxy`'s one caller
      // (socialCommands:1447) returns "Disconnected from proxy server".
    } catch (error) {
      this.logger.error({ err: error }, "Error disconnecting proxy");
      throw error;
    }
  }

  /**
   * Get current proxy status
   */
  public async getProxyStatus(userId: string): Promise<{
    connected: boolean;
    proxyServer?: string;
    location?: string;
    expiresAt?: Date;
  }> {
    try {
      const connection = await prisma.proxyConnection.findUnique({
        where: { userId },
      });

      if (!connection || !connection.active) {
        return { connected: false };
      }

      // Check if expired
      if (connection.expiresAt < new Date()) {
        await this.disconnectProxy(userId);
        return { connected: false };
      }

      return {
        connected: true,
        proxyServer: connection.proxyServer,
        location: connection.location,
        expiresAt: connection.expiresAt,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error getting proxy status");
      throw error;
    }
  }

  // ==================== SECURITY & HONEYPOTS ====================

  /**
   * Trigger honeypot detection - player accessed honeypot without proxy
   */
  private async triggerHoneypot(
    userId: string,
    forumId: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const forum = await prisma.forum.findUnique({
          where: { id: forumId },
          include: { faction: true },
        });

        if (!forum) return;

        this.logger.info({ userId, forumName: forum.name }, "Honeypot triggered");

        // Get player's home IP for tracking
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { homeIp: true },
        });

        // Create audit log
        await prisma.auditLog.create({
          data: {
            userId,
            action: "HONEYPOT_TRIGGERED",
            resource: "forum",
            resourceId: forumId,
            ipAddress: user?.homeIp || null,
            metadata: {
              forumName: forum.name,
              factionId: forum.factionId,
              timestamp: new Date(),
            },
          },
        });

        // If forum belongs to a faction, decrease reputation via ReputationEngine.
        // Bind the id to a local first: narrowing from `if (forum.factionId)`
        // does not survive into the async closure below, because TS cannot
        // prove the property is unchanged by the time the callback runs.
        const honeypotFactionId = forum.factionId;
        if (honeypotFactionId) {
          await safeExecute({
            fn: async () => {
              const { getService } = await import("../di/container");
              const reputationEngine = getService<ReputationEngine>(REPUTATION_ENGINE);
              await reputationEngine.onCaughtByFaction(
                userId,
                honeypotFactionId,
                "high",
              );
            },
            context: "Apply honeypot reputation",
            logger: this.logger,
            silent: true,
          })();

        }

        // Emit warning to player
        if (this.io) {
          this.io.to(`user:${userId}`).emit("security:warning", {
            type: "honeypot",
            message:
              "SECURITY ALERT: Your activities have been logged. IP address recorded.",
            forumName: forum.name,
            severity: "high",
          });
        }
      },
      context: "Trigger honeypot",
      logger: this.logger,
    })();
  }

  /**
   * Calculate maximum security level player can discover
   */
  private calculateMaxSecurityLevel(
    networking: number,
    hacking: number,
    useProxy: boolean,
  ): number {
    let baseLevel = 1; // Everyone can find level 1 (public)

    // Level 2: networking >= 20
    if (networking >= 20) baseLevel = 2;

    // Level 3: networking >= 40 AND hacking >= 30
    if (networking >= 40 && hacking >= 30) baseLevel = 3;

    // Level 4: networking >= 60 AND hacking >= 50 AND using proxy
    if (networking >= 60 && hacking >= 50 && useProxy) baseLevel = 4;

    // Level 5: networking >= 80 AND hacking >= 70 AND using proxy
    if (networking >= 80 && hacking >= 70 && useProxy) baseLevel = 5;

    return baseLevel;
  }

  // ==================== STORY INTEGRATION ====================

  /**
   * Check if post triggers story progression
   */
  public async checkStoryTriggers(userId: string, post: Post): Promise<void> {
    await safeExecute({
      fn: async () => {
        if (!post.storyRelevant) return;

        // Emit story event for StoryService to handle
        this.emit("story:post-read", {
          userId,
          postId: post.id,
          forumId: post.forumId,
          title: post.title,
        });

        this.logger.info(
          { userId, postTitle: post.title },
          "Story-relevant post read",
        );
      },
      context: "Check story triggers",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Check if post contains a key fragment
   */
  public async checkKeyFragment(userId: string, post: Post): Promise<void> {
    await safeExecute({
      fn: async () => {
        if (!post.keyFragmentId) return;

        // Delegate to KeyFragmentService for ownership-based claiming
        let keyFragmentService:
          | import("./keyFragmentService").KeyFragmentService
          | null = null;
        try {
          const { getService } = await import("../di/container");
          keyFragmentService =
            getService<import("./keyFragmentService").KeyFragmentService>(
              KEY_FRAGMENT_SERVICE,
            );
        } catch {
          // KeyFragmentService not available — fall through silently
          return;
        }

        const result = await keyFragmentService.claimFragment(
          userId,
          post.keyFragmentId,
          "forum_post",
        );

        if (result.claimed && result.fragment) {
          this.logger.info(
            { userId, fragmentName: result.fragment.name },
            "Key fragment claimed via forum post",
          );
        } else if (result.currentHolder) {
          // Fragment already held — notify player who has it
          if (this.io) {
            this.io.to(`user:${userId}`).emit("story:fragment-intel", {
              fragmentId: post.keyFragmentId,
              currentHolder: result.currentHolder,
              message: `This fragment is held by ${result.currentHolder}. You'll need to negotiate or take it by force.`,
            });
          }
        }
        // If alreadyHeld (player already has it), do nothing
      },
      context: "Check key fragment",
      logger: this.logger,
      silent: true,
    })();
  }

}
