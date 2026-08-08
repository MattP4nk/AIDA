import { EventEmitter } from "events";
import { prisma } from "../database/client";
import type {
  Forum,
  Post,
  ForumMember,
  ProxyConnection,
  PostReply,
  PostReport,
} from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { safeExecute, safeAI } from "../utils/safeExecute";
import {
  SOCKET_IO,
  MISSION_INTEGRATION_SERVICE,
  LOGGER,
  FACTION_KNOWLEDGE_SERVICE,
} from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import { validateForumPosts, validateForumReply } from "../utils/aiOutputValidator";
import { fallbackForumPost } from "../utils/aiFallbacks";

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

@injectable()
export class ForumService extends EventEmitter {
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

  private missionIntegration: MissionIntegrationService | null = null;
  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    super();
    this.io = io;
    this.missionIntegration = missionIntegrationService || null;
    this.factionKnowledge = factionKnowledgeService || null;
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
      this.logger.error({ err: error }, "Error accessing forum");
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
      this.logger.error({ err: error }, "Error registering forum account");
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
      this.logger.error({ err: error }, "Error getting posts");
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
  ): Promise<Post & { replies?: PostReply[] }> {
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

      // Fetch first page of replies
      const replies = await prisma.postReply.findMany({
        where: { postId, isHidden: false },
        take: 10,
        orderBy: { createdAt: "asc" },
      });

      return { ...post, replies };
    } catch (error) {
      this.logger.error({ err: error }, "Error reading post");
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
    tags?: string[],
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

      // Apply censorship filtering
      let filteredTitle = title;
      let filteredContent = content;
      try {
        const { getService } = await import("../di/container");
        const censorshipService =
          getService<import("./censorshipService").default>(
            "CensorshipService",
          );
        const forum = await prisma.forum.findUnique({ where: { id: forumId } });
        const ctx: { userId: string; factionId?: string | undefined } = {
          userId,
        };
        if (forum?.factionId) ctx.factionId = forum.factionId;
        filteredTitle = await censorshipService.filterAndAlert(title, ctx);
        filteredContent = await censorshipService.filterAndAlert(content, ctx);
      } catch {
        /* Censorship service not available — pass through */
      }

      // Create post
      const post = await prisma.post.create({
        data: {
          forumId,
          authorId: userId,
          authorHandle: member.handle,
          title: filteredTitle,
          content: filteredContent,
          isSticky: false,
          isPinned: false,
          storyRelevant: false,
          ...(tags && tags.length > 0 ? { tags } : {}),
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

      // Notify AI personas of forum activity (knowledge pipeline)
      const forumRecord = await prisma.forum.findUnique({
        where: { id: forumId },
        select: { factionId: true },
      });
      this.emit("forum:post_created", {
        forumId,
        postId: post.id,
        userId,
        title: post.title,
        factionId: forumRecord?.factionId || null,
      });

      // Feed forum activity into faction knowledge (poster's faction learns about the forum)
      if (this.factionKnowledge) {
        this.factionKnowledge
          .getPlayerFactionId(userId)
          .then((playerFactionId) => {
            if (playerFactionId) {
              this.factionKnowledge!.addEntry(playerFactionId, {
                assetType: "player",
                assetId: userId,
                assetMeta: {
                  username: member.handle,
                  lastForumActivity: forumId,
                  postTitle: post.title,
                },
                source: "forum_intel",
                confidence: 0.7,
                discoveredBy: userId,
              });
            }
          })
          .catch((err) =>
            this.logger.error({ err }, "Faction knowledge forum intel error"),
          );
      }

      // Track for mission objectives
      if (this.missionIntegration) {
        await this.missionIntegration.onForumActivity(userId, "post", forumId);
      }

      // Apply faction reputation via ReputationEngine
      await safeExecute({
        fn: async () => {
          const { getService } = await import("../di/container");
          const { REPUTATION_ENGINE } = await import("../di/tokens");
          const reputationEngine = getService<any>(REPUTATION_ENGINE);
          await reputationEngine.onForumPost(userId, forumId);
        },
        context: "Apply forum post reputation",
        logger: this.logger,
        silent: true,
      })();

      return post;
    } catch (error) {
      this.logger.error({ err: error }, "Error creating post");
      throw error;
    }
  }

  /**
   * Create a forum post from an AI persona
   *
   * PHASE 5: AI forum posting (bypasses membership requirements)
   */
  public async createAIPost(
    personaId: string,
    forumId: string,
    title: string,
    content: string,
  ): Promise<Post> {
    try {
      // Get AI persona info
      const persona = await prisma.aIPersona.findUnique({
        where: { id: personaId },
        include: { faction: true },
      });

      if (!persona) {
        throw new Error("AI Persona not found");
      }

      // Get or create AI user ID
      const aiUserId = `ai_${personaId}`;
      let aiUser = await prisma.user.findUnique({ where: { id: aiUserId } });

      if (!aiUser) {
        // Create AI user account
        const crypto = await import("crypto");
        const { getService } = await import("../di/container");
        const { IP_SERVICE } = await import("../di/tokens");
        const ipService = getService<any>(IP_SERVICE);
        const homeIp = await ipService.generateUniqueIP();

        aiUser = await prisma.user.create({
          data: {
            id: aiUserId,
            username: persona.name,
            email: `${personaId}@ai.aida.internal`,
            password: crypto.randomBytes(32).toString("hex"),
            homeIp: homeIp,
          },
        });
      }

      // Auto-register as forum member if not already
      const memberKey = {
        userId: aiUserId,
        forumId,
      };

      let member = await prisma.forumMember.findUnique({
        where: { userId_forumId: memberKey },
      });

      if (!member) {
        member = await prisma.forumMember.create({
          data: {
            ...memberKey,
            handle: persona.name,
            reputation: 100, // AI starts with high rep
            postCount: 0,
          },
        });
      }

      // Create post
      const post = await prisma.post.create({
        data: {
          forumId,
          authorId: aiUserId,
          authorHandle: persona.name,
          title,
          content,
          isSticky: false,
          isPinned: false,
          storyRelevant: false, // Can be set later if GM posts clues
        },
      });

      // Update member post count
      await prisma.forumMember.update({
        where: { userId_forumId: memberKey },
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
          author: persona.name,
          isAI: true,
        });
      }

      return post;
    } catch (error) {
      this.logger.error({ err: error }, "Error creating AI post");
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FORUM CONTENT POPULATION — AI-generated NPC posts on startup
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Populate all forums with AI-generated NPC posts on first startup.
   * Idempotent — skips if any posts already exist across all forums.
   * Fire-and-forget from index.ts.
   */
  public async populateForumContent(): Promise<void> {
    await safeExecute({
      fn: async () => {
        const totalPosts = await prisma.post.count();
        if (totalPosts > 0) {
          this.logger.info(
            "Forums already populated (%d posts), skipping",
            totalPosts,
          );
          return;
        }

        const forums = await prisma.forum.findMany({
          include: { faction: true },
        });

        this.logger.info(
          "Populating %d forums with NPC content...",
          forums.length,
        );

        for (const forum of forums) {
          try {
            await this.generateForumPosts(forum);
          } catch (err) {
            this.logger.error(
              { err, forumId: forum.id, forumName: forum.name },
              "Failed to populate forum, using fallback",
            );
            await this.insertFallbackPosts(forum);
          }
        }

        const finalCount = await prisma.post.count();
        this.logger.info(
          "Forum population complete: %d posts created",
          finalCount,
        );
      },
      context: "Populate forum content",
      logger: this.logger,
    })();
  }

  /**
   * Generate AI-authored NPC posts for a single forum.
   */
  private async generateForumPosts(forum: any): Promise<void> {
    // Lazy-load AIService
    let aiService: any;
    try {
      const { getService } = await import("../di/container");
      const { AI_SERVICE } = await import("../di/tokens");
      aiService = getService(AI_SERVICE);
    } catch {
      throw new Error("AIService not available");
    }

    // Lazy-load lore constants
    const {
      FACTION_LORE,
      FACTION_VOICE,
      CRYPTIC_QUOTES,
      AMBIENT_NEWS_POOL,
      FACTION_MUNDANE_THEMES,
    } = await import("../lore/worldLore");

    const factionKey = forum.faction
      ? this.resolveFactionKey(forum.faction.shortName || forum.faction.name)
      : null;

    // Build context for AI prompt
    const newsItems = this.pickRandom(AMBIENT_NEWS_POOL, 3);
    const crypticQuote = this.pickRandom(CRYPTIC_QUOTES, 1)[0] || "";
    const mundaneThemes =
      factionKey && FACTION_MUNDANE_THEMES[factionKey]
        ? FACTION_MUNDANE_THEMES[factionKey]
        : null;

    const systemPrompt = `You generate forum posts for an underground hacking game's forum system.
Create 4-6 posts from DIFFERENT forum users. Each user has a unique handle and personality.

CRITICAL RULES:
- Each post must have a different author with a unique handle and one-sentence personality description
- Handles should feel like real internet usernames — creative, lowercase, underscores OK, no corporate names
- Content: 200-800 chars per post. Natural forum style — questions, opinions, tips, rants. NOT essays.
- Mix: 60% mundane forum chatter (complaints, questions, tips, drama), 30% faction/community-relevant, 10% subtle story hints
- ONE post should contain a buried clue: an IP address mentioned in passing, a rumor about a hidden server, or a cryptic reference
- Never break the fourth wall — these are real people posting on a real forum in a cyberpunk world
- Return ONLY valid JSON array: [{"authorHandle": "...", "authorPersonality": "one sentence", "title": "...", "content": "...", "isSticky": false, "storyRelevant": false}]`;

    let userPrompt = `FORUM: "${forum.name}" (${forum.category})
URL: ${forum.url}
Security Level: ${forum.securityLevel}/5
${forum.description ? `Description: ${forum.description}` : ""}`;

    if (factionKey) {
      userPrompt += `\n\nFACTION CONTEXT:\n${FACTION_LORE[factionKey] || ""}`;
      userPrompt += `\n\nWRITING VOICE (guide for all posts on this forum):\n${FACTION_VOICE[factionKey] || ""}`;
    }

    if (mundaneThemes) {
      const topics = [
        ...(mundaneThemes.workFiles || []).slice(0, 3),
        ...(mundaneThemes.personalFiles || []).slice(0, 2),
        ...(mundaneThemes.gossip || []).slice(0, 2),
      ];
      userPrompt += `\n\nTOPIC IDEAS (for mundane posts):\n${topics.join(", ")}`;
    }

    userPrompt += `\n\nCURRENT NEWS (reference in posts if relevant):\n${newsItems.map((n) => `- ${n}`).join("\n")}`;
    userPrompt += `\n\nCRYPTIC LORE (weave into ONE post as subtle hint):\n"${crypticQuote}"`;

    if (forum.isHoneypot) {
      userPrompt += `\n\nSPECIAL: This forum is a HONEYPOT trap. Posts should be enticing — free tools, leaked credentials, too-good-to-be-true offers. Authors should seem enthusiastic and helpful (suspiciously so).`;
    }

    const { enrichWithTopology } = await import("./worldTopologyContext");
    const enrichedSystemPrompt = await enrichWithTopology(systemPrompt, prisma, this.logger);

    const forumId = forum.id;
    const posts = await safeAI({
      aiService,
      prompt: userPrompt,
      systemPrompt: enrichedSystemPrompt,
      expectedFormat: '[{"authorHandle": "string", "authorPersonality": "string", "title": "string", "content": "string"}]',
      validate: validateForumPosts,
      fallback: () => {
        const fb = fallbackForumPost(factionKey, "anon_user");
        return fb ? [{ authorHandle: "anon_user", authorPersonality: "Regular forum user", ...fb }] : [];
      },
      context: "Generate forum posts",
      logger: this.logger,
      jsonType: "array",
      retry: true,
      onRetrySuccess: async (retryPosts) => {
        for (const post of retryPosts.slice(0, 8)) {
          try {
            await this.createNPCPost(forumId, post);
          } catch { /* skip individual post errors */ }
        }
      },
    });

    // Create each NPC post
    for (const postData of posts) {
      await this.createNPCPost(forum.id, postData);
    }

    // For faction forums, add a sticky post from the faction leader
    if (forum.factionId) {
      const leader = await prisma.aIPersona.findFirst({
        where: { faction: { id: forum.factionId } },
      });
      if (leader) {
        const stickyTitle =
          factionKey === "garrison"
            ? "OFFICIAL: Standing Orders & Briefing Protocol"
            : factionKey === "dothackers"
              ? "READ FIRST: Assembly Rules & Opsec"
              : factionKey === "cybercorp"
                ? "MEMO: Employee Forum Guidelines & Updates"
                : "Welcome";

        const stickyContent =
          factionKey === "garrison"
            ? "All operatives must review current briefings before field deployment. Maintain OPSEC at all times. Report suspicious activity through proper channels. Unauthorized disclosures will be prosecuted under Section 7."
            : factionKey === "dothackers"
              ? "Welcome to the Assembly. Rules: 1) No snitches. 2) Encrypt everything. 3) Share knowledge freely. 4) If Garrison or CyberCorp come knocking, you were never here. Stay sharp. Stay free."
              : factionKey === "cybercorp"
                ? "Welcome to the CyberCorp Employee Portal. Please keep discussions professional and aligned with company values. All communications are monitored per your employment agreement. Contact HR for policy questions."
                : "Welcome to this forum.";

        const post = await this.createAIPost(
          leader.id,
          forum.id,
          stickyTitle,
          stickyContent,
        );
        await prisma.post.update({
          where: { id: post.id },
          data: { isSticky: true, isPinned: true },
        });
      }
    }

    this.logger.info(
      { forumId: forum.id, forumName: forum.name, postCount: posts.length },
      "Forum populated with NPC posts",
    );
  }

  /**
   * Create a forum post from an NPC (not a canonical AI persona).
   * Auto-creates User + ForumMember with personality.
   */
  private async createNPCPost(
    forumId: string,
    postData: {
      authorHandle: string;
      authorPersonality: string;
      title: string;
      content: string;
      isSticky?: boolean;
      storyRelevant?: boolean;
    },
  ): Promise<Post> {
    const handle = postData.authorHandle
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, "_")
      .slice(0, 30);
    const npcUserId = `npc_forum_${handle}`;

    // Upsert NPC user account
    await prisma.user.upsert({
      where: { id: npcUserId },
      create: {
        id: npcUserId,
        username: handle,
        email: `${handle}@npc.aida.internal`,
        password: (await import("crypto")).randomBytes(32).toString("hex"),
        homeIp: `127.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
      },
      update: {},
    });

    // Upsert ForumMember with personality
    const personality = {
      description: postData.authorPersonality,
      tone: postData.authorPersonality,
      topics: [],
    };

    await prisma.forumMember.upsert({
      where: { userId_forumId: { userId: npcUserId, forumId } },
      create: {
        userId: npcUserId,
        forumId,
        handle,
        reputation: 10 + Math.floor(Math.random() * 90),
        postCount: 0,
        personality,
        memory: [],
      },
      update: { personality },
    });

    // Create post
    const post = await prisma.post.create({
      data: {
        forumId,
        authorId: npcUserId,
        authorHandle: handle,
        title: postData.title,
        content: postData.content,
        isSticky: postData.isSticky || false,
        storyRelevant: postData.storyRelevant || false,
      },
    });

    // Update post count
    await prisma.forumMember.update({
      where: { userId_forumId: { userId: npcUserId, forumId } },
      data: { postCount: { increment: 1 } },
    });

    return post;
  }

  /**
   * Static fallback posts when AI generation fails.
   */
  private async insertFallbackPosts(forum: any): Promise<void> {
    const factionKey = forum.faction
      ? this.resolveFactionKey(forum.faction.shortName || forum.faction.name)
      : null;

    const fallbackPosts = forum.isHoneypot
      ? [
          {
            authorHandle: "toolz_master",
            authorPersonality: "Overly enthusiastic tool sharer",
            title: "FREE: Elite Exploit Pack v4.2",
            content:
              "Hey everyone! Dropping my personal toolkit here. Includes zero-days for most common firewalls. Download link in my profile. No strings attached! Been using these for months with zero detection. You're welcome.",
          },
          {
            authorHandle: "happy_user_99",
            authorPersonality: "Suspiciously satisfied customer",
            title: "These tools actually work!",
            content:
              "Just used the exploit pack from toolz_master and wow, got root on three servers in an hour. Totally legit. Everyone should download this. Best community ever!",
          },
        ]
      : factionKey === "garrison"
        ? [
            {
              authorHandle: "sentry_7",
              authorPersonality: "By-the-book security analyst",
              title: "Perimeter Alert: Unusual Traffic Patterns",
              content:
                "Logging anomalous traffic on subnet 192.168.1.x. Multiple probes against garrison-gw in the last 48 hours. Could be automated scans, could be something more targeted. Recommend heightened monitoring on all gateway nodes. Report anything suspicious.",
            },
            {
              authorHandle: "lt_cipher",
              authorPersonality: "Exhausted but dedicated officer",
              title: "Shift Change Protocols — READ THIS",
              content:
                "Third time this month someone left their terminal unlocked during shift change. If I catch it again, I'm filing a formal report. Lock your sessions, rotate your keys, and for the love of operational security, stop using 'password123' as your temp credentials.",
            },
            {
              authorHandle: "field_ops_bravo",
              authorPersonality: "Grizzled field operative",
              title: "After-Action Report: Sector 7 Sweep",
              content:
                "Completed sweep of abandoned infrastructure in Sector 7. Found traces of dotHacker activity — encrypted dead drops, wiped logs, the usual. One thing stood out: a file referencing something called 'The Sword'. Flagging for intel review.",
            },
          ]
        : factionKey === "dothackers"
          ? [
              {
                authorHandle: "fr33_radical",
                authorPersonality: "Passionate digital activist",
                title: "CyberCorp's new surveillance patch — we need to talk",
                content:
                  "They pushed an update to all corp-managed nodes last night. Hidden telemetry endpoint phones home every 30 seconds. I've got the packet captures. This is bigger than we thought. If Garrison is getting this data too, we're all compromised. Spread the word.",
              },
              {
                authorHandle: "old_skool_hack",
                authorPersonality: "Veteran hacker, nostalgic",
                title: "Remember when the net was free?",
                content:
                  "Before The Emperor. Before the factions. Before AIDA. There was a time when you could traverse the entire grid without hitting a single firewall. I was there. Most of you weren't. Don't let anyone tell you this is how it's supposed to be.",
              },
              {
                authorHandle: "bit_rebel",
                authorPersonality: "Energetic script kiddie",
                title: "First hack!! (help needed)",
                content:
                  "OK so I managed to crack a level 3 firewall on my own. Took forever but I'm in! Problem is I don't know what I'm looking at. Found some encrypted files but my crypto skill is trash. Any tips? Also is it normal to feel like someone's watching you after you hack a server?",
              },
            ]
          : factionKey === "cybercorp"
            ? [
                {
                  authorHandle: "q4_analyst",
                  authorPersonality: "Numbers-obsessed financial analyst",
                  title: "Q3 Revenue Projections (Internal)",
                  content:
                    "Numbers are looking strong. Server infrastructure revenue up 12% QoQ. The new encryption licensing model is printing money. Only concern: R&D costs on Project Nightfall are above forecast. Director Chen wants a full review before the board meeting.",
                },
                {
                  authorHandle: "synergy_steve",
                  authorPersonality: "Overly corporate middle manager",
                  title: "Team Building Event Next Thursday!",
                  content:
                    "Hi team! Exciting news — we're doing a virtual escape room for team building. Mandatory attendance. Please clear your calendars from 14:00-16:00. Snacks will be provided (digital vouchers). Let's build those cross-departmental synergies!",
                },
                {
                  authorHandle: "intern_404",
                  authorPersonality: "Confused but eager intern",
                  title: "Question about access levels?",
                  content:
                    "Hey, new intern here. I was poking around the dev server and found a directory called .vault_master_key. Is that supposed to be there? My badge doesn't let me open it. Should I file a ticket or just pretend I didn't see it?",
                },
              ]
            : [
                {
                  authorHandle: "netrunner_anon",
                  authorPersonality: "Cautious independent hacker",
                  title: "PSA: New scan detection on public nodes",
                  content:
                    "Heads up — someone updated the IDS signatures on the public-facing servers. My usual port scan patterns are getting flagged instantly. Recommend switching to slow-scan with randomized intervals. Stay safe out there.",
                },
                {
                  authorHandle: "data_nomad",
                  authorPersonality: "Wandering information trader",
                  title: "Trading intel for credits",
                  content:
                    "Got access logs from three different networks. Nothing earth-shattering but could be useful for mapping topology. Looking for 500 credits per log set or trade for equivalent intel. DM me. No Garrison affiliates.",
                },
                {
                  authorHandle: "curious_cat",
                  authorPersonality: "Conspiracy theorist",
                  title: "Has anyone else noticed the signal?",
                  content:
                    "There's a pattern in the background noise on the DarkNet frequency. Every 73 seconds, a burst of encrypted data. It's not random. I've been logging it for weeks. I think... I think something is trying to communicate. Something old. Something that was broken apart a long time ago.",
                },
              ];

    for (const post of fallbackPosts) {
      await this.createNPCPost(forum.id, post);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // NPC REPLY SYSTEM — AI-driven replies with persistent memory
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a post's author is an NPC with personality and optionally generate a reply.
   * Called after a real player creates a reply to a forum post.
   */
  public async handleNPCReply(
    postId: string,
    replyUserId: string,
    replyContent: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
      // Fetch the original post
      const post = await prisma.post.findUnique({
        where: { id: postId },
        include: { forum: true },
      });
      if (!post) return;

      // Check if the post author is an NPC (has personality on their ForumMember)
      const npcMember = await prisma.forumMember.findUnique({
        where: {
          userId_forumId: { userId: post.authorId, forumId: post.forumId },
        },
      });
      if (!npcMember || !npcMember.personality) return;

      // Don't reply to self or other NPCs
      if (replyUserId.startsWith("npc_forum_") || replyUserId.startsWith("ai_"))
        return;

      // Get replying player's username
      const replyUser = await prisma.user.findUnique({
        where: { id: replyUserId },
        select: { username: true },
      });
      if (!replyUser) return;

      // Lazy-load AIService
      let aiService: any;
      try {
        const { getService } = await import("../di/container");
        const { AI_SERVICE } = await import("../di/tokens");
        aiService = getService(AI_SERVICE);
      } catch {
        return; // AI not available, skip silently
      }

      const personality = npcMember.personality as any;
      const memory = (npcMember.memory as any[]) || [];

      // Build NPC reply prompt
      const systemPrompt = `You are "${npcMember.handle}", a forum user in an underground hacking game world.
Personality: ${personality.description || personality.tone || "Regular forum user"}

RULES:
- Stay in character at all times
- If the reply is off-topic, boring, or not worth engaging, respond with just the word PASS
- Otherwise write a short in-character reply (100-400 chars). Be natural — argue, agree, joke, warn, whatever fits your personality
- Also extract any key facts from the player's message worth remembering
- Return ONLY valid JSON: {"reply": "your reply text or PASS", "memoryEntry": {"summary": "what the player shared/asked", "topic": "category"} | null}`;

      let userPrompt = `FORUM: "${post.forum.name}"
YOUR POST TITLE: "${post.title}"`;

      if (memory.length > 0) {
        const recentMemory = memory.slice(-10);
        userPrompt += `\n\nYOUR MEMORY OF PAST INTERACTIONS:`;
        for (const entry of recentMemory) {
          userPrompt += `\n- ${entry.username || "someone"}: ${entry.summary} (${entry.topic || "general"})`;
        }
      }

      userPrompt += `\n\nPLAYER "${replyUser.username}" REPLIED:\n"${replyContent}"`;

      const { enrichWithTopology } = await import("./worldTopologyContext");
      const enrichedReplySystemPrompt = await enrichWithTopology(systemPrompt, prisma, this.logger);

      const parsed = await safeAI({
        aiService,
        prompt: userPrompt,
        systemPrompt: enrichedReplySystemPrompt,
        expectedFormat: '{ "reply": "string (5+ chars)", "memoryEntry": {"summary": "string", "topic": "string"} | null }',
        validate: validateForumReply,
        fallback: { reply: "PASS", memoryEntry: null },
        context: "Generate NPC forum reply",
        logger: this.logger,
      });

      // Update memory regardless of reply
      if (parsed.memoryEntry && parsed.memoryEntry.summary) {
        const newEntry = {
          timestamp: new Date().toISOString(),
          userId: replyUserId,
          username: replyUser.username,
          summary: parsed.memoryEntry.summary.slice(0, 200),
          topic: parsed.memoryEntry.topic || "general",
        };

        const updatedMemory = [...memory, newEntry].slice(-20); // Cap at 20 entries

        await prisma.forumMember.update({
          where: {
            userId_forumId: { userId: post.authorId, forumId: post.forumId },
          },
          data: { memory: updatedMemory },
        });
      }

      // Create reply if not PASS
      if (parsed.reply && parsed.reply.trim().toUpperCase() !== "PASS") {
        await prisma.postReply.create({
          data: {
            postId,
            authorId: post.authorId,
            authorHandle: npcMember.handle,
            content: parsed.reply.trim(),
          },
        });

        await prisma.post.update({
          where: { id: postId },
          data: { replyCount: { increment: 1 } },
        });

        // Notify via Socket.IO
        if (this.io) {
          this.io.to(`forum:${post.forumId}`).emit("forum:new-reply", {
            postId,
            author: npcMember.handle,
            isNPC: true,
          });
        }

        this.logger.info(
          {
            npcHandle: npcMember.handle,
            postId,
            replyUser: replyUser.username,
          },
          "NPC forum reply generated",
        );
      }
      },
      context: "Handle NPC reply",
      logger: this.logger,
    })();
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private resolveFactionKey(name: string): string | null {
    const lower = name.toLowerCase();
    if (lower.includes("garrison")) return "garrison";
    if (lower.includes("dothack") || lower.includes("dot_hack"))
      return "dothackers";
    if (lower.includes("cybercorp") || lower.includes("cyber_corp"))
      return "cybercorp";
    if (lower.includes("darknet") || lower.includes("dark_net"))
      return "darknet";
    return null;
  }

  private pickRandom<T>(arr: T[], count: number): T[] {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
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
      this.logger.error({ err: error }, "Error searching posts");
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

      // Emit event
      if (this.io) {
        this.io.to(`user:${userId}`).emit("proxy:disconnected", {});
      }
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

        // If forum belongs to a faction, decrease reputation via ReputationEngine
        if (forum.factionId) {
          await safeExecute({
            fn: async () => {
              const { getService } = await import("../di/container");
              const { REPUTATION_ENGINE } = await import("../di/tokens");
              const reputationEngine = getService<any>(REPUTATION_ENGINE);
              await reputationEngine.onCaughtByFaction(
                userId,
                forum.factionId,
                "high",
              );
            },
            context: "Apply honeypot reputation",
            logger: this.logger,
            silent: true,
          })();

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
  private async checkStoryTriggers(userId: string, post: Post): Promise<void> {
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
  private async checkKeyFragment(userId: string, post: Post): Promise<void> {
    await safeExecute({
      fn: async () => {
        if (!post.keyFragmentId) return;

        // Delegate to KeyFragmentService for ownership-based claiming
        let keyFragmentService:
          | import("./keyFragmentService").KeyFragmentService
          | null = null;
        try {
          const { getService } = await import("../di/container");
          const { KEY_FRAGMENT_SERVICE } = await import("../di/tokens");
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

  // ==================== ADMIN HELPER ====================

  /**
   * Check if a user is a system-level admin or moderator (User.role).
   * Returns true for "admin" or "moderator" roles.
   */
  private async isSystemAdmin(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role === "admin" || user?.role === "moderator";
  }

  /**
   * Check if a user is an admin of a forum. Throws if not.
   * Also grants access to system admins/moderators (User.role === "admin" | "moderator")
   * even if they are not a forum member or forum-level admin.
   */
  private async checkAdmin(
    userId: string,
    forumId: string,
  ): Promise<ForumMember | null> {
    // System admins/moderators always pass
    if (await this.isSystemAdmin(userId)) {
      // Return the membership if it exists (may be null for system admins not in the forum)
      const member = await prisma.forumMember.findUnique({
        where: {
          userId_forumId: { userId, forumId },
        },
      });
      return member;
    }

    const member = await prisma.forumMember.findUnique({
      where: {
        userId_forumId: {
          userId,
          forumId,
        },
      },
    });

    if (!member) {
      throw new Error("Must be a forum member");
    }

    if (!member.isAdmin) {
      throw new Error("Admin privileges required");
    }

    return member;
  }

  /**
   * Get reports across ALL forums (system admin/moderator only).
   * Useful for global moderation dashboard.
   */
  public async getSystemReports(
    userId: string,
    status: string = "pending",
    page: number = 1,
    limit: number = 30,
  ): Promise<{ reports: PostReport[]; total: number; hasMore: boolean }> {
    try {
      if (!(await this.isSystemAdmin(userId))) {
        throw new Error("System admin or moderator privileges required");
      }

      const skip = (page - 1) * limit;

      const [reports, total] = await Promise.all([
        prisma.postReport.findMany({
          where: { status },
          include: {
            reporter: {
              select: {
                id: true,
                username: true,
              },
            },
            post: {
              select: {
                id: true,
                title: true,
                content: true,
                authorHandle: true,
              },
            },
            reply: {
              select: {
                id: true,
                content: true,
                authorHandle: true,
              },
            },
            forum: {
              select: {
                id: true,
                name: true,
                category: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        prisma.postReport.count({ where: { status } }),
      ]);

      return {
        reports,
        total,
        hasMore: skip + reports.length < total,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error getting system reports");
      throw error;
    }
  }

  // ==================== REPLY SYSTEM ====================

  /**
   * Create a reply on a post
   */
  public async createReply(
    userId: string,
    forumId: string,
    postId: string,
    content: string,
  ): Promise<PostReply> {
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
        throw new Error("Must be a forum member to reply");
      }

      if (member.isBanned) {
        throw new Error("You are banned from this forum");
      }

      // Check post exists and is not locked
      const post = await prisma.post.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error("Post not found");
      }

      if (post.forumId !== forumId) {
        throw new Error("Post does not belong to this forum");
      }

      if (post.isLocked) {
        throw new Error("This post is locked and cannot receive new replies");
      }

      // Apply censorship filtering
      let filteredContent = content;
      try {
        const { getService } = await import("../di/container");
        const censorshipService =
          getService<import("./censorshipService").default>(
            "CensorshipService",
          );
        const forum = await prisma.forum.findUnique({ where: { id: forumId } });
        const ctx: { userId: string; factionId?: string | undefined } = {
          userId,
        };
        if (forum?.factionId) ctx.factionId = forum.factionId;
        filteredContent = await censorshipService.filterAndAlert(content, ctx);
      } catch {
        /* Censorship service not available — pass through */
      }

      // Create reply
      const reply = await prisma.postReply.create({
        data: {
          postId,
          authorId: userId,
          authorHandle: member.handle,
          content: filteredContent,
        },
      });

      // Increment post reply count
      await prisma.post.update({
        where: { id: postId },
        data: {
          replyCount: {
            increment: 1,
          },
        },
      });

      // Emit event
      if (this.io) {
        this.io.to(`forum:${forumId}`).emit("forum:new-reply", {
          postId,
          replyId: reply.id,
          author: member.handle,
        });
      }

      // Track for mission objectives
      if (this.missionIntegration) {
        await this.missionIntegration.onForumActivity(
          userId,
          "reply",
          forumId,
          postId,
        );
      }

      return reply;
    } catch (error) {
      this.logger.error({ err: error }, "Error creating reply");
      throw error;
    }
  }

  /**
   * Get paginated replies for a post
   */
  public async getReplies(
    postId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ replies: PostReply[]; total: number; hasMore: boolean }> {
    try {
      const skip = (page - 1) * limit;

      const [replies, total] = await Promise.all([
        prisma.postReply.findMany({
          where: { postId, isHidden: false },
          skip,
          take: limit,
          orderBy: { createdAt: "asc" },
        }),
        prisma.postReply.count({
          where: { postId, isHidden: false },
        }),
      ]);

      return {
        replies,
        total,
        hasMore: skip + replies.length < total,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error getting replies");
      throw error;
    }
  }

  /**
   * Create a reply from an AI persona (bypasses membership)
   */
  public async createAIReply(
    personaId: string,
    forumId: string,
    postId: string,
    content: string,
  ): Promise<PostReply> {
    try {
      // Get AI persona info
      const persona = await prisma.aIPersona.findUnique({
        where: { id: personaId },
        include: { faction: true },
      });

      if (!persona) {
        throw new Error("AI Persona not found");
      }

      // Check post exists
      const post = await prisma.post.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error("Post not found");
      }

      // Get or create AI user ID
      const aiUserId = `ai_${personaId}`;
      let aiUser = await prisma.user.findUnique({ where: { id: aiUserId } });

      if (!aiUser) {
        // Create AI user account
        const crypto = await import("crypto");
        aiUser = await prisma.user.create({
          data: {
            id: aiUserId,
            username: persona.name,
            email: `${personaId}@ai.aida.internal`,
            password: crypto.randomBytes(32).toString("hex"),
            homeIp: "127.0.0.1",
          },
        });
      }

      // Auto-register as forum member if not already
      const memberKey = {
        userId: aiUserId,
        forumId,
      };

      let member = await prisma.forumMember.findUnique({
        where: { userId_forumId: memberKey },
      });

      if (!member) {
        member = await prisma.forumMember.create({
          data: {
            ...memberKey,
            handle: persona.name,
            reputation: 100,
            postCount: 0,
          },
        });
      }

      // Create reply
      const reply = await prisma.postReply.create({
        data: {
          postId,
          authorId: aiUserId,
          authorHandle: persona.name,
          content,
        },
      });

      // Increment post reply count
      await prisma.post.update({
        where: { id: postId },
        data: {
          replyCount: {
            increment: 1,
          },
        },
      });

      // Emit event
      if (this.io) {
        this.io.to(`forum:${forumId}`).emit("forum:new-reply", {
          postId,
          replyId: reply.id,
          author: persona.name,
          isAI: true,
        });
      }

      return reply;
    } catch (error) {
      this.logger.error({ err: error }, "Error creating AI reply");
      throw error;
    }
  }

  // ==================== VOTING SYSTEM ====================

  /**
   * Vote on a post (upvote or downvote, toggle if same value)
   */
  public async voteOnPost(
    userId: string,
    forumId: string,
    postId: string,
    value: 1 | -1,
  ): Promise<{
    postId: string;
    newVoteCount: number;
    userVote: number | null;
  }> {
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
        throw new Error("Must be a forum member to vote");
      }

      // Get the post
      const post = await prisma.post.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error("Post not found");
      }

      if (post.forumId !== forumId) {
        throw new Error("Post does not belong to this forum");
      }

      // Check for existing vote
      const existingVote = await prisma.postVote.findUnique({
        where: {
          userId_postId: {
            userId,
            postId,
          },
        },
      });

      let voteDelta = 0;
      let userVote: number | null = null;

      if (existingVote) {
        if (existingVote.value === value) {
          // Same vote — toggle off (remove)
          await prisma.postVote.delete({
            where: { id: existingVote.id },
          });
          voteDelta = -value;
          userVote = null;
        } else {
          // Different vote — update (swing is 2x)
          await prisma.postVote.update({
            where: { id: existingVote.id },
            data: { value },
          });
          voteDelta = value * 2; // e.g. -1 -> +1 = delta of +2
          userVote = value;
        }
      } else {
        // No existing vote — create
        await prisma.postVote.create({
          data: {
            userId,
            postId,
            value,
          },
        });
        voteDelta = value;
        userVote = value;
      }

      // Update post vote count
      const updatedPost = await prisma.post.update({
        where: { id: postId },
        data: {
          votes: {
            increment: voteDelta,
          },
        },
      });

      // Update post author's reputation
      if (post.authorId !== userId) {
        await prisma.forumMember.updateMany({
          where: {
            userId: post.authorId,
            forumId,
          },
          data: {
            reputation: {
              increment: voteDelta,
            },
          },
        });
      }

      return {
        postId,
        newVoteCount: updatedPost.votes,
        userVote,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error voting on post");
      throw error;
    }
  }

  /**
   * Vote on a reply (upvote or downvote, toggle if same value)
   */
  public async voteOnReply(
    userId: string,
    forumId: string,
    replyId: string,
    value: 1 | -1,
  ): Promise<{
    replyId: string;
    newVoteCount: number;
    userVote: number | null;
  }> {
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
        throw new Error("Must be a forum member to vote");
      }

      // Get the reply
      const reply = await prisma.postReply.findUnique({
        where: { id: replyId },
        include: { post: true },
      });

      if (!reply) {
        throw new Error("Reply not found");
      }

      if (reply.post.forumId !== forumId) {
        throw new Error("Reply does not belong to this forum");
      }

      // Check for existing vote
      const existingVote = await prisma.postVote.findUnique({
        where: {
          userId_replyId: {
            userId,
            replyId,
          },
        },
      });

      let voteDelta = 0;
      let userVote: number | null = null;

      if (existingVote) {
        if (existingVote.value === value) {
          // Same vote — toggle off (remove)
          await prisma.postVote.delete({
            where: { id: existingVote.id },
          });
          voteDelta = -value;
          userVote = null;
        } else {
          // Different vote — update
          await prisma.postVote.update({
            where: { id: existingVote.id },
            data: { value },
          });
          voteDelta = value * 2;
          userVote = value;
        }
      } else {
        // No existing vote — create
        await prisma.postVote.create({
          data: {
            userId,
            replyId,
            value,
          },
        });
        voteDelta = value;
        userVote = value;
      }

      // Update reply vote count
      const updatedReply = await prisma.postReply.update({
        where: { id: replyId },
        data: {
          votes: {
            increment: voteDelta,
          },
        },
      });

      // Update reply author's reputation
      if (reply.authorId !== userId) {
        await prisma.forumMember.updateMany({
          where: {
            userId: reply.authorId,
            forumId,
          },
          data: {
            reputation: {
              increment: voteDelta,
            },
          },
        });
      }

      return {
        replyId,
        newVoteCount: updatedReply.votes,
        userVote,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error voting on reply");
      throw error;
    }
  }

  // ==================== TAGS ====================

  /**
   * Get posts filtered by tag with pagination
   */
  public async getPostsByTag(
    forumId: string,
    tag: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ posts: Post[]; total: number; hasMore: boolean }> {
    try {
      const skip = (page - 1) * limit;

      const where = {
        forumId,
        tags: {
          has: tag,
        },
      };

      const [posts, total] = await Promise.all([
        prisma.post.findMany({
          where,
          skip,
          take: limit,
          orderBy: [
            { isPinned: "desc" as const },
            { createdAt: "desc" as const },
          ],
        }),
        prisma.post.count({ where }),
      ]);

      return {
        posts,
        total,
        hasMore: skip + posts.length < total,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error getting posts by tag");
      throw error;
    }
  }

  // ==================== CONTENT REPORTING ====================

  /**
   * Report a post or reply
   */
  public async reportContent(
    userId: string,
    forumId: string,
    postId: string | undefined,
    replyId: string | undefined,
    reason: string,
  ): Promise<PostReport> {
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
        throw new Error("Must be a forum member to report content");
      }

      // Ensure either postId or replyId is provided
      if (!postId && !replyId) {
        throw new Error("Must specify either a post or reply to report");
      }

      // Create report
      const report = await prisma.postReport.create({
        data: {
          reporterId: userId,
          forumId,
          ...(postId ? { postId } : {}),
          ...(replyId ? { replyId } : {}),
          reason,
        },
      });

      // Emit event to admins
      if (this.io) {
        this.io.to(`forum:${forumId}`).emit("forum:content-reported", {
          reportId: report.id,
          reporterId: userId,
          postId: postId || null,
          replyId: replyId || null,
          reason,
        });
      }

      this.logger.info(
        { userId, forumId, postId, replyId, reportId: report.id },
        "Content reported",
      );

      return report;
    } catch (error) {
      this.logger.error({ err: error }, "Error reporting content");
      throw error;
    }
  }

  /**
   * Get reports for a forum (admin only)
   */
  public async getReports(
    userId: string,
    forumId: string,
    status: string = "pending",
  ): Promise<PostReport[]> {
    try {
      // Admin check
      await this.checkAdmin(userId, forumId);

      const reports = await prisma.postReport.findMany({
        where: {
          forumId,
          status,
        },
        include: {
          reporter: {
            select: {
              id: true,
              username: true,
            },
          },
          post: {
            select: {
              id: true,
              title: true,
              content: true,
              authorHandle: true,
            },
          },
          reply: {
            select: {
              id: true,
              content: true,
              authorHandle: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return reports;
    } catch (error) {
      this.logger.error({ err: error }, "Error getting reports");
      throw error;
    }
  }

  /**
   * Resolve a content report (admin only)
   */
  public async resolveReport(
    userId: string,
    forumId: string,
    reportId: string,
    action: "dismiss" | "action",
  ): Promise<PostReport> {
    try {
      // Admin check
      await this.checkAdmin(userId, forumId);

      const report = await prisma.postReport.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new Error("Report not found");
      }

      if (report.forumId !== forumId) {
        throw new Error("Report does not belong to this forum");
      }

      if (action === "action") {
        // Hide the reported content
        if (report.postId) {
          await prisma.post.update({
            where: { id: report.postId },
            data: { isHidden: true },
          });
        }

        if (report.replyId) {
          await prisma.postReply.update({
            where: { id: report.replyId },
            data: { isHidden: true },
          });
        }
      }

      // Update report status
      const updatedReport = await prisma.postReport.update({
        where: { id: reportId },
        data: {
          status: action === "dismiss" ? "dismissed" : "actioned",
          resolvedAt: new Date(),
          resolvedBy: userId,
        },
      });

      this.logger.info(
        { userId, forumId, reportId, action },
        "Report resolved",
      );

      return updatedReport;
    } catch (error) {
      this.logger.error({ err: error }, "Error resolving report");
      throw error;
    }
  }

  // ==================== ADMIN & MODERATION ====================

  /**
   * Pin/unpin a post (admin only, toggles isPinned)
   */
  public async pinPost(
    userId: string,
    forumId: string,
    postId: string,
  ): Promise<Post> {
    try {
      await this.checkAdmin(userId, forumId);

      const post = await prisma.post.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error("Post not found");
      }

      if (post.forumId !== forumId) {
        throw new Error("Post does not belong to this forum");
      }

      const updatedPost = await prisma.post.update({
        where: { id: postId },
        data: { isPinned: !post.isPinned },
      });

      this.logger.info(
        { userId, forumId, postId, isPinned: updatedPost.isPinned },
        "Post pin toggled",
      );

      return updatedPost;
    } catch (error) {
      this.logger.error({ err: error }, "Error pinning post");
      throw error;
    }
  }

  /**
   * Lock/unlock a post (admin only, toggles isLocked)
   */
  public async lockPost(
    userId: string,
    forumId: string,
    postId: string,
  ): Promise<Post> {
    try {
      await this.checkAdmin(userId, forumId);

      const post = await prisma.post.findUnique({
        where: { id: postId },
      });

      if (!post) {
        throw new Error("Post not found");
      }

      if (post.forumId !== forumId) {
        throw new Error("Post does not belong to this forum");
      }

      const updatedPost = await prisma.post.update({
        where: { id: postId },
        data: { isLocked: !post.isLocked },
      });

      this.logger.info(
        { userId, forumId, postId, isLocked: updatedPost.isLocked },
        "Post lock toggled",
      );

      return updatedPost;
    } catch (error) {
      this.logger.error({ err: error }, "Error locking post");
      throw error;
    }
  }

  /**
   * Ban a member from a forum (admin only)
   */
  public async banMember(
    userId: string,
    forumId: string,
    targetHandle: string,
  ): Promise<{ message: string }> {
    try {
      await this.checkAdmin(userId, forumId);

      const target = await prisma.forumMember.findFirst({
        where: {
          forumId,
          handle: targetHandle,
        },
      });

      if (!target) {
        throw new Error("Member not found");
      }

      if (target.isAdmin) {
        throw new Error("Cannot ban an admin");
      }

      await prisma.forumMember.update({
        where: { id: target.id },
        data: { isBanned: true },
      });

      this.logger.info({ userId, forumId, targetHandle }, "Member banned");

      return { message: `Member '${targetHandle}' has been banned` };
    } catch (error) {
      this.logger.error({ err: error }, "Error banning member");
      throw error;
    }
  }

  /**
   * Unban a member from a forum (admin only)
   */
  public async unbanMember(
    userId: string,
    forumId: string,
    targetHandle: string,
  ): Promise<{ message: string }> {
    try {
      await this.checkAdmin(userId, forumId);

      const target = await prisma.forumMember.findFirst({
        where: {
          forumId,
          handle: targetHandle,
        },
      });

      if (!target) {
        throw new Error("Member not found");
      }

      await prisma.forumMember.update({
        where: { id: target.id },
        data: { isBanned: false },
      });

      this.logger.info({ userId, forumId, targetHandle }, "Member unbanned");

      return { message: `Member '${targetHandle}' has been unbanned` };
    } catch (error) {
      this.logger.error({ err: error }, "Error unbanning member");
      throw error;
    }
  }

  /**
   * Delete a post (author or admin only)
   */
  public async deletePost(
    userId: string,
    forumId: string,
    postId: string,
  ): Promise<void> {
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

      // Check if user is author or admin
      const isAuthor = post.authorId === userId;

      if (!isAuthor) {
        // Must be admin
        await this.checkAdmin(userId, forumId);
      }

      // Delete associated replies, votes, and reports first
      await prisma.postVote.deleteMany({ where: { postId } });
      await prisma.postReport.deleteMany({ where: { postId } });

      // Delete reply votes and reports, then replies
      const replyIds = await prisma.postReply.findMany({
        where: { postId },
        select: { id: true },
      });
      const replyIdList = replyIds.map((r: any) => r.id);

      if (replyIdList.length > 0) {
        await prisma.postVote.deleteMany({
          where: { replyId: { in: replyIdList } },
        });
        await prisma.postReport.deleteMany({
          where: { replyId: { in: replyIdList } },
        });
      }

      await prisma.postReply.deleteMany({ where: { postId } });

      // Delete the post
      await prisma.post.delete({
        where: { id: postId },
      });

      // Decrement author's post count
      await prisma.forumMember.updateMany({
        where: {
          userId: post.authorId,
          forumId,
        },
        data: {
          postCount: {
            decrement: 1,
          },
        },
      });

      this.logger.info({ userId, forumId, postId }, "Post deleted");
    } catch (error) {
      this.logger.error({ err: error }, "Error deleting post");
      throw error;
    }
  }

  /**
   * Edit a post (author only)
   */
  public async editPost(
    userId: string,
    forumId: string,
    postId: string,
    newContent: string,
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

      if (post.authorId !== userId) {
        throw new Error("Only the author can edit this post");
      }

      // Apply censorship filtering
      let filteredContent = newContent;
      try {
        const { getService } = await import("../di/container");
        const censorshipService =
          getService<import("./censorshipService").default>(
            "CensorshipService",
          );
        const forum = await prisma.forum.findUnique({ where: { id: forumId } });
        const ctx: { userId: string; factionId?: string | undefined } = {
          userId,
        };
        if (forum?.factionId) ctx.factionId = forum.factionId;
        filteredContent = await censorshipService.filterAndAlert(
          newContent,
          ctx,
        );
      } catch {
        /* Censorship service not available — pass through */
      }

      const updatedPost = await prisma.post.update({
        where: { id: postId },
        data: { content: filteredContent },
      });

      this.logger.info({ userId, forumId, postId }, "Post edited");

      return updatedPost;
    } catch (error) {
      this.logger.error({ err: error }, "Error editing post");
      throw error;
    }
  }

  /**
   * Get paginated forum members
   */
  public async getForumMembers(
    forumId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<{ members: ForumMember[]; total: number; hasMore: boolean }> {
    try {
      const skip = (page - 1) * limit;

      const [members, total] = await Promise.all([
        prisma.forumMember.findMany({
          where: { forumId },
          skip,
          take: limit,
          orderBy: { reputation: "desc" },
        }),
        prisma.forumMember.count({ where: { forumId } }),
      ]);

      return {
        members,
        total,
        hasMore: skip + members.length < total,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error getting forum members");
      throw error;
    }
  }

  /**
   * Get a specific member's profile
   */
  public async getMemberProfile(
    forumId: string,
    handle: string,
  ): Promise<ForumMember> {
    try {
      const member = await prisma.forumMember.findFirst({
        where: {
          forumId,
          handle,
        },
      });

      if (!member) {
        throw new Error("Member not found");
      }

      return member;
    } catch (error) {
      this.logger.error({ err: error }, "Error getting member profile");
      throw error;
    }
  }
}

export default ForumService;
