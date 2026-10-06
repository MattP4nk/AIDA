/**
 * How likely a tap of a given quality is to intercept an event.
 *
 * Extracted as a pure function on purpose. The old rule lived inline in
 * `shouldReceiveEvent` as `Math.random() < subscription.quality / 100` behind
 * an `if (severity === INFO && quality < 30)` guard, which made it both
 * untestable and almost always dead — quality 30 and quality 100 behaved
 * identically for every event in the game.
 *
 * Here the probability is a value you can assert on without mocking the RNG,
 * and the roll happens at exactly one call site.
 */
import { TAP_SEVERITY_FLOOR } from "../config/gameBalance";

/**
 * Returns 0..1.
 *
 * Two properties the harness pins, because they are what make the tiers
 * meaningful rather than decorative:
 *   - monotonic in quality (a better tap is never worse), and
 *   - exactly 1 for CRITICAL at every purchasable tier, so the loud events are
 *     deterministic and a player is never left guessing whether their tap
 *     silently dropped a breach.
 */
export function interceptChance(quality: number, severity: string): number {
  const q = Math.max(0, Math.min(100, Number.isFinite(quality) ? quality : 0)) / 100;
  // An unrecognised severity is treated as the quietest case rather than
  // defaulting to "always deliver" — an unknown event type should not become
  // the most reliable thing a cheap tap can hear.
  const floor = TAP_SEVERITY_FLOOR[severity] ?? 1.0;
  if (floor <= 0) return 1;
  return Math.min(1, q / floor);
}

/** The roll. Separated so the decision above stays deterministic and testable. */
export function intercepts(quality: number, severity: string): boolean {
  const chance = interceptChance(quality, severity);
  if (chance >= 1) return true;
  if (chance <= 0) return false;
  return Math.random() < chance;
}
