# AIDA — working notes for Claude

Multiplayer hacking game. `server/` (TypeScript, Express, Socket.IO, Prisma/Postgres),
`client/` (Svelte + Vite), `shared/` (types). The root `package.json` has **no
scripts** — run everything from `server/` or `client/`.

```
cd server && npx tsc --noEmit -p tsconfig.json    # typecheck
cd server && npx eslint src/                      # lint
cd server && npm run dev                          # tsx watch, port 3001
cd client && npm run dev                          # vite, port 8080
```

There is **no unit-test runner** (no jest config; `jest`/`ts-jest`/`@types/jest` linger
as dead devDependencies). Verification is done with hand-written harnesses in
`server/scripts/`:

```
cd server && npm run verify            # the whole suite, exits non-zero on failure
cd server && npm run verify:golden     # the command characterization master
cd server && npx tsx scripts/<name>.ts # one harness
```

**`server/scripts/` is tracked as of 2026-10-06** (decision 17 closed), baselines
included. Before that the directory was blanket-ignored with five files tracked by
accident, so ~49 harnesses existed on one machine only and every result quoted in the
prose docs was unreproducible by anyone else. The ignore rule was *removed* rather than
bypassed with `git add -f`, because forcing the add leaves the directory ignored and
silently untracks the next harness written.

**~10 harnesses need the dev server already running** and fail with `ECONNREFUSED`
without it — environmental, not a regression. They also share the dev server's global
`/api` rate limit (`RATE_LIMIT_MAX_REQUESTS` per 15 min per IP, in memory): about two
full runs fit in one window, and a third fails every HTTP harness with 429. `npm run
verify` names both causes from the logs; restart the dev server to clear the limiter. `npm run verify` says so when it reports
failures. Editing `src/` mid-run also restarts `tsx watch` under them; that has produced
a phantom failure before.

---

## 0. How to use `PROJECT_KNOWLEDGE.toon`

It is ~2600 lines and ~75k tokens. **Never read it whole.** Read the one or two
`@sections` your task touches, then verify what you read against source.

A full claim-by-claim audit was run on 2026-09-24. Result: **~640 true, ~190 false,
~25 describing deleted code.** Roughly one claim in four was wrong. What follows is
the trust calibration that audit produced — it is the most useful thing in this file.

**Trust by claim shape, not by section:**

| Shape | Verdict |
|---|---|
| Structure, relationships, wiring, flows | **Reliable.** All 8 IP-range mappings, all 6 traversal rules, all faction link-trees, all 11 connection-flow steps verified exactly. |
| Named methods, fields, event names | **Mostly reliable**, but method names are often paraphrased rather than quoted. Grep before calling. |
| Any number | **Assume stale.** Every count checked had drifted: tokens 51→60, commands 106→122, models 66→70, AI tools 24→28, hooks 9→17 and 13→15, objective types 34→37, utils 8→16. |
| Line counts and line citations | **Assume stale.** Drift is universal. |
| "X is the only/all/no more Y" | **Verify.** Several were true when written and are now false. |
| "Still open" / "not fixed" | **Assume fixed.** Six such entries described already-fixed work. |
| Anything needing the DB or a harness run | **Unverifiable here.** `server/.env` is unreadable in this environment. |

**Task → section map:**

- missions → `@mission_system` **(defined TWICE — L794 and L2120; they disagree on
  seven points. The L794 block is the better structural reference; its `@hardening`
  sub-block is the least reliable part of either.)** Note the file's own pointer at
  L2106 cites "line 788" for the first block and is itself stale.
- network/topology/access → `@network_topology`, `@server_ownership`
- AI generation → `@content_engine`, `@ai_resilience`, `@ai_feedback_loops`
- shop/inventory/rig → `@services` (shop block), `@resource_system`
- schema → `@database_schema` **(four models are missing from it entirely:
  `KnowledgeTopic`, `PlayerKnowledge`, `PlayerMission`, `PlayerMissionObjective`)**
- hacking/trace/bounty → `@services` (second half), `@soft_skill_gates`
- admin → `@admin_system`
- recent work → `@phase5_*`, `@phase4_code_review` (the most accurate sections in the
  file — 44 true / 3 false)

**The two formerly-inverted entries are now FIXED** — re-verified 2026-09-24. Kept
here because the *rule they illustrate* still applies, and because this section is
itself a worked example of the "assume fixed" row in the table above:

1. Offers-are-per-player is now stated **correctly** at **L2128** ("DO NOT treat offers
   as an anonymous global pool — it breaks per-player level scaling and lets two
   players hold and complete the same mission"). The source still agrees:
   [missionService.ts:545](server/src/services/missionService.ts:545) records the
   global-offer change as **REVERTED**.
2. The `prisma migrate dev` hazard now carries an explicit `setup_warning` at **L1884**
   ("NEVER `prisma migrate dev`"). L1792/L1801 still describe it as an *adoption
   recipe*, which is fine in context — L1801 cautions against casual use. Confirmed
   2026-09-24: `server/prisma/migrations/` still does not exist. Use `npm run db:push`.

When you correct a claim, fix it in place and update `@last_updated`. Its `date` field
has been stale by a phase; trust `git log`, not that field.

## 1. Verify against source. Never trust prose.

The prose is *demonstrably* unreliable — including prose written by previous Claude
sessions, and including this file.

- `PLAN.md` entries have been wrong on **every specific** (the P5-NEW entry named the
  wrong function, the wrong branch, and a bug already fixed two commits earlier).
- A plan entry prescribed a change that would have **caused** a regression (R6 said to
  call `handleDisconnect(socketId)`, destroying a session other tabs were using).
- Code comments contradict the code beneath them. Live examples:
  `darknetDungeonService.ts:1265` says "generated in parallel" above a sequential loop;
  `schema.prisma:26` omits the `npc` role the code actively writes;
  `missionObjectiveTypes.ts` carries **three** disagreeing counts of its own map
  (`:63` says 27, `:66` says 24, `:770` says 24) — and the map actually holds **37**,
  so *none of the three is right*. The lesson is stronger than "they disagree": when
  self-reported counts conflict, do not arbitrate between them, go count.
- The AI retry policy is documented three ways — doc says `5s/15s/45s`, the in-file
  comment says `5s/15s/30s`, and the code throws before the last sleep so only
  `5s/15s` ever run.

So: read the implementation, the callers, and the callees before changing anything.
Quote line numbers. If a comment, a plan item, or this file disagrees with the source,
**the source wins** — then fix the prose.

Corollary: when you write a comment claiming an invariant, verify the invariant first.

## 1b. Never hide a bug

**The response to a found issue is never to ignore it.** Always look for a solution.

This rule exists because the alternatives are seductive and all look like progress:

- **Allowlisting.** Freezing a list of known-bad entries so the check goes green. The
  check now passes and the bugs are still there, with a file asserting that is fine.
- **Reclassifying.** Calling something "not fatal", "informational", or "pre-existing"
  so it stops counting. The socket-contract check printed 28 server events with no
  client listener under a "not fatal" header for weeks; triaging them found a report
  being broadcast to the person reported, two zero-caller methods, and four false
  positives caused by a bug in the checker itself.
- **Narrowing the check** until the failure disappears, rather than until the check is
  correct.
- **Filing it** and moving on, when the fix was ten minutes away.

What to do instead: fix it, or delete the dead thing, or — if it genuinely needs a
decision you cannot make — write down the specific question and raise it. "Deferred"
is only honest when the next action is named and the reason is real.

Corollary: **a check that reports something as acceptable is making a claim**, and that
claim needs the same scrutiny as any other. If you find yourself adding an entry to an
exceptions list, that is the moment to ask whether you are fixing or hiding.

## 2. Verification discipline

A green check that would also have been green *before* the fix is worthless.

- **Negative-control every fix.** Revert, re-run, confirm red, restore.
- **Assert the state the code READS, not the state you can see.** A test deleted DB rows
  and asserted the table was empty while the service read a 30s in-memory cache.
  Another deleted rows that authentication then *recreated*. Still live:
  `serverContentService.ts` gates AI enrichment on an in-memory `Set`
  (declared `:1544`, read `:1586`, written `:1667`) that no DB reset will clear.
- **Bound assertions from both sides.** "Expiry is in the future" was also true of a bug
  that set it 41 days out.
- **A failing control is a finding.** One exposed that censorship rules could not match
  at all on the path under test.
- **Never point a state-mutating service method at ambient DB state.** A harness that
  reads whatever the dev database happens to hold and then calls something like
  `handleAdvanceEpoch()` will eventually corrupt that state — it completed the world's
  only epoch once in Phase 5 — or fail for reasons unrelated to the code under test
  (later it crashed outright on an empty table, taking the whole run's summary with it).
  Build a private fixture, make it the row the service will actually select, assert that
  **pre-existing rows are byte-identical afterwards**, and delete the fixture by `id` in
  a `finally`. Never clean up with a broad filter.
- **Report cleanup failures; never `.catch(() => {})` them.** A swallowed delete leaves a
  fixture behind that the *next* run reads as real state.
- **A skip must be loud.** A silently-skipped check is indistinguishable from a passing
  one in the summary line. Note also that skip conditions rot: a guard reading "skip if
  no active epoch exists" became permanent once `storyProgressionService` began
  recreating the Genesis epoch on every DI boot.
- **An empty grep is not a finding** — confirm the pattern can match something. Equally,
  **a non-empty grep is not a finding**: all 3 hits for the banned `getService<any>` are
  prose inside comments.
- **Strip comments before matching source in a harness.** A substring guard kept matching
  the comment that *explained* the fix rather than the fix — it fired **four separate
  times** in Phase 5, and once certified a fix (R12-d) that had zero callers and would
  have been a regression if wired up. Match the call, not the word: strip with
  `stripComments` from `server/scripts/lib/strip-comments.ts`, or assert on `this.emit("x"`
  rather than `x`. **Do not use the old regex idiom**
  (`src.replace(/\/\*[\s\S]*?\*\//g, "")…`): it is not string-aware, and a `"/*"` inside a
  string literal swallows code to the next `*/` — 138 real lines of `playerInfoCommands.ts`,
  two database writes among them, vanished from a check that was counting writes
  (2026-10-07). The helper parses the file, so it cannot make that mistake.
- **A structural check proves structure, not behaviour.** "The file contains this
  identifier" is compatible with the code being unreachable. Before trusting one, ask
  what *else* would satisfy it.
- **Reason about the whole path, not one function.** The 2026-09-24 audit produced a
  false "any player can read any home server" report by analyzing `canAccessServer`
  alone; `checkServerAccess` is ANDed with it on both entry paths and denies.
- **Confirm the command ran.** `cd server && npx tsc` when already in `server/` fails the
  `cd`, never runs `tsc`, and a following `echo` still prints success.
- Always run the **full** harness suite before committing.

## 3. Architecture invariants

Each was re-verified against source on 2026-09-24; the verdict is marked.

- **`PlayerMissionRepository` owns mission state.** ✅ Holds — zero direct
  `prisma.playerMission*` access outside the repository.
  - `mutateAll`'s callback must **return `true`** or the write is silently discarded
    ([playerMissionRepository.ts:305](server/src/repositories/playerMissionRepository.ts:305)).
  - Its sibling `mutate` uses a **`NO_CHANGE` symbol sentinel instead** (:85, :273-287),
    where a falsy return is a type error. **The two have different skip protocols** —
    that asymmetry is the trap, not the boolean.
- **`Mission.timeLimit` is seconds; `utils/missionTime.ts` is the only conversion
  point.** ✅ Holds — zero violations. The other `timeLimit * 1000` sites are
  `ConnectionChallenge`/minigame limits, a **different field**.
- **Mission completion is `requiredObjectivesComplete` and nothing else.** ✅ Holds —
  one definition in `utils/missionCompletion.ts:32`; both former rivals delegate to it.
- **`getService<any>` is banned.** ✅ Holds — zero real call sites.
- **Socket room ops must cover all of a user's sockets**
  (`io.in(\`user:<id>\`).socketsJoin/socketsLeave`). ✅ Holds — those are the only two
  such calls. `MAX_SOCKETS_PER_USER = 4` ([handlers.ts:125](server/src/sockets/handlers.ts:125)).
- **`PlayerProgressRepository` is the only sanctioned writer of `player_progress`.**
  ⚠️ **Currently violated by 9 direct write sites** — `adminApi/players.ts:141`,
  `authService.ts:166` (was `routes/auth.ts:91` before A8 moved registration), `achievementService.ts:108`, `progressService.ts:184,349`,
  `missionService.ts:405,1389`, `tutorialService.ts:1023`,
  `darknetDungeonService.ts:1205`. (Re-verified 2026-09-24: still exactly 9, but two
  citations had drifted — 1362→1389 and 997→1023 now land on *comments*, which is how
  a stale line number disguises itself as a fixed bug.) The repository puts the credit check inside the
  UPDATE's WHERE and clamps skills in raw SQL; these bypass both. Treat the rule as the
  target state, not a description.
- **Command modules hold no database handle.** ✅ Holds as of 2026-10-07 (A4): `db` is gone
  from `CommandContext`, so `context.db` does not compile, and
  `scripts/verify-a4-command-writes.ts` fails on any `db.client` or direct client import in
  `commandModules/`. A command that needs data calls a service or repository — the
  service is where the invariant lives (atomic guards, cache invalidation, events). Look up
  players by name with `UserRepository.findByUsername` (case-insensitive; registration keeps
  that unambiguous), and resolve relative paths against `session.currentDirectory`, never a
  terminal's own `currentDirectory` (`cd` does not maintain it).
- **Use `import type` for services resolved inside `await import()` blocks.** Those
  dynamic imports break require cycles; a static import reintroduces them.
- Errors go through `safeExecute` / `safeAI`; routes through `asyncHandler`
  (**53** call sites as of 2026-09-24 — this number drifts every phase; count, don't cite).

## 4. Gotchas that have cost real time

- **`prisma generate` rewrites `node_modules/@prisma/client`, which `tsx watch` does not
  watch.** After a schema change, restart the dev server or you get `Unknown argument`
  errors that look exactly like code regressions.
- **`npm run db:reset` is destructive** (`db push --force-reset` + seed). Never point it
  at the dev database — it has real accounts.
- **The client build now REQUIRES `VITE_API_URL`** — but only for
  `mode === "production"` ([vite.config.ts:13](client/vite.config.ts:13)). The dev
  fallback `http://localhost:3001/api` is still live in
  [api.ts:9](client/src/services/api.ts:9), so `npm run dev` is unaffected. Any
  production build, typecheck-via-build, or CI step must set it or the build throws.
- **Reading `server/.env` is blocked**, so anything needing `DATABASE_URL` must be done
  by the maintainer. Consequence: the docs record deployed `.env` values as if they were
  code defaults. `AI_MODEL` is documented as `nemotron-3-super:cloud`, but that string
  **appears in no file**; the code default is `llama3.1:8b`.
- **`gameBalance.ts` looks central but is partly inert.** `MAX_ACTIVE_MISSIONS`,
  `DUNGEON_TTL_DAYS`, `DUNGEON_REGEN_DELAY_MS`, and `ARCHITECT_MIN_EVENTS` each have
  **zero consumers**, and three have hardcoded duplicates in the services. Editing them
  appears to work and changes nothing.
- **`npm run migrate:home-dirs` is broken** — its target
  `scripts/migrate-home-directories.ts` does not exist and is gitignored, so it cannot
  be restored from the repo. `migrate:home-dirs:dry-run` is broken the same way. The
  only copy on disk is in an unmerged worktree under `.claude/worktrees/`.
- **Harness summary formats differ** — some print `=== N PASS / N FAIL ===`, some
  `N/N passed`, one prints neither. Grepping for one format reports healthy harnesses
  as broken.
- The dev DB accumulates harness accounts. Don't mistake them for real data, and don't
  leave test accounts holding elevated roles.
- **`SECURITY_CLEANUP.md` is wrong about git history.** A full scan of every env file
  ever committed found only two placeholder `JWT_SECRET` lines. No API key was ever
  committed; the prescribed `filter-repo` scrub is unnecessary. (Whether the live key
  was rotated is unverifiable here.)

## 5. Bug shapes that recur in this codebase

1. **A wrong call that cannot fail loudly** — an `any` hides it from the compiler *and*
   an enclosing `catch`/fallback hides it from the runtime. Asserting "nothing threw"
   would have passed before the fix.
2. **Wrong argument, right type** — `initiateTrace(attackerId, serverId, …)` where
   `serverId` landed in `initiatedBy`; `registerActiveTrace` keyed by `serverId` instead
   of `traceId`. Both strings, so nothing complained. (Both now fixed.)
3. **Correct at the source, inert at a persistence boundary** — a flag reached the Json
   column but had no column in the typed table, so it was dropped on write.
4. **Dead code that looks live** — a zero-caller method whose name suggests it is the
   right thing to call. Live examples: `applyContentPlanViaFileService` (suppresses its
   own unused-symbol error to stay compilable); `registerTerminal`/`registerConnection`/
   `registerBackdoor`, so passive resource drain never happens.
   **`mission:failed` was the canonical example and is now FIXED** (emitters at
   `missionService.ts:705` and `:1718`, listener at `index.ts:265`) — and fixing it
   proved the shape is worse than "inert": the listener it woke up calls
   `advanceStory(id, "failed")`, which *permanently* fails a story arc. Waking a dead
   listener is a behaviour change, not a no-op. Check what the listener does first.
5. **A guard that guards nothing** — a fail-closed `catch` around a condition that cannot
   occur, while the failure that *can* occur is swallowed elsewhere.
6. **An orphaned constant with a hardcoded twin** — shape #4 applied to config. See the
   `gameBalance.ts` gotcha above.
7. **A rename in one file that silently breaks a lookup in another.**
   `npcReactionService.ts:58-110` keys its hand-written NPC voices `npc_sysadmin`,
   `npc_steele`, … while `npcOwnership.ts:59-68` and `seed.ts:520-560` create those
   users as `sysadmin`, `Commander Steele`, …, so all five lookups miss. No compiler
   error, no runtime error, just flattened prose. **Scope is narrower than it looks**
   (re-verified 2026-09-24): the fallback is only consulted when the faction has no
   `AIPersona` (`:262-265`), so the four faction NPCs normally speak in an AI voice and
   only degrade on AI failure. `npc_sysadmin` has no faction and *is* unconditionally
   generic. A real bug, but "every NPC" overstated it — which is its own lesson.
8. **A doc claim that is the exact inverse of the code** — "static is the AI fallback"
   (static runs first, always), "access keys granted on read" (granted on download).
   Worse than a wrong number: it sends you debugging in the wrong direction.

---

Working notes and decisions live in `PLAN.md`; accumulated findings in
`PROJECT_KNOWLEDGE.toon`. Update both when you finish a task — and treat both as claims
to re-verify, not as facts.
