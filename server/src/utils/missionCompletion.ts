/**
 * Mission completion — the ONE definition of "is this mission finished".
 *
 * It lived briefly in `missionTime.ts`, a module named for time, which is
 * plausibly why a second implementation grew independently in
 * `playerMissionRepository.allObjectivesComplete`: nobody writing a repository
 * method greps a time utility for the completion rule. The two disagreed after
 * bonus objectives became optional, and a mission whose required objectives
 * were all done could stop completing entirely. One rule, one home, one
 * implementation.
 */

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
