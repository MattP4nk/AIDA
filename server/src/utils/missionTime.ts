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
