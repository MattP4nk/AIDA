import { EventEmitter } from "events";
import { prisma } from "../database/client";
import type { Forum, Post, ForumMember, ProxyConnection } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";

/**
 * ForumService - Underground forum networks and darkweb system
 *
 * Handles:
 * - Forum discovery and scanning
 * - Forum access with proxy requirements
 * - Post reading and creation
 * - Forum membership management
 * - Proxy connection system
 * - Honeypot detection and consequences
 * - Story trigger integration
 */

interface ForumWithPosts extends Forum {
  posts: Post[];
  _count?: {
    members: number;
    posts: number;
  };
}

interface ProxyServer {
  id: string;
  name: string;
  location: string;
  status: "active" | "offline";
  anonymityLevel: number; // 1-5
  speed: "slow" | "medium" | "fast";
}

interface ForumAccessResult {
  forum: ForumWithPosts;
  posts: Post[];
  isMember: boolean;
  requiresProxy: boolean;
  isHoneypot: boolean;
  canPost: boolean;
}

interface ScanResult {
  forums: Forum[];
  newDiscoveries: number;
  requiresHigherSkills: string[];
}

export class ForumService extends EventEmitter {
  private static instance: ForumService;
  private io: SocketIOServer | null = null;

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

  private constructor() {
    super();
    console.log("⚡ ForumService initialized");
  }

  public static getInstance(): ForumService {
    if (!ForumService.instance) {
      ForumService.instance = new ForumService();
    }
    return ForumService.instance;
  }

  public initialize(io: SocketIOServer): void {
    this.io = io;
    console.log("✅ ForumService initialized with Socket.IO");
  }

  // ==================== FORUM DISCOVERY ====================

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

      // Emit scan event
      if (this.io) {
        this.io.to(`user:${userId}`).emit("forum:scan-complete", {
          discovered: newForums.length,
          total: availableForums.length,
        });
      }

      return {
        forums: [...alreadyDiscovered, ...newForums],
        newDiscoveries: newForums.length,
        requiresHigherSkills: higherLevelForums.map(
          (f: any) => `${f.name} (Level ${f.securityLevel})`,
        ),
      };
    } catch (error) {
      console.error("Error scanning forums:", error);
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
      console.error("Error getting discovered forums:", error);
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
      console.error("Error discovering forum:", error);
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

      // Emit forum access event
      if (this.io) {
        this.io.to(`user:${userId}`).emit("forum:accessed", {
          forumId: forum.id,
          forumName: forum.name,
          isHoneypot: forum.isHoneypot,
        });
      }

      return {
        forum: forum as ForumWithPosts,
        posts: forum.posts,
        isMember,
        requiresProxy: forum.requiresProxy,
        isHoneypot: forum.isHoneypot,
        canPost: isMember && !forum.isHoneypot,
      };
    } catch (error) {
      console.error("Error accessing forum:", error);
      throw error;
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

      // Check if honeypot
      if (forum.isHoneypot) {
        const proxyStatus = await this.getProxyStatus(userId);
        if (!proxyStatus.connected) {
          await this.triggerHoneypot(userId, forumId);
        }
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

      // Emit event
      if (this.io) {
        this.io.to(`user:${userId}`).emit("forum:registered", {
          forumId,
          handle,
        });
      }

      return member;
    } catch (error) {
      console.error("Error registering forum account:", error);
      throw error;
    }
  }

  // ==================== POST MANAGEMENT ====================

  /**
   * Get posts from a forum with pagination
   */
  public async getPosts(
    _userId: string,
    forumId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ posts: Post[]; total: number; hasMore: boolean }> {
    try {
      const skip = (page - 1) * limit;

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where: { forumId },
          skip,
          take: limit,
          orderBy: [
            { isSticky: "desc" },
            { isPinned: "desc" },
            { createdAt: "desc" },
          ],
        }),
        prisma.post.count({
          where: { forumId },
        }),
      ]);

      return {
        posts,
        total,
        hasMore: skip + posts.length < total,
      };
    } catch (error) {
      console.error("Error getting posts:", error);
      throw error;
    }
  }

  /**
   * Read a specific post - checks for story triggers
   */
  public async readPost(
    userId: string,
    forumId: string,
    postId: string,
  ): Promise<Post> {
    try {
      const post = await prisma.post.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error("Post not found");
      }

      if (post.forumId !== forumId) {
        throw new Error("Post does not belong to this forum");
      }

      // Increment view count
      await prisma.post.update({
        where: { id: postId },
        data: {
          viewCount: {
            increment: 1,
          },
        },
      });

      // Check for story triggers
      if (post.storyRelevant) {
        await this.checkStoryTriggers(userId, post);
      }

      // Check for key fragments
      if (post.keyFragmentId) {
        await this.checkKeyFragment(userId, post);
      }

      return post;
    } catch (error) {
      console.error("Error reading post:", error);
      throw error;
    }
  }

  /**
   * Create a new post on a forum
   */
  public async createPost(
    userId: string,
    forumId: string,
    title: string,
    content: string,
  ): Promise<Post> {
    try {
      // Check membership
      const member = await prisma.forumMember.findUnique({
        where: {
          userId_forumId: {
            userId,
            forumId,
          },
        },
      });

      if (!member) {
        throw new Error("Must be a forum member to post");
      }

      if (member.isBanned) {
        throw new Error("You are banned from this forum");
      }

      // Create post
      const post = await prisma.post.create({
        data: {
          forumId,
          authorId: userId,
          authorHandle: member.handle,
          title,
          content,
          isSticky: false,
          isPinned: false,
          storyRelevant: false,
        },
      });

      // Update member post count
      await prisma.forumMember.update({
        where: {
          userId_forumId: {
            userId,
            forumId,
          },
        },
        data: {
          postCount: {
            increment: 1,
          },
        },
      });

      // Emit event
      if (this.io) {
        this.io.to(`forum:${forumId}`).emit("forum:new-post", {
          postId: post.id,
          title: post.title,
          author: member.handle,
        });
      }

      return post;
    } catch (error) {
      console.error("Error creating post:", error);
      throw error;
    }
  }

  /**
   * Search posts in a forum
   */
  public async searchPosts(
    _userId: string,
    forumId: string,
    query: string,
  ): Promise<Post[]> {
    try {
      const posts = await prisma.post.findMany({
        where: {
          forumId,
          OR: [
            {
              title: {
                contains: query,
                mode: "insensitive",
              },
            },
            {
              content: {
                contains: query,
                mode: "insensitive",
              },
            },
          ],
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 50,
      });

      return posts;
    } catch (error) {
      console.error("Error searching posts:", error);
      throw error;
    }
  }

  // ==================== PROXY SYSTEM ====================

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

      // Emit event
      if (this.io) {
        this.io.to(`user:${userId}`).emit("proxy:connected", {
          server: proxy.name,
          location: proxy.location,
          expiresAt,
        });
      }

      return connection;
    } catch (error) {
      console.error("Error connecting to proxy:", error);
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

      // Emit event
      if (this.io) {
        this.io.to(`user:${userId}`).emit("proxy:disconnected", {});
      }
    } catch (error) {
      console.error("Error disconnecting proxy:", error);
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
      console.error("Error getting proxy status:", error);
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
    try {
      const forum = await prisma.forum.findUnique({
        where: { id: forumId },
        include: { faction: true },
      });

      if (!forum) return;

      console.log(
        `⚠️ Honeypot triggered for user ${userId} on forum ${forum.name}`,
      );

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

      // If forum belongs to a faction, decrease reputation
      if (forum.factionId) {
        // This will be wired to FactionService in Day 9
        this.emit("honeypot:triggered", {
          userId,
          forumId,
          factionId: forum.factionId,
        });
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
    } catch (error) {
      console.error("Error triggering honeypot:", error);
    }
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
  private async checkStoryTriggers(userId: string, post: Post): Promise<void> {
    try {
      if (!post.storyRelevant) return;

      // Emit story event for StoryService to handle
      this.emit("story:post-read", {
        userId,
        postId: post.id,
        forumId: post.forumId,
        title: post.title,
      });

      console.log(
        `📖 Story-relevant post read by user ${userId}: ${post.title}`,
      );
    } catch (error) {
      console.error("Error checking story triggers:", error);
    }
  }

  /**
   * Check if post contains a key fragment
   */
  private async checkKeyFragment(userId: string, post: Post): Promise<void> {
    try {
      if (!post.keyFragmentId) return;

      // Check if user already has this fragment
      const hasFragment = await prisma.keyFragmentDiscovery.findUnique({
        where: {
          userId_fragmentId: {
            userId,
            fragmentId: post.keyFragmentId,
          },
        },
      });

      if (hasFragment) {
        // Already discovered
        return;
      }

      // Get fragment details
      const fragment = await prisma.keyFragment.findUnique({
        where: { id: post.keyFragmentId },
      });

      if (!fragment) return;

      // Award fragment to player
      await prisma.keyFragmentDiscovery.create({
        data: {
          userId,
          fragmentId: post.keyFragmentId,
          method: "forum_post",
        },
      });

      // Update story progress
      const storyProgress = await prisma.storyProgress.findUnique({
        where: { userId },
      });

      if (storyProgress) {
        const updateData: any = {};

        if (fragment.keyType === "signal") {
          updateData.signalKey = Math.min(storyProgress.signalKey + 1, 3);
        } else if (fragment.keyType === "location") {
          updateData.locationKey = Math.min(storyProgress.locationKey + 1, 3);
        } else if (fragment.keyType === "cipher") {
          updateData.cipherKey = Math.min(storyProgress.cipherKey + 1, 3);
        }

        await prisma.storyProgress.update({
          where: { userId },
          data: updateData,
        });
      }

      // Emit key fragment found event
      this.emit("key:fragment-found", {
        userId,
        fragmentId: post.keyFragmentId,
        keyType: fragment.keyType,
        fragmentNum: fragment.fragmentNum,
      });

      // Notify player
      if (this.io) {
        this.io.to(`user:${userId}`).emit("story:key-fragment", {
          name: fragment.name,
          keyType: fragment.keyType,
          fragmentNum: fragment.fragmentNum,
          description: fragment.description,
        });
      }

      console.log(`🔑 Key fragment found by user ${userId}: ${fragment.name}`);
    } catch (error) {
      console.error("Error checking key fragment:", error);
    }
  }
}

export const forumService = ForumService.getInstance();
