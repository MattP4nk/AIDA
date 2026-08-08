/**
 * ContentDraftService — AI-created content review pipeline.
 *
 * All AI-generated game entities (servers, files, links, missions, forum posts)
 * go through this service as drafts. Admins review and approve/reject via the
 * admin panel. On approval, the actual game entity is created.
 */

import "reflect-metadata";
import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { PRISMA_CLIENT, LOGGER } from "../di/tokens";

export interface CreateDraftInput {
  type: "server" | "file" | "link" | "mission" | "forum_post" | "network" | "forum";
  title: string;
  description: string;
  payload: Record<string, any>;
  source: "ai_content" | "architect" | "admin" | "epoch_event";
  sourceId?: string;
}

@injectable()
export class ContentDraftService {
  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
  ) {}

  /**
   * Create a new content draft for review.
   */
  async createDraft(input: CreateDraftInput): Promise<any> {
    const draft = await this.prisma.contentDraft.create({
      data: {
        type: input.type,
        title: input.title,
        description: input.description,
        payload: input.payload as any,
        source: input.source,
        sourceId: input.sourceId ?? null,
      },
    });

    this.logger.info(
      { draftId: draft.id, type: input.type, source: input.source },
      "Content draft created",
    );

    return draft;
  }

  /**
   * List drafts with filtering.
   */
  async listDrafts(filters: {
    status?: string;
    type?: string;
    source?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ drafts: any[]; total: number }> {
    const where: Record<string, unknown> = {};
    if (filters.status) where.status = filters.status;
    if (filters.type) where.type = filters.type;
    if (filters.source) where.source = filters.source;

    const [drafts, total] = await Promise.all([
      this.prisma.contentDraft.findMany({
        where,
        take: filters.limit ?? 50,
        skip: filters.offset ?? 0,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.contentDraft.count({ where }),
    ]);

    return { drafts, total };
  }

  /**
   * Get pending draft count for dashboard badge.
   */
  async getPendingCount(): Promise<number> {
    return this.prisma.contentDraft.count({ where: { status: "draft" } });
  }

  /**
   * Approve a draft and create the actual game entity.
   * Returns the created entity's ID.
   */
  async approveDraft(
    draftId: string,
    reviewedBy: string,
    reviewNote?: string,
  ): Promise<{ draft: any; resultId: string | null }> {
    const draft = await this.prisma.contentDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "draft") throw new Error(`Cannot approve draft with status '${draft.status}'`);

    let resultId: string | null = null;

    try {
      resultId = await this.executeDraftPayload(draft.type, draft.payload as Record<string, any>);
    } catch (err) {
      this.logger.error({ err, draftId, type: draft.type }, "Failed to execute draft payload");
      throw new Error(`Failed to create ${draft.type}: ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    const updated = await this.prisma.contentDraft.update({
      where: { id: draftId },
      data: {
        status: "applied",
        reviewedBy,
        reviewedAt: new Date(),
        appliedAt: new Date(),
        resultId,
        ...(reviewNote ? { reviewNote } : {}),
      },
    });

    this.logger.info(
      { draftId, type: draft.type, resultId },
      "Content draft approved and applied",
    );

    return { draft: updated, resultId };
  }

  /**
   * Reject a draft.
   */
  async rejectDraft(
    draftId: string,
    reviewedBy: string,
    reviewNote: string,
  ): Promise<any> {
    const draft = await this.prisma.contentDraft.findUnique({
      where: { id: draftId },
    });

    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "draft") throw new Error(`Cannot reject draft with status '${draft.status}'`);

    const updated = await this.prisma.contentDraft.update({
      where: { id: draftId },
      data: {
        status: "rejected",
        reviewedBy,
        reviewedAt: new Date(),
        reviewNote,
      },
    });

    this.logger.info({ draftId, type: draft.type }, "Content draft rejected");
    return updated;
  }

  /**
   * Execute the payload to create the actual game entity.
   * Routes by draft type to the appropriate creation logic.
   */
  private async executeDraftPayload(
    type: string,
    payload: Record<string, any>,
  ): Promise<string | null> {
    switch (type) {
      case "server":
        return this.createServerFromDraft(payload);
      case "file":
        return this.createFileFromDraft(payload);
      case "link":
        return this.createLinkFromDraft(payload);
      case "network":
        return this.createNetworkFromDraft(payload);
      case "mission":
        return this.createMissionFromDraft(payload);
      case "forum_post":
        return this.createForumPostFromDraft(payload);
      case "forum":
        return this.createForumFromDraft(payload);
      default:
        this.logger.warn({ type }, "Unknown draft type — skipping execution");
        return null;
    }
  }

  private async createServerFromDraft(payload: Record<string, any>): Promise<string> {
    // Auto-resolve topology if networkId not provided
    let networkId = payload.networkId || null;
    let factionId = payload.factionId || null;
    let gatewayId: string | null = null;
    let linkType = "lan";
    let latency = 5;

    if (!networkId && payload.ipAddress) {
      const { resolveTopologyFromIP } = await import("./referenceValidationService");
      const topo = await resolveTopologyFromIP(this.prisma, payload.ipAddress);
      networkId = topo.networkId;
      factionId = factionId || topo.factionId;
      gatewayId = topo.gatewayId;
      linkType = topo.linkType;
      latency = topo.latency;
    }

    const server = await this.prisma.gameServer.create({
      data: {
        name: payload.name,
        ipAddress: payload.ipAddress,
        type: payload.type || "underground",
        role: payload.role || "general",
        networkId,
        factionId,
        securityLevel: payload.securityLevel ?? 1,
        firewallLevel: payload.firewallLevel ?? 1,
        encryptionLevel: payload.encryptionLevel ?? 0,
        discoveryLevel: payload.discoveryLevel ?? 0,
        isPublic: payload.isPublic ?? false,
        accessMethod: payload.accessMethod || "hackable",
        accessKey: payload.accessKey || null,
        isOnline: payload.isOnline ?? true,
        maxConnections: payload.maxConnections ?? 10,
      },
    });

    // Create root filesystem
    await this.prisma.fileSystemNode.create({
      data: {
        serverId: server.id,
        name: "/",
        type: "directory",
        permissions: { owner: 15, faction: 5, others: 5, requiredAccessLevel: 0 },
      },
    });

    // Auto-create bidirectional link to network gateway
    const linkTarget = gatewayId || payload._linkTargetId;
    if (linkTarget) {
      try {
        await this.prisma.serverLink.createMany({
          data: [
            { sourceId: linkTarget, targetId: server.id, networkId, linkType, latency },
            { sourceId: server.id, targetId: linkTarget, networkId, linkType, latency },
          ],
        });
        this.logger.info(
          { serverId: server.id, gatewayId: linkTarget, linkType },
          "Auto-linked server to network gateway",
        );
      } catch (err) {
        this.logger.warn({ err, serverId: server.id }, "Failed to auto-link server to gateway");
      }
    }

    // Trigger content provisioning (fire-and-forget)
    try {
      const { getService } = await import("../di/container");
      const { SERVER_CONTENT_SERVICE } = await import("../di/tokens");
      const contentService = getService<any>(SERVER_CONTENT_SERVICE);
      contentService.provisionServerContent(server.id).catch(() => {});
    } catch { /* non-critical */ }

    return server.id;
  }

  private async createFileFromDraft(payload: Record<string, any>): Promise<string> {
    const { serverId, path, name, content, isHidden, isEncrypted, parentId } = payload;

    // Find parent directory
    let parent = parentId
      ? await this.prisma.fileSystemNode.findUnique({ where: { id: parentId } })
      : await this.prisma.fileSystemNode.findFirst({
          where: { serverId, name: "/", type: "directory", parentId: null },
        });

    if (!parent) throw new Error(`Parent directory not found for file on server ${serverId}`);

    // If path provided, ensure directory chain exists
    if (path) {
      const parts = path.split("/").filter(Boolean);
      parts.pop(); // last part is the file name
      for (const dir of parts) {
        const found: any = await this.prisma.fileSystemNode.findFirst({
          where: { serverId, parentId: parent!.id, name: dir, type: "directory" },
        });
        if (found) {
          parent = found;
        } else {
          parent = await this.prisma.fileSystemNode.create({
            data: {
              serverId,
              parentId: parent!.id,
              name: dir,
              type: "directory",
              permissions: { owner: 15, faction: 5, others: 5, requiredAccessLevel: 0 },
            },
          });
        }
      }
    }

    const file = await this.prisma.fileSystemNode.create({
      data: {
        serverId,
        parentId: parent!.id,
        name: name || path?.split("/").pop() || "unnamed",
        type: "file",
        content: content || "",
        size: (content || "").length,
        isHidden: isHidden ?? false,
        isEncrypted: isEncrypted ?? false,
        permissions: { owner: 15, faction: 5, others: 5, requiredAccessLevel: 0 },
      },
    });

    return file.id;
  }

  private async createLinkFromDraft(payload: Record<string, any>): Promise<string> {
    const { sourceId, targetId, networkId, linkType, latency, requiredAccess } = payload;

    // Create bidirectional links
    const link = await this.prisma.serverLink.create({
      data: {
        sourceId,
        targetId,
        networkId: networkId || null,
        linkType: linkType || "lan",
        latency: latency ?? 5,
        requiredAccess: requiredAccess ?? 0,
      },
    });

    // Reverse link
    await this.prisma.serverLink.create({
      data: {
        sourceId: targetId,
        targetId: sourceId,
        networkId: networkId || null,
        linkType: linkType || "lan",
        latency: latency ?? 5,
        requiredAccess: requiredAccess ?? 0,
      },
    });

    return link.id;
  }

  private async createNetworkFromDraft(payload: Record<string, any>): Promise<string> {
    const network = await this.prisma.network.create({
      data: {
        name: payload.name,
        description: payload.description || "",
        zone: payload.zone || "underground",
      },
    });
    return network.id;
  }

  private async createMissionFromDraft(payload: Record<string, any>): Promise<string> {
    const mission = await this.prisma.mission.create({
      data: {
        title: payload.title,
        description: payload.description || "",
        type: payload.type || "side",
        difficulty: payload.difficulty ?? 3,
        reward: payload.reward || { xp: 100, credits: 200 },
        objectives: payload.objectives || [],
        factionId: payload.factionId || null,
      },
    });
    return mission.id;
  }

  private async createForumPostFromDraft(payload: Record<string, any>): Promise<string> {
    const post = await this.prisma.post.create({
      data: {
        forumId: payload.forumId,
        authorId: payload.authorId,
        authorHandle: payload.authorHandle || "unknown",
        title: payload.title,
        content: payload.content || "",
        tags: payload.tags || [],
        isSticky: payload.isSticky ?? false,
        isPinned: payload.isPinned ?? false,
      },
    });
    return post.id;
  }

  private async createForumFromDraft(payload: Record<string, any>): Promise<string> {
    const forum = await this.prisma.forum.create({
      data: {
        name: payload.name,
        url: payload.url,
        description: payload.description || "",
        category: payload.category || "tech",
        securityLevel: payload.securityLevel ?? 1,
        isHoneypot: payload.isHoneypot ?? false,
        requiresProxy: payload.requiresProxy ?? false,
        factionId: payload.factionId || null,
      },
    });
    return forum.id;
  }
}
