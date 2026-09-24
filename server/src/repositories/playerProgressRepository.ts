/**
 * PlayerProgressRepository — the single place `player_progress` is mutated.
 *
 * Phase 3 D4/D5/D8. Before this existed, 43 call sites across 22 files wrote
 * this table directly, each re-deciding how to be safe, and three audit
 * findings fell straight out of that:
 *
 *   D4 — credit double-spend. Every spend was "read the balance, compare, then
 *        decrement" with the read taking no row lock (READ COMMITTED). Two
 *        concurrent buys at 1000 credits for a 600-credit item both saw 1000,
 *        both passed, and the balance went to -200 with both items granted.
 *        `shopService` at least did it inside a transaction; `aliasService` and
 *        the four `defenseCommands` upgrades did not even do that.
 *   D5 — lost updates. `missionService.grantRewards` wrote ABSOLUTE values
 *        computed from a stale read (`progress.credits + rewards.credits`)
 *        while `hackService` concurrently issued `{ increment }`. The mission
 *        write silently erased the hack's award.
 *   D8 — breakable skill caps. `increment: Math.min(gain, 100 - progress.hacking)`
 *        computes the headroom in JS from a value read outside the write, so two
 *        completions at 99 both computed `min(gain, 1)` and produced 101. Worse,
 *        several sites (`fragmentCommands` +20 hacking, `hackCommands` +25/+15,
 *        `fileAccessCommands`, `messageEncryptionService`) had NO cap at all.
 *        `traceService` is a correction to my own earlier note: it DOES floor,
 *        via `Math.min(2, progress.stealth)` — but in JS from an earlier read,
 *        so it carries the identical race in the other direction (two evasions
 *        at stealth 1 both compute 1 and both decrement, landing on -1).
 *
 * The rule here: **every mutation is one statement whose correctness does not
 * depend on a value read earlier.** Where Prisma cannot express that (clamping),
 * it drops to raw SQL rather than computing the clamp in JS.
 *
 * MEASURED 2026-09-23, so nobody over-reacts to the above: the live DB had 0
 * skills over 100, 0 negative credits, and 0 players behind their implied level.
 * These are latent defects the repository prevents structurally, not a fire.
 */
import { inject, injectable } from "tsyringe";
import { Prisma, PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { LOGGER, PRISMA_CLIENT } from "../di/tokens";

/**
 * Anything with the Prisma model methods on it — the real client or an
 * interactive-transaction client. Callers already inside a `$transaction` MUST
 * pass their `tx`, otherwise the repository's statement runs on a separate
 * connection outside their transaction and the atomicity they think they have
 * is imaginary.
 */
export type PrismaLike = PrismaClient | Prisma.TransactionClient;

/** The six skill columns. Closed set — see SKILL_COLUMNS for why that matters. */
export type SkillName =
  | "hacking"
  | "networking"
  | "cryptography"
  | "stealth"
  | "socialEng"
  | "forensics";

/**
 * Skill field -> physical column. This map is also the INJECTION GUARD: the
 * clamped update below interpolates a column name into raw SQL, which Prisma
 * cannot parameterise. Only names present here are ever interpolated, and
 * `SkillName` keeps the compiler honest about the caller's side.
 */
const SKILL_COLUMNS: Record<SkillName, string> = {
  hacking: "hacking",
  networking: "networking",
  cryptography: "cryptography",
  stealth: "stealth",
  socialEng: "social_engineering",
  forensics: "forensics",
};

/** Skills are 0-100 everywhere in the game (schema comment on PlayerProgress). */
export const SKILL_MIN = 0;
export const SKILL_MAX = 100;

/** The plain `Int` stat counters. Closed set for the same reason as skills. */
export type CounterName =
  | "commandsExecuted"
  | "successfulHacks"
  | "failedHacks"
  | "missionsCompleted"
  | "serversDiscovered"
  | "filesAccessed"
  | "messagesSent";

export interface SpendResult {
  ok: boolean;
  /** Balance AFTER the spend when ok, the unchanged balance when not. */
  balance: number;
  /** Only set when !ok — how many more credits were needed. */
  shortfall?: number;
}

export interface ExperienceResult {
  experience: number;
  level: number;
  previousLevel: number;
  leveledUp: boolean;
}

/**
 * Canonical level curve. There were TWO identical private copies of this
 * (`missionService` and `missionGenerator`); duplicated derivations drift, and
 * this one decides mission difficulty matching, shop `requiredLevel` gates and
 * the player's base CPU/RAM/bandwidth.
 */
export function levelForExperience(experience: number): number {
  return Math.floor(Math.sqrt(Math.max(0, experience) / 100)) + 1;
}

@injectable()
export class PlayerProgressRepository {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
  ) {}

  private db(tx?: PrismaLike): PrismaLike {
    return tx ?? this.prisma;
  }

  // ── CREDITS ───────────────────────────────────────────────────────────

  /**
   * Grant credits. Always an `increment`, never an absolute write — that is the
   * D5 half of the fix, and it is why this returns the new balance rather than
   * letting the caller compute one.
   */
  public async addCredits(userId: string, amount: number, tx?: PrismaLike): Promise<number> {
    const n = this.normalizeAmount(amount, "addCredits");
    if (n === null) return this.readCredits(userId, tx);
    const rows = await this.db(tx).playerProgress.updateMany({
      where: { userId },
      data: { credits: { increment: n } },
    });
    if (rows.count === 0) {
      // updateMany, not update: a missing row matches zero and returns quietly
      // instead of throwing P2025. Persona/NPC accounts legitimately have no
      // PlayerProgress, and that exact throw used to log a Prisma error on
      // every persona mail delivered.
      this.logger.debug({ userId, amount }, "addCredits: no PlayerProgress row");
      return 0;
    }
    return this.readCredits(userId, tx);
  }

  /**
   * D4 — spend credits atomically.
   *
   * The balance check lives in the WHERE clause, so the read and the write are
   * the same statement and no lock is needed: a concurrent spender either
   * matches (and decrements) or matches nothing. `rows.count` IS the
   * authorization result; there is no window between deciding and acting.
   *
   * Callers must treat `ok: false` as "the purchase did not happen".
   */
  public async spendCredits(userId: string, amount: number, tx?: PrismaLike): Promise<SpendResult> {
    const n = this.normalizeAmount(amount, "spendCredits");
    if (n === null) return { ok: true, balance: await this.readCredits(userId, tx) };
    const rows = await this.db(tx).playerProgress.updateMany({
      where: { userId, credits: { gte: n } },
      data: { credits: { decrement: n } },
    });

    if (rows.count === 0) {
      const balance = await this.readCredits(userId, tx);
      return { ok: false, balance, shortfall: Math.max(0, n - balance) };
    }
    return { ok: true, balance: await this.readCredits(userId, tx) };
  }

  private async readCredits(userId: string, tx?: PrismaLike): Promise<number> {
    const row = await this.db(tx).playerProgress.findUnique({
      where: { userId },
      select: { credits: true },
    });
    return row?.credits ?? 0;
  }

  // ── EXPERIENCE & LEVEL ────────────────────────────────────────────────

  /**
   * D5 — add experience atomically and keep `level` in step with it.
   *
   * Two statements, and the order matters:
   *   1. `experience = experience + n RETURNING experience` — atomic, no stale read.
   *   2. raise `level` only `where: { level: { lt: newLevel } }` — MONOTONIC, so
   *      concurrent grants cannot lower it and a lost update self-heals on the
   *      next grant rather than sticking.
   *
   * **This also fixes something the audit did not list.** `level` was written by
   * exactly ONE code path — `missionService.grantRewards` — and otherwise only
   * ever set to 1 at row creation. XP awarded by `hackService`,
   * `darknetDungeonService`, `messageEncryptionService` and `fileAccessCommands`
   * never recomputed it, so a player who only hacked would accumulate
   * experience and stay level 1 forever. It has never actually bitten: measured
   * 2026-09-23, the highest real XP total in the DB was 80 and level 2 needs
   * 100, so nobody had crossed a threshold yet.
   *
   * Returns `leveledUp` so the CALLER emits the socket event — the repository
   * deliberately does no I/O beyond the database.
   */
  public async addExperience(userId: string, amount: number, tx?: PrismaLike): Promise<ExperienceResult> {
    const n = this.normalizeAmount(amount, "addExperience");
    const db = this.db(tx);
    if (n === null) {
      const cur = await db.playerProgress.findUnique({
        where: { userId }, select: { experience: true, level: true },
      });
      return {
        experience: cur?.experience ?? 0, level: cur?.level ?? 1,
        previousLevel: cur?.level ?? 1, leveledUp: false,
      };
    }

    const updated = await db.$queryRaw<{ experience: number; level: number }[]>`
      UPDATE player_progress
         SET experience = experience + ${n}
       WHERE user_id = ${userId}
      RETURNING experience, level
    `;
    const row = updated[0];
    if (!row) {
      this.logger.debug({ userId, amount }, "addExperience: no PlayerProgress row");
      return { experience: 0, level: 1, previousLevel: 1, leveledUp: false };
    }

    const previousLevel = row.level;
    const newLevel = levelForExperience(row.experience);

    // `leveledUp` comes from the ROWCOUNT, not from comparing against the level
    // this call happened to read. The comparison is a read-then-decide across
    // two statements: two grants resolving together both see the pre-raise
    // level, both compute `newLevel > previousLevel`, and BOTH report a
    // level-up — so the player gets two "You reached Level 2!" toasts and every
    // internal listener fires twice. The conditional update is already the
    // arbiter: exactly one writer matches `level < newLevel` and raises it, and
    // that writer is the one entitled to announce it.
    let raised = false;
    if (newLevel > previousLevel) {
      const rows = await db.playerProgress.updateMany({
        where: { userId, level: { lt: newLevel } },
        data: { level: newLevel },
      });
      raised = rows.count > 0;
    }

    return {
      experience: row.experience,
      level: Math.max(previousLevel, newLevel),
      previousLevel,
      leveledUp: raised,
    };
  }

  // ── SKILLS ────────────────────────────────────────────────────────────

  /**
   * D8 — move a skill by `delta`, clamped to [0, 100] BY THE DATABASE.
   *
   * `GREATEST(0, LEAST(100, col + delta))` is evaluated inside the UPDATE, so
   * the clamp reads the same row version it writes. That is the whole point:
   * every previous site computed headroom in JS from an earlier read
   * (`Math.min(gain, 100 - progress.hacking)`), which two concurrent writers can
   * both satisfy and still overshoot.
   *
   * Negative deltas get the same treatment at the bottom of the range, which is
   * what `traceService`'s stealth penalty needs: it floored correctly but did so
   * in JS from an earlier read, so concurrent evasions could still go negative.
   *
   * Returns the resulting value, so callers can report what actually landed
   * rather than what they asked for.
   */
  public async addSkill(userId: string, skill: SkillName, delta: number, tx?: PrismaLike): Promise<number> {
    if (!Number.isInteger(delta)) {
      throw new Error(`addSkill: delta must be an integer, got ${delta}`);
    }
    const column = SKILL_COLUMNS[skill];
    if (!column) {
      // Unreachable through the type system; guards a JS caller or a future
      // skill added to the union without a column mapping.
      throw new Error(`addSkill: unknown skill "${skill}"`);
    }

    const rows = await this.db(tx).$queryRawUnsafe<{ value: number }[]>(
      `UPDATE player_progress
          SET "${column}" = GREATEST($1::int, LEAST($2::int, "${column}" + $3::int))
        WHERE user_id = $4
       RETURNING "${column}" AS value`,
      SKILL_MIN,
      SKILL_MAX,
      delta,
      userId,
    );

    if (!rows[0]) {
      this.logger.debug({ userId, skill, delta }, "addSkill: no PlayerProgress row");
      return 0;
    }
    return rows[0].value;
  }

  /**
   * Apply several skill deltas. Sequential rather than one statement because
   * each column still needs its own clamp; grouped here so callers that award
   * two skills at once (`crack.storm`: +25 cryptography, +15 hacking) read as
   * one intent.
   */
  public async addSkills(
    userId: string,
    deltas: Partial<Record<SkillName, number>>,
    tx?: PrismaLike,
  ): Promise<Partial<Record<SkillName, number>>> {
    const result: Partial<Record<SkillName, number>> = {};
    for (const [skill, delta] of Object.entries(deltas) as [SkillName, number][]) {
      if (!delta) continue;
      result[skill] = await this.addSkill(userId, skill, delta, tx);
    }
    return result;
  }

  // ── COUNTERS ──────────────────────────────────────────────────────────

  /**
   * Bump a stat counter. `updateMany` so a missing row is a silent no-op — these
   * are fire-and-forget telemetry and must never be able to fail a command.
   */
  public async incrementCounter(
    userId: string,
    counter: CounterName,
    by = 1,
    tx?: PrismaLike,
  ): Promise<void> {
    await this.db(tx).playerProgress.updateMany({
      where: { userId },
      data: { [counter]: { increment: by } },
    });
  }

  /** Bump several counters in one statement. */
  public async incrementCounters(
    userId: string,
    counters: Partial<Record<CounterName, number>>,
    tx?: PrismaLike,
  ): Promise<void> {
    const data: Record<string, { increment: number }> = {};
    for (const [name, by] of Object.entries(counters)) {
      if (by) data[name] = { increment: by };
    }
    if (Object.keys(data).length === 0) return;
    await this.db(tx).playerProgress.updateMany({ where: { userId }, data });
  }

  // ── GUARDS ────────────────────────────────────────────────────────────

  /**
   * Normalise a grant/spend amount, or throw.
   *
   * NEGATIVE still throws — a negative "grant" is a credit-minting hole of
   * exactly the shape S2 closed at the shop command layer, and the repository
   * is the second boundary, not the only one.
   *
   * ZERO and fractional do NOT throw, and that is a correction. Every call site
   * this replaced issued a relative Prisma update, where `0` was a harmless
   * no-op; making it throw turned benign data into a thrown error at sites that
   * had already committed something. Two real examples:
   *   - `playerInfoCommands` claims a bounty and THEN grants
   *     `bounty.rewardCredits`. A zero-reward bounty would be burned and the
   *     command would fail with "Command execution failed".
   *   - `darknetDungeonService` grants amounts straight out of AI-authored
   *     `rewardData`; a fractional value would throw inside `safeExecute`,
   *     which swallows it — the player conquers a dungeon and receives nothing,
   *     with no error anywhere. That is the exact failure the R8 fix was for.
   *
   * @returns the truncated amount, or null when there is nothing to do.
   */
  private normalizeAmount(amount: number, method: string): number | null {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error(`${method}: amount must be a non-negative number, got ${amount}`);
    }
    const whole = Math.trunc(amount);
    if (whole !== amount) {
      this.logger.debug(
        { method, amount, whole },
        "non-integer amount truncated",
      );
    }
    return whole === 0 ? null : whole;
  }
}

export default PlayerProgressRepository;
