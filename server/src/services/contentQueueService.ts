/**
 * ContentQueueService — Reliable content generation pipeline.
 *
 * Replaces all fire-and-forget `provisionServerContent()` calls with a
 * persistent, event-driven queue that:
 *   - Persists jobs to DB (survives restarts)
 *   - Processes sequentially (one job at a time, respects AI concurrency)
 *   - Retries with exponential backoff (up to 3 attempts)
 *   - Deduplicates by serverId (upgrades priority if more urgent)
 *   - Notifies players via Socket.IO when content is ready
 *   - Supports `ensureReady()` for blocking connect flow with timeout
 */

import "reflect-metadata";
import { injectable, inject } from "tsyringe";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import type { Server as SocketIOServer } from "socket.io";
import { PRISMA_CLIENT, LOGGER, SOCKET_IO } from "../di/tokens";
import type { ServerContentService } from "./serverContentService";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export enum ContentJobPriority {
  URGENT = 1,  // Player actively connecting — needs content NOW
  NORMAL = 5,  // Pre-warm from scan, server creation, draft approval
  LOW    = 10, // Background enrichment, startup batch
}

interface ContentJobOptions {
  skipAI?: boolean;
  force?: boolean;
}

interface QueuedJob {
  id: string;
  serverId: string;
  priority: number;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  options: ContentJobOptions;
  requestedBy: string | null;
  createdAt: Date;
  /** Resolve functions for callers awaiting this job via ensureReady(). */
  waiters: Array<{ resolve: (ready: boolean) => void; timer: NodeJS.Timeout }>;
}

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class ContentQueueService {
  // In-memory state
  private queue: QueuedJob[] = [];
  private processing: QueuedJob | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private completedCount = 0;
  private failedCount = 0;

  // Configuration
  private readonly POLL_INTERVAL_MS = 10_000;       // 10s between polls (was 5s)
  private readonly MAX_ATTEMPTS = 3;
  private readonly URGENT_TIMEOUT_MS = 30_000;
  private readonly BACKOFF_BASE_MS = 10_000;
  private readonly CONTENT_THRESHOLD = 12;
  private readonly CLEANUP_AGE_MS = 24 * 60 * 60 * 1000; // 24h
  private readonly COOLDOWN_MS = 15_000;             // 15s cooldown between jobs to avoid flooding AI
  private lastJobCompletedAt = 0;
  private lastCleanupAt = 0;

  // Late-bound to avoid circular DI
  private serverContentService: ServerContentService | null = null;

  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
  ) {}

  /** Late-bind ServerContentService (called from index.ts after DI setup). */
  setServerContentService(svc: ServerContentService): void {
    this.serverContentService = svc;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Lifecycle
  // ═══════════════════════════════════════════════════════════════════

  async start(): Promise<void> {
    if (this.pollTimer) return;

    // Rehydrate pending/processing jobs from DB
    const pendingJobs = await this.prisma.contentJob.findMany({
      where: { status: { in: ["pending", "processing"] } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    for (const dbJob of pendingJobs) {
      // Reset crashed "processing" jobs back to pending
      if (dbJob.status === "processing") {
        await this.prisma.contentJob.update({
          where: { id: dbJob.id },
          data: { status: "pending" },
        });
      }

      this.queue.push({
        id: dbJob.id,
        serverId: dbJob.serverId,
        priority: dbJob.priority,
        status: "pending",
        attempts: dbJob.attempts,
        maxAttempts: dbJob.maxAttempts,
        options: (dbJob.options as ContentJobOptions) || {},
        requestedBy: dbJob.requestedBy,
        createdAt: dbJob.createdAt,
        waiters: [],
      });
    }

    if (pendingJobs.length > 0) {
      this.logger.info({ rehydrated: pendingJobs.length }, "Content queue: rehydrated jobs from DB");
    }

    // Start polling
    this.pollTimer = setInterval(() => {
      this.tick().catch(err =>
        this.logger.error({ err }, "Content queue: tick failed"),
      );
    }, this.POLL_INTERVAL_MS);
    (this.pollTimer as NodeJS.Timeout & { unref?: () => void }).unref?.();

    this.logger.info("Content queue started");
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Re-mark in-progress job as pending for next boot
    if (this.processing) {
      await this.prisma.contentJob.update({
        where: { id: this.processing.id },
        data: { status: "pending" },
      }).catch(() => {});
    }

    // Resolve all waiters with false (shutting down)
    for (const job of this.queue) {
      this.resolveWaiters(job, false);
    }

    this.queue = [];
    this.processing = null;
    this.logger.info("Content queue stopped");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Enqueue
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Enqueue a server for content generation.
   * Deduplicates: if a job for this serverId is already pending/processing,
   * upgrades priority if the new one is more urgent.
   */
  async enqueue(
    serverId: string,
    priority: ContentJobPriority | number = ContentJobPriority.NORMAL,
    options: ContentJobOptions = {},
    requestedBy?: string,
  ): Promise<string> {
    // Deduplication
    const existing = this.queue.find(
      j => j.serverId === serverId && (j.status === "pending" || j.status === "processing"),
    );

    if (existing) {
      if (priority < existing.priority) {
        existing.priority = priority;
        await this.prisma.contentJob.update({
          where: { id: existing.id },
          data: { priority },
        });
        this.logger.debug({ jobId: existing.id, serverId, newPriority: priority }, "Content queue: upgraded priority");
      }
      return existing.id;
    }

    const dbJob = await this.prisma.contentJob.create({
      data: {
        serverId,
        priority,
        status: "pending",
        options: options as any,
        requestedBy: requestedBy ?? null,
        maxAttempts: this.MAX_ATTEMPTS,
      },
    });

    this.queue.push({
      id: dbJob.id,
      serverId,
      priority,
      status: "pending",
      attempts: 0,
      maxAttempts: this.MAX_ATTEMPTS,
      options,
      requestedBy: requestedBy ?? null,
      createdAt: dbJob.createdAt,
      waiters: [],
    });

    this.logger.debug({ jobId: dbJob.id, serverId, priority, queueLength: this.queue.length }, "Content queue: enqueued");
    return dbJob.id;
  }

  /**
   * Batch-enqueue all unpopulated servers (startup).
   * Replaces ServerContentService.provisionAllUnpopulatedServers().
   */
  async enqueueAllUnpopulated(): Promise<number> {
    const servers = await this.prisma.gameServer.findMany({
      where: { isPlayerHome: false, type: { notIn: ["player_home"] } },
      select: { id: true },
    });

    const fileCounts = await this.prisma.fileSystemNode.groupBy({
      by: ["serverId"],
      where: { type: "file" },
      _count: { _all: true },
    });
    const fileCountMap = new Map(fileCounts.map(fc => [fc.serverId, fc._count._all]));

    let enqueued = 0;
    for (const server of servers) {
      const fileCount = fileCountMap.get(server.id) ?? 0;
      if (fileCount <= 8) {
        await this.enqueue(server.id, ContentJobPriority.LOW, { skipAI: true });
        enqueued++;
      }
    }

    if (enqueued > 0) {
      this.logger.info({ enqueued, total: servers.length }, "Content queue: batch enqueued unpopulated servers");
    }

    return enqueued;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Connect Flow
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Ensure server content is ready. Returns immediately if content exists.
   * Otherwise enqueues as urgent and waits up to 30s for completion.
   */
  async ensureReady(serverId: string, userId: string): Promise<boolean> {
    // Fast path
    const ready = await this.checkReady(serverId);
    if (ready) return true;

    const jobId = await this.enqueue(serverId, ContentJobPriority.URGENT, {}, userId);
    const job = this.queue.find(j => j.id === jobId);
    if (!job) return false;
    if (job.status === "completed") return true;

    // Wait for completion with timeout
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        const idx = job.waiters.findIndex(w => w.resolve === resolve);
        if (idx >= 0) job.waiters.splice(idx, 1);
        this.logger.warn({ serverId, jobId, timeoutMs: this.URGENT_TIMEOUT_MS }, "Content queue: ensureReady timed out");
        resolve(false);
      }, this.URGENT_TIMEOUT_MS);

      job.waiters.push({ resolve, timer });

      // Trigger immediate tick if idle
      if (!this.processing) {
        this.tick().catch(err =>
          this.logger.error({ err }, "Content queue: immediate tick failed"),
        );
      }
    });
  }

  /** Check if server has enough content (fileCount > threshold). */
  async checkReady(serverId: string): Promise<boolean> {
    const fileCount = await this.prisma.fileSystemNode.count({
      where: { serverId, type: "file" },
    });
    return fileCount > this.CONTENT_THRESHOLD;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Status
  // ═══════════════════════════════════════════════════════════════════

  getStatus(): { queueLength: number; processing: string | null; completed: number; failed: number } {
    return {
      queueLength: this.queue.filter(j => j.status === "pending").length,
      processing: this.processing?.serverId ?? null,
      completed: this.completedCount,
      failed: this.failedCount,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Processing Loop
  // ═══════════════════════════════════════════════════════════════════

  private async tick(): Promise<void> {
    if (this.processing) return;

    // Cooldown between jobs to avoid flooding AI (skip for URGENT)
    const now = Date.now();
    const timeSinceLastJob = now - this.lastJobCompletedAt;

    // Periodic cleanup of old completed/failed jobs (throttled to once per hour)
    if (now - this.lastCleanupAt > 3_600_000) {
      await this.cleanup();
      this.lastCleanupAt = now;
    }

    // Pick highest-priority pending job (FIFO within same priority)
    const nextJob = this.queue
      .filter(j => j.status === "pending" && j.createdAt.getTime() <= now)
      .sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!nextJob) return;

    // Enforce cooldown for non-urgent jobs
    if (nextJob.priority > 1 && timeSinceLastJob < this.COOLDOWN_MS) return;

    this.processing = nextJob;
    nextJob.status = "processing";
    nextJob.attempts++;

    await this.prisma.contentJob.update({
      where: { id: nextJob.id },
      data: { status: "processing", attempts: nextJob.attempts },
    });

    this.logger.info(
      { jobId: nextJob.id, serverId: nextJob.serverId, priority: nextJob.priority, attempt: nextJob.attempts },
      "Content queue: processing",
    );

    try {
      if (!this.serverContentService) {
        throw new Error("ServerContentService not available");
      }

      await this.serverContentService.provisionServerContent(nextJob.serverId, {
        ...(nextJob.options.force !== undefined ? { force: nextJob.options.force } : {}),
        ...(nextJob.options.skipAI !== undefined ? { skipAI: nextJob.options.skipAI } : {}),
      });

      // Success
      nextJob.status = "completed";
      this.completedCount++;

      await this.prisma.contentJob.update({
        where: { id: nextJob.id },
        data: { status: "completed", completedAt: new Date(), error: null },
      });

      this.logger.info({ jobId: nextJob.id, serverId: nextJob.serverId }, "Content queue: completed");
      this.lastJobCompletedAt = Date.now();
      this.resolveWaiters(nextJob, true);

      // Notify requesting player
      if (nextJob.requestedBy) {
        this.io.to(`user:${nextJob.requestedBy}`).emit("command:result", {
          success: true,
          output: "[System] Server filesystem loaded.",
          timestamp: new Date(),
        });
      }

      this.removeFromQueue(nextJob.id);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      if (nextJob.attempts >= nextJob.maxAttempts) {
        // Exhausted retries
        nextJob.status = "failed";
        this.failedCount++;

        await this.prisma.contentJob.update({
          where: { id: nextJob.id },
          data: { status: "failed", error: errorMsg },
        });

        this.logger.error(
          { jobId: nextJob.id, serverId: nextJob.serverId, attempts: nextJob.attempts, err },
          "Content queue: job failed permanently",
        );

        this.lastJobCompletedAt = Date.now();
        this.resolveWaiters(nextJob, false);
        this.removeFromQueue(nextJob.id);

      } else {
        // Re-queue with backoff
        nextJob.status = "pending";
        const backoffMs = this.BACKOFF_BASE_MS * Math.pow(2, nextJob.attempts - 1);

        // Push createdAt forward for backoff delay
        nextJob.createdAt = new Date(Date.now() + backoffMs);

        await this.prisma.contentJob.update({
          where: { id: nextJob.id },
          data: { status: "pending", error: errorMsg },
        });

        this.logger.warn(
          { jobId: nextJob.id, serverId: nextJob.serverId, attempt: nextJob.attempts, nextRetryMs: backoffMs },
          "Content queue: will retry",
        );
      }
    } finally {
      this.processing = null;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  private resolveWaiters(job: QueuedJob, ready: boolean): void {
    for (const waiter of job.waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(ready);
    }
    job.waiters = [];
  }

  private removeFromQueue(jobId: string): void {
    const idx = this.queue.findIndex(j => j.id === jobId);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  /** Delete completed/failed jobs older than 24 hours. */
  private async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - this.CLEANUP_AGE_MS);
    await this.prisma.contentJob.deleteMany({
      where: {
        status: { in: ["completed", "failed"] },
        updatedAt: { lt: cutoff },
      },
    }).catch(() => {}); // Best-effort
  }
}
