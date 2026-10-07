import { EventEmitter } from "events";
import { prisma } from "../database/client";
import type { Post, ForumMember, PostReply } from "@prisma/client";
import type { Server as SocketIOServer } from "socket.io";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { safeExecute } from "../utils/safeExecute";
import { FACTION_KNOWLEDGE_SERVICE, FORUM_ACCESS_SERVICE, FORUM_CONTENT_SERVICE, FORUM_MODERATION_SERVICE, LOGGER, MISSION_INTEGRATION_SERVICE, REPUTATION_ENGINE, SOCKET_IO } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";
import type { FactionKnowledgeService } from "./factionKnowledgeService";

import type { ReputationEngine } from "./reputationEngine";
import { moderateBeforePublish } from "../utils/moderationGate";
import { getSystemUserId } from "../utils/systemUser";
import { activeMuteMessage } from "../utils/mute";
import type { ForumAccessService } from "./forumAccessService";
import type { ForumModerationService } from "./forumModerationService";
import type { ForumContentService } from "./forumContentService";
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





@injectable()
export class ForumService extends EventEmitter {
  private io: SocketIOServer;


  private missionIntegration: MissionIntegrationService | null = null;
  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(LOGGER) private logger: Logger,
    // A8: the forum's three sub-domains, each its own singleton. Exposed so
    // callers name the domain: forumService.moderation.banMember(...).
    @inject(FORUM_ACCESS_SERVICE) public readonly access: ForumAccessService,
    @inject(FORUM_MODERATION_SERVICE) public readonly moderation: ForumModerationService,
    @inject(FORUM_CONTENT_SERVICE) public readonly content: ForumContentService,
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
          // S7 review: posts must filter `isHidden` like replies already do
          // (:572, :2035, :2041). Without it, moderation "blocking" a post only
          // suppressed the socket notification — the post still rendered for
          // every player on the next `forum list`, so the whole gate was inert
          // on the read path.
          where: { forumId, isHidden: false },
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
        await this.access.checkStoryTriggers(userId, post);
      }

      // Check for key fragments
      if (post.keyFragmentId) {
        await this.access.checkKeyFragment(userId, post);
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

      // `admin mute` — see utils/mute.ts.
      const author = await prisma.user.findUnique({ where: { id: userId }, select: { mutedUntil: true } });
      const muted = activeMuteMessage(author?.mutedUntil);
      if (muted) throw new Error(muted);

      // Apply censorship filtering
      let filteredTitle = title;
      let filteredContent = content;
      try {
        const { filterContentOrThrow } = await import("./censorshipService");
        const forum = await prisma.forum.findUnique({ where: { id: forumId } });
        const ctx: { userId: string; factionId?: string | undefined } = {
          userId,
        };
        if (forum?.factionId) ctx.factionId = forum.factionId;
        filteredTitle = await filterContentOrThrow(title, ctx);
        filteredContent = await filterContentOrThrow(content, ctx);
      } catch (err) {
        // A9: FAIL CLOSED. This used to swallow and publish the raw text.
        this.logger.error({ err, userId, forumId }, "Censorship failed — refusing to post");
        throw new Error("Unable to verify content right now. Try again shortly.");
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

      // S7(d): moderate BEFORE the broadcast — ORDERING, not just awaiting.
      // The first attempt replaced the fire-and-forget IIFE in place, which
      // left it *after* `forum:new-post`, so every subscriber had already
      // rendered the post. See messageService.sendPrivateMessage.
      const moderation = await moderateBeforePublish(
        `${filteredTitle}\n${filteredContent}`,
        this.logger,
        async (reason) => {
          await prisma.post.update({ where: { id: post.id }, data: { isHidden: true } });
          this.io?.to(`user:${userId}`).emit("moderation:flagged", {
            type: "post",
            id: post.id,
            reason,
          });
        },
        (reason) => this.fileModerationEscalation({ forumId, postId: post.id }, reason),
      );

      // Emit event — skipped entirely for blocked content.
      if (this.io && moderation.verdict !== "unsafe") {
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
      // S7 review: the knowledge pipeline must respect the verdict as well.
      // `forum:post_created` is consumed by personaService, which ingests the
      // post and can spawn NPC reactions — so blocked content was being
      // laundered into generated world content and read back by other players.
      // Guarding only the socket emit fixed the notification and left the
      // laundering path open.
      if (moderation.verdict !== "unsafe") this.emit("forum:post_created", {
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
          const reputationEngine = getService<ReputationEngine>(REPUTATION_ENGINE);
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
          isHidden: false, // S7 review: search must not surface blocked posts
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

      // `admin mute` — see utils/mute.ts.
      const author = await prisma.user.findUnique({ where: { id: userId }, select: { mutedUntil: true } });
      const muted = activeMuteMessage(author?.mutedUntil);
      if (muted) throw new Error(muted);

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
        const { filterContentOrThrow } = await import("./censorshipService");
        const forum = await prisma.forum.findUnique({ where: { id: forumId } });
        const ctx: { userId: string; factionId?: string | undefined } = {
          userId,
        };
        if (forum?.factionId) ctx.factionId = forum.factionId;
        filteredContent = await filterContentOrThrow(content, ctx);
      } catch (err) {
        // A9: FAIL CLOSED — see the post path.
        this.logger.error({ err, userId, postId }, "Censorship failed — refusing to reply");
        throw new Error("Unable to verify content right now. Try again shortly.");
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

      // S7(d): moderate BEFORE the broadcast — see createPost.
      const moderation = await moderateBeforePublish(
        filteredContent,
        this.logger,
        async (reason) => {
          await prisma.postReply.update({ where: { id: reply.id }, data: { isHidden: true } });
          this.io?.to(`user:${userId}`).emit("moderation:flagged", {
            type: "reply",
            id: reply.id,
            reason,
          });
        },
        (reason) => this.fileModerationEscalation({ forumId, replyId: reply.id }, reason),
      );

      // Emit event — skipped entirely for blocked content.
      if (this.io && moderation.verdict !== "unsafe") {
        this.io.to(`forum:${forumId}`).emit("forum:new-reply", {
          postId,
          replyId: reply.id,
          author: member.handle,
        });
      }

      // REVIEW: a blocked reply must not earn progress either. Guarding only
      // the broadcast left `onForumActivity` crediting forum mission
      // objectives for content moderation had just rejected — a player could
      // farm objectives with material that never became visible.
      if (moderation.verdict === "unsafe") {
        return reply;
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
        isHidden: false, // S7 review: blocked posts stay out of tag listings too
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
   * S7: put a post or reply in the admin review queue on behalf of moderation.
   *
   * Used when automated moderation could not finish for content already
   * published — the re-check was abandoned, or it judged the content unsafe
   * and hiding it failed. Filed as SYSTEM, so it appears in `forum reports`
   * (system-wide) and the forum's own queue beside player reports. Bypasses
   * reportContent's membership check, which SYSTEM would fail.
   */
  public async fileModerationEscalation(
    target: { forumId: string; postId?: string; replyId?: string },
    reason: string,
  ): Promise<void> {
    const reporterId = await getSystemUserId();
    const report = await prisma.postReport.create({
      data: {
        reporterId,
        forumId: target.forumId,
        ...(target.postId ? { postId: target.postId } : {}),
        ...(target.replyId ? { replyId: target.replyId } : {}),
        reason: `[auto-moderation] ${reason}`,
      },
    });
    this.logger.warn({ ...target, reportId: report.id, reason }, "S7: forum content escalated to admin review");
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
