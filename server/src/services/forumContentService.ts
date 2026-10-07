/**
 * AI and NPC forum content: generated posts and replies, first-boot population.
 *
 * A8: split out of forumService.ts (3,102 lines). Methods moved verbatim; only
 * calls into another forum domain were re-pointed (`this.x(` -> `this.access.x(`).
 */
import { prisma } from "../database/client";
import { resolveAiPersonaUserId, resolveNpcHandleUserId } from "../utils/aiUserIdentity";
import type { Post, PostReply } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import type { Server as SocketIOServer } from "socket.io";
import type { Logger } from "pino";
import { safeExecute, safeAI } from "../utils/safeExecute";
import { AI_SERVICE, LOGGER, SOCKET_IO } from "../di/tokens";
import { validateForumPosts, validateForumReply } from "../utils/aiOutputValidator";
import { fallbackForumPost } from "../utils/aiFallbacks";

@injectable()
export class ForumContentService {
  private io: SocketIOServer;

  constructor(
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(LOGGER) private logger: Logger,
  ) {
    this.io = io;
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
      // Shared resolver — this used to allocate an IP from the PLAYER range via
      // ipService, which worked but put AI accounts in player address space.
      const aiUserId = await resolveAiPersonaUserId(personaId, persona.name);

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
    // Shared resolver. Previously created the account inline with a RANDOM
    // `127.0.x.y` address and no retry, so a collision on the unique homeIp
    // column would surface as a constraint error rather than resolving.
    const npcUserId = await resolveNpcHandleUserId(handle);

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

      // S6c: every player-derived fragment below is sanitized.
      //
      // Five of them were interpolated raw: the post title, the reply body,
      // the replying player's username, and each memory entry's username and
      // summary. The memory is the dangerous one — it is an AI-extracted
      // summary of EARLIER player text, persisted and replayed on every
      // subsequent reply, so an injection landed there outlives the
      // conversation that carried it. Per-turn wrapping cannot help with a
      // channel that stores its payload.
      const { sanitizeForPrompt, sanitizeTranscript, stripPromptBoundaries } =
        await import("../utils/aiPromptSanitizer");

      let userPrompt = `FORUM: "${post.forum.name}"
YOUR POST TITLE: "${stripPromptBoundaries(post.title, 200)}"`;

      if (memory.length > 0) {
        const recentMemory = memory.slice(-10);
        const memoryBlock = sanitizeTranscript(
          recentMemory.map((entry: any) => ({
            role: entry.username || "someone",
            content: `${entry.summary} (${entry.topic || "general"})`,
          })),
          { maxEntryLength: 400 },
        );
        if (memoryBlock) {
          userPrompt += `\n\nYOUR MEMORY OF PAST INTERACTIONS:\n${memoryBlock}`;
        }
      }

      userPrompt +=
        `\n\nPLAYER "${stripPromptBoundaries(replyUser.username, 64)}" REPLIED:\n` +
        sanitizeForPrompt(replyContent);

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

      // Get or create AI user ID. Was a duplicate of the post path above, but
      // with `homeIp: "127.0.0.1"` hardcoded — so it could only ever create one
      // account before hitting the unique constraint.
      const aiUserId = await resolveAiPersonaUserId(personaId, persona.name);

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
}
