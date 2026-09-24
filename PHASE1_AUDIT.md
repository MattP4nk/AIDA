# Phase 1 audit — 2026-08-31

Five independent adversarial passes over Phase 1's ~25 claims. Each auditor was instructed to
**refute**, and to default to REFUTED when uncertain. I re-verified every finding below myself before
recording it; where my own check changed the severity, that is noted.

**Headline: Phase 1's individual fixes are largely real, but the phase should not have been closed.**
**Four** P0-class defects are open, three of them *created* by Phase 1 work, and four documented claims
are false. The pattern is consistent and worth naming: **the fixes are correct where they were applied and
were not applied everywhere.** Almost every refutation is a second code path, not a wrong fix.

---

## P0 — ALL FOUR FIXED 2026-08-31

Verified at runtime by `scripts/verify-p0-fixes.ts` (4/4), with a positive control proving the gate is
not blanket-blocking:

```
PASS  P0-1 fragment.crack now gated       Insufficient Hacking skill. Required: 50, Current: 45
PASS  P0-1 sweep now gated (forensics 15) Insufficient Forensics skill. Required: 15, Current: 5
PASS  P0-2 unowned exploit refused        You don't own zero_day.
PASS  control: ungated cmd still works    Subnet: 10.0.0.0/24
```

- **P0-1** — the category allow-list is gone; skill gates now run for **every** command, since
  `SKILL_REQUIREMENTS` was already the single source of truth and the filter only added a second place
  to forget to register something. Newly enforced: `sweep`, `protect`, `decode`, `safevault`,
  `honeypot`, `key.contact`, `collar.shield`, `fragment.crack`, `endgame`. Checked first that the
  tutorial depends on none of them (its only `protect` hit is faction flavour prose).
- **P0-2** — `exploit` now runs `filterOwnedTools` and refuses unknown or unowned names, passing only
  `owned` through. My own check "failed" on first run because the skill gate refuses at Hacking 10
  before ownership is reached; the test now raises the skill so it exercises the real path.
- **P0-3** — `createMissionTargetServer` calls `resolveNpcOwnerId` and returns that owner, not `null`.
- **P0-4** — mission-target `encryptionLevel` is `round(difficulty / 2)` capped by a new
  `MAX_CONTENT_ENCRYPTION_LEVEL = 5`, so the hardest generated target needs player level 10, not 200.
- **G6 gap** — all five raw id comparisons route through `matchesEntity` (16 call sites, 0 raw
  comparisons outside comments), so the three that were strict-with-no-fallback can no longer be
  permanently uncreditable when provisioning silently returns `null`.

Suite after: gate 15/15, tutorial 11/11, G3 19/19, shop contract 10/10, provisioning 5/5, tsc 0,
eslint 0 errors.

**On the newly-enforced gates:** turning on twelve dead gates does make the early game stricter —
`decode` (Crypto 10) and `sweep` (Forensics 15) now refuse a new player starting at 5. That is correct
(they were declared for a reason) and is exactly what U3c's per-command penalties will relax in
Phase 8. It should not be re-tuned before then.

---

## P0 — as found (all now fixed)

### P0-1. `fragment.crack`'s hard gate is never evaluated. A Hacking-10 player can destroy a unique endgame item.

`commandProcessor.ts:475` gates skill checks on module *category*:

```ts
const skillGatedCategories = new Set(["hack", "network", "file", "social", "alias"]);
```

`FragmentCommandsModule.category` is `"fragment"`. So `fragment.crack` — which U3 deliberately left
`mode: "hard"` with the comment *"failure BRICKS the fragment permanently… an unrecoverable loss"* — is
**never checked**. The plan explicitly relied on that gate holding. It does not exist at runtime.

**Eleven other requirements are dead the same way:** `sweep`, `sweep.reveal` (`file_access`);
`protect`, `safevault`, `honeypot` (`defense`); `decode`, `subnet` (`math`); `collar.shield`,
`key.contact`, `endgame` (`fragment`).

This also makes part of yesterday's soft-lock fix **vacuous**: neither `sweep` nor `sweep.reveal` is
checked at all, so making `sweep.reveal` `unblockable` changed nothing.

### P0-2. `exploit` grants hacking bonuses for items the player does not own, from raw input.

`hackCommands.ts:1345` takes `command.args?.[1]` — arbitrary text — and passes it straight through as
the tools array (`:1387`, `:1417`). `filterOwnedTools` has exactly **one** call site, `:349`, on the
`hack` command. So `exploit <ip> zero_day` grants a `0.5 × 0.5 = 0.25` success bonus while owning
nothing, and `exploit <ip> advanced_stealth` adds the full stealth ceiling on top.

This is precisely the hole S4 was written to close; S4's ownership control was applied to one of the
two paths that need it. `backdoor`/`rootkit` pass hardcoded names that happen not to be
`TOOL_EFFECTIVENESS` keys — inert **by coincidence of naming**, not by design.

Compounding: `calculateEvidence` and `calculateStealthLevel` match tools by *substring*
(`t.includes("stealth")`), outside all three S4 controls — so `exploit <ip> stealth` cuts evidence 20%
for a made-up word.

### P0-3. Mission-provisioned target servers are created ownerless, and `hack` refuses ownerless servers.

`serverContentService.createMissionTargetServer` passes `ownerId: null` explicitly.
`hackCommands.ts:762` then answers *"Target server has no owner"*. `assignNpcOwnership` runs **only
from the seed**, so this never self-heals — the exact P0 that U3b claimed to close, reintroduced
through a sixth server-creation site the plan did not list.

**Severity tempered by measurement:** the live DB has **1 ownerless server out of 142**, because
provisioning usually *selects* an existing server rather than creating one. Real and recurring, but
not the 76-server disaster the 38→114 growth figure might suggest. I checked rather than assumed.

### P0-4. G4 moved the encryption failure rather than fixing it: mission targets are level-locked.

`createMissionTargetServer` sets `encryptionLevel` from `mission.difficulty * 10` (difficulty is
1–10), while G4's new formula is `requiredLevel = encryptionLevel * LEVEL_PER_ENCRYPTION` with
`LEVEL_PER_ENCRYPTION = 2`. So a generated target lands at requiredLevel **20–200**, against a level
curve where level 20 needs 36,100 XP. A **difficulty-1** mission handed to a new player provisions a
target that answers *"Insufficient level. Required: 20, Current: 1"*.

Before G4, encryption gated nothing; after G4, runtime-provisioned content is permanently locked. The
fix was calibrated against `seed.ts` (max encryptionLevel 5) and never against the runtime writers.

**Measured:** every seeded server is at encryptionLevel ≤ 5; exactly **one** server sits at 10. It is
the same mission-provisioned server as P0-3 — the two defects share a cause and, today, a blast radius
of one. Unclamped external writers exist too (`contentDraftService`, the admin API), so this widens as
soon as generation runs at higher difficulty.

---

## False claims in the documentation

These are mine, and they matter more than the defects because they would have misled the next
decision.

1. **M11's "stricter" note is false.** I wrote that fixing the id made `install_backdoor` and
   `breach_server` stricter. Neither type is in `PROVISIONED_OBJECTIVE_TYPES`, so `metadata.serverId`
   is never bound for them and `matchesEntity` still returns true for *any* server. Behaviour is
   unchanged. "Backdoor this server" is still satisfied by backdooring any server.
2. **G6's "all sites now route through `matchesEntity()`" is false.** Nine do; **five entity
   comparisons still bypass it** (`upload_file`, `download_file`, `exfiltrate_data`,
   `trace_connection`, `infiltrate_network`). Three are strict-only with no unbound fallback — the
   exact failure mode G6 says it fixed. They are permanently uncreditable when provisioning returns
   `null`, which it does silently under a `safeExecute({ silent: true })`.
3. **"All five soft commands gate on `hacking`" is wrong** — there are **six** `mode: "soft"` entries;
   `analyze` gates on forensics.
4. **"No `seed_*` rows remain" is not an invariant**, only a fact about the test DB. The reconcile
   deliberately leaves any row a player still holds, and the four software duplicates are not in the
   rename map, so a player holding one keeps an unusable row forever.

---

## Phase 1 work that cancelled itself out

**Two changes, each correct alone, that silently negate each other.** `npcReactionService`'s
`FALLBACK_VOICES` is keyed on `npc_sysadmin` / `npc_steele` / `npc_chen` / `npc_gh0st` / `npc_aida`.
U3d-follow-3 then renamed those accounts to `sysadmin` / `Commander Steele` / `Director Chen` /
`gh0st` / `AIDA`. **Zero keys now match**, so every NPC falls through to the two-sentence generic
fallback. The sysadmin lesson U3d calls *"the first feedback a new player gets that they were noisy"*
is unreachable — and the neutral trainer has `personaName: null`, so it cannot take the AI branch
either. It also removes the floor the AI validator depends on.

This is the most instructive finding in the audit: neither change was wrong, neither review would have
caught it, and only a cross-cutting pass could.

---

## Headline feature that does not cover its own use case

**U3d-follow-2 claims persona replies are deferred 45–210s through `personaMailQueueService`.** The
queue, the sliding, the coalescing and the backpressure are all real and work. But the **only**
`mailQueue.enqueue` caller in the server is `tutorialService.ts:645` (Architect tutorial hints). The
actual token-gated persona reply still generates **inline and synchronously** and delivers
immediately, is not coalesced, and can emit a *second* message later via the retry queue. The
`kind: "notice"` path has no caller at all.

Related: the 5/hr flood limit lives only in `sendAIMessage`, but the queue and `npcReactionService`
both call `sendPrivateMessage`, which has no flood check — so the deferred path bypasses the limit
that `aiSchedulerService` documents as an invariant.

---

## Verdicts

**CONFIRMED (13):** G1 (runtime-type dispatch, absolute values, sticky completion); G2; G7 (all three
blockers); M11 core fix; M12 (narrow — both download sites); M14 (recounted independently: 39
templates, **134** objectives, 0 mismatches, and enforced at runtime by `missionGenerator`, not only
in a script); U1; U2; U2b (including that the `update:` clause reaches existing DBs); G3 ownership-is-
installation; G3 trade-in genuinely inside the transaction; token reward-only enforcement; catalog
sync writing `effect` (and correcting stale rows, since `update: row` is the full object); S2 quantity
guards (I could not defeat them — `1e3`, `1e21`, `0x10`, `Infinity`, `2.5`, `-1` all handled).

**PARTIAL (5):** M12 (the `as any` cleanup it claims is incomplete — three survive in
`playerInfoCommands`, two with wrong arity); M13 (gate and switch do match, but "cannot drift" rests
on a script that is gitignored, untracked, not in `package.json`, and has no CI); S4 (controls 1 and 3
hold; control 2 is P0-2); U3 enforcement (band logic correct, dispatch filtered by category); the
nine-call-site claim (a tenth, `memoryService.initializeSession`, still calls `initComputerSpec`
directly — harmless only because it is dead code).

**REFUTED (6):** G6; M11's stricter note; U3b; "no `seed_*` rows remain"; deferred persona replies;
"no remaining `startsWith` trailing-underscore" (three remain, one of which feeds a **delete** list).

---

## New defects, filed by owning phase

**Phase 1 (fix before moving on):** P0-1, P0-2, P0-3, and the G6 unbound-comparison gap.

**Phase 5 (reliability):** `report server`/`report mission` fire `onServerConnect`, farming `explore`
objectives and crediting `connect_server` without connecting (also wrong arity, behind `as any`);
`deep_extraction` still unwinnable (`exfiltrate_data`/`download_file` absent from
`fileObjectiveTypes`, so no target file is planted); `infiltrate_network` binds to a possibly-null
network; story missions write `"available"` to the Mission row and `"active"` to the blob at creation;
`skillPenaltySeverity` is not persisted, so a restored hack session resolves at **zero penalty**;
in-game text teaches `backdoor install <ip>` in four places, which does not parse; buying a *lower*
hardware tier charges full price, applies nothing, and still prints "Installed."; `--tools=a,b` is
silently ignored despite the project's own parser supporting `--key=value`, and `hack --tools x <ip>`
resolves the target as `"--tools"` — the exact `ls -l → "/-l"` class G8 was meant to end; REST
double-charges the command rate limiter (validate + execute each push a timestamp), halving the
effective budget on the only path the client uses

**Phase 4 (security):** the socket path bypasses the character whitelist that the REST path applies —
`sockets/handlers.ts` validates only the `command` field and then joins raw `args`, so `|`, `>`, `;`,
`$` reach the processor over `command:execute` while REST rejects them (the join also destroys any
quoting the caller resolved); D2 — DB-backed rate limits are keyed on rows the rate-limited player can
delete, so deleting a `[SECURITY]` message resets the 30-minute NPC cooldown and deleting five persona
mails resets the flood budget; `architectInterventionExecutor` creates unvalidated, duplicate
`InventoryItem` rows from an AI-supplied id.

**Phase 6 (AI):** D1 — `reconcileIdentity` hard-deletes the merged-away account, cascading its forum
posts, comments and received messages; it was safe on one database at one moment, not by construction.
D3 — the `type: "faction_leader"` predicate U3d fixed is **still live** in
`personaService.onFactionServerHacked`, so DarkNet's 14 servers still generate no `AIKnowledge` on a
breach. D5 — reply coalescing races in-flight generation and drops the newer question. D7 — the merge
writes an unguarded random `homeIp` into a `@unique` column.

**Phase 3 (data model):** `PendingPersonaMail.senderId`/`recipientId` have no FK; the AI-identity
allocator is not atomic (a lost race rethrows P2002 rather than resolving) and costs up to 65,520
sequential queries when the block fills.

---

## What this says about the method

The audit found nothing wrong with any *individual* fix's logic. Every refutation is one of:

- a **second code path** the fix did not reach (S4→`exploit`, U3b→mission provisioning, flood
  limit→`sendPrivateMessage`, G6→five comparisons),
- an **enforcement layer** that silently excludes the fix (the category filter),
- or **two correct changes cancelling** (the NPC voices).

None of these is visible from the diff of the fix itself, and none was caught by a harness — the
harnesses all still pass. They were found only by asking "where else does this pattern live?" That
question should be part of closing every future phase, not just this one.
