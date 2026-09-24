/**
 * Mission reward bounds — the ONE place a reward value is validated.
 *
 * S5c. `Mission.reward` is a Json column written from AI output. The path was
 * unguarded end to end:
 *
 *   aiOutputValidator.ts:283-290   `data: i.data`        — passed through untouched
 *   architectInterventionExecutor  `data.reward as Record<string, unknown>`
 *   missionService.createMission   `reward: data.reward as any`   — straight to Prisma
 *   missionService.calculateRewards `mission.reward as unknown as MissionRewards`
 *   missionService.grantRewards    `if (rewards.credits > 0) addCredits(...)`
 *
 * Four casts, no schema, and the only guard on payout is `> 0`. An Architect
 * response carrying `data.reward = { credits: 1e9, xp: 1e9 }` was written
 * verbatim and later granted in full. That matters because AI output is
 * player-influenced: the agent loop reads player-authored files and forum
 * posts unsanitized, so this is reachable, not merely hypothetical.
 *
 * Two subtleties that shaped this module:
 *
 *  1. **Type confusion multiplies.** `calculateRewards` computes
 *     `baseRewards.credits * multiplier`, and JS coerces — so the STRING
 *     `"1000000000"` is not caught by a naive `typeof === "number"` check
 *     downstream, it just multiplies. Values are coerced and range-checked
 *     here rather than trusted.
 *
 *  2. **The payout is the stored value times a multiplier**, not the stored
 *     value. `calculateRewards` can reach ~2.35x (1.0 base + 0.5 time + 0.15
 *     efficiency + 0.2 baseline + 0.1 per bonus objective), so clamping only
 *     at write would leave the granted amount unbounded by that factor.
 *     Clamp at both ends.
 *
 * Bounds are DERIVED from the largest hand-authored template, not invented:
 * `missionTemplatePool.ts:1559-1561` is the richest in the game at
 * `credits {base: 50000, perLevel: 1000}` / `xp {base: 10000, perLevel: 100}`.
 * Even at an implausible level 200 that is 250k credits and 30k xp stored,
 * and ~587k credits granted after the maximum multiplier. The caps below sit
 * above that with room to spare, so no legitimate mission is altered — while
 * still rejecting the 1e9 case by three orders of magnitude.
 */

/** Ceiling on credits, stored or granted. ~4x the richest legitimate mission. */
export const MAX_MISSION_CREDITS = 1_000_000;
/** Ceiling on XP, stored or granted. ~3x the richest legitimate mission. */
export const MAX_MISSION_XP = 100_000;
/** Reputation is a small per-faction nudge; the richest template grants 50. */
export const MAX_MISSION_REPUTATION = 1_000;
/** The richest template grants 5. */
export const MAX_MISSION_SKILL_POINTS = 50;
/** Arrays are bounded so a model cannot emit a million item names. */
export const MAX_MISSION_ITEMS = 25;
/** Difficulty is a 1-10 scale; seeds use 0-1, templates go higher. */
export const MIN_MISSION_DIFFICULTY = 1;
export const MAX_MISSION_DIFFICULTY = 10;

export interface BoundedMissionRewards {
  xp: number;
  credits: number;
  items: string[];
  reputation: number;
  skillPoints: number;
  unlocks: string[];
}

/**
 * Coerce an unknown value to a finite number within [0, max].
 *
 * Non-finite input (undefined, null, NaN, Infinity, objects, unparseable
 * strings) becomes `fallback` rather than propagating: `NaN` survives
 * arithmetic silently and only disappears at the `> 0` guard, which reads as
 * "no reward" instead of "malformed reward".
 */
function boundedNumber(
  raw: unknown,
  max: number,
  fallback = 0,
): { value: number; clamped: boolean } {
  const n = typeof raw === "number" ? raw : Number(raw);
  // Review: a value that was PRESENT but unusable counts as clamped. The
  // previous reporter gated on `Number.isFinite(raw)`, so `{credits: "a lot"}`
  // — the most malformed input, and the likeliest AI garbage — was silently
  // zeroed with no warning at all. CLAUDE.md shape #5: a guard that guards
  // nothing, blind to exactly the case it existed for.
  if (!Number.isFinite(n)) {
    return { value: fallback, clamped: raw !== undefined && raw !== null };
  }
  if (n <= 0) return { value: 0, clamped: n < 0 };
  return { value: Math.floor(Math.min(n, max)), clamped: n > max };
}

function boundedStringArray(raw: unknown, max: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .slice(0, max)
    .map((v) => v.slice(0, 200));
}

/**
 * Normalise and clamp any reward blob — AI-authored, admin-authored, or an
 * old row written before these bounds existed. Total function: every input
 * yields a valid reward object.
 */
export function boundMissionRewardsWithReport(raw: unknown): {
  rewards: BoundedMissionRewards;
  clamped: string[];
} {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  // `xp` is the field the payout reads (missionService.MissionRewards), but
  // shared/types/mission.ts calls it `experience`. Accept either rather than
  // silently zeroing a reward authored against the other shape.
  const xpRaw = r.xp ?? r.experience;

  const xp = boundedNumber(xpRaw, MAX_MISSION_XP);
  const credits = boundedNumber(r.credits, MAX_MISSION_CREDITS);
  const reputation = boundedNumber(r.reputation, MAX_MISSION_REPUTATION);
  const skillPoints = boundedNumber(r.skillPoints, MAX_MISSION_SKILL_POINTS);
  const items = boundedStringArray(r.items, MAX_MISSION_ITEMS);
  const unlocks = boundedStringArray(r.unlocks, MAX_MISSION_ITEMS);

  const clamped: string[] = [];
  if (xp.clamped) clamped.push("xp");
  if (credits.clamped) clamped.push("credits");
  if (reputation.clamped) clamped.push("reputation");
  if (skillPoints.clamped) clamped.push("skillPoints");
  if (Array.isArray(r.items) && r.items.length > items.length) clamped.push("items");
  if (Array.isArray(r.unlocks) && r.unlocks.length > unlocks.length) clamped.push("unlocks");

  return {
    rewards: {
      xp: xp.value,
      credits: credits.value,
      items,
      reputation: reputation.value,
      skillPoints: skillPoints.value,
      unlocks,
    },
    clamped,
  };
}

export function boundMissionRewards(raw: unknown): BoundedMissionRewards {
  return boundMissionRewardsWithReport(raw).rewards;
}

export function boundMissionDifficulty(raw: unknown, fallback = 3): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_MISSION_DIFFICULTY, Math.max(MIN_MISSION_DIFFICULTY, Math.floor(n)));
}
