/**
 * missionTemplatePool.ts — lookup and selection over the mission catalogue.
 *
 * The catalogue itself is `missionTemplateData.ts`. This module owns the Map,
 * the query helpers, and nothing else; before the A8 split it was 2,199 lines
 * of which 1,900 were one array literal.
 *
 * Templates reference canonical objective types, validated at generation time
 * against the vocabulary in missionObjectiveTypes.ts — not here.
 *
 * COUNTS ARE NOT LISTED HERE ANY MORE. This header used to claim "29
 * templates" in tiers of 5/6/6/6/6; the catalogue actually holds 39 in
 * 5/10/10/8/6, so every number in it was wrong and had been for long enough
 * that nobody noticed. A count in a docstring is a claim that rots silently —
 * `MISSION_TEMPLATES.size` and `getTemplatesByTier(n).length` cannot.
 * `scripts/verify-phase7-a8-templates.ts` pins both.
 */

import { templates } from "./missionTemplateData";
import type { MissionTemplate } from "./missionTemplateData";

// The catalogue lives in `missionTemplateData.ts`; every type and the tier
// table are re-exported here so the nine consumers of this module keep
// importing from one place and none of them had to change.
//
// ALL FOUR interfaces are re-exported, not just the ones I assumed were used:
// `RewardScaling` is imported by personaMissionGenService, which the compiler
// pointed out after I guessed the list instead of reading it.
export { TIER_DEFINITIONS } from "./missionTemplateData";
export type {
  MissionTemplate,
  ObjectiveTemplate,
  RewardScaling,
  TierDefinition,
} from "./missionTemplateData";

// ────────────────────────────────────────────────────────────────────────────
// Primary Index — all 35 templates keyed by ID
// ────────────────────────────────────────────────────────────────────────────

/**
 * Master map of every mission template, keyed by `template.id`.
 *
 * @example
 *   const tpl = MISSION_TEMPLATES.get("ghost_protocol");
 */
export const MISSION_TEMPLATES: Map<string, MissionTemplate> = new Map(
  templates.map((t) => [t.id, t]),
);

// ────────────────────────────────────────────────────────────────────────────
// Query Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return all templates belonging to a specific tier.
 *
 * @param tier — 1 through 5
 * @returns Array of templates (empty if tier is invalid).
 *
 * @example
 *   const beginnerTemplates = getTemplatesByTier(1); // 5 templates
 */
export function getTemplatesByTier(tier: number): MissionTemplate[] {
  return templates.filter((t) => t.tier === tier);
}

/**
 * Return all templates that list a given faction in their `factionAffinity`.
 *
 * Templates without a `factionAffinity` field are **excluded** — they are
 * considered faction-neutral and should be retrieved via other queries.
 *
 * @param factionId — e.g. "garrison", "dothackers", "cybercorp", "darknet"
 * @returns Matching templates.
 *
 * @example
 *   const darknetMissions = getTemplatesByFaction("darknet");
 */
export function getTemplatesByFaction(factionId: string): MissionTemplate[] {
  return templates.filter(
    (t) => t.factionAffinity && t.factionAffinity.includes(factionId),
  );
}

/**
 * Return templates whose level range contains `playerLevel`, optionally
 * narrowed to a specific faction's affinity pool.
 *
 * When `factionId` is provided, the result includes:
 *   1. Templates whose `factionAffinity` includes the factionId, AND
 *   2. Templates with **no** `factionAffinity` (faction-neutral).
 *
 * This ensures players always have access to generic missions alongside
 * faction-specific ones.
 *
 * @param playerLevel — the player's current level
 * @param factionId   — optional faction filter
 * @returns Eligible templates sorted by tier ascending.
 *
 * @example
 *   const missions = getEligibleTemplates(12, "garrison");
 */
export function getEligibleTemplates(
  playerLevel: number,
  factionId?: string,
): MissionTemplate[] {
  return templates
    .filter((t) => {
      // Level range check
      if (playerLevel < t.minLevel || playerLevel > t.maxLevel) {
        return false;
      }
      // Faction filter (if provided)
      if (factionId) {
        const hasFactionAffinity =
          t.factionAffinity && t.factionAffinity.length > 0;
        if (hasFactionAffinity && !t.factionAffinity!.includes(factionId)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => a.tier - b.tier);
}

/**
 * Weighted random selection from a set of templates, favouring templates
 * whose level midpoint is closest to the player's current level.
 *
 * Weight formula:
 *   weight = 1 / (1 + |midpoint - playerLevel|)
 *
 * This produces a smooth bell-curve bias towards appropriately-levelled
 * content while still allowing outlier picks for variety.
 *
 * @param candidateTemplates — pre-filtered list of eligible templates
 * @param playerLevel        — used to compute distance-based weights
 * @returns A single selected template, or `undefined` if the input is empty.
 *
 * @example
 *   const eligible = getEligibleTemplates(25);
 *   const pick = selectWeightedTemplate(eligible, 25);
 */
export function selectWeightedTemplate(
  candidateTemplates: MissionTemplate[],
  playerLevel: number,
): MissionTemplate | undefined {
  if (candidateTemplates.length === 0) {
    return undefined;
  }

  // Single candidate — skip math
  if (candidateTemplates.length === 1) {
    return candidateTemplates[0];
  }

  // Compute weights based on level midpoint proximity
  const weights = candidateTemplates.map((t) => {
    const midpoint = (t.minLevel + t.maxLevel) / 2;
    const distance = Math.abs(midpoint - playerLevel);
    return 1 / (1 + distance);
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < candidateTemplates.length; i++) {
    random -= weights[i]!;
    if (random <= 0) {
      return candidateTemplates[i];
    }
  }

  // Floating-point safety — return the last template
  return candidateTemplates[candidateTemplates.length - 1]!;
}

