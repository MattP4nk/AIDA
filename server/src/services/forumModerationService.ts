/**
 * Forum moderation: reports, pin/lock, bans, deletes and edits.
 *
 * A8: split out of forumService.ts (3,102 lines). Methods moved verbatim; only
 * calls into another forum domain were re-pointed (`this.x(` -> `this.access.x(`).
 */
import { prisma } from "../database/client";
import type { Post, ForumMember, PostReport } from "@prisma/client";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { FORUM_ACCESS_SERVICE, LOGGER } from "../di/tokens";
import type { ForumAccessService } from "./forumAccessService";

@injectable()
export class ForumModerationService {

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(FORUM_ACCESS_SERVICE) private access: ForumAccessService,
  ) {}

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

      // NO SOCKET EMIT HERE. Removed 2026-10-07 — it was a privacy leak.
      //
      // It said "Emit event to admins" and sent `reporterId` to
      // `forum:<forumId>`, which `handlers.ts` populates with EVERY live-feed
      // member of the forum — including the author being reported. Anyone who
      // added a listener would have deanonymised every reporter to the people
      // they reported. Latent only because nothing listens yet, which is the
      // worst kind of latent: the next person to wire it up inherits the bug.
      //
      // Admins already get this, correctly: `getReports()` below is gated by
      // `checkAdmin` and is reachable as `forum reports`
      // (socialCommands.ts:1042). A pull behind an authorisation check is the
      // right shape for moderation data; a broadcast to the moderated room is
      // not. There is no `forum-admin:<id>` room to re-target to, and building
      // one for a consumer that does not exist would be inventing machinery.

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

      await this.access.syncLiveFeedRoom(target.userId, forumId);

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

      // Symmetric with banMember. Without this an unban is silently inert for
      // the rest of the session: the player can read and post interactively
      // but their live feed stays dead, with nothing on screen to explain it.
      await this.access.syncLiveFeedRoom(target.userId, forumId);

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
        const { filterContentOrThrow } = await import("./censorshipService");
        const forum = await prisma.forum.findUnique({ where: { id: forumId } });
        const ctx: { userId: string; factionId?: string | undefined } = {
          userId,
        };
        if (forum?.factionId) ctx.factionId = forum.factionId;
        filteredContent = await filterContentOrThrow(newContent, ctx);
      } catch (err) {
        // A9: FAIL CLOSED — see the post path.
        this.logger.error({ err, userId, postId }, "Censorship failed — refusing to edit");
        throw new Error("Unable to verify content right now. Try again shortly.");
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
}
