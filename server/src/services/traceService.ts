import { EventEmitter } from "events";
import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import { db } from "../database/client";
import { LOGGER, MEMORY_SERVICE, PLAYER_PROGRESS_REPOSITORY } from "../di/tokens";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";

import type MemoryService from "./memoryService";
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

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(PLAYER_PROGRESS_REPOSITORY)
    private playerProgress: PlayerProgressRepository,
  ) {
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
   * duration. A trace that reaches 100 % — equivalently, that reaches its
   * `expiresAt` — is COMPLETED: the hacker is caught. Only evasion stops it.
   *
   * The return value is DIAGNOSTIC, not control flow: the only production
   * caller is the internal timer, which discards it. It is shaped this way so
   * the verification harness can assert which bucket a trace landed in —
   * specifically that a trace at full duration is reported as `completed` and
   * NOT as `expired`, which is the whole of the R4 fix. `expired` therefore
   * stays in the shape while the loop no longer produces it; it also remains a
   * valid stored value for rows written before the fix, which
   * `cleanupOldTraces` still collects.
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

          // R4: completion used to be UNREACHABLE.
          //
          // `progress` is purely `elapsed / totalDuration`, so `progress >= 100`
          // is true at exactly the same instant as `now >= expiresAt` — and an
          // expiry check sitting above it `continue`d first. Every trace ended
          // "expired"; `trace:completed` had never once fired in the history of
          // this service.
          //
          // Reaching full duration means the trace SUCCEEDED, which is what the
          // rest of the design says: duration shrinks as evidence rises (a
          // sloppier hack is traced sooner) and `getTraceEvasionChance` falls as
          // progress climbs, so evasion has to happen early. A trace running to
          // term is the hacker being caught, not the trace giving up. There is
          // no separate "ran out of time" outcome to model, because nothing
          // except evasion was ever going to stop it.
          //
          // `expired` remains a valid stored status for legacy rows and is
          // still honoured by `cleanupOldTraces`; the progress loop no longer
          // produces it.
          const newProgress = Math.min(
            100,
            totalDuration > 0
              ? Math.floor((elapsed / totalDuration) * 100)
              : 100,
          );

          if (now >= expiresAtMs || newProgress >= 100) {
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

            await this._releaseTraceDrain(trace.targetId, trace.id);

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
   * Is there already a live trace against this target on this server?
   *
   * Needed because two call sites can each legitimately try to start the same
   * trace during one hack resolution — the counter-measures branch and the
   * session-resolution pipeline. The second is duplicate-rejected, which is
   * correct for the DATA but must not be read as "no trace", or the player is
   * never told to evade one that exists.
   */
  async hasActiveTrace(targetId: string, serverId: string): Promise<boolean> {
    const existing = await db.client.activeTrace.findFirst({
      where: { targetId, serverId, status: "active" },
      select: { id: true },
    });
    return existing !== null;
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

      // Deduct stealth XP cost. The floor used to be `Math.min(2, progress.stealth)`
      // computed here from a read taken earlier in this function — correct for
      // one caller, but two concurrent evasions at stealth 1 both computed 1 and
      // both decremented, landing on -1. The repository floors inside the UPDATE.
      if (progress.stealth > 0) {
        await this.playerProgress.addSkill(userId, "stealth", -2);
      }

      if (evaded) {
        await db.client.activeTrace.update({
          where: { id: traceId },
          data: { status: "evaded" },
        });

        // R4 — this is what makes `trace.evade` MATTER. An active trace is a
        // passive resource consumer (cpu 15 / ram 16 / bw 5). Nothing ever
        // released it: `unregisterActiveTrace` had zero callers in the whole
        // codebase, so evading changed a status column and nothing else, and a
        // player who had been traced carried the drain for the rest of the
        // process's life.
        await this._releaseTraceDrain(userId, traceId);

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
   * Release the passive resource drain a live trace imposes on its target.
   *
   * Must be called on EVERY terminal state (completed / evaded), or the
   * consumer outlives the trace. Resolved lazily rather than injected because
   * `memoryService` is not a constructor dependency of this service and a
   * static import would add an edge for no benefit.
   */
  private async _releaseTraceDrain(
    userId: string,
    traceId: string,
  ): Promise<void> {
    try {
      const { getService } = await import("../di/container");
      const memoryService = getService<MemoryService>(MEMORY_SERVICE);
      memoryService.unregisterActiveTrace(userId, traceId);
    } catch (err) {
      // A drain we failed to release is a resource bug, not a gameplay one —
      // log it rather than letting it abort the progress tick.
      this.logger.error(
        { err, userId, traceId },
        "Failed to release trace resource drain",
      );
    }
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
