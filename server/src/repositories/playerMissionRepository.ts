/**
 * PlayerMissionRepository — the single reader/writer of a player's mission state.
 *
 * Phase 3 D3, PASS 2 OF 2 (storage now lives in real tables).
 *
 * ## What D3 was
 *
 * Mission state was a JSON blob on `PlayerProgress.missionProgress`, and all 64
 * of its touchpoints inlined `(progress.missionProgress as any) || {}`, mutated
 * a nested object, and wrote the WHOLE blob back with no transaction and no
 * optimistic concurrency. Two writers lost each other's work entirely, not just
 * for the field they touched.
 *
 * The worst case was not player-vs-player, which is why it fired in single
 * player: `checkExpiredMissions` loaded every player's blob up front, then per
 * player awaited an audit-log write and a `mission.update` before writing its
 * copy back. A mission completed inside that window was reverted to `active` by
 * the sweep's stale copy, after which the `"already completed"` guard passed a
 * second time and **rewards were granted twice**.
 *
 * ## How it was done
 *
 * Pass 1 put this repository over the existing blob and serialised writes per
 * user, converting all 64 sites with no schema change. Pass 2 (here) swapped
 * the internals to `PlayerMission` + `PlayerMissionObjective`. Two passes
 * because there was no seam: a direct swap would have changed storage AND 64
 * call sites at once, with every intermediate state holding two sources of
 * truth. The external contract below is byte-for-byte what pass 1 exposed, so
 * pass 2 changed no caller.
 *
 * ## What pass 2 buys over pass 1
 *
 * 1. **The sweep is a query.** `findExpired` is
 *    `where: { status: "active", expiresAt: { lt: now } }` against an index.
 *    Pass 1 still had to read every player's blob and filter in JS, because
 *    that predicate is not expressible over a JSON map keyed by mission id.
 * 2. **Objective progress can be RELATIVE.** `incrementObjective` is a single
 *    `UPDATE … SET current_count = current_count + n`. Pass 1 could not fix
 *    this: callers pass an absolute value computed from a `current` they read
 *    outside the lock, so two concurrent counters for the same objective
 *    collapsed into one however tightly the blob write was serialised.
 * 3. **Deleting a mission removes the players' copies**, via a real FK. The
 *    blob had 78 entries (26%) pointing at missions that no longer existed.
 *
 * The per-user mutex is KEPT. Conditional single statements cover the hot
 * paths, but `mutate` still hands callers a whole mission to edit, and that
 * read-modify-write needs serialising. It is in-process only, which is honest
 * about the deployment: PLAN.md decision 8 makes single-instance a supported
 * constraint.
 */
import { AsyncLocalStorage } from "async_hooks";
import { inject, injectable } from "tsyringe";
import { EventEmitter } from "events";
import { Prisma, PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { LOGGER, PRISMA_CLIENT } from "../di/tokens";

import { requiredObjectivesComplete } from "../utils/missionCompletion";
/** One objective inside a player's copy of a mission. */
export interface StoredObjective {
  id: string;
  type: string;
  description?: string;
  /** Number or boolean in all live rows; a string target is defensive only. */
  target: number | boolean | string;
  current: number | boolean | string;
  completed: boolean;
  /** R7: a bonus objective does not gate mission completion. */
  isBonus?: boolean;
  metadata?: Record<string, unknown>;
}

/** A player's copy of a mission. Shape is pass 1's, unchanged. */
export interface StoredPlayerMission {
  missionId: string;
  userId: string;
  status: string;
  objectives: StoredObjective[];
  startedAt?: string | Date | null;
  completedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  [extra: string]: unknown;
}

/** Returned by a `mutate` callback to say "nothing changed, skip the write". */
export const NO_CHANGE = Symbol("no-change");

/** Row shape loaded from the tables, including its objectives. */
type Row = Prisma.PlayerMissionGetPayload<{ include: { objectives: true } }>;

@injectable()
export class PlayerMissionRepository extends EventEmitter {
  private chains = new Map<string, Promise<unknown>>();

  /**
   * Which user's critical section the CURRENT async context is inside.
   *
   * The mutex is not reentrant, so calling a write method from inside a
   * `mutate`/`mutateAll` callback would wait on a lock the caller already holds
   * — a permanent hang for that player, with no error and no log.
   *
   * It has to be `AsyncLocalStorage` rather than a plain `Set` of held users: a
   * Set cannot tell re-entry apart from a legitimately QUEUED concurrent
   * caller, which is the entire point of the queue. (Found by this class's own
   * harness — the naive Set version threw on the expiry-sweep test, where a
   * second caller correctly arrives while the sweep holds the lock.)
   */
  private readonly activeUser = new AsyncLocalStorage<string>();

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
  ) {
    super();
  }

  /**
   * Announce that a player's mission set changed.
   *
   * Same contract as `PlayerProgressRepository.announce`: an IN-PROCESS event,
   * no I/O, and `gameStateManager` — which owns `io` — turns it into a
   * `state:delta`. The repository stays the single owner of mission state and
   * gains no knowledge of sockets.
   *
   * Added 2026-09-25. `missions` was one of two GameState slices that only
   * ever arrived in the login snapshot, while the client already exported a
   * `playerMissions` derived store — the exact trap ShopDialog fell into with
   * credits. The chokepoint argument that justified wiring progress applied
   * here verbatim and had simply not been used.
   */
  private announceMissions(userId: string): void {
    this.emit("missions:changed", { userId });
  }

  // ── LOCKING ───────────────────────────────────────────────────────────

  private async withUserLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    if (this.activeUser.getStore() === userId) {
      throw new Error(
        `PlayerMissionRepository: re-entrant call for user ${userId}. ` +
          "A mutate/mutateAll callback must not call back into this repository — " +
          "that waits on a lock the caller already holds. Move the nested work " +
          "after the callback returns.",
      );
    }

    const previous = this.chains.get(userId) ?? Promise.resolve();

    // `then(guarded, guarded)` so we run whether the previous operation
    // resolved OR rejected — one caller's failure must not deadlock everyone
    // queued behind it. Each caller still sees its own rejection, through `run`.
    const guarded = (): Promise<T> => this.activeUser.run(userId, fn);
    const run = previous.then(guarded, guarded);

    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.chains.set(userId, tail);

    try {
      return await run;
    } finally {
      if (this.chains.get(userId) === tail) this.chains.delete(userId);
    }
  }

  // ── MAPPING ───────────────────────────────────────────────────────────

  /** Table rows → the shape callers have always seen. */
  private toStored(row: Row): StoredPlayerMission {
    const objectives: StoredObjective[] = [...row.objectives]
      .sort((a, b) => a.position - b.position)
      .map((o) => {
        const isCount = o.targetCount !== null;
        const isFlag = o.targetFlag !== null;
        return {
          id: o.objectiveId,
          type: o.type,
          ...(o.description !== null ? { description: o.description } : {}),
          target: isCount ? o.targetCount! : isFlag ? o.targetFlag! : (o.targetText ?? ""),
          current: isCount ? o.currentCount : isFlag ? o.currentFlag : (o.currentText ?? ""),
          completed: o.completed,
          // R7: restore the bonus flag, or `requiredObjectivesComplete` can
          // never see it and bonus objectives stay mandatory.
          ...(o.isBonus ? { isBonus: true } : {}),
          ...(o.metadata !== null
            ? { metadata: o.metadata as Record<string, unknown> }
            : {}),
        };
      });

    return {
      missionId: row.missionId,
      userId: row.userId,
      status: row.status,
      objectives,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      expiresAt: row.expiresAt,
      ...(row.storyArcId !== null ? { storyArcId: row.storyArcId } : {}),
      ...(row.storyStep !== null ? { storyStep: row.storyStep } : {}),
      ...(row.metadata !== null ? { metadata: row.metadata } : {}),
    };
  }

  /**
   * Split a polymorphic target/current pair into the typed columns. Which pair
   * is used is decided by the runtime type of TARGET, mirroring G1 — progress
   * semantics never come from `type`.
   */
  private splitValues(o: StoredObjective) {
    const t = o.target;
    if (typeof t === "number") {
      return {
        targetCount: t,
        currentCount: typeof o.current === "number" ? o.current : 0,
        targetFlag: null,
        currentFlag: false,
        targetText: null,
        currentText: null,
      };
    }
    if (typeof t === "boolean") {
      return {
        targetCount: null,
        currentCount: 0,
        targetFlag: t,
        currentFlag: o.current === true,
        targetText: null,
        currentText: null,
      };
    }
    return {
      targetCount: null,
      currentCount: 0,
      targetFlag: null,
      currentFlag: false,
      targetText: t == null ? null : String(t),
      currentText: o.current == null ? null : String(o.current),
    };
  }

  private toDate(v: unknown): Date | null {
    if (!v) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ── READS ─────────────────────────────────────────────────────────────

  public async get(userId: string, missionId: string): Promise<StoredPlayerMission | null> {
    const row = await this.prisma.playerMission.findUnique({
      where: { userId_missionId: { userId, missionId } },
      include: { objectives: true },
    });
    return row ? this.toStored(row) : null;
  }

  public async list(userId: string): Promise<StoredPlayerMission[]> {
    const rows = await this.prisma.playerMission.findMany({
      where: { userId },
      include: { objectives: true },
    });
    return rows.map((r) => this.toStored(r));
  }

  public async has(userId: string, missionId: string): Promise<boolean> {
    const n = await this.prisma.playerMission.count({
      where: { userId, missionId },
    });
    return n > 0;
  }

  // ── WRITES ────────────────────────────────────────────────────────────

  /** Insert or replace the player's copy of one mission. */
  public async put(
    userId: string,
    missionId: string,
    mission: StoredPlayerMission,
  ): Promise<void> {
    await this.withUserLock(userId, () => this.writeMission(userId, missionId, mission));
  }

  /**
   * Read-modify-write ONE mission under the user's lock.
   *
   * The callback receives the current stored mission (or null) and may mutate
   * it in place. Return `NO_CHANGE` to skip the write; return a mission to
   * store it.
   */
  public async mutate(
    userId: string,
    missionId: string,
    fn: (
      mission: StoredPlayerMission | null,
    ) => StoredPlayerMission | typeof NO_CHANGE | Promise<StoredPlayerMission | typeof NO_CHANGE>,
  ): Promise<StoredPlayerMission | null> {
    return this.withUserLock(userId, async () => {
      const current = await this.get(userId, missionId);
      const result = await fn(current);
      if (result === NO_CHANGE) return current;
      await this.writeMission(userId, missionId, result);
      return result;
    });
  }

  /** Read-modify-write the player's whole set under their lock. */
  public async mutateAll(
    userId: string,
    fn: (
      blob: Record<string, StoredPlayerMission>,
    ) => boolean | Promise<boolean>,
  ): Promise<void> {
    await this.withUserLock(userId, async () => {
      const rows = await this.prisma.playerMission.findMany({
        where: { userId },
        include: { objectives: true },
      });
      const blob: Record<string, StoredPlayerMission> = {};
      for (const r of rows) blob[r.missionId] = this.toStored(r);

      const before = new Set(Object.keys(blob));
      const changed = await fn(blob);
      if (!changed) return;

      for (const [missionId, mission] of Object.entries(blob)) {
        await this.writeMission(userId, missionId, mission);
      }
      // Keys the callback removed are deletions.
      for (const missionId of before) {
        if (!(missionId in blob)) {
          await this.prisma.playerMission.deleteMany({ where: { userId, missionId } });
        }
      }
    });
  }

  /**
   * Upsert one mission and its objectives.
   *
   * Wrapped in a transaction so a mission never lands without its objectives —
   * with the blob that was automatic, since it was one column.
   *
   * A missing `Mission` row makes this a no-op rather than a thrown P2003: the
   * blob used to accept references to deleted missions (78 of 299 live entries
   * did exactly that) and callers are not prepared for a throw here.
   */
  private async writeMission(
    userId: string,
    missionId: string,
    mission: StoredPlayerMission,
  ): Promise<void> {
    const missionExists = await this.prisma.mission.count({ where: { id: missionId } });
    if (missionExists === 0) {
      this.logger.debug(
        { userId, missionId },
        "writeMission: no Mission row — skipping (would violate the FK)",
      );
      return;
    }

    const storyArcId = (mission.storyArcId as string | null | undefined) ?? null;
    const storyStep = (mission.storyStep as number | null | undefined) ?? null;
    const metadata = (mission.metadata ?? undefined) as never;

    await this.prisma.$transaction(async (tx) => {
      const row = await tx.playerMission.upsert({
        where: { userId_missionId: { userId, missionId } },
        create: {
          userId,
          missionId,
          status: mission.status,
          startedAt: this.toDate(mission.startedAt),
          completedAt: this.toDate(mission.completedAt),
          expiresAt: this.toDate(mission.expiresAt),
          storyArcId,
          storyStep,
          metadata,
        },
        update: {
          status: mission.status,
          startedAt: this.toDate(mission.startedAt),
          completedAt: this.toDate(mission.completedAt),
          expiresAt: this.toDate(mission.expiresAt),
          storyArcId,
          storyStep,
          metadata,
        },
        select: { id: true },
      });

      const list = mission.objectives ?? [];
      for (let i = 0; i < list.length; i++) {
        const o = list[i]!;
        const vals = this.splitValues(o);
        await tx.playerMissionObjective.upsert({
          where: {
            playerMissionId_objectiveId: { playerMissionId: row.id, objectiveId: o.id },
          },
          create: {
            playerMissionId: row.id,
            objectiveId: o.id,
            type: o.type,
            description: o.description ?? null,
            completed: o.completed === true,
            isBonus: o.isBonus === true,
            metadata: (o.metadata ?? undefined) as never,
            position: i,
            ...vals,
          },
          update: {
            type: o.type,
            description: o.description ?? null,
            completed: o.completed === true,
            isBonus: o.isBonus === true,
            metadata: (o.metadata ?? undefined) as never,
            position: i,
            ...vals,
          },
          select: { id: true },
        });
      }

      // Objectives the caller dropped.
      if (list.length > 0) {
        await tx.playerMissionObjective.deleteMany({
          where: {
            playerMissionId: row.id,
            objectiveId: { notIn: list.map((o) => o.id) },
          },
        });
      }
    });

    // Announced HERE rather than in the public mutators, because this is the
    // only place a write actually lands: `mutate` returns early on NO_CHANGE
    // and `mutateAll` returns early unless its callback returns true, so
    // announcing from those would emit deltas for writes that never happened.
    this.announceMissions(userId);
  }

  // ── PASS 2: what the blob could not express ───────────────────────────

  /**
   * Add `delta` to a COUNT objective in one statement.
   *
   * This is the fix pass 1 structurally could not make. Callers of
   * `updateObjective` pass an ABSOLUTE value computed from a `current` they
   * read themselves, so their read sits outside any lock and two concurrent
   * credits for the same objective collapse into one — no amount of
   * serialisation around the write can recover the lost one. A relative
   * `current_count = current_count + n` has no read to lose.
   *
   * `completed` is recomputed in the same statement and is STICKY (`OR`),
   * matching G1: a completed objective must not revert if a counter later drops.
   *
   * Returns the resulting value, or null if there was no such count objective
   * (boolean objectives are not incrementable and fall back to `mutate`).
   */
  public async incrementObjective(
    userId: string,
    missionId: string,
    objectiveId: string,
    delta: number,
  ): Promise<{ current: number; target: number; completed: boolean } | null> {
    if (!Number.isFinite(delta)) {
      throw new Error(`incrementObjective: delta must be finite, got ${delta}`);
    }

    // ── Takes the per-user lock, and that is NOT belt-and-braces ──────────
    // The statement below is relative and therefore safe against another
    // `incrementObjective`. It is NOT safe against `mutate`: `writeMission`
    // re-upserts EVERY objective of the mission with an absolute
    // `currentCount` taken from the copy `mutate` read at the top of its
    // callback. An increment landing in that window is overwritten with the
    // pre-increment value.
    //
    // That is reachable in normal play, not a theoretical interleave: after the
    // pass-2 conversion `missionIntegration` credits COUNT objectives through
    // `creditObjective` (this method) and BOOLEAN ones through
    // `updateObjective` (which goes through `mutate`), and a single mission
    // routinely has both — so one hook crediting the boolean can erase another
    // hook's count credit on the same mission.
    //
    // Reproduced before this fix: a +7 landing inside a concurrent boolean
    // update left `current_count` at 0. Pinned by
    // `verify-phase3-d3-mission-lock.ts`.
    return this.withUserLock(userId, async () => {
      const rows = await this.prisma.$queryRaw<
        { current_count: number; target_count: number; completed: boolean }[]
      >`
        UPDATE player_mission_objectives o
           SET current_count = o.current_count + ${Math.trunc(delta)},
               completed     = o.completed
                               OR (o.current_count + ${Math.trunc(delta)}) >= o.target_count
          FROM player_missions pm
         WHERE o.player_mission_id = pm.id
           AND pm.user_id    = ${userId}
           AND pm.mission_id = ${missionId}
           AND pm.status     = 'active'
           AND o.objective_id = ${objectiveId}
           AND o.target_count IS NOT NULL
        RETURNING o.current_count, o.target_count, o.completed
      `;

      const row = rows[0];
      if (!row) return null;
      // Raw SQL, so it never touches writeMission — announce it here.
      this.announceMissions(userId);
      return {
        current: row.current_count,
        target: row.target_count,
        completed: row.completed,
      };
    });
  }

  /**
   * True when the player's copy of the mission is complete.
   *
   * R7 REVIEW FIX: this counted EVERY objective, including bonus ones, while
   * `missionService.updateObjective` had just been changed to ignore bonus
   * objectives. That left two disagreeing definitions of "complete" on two
   * different auto-complete paths: finishing all REQUIRED objectives through
   * `updateObjective` completed the mission, while doing the same through the
   * path that calls this returned false and the mission silently never
   * finished — a progression stall, and strictly worse than before the change,
   * when both paths at least agreed.
   *
   * It now delegates to `requiredObjectivesComplete`, so the rule has exactly
   * ONE implementation. The two COUNT queries become one small SELECT;
   * objectives per mission are a handful, so this is not a hot path concern.
   */
  public async allObjectivesComplete(userId: string, missionId: string): Promise<boolean> {
    const objectives = await this.prisma.playerMissionObjective.findMany({
      where: { playerMission: { userId, missionId } },
      select: { completed: true, isBonus: true },
    });
    return requiredObjectivesComplete(objectives);
  }

  /**
   * Every active mission past its expiry, as (userId, missionId) pairs.
   *
   * THE pass-2 win for the sweep. Pass 1 had to read every player's mission
   * blob and filter in JS, because "has an expired active mission" cannot be
   * expressed as a Prisma predicate over a JSON map keyed by mission id. This
   * is one indexed query (`@@index([status, expiresAt])`).
   */
  public async findExpired(
    now: Date,
    take = 500,
  ): Promise<Array<{ userId: string; missionId: string }>> {
    return this.prisma.playerMission.findMany({
      where: { status: "active", expiresAt: { not: null, lt: now } },
      select: { userId: true, missionId: true },
      take,
    });
  }
}

export default PlayerMissionRepository;
