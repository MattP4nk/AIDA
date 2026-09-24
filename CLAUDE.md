# AIDA — working notes for Claude

Multiplayer hacking game. `server/` (TypeScript, Express, Socket.IO, Prisma/Postgres),
`client/` (Svelte + Vite), `shared/` (types). The root `package.json` has **no
scripts** — run everything from `server/` or `client/`.

```
cd server && npx tsc --noEmit -p tsconfig.json    # typecheck
cd server && npx eslint src/                      # lint
cd server && npm run dev                          # tsx watch, port 3001
cd client && npm run dev                          # vite
```

There is **no unit-test runner**. Verification is done with hand-written
harnesses in `server/scripts/` (gitignored), run as
`cd server && npx tsx scripts/<name>.ts`. Socket/HTTP harnesses need the dev
server already running.

---

## 1. Verify against source. Never trust prose.

This is the rule that matters most here, because the prose is *demonstrably*
unreliable — including prose written by previous Claude sessions.

- `PLAN.md` entries have been wrong on **every specific** (the P5-NEW entry
  named the wrong function, the wrong branch, and a bug that had already been
  fixed two commits earlier).
- A plan entry has prescribed a change that would have **caused** a regression
  (R6 told us to call `handleDisconnect(socketId)`, which would have destroyed
  a session other tabs were still using).
- Code comments have repeatedly contradicted the code beneath them, including
  comments added in the same session that broke them.

So: before changing anything, read the implementation, the callers, and the
callees. Quote line numbers. If a comment, a plan item, or this file disagrees
with the source, **the source wins** — then fix the prose.

Corollary: when you write a comment claiming an invariant, verify the
invariant first. Several bugs here are a true-sounding comment sitting on code
that does the opposite.

## 2. Verification discipline

A green check that would also have been green *before* the fix is worthless.
Every harness assertion must discriminate.

- **Negative-control every fix.** Revert it, re-run, confirm the check goes
  red, restore. This has caught harness bugs that would otherwise have
  certified broken code.
- **Assert the state the code READS, not the state you can see.** A test once
  deleted DB rows and asserted the table was empty, while the service read a
  30-second in-memory cache. Another deleted rows that authentication then
  *recreated* — the system self-heals the state the test was constructing.
- **Bound assertions from both sides.** "The expiry is in the future" was also
  true of a bug that set it 41 days out.
- **A failing control is a finding.** A control failure once exposed that
  censorship rules could not match at all on the path under test.
- **An empty grep is not a finding.** Check the pattern can match something.
  A `grep -v` filter once excluded the very lines being searched for.
- **Confirm the command ran.** `cd server && npx tsc` when already in
  `server/` fails the `cd`, never runs `tsc`, and a following `echo` still
  prints success.
- Always run the **full** harness suite before committing; cross-file
  regressions have shown up nowhere else.

## 3. Architecture invariants

- **`PlayerProgressRepository` is the only sanctioned writer of
  `player_progress`.** Reaching past it to `prisma.playerProgress` reintroduces
  unclamped skill gains and check-then-spend credit races.
- **`PlayerMissionRepository` owns mission state.** Note: `mutateAll`'s
  callback must **return `true`** or the write is silently discarded.
- **DI resolves must be typed.** `getService<any>` is banned — 51 of them hid
  three live bugs (a 3-arg call to a 4-param method, a method that never
  existed, a column that never existed). A harness asserts zero remain.
- **Use `import type` for services resolved inside `await import()` blocks.**
  Those dynamic imports exist to break require cycles; a static import
  reintroduces them, while a type-only import is erased at compile time.
- **Socket room operations must cover all of a user's sockets**
  (`io.in(\`user:<id>\`).socketsJoin/socketsLeave`). Up to 4 sockets per user
  are allowed, and `session.socketId` names only one of them.
- **One conversion point per unit.** `Mission.timeLimit` is **seconds**;
  `utils/missionTime.ts` is the only place it may be multiplied or divided.
  A three-way seconds/ms disagreement previously disabled mission expiry
  game-wide.
- **One implementation per rule.** Mission completion is
  `requiredObjectivesComplete` and nothing else. Two copies of that rule
  disagreed and stalled progression.
- Errors go through `safeExecute` / `safeAI`; routes through `asyncHandler`.

## 4. Gotchas that have cost real time

- **`prisma generate` rewrites `node_modules/@prisma/client`, which
  `tsx watch` does not watch.** After a schema change, restart the dev server
  or you get `Unknown argument` errors that look exactly like code
  regressions.
- **`npm run db:reset` is destructive** (`db push --force-reset` + seed).
  Never point it at the dev database — it has real accounts.
- **Reading `server/.env` is blocked** in this environment, so anything
  needing `DATABASE_URL` directly must be done by the maintainer.
- **Harness summary formats differ** — some print `=== N PASS / N FAIL ===`,
  some `N/N passed`, one prints neither. Grepping for a single format silently
  reports healthy harnesses as broken.
- The dev DB accumulates harness accounts. Don't mistake them for real data,
  and don't leave test accounts holding elevated roles.

## 5. Bug shapes that recur in this codebase

Worth pattern-matching against when reviewing:

1. **A wrong call that cannot fail loudly** — an `any` hides it from the
   compiler *and* an enclosing `catch`/`fallback` hides it from the runtime.
   All three R5 bugs had this shape. Note the testing consequence: asserting
   "nothing threw" would have passed before those fixes.
2. **Wrong argument, right type** — `initiateTrace(attackerId, serverId, …)`
   where `serverId` landed in `initiatedBy`; `registerActiveTrace` keyed by
   `serverId` instead of `traceId`. Both strings, so nothing complained.
3. **Correct at the source, inert at a persistence boundary** — a flag reached
   the Json column but had no column in the typed table, so it was silently
   dropped on write.
4. **Dead code that looks live** — an unreachable branch, or a zero-caller
   method whose name suggests it is the right thing to call. Delete it rather
   than leaving the trap.
5. **A guard that guards nothing** — a fail-closed `catch` around a condition
   that cannot occur, while the failure that *can* occur is swallowed
   elsewhere.

---

Working notes and decisions live in `PLAN.md`; accumulated findings in
`PROJECT_KNOWLEDGE.toon`. Update both when you finish a task — and treat both
as claims to re-verify, not as facts.
