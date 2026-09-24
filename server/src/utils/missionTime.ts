/**
 * R7 — the one place `Mission.timeLimit` is converted.
 *
 * The field was written in two different units and read in a third
 * assumption:
 *
 *   - `missionGenerator.generateFromTemplate` stored `seconds * 1000` (ms)
 *   - `missionGenerator`'s AI path stored `difficulty * 60 * 60 * 1000` (ms)
 *   - `personaMissionGenService` stored the raw template value (seconds)
 *   - all THREE readers multiplied by 1000, i.e. assumed seconds
 *
 * So every mission from the first two producers got an expiry 1000x too long:
 * a template that documents itself as "1–2 hours" expired in 41–83 days.
 * Measured on the dev database at the time of the fix, 187 of 187 missions
 * carrying a `timeLimit` held a millisecond-scale value — mission expiry was
 * effectively disabled game-wide.
 *
 * SECONDS is canonical. It is what every human-authored source already uses
 * (`missionTemplatePool` comments 3600–7200 as "1–2 hours"; the minigame
 * configs in `gameBalance` are seconds and the challenge UI prints "s"), and
 * it is what all three readers already expected — so the fix lands on the two
 * producers rather than on the readers.
 *
 * Nothing outside this module should multiply or divide a `timeLimit`.
 */

/** Milliseconds in one second — named so the conversions below read as intent. */
const MS_PER_SECOND = 1000;

/**
 * Convert a stored `Mission.timeLimit` (SECONDS) to milliseconds, for
 * comparison against `Date` arithmetic.
 */
export function missionTimeLimitMs(
  timeLimitSeconds: number | null | undefined,
): number | null {
  if (timeLimitSeconds === null || timeLimitSeconds === undefined) return null;
  if (!Number.isFinite(timeLimitSeconds) || timeLimitSeconds <= 0) return null;
  return timeLimitSeconds * MS_PER_SECOND;
}

/**
 * The absolute expiry for a mission accepted at `from`, or null when the
 * mission has no time limit.
 */
export function missionExpiresAt(
  timeLimitSeconds: number | null | undefined,
  from: Date = new Date(),
): Date | null {
  const ms = missionTimeLimitMs(timeLimitSeconds);
  if (ms === null) return null;
  return new Date(from.getTime() + ms);
}

/**
 * R7 — the flat multiplier that the "stealth" and "efficiency" bonuses really
 * were.
 *
 * `stealthScore` and `efficiencyScore` derive from `detectionCount` and
 * `hintCount`, which nothing in the codebase ever writes. Both scores were
 * therefore pinned at 100, both thresholds always passed, and every completed
 * mission received +0.2 +0.15 while the code read as though it were grading
 * the player. Keeping the value preserves payouts; naming it stops the lie.
 *
 * Wiring real detection/hint tracking is feature work, not a repair — see the
 * R7 notes in PLAN.md.
 */
export const BASELINE_COMPLETION_BONUS = 0.35;

/** An objective as stored on a PlayerMission, for completion purposes. */
interface CompletableObjective {
  completed: boolean;
  isBonus?: boolean;
}

/**
 * R7 — is the mission complete?
 *
 * Bonus objectives do not gate completion. The template type documents
 * `isBonus` as "failure doesn't fail the mission", but the completion check
 * was `objectives.every(o => o.completed)` with no exclusion, so the 39 bonus
 * objectives in the template pool were mandatory in practice — which is also
 * why `bonusObjectivesCompleted` could never be positive.
 *
 * If a mission somehow consists only of bonus objectives, fall back to
 * requiring all of them: "no required objectives" must not mean "complete
 * immediately".
 */
export function requiredObjectivesComplete(
  objectives: readonly CompletableObjective[],
): boolean {
  if (objectives.length === 0) return false;
  const required = objectives.filter((o) => !o.isBonus);
  const gating = required.length > 0 ? required : objectives;
  return gating.every((o) => o.completed);
}
