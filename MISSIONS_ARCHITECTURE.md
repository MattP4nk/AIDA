# Mission System — Architecture Reference

**Written 2026-08-31.** Produced after three consecutive attempts to fix missions by patching
symptoms, two of which were wrong because I had no model of the system. The maintainer stopped the
work and asked for a full read first. This document is that read.

Scope: 7,425 lines across `missionService.ts` (1616), `missionTemplatePool.ts` (2199),
`missionIntegration.ts` (1118), `missionGenerator.ts` (863), `missionCommands.ts` (850),
`missionObjectiveTypes.ts` (779). All line references are as of this date and will drift — prefer the
symbol names.

---

## 1. The central fact: state lives in two places

| | `Mission` table | `PlayerProgress.missionProgress` (JSON) |
|---|---|---|
| Cardinality | one row per mission, **globally shared** | one blob per player, `Record<missionId, PlayerMission>` |
| Definition | `title, description, type, difficulty, reward, timeLimit, targetServerId, factionId, storyArcId, prerequisiteTemplateIds, expiresAt, …` | none — re-fetched and merged at read time (`missionService.ts:487-500`) |
| State | `status`, `assignedTo` | `status`, `startedAt`, `completedAt`, `expiresAt` |
| Objectives | `objectives` — **template**: `current` seeded to 0/false | `objectives[]` — **live per-player progress**, the only copy ever advanced |

`PlayerMission` = `{ missionId, userId, status, objectives, startedAt, completedAt, expiresAt }`
(`missionService.ts:89-97`).

**Read asymmetry, and it governs everything:**
- `getPlayerMissions()` reads **only the blob**.
- `getAvailableMissions()`, the tutorial's position check, token gating, and both admin routes read
  **only the table**.

Nothing ever writes progress back into `Mission.objectives`. The table copy is a per-instance
template; the blob copy is the player's.

### 1a. Offers are PER PLAYER — this is the thing I got wrong

`missionGenerator` creates level-scaled `Mission` rows and then **writes each one into that player's
own blob with `status: "available"`** (`missionGenerator.ts:178-205`), with the explicit comment
*"so they appear in getPlayerMissions() results."*

So the intended flow is coherent:

```
missions  → player has no "available" blob entries
          → generateMissionsForPlayer(userId, 5)
          → creates Mission rows (level-scaled to THIS player)
          → writes them into THIS player's blob as "available"
missions  → panel's AVAILABLE section lists them, numbered
accept N  → blob entry "available" → "active"
play      → missionIntegration credits blob objectives
          → all complete → completeMission → rewards
```

There is no "anonymous offer pool to be claimed". Treating it as one (as I briefly did) breaks the
per-player level scaling and permits two players to hold the same mission.

---

## 2. Producers — 9 paths, 5 through one chokepoint

`MissionService.createMission()` (`missionService.ts:168-205`) hardcodes `status: "available"`,
`assignedTo: null`, `expiresAt: null`, and **never touches the blob**.

| Path | status (row / blob) | assignedTo | writes blob? | trigger |
|---|---|---|---|---|
| `createMission` | `available` / — | `null` | no | called by the five below |
| **`missionGenerator`** | `available` / `available` | `null` | **yes** | `missions` when the player has no offers; midnight cron `generateDailyMissions()` |
| `storyMissionService` (raw create) | `available` / **`active`** | player | **yes** | story-arc step advance |
| `tutorialService` | **`active`** / `active` | `userId` | **yes** | first login; `advanceTutorial()` |
| `adminApi/missions` (raw create) | `available` / — | `null` | **no** | admin POST |
| `contentDraftService` (raw create) | `available` / — | `null` | **no** | draft approval |
| `personaMissionGenService` | `available` / — | `null` | **no** | AI faction-leader generation |
| `personaActionService` | `available` / — | `null` | **no** | persona `issue_mission` |
| `architectInterventionExecutor` | `available` / — | `null` | **no** | Architect intervention |

**Consequence:** the six "no blob" producers create rows that no player can ever see, because
`getPlayerMissions` reads only the blob and `acceptMission` requires a blob entry. Only the generator,
tutorial, and story paths produce *reachable* missions. Everything the AI personas and the admin panel
create is currently inert.

**Why the tutorial always worked and generated missions never did:** the tutorial writes
`status: "active"` straight into the blob, skipping the offer/accept flow entirely. It was the only
exercised path.

---

## 3. Status vocabulary is broken in three directions

Declared in `shared/types/mission.ts:18-25`:
`AVAILABLE, ASSIGNED, IN_PROGRESS, COMPLETED, FAILED, EXPIRED`.

| Value | Occurrences in `src/` | Reality |
|---|---|---|
| `active` | **118** | The dominant status. **Not in the shared enum.** Shipped to the client via an unchecked `as MissionStatus` cast (`gameStateManager.ts:399`), so the client receives a value its own enum does not contain. |
| `available` | 29 | Fine |
| `assigned` | 18 reads | **Written only by `assignMission()`, which has zero callers.** Unreachable. `missionCommands` even rewrites it to `available` for display. |
| `in_progress` | 1 | **Declared but never written.** Its only appearance is a dead filter branch in an admin query. |
| `completed` | 43 | Fine |
| `failed` | 37 | Row-level `failed` is written only by story-arc abandon, and nothing reads it |
| `expired` | 10 | **Blob only.** `Mission.status` never takes this value. |
| `abandoned` | 2 | Written by `storyMissionService`. **Not declared.** |

The server's local union (`missionService.ts:78-84`) has `active` and lacks `in_progress` — the two
type definitions over the same column are irreconcilable.

---

## 4. Where the two stores disagree

| Operation | Row | Blob | Effect |
|---|---|---|---|
| **Abandon** | → `available`, `assignedTo: null` | → `failed` | Mission is re-offered but the stale `failed` blob entry makes `acceptMission` throw. **Permanently un-retakeable yet permanently visible.** |
| **Expiry sweep** | → `available` | → `expired` | Same trap. Also recycles the mission with the player's partial progress intact. |
| **Story creation** | `available` | `active` | Row stays `available` forever while being played, so it leaks into `getAvailableMissions()`. |
| **Story arc abandon** | → `failed` | untouched (`active`) | `missionIntegration` keeps crediting objectives and `completeMission` **still pays out** for a dead arc. |
| **Admin PUT** | any status/objectives | untouched | Mission completes against a superseded definition. |
| **`cleanupExpiredMissions`** | deletes rows | untouched | Orphan blob keys → render as "Unknown Mission". Zero callers today. |

---

## 5. Expiry

- **Live checker:** `checkExpiredMissions()` (`missionService.ts:1475-1531`), started at boot, every
  15 min. Full `playerProgress.findMany()` — whole-table scan, no filter. Expires iff blob status is
  `active` **and** blob `expiresAt < now`. Ignores `Mission.expiresAt` and `Mission.timeLimit`.
- **`timeLimit` is wrong by 1000×.** Templates declare **seconds**
  (`missionTemplatePool.ts:198` — `{min:3600,max:7200} // 1–2 hours`); the generator converts to
  **milliseconds** before storing; then `expiresAt = now + timeLimit * 1000` treats the stored ms as
  seconds. **Generated missions expire in ~41–83 days**, and the time-bonus reward therefore always
  pays. `personaMissionGenService` and `storyMissionService` store the same field in seconds — so the
  column has two incompatible units depending on producer.
- `createMission` hardcodes `expiresAt: null`, so only story missions have row-level expiry at all.

---

## 6. Templates

39 templates (`missionTemplatePool.ts`; its own header comment says 35 — stale), 5 tiers from
Script Kiddie (1–5) to Ghost (50–100). Selection is level-weighted with per-batch dedup.

**Three independent instantiators, no shared code:** `missionGenerator.generateFromTemplate()`,
`storyMissionService`, `personaMissionGenService.fillObjectivesFromKnowledge()`. They mint objective
ids differently and only one deep-copies `metadata` — the other two copy **by reference** from a
module-level singleton. Currently safe only because both patchers *reassign* rather than mutate; a
single in-place `obj.metadata.serverId = …` would contaminate the template for every player for the
process lifetime.

`prerequisites` / `Mission.prerequisiteTemplateIds` are declared and **never read**. Prerequisites are
not enforced.

---

## 7. Defect register, worst first

| # | Defect | Impact |
|---|---|---|
| **M1** | Generation guard was `missions.length === 0`, unreachable because the tutorial pre-assigns a mission | **`generateMissionsForPlayer` had never run.** No player had ever received a generated mission. *Fixed 2026-08-31.* |
| **M2** | `createMission` → `provisionMissionInfrastructure` → creates a server → **AI-bound, rate-limited, per mission**; the blob write-back sits at the **end** of the loop, all-or-nothing | Generation takes minutes and typically never reaches the write-back, so rows are created but **no offer ever reaches the player**. Measured: `missions` returning nothing after 180s. *Partly mitigated (generation no longer awaited inline); the all-or-nothing write-back is still the open root cause.* |
| **M3** | Bonus objectives are included in the completion gate `objectives.every(o => o.completed)` | Contradicts the template contract that bonus failure must not fail the mission. **Any mission carrying a bonus objective is uncompletable.** |
| **M4** | `timeLimit` unit mismatch (1000×) | Generated missions effectively never expire; time bonus always granted |
| **M5** | Abandon/expiry leave blob `failed`/`expired` while the row returns to `available` | Mission visible but permanently un-acceptable |
| **M6** | Six of nine producers never write the blob | Every AI-persona and admin-created mission is unreachable |
| **M7** | Story-arc abandon marks rows `failed` but leaves blobs `active` | Dead-arc missions still credit and still pay out |
| **M8** | `active` not in the shared enum; `in_progress` phantom; `abandoned` undeclared | Client receives undefined enum values; dead filter branches |
| **M9** | `assignMission()` (only writer of `assigned`) and `cleanupExpiredMissions()` both have zero callers | Dead code that reads as implemented |
| **M10** | Metadata copied by reference from a singleton template in two of three instantiators | Latent cross-player contamination |
| **M11** | `hackService.ts:1435` passes the target **user** id into a parameter compared against `metadata.serverId` | **`hack_target` unwinnable in every case** — 7 templates. `targetServerId` is in scope and unused. One-line fix. |
| **M12** | Both `download` call sites pass `fileId: ""` | **`steal` unwinnable** whenever provisioning succeeded (8 templates); **`exfiltrate_data` unwinnable unconditionally**. One-line fix per site. |
| **M13** | Provisioning's allow-list omits the newer objective types, including three it has `case` arms for | `deep_extraction` gets no server/file/metadata — **fully unwinnable** |
| **M14** | Boolean-credited objectives authored with `target: 2`; `validateObjective` catches it but the generator only **warns** | `kingmaker`, `intelligence_sweep` unwinnable. Promote the warning to a rejection. |
| **M15** | `personaMissionGenService` never provisions, and its fill-if-missing guard treats the literal `"{targetServerId}"` as already-filled | Every persona-issued mission carries placeholder metadata |
| **M16** | `skillPoints` shown in the reward toast, never written; `unlocks` never granted | 13 templates promise skill points, 2 promise unlocks. Players are told they earned things they did not. |
| **M17** | `reputation` always credits `repNeutral`, ignoring `mission.factionId` | Faction missions build neutral standing |
| **M18** | `grantRewards` emits events that re-enter `updateObjective → completeMission → grantRewards` | Re-entrant completion loop, bounded only by objectives running out of headroom |
| **M19** | `checkAllActiveMissions` has **zero callers** and is the only path to `expireMission` | Integration-side expiry never runs (the `missionService` blob sweep does) |
| **M20** | `bonusObjectivesCompleted = max(0, completed − total)` is structurally always 0 | Bonus reward multiplier is dead code |

**Roughly 15 of the 39 templates cannot be completed** by construction: `deep_extraction`,
`kingmaker`, `intelligence_sweep`, `chain_reaction`, `surgical_strike`, `cipher_breaker`,
`data_extraction`, `persistent_access`, `scorched_earth`, `shadow_broker`, `dead_drop`,
`ghost_protocol`, `aida_trail`, `zero_day`, `follow_the_trail`.

---

## 7a. Tier 1 — DONE 2026-08-31

All four argument-level defects fixed and verified. Gate harness 15/15, U1 11/11, new provisioning
contract check 5/5, `tsc` 0, `eslint` 0.

| # | Fix |
|---|---|
| **M11** | `hackService` now passes `targetServerId` (which was in scope and unused) instead of the target **user** id. The hook's parameter is renamed `targetServerId` so the name can no longer invite the same bug. **Note this makes `install_backdoor` and `breach_server` stricter** — they were only completing because an unbound `matchesEntity` returns true, i.e. crediting *any* server. |
| **M12** | `readFile` now returns `nodeId`, and both `download` call sites pass the real source file id instead of `""`. Their `(missionIntegration as any)` casts were typed at the same time — the same pattern that hid the arity bug. |
| **M14** | Fixed by following the *authoring* intent rather than the registry: `install_backdoor` was written as a count in 4 of 5 templates (`1,1,1,2`) while registered boolean, so it became a **count** type and the hook now increments. `decode_content` was boolean in 9 of 10, so its lone numeric target was corrected instead. All 134 template objectives now agree with their `progressType`. |
| **M13** | The gate is now a single exported `PROVISIONED_OBJECTIVE_TYPES` constant that includes the three types the switch already handled, and `scripts/verify-mission-provisioning.ts` asserts gate-vs-switch coverage so they cannot drift again. |

**Two mistakes I made while doing this, both caught by controls rather than review:**

1. I first made *all* validation failures throw. That rejects **49 of 134** template objectives, because
   required metadata (`serverId`, `fileId`, …) is legitimately absent until
   `provisionMissionInfrastructure` backfills it. Would have broken generation entirely. Narrowed to
   the target/progressType mismatch, which is the only part knowable at authoring time — 134/134 now
   pass while all four M14 shapes are still rejected.
2. The new contract check extracted **0** switch arms (a comment in the same method mentions
   `` `switch (obj.type)` `` in backticks, and `indexOf` matched the prose), so "every arm is gated"
   passed vacuously. Only visible because checks 1 and 2 are each other's complement. Now brace-matched
   with an explicit guard that throws if 0 arms are found.

**And the U1 harness was unreliable, which nearly read as a Tier 1 regression.** It asserted connection
success from *output text*, so it reported `OK` while the player was still on the previous server — every
later step then ran against the wrong filesystem. Replaced with an assertion on the actual
`ServerConnection` row, **polled**, because `handshake.ack → completeConnection` writes that row after
emitting its result. Now 11/11 deterministically across repeated runs, where before it gave 11, then 3,
then 3.

Two incidental findings recorded while diagnosing that:
- **`UserSession.lastServerId` is dead schema** — nothing in `src/` ever writes it.
- **The world inflates.** Mission provisioning creates a target server when it cannot find a suitable
  one, so the database went from 38 servers to **114** during a handful of harness runs, with 40 content
  jobs queued behind them. `connect` awaits `contentQueue.ensureReady()`, so a deep queue makes
  connecting slow for players. Same family as M2.

---

## 8. Recommendations — revised fix order

The objective-crediting defects (M11–M14) are **cheaper and higher-impact** than the structural ones,
and they should go first. Each is a small, local change that resurrects whole groups of missions.

**Tier 1 — argument bugs. Hours, not days.**
1. **M11** — pass `targetServerId` instead of `targetId` into `onHackComplete`. Unblocks 7 templates.
   Consider branded `ServerId`/`UserId` types so this class cannot recur (same lesson as the
   `SuccessRate`/`Difficulty` mixup in PLAN.md Phase 5).
2. **M12** — pass the real file node id from both `download` sites. Unblocks 8 templates.
   Also decide whether `read` should credit `steal`, since the in-game hint currently says it does.
3. **M14** — make `validateObjective` failures **reject** rather than warn. Prevents M14-class bugs
   being authored at all, and would have caught `kingmaker` and `intelligence_sweep` before shipping.
4. **M13** — either extend the provisioning allow-list to the types whose `case` arms already exist, or
   derive the allow-list from the registry so the two cannot drift.

**Tier 2 — honesty and payout.**
5. **M16** — either grant `skillPoints`/`unlocks` or stop displaying them. Ties into the Phase 8 skill
   economy (missions award *defined* points; levelling awards *free* points), so do it there.
6. **M17** — route reputation to the mission's faction bucket.
7. **M3** — exclude `isBonus` objectives from the completion gate.
8. **M4** — settle `timeLimit` on seconds and delete the ms conversion.

**Tier 3 — the remaining root cause for generated missions.**
9. **M2** — make the blob write-back incremental, or provision lazily on accept rather than at
   generation time. Until this lands, no generated mission reaches a player at all, which is why
   M11–M14 have never been observed in play.

**Tier 4 — structural.** The dual store causes M4–M7, M10, M18–M20. Two honest options: make the blob a
pure cache of a per-player `MissionAssignment` table, or keep the blob authoritative and stop writing
player state to `Mission` entirely. Belongs with Phase 3's `PlayerProgressRepository`.

**Sequencing note.** Fix M2 *last* among the code changes but *verify* with it first: until offers reach
players, none of M11–M14 is observable, so each Tier-1 fix should be checked against a directly-seeded
mission rather than waiting on the generator.

**Do not** treat offers as an anonymous global pool. It breaks per-player level scaling and permits two
players to hold and complete the same mission.

---

## 9. What is verified working

- Tutorial path end-to-end (`scripts/verify-tutorial-altpath.ts`, 11/11).
- Accept → active → objective completion → stickiness (`scripts/verify-gate-phase1.ts`, 15/15).
- **Real gameplay credits objectives**: driven with actual `connect` calls, the tutorial's
  "Connect to 3 different servers" advanced 0 → 1 → 3 and completed at target.

## 10. What is NOT verified

- No generated mission has yet been seen end-to-end by a player (blocked on M2).
- Reward payout beyond XP/credits — `skillPoints` writes to a column that does not exist (see PLAN.md
  R8; ~18% of dungeon rewards currently grant nothing).
- **No generated or persona mission has ever been completed by anyone.** M11–M14 mean ~15 of 39
  templates are impossible, and M2 means offers never reach players in the first place — so the
  crediting defects have never been *observed*, only read. Every claim in §11 is from code reading and
  needs confirming against a directly-seeded mission once Tier 1 lands.
- Reward payout beyond XP/credits/items — `skillPoints` and `unlocks` are displayed and never granted.
- Objective-type coverage in play: §11 is a static analysis, not a measurement.

---

## 11. Objective types and crediting

**36 registered types** (`missionObjectiveTypes.ts`; its own comments claim 27 and 24 — both stale),
each declaring a `trackedBy` hook. **17 hooks** exist on `missionIntegration`. Every type has a
crediting branch, so nothing is missing a handler.

**The breakage is not missing branches — it is wrong arguments at the call sites.** Four independent
root causes, and together they make roughly **15 of the 39 mission templates impossible to complete.**

### 11a. A user id is passed where a server id is expected  → `hack_target` never completes

`hackService.ts:1435` calls `onHackComplete(attackerId, targetId ?? attackerId, …)`, where `targetId`
is the **target user's** id (proved by `hackService.ts:321`, which does `user.findUnique({ id: targetId })`).
The hook then evaluates `matchesEntity(objective, targetId, "serverId")` — comparing a `GameServer` id
held in `metadata.serverId` against a `User` id. **Always false.**
`targetServerId` is in scope in the same params object and simply is not used.

Because provisioning *always* patches `metadata.serverId` for `hack_target`, that type is unwinnable in
every case. Affected: `chain_reaction`, `persistent_access`, `surgical_strike`, `scorched_earth`,
`shadow_broker`, `data_extraction`, `cipher_breaker`.

`install_backdoor` and `breach_server` survive **only by accident**: they are unbound in practice, so
`matchesEntity` falls through to `return true` — meaning they are credited by hacking *any* server
rather than the intended one.

### 11b. Both download call sites pass `fileId: ""`  → `steal` and `exfiltrate_data` never complete

`fileCommands.ts:226` and `:330` are the only `onFileOperation(…, "download", …)` callers, and both
pass an empty string for `fileId`. Provisioning always sets `metadata.fileId` to a real node id, so the
comparison can never match. `exfiltrate_data` fails on both branches unconditionally.

A cruel detail: `getObjectiveHint("steal")` tells the player *"Use 'read &lt;filename&gt;'"* — and the
`read` path does not credit `steal` at all.

Affected by `steal`: `chain_reaction`, `dead_drop`, `ghost_protocol`, `surgical_strike`, `aida_trail`,
`zero_day`, `follow_the_trail`, `cipher_breaker`. By `exfiltrate_data`: `deep_extraction`.

### 11c. Provisioning does not recognise the newer objective types

`serverContentService.ts:1960-1977` gates provisioning on a 12-type allow-list that omits
`infiltrate_network`, `trace_connection`, `exfiltrate_data`, `breach_server`, `install_backdoor`,
`download_file`, `decode_content` — **even though the patch `switch` below it has `case` arms for three
of them.** Those arms are unreachable unless the mission also happens to carry an allow-listed type.

`deep_extraction` consists solely of non-allow-listed types, so it gets no server, no planted file and
no metadata: **both required objectives are unwinnable and only the bonus can complete.**

### 11d. Numeric targets on boolean-credited types

Hooks that write `true` produce `Number(true) === 1`, so any boolean-credited objective with
`target >= 2` can never finish. `validateObjective` *does* catch this — but `missionGenerator.ts:307`
only **logs a warning** and creates the objective anyway.
- `kingmaker` — `install_backdoor` target 2
- `intelligence_sweep` — `decode_content` target 2

### 11e. Persona-generated missions never provision at all

`personaMissionGenService` never calls `provisionMissionInfrastructure`. Worse, for templates that
hard-code `metadata: { serverId: "{targetServerId}" }` the placeholder is **truthy**, so its
fill-if-missing guard skips it and the literal string `"{targetServerId}"` is stored and compared
against real ids. Its Garrison profile also lists `"scan_network"`, which is not a registered type.

### 11f. Types with a branch but no live producer

- **`skill_level`** — `onSkillUpdate`'s only emitter hard-codes `skillName: "general"`, which no
  template ever asks for. Never creditable.
- **`gain_xp` / `earn_credits`** — credited only by *another mission's* reward payout, not by hacking
  XP, exploration XP, or hack loot.
- **`forum_interaction`** — the tutorial says "Browse or post", but the hook only fires on post/reply.
- **`discover_server_type`, `infiltrate_network`, `trace_connection`** — two of three call sites omit
  the arguments these need.

### 11g. Completion and rewards

Completion is **fully automatic** and inline: `updateObjective` runs
`objectives.every(o => o.completed)` → `completeMission`. There is no turn-in command, and
`completeMission` never independently verifies the objectives — it only counts them for scoring.
Because the check fires *only* when a hook fires, a mission whose last outstanding objective is one of
the orphans above is **permanently stuck** — and since the expiry sweep on the integration side is
dead code (below), it is never cleared either.

Rewards actually granted: `xp`, `credits`, `items`.
- **`skillPoints` — displayed in the reward toast and never written.** 13 templates promise 1–5 points.
- **`unlocks` — never granted.** `aida_trail` promises `aida_knowledge`; `endgame` promises
  `endgame_access`.
- **`reputation` always credits `repNeutral`**, ignoring `mission.factionId`, so faction missions build
  neutral standing.
- `bonusObjectivesCompleted = max(0, completed - total)` is **structurally always 0**, so the bonus
  reward multiplier is dead code.
- `grantRewards` emits `rewards:xp_granted` / `rewards:credits_granted`, which re-enter
  `updateObjective` → `completeMission` → `grantRewards`. **A re-entrant loop bounded only by
  objectives running out of headroom.**

### 11h. Dead code that reads as implemented

- **`checkAllActiveMissions` has zero callers**, and it is the only path to `expireMission`. (Distinct
  from `missionService.checkExpiredMissions`, which *does* run every 15 min on the blob.)
- `validateMissionObjectives` is only reachable from that dead method.
- `MISSION_CATEGORIES` has zero consumers. `OBJECTIVE_TYPES_BY_HOOK` files `breach_server` under the
  literal key `"onHackComplete + onAccessGranted"` — harmless only because nothing reads it.
