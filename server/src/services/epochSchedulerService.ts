/**
 * EpochSchedulerService — Fires scheduled epoch events at their due time.
 *
 * Runs on a 1-minute interval, checking for events with:
 *   - status: "pending"
 *   - triggerType: "scheduled"
 *   - scheduledAt <= now
 *   - parent epoch status: "active"
 *
 * Supported event actions:
 *   - create_draft: Creates a ContentDraft for admin review
 *   - architect_intervention: Executes an Architect action
 *   - world_event: Creates a system-wide event/notification
 *   - advance_epoch: Completes current epoch, activates next
 *   - toggle_feature: Updates a GameConfig feature flag
 */

import "reflect-metadata";
import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { PRISMA_CLIENT, LOGGER } from "../di/tokens";
import type { ContentDraftService } from "./contentDraftService";
import { safeExecute } from "../utils/safeExecute";

@injectable()
export class EpochSchedulerService {
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CHECK_INTERVAL_MS = 60_000; // 1 minute
  private draftService: ContentDraftService | null = null;

  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
  ) {}

  /** Late-bind services to avoid circular DI. */
  setDraftService(draftService: ContentDraftService): void {
    this.draftService = draftService;
  }

  /**
   * Start the scheduler. Called during server initialization.
   */
  start(): void {
    if (this.checkInterval) return; // Already running

    this.checkInterval = setInterval(() => {
      this.checkScheduledEvents().catch((err) =>
        this.logger.error({ err }, "Epoch scheduler tick failed"),
      );
    }, this.CHECK_INTERVAL_MS);
    (this.checkInterval as any).unref?.();

    this.logger.info("Epoch scheduler started (1-minute interval)");
  }

  /**
   * Stop the scheduler.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      this.logger.info("Epoch scheduler stopped");
    }
  }

  /**
   * Check for events that are due to fire.
   */
  async checkScheduledEvents(): Promise<number> {
    const dueEvents = await this.prisma.epochEvent.findMany({
      where: {
        status: "pending",
        triggerType: "scheduled",
        scheduledAt: { lte: new Date() },
      },
      include: { epoch: { select: { id: true, status: true, title: true } } },
      orderBy: { scheduledAt: "asc" },
      take: 10, // Process max 10 events per tick to avoid overload
    });

    let fired = 0;
    for (const event of dueEvents) {
      // Only fire events from active epochs
      if (event.epoch.status !== "active") {
        this.logger.debug(
          { eventId: event.id, epochStatus: event.epoch.status },
          "Skipping event — epoch not active",
        );
        continue;
      }

      await this.fireEvent(event);
      fired++;
    }

    if (fired > 0) {
      this.logger.info({ fired }, "Epoch events fired");
    }

    return fired;
  }

  /**
   * Fire a single epoch event. Can be called manually (from admin API) or
   * automatically (from the scheduler).
   */
  async fireEvent(event: any): Promise<void> {
    const payload = (event.payload || {}) as Record<string, any>;
    const action = payload.action;

    if (!action) {
      await this.markEventResult(event.id, "failed", { error: "No action in payload" });
      return;
    }

    try {
      let result: Record<string, any> = {};

      switch (action) {
        case "create_draft":
          result = await this.handleCreateDraft(payload);
          break;
        case "architect_intervention":
          result = await this.handleArchitectIntervention(payload);
          break;
        case "world_event":
          result = await this.handleWorldEvent(payload);
          break;
        case "advance_epoch":
          result = await this.handleAdvanceEpoch();
          break;
        case "toggle_feature":
          result = await this.handleToggleFeature(payload);
          break;
        default:
          result = { error: `Unknown action: ${action}` };
          await this.markEventResult(event.id, "failed", result);
          return;
      }

      await this.markEventResult(event.id, "fired", { success: true, ...result });

      this.logger.info(
        { eventId: event.id, eventName: event.name, action },
        "Epoch event fired successfully",
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      await this.markEventResult(event.id, "failed", { success: false, error: errorMsg });
      this.logger.error({ err, eventId: event.id, action }, "Epoch event failed");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Action Handlers
  // ═══════════════════════════════════════════════════════════════

  private async handleCreateDraft(payload: Record<string, any>): Promise<Record<string, any>> {
    if (!this.draftService) throw new Error("ContentDraftService not available");

    const draft = await this.draftService.createDraft({
      type: payload.draftType || "file",
      title: payload.title || "Epoch-generated content",
      description: payload.description || "",
      payload: payload.draftPayload || {},
      source: "epoch_event",
      sourceId: payload.eventId,
    });

    return { draftId: draft.id };
  }

  private async handleArchitectIntervention(payload: Record<string, any>): Promise<Record<string, any>> {
    return await safeExecute({
      fn: async () => {
        const { getService } = await import("../di/container");
        const { ARCHITECT_INTERVENTION_EXECUTOR } = await import("../di/tokens");
        const executor = getService<any>(ARCHITECT_INTERVENTION_EXECUTOR);

        if (!executor) throw new Error("ArchitectInterventionExecutor not available");

        const intervention = payload.intervention || payload;
        await executor.executeSingle(intervention);

        return { interventionType: intervention.type };
      },
      context: "Architect intervention",
      logger: this.logger,
      fallback: { interventionType: "failed" },
    })();
  }

  private async handleWorldEvent(payload: Record<string, any>): Promise<Record<string, any>> {
    // Create a story ledger entry for the world event
    const ledgerEntry = await this.prisma.storyLedger.create({
      data: {
        type: "epoch_event",
        category: "narrative",
        actorId: "system",
        actorType: "system",
        summary: payload.title || "World event",
        detail: payload.description || null,
        data: payload.data || {},
        impact: payload.impact || {},
        weight: payload.weight ?? 5,
      },
    });

    // Also create a notification for all online players if specified
    if (payload.notifyPlayers) {
      try {
        const { getService } = await import("../di/container");
        const { SOCKET_IO } = await import("../di/tokens");
        const io = getService<any>(SOCKET_IO);
        if (io) {
          io.emit("notification", {
            type: "world_event",
            title: payload.title || "World Event",
            message: payload.description || "",
            severity: payload.severity || "info",
          });
        }
      } catch { /* non-critical */ }
    }

    return { ledgerEntryId: ledgerEntry.id };
  }

  private async handleAdvanceEpoch(): Promise<Record<string, any>> {
    // Find current active epoch
    const currentEpoch = await this.prisma.narrativeEpoch.findFirst({
      where: { status: "active" },
      orderBy: { order: "asc" },
    });

    if (!currentEpoch) throw new Error("No active epoch to advance from");

    // Complete current epoch
    await this.prisma.narrativeEpoch.update({
      where: { id: currentEpoch.id },
      data: { status: "completed", endedAt: new Date() },
    });

    // Find next epoch by order
    const nextEpoch = await this.prisma.narrativeEpoch.findFirst({
      where: { order: { gt: currentEpoch.order }, status: "draft" },
      orderBy: { order: "asc" },
    });

    if (nextEpoch) {
      await this.prisma.narrativeEpoch.update({
        where: { id: nextEpoch.id },
        data: { status: "active", startedAt: new Date() },
      });

      // Record epoch transition in story ledger
      await this.prisma.storyLedger.create({
        data: {
          type: "epoch_change",
          category: "narrative",
          actorId: "system",
          actorType: "system",
          summary: `Epoch advanced: "${currentEpoch.title}" → "${nextEpoch.title}"`,
          data: { fromEpoch: currentEpoch.epochNum, toEpoch: nextEpoch.epochNum },
          impact: { tension: 2 },
          weight: 8,
          epochNum: nextEpoch.epochNum,
        },
      });

      return {
        completedEpoch: currentEpoch.title,
        activatedEpoch: nextEpoch.title,
        newEpochNum: nextEpoch.epochNum,
      };
    }

    return {
      completedEpoch: currentEpoch.title,
      activatedEpoch: null,
      note: "No next epoch available",
    };
  }

  private async handleToggleFeature(payload: Record<string, any>): Promise<Record<string, any>> {
    const { flag, value } = payload;
    if (!flag) throw new Error("No feature flag specified");

    const config = await this.prisma.gameConfig.findUnique({
      where: { key: "feature_flags" },
    });

    const flags = (config?.value as Record<string, any>) || {};
    flags[flag] = value ?? !flags[flag]; // Toggle if no value specified

    await this.prisma.gameConfig.upsert({
      where: { key: "feature_flags" },
      update: { value: flags as any },
      create: { key: "feature_flags", value: flags as any },
    });

    return { flag, value: flags[flag] };
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  private async markEventResult(
    eventId: string,
    status: "fired" | "failed",
    result: Record<string, any>,
  ): Promise<void> {
    await this.prisma.epochEvent.update({
      where: { id: eventId },
      data: {
        status,
        ...(status === "fired" ? { firedAt: new Date() } : {}),
        result: result as any,
      },
    });
  }
}
