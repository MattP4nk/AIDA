import { EventEmitter } from "events";
import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import { db } from "../database/client";
import { LOGGER } from "../di/tokens";

/**
 * TraceService — Manages active trace-backs against hackers who left evidence.
 *
 * When a hacker is detected with high evidence (>70%), a trace is initiated.
 * The trace progresses automatically over time. Higher evidence = faster trace.
 * The hacker can attempt to evade the trace using their stealth skill.
 *
 * Events emitted:
 * - "trace:initiated"  { traceId, targetId, serverId }
 * - "trace:completed"  { traceId, targetId, initiatedBy }  — hacker identity exposed
 * - "trace:evaded"     { traceId, targetId }
 */

import {
  TRACE_DURATION_TIERS,
  getTraceEvasionChance,
} from "../config/gameBalance";

/** Duration tiers mapped from evidence level (in milliseconds) — derived from gameBalance. */
const DURATION_TIERS: { minEvidence: number; durationMs: number }[] =
  TRACE_DURATION_TIERS.map(t => ({
    minEvidence: t.minEvidence,
    durationMs: t.baseMins * 60 * 1000,
  }));

/** How often the progress loop ticks (ms). */
const PROGRESS_INTERVAL_MS = 60 * 1000;

/** Traces older than this are eligible for cleanup. */
const CLEANUP_AGE_DAYS = 7;

@injectable()
class TraceService extends EventEmitter {
  private _progressTimer: NodeJS.Timeout | null = null;

  constructor(@inject(LOGGER) private logger: Logger) {
    super();
    this._startProgressLoop();
    this.logger.info("TraceService initialised — progress loop started");
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Initiate a new trace against a hacker who left evidence on a server.
   *
   * Duplicate traces (same target + server while one is already active) are
   * rejected to avoid stacking.
   */
  async initiateTrace(
    targetId: string,
    initiatedBy: string,
    serverId: string,
    evidenceLevel: number,
  ): Promise<{ success: boolean; trace?: any; error?: string }> {
    try {
      // Guard: duplicate active trace for same target+server
      const existing = await db.client.activeTrace.findFirst({
        where: {
          targetId,
          serverId,
          status: "active",
        },
      });

      if (existing) {
        this.logger.warn(
          { targetId, serverId, existingTraceId: existing.id },
          "Duplicate trace rejected — active trace already exists for target+server",
        );
        return {
          success: false,
          error:
            "An active trace already exists for this target on the specified server",
        };
      }

      const durationMs = this._getDuration(evidenceLevel);
      const expiresAt = new Date(Date.now() + durationMs);

      const trace = await db.client.activeTrace.create({
        data: {
          targetId,
          initiatedBy,
          serverId,
          evidenceLevel,
          progress: 0,
          status: "active",
          expiresAt,
        },
      });

      this.logger.info(
        { traceId: trace.id, targetId, serverId, evidenceLevel, durationMs },
        "Trace initiated against target",
      );

      this.emit("trace:initiated", {
        traceId: trace.id,
        targetId,
        serverId,
      });

      return { success: true, trace };
    } catch (error) {
      this.logger.error(
        { err: error, targetId, serverId, evidenceLevel },
        "Failed to initiate trace",
      );
      return { success: false, error: "Internal error while initiating trace" };
    }
  }

  /**
   * Progress all active traces. Intended to be called on a recurring timer.
   *
   * For each active trace the progress is recomputed from elapsed time vs total
   * duration. Traces that reach 100 % are completed; traces past their expiry
   * are expired.
   */
  async progressTraces(): Promise<{
    completed: string[];
    expired: string[];
    progressed: number;
  }> {
    const completed: string[] = [];
    const expired: string[] = [];
    let progressed = 0;

    try {
      const activeTraces = await db.client.activeTrace.findMany({
        where: { status: "active" },
      });

      const now = Date.now();

      for (const trace of activeTraces) {
        try {
          const createdAtMs = trace.createdAt.getTime();
          const expiresAtMs = trace.expiresAt.getTime();
          const totalDuration = expiresAtMs - createdAtMs;
          const elapsed = now - createdAtMs;

          // Check expiry first
          if (now >= expiresAtMs) {
            await db.client.activeTrace.update({
              where: { id: trace.id },
              data: { status: "expired", progress: trace.progress },
            });
            expired.push(trace.id);
            this.logger.info(
              { traceId: trace.id, targetId: trace.targetId },
              "Trace expired",
            );
            continue;
          }

          const newProgress = Math.min(
            100,
            Math.floor((elapsed / totalDuration) * 100),
          );

          if (newProgress >= 100) {
            // Trace completed — hacker identity exposed
            await db.client.activeTrace.update({
              where: { id: trace.id },
              data: {
                status: "completed",
                progress: 100,
                completedAt: new Date(),
              },
            });
            completed.push(trace.id);

            this.logger.info(
              {
                traceId: trace.id,
                targetId: trace.targetId,
                initiatedBy: trace.initiatedBy,
              },
              "Trace completed — hacker identity exposed",
            );

            this.emit("trace:completed", {
              traceId: trace.id,
              targetId: trace.targetId,
              initiatedBy: trace.initiatedBy,
            });
          } else {
            // Update progress
            await db.client.activeTrace.update({
              where: { id: trace.id },
              data: { progress: newProgress },
            });
            progressed++;
          }
        } catch (innerError) {
          this.logger.error(
            { err: innerError, traceId: trace.id },
            "Error processing individual trace",
          );
        }
      }

      if (completed.length > 0 || expired.length > 0 || progressed > 0) {
        this.logger.info(
          { completed: completed.length, expired: expired.length, progressed },
          "Trace progress tick summary",
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, "Failed to progress traces");
    }

    return { completed, expired, progressed };
  }

  /**
   * Get all active or recent traces targeting a specific user.
   * Includes the server name for display purposes.
   */
  async getTracesAgainst(userId: string): Promise<any[]> {
    try {
      const traces = await db.client.activeTrace.findMany({
        where: {
          targetId: userId,
          status: { in: ["active", "completed", "evaded", "expired"] },
        },
        include: {
          server: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      this.logger.debug(
        { userId, count: traces.length },
        "Retrieved traces against user",
      );

      return traces;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Failed to fetch traces against user",
      );
      return [];
    }
  }

  /**
   * Get all traces initiated by a user (as a server owner being hacked).
   */
  async getTracesInitiated(userId: string): Promise<any[]> {
    try {
      const traces = await db.client.activeTrace.findMany({
        where: { initiatedBy: userId },
        include: {
          server: { select: { name: true } },
          target: { select: { username: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      this.logger.debug(
        { userId, count: traces.length },
        "Retrieved traces initiated by user",
      );

      return traces;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Failed to fetch traces initiated by user",
      );
      return [];
    }
  }

  /**
   * Attempt to evade an active trace.
   *
   * Success is based on the user's stealth skill and current trace progress.
   *   evadeChance = (stealthSkill / 100) * 0.7 − (trace.progress / 100) * 0.5
   *
   * Cost: 2 stealth XP is deducted regardless of outcome.
   */
  async evadeTrace(
    userId: string,
    traceId: string,
  ): Promise<{ success: boolean; evaded?: boolean; message?: string }> {
    try {
      const trace = await db.client.activeTrace.findUnique({
        where: { id: traceId },
      });

      if (!trace) {
        return { success: false, message: "Trace not found" };
      }

      if (trace.targetId !== userId) {
        return {
          success: false,
          message: "You are not the target of this trace",
        };
      }

      if (trace.status !== "active") {
        return {
          success: false,
          message: `Cannot evade a trace with status "${trace.status}"`,
        };
      }

      // Fetch the user's stealth skill
      const progress = await db.client.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return { success: false, message: "Player progress not found" };
      }

      const stealthSkill = progress.stealth;

      // Calculate evasion chance — scales with stealth, penalized by trace progress
      const evadeChance = getTraceEvasionChance(stealthSkill, trace.progress);
      const roll = Math.random();
      const evaded = roll < evadeChance;

      this.logger.info(
        {
          traceId,
          userId,
          stealthSkill,
          traceProgress: trace.progress,
          evadeChance: evadeChance.toFixed(4),
          roll: roll.toFixed(4),
          evaded,
        },
        "Evasion attempt processed",
      );

      // Deduct stealth XP cost (floor at 0)
      const stealthDecrement = Math.min(2, progress.stealth);
      if (stealthDecrement > 0) {
        await db.client.playerProgress.update({
          where: { userId },
          data: {
            stealth: { decrement: stealthDecrement },
          },
        });
      }

      if (evaded) {
        await db.client.activeTrace.update({
          where: { id: traceId },
          data: { status: "evaded" },
        });

        this.emit("trace:evaded", { traceId, targetId: userId });

        return {
          success: true,
          evaded: true,
          message:
            "You successfully evaded the trace. Your digital footprint has been obscured.",
        };
      }

      return {
        success: true,
        evaded: false,
        message:
          "Evasion failed — the trace is still locked on to you. Your attempt cost stealth experience.",
      };
    } catch (error) {
      this.logger.error(
        { err: error, userId, traceId },
        "Error during trace evasion attempt",
      );
      return {
        success: false,
        message: "Internal error during evasion attempt",
      };
    }
  }

  /**
   * Get the current status and progress of a specific trace.
   */
  async getTraceStatus(traceId: string): Promise<any | null> {
    try {
      const trace = await db.client.activeTrace.findUnique({
        where: { id: traceId },
        include: {
          server: { select: { name: true } },
          target: { select: { username: true } },
        },
      });

      if (!trace) {
        this.logger.debug({ traceId }, "Trace not found");
        return null;
      }

      return trace;
    } catch (error) {
      this.logger.error(
        { err: error, traceId },
        "Failed to fetch trace status",
      );
      return null;
    }
  }

  /**
   * Delete completed, evaded, or expired traces that are older than 7 days.
   */
  async cleanupOldTraces(): Promise<number> {
    try {
      const cutoff = new Date(
        Date.now() - CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000,
      );

      const result = await db.client.activeTrace.deleteMany({
        where: {
          status: { in: ["completed", "evaded", "expired"] },
          updatedAt: { lt: cutoff },
        },
      });

      if (result.count > 0) {
        this.logger.info(
          { deletedCount: result.count, cutoffDate: cutoff.toISOString() },
          "Old traces cleaned up",
        );
      }

      return result.count;
    } catch (error) {
      this.logger.error({ err: error }, "Failed to clean up old traces");
      return 0;
    }
  }

  /**
   * Stop the internal progress timer. Should be called during graceful shutdown.
   */
  stop(): void {
    if (this._progressTimer) {
      clearInterval(this._progressTimer);
      this._progressTimer = null;
      this.logger.info("TraceService progress loop stopped");
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Start the recurring progress loop that advances all active traces.
   */
  private _startProgressLoop(): void {
    this._progressTimer = setInterval(async () => {
      try {
        await this.progressTraces();
      } catch (error) {
        this.logger.error(
          { err: error },
          "Unhandled error in trace progress loop",
        );
      }
    }, PROGRESS_INTERVAL_MS);

    // Allow the Node process to exit even if this timer is still running
    this._progressTimer.unref?.();
  }

  /**
   * Determine trace duration (ms) based on evidence level.
   *
   * Evidence thresholds (checked from highest to lowest):
   *   85+  → 15 minutes
   *   70-84 → 30 minutes
   *   50-69 → 1 hour
   *   <50  → 2 hours
   */
  private _getDuration(evidenceLevel: number): number {
    for (const tier of DURATION_TIERS) {
      if (evidenceLevel >= tier.minEvidence) {
        return tier.durationMs;
      }
    }
    // Fallback — should never happen given the 0 tier above
    return (
      DURATION_TIERS[DURATION_TIERS.length - 1]?.durationMs ??
      2 * 60 * 60 * 1000
    );
  }
}

export { TraceService };
export default TraceService;
