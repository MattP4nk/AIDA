# Orphan audit — 2026-09-24

Five dimensions, run in parallel, every claim positive-controlled. Two of the four
reports landed findings that contradict comments **I wrote earlier the same day** —
those are marked ⚠️ and were corrected immediately.

Method note that generalises: **matching names is not enough.** Two of the biggest
findings below are invisible to a name-comparison audit — an event can be emitted and
listened for and still reach nobody (wrong room), and a service can be registered,
resolved and injected everywhere and still be dead (no method ever called).


---

## The organising question: *would deleting this lose functionality?*

Re-sorted on that basis. **Most of this is not dead code — it is unreachable code**: whole
features that were written, wired part-way, and never connected. Deleting them would quietly
ratify their absence.

### A. FEATURES THAT EXIST BUT CANNOT BE REACHED — wire these, do not delete

Ranked by what the player loses.

| # | Capability | Why it never runs | Size |
|---|---|---|---|
| 1 | ~~**Faction wars can never start**~~ **PARTLY WIRED 2026-09-24** — see below | `warfareService.declareWar` has **zero callers**. `startWarMonitor` runs and the `war` command reads war rows — but nothing can ever create one. `surrender`, `updateWarScore`, `getReputationMultiplier` dead alongside it. `FactionWar` table: 0 rows. | 122 LOC |
| 2 | **Being hacked is never announced** | `hack:attempt`/`hack:detected` emit on the internal bus; nothing bridges to a socket. Client UI is complete and unreachable. (Already filed Phase 8.) | bridge only |
| 3 | ~~IP discovery / traceroute / range scan~~ **WRONG — these are PREDECESSORS, not missing features. Deleted 2026-09-24, see correction below.** | | |
| 4 | ✅ **WIRED 2026-09-24 — and this entry badly understated it.** NO GameEvent had ever reached a player, in either direction. See below. | | |
| 5 | ✅ **WIRED 2026-09-24 — and it was broken in TWO ways.** See below. | | |
| 6 | ✅ **WIRED** — `reputation:changed` | `reputation:changed` emitted, no listener. The cross-faction rivalry mechanic — hacking A helps A's rival — is invisible to the player. | wire only |
| 7 | ✅ **WIRED** — `security:warning` | On the `registerForumAccount` path the player sees `✓ Successfully registered` while their IP is logged and rep drops. `security:warning` is emitted and dropped. | wire only |
| 8 | ✅ **WIRED 2026-09-25** — `faction:contest_started` / `faction:contest_resolved` now surface as notifications. | | |
| 9 | ✅ **WIRED 2026-09-24** — persistence + replay, and the client needed three fixes to render a replay honestly. See below. | | |
| 10 | **Hack cooldown** ✅ WIRED 2026-09-24 — skill now reduces it. **Trace duration ❌ NOT wired: the function is INVERTED** (see below). | | |
| 11 | ✅ **WIRED 2026-09-24** — enforced in `acceptMission`, before the mutate so a refusal does not consume the offer. | | |
| 12 | ✅ **WIRED** — `terminal:error` | `terminal:error` emitted from 5 sites; client uses `socket.once(...)` with no error listener and no timeout, so the click appears ignored. | wire only |
| 13 | ✅ **WIRED** — `force:disconnect` + `connection:refused` | `force:disconnect` carries the admin's reason; the client's `disconnect` handler returns early without surfacing it. Same for `connection:refused` at the socket cap → frozen UI. | wire only |
| 14 | ✅ **WIRED 2026-09-25** — forum rooms are joined on authenticate and on registration. | | |
| 15 | **NPCs post but never answer** | `forumService.handleNPCReply` — zero callers. (Filed Phase 8.) | 162 LOC |
| 16 | ✅ **WIRED 2026-09-25** — connection and backdoor drains registered; the golden master shows the consumer appearing. | | |
| 17 | ✅ **WIRED 2026-09-25** — the reject route duplicated the service inline; it now delegates. | | |
| 18 | ✅ **WIRED** — `moderation:flagged` | `moderation:flagged` carries the reason; nothing listens. (From my own Phase 6 work.) | wire only |
| 19 | ✅ **WIRED 2026-09-25** — `server:alert` has a listener; both branches surface. | | |
| 20 | ✅ **WIRED 2026-09-25** — `story:fragment-intel` has a listener. | | |

### A-wired so far (2026-09-24)

Faction wars (declare + stakes), progress backup (which needed two latent bug fixes before it
could restore at all), skill-scaled hack cooldown, the active-mission cap, and six group-B socket
listeners. **Two items were correctly REFUSED** rather than wired — the IP cluster (superseded by
topology) and `getTraceDuration` (inverted) — which is a third of what was attempted.

### B. UNIFY, don't delete — ✅ 11 of 15 done 2026-09-24

These look like dead constants, but deleting them loses the ability to tune the game. The fix is
the reverse: make the service read the constant.

**Unified:** the five `BOUNTY_*` (the whole bounty economy was five bare literals in one
expression, under a comment restating the formula, while the named config sat unreferenced 1,800
lines away), `DUNGEON_TTL_DAYS`, `DUNGEON_REGEN_DELAY_MS`, `MISSION_EXPIRATION_INTERVAL_MS`,
`DAILY_MISSIONS_PER_PLAYER`, `ARCHITECT_MIN_EVENTS`, `FACTION_LOW_RESOURCE_THRESHOLD`.

The harness asserts **numeric equivalence**, not just that a constant is referenced — every value
still equals the literal it replaced, and the bounty formula is checked identical across all 101
evidence levels. A unification sweep that silently changes a number is worse than the duplication.

**And the comment was wrong.** Writing that equivalence check surfaced that the formula's own
comment claimed `81% → 2000c/10rep` when the code gives **1200c/6rep**. The 100% end (5000c/25rep)
was correct, which is how it survived — anyone sanity-checking the upper bound would have agreed.
Corrected, and pinned.

**Deliberately NOT substituted (4):**
- The three `evidenceLevel > 80` gates. They gate the whole **critical-evidence band** (lockdown,
  alert severity, the -15 rep penalty), not bounties — a `BOUNTY_*` name would mislabel two of the
  three. They want their own `CRITICAL_EVIDENCE_THRESHOLD`, which is a decision, not a sweep.
- `DETECTION_FLOOR_PCT` / `DETECTION_AGGRESSIVE_BONUS_PCT`: the constants are **percent** (5, 30)
  and the twins are **fractions** (`0.05`, `0.30`) — a careless substitution is a 100x bug. Worse,
  one of the three `0.05` sites clamps `successRate`, a different concept that merely shares the
  value. Needs per-site judgement.
- `AI_ACTIONS_PER_DAY` / `AI_LEADER_INTERVAL_H` / `AI_OTHER_INTERVAL_H`: env-shadowed
  (`parseInt(process.env.X || "3")`). Unifying means deciding whether the constant or the env var
  is authoritative — a config-precedence decision.

### C. GENUINELY SAFE TO DELETE — nothing is lost

- **Duplicate socket emits** where a live equivalent already reaches the client: the four
  `presence:*` events (duplicates of `server:user_connected` / `user:status_change`), and the
  command-echo events (`mission:accepted`, `mission:abandoned`, `server:disconnected`,
  `forum:accessed`, `forum:registered`, `proxy:connected/disconnected`, `message:reported`,
  `forum:scan-complete`) whose commands already return the outcome.
- `authentication:complete` — unreachable branch (all 15 emitters pass an ack).
- `join:room` / `leave:room` — dead on both sides; rooms are server-driven.
- Dead schema twins: `ForumPost`/`ForumReply` (the live family is `Forum`/`Post`/`PostReply`),
  `AidaClue`, `KnowledgeTopic`, `PlayerKnowledge`.
- Superseded files: `server/src/utils/ipUtils.ts` (180 LOC — `ipService` has its own
  implementations), `client/src/utils/forumSystem.ts` (105 — superseded by `ForumDialog`),
  `client/src/components/TerminalTabs.svelte` (356 — name-collides with the live
  `services/terminalTabs.ts` store), `server/src/database/seed.ts` (8, stale stub).
- Dead deps: `jest`, `ts-jest`, `@types/jest`, `@types/cron`, `redis`.
- `state:delta`, and the four `serverService` emits whose methods have zero callers.

### D. MUST NOT DELETE despite looking orphaned
`command:error` and the `command:execute` **listener** are harness-load-bearing — the entire
verification suite drives commands through that socket path.

---

## Progress backup — wired, and it could never have worked

This one passed the lens: nothing else provides backup or restore, so there was no live
implementation to contradict. A genuine absence — and wiring it surfaced **two latent bugs that
no "does it run" check would have caught**, because creation succeeded the whole time.

1. **`createBackup` returned an id that did not exist.** It built a local object with a synthetic
   `backup_<userId>_<timestamp>` id, wrote the row *without* that id so Prisma generated a cuid,
   and returned the local object. `restoreBackup(userId, created.id)` looked up an id that was
   never persisted.
2. **The checksum could never match.** It was hashed from a JS object at write and from Postgres
   `jsonb` at read — and `jsonb` does not preserve key order. Worse, my first fix (sorting keys)
   was itself wrong: `sortDeep` treats a `Date` as an object with no enumerable keys and collapses
   it to `{}`, while the stored copy is an ISO string. Canonicalising now normalises through
   `JSON.parse(JSON.stringify(...))` first, so both sides hash the same shape.

Either bug alone made restore impossible. **A backup system that cannot restore is worse than
none, because it looks like insurance** — which is exactly why the harness drives a real round
trip: snapshot, corrupt, restore, assert recovery.

Now scheduled hourly (a full snapshot per online player is far too heavy for the 180s auto-save
tick), pruning in the same job so it cannot trade a missing feature for a disk leak,
reentrancy-guarded, and cleared in `stop()` — the last one because two timers were found the
same day with a stop method nobody called.

Also learned from the harness: `createBackup` **already self-prunes to 5 on every call**, so the
cap held even before the scheduled job existed. My first precondition asserted the opposite.

## Correction: `getTraceDuration` is not merely unwired — it is INVERTED

Checked before wiring, and it is the second item in this audit whose obvious fix would have
made the game worse.

`traceService:140` states the semantics plainly: a trace reaching `expiresAt` is COMPLETED and
**"the hacker is caught. Only evasion stops it."** So duration is the *window the hacker has to
evade*. `getTraceDuration` returns `baseMins − stealthSkill * 0.3` — so **higher stealth would
get you caught sooner**. Wiring it as written turns stealth into a liability.

Stealth already helps through `getTraceEvasionChance`, which *is* live. Whether it should also
buy time is a balance decision with the sign flipped — not a wiring job. Documented at the
function so the next reader does not repeat the attempt; `traceService` was reverted to
evidence-only duration.

**`getHackCooldown` was the genuine half of the pair and is now wired.** A flat 30s ran for
everyone while the field's own comment said "use getHackCooldown(skill)". The lookup lives
inside `applyCooldown` rather than in its parameters — all three callers had no skill in scope,
and a parameter every caller must remember to pass is how this became dead in the first place.
The explicit-duration override still bypasses scaling, so the 15s post-minigame cooldown is
unchanged.

## Correction: the IP cluster was superseded, not missing

I ranked `ipService`'s dead methods #3 — "traceroute is a genre-defining mechanic sitting
inert". **That was wrong, and it is the audit's own failure mode:** counting zero callers
correctly, then not checking whether a *better* implementation had replaced them.

- `traceRoute` generated **random hops** with fake latencies and a 20% "hidden hop" roll. The
  live `networkCommands.executeTraceroute` walks the **real topology** via
  `topoService.findPath` and masks undiscovered hops. (So PLAN's "traceroute hop-masking has no
  implementation" is also wrong — it is implemented, just not here.)
- `scanIPRange` / `discoverIP` predate the topology system. The live `scan` uses
  `handleSubnetSweep` + `topoService.discoverNeighbors` — the path P5-NEW fixed.

**Wiring them would have replaced real topology with dice.** Ten methods removed (789 → 458
lines); the service keeps IP *generation* and allocation bookkeeping, which is what it is for.

The lesson generalises to the rest of this document: "zero callers" answers *is it reachable*,
not *is it wanted*. The right question — the maintainer's — is whether the capability exists
elsewhere, and in what quality.

## Fixed immediately during the audit

### Faction wars — declare + stakes wired (1 of 4 connections remains)

`declareWar` had zero callers, so `startWarMonitor` ran and the `war` command read rows nothing
could create. But the feature needed **four** connections, not one — declare, score, reputation
effect, surrender — which is why it was invisible rather than merely buggy.

- **Declaring** is now an Architect intervention (`declare_war`), not a player command. That
  follows the signature: `declareWar`'s third parameter is documented `declaredBy // AI persona
  ID`, so wars were designed as AI-driven world events. Wired through the full chain — type
  union, validator allow-list, dispatch table, handler — and `declareWar`'s own guards
  (self-war, duplicate war, unknown faction) are passed through rather than re-implemented.
- **Stakes** now apply: `getReputationMultiplier` is consulted in
  `reputationEngine.applyReputationChange`, the single chokepoint every reputation change flows
  through. Applied to losses as well as gains — a multiplier that only rewarded would make war
  pure upside. It returns 1.0 with no war, so this was a **no-op on landing**.
- **Still unwired:** `updateWarScore` has no producer, so a declared war sits 0-0 and the monitor
  resolves it on elapsed time rather than on merit. The natural producer is `hackService`, when a
  player hacks a server owned by the enemy faction during an active war — but that is a
  game-design decision (what scores? how much?) rather than a wiring one. `surrender` likewise
  needs a `war surrender` subcommand and a decision about who may issue it.
- `scripts/verify-faction-wars.ts` — 11 checks driving the real executor and services,
  self-contained (builds its own factions and war, deletes both), and it **asserts the remaining
  gap** so it will fail loudly the day scoring is wired and this note goes stale.


**Two unstopped timers**, the exact shape `lifecycle.ts` claims to have fixed ("six subsystems
shutdown forgot" — it missed two more). Both start in a constructor and both have a stop method
with **zero callers**: `memoryService` (`setInterval(tick, 1000)`, `destroy()`) and
`missionGenerator` (`new CronJob`, `stopMidnightScheduler()`). Neither appeared in the shutdown
table. Added. The ticker is `unref`'d so it would not hang exit, but it kept firing through
teardown past `db.disconnect()`.

---

## Dimension 2 — the A4 sizing answer

**No other service has the `processStateService` shape** (registered, resolved, zero methods
called) — that one was unique. But the audit found the real A4 lever: `buildCommandContext`
performs **28 DI resolutions per command**, and **none are unused** — so A4 cannot be sized by
deleting injections. It sizes by **fan-out**: 17 of the 25 services are used by exactly *one*
command module. Every command pays for services only one module wants.

| Consumer | Used exclusively by it |
|---|---|
| `playerInfoCommands` | achievement, leaderboard, factionKnowledge, playerPresence |
| `hackCommands` | backdoor, trace, messageEncryption |
| `networkCommands` | connectionChallenge, networkTopology, serverService |
| `systemCommands` | darknetDungeon, darknetDiscovery |
| `missionCommands` | missionGenerator, storyMission |
| `socialCommands` | chat, forum |
| `shopCommands` | inventory |

Broad enough to stay in a base context: `missionIntegration` (7 modules), `memoryService` (4),
`shopService` (3), `keyFragment` (3), `fileService`, `gameStateManager`, `playerProgress`.

Also: `storyMissionService` is injected but **not declared** in `interface.ts` — it type-checks
only through the `[key: string]: any` escape hatch.

### Traps the audit had to correct (method notes)
- Walking `.claude/worktrees/` made every symbol match itself in a clone → 23 "dead" vs the real
  282. Excluded.
- "Zero external refs" ≠ "zero callers": module-level wrappers in the service's own file.
  `censorshipService` first scored 1/6 live — a false "censorship does nothing" finding — until
  `filterContentOrThrow` (5 call sites) was accounted for.
- String-indexed dispatch: `cacheService.dispose` has **zero** syntactic call sites and is live
  only through `lifecycle.ts`'s data table. The `?.` there means a rename fails silently.
- Name collisions: `.getStats(` looked live but every hit was internal — it is dead on 8 services.
- Harness *descriptions* containing a method name are not calls (`handleNPCReply`).

---

## Dimension 3 — socket events (complete)

### (a) DEAD — 19 emits, safe to delete

`authentication:complete` ⚠️, `command:executed`, `state:delta`, `server:created`,
`server:updated`, `server:deleted`, `server:state:changed`, `mission:notification`,
`forum:content-reported`, `forum:scan-complete`, `forum:accessed`, `forum:registered`,
`presence:player_joined_server`, `presence:player_left_server`, `presence:player_online`,
`presence:player_offline`, `proxy:connected`, `proxy:disconnected`, `message:reported`,
plus `mission:accepted` / `mission:abandoned` / `server:disconnected` (each fires inside a
command that already returns the outcome).

Notable reasons:
- ⚠️ **`authentication:complete` is unreachable.** It sits in the `else` of
  `typeof callback === "function"`, and all **15** emitters of `authenticated` /
  `authenticate:request` pass an ack (client + all 13 harnesses). My contract comment
  claimed it was "kept because harnesses rely on it" — **false, and now corrected**.
- The four `presence:*` events are **duplicates** of live equivalents
  (`server:user_connected`, `user:status_change` …), and are addressed to a single stale
  `p.socketId` while `MAX_SOCKETS_PER_USER = 4`.
- `mission:notification` is dead twice: its caller has no callers, and
  `missionIntegration.io` is permanently `null` (`setSocketIO` has zero callers).
- Four `server*` emits come from `serverService` methods with zero callers.

### (b) MISSING FEATURE — 11, each needs a decision

| Event | What the player currently misses |
|---|---|
| `security:warning` | **Honeypot tripped, and on the `registerForumAccount` path the player is told only `✓ Successfully registered`** — while their IP is logged and faction rep takes a hit. |
| `reputation:changed` | **Every faction standing change is silent.** The cross-faction rivalry mechanic — hacking A quietly helps A's rival — is completely invisible. |
| `state:update` | The only full-state push in the system, discarded. **There is no REST fallback** — no game-state endpoint exists — so the client rebuilds state ad hoc from whatever deltas arrive. |
| `connection:refused` | At the socket cap the client's `disconnect` handler returns early on `"io server disconnect"` **without setting `socketError`** → frozen UI, no explanation. |
| `force:disconnect` | **Kicked/banned players are never told why.** The admin types a reason; the client discards it. (A harness listens, so the emit must stay — wire it, don't delete it.) |
| `terminal:error` | Failed tab create/close/switch does **nothing at all** — `socket.once(...)` with no error listener and no timeout, so the click appears ignored. |
| `moderation:flagged` ⚠️ | **From my own Phase 6 work.** Auto-moderated content vanishes and the author is never given the reason the event already carries. |
| `server:alert` (attacker branch) | The attacker is never told they tripped an alarm, so a trace can begin with no warning. |
| `story:fragment-intel` | A plot lead — who holds the fragment you need — is composed and thrown away. |
| `faction:contest_started` / `_resolved` | **A server changing hands between factions produces no on-screen event for anyone**, including the participants. |
| `message:read_receipt` / `message:conversation_read` | Minor: no delivered-vs-read state exists for players. |

### (c) INTENTIONAL
`command:error` (9 harnesses) and the `command:execute` **listener** — harness-load-bearing,
must not be deleted despite having no client emitter.

### Settled
`join:room` / `leave:room` — dead on **both** sides; the client methods that emit them have
zero callers too. Delete both.

### ⚠️ Two findings a name-comparison audit cannot see
1. **`forum:new-post` / `forum:new-reply` are orphaned by ROOM.** Server emits, client
   listens, names match — but both go to `forum:<forumId>`, and the only rooms ever joined
   are `user:`, `player:` and `server:`. **No live forum update has ever reached a player.**
   My A3 contract declared them as if live; now corrected in place.
2. **`serverActivity` has no UI subscriber** — so even the presence channel that *is* wired
   displays nothing. Replacing the `presence:*` duplicates would not have fixed presence.

---

## Dimensions 4+5 — schema, config, files

### Dead models — 7 (152 schema lines + 6 back-relations)
`ForumPost`, `ForumReply` (the dead half of the two parallel forum families — the live one is
`Forum`/`Post`/`PostReply`; a seed variable named `aiForumPosts` is the only thing making the
dead pair look alive), `AidaClue`, **`Notification`**, `KnowledgeTopic`, `PlayerKnowledge`,
`IntelligenceReport`.

- **`Notification` — ✅ WIRED 2026-09-24.** Was fully specced with 5 indexes, read/dismiss/expiry
  columns and a `User` back-relation, and never written or read; delivery was socket-only and the
  client store in-memory, so nothing survived a reload.

  `utils/notify.ts` is now the single write point (6 per-user emit sites across `missionService`
  and `hackService` route through it), and `handlers.ts` replays unseen rows on authenticate.
  Marking read happens **after** the emit, so a failed emit leaves them pending instead of
  destroying them; persistence failures do **not** block delivery, since a database blip must not
  swallow a security warning.

  The `epochSchedulerService` world-event announcement deliberately stays transient — it is a
  global `io.emit`, and persisting it would mean one row per user for an ephemeral broadcast.

  **Three client bugs only the round trip exposed.** Writing rows is the easy half; replaying them
  is where it broke. `add()` stamped `timestamp: new Date()` unconditionally, so a three-hour-old
  security alert displayed as if it had just fired; it played a sound per notification, so a
  50-item backlog meant 50 overlapping tones; and the socket listener **re-derived priority from
  `severity`**, discarding the server's value so everything not exactly `critical` became `high`.
  That last one is the same shape R13 fixed one level down — a correct value computed server-side
  and thrown away by the consumer. `add()` also now dedupes on the server row id, because replay
  can race a live emit of the same row.

  `scripts/verify-notification-persistence.ts` — 30 checks. Negative-controlled by reverting to
  emit-only (7 red) and by putting `markNotificationsRead` before the emit (ordering check red).
  One check was vacuous and was found by that control: comparing the emitted id to the row id
  passed as `undefined === undefined` when nothing persisted.
- **`IntelligenceReport` is read but never written** (2 `count()` calls, 0 creates), so the
  `aidaIntel > 0 || fragmentDiscovery > 0` discovery gate runs permanently on one leg.

### Zero-row models worth noting
`HackSession`, `Backdoor`, `ActiveTrace`, `Bounty`, `HackLog` — **the entire PvP-hacking
persistence layer has never recorded a row** despite ~60 call sites. `InventoryItem` 0 rows
across 46 call sites (consistent with the known shop breakage). `FactionMember` 0 rows across
26 call sites — membership appears to run on `FactionStanding` (57 rows) instead.

### `gameBalance.ts` — 15 of the 18 dead constants have a LIVE HARDCODED TWIN
Editing them silently does nothing (CLAUDE.md bug shape #6). Worst case: the **entire bounty
economy** is five bare literals in one expression at `hackService.ts:2192-2194`, directly under
a comment restating the formula, while the named config sits unreferenced 1,800 lines away.
Pure orphans with no twin: `DETECTION_STEALTH_REDUCTION_PCT`, and `MAX_ACTIVE_MISSIONS` —
**there is no active-mission cap anywhere in the codebase.**

**Two dead exports the 18-item list missed**, both bug shape #4:
- `getTraceDuration` — zero callers. `traceService` rebuilds its own tiers and calls a
  duration function that **takes no stealth argument**, so the stealth reduction and the
  5-minute floor are never applied.
- `getHackCooldown` — zero callers; its only mention is *inside a comment*. A flat 30s runs,
  and **skill never reduces hack cooldown**.

### Files with zero importers — 1,020 LOC
`client/src/components/TerminalTabs.svelte` (356 — hidden by a name collision with the live
`services/terminalTabs.ts` store), `server/src/utils/ipUtils.ts` (180),
`client/src/utils/forumSystem.ts` (105), `server/src/database/seed.ts` (8, a stale stub whose
own docstring contradicts `package.json`), plus three maintainer-run scripts (361).

### Broken / hazardous npm scripts
`migrate:home-dirs` **and** `migrate:home-dirs:dry-run` both point at a file that does not
exist and is gitignored. `db:migrate` runs `prisma migrate dev` against a project with **no
migrations directory** — it would baseline the schema onto a history it has never had.

### Dead dependencies
`jest`, `ts-jest`, `@types/jest` (confirmed), `@types/cron` (stub for cron v2 while cron v4
ships its own types), and **`redis`** — declared, never imported.

---

## Item 4 — event subscriptions (wired 2026-09-24)

The audit filed this as "dead on both ends". Reading the code found something larger:
**no `GameEvent` had ever reached a player at all** — 34 rows in the dev database, zero
deliveries — because the two halves were broken in opposite directions.

**Writers that persisted but never broadcast.** `hackService.sendSecurityAlert` and the two
fileService honeypot blocks called `prisma.gameEvent.create` directly, skipping `createEvent`
and therefore `broadcastEvent`. 30 of the 34 rows are theirs. fileService has **no emit of any
kind**, so for a honeypot that row was the owner's *only* signal.

**Producers that broadcast to nobody.** `createEvent` (storyProgression's weight ≥ 7 beats) and
all four `createSystemAlert` callers are `isGlobal` with `affectedUsers: []`, and the global
branch of `getEventRecipients` was a stub whose body added exactly the `affectedUsers` the next
line already added, under the comment *"Would query for online users, for now just affected
users"*. Empty in, empty out.

**No acquisition path for the only other route to becoming a recipient.** No `/api/events` route
is mounted anywhere (the server has four route files: admin, adminApi, auth, command), no socket
handler, no command, no item. `loadSubscriptionsFromDatabase()` ran at startup against a table
nothing could write.

**And the client dropped whatever did arrive.** Two `game:event` listeners on one name with
incompatible payload shapes; a `gameEvents` store with zero consumers; an empty
`game:event:public` stub; `state.notifications` (built from `getUserEvents` on every state
broadcast) dying at `state:update`, which has no listener; and `showNotification` — **12 call
sites** — was an **empty method**. Seven of those twelve had no other notification, so new mail,
forum replies, a newly assigned mission and a server discovery were all silent.

### What changed

- `getEventRecipients` no longer pretends to handle globals. Targeted → `notifyUser` (persisted,
  replayed). Global → one `io.emit`, transient. Same rule the notification work set.
- **The public emit is gated on `isGlobal`.** It used to fire for *every* event, so a breach or a
  tripped honeypot told every connected player. Routing the honeypot through `createEvent` would
  have *introduced* that leak had the gate not gone in first.
- Both honeypot writers now go through `createEvent` via one `alertHoneypot` helper (the two
  blocks were near-duplicates).
- **`hackService.sendSecurityAlert` deliberately keeps its direct write** — its caller calls it an
  audit log, and `notifyServerOwner` (3 sites) is the player channel. Routing both would send the
  owner two alerts for one intrusion. Commented so it is not "fixed" into a duplicate later.
- `showNotification` is real; the 5 story sites that already called `ns.add` had their redundant
  call removed so nothing double-notifies.
- `game:event` is gone in both directions — one channel, one shape, one listener.

### The tap (acquisition path — maintainer's call)

A shop item, with quality tiering it: `basic_tap` 1200c/q30/60m, `shielded_tap` 4500c/q60/3h,
`quantum_tap` 18000c/q90/12h. `tap <ip|player|faction>` — one command for all three, because
`targetId` already matched against `metadata.serverId || factionId || targetUserId`.

**Two of the four subscription fields were inert and one now isn't.** `quality` was documented
"affects event detail/reliability" and did neither: the only code reading it fired for INFO
severity below 30, so 30 and 100 behaved identically and detail was never varied anywhere. It is
now a real dial across every severity (`utils/eventIntercept.ts`), with critical deterministic at
every tier so a breach is never silently dropped. `method` is still **never read** — left as
recorded provenance rather than given five invented behaviours.

`HONEYPOT_TRIGGERED` had to be added to `EventType`: fileService wrote it as a raw string, so it
was **unsubscribable by construction**.

### Three further bugs found while wiring

- `quality` was persisted **unclamped** while the in-memory copy was clamped, so a restart
  resurrected an uncapped tap.
- Re-tapping the same target inserted another `isActive` row every time. The Map collapses them
  at startup, so it leaked invisibly.
- No cap on active taps, and `getEventRecipients` walks the map on every event. Now
  `MAX_ACTIVE_TAPS = 5`.

`scripts/verify-event-subscriptions.ts` — 45 checks, including the honeypot driven end to end
through `fileService.readFile`. Negative-controlled four ways: un-gating the public emit (3 red),
reverting the quality dial (1 red), and reverting the honeypot to a direct write (3 red). The
fixture caught itself twice before passing — "file not found", then "permission denied" — which is
the only reason the honeypot checks mean anything.

---

## `state:update` / `state:delta` (built out 2026-09-25)

Filed as one of the remaining group-B socket events. It was the largest, and the
disposition was not obvious — the first read looked like the IP-discovery shape (a
superseded predecessor), and the detail that settled it was **when it fires**.

**All three layers were dead, in a way each hid from the others.**

- `state:update`/`state:delta`: **zero client listeners**. Every authenticate ran a
  five-way parallel query batch (reputation, inventory, missions, events, server info)
  and discarded the result. `broadcastStateDelta` had **zero callers**, so there was no
  update mechanism at all — the push was a login-time snapshot.
- The client's own REST fallback pointed at routes that **do not exist**.
  `loadInitialGameData()` ran on login, register *and* token-verify, calling
  `/api/users/stats` and `/api/servers`. Both **404** — confirmed by curl against the
  running dev server; only `/api/csrf-token`, `/api/admin`, `/api/command`,
  `/api/commands` and `/api/auth` are mounted. Both calls sat behind their own
  try/catch in `api.ts` and returned `{}`/`[]`, so the failure was completely silent —
  and because `knownServers` was therefore always empty, the
  `connectToServerInternal(homeServer)` branch below it could never run either.
- The stores that would receive it had **zero consumers**. `playerProgress`,
  `knownServers`, `currentServer`, `discoveryLevel`, `currentDirectory`,
  `connectedServers` — no component imports any of them. (`Terminal.svelte`'s
  `currentServer` is a local `let`, not the store.) Only `currentUser` is used anywhere.

Meanwhile the live path is command-driven: `ShopDialog` got credits by running the
`status` **command**, re-run on every open via `$: if (visible) loadPlayerData()` —
a workaround for having no push channel.

So wiring `state:update` into those stores alone would have been the `gameEvents`
mistake from the previous item: filling a store nobody reads. The maintainer chose to
build it out rather than delete it.

### What that took

- **Client listeners** for both events, plus `playerState` and derived
  `playerCredits`/`playerLevel`/`playerSkills`/`playerInventory`/`playerMissions`,
  modelled on the existing `playerResources` push store.
- **`applyStateDelta` lives in `shared/`**, not the client. A delta channel only works
  if both sides agree what a path means, and that agreement is the fragile part.
- **An update mechanism, at the right depth.** Deltas come from
  `PlayerProgressRepository` — the single sanctioned writer of `player_progress` — so
  one subscription covers hack rewards, mission payouts, trace penalties and command
  grants alike, rather than 23 call sites. The repository's own docstring says it
  "deliberately does no I/O beyond the database", so it emits an **in-process** event
  and `gameStateManager` (which owns `io`) does the socket work. That rule is preserved,
  not bent.
- **`shopService`'s five orphan events finally have a subscriber.** It already
  `extends EventEmitter` and emitted `item:added`, `item:removed`, `purchase:complete`,
  `item:sold`, `item:used` — with **no listeners anywhere**. The emit calls were already
  in the right places. Inventory changes now trigger a one-query slice refresh, against
  the five-query cost of a full `state:update`.
- **Resync on drift.** A delta that cannot be applied means the two sides disagree;
  the client asks for a full state. Throttled to one per 5s client-side **and** rate
  limited server-side, because the trigger repeats for every subsequent delta.
- `ShopDialog` reads the store; the `status` poll and the 404 REST calls are gone.

### Two bugs avoided, one gap kept open

- **Transactions.** `addCredits`/`spendCredits` end with a read through the same `tx`,
  so inside a transaction they observe **uncommitted** state. Announcing that would push
  a balance that can still roll back, so the announcement is suppressed under `tx`.
  Transactional callers (`shopService.purchaseItem`) emit their own post-commit event,
  which the bridge picks up instead.
- **`svelte-check` did not catch a deleted function still being called.** Removing
  `loadPlayerData` left a live call in the purchase handler and the check passed clean.
  A real `vite build` is now part of the routine.
- **KNOWN GAP, stated not hidden:** the nine direct `player_progress` writers produce no
  delta. Four are row *creation* (no delta to send); the two that matter are the admin
  progress editor and `restoreBackup`, both absolute writes. A client watching either is
  stale until its next `state:update`. Missions also have no delta yet.

`scripts/verify-state-push.ts` — 36 checks. The core one applies the **real client
applier to the real server delta** and compares against the database. Negative-controlled
three ways: renaming the server's skills path (red), dropping the shop subscription (red),
removing the transaction guard (red).

**The path-rename control taught the harness something.** Renaming
`player.skills.hacking` to `player.skill_hacking` still *applied* cleanly — it walks
`player` and sets a leaf — so "every delta was applied" stayed green while the value
landed where nothing reads it. `client=10, db=17`, no error anywhere. **`applied` is
necessary and not sufficient**; only the comparison against the database catches it.

---

## Code review of the orphan work (2026-09-25) — 10 findings, 4 fixed

Ran the 8-angle review over the whole uncommitted diff (1,849 lines, 22 files). **48 raw
candidates, 10 after dedup and verification.** The uncomfortable headline: the harnesses
were at 36/36 and 45/45 while every one of the ten was true.

Three specific ways they lied:

- **`verify-state-push.ts` SP-4 proved the transaction guard *suppresses* an announcement,
  and stopped there.** It never asked whether a purchase still updates credits. It does not
  — both money paths run under `tx`, so `announce` correctly stayed silent, and the bridge
  only refreshed `inventory`. **Five of eight review angles found this independently.**
  I had tested the mechanism and not the outcome.
- **Only a *server* tap was ever tested.** Player and faction taps — two of the three target
  kinds — could never match, because the target check short-circuited on
  `metadata.serverId || factionId || targetUserId` and nearly every event carries a serverId.
- **Structural checks confirmed ShopDialog *subscribes* to the store.** Nothing checked the
  store ever *changes*.

### The four fixed

1. **No credits delta on purchase or sale.** The bridge now refreshes credits as well as
   inventory from the post-commit shop event, coalesced per player (one `useItem` emits two
   events, a purchase emits two — the old listener ran the queries twice). This was a
   straight regression: ShopDialog's re-poll was deleted citing a comment of mine that was
   false, and the same false claim sat in the repository docstring.
2. **`tap <player>` / `tap <faction>` could never deliver.** The matcher now compares against
   every candidate rather than the first present one. `attackerId` is deliberately *not* a
   candidate — a tap watches what happens *to* a target, not what it does to others.
3. **`use <tap>` destroyed the item and did nothing.** `useItem` deletes any `isConsumable`
   and returns success; it never reads `effect`. It now refuses taps and names the `tap`
   command. An 18,000-credit `quantum_tap` was being binned by the most natural verb.
4. **Notification replay marked rows read on an unconfirmed emit.** `socket.emit` neither
   throws nor confirms delivery, so the guard the comment described could never fire — a
   half-dead socket destroyed the whole backlog. Replay is now ack-gated with a timeout,
   emits **oldest-first** (the query is newest-first and the client prepends, so the backlog
   rendered upside down and the newest alerts were evicted at the 50 cap), and carries the
   persisted `category`, which had been written to the row and dropped from every payload —
   making the client's `data.category === "security"` branch unreachable.

Fix 1 also folded in the **inventory shape mismatch**: the delta pushed
`{itemId, item, quantity}` while `state:update` pushed `{id, name, type, …}` at the same
path. There is now one `toStateInventory` used by both. Two producers for one path was the
bug; one function is the fix.

Each fix is negative-controlled by restoring the original defect and confirming red —
`50000 -> 50000` against `db=48800`, and `Used Basic Network Tap` destroying the item.

### Still open (filed, not fixed)

- **`tap` has no discovery or ownership check** — any player can tap any home server by IP
  and read its honeypot alerts, including the raw `attackerId`. This is why fix 2 stopped at
  the matcher and did **not** widen producer metadata to carry player ids: doing so before
  the access check would extend the reach of an unguarded tool.
- **`game:event:public` now carries `event.metadata`**, which includes raw `User.id`s — a
  leak I introduced by widening the payload, in a game that sells 10,000-credit aliases.
- Tap consumption is a non-transactional check-then-act (N taps for one item) and bypasses
  `shopService`, so it is the one inventory mutation that emits no delta.
- `createSubscription` mutates the in-memory map before its two DB writes.
- `mirrorPlayerState` unconditionally re-sets `currentServer` on every delta.
- Comment-accuracy cluster: `effect: { tapQuality }` on the catalog rows is read by nothing
  (`TAP_ITEMS` in gameBalance is the live copy — a fresh bug shape #6, with a comment
  asserting the opposite); `server:discovered` now double-notifies; two JSDoc blocks bind to
  the wrong member.
- `Notification` rows grow without bound — nothing sets `expiresAt`, nothing deletes.

### The lesson worth keeping

**Negative-control the outcome, not the mechanism.** Every one of my controls flipped the
switch I had just installed and confirmed the switch moved. None asked whether the light came
on. The new checks are phrased as "the client's credit value changed" and "the item
survives", not "the guard fired".

### The remaining six, fixed (2026-09-25)

- **`tap` had no access check.** Now gated on discovery: a server must be owned or reachable
  via a `DiscoveredLink` (the same notion `netmap` uses), and a player target requires having
  discovered *their* home server. Factions stay ungated — they are public entities.
  **The existence oracle went with it:** "no such target" and "you have not found it" now give
  one identical message, because `tap.remove` costs nothing and two different errors would let
  anyone sweep IPs to map real servers without scanning.
- **`game:event:public` leaked raw `User.id`s** — a leak I introduced by widening the payload.
  `publicMetadata()` drops any key ending in `id`. Blunt on purpose: an allowlist has to be
  updated whenever a producer adds a field, and forgetting fails silently, whereas a missing
  field gets noticed.
- **Tap consumption was a check-then-act and bypassed `shopService`.** The stock test now lives
  in the WHERE clause — the same idiom `spendCredits` uses — so the database is the arbiter.
  `handleTap` consumes through `removeItemFromInventory` (so `item:removed` fires and the
  inventory delta happens), consumes *before* subscribing, and **refunds** if the cap rejects
  it. A failed refund is logged loudly rather than swallowed.
- **`createSubscription` mutated the in-memory map before its DB writes.** Database first,
  map last. A failed insert used to leave a live, unexpired, unrecorded tap while the command
  reported failure and kept the item.
- **`mirrorPlayerState` clobbered `currentServer` on every delta.** It no longer mirrors it at
  all: `applyStateDelta` copies only along the delta's path, so `state.currentServer` stays
  frozen at login, and re-setting it reverted the player to their login server after any
  credit change while `currentDirectory` still pointed at the server they had navigated to.
- **Comment cluster.** `server:discovered` no longer double-notifies; the `showNotification`
  JSDoc was reattached to the method it describes (it had bound to `lastResyncAt`); the
  "nothing double-notifies" claim is now counted rather than asserted; and the tap catalog's
  `effect` block is documented as a mirror of `TAP_ITEMS` with
  `verify-balance-constants.ts` asserting the two copies agree, so the drift that made it a
  fresh bug shape #6 cannot go unnoticed.
- **`Notification` grew without bound.** `purgeOldNotifications` deletes read/dismissed rows
  past a 30-day window and anything past its own expiry. **Unread rows are never touched at
  any age** — a purge that could delete an unseen security warning would reintroduce the bug
  the persistence work exists to fix. Scheduled every 6h via `registerShutdownTimer`, because
  an unwired purge would have been a fresh orphan in the middle of an orphan-fixing task.

**Two harness checks were themselves wrong and had to be fixed:**

- `verify-event-subscriptions` asserted "subscribes BEFORE consuming", which encoded the old
  design. Subscribe-first protected the item from a cap rejection but left the consume racy;
  consume-first-with-refund is strictly better, and the check now asserts *that*.
- `verify-phase5-o9-timers` required **exactly two** registered inline timers and failed the
  moment a correct third was added. It now asserts the invariant — *every* inline
  `setInterval` in `index.ts` is registered (3/3) — which cannot rot as the count changes.
  This is the "assume every number is stale" rule biting a harness rather than a doc.

**Negative controls:** restoring the raw metadata broadcast turns the leak check red;
restoring the check-then-act consume turns the concurrency check red (2 of 5 concurrent
consumes succeeded against the old code). The concurrency check is **behavioural** — the first
version only asserted which method was called, and restoring the race tripped nothing, which
is the same gap that caused this review in the first place.

### Finishing the half-done edges (2026-09-25)

Four decisions, taken before committing rather than after.

**1. All three tap targets are real now.** Checking every live `createEvent`/`createSystemAlert`
caller showed that *no* producer emitted a `factionId` or a victim's user id — so after the
matcher fix, player and faction taps were still purchasable no-ops. Two producers now name
their subject: `alertHoneypot` carries `targetUserId`, and the `declare_war` intervention
raises `createFactionWarEvent` (reviving a dead factory and giving faction taps their only
possible match in one stroke).

That required solving a leak first. `broadcastEvent` now splits **named recipients from
watchers**: the party an event names gets the full record, a watcher gets the same news with
identifiers scrubbed by the same `publicMetadata` the global channel uses. So a tapper learns
a honeypot fired on a server they discovered, and does **not** learn who tripped it — a tap
must not be a cheaper deanonymiser than the 10,000-credit alias reveal.

**2. Missions are the fifth live slice.** `PlayerMissionRepository` gained the same in-process
announcer as the progress repository — emitted from `writeMission` (the single private write
path behind `put`/`mutate`/`mutateAll`, so it cannot fire for a skipped write) and from
`incrementObjective`, which uses raw SQL and never reaches it. One subscription covers
missionService, tutorialService, storyMissionService and missionGenerator alike.

**3. `broadcastStateDelta` takes an `operation`.** `push`/`remove`/`update` are reachable from
a producer for the first time instead of being implemented, declared in the wire contract, and
dead.

The debounce generalised with it: one `scheduleSliceRefresh(userId, ...slices)` with a pending
set per player, so a burst collapses into one pass. The `slice` parameter that review called
speculative generality is a real union now — `"inventory" | "credits" | "missions"` — and
`toStateMissions` joins `toStateInventory` as a single definition per path.

**4. Harnesses stay untracked** (decision 17 stands). The accepted consequence is unchanged and
worth restating: ~700 checks live on one machine, and a fresh clone can verify none of this.

**A harness check had to be inverted, not just updated.** `verify-event-subscriptions` asserted
*"no live producer keys an event to a player"* — a true statement about a gap, written as a
check. Closing the gap turned it red. It now asserts the positive, plus the owner-sees-ids /
tapper-does-not split. A check that encodes a limitation expires the moment the limitation
does, which is a second way for a green suite to be misleading.

Negative-controlled: removing the mission announcement turns 4 checks red; handing watchers the
full metadata turns the deanonymisation check red.

---

## Closing the audit (2026-09-25)

Everything that was still open is now closed, wired or explicitly refused. What moved:

**Four orphaned socket events got listeners** — `faction:contest_started` / `faction:contest_resolved`
(the payoff of the whole contest system produced no on-screen event), `server:alert` (the
*attacker* branch had no client equivalent, so a trace could start with nothing on screen), and
`story:fragment-intel` (it tells you who holds the fragment you need; it was composed, addressed
correctly, and dropped).

**The forum room nobody joins.** `forum:new-post` / `forum:new-reply` are emitted to
`forum:<forumId>`, and nothing had ever joined it — the audit's subtlest find, because a
name-comparison audit scores those events healthy: the server emits them and the client listens
for them. Rooms are now joined on authenticate from `ForumMember`, and on registration via
`io.in(user:<id>).socketsJoin(...)` so a mid-session registration reaches every open tab.

**`updateWarScore` finally has a producer.** A successful hack against a server held by a faction
you are at war with now scores. The war lookup lives in `warfareService.recordHackForWar` — that
service owns what a war *is*; hackService only knows a hack succeeded. Previously every declared
war sat 0-0 and its monitor resolved on elapsed time rather than on anything either side did.

**Passive resource drain runs.** `registerConnection` / `registerBackdoor` had zero callers, so
the entire drain economy — `PASSIVE_COSTS`, `addPassiveConsumer`, the resource ticker — ran
against a permanently empty consumer set. Connections register on connect and release on
disconnect; backdoors register on both install paths. **The golden master caught this as a real
behaviour change** and the diff is exactly the intended effect: a `[connection]` consumer
appearing in `ps`, with RAM and bandwidth totals moving to match. That is better evidence the
wiring works than any structural check.

**`rejectDraft` had zero callers because the route re-implemented it** inline against raw Prisma,
while the approve route two blocks up went through the service. Two implementations of one
transition, only one of which logged. The route now delegates.

**Review leftovers, all closed:** `notifyUser`'s envelope now wins over producer data (and emits
`category` on the live path, not just the replay); the `authenticated` / `authenticate:request`
handlers are rate-limited — they were the only unlimited handlers on the socket and the most
expensive, and this work had made them heavier still; `GameStateManager` gained a public `stop()`
and a seat in the shutdown table, releasing its cleanup interval, the slice-refresh timers and the
three bridge subscriptions.

**The client's REST connect path is gone.** `connectToServer` / `connectToServerInternal` /
`disconnectFromServer` called `/api/servers/:id/connect` and `/disconnect` — neither route is
mounted (404, curled) and no component called any of them. Connecting is `connect <ip>` over
`/api/command`. Removing them leaves `currentServer`, `connectedServers` and `currentDirectory`
with no writer **and** no reader; that is stated in place rather than papered over, and the
surviving `createFile`/`createDirectory` store helpers were already dead — their only "callers"
are `api.ts` methods that log *"not implemented yet"*.

### Deliberately still open

- **#2 hack alerts and #15 `handleNPCReply`** — filed Phase 8, unchanged.
- **#10 `getTraceDuration`** — still refused. It is INVERTED: more stealth gets you caught sooner.
- **Backdoor drains are not restored at boot.** The consumer map is rebuilt empty on every restart,
  so a backdoor that is never re-installed or upgraded stays unregistered. Restoring from the
  `Backdoor` table at startup is the real fix and is its own change.
- **The 9 direct `player_progress` writers** still emit no delta.
- **`PROJECT_KNOWLEDGE.toon` is three phases behind** (Phase 5 R9–R13, Phase 6, Phase 7).

---

## Review #2 and the method change (2026-09-25)

The second 8-angle review over the same working tree produced **15 verified findings, and
roughly half of them were defects in the fixes I made for review #1.** That is the important
result, more than any individual bug: the defect rate was not falling, and each pass was landing
on code the previous pass had just touched.

### What was actually wrong with how I was working

- **I added protective mechanisms for theoretical risks and shipped concrete breakage.** The
  socket auth rate limit (guarding a flood nobody had seen) returned without answering the ack,
  stranding a live socket in no rooms. The replay ack-gating (guarding an undelivered frame)
  awaited fifty 10-second timeouts on the auth path. The `/id$/i` metadata scrub guarded a key
  *name* while the sensitive value — the decoy filename — sat in the prose beside it.
- **I wrote tests for the mechanism I had just built, not the outcome.** Review #1 established
  this and I did it again: the tap-refund check matched a call's *formatting*, so it went red when
  the call was wrapped across lines and would have stayed green if the refund had stopped working.
- **I asserted invariants in comments that nothing checked.** Two angles independently caught
  comments stating the opposite of the code, including one claiming three stores were dead when
  two had live writers and readers — a comment that would have guided a destructive cleanup.

### The rules this pass ran under

1. One defect, one change, verified before the next.
2. No new protective mechanism for a risk that has not been demonstrated.
3. No invariant in a comment unless a harness asserts it.

### The thirteen fixes

The two that could strand a player came first: the rate-limited auth now **answers the ack** with
an error (the bug was dropping it, not limiting), and the replay **runs off the auth critical
path**, marking rows read per-ack rather than in one awaited batch.

Then: the purge's `expiresAt` branch now requires the row to have been seen (it deleted unread
rows while two comments promised it could not); the `as never` casts are gone and faction
**names** rather than cuids reach a globally broadcast title; `targetFactionId` joined the tap
candidate list (the defender's key — half of all faction taps matched nothing); the tap refund
**branches on the returned boolean** instead of a `.catch` that could never fire;
`removeItemFromInventory` can no longer report `false` after the stock is spent; backdoor drains
are released on both removal paths and **all** drains on session end; and the tap cap is reserved
synchronously with a rollback, reconciling two earlier fixes that were each half right.

**The honeypot leak needed a design change, not a patch.** Scrubbing `data` was pointless because
the filename lives in `description`, and nothing excluded the *attacker* from watchers — so a
player could tap the server they were about to raid and read the victim's own alarm system to
enumerate every decoy. Access control was never going to fix that. Watchers now get a **per-event
summary** ("A decoy file was accessed on a server you are watching"), and an unlisted event type
degrades to a generic line rather than falling through to the full description — so a new event
type leaks nothing by default, the opposite of the denylist it replaces.

Five false comments were corrected in place, each naming what it previously got wrong.

### Verification

`verify-notification-persistence` gained a **behavioural** purge check with a positive control
(an unread expired row survives; once read, it is purged) — negative-controlled by restoring the
bare `expiresAt` branch and confirming red. Suite: 46 harnesses / 0 fail
(event-subscriptions 71, state-push 56, notification-persistence 42). Golden master unchanged,
client builds.

### Still open

Angle E's finding that **`traceroute` mints a `DiscoveredLink` with no access check** stands: the
tap access gate is satisfiable by one free command. It is no longer load-bearing for
confidentiality — watchers receive summaries now — but the gate does not do what its comment says
and should either be strengthened or dropped honestly. Also open: `recordHackForWar` has no
per-target dedupe or contribution cap; the forum-room join does not filter `isBanned`; the
`gameStateManager.stop()` teardown uses `removeAllListeners` on shared singletons; overlapping
slice refreshes are last-write-wins; and the admin reject route now returns 500 where it returned
404/400.

---

## The traceroute discovery gate (2026-09-25)

Review #2 filed this as *"traceroute defeats the tap access gate"*. Reading the code first
changed what the defect actually was — and the fix is in a different place than the report
pointed.

**Traceroute is not a free bypass.** It costs `networking: 15`, an active connection, a resource
check, and `findPath` must return a real topological route. "You traced a route to it" is
legitimate discovery; the gate's hint saying *"Try `scan` first"* was simply incomplete, and its
rationale comment overstated what the gate was protecting.

**The real defect was underneath, and had nothing to do with taps: two writers populated
`discovered_links` with different rules.**

- `discoverNeighbors` (scan) refused a non-public server, a `hidden` link below networking 30,
  and a `vpn` link below networking 15.
- `discoverPath` (traceroute) applied **none** of them and upserted every hop on the route.

So `scan` refusing a hidden link at networking 15 bought nothing — the same link was obtainable
by tracerouting through it, and the entire link-type progression was decorative. That would still
be true if the tap feature did not exist, which is how you can tell it was the real bug.

`canDiscoverLink(linkType, targetIsPublic, scanLevel)` is now the single predicate both paths
obey. In `discoverPath` the check uses the *target* hop's visibility, so tracing **towards** a
private server no longer reveals it.

### Method note

This one was done under the rules adopted after review #2, and the ordering mattered:
`verify-discovery-rules.ts` was **written before the fix and confirmed red** — 4 failures on the
three rules plus the shared-predicate check, with both positive controls already green, so the
failures could not have been the harness simply not working. After the fix: 7/7, and the positive
controls still pass, which is what distinguishes "the rule is enforced" from "discovery stopped
working".

The two comments that were wrong are corrected in place rather than quietly dropped: the hint now
names both discovery commands, and the rationale records that the gate is no longer load-bearing
for confidentiality at all, because watchers receive a per-event summary rather than the record.

Suite: 47 harnesses / 0 fail. Golden master unchanged.

---

## War scoring: dedupe and cap (2026-09-25)

`recordHackForWar` awarded points on every successful hack against an enemy-faction server with
no per-server dedupe and no per-player cap. The only limiter was the generic hack cooldown
(10–30s), so one account re-hacking the weakest enemy server produced ~3,600 points/hour against
a war that `forceCeasefire` decides purely by comparing the two scores. One player overnight
settled a fourteen-day war the defending faction never got to contest.

**Two limits, because each alone is farmable.** A per-(war, player, server) cooldown stops
re-hacking one weak target; a per-(war, player) cap stops the obvious answer to that, which is to
rotate targets. The last award is clamped so a player cannot overshoot the cap.

### Where the state lives, and what that costs

`HackLog` has exactly the right columns — `attackerId`, `targetServerId`, `success`, `timestamp` —
and was **rejected on purpose**. It is written FIRE-AND-FORGET one step earlier in the same
pipeline (`this.logHackAttempt(...).catch(...)`, no `await`), so whether the current hack is
present when scoring runs is a race. Deriving the rule from it would be the "assert the state the
code READS, not the state you can see" trap, and it would fail intermittently.

The windows are therefore in memory, with the limitation stated at the declaration rather than
left to be discovered: **both maps are rebuilt empty on restart**, so a restart resets every
cooldown and every contribution total for wars still running — the cap is per-process, not
per-war. Making it durable needs a small schema addition and a maintainer `db:push`; that is
filed rather than faked. A swept, `unref`'d interval prunes expired cooldowns, and contributions
are pruned **by war status rather than by age**, because ageing them out would restore the
rotation exploit the cap exists to stop.

### Method

Test written first and confirmed red — 100 points from ten hacks on one server, 500 from rotating
41 targets — with the "a different player still scores" and "an unaligned server scores nothing"
controls already green, so the failures could not have been the harness simply not working. Then
**each limit was negative-controlled separately**: disabling only the cooldown turns exactly one
check red, disabling only the cap turns exactly the other two red. That is what shows the two
limits are independently load-bearing rather than one masking the other.

### Two of my own checks were wrong and were fixed

- The restart-caveat check used a plain regex and went red because the phrase wrapped across two
  comment lines — testing layout, not content, the same brittleness that bit the tap-refund
  check. It now normalises comment continuations first.
- The `unref` check matched the bare word, and `warfareService` has **three** `unref` calls — so
  it would have passed on the war monitor's timer. It now names `warSweepInterval` specifically.

### Known, not fixed

A player can still contribute to both sides of the same war over time, because the faction lookup
reads current membership: join A, contribute, defect to B, contribute again. The per-player cap
bounds it to `WAR_MAX_POINTS_PER_PLAYER` per side, which makes it a curiosity rather than an
exploit, so it is recorded rather than designed around.

Suite: 48 harnesses / 0 fail. Golden master unchanged.

---

## Forum live-feed access (2026-09-25)

The forum-room join added earlier the same day did
`forumMember.findMany({ where: { userId } })` and joined **every** row. `banMember` only sets
`isBanned: true` and leaves the membership in place — the posting paths check that flag
(`forumService:619`, `:1941`), the join did not — so a banned member rejoined `forum:<id>` on
their next authenticate and kept reading every new post and reply in real time. Archived
(`isActive: false`) forums broadcast too.

This was latent before the join, because nothing had ever joined that room. **The join is what
made it exploitable, which makes it mine.**

### The fix is half a rule and half a location

`forumService.getLiveFeedForums(userId)` is now the single decision point, and it lives in the
service rather than inline in `handlers.ts` deliberately: an access rule inside a socket handler
cannot be tested without standing up a socket, which is exactly why the inline version was never
exercised by anything. `handlers.ts` no longer touches `forumMember` at all — two places deciding
who may read a forum is how two rules drift.

**`accessForum` was deliberately NOT reused**, which is worth recording because the previous item
(`playerKnowsServer`) went the other way. That check is request-scoped and interactive: it takes a
`useProxy` flag a socket join cannot answer, and it **auto-discovers the forum as a side effect**.
Calling it once per membership on every authenticate would mutate state and ask the wrong
question. Reuse is right when the existing check answers the same question; this one does not.

### Method

Test written first. It failed with `getLiveFeedForums is not a function` — red for the right
reason — then, once the function existed, the two structural checks stayed red until the handler
actually routed through it. **tsc then caught what the harness could not**: the handler referenced
a `services` binding that is destructured in that scope, so the structural checks passed on text
while the file did not compile. A structural check proves a string is present, not that the code
builds.

Negative control: removing the filter turns exactly the three exclusion checks red (3 forums
returned for 3 memberships) while the positive control stays green.

### Filed, not fixed

`registerForumAccount` performs none of `accessForum`'s checks, so a player who learns a forum id
can create a membership and reach this list. That predates the room join, but the join raised its
stakes from "can post" to "receives a live feed", so it belongs on the list rather than buried in
this fix.

Suite: 49 harnesses / 0 fail. Golden master unchanged.

---

## Admin draft review: HTTP status (2026-09-25)

Delegating the reject route to `contentDraftService.rejectDraft` swapped the route's typed
`NotFoundError`/`ValidationError` for the service's plain `new Error(...)`. `formatServerError`
only preserves a status for `GameError` subclasses, so every ordinary admin outcome — rejecting a
draft someone else already handled, or one that was deleted — became a **500 with the reason
stripped** (`"An unexpected error occurred"`), logged at error level as if the server had
faulted. The admin lost both the status code they branch on and the message telling them what
happened.

**The fix belongs in the service, not the route.** `approveDraft` throws the same bare errors and
was exposed to this *before* the delegation ever happened, so putting typed errors back in the
route would have fixed one of two paths and preserved exactly the asymmetry that caused the bug.
Both now throw `NotFoundError` (404) and `ValidationError` (400).

### Method

Test written first and confirmed red: 7 failures, every one of them a 500 carrying
`"An unexpected error occurred"`, with the positive control (a real rejection still succeeds and
records its review note) already green — so the failures could not have been the harness simply
not reaching the code.

The negative control reverted **only** `NotFoundError` and turned exactly four checks red,
including `approveDraft`'s — which is the concrete demonstration that fixing the route alone
would have left the sibling path broken and looking fine.

### A note on fixture discipline

The fixture cost four round trips to `ContentDraft`'s required columns — `title`, `description`,
`source`, and a `createdBy` that does not exist on the model — because I guessed field-by-field
from successive Prisma errors instead of reading the model once. Reading `schema.prisma` first is
both faster and the only way to notice a field you invented.

Suite: 50 harnesses / 0 fail. Golden master unchanged.

---

## Overlapping state-slice refreshes (2026-09-25)

`scheduleSliceRefresh` removed its timer entry at the start of the callback and fired
`void this.refreshStateSlices(...)` without awaiting, so an event arriving during the database
work armed a second timer and two flushes ran concurrently. Both push whole-slice `set` deltas
with no sequence number, and `applyStateDelta` is unconditionally last-write-wins — so a slow
flush that **started first could land last** and overwrite a newer one. `applied` is true for
both, so nothing detected it and no resync fired; the client stayed wrong until an unrelated
change or a reconnect.

Fixed by serialising per player: `flushSlices` holds an in-flight marker and **drains** the
pending set, so anything scheduled mid-flush is picked up by the next turn of the loop rather
than by a competing flush. A `finally` re-arms if work arrived in the gap between the loop's last
check and releasing the marker. No sequence number is needed — Socket.IO preserves order within a
connection, so once the server emits in order the client receives in order.

### The test was wrong first, and that is the point

The first version tried to invert `player.credits` and **passed against the buggy code**.
`refreshStateSlices` reads inventory *before* credits, so stalling the inventory query delays the
credits read past the update rather than before it — the stale value is never observed. A test
that cannot fail is worse than no test, and it would have certified this fix.

Rewritten to target the slice whose query the harness actually controls: the stub returns a row
tagged `STALE` on the slow first call and `FRESH` thereafter, and the assertion is that the *last*
push is `FRESH`. That reproduced it immediately (`last push = STALE`). The timing is forced rather
than hoped for — without the injected 300ms stall this would pass or fail on machine speed.

Two controls bound it from the other side and both were green before and after: a single refresh
still pushes the current value (serialising must not mean dropping), and six scheduled refreshes
still collapse into one inventory push (the debounce must survive). Negative control: disabling
only the in-flight guard turns exactly the ordering check red.

Suite: 51 harnesses / 0 fail. Golden master unchanged.

---

## Scoped bridge teardown, and a harness that was eating its own database (2026-09-25)

**`gameStateManager.stop()` called `removeAllListeners(<event>)` on three DI singletons it does
not own.** That removes every subscriber for those names, not the ones the bridge added. Nothing
else subscribes today, so it was latent — but the failure mode is why it was worth closing now:
the next service to listen for `progress:changed` would work in dev and be silently unsubscribed
the first time `gracefulShutdown` ran, with no error, only during shutdown, reading as "the event
isn't emitted".

Fixed by recording each subscription as it is made and tearing down with `off(event, handler)`.
The test registers a foreign listener on all three buses, calls `stop()`, and asserts the foreign
ones survive **and still fire** — `listenerCount` alone would not catch a detached handler — while
the bridge's own are gone. Negative control: restoring the blanket teardown turns 9 of 10 red.

### The suite was quietly poisoning itself

The full run then failed in `verify-phase5-p5new-discovery` with `no free IP in the populated
subnet`, while the same harness passed in isolation. Not flaky — **accumulating**. That harness
moves a probe account's home server into a 50-address window (`.200`–`.249`) and its cleanup
deleted only the **user**, leaving the server holding that address forever. One address per run.
All 50 were gone: partly its own leaked `p5b…'s Terminal` rows, partly dungeon content that had
legitimately moved in.

So a green codebase produced a red suite, for a reason that had nothing to do with the code —
exactly the failure CLAUDE.md warns about when a harness reads and mutates ambient database state.
Fixed on both axes: the scan now covers the whole usable range rather than a 50-address window,
and `cleanupProbeAccount` deletes the home server as well as the user, reporting failures loudly
instead of swallowing them.

**A measurement mistake worth recording.** My first leak check used
`name: { startsWith: "__" }` and reported 560 leaked servers. Prisma passed the underscores
straight into `LIKE`, where `_` is a single-character wildcard — so it matched almost everything,
including `Training Gateway`. The real number was 14. An over-broad filter is not a finding, and
it nearly sent me deleting production seed data.

I attempted to reclaim the 50 consumed addresses with a narrow, orphans-only script; the
environment blocked it as a destructive database operation, which is correct. It is also
unnecessary — widening the scan range resolves the failure without deleting anything. The rows are
harmless clutter and can be cleared by the maintainer at the next `db:reset`.

Suite: 52 harnesses / 0 fail. Golden master unchanged.

---

## Review #3 (2026-10-06) — 21 findings, and the decision to stop fixing

Three reviews over this changeset: **10 findings → 15 → 21.** Roughly half of each round's
findings were defects in the previous round's fixes. That is not convergence, and the two
patterns behind it are both mine:

1. **New machinery to guard a risk nobody demonstrated.** The rate limit on `authenticated`,
   the ack-gating on notification replay, and the passive-drain wiring each produced a finding
   in every review they existed for. None of them was guarding an observed failure.
2. **Comments asserting facts about other files.** ~40% of all findings across the three
   rounds. The block in `client/src/stores/gameState.ts` was wrong three consecutive times,
   each time after an explicit correction — and the version review #3 saw still named
   `connectToServerInternal` and `disconnectFromServer` as live writers of `currentServer`
   after the same changeset had deleted both functions.

So this round reverts rather than patches where the machinery was the defect, and deletes the
prose that keeps being wrong instead of correcting it a fourth time.

### Reverted

- **The rate limit on `authenticated` / `authenticate:request` is gone.** `generalRateLimit` is
  the *shared* per-user budget that typing indicators also spend, so a player who exhausted it
  and then reconnected got a live socket that never ran `handleAuthentication` — no rooms, no
  state, no notifications. Breaking login to cap a flood nobody has observed is the worse trade.
  The harness check that asserted the limit answered its ack has been replaced by one asserting
  the outcome (`generalRateLimit` does not appear in the auth handlers), with a positive control
  on the slice and a negative control proving the file still rate-limits elsewhere — a check
  that encodes a mechanism expires when the mechanism does.

### Fixed, each negative-controlled individually

| # | Defect | Fix | Control |
|---|---|---|---|
| 1 | `releaseAllFor` was `passiveConsumers.delete(userId)`, so one logout wiped **backdoor** drains, which nothing re-registers | `releaseSessionConsumersFor` releases only `terminal` and `connection` | restoring the blanket delete → `BT-4` red |
| 2 | `warSweepInterval` armed in the constructor was never cleared; its callback was `void`-ed with no catch | `stopWarMonitor` clears it; the callback goes through `safeExecute` | removing the clear → `WS-4` red |
| 3 | `createSubscription`'s rollback deleted by map key, so a failed **re-tap** destroyed the working subscription the player already held | capture `previous`, restore it rather than delete | restoring the bare delete → `ES-13` red |
| 4 | `recordHackForWar` read `warContributed`, then awaited, then wrote — concurrent hacks all read the same pre-write total | claim both maps *before* the await, roll back on failure | moving the writes back after the await → +400 against a cap of 200 |
| 5 | `flushSlices` deleted the pending set before awaiting and `refreshStateSlices` swallows, so one transient query failure dropped the slice permanently | `refreshStateSlices` returns a boolean; the slices are put back on failure and ride along with the next event | dropping the restore → `SR-2b` red, 2 checks |
| 6 | Live notifications were never marked read; `purgeOldNotifications` never touches unread rows and `getPendingNotifications` takes 50, so the backlog was permanent | occupancy of `player:<id>` is read before the insert and written as `isRead` in the same statement — one write, not two | removing it → `NP-3b` red, 3 checks |
| 7 | `banMember` set `isBanned` but never evicted the socket, so the ban did nothing until reconnect | `io.in(user:<id>).socketsLeave(forum:<id>)` | removing the call → `FF-4` red |
| 8 | `getLiveFeedForums` streamed `requiresProxy` forums that `accessForum` refuses to show without a proxy | excluded outright — room membership is decided once at authenticate while proxy status changes mid-session, so there is no answer that stays true | removing the filter → `FF-1` red |

**On #6.** The first version marked read with a second `updateMany` after the emit, fire-and-forget.
It also crashed every harness with a fake `io`, because it reached into
`io.sockets.adapter.rooms` unguarded. Both are fixed by deciding `seen` before the insert: one
write instead of two, deterministic for a test, and optional all the way down so an `io` without
an adapter fails **closed** — if we cannot see the room we do not claim the player saw the alert.

**On the WS-5 control.** The first attempt patched out the reservation with a regex that also ate
the `try {`, and the harness went red on what was effectively a syntax error — red for the wrong
reason proves nothing. Redone as a valid edit that moves the two `set` calls after the `await`:
one check goes red, reporting `+400 vs cap 200`.

**On the ES-13 control.** The first version stubbed `prisma.eventSubscription.create` on the
*harness's* own `new PrismaClient()`. `eventService` imports `prisma` from `database/client`, so
the insert sailed through and the check reported a rollback failure that was really a test bug —
the "assert the state the code READS" trap, hit again.

### Deleted rather than corrected

Three comment blocks in `client/src/stores/gameState.ts` totalling ~60 lines of archaeology about
routes that 404, which stores have writers, and what previous versions of those same comments got
wrong. What survives is the one claim that is local and load-bearing: do not mirror
`currentServer`, because `applyStateDelta` copies only along the delta's path and mirroring it
reverted the player to their login server on every credit or XP change.

### The golden master had been failing on the calendar

`03:helpCommands:stats` went red, and it was not a regression. The normaliser scrubbed ISO
timestamps (`\d{4}-\d{2}-\d{2}T…`) but not bare calendar dates, and `stats` prints *Recent
Activity* as `YYYY-MM-DD  N commands`. The baseline recorded `2026-09-25`, so it had been red
since `2026-09-26` — for any change, or for none.

Fixed by scrubbing bare dates too, and by **re-normalising the stored baseline with the current
rules at comparison time** rather than re-recording. Re-recording would have erased the evidence
that nothing else moved; re-normalising proves it, and the run came back `23 PASS / 0 FAIL`.
Negative-controlled afterwards by perturbing `pwd`, which turns exactly one case red.

This is the "cries wolf" failure the normaliser's own comment warns about, and it had already
started: a master that fails every day is one you stop reading.

**Final state:** 52 harnesses, **846 checks, 0 fail** (dev server up — 10 of them need it).
Golden master 23/23 unchanged, negative-controlled. `tsc`, `eslint`, `svelte-check` clean;
client production build succeeds with `VITE_API_URL` set.

### Review #4 — the method change did not lower the defect rate

Run against this round's changes only (the rest of the diff has had three passes). **Four of the
eight fixes above were themselves defective**, and two of the four were subtler versions of the
very bug they fixed. The negative controls were real — they all went red for the right reason —
and they still did not catch these, because every one is an interleaving or a sibling path the
control did not model.

| my fix | what was still wrong |
|---|---|
| #1 session-scoped drains | **A regression I introduced.** The old blanket `delete` was incidentally reclaiming backdoor drains; narrowing it correctly left the *expiry* paths holding a drain nothing releases. `cleanupExpired` did not even `select` `installerId`, so it could not have. Fixed: one `releaseBackdoorDrain` helper, called from all three deactivation paths. |
| #3 subscription rollback | Still wrong under concurrency. Two `tap`s on the same target from two tabs share a `subId`; A reserves, B reserves over it, B commits, A fails — and A's rollback destroyed B's live, paid-for subscription. Fixed: roll back only if `activeSubscriptions.get(subId) === subscription`. |
| #4 war-cap reservation | Restoring the pre-await snapshot loses a concurrent increment. A reads 0 → 50, B reads 50 → 100, B commits, A throws, A writes 0 — erasing B's committed award and refunding the whole cap. Fixed: subtract `award` from the current value. |
| #7 ban eviction | `unbanMember` has no symmetric rejoin, so an unban is silently inert until reload. **Left open** — it is a new asymmetry my fix created, but the right fix is shared with the `registerForumAccount` gap below. |

**Also found, left open as decisions rather than patched:**
- `registerForumAccount` joins `forum:<id>` unconditionally, so a mid-session registration
  subscribes a player to the proxy-only feeds `getLiveFeedForums` was just changed to exclude —
  visible in one session, gone the next. The join needs the same predicate, ideally by calling
  the rule rather than restating it.
- Reverting the auth rate limit leaves the most expensive handler on the socket unbounded, and it
  ends in a `socket.broadcast.emit` to every connected client. "No limit" was not the only
  alternative to "the shared limit" — a dedicated limiter on its own key gets both properties.
- Marking a notification read on room membership alone contradicts the ack-gating on the replay
  path *in this same changeset*: a sleeping laptop stays in the room for ~45s, so an alert emitted
  into a dead socket is written `isRead` and never replayed. The replay path already solves this
  with `socket.timeout(...)` and the client already sends the ack.
- `cleanupSession` and `initializeSession` have zero callers, so half of fix #1 is inert, and the
  `"terminal"` branch of `releaseSessionConsumersFor` is unreachable because nothing registers a
  terminal consumer. The harness exercises it directly, which is why it looked covered.

**The honest read.** Three reviews said "stop adding machinery and stop writing comments that
assert things." I did both, and the per-fix defect rate held at roughly half. The remaining cause
is not carelessness about mechanisms or prose — it is that these are concurrent, multi-path
changes being verified one path at a time. A control that proves the fixed path works says nothing
about the sibling path or the interleaving, and I have now written eleven such controls that were
individually valid and collectively insufficient.

### Closing the four left open (2026-10-06)

| # | What | How |
|---|---|---|
| 1 | Auth limited again, but **on its own budget** | `UserLimiters.auth`, 5 per 10s, spent by nothing else. The original mistake was charging it to `general`, which typing indicators also spend — ordinary play could exhaust it and the next reconnect produced a live socket in no rooms. On a dedicated budget, reaching the limit can only mean the client is looping, so refusing is correct; and the refusal answers the ack so the client is not left with a promise Socket.IO never settles. |
| 2 | One forum live-feed rule, four callers | `ForumService.LIVE_FEED_MEMBERSHIP` is the predicate; `syncLiveFeedRoom(userId, forumId)` joins or leaves to match it. `getLiveFeedForums`, `registerForumAccount`, `banMember` and `unbanMember` all go through it. Previously two of the four restated the rule and two had none. |
| 3 | `unbanMember` rejoins | Was a new asymmetry created by the ban fix: an unban left the player outside the room, able to read and post but with a silently dead live feed until reload. |
| 4 | Live notifications are **ack-gated**, matching the replay path | Room membership was the wrong signal. Socket.IO keeps a socket in its rooms for `pingInterval + pingTimeout` (~45s) after the connection really dies, so a sleeping laptop had its security alerts written `isRead` and emitted into the void — the exact failure the replay path had already been fixed to avoid. Now `io.to(room).timeout(10s).emit(…, cb)` and the row is marked read only if at least one client answers. Broadcast acks deliver the responses received so far even on timeout, which is why it keys off the response array rather than the error. |

Also folded in: `removeDetectedBackdoor` was the third copy of the same inlined drain-release block
and now calls `releaseBackdoorDrain` with the other three.

### Two checks that were green for the wrong reason

Both found by controlling the fix rather than trusting it, and both are the same defect in my
*verification* that review #4 identified in my code — **a check that cannot tell one path from two**.

- `authRateLimit()` was asserted with `.test()`. Removing the limit from `authenticated` left the
  check green, because `authenticate:request` still had one. Now it **counts** guards against
  handlers and asserts there are exactly two of each; removing either turns it red.
- The backdoor check, written to count from the start, immediately reported `3 release calls for 4
  deactivations` — a fourth deactivation path I had not looked at. It turned out to be covered, by
  a third inlined copy rather than the helper. A matching check would have passed and left the
  duplication; the counting one found it.

**Final state:** 52 harnesses, **860 checks, 0 fail**. Golden master 23/23, negative-controlled.
`tsc` / `eslint` / `svelte-check` clean; client production build succeeds with `VITE_API_URL`.

### Review #5 — the counting check had the same blind spot in a new disguise

Five findings. The first one is the result that matters, because it lands on the lesson from
round #4 rather than on the code:

**A FIFTH backdoor deactivation site, which the counting check could not see.**
`useBackdoor` deactivates on discovery with `isActive: !discovered`
([backdoorService.ts:263](server/src/services/backdoorService.ts:263)), not the literal
`isActive: false` every other site uses. My check counted `/isActive: false/` and reported a
confident 4-for-4. Round #4's lesson was "count, don't match"; the counting check was still
*matching* — on one spelling of the write. **A counting check is only as good as what it counts.**

The leak it hid is the worst of the set: `getBackdoors` filters on `isActive: true`, so once a
backdoor is discovered the player cannot see it to remove it, while its CPU/RAM/BW drain follows
them until the process restarts. Fixed, and the pattern now matches any non-`true` write to
`isActive` with a precondition asserting it sees the negated spelling.

**The client authenticates TWICE per connection, so the auth budget was sized on a false premise.**
`socket.ts:277` emits `authenticated` on every `connect`; `App.svelte:86` then emits
`authenticate:request` on the same socket. My comment said "a real client authenticates once per
connection" — the same shape of error (a comment asserting a fact about another file) that three
earlier rounds flagged, written again while fixing the thing those rounds were about. At 5/10s
the real headroom was ~2.5 page loads; two tabs reloading plus one background reconnect would
refuse a legitimate login, and a refusal is terminal because nothing retries. Budget raised to
30/10s, sized from what the client actually does, and the comment now states it.

**Left open, with reasons:**
- *A refused auth is never retried.* `socket.ts:281` sets `socketError` and `App.svelte:103`
  logs "degraded, not fatal"; re-authentication only happens on a fresh `connect`, and the socket
  is still connected. At 30/10s this is now out of reach for a legitimate client, but the recovery
  gap is real and belongs with the client reconnect logic, not here.
- *The idle sweep can hand back a limiter budget.* `lastUsed` is written only on creation and on
  `limitersFor`, which runs once per CONNECTION — not when a limiter is consulted. A player active
  in one tab for 60s has their `UserLimiters` swept while that tab's captured closures keep
  working; a second tab then builds a fresh budget. That multiplies every published limit by the
  number of tabs opened more than 60s apart — the exact property S9 exists to prevent. Pre-existing
  and wider than this changeset; filed rather than fixed mid-round.
- *Cascade-deleted backdoors never release their drain.* Three paths delete `GameServer` rows and
  `Backdoor.server` is `onDelete: Cascade`, so a dungeon regeneration silently orphans the
  consumer. Same family as the known "drains are not rebuilt at boot" gap.

**Ruled out and worth recording** (the reviewer checked these and they hold): the forum rule
unification is complete — nothing else joins or leaves a `forum:` room and nothing at runtime
flips `isActive`/`requiresProxy`; the notification ack is correct for an empty room (socket.io
fires the callback immediately with `[]`, so no timer is held per offline notification), for a
partial ack, and against double-marking; and there is no ack-id collision between the broadcast
path and the replay path's socket-level acks.

---

## The four open items, closed (2026-10-06)

### 1. A refused authentication is now retried

It was terminal. `socket.emit("authenticated")` ran once per `connect`; on failure the client set
`socketError` and stopped — but the socket was still CONNECTED, so neither `handleReconnect`
(driven by `disconnect`/`connect_error`) nor another `connect` ever fired. A healthy-looking
socket in no rooms, with no state and no notification replay, recoverable only by a manual reload.

`authenticateSocket(attempt)` now retries at 2s / 5s / 11s — stepping past the 10s limiter window
rather than hammering it — and sets `userId` from the ack itself. That last part matters: the
App.svelte bootstrap has its own one-shot attempt and a "degraded, not fatal" catch, so if it
loses and this path wins, nothing else would set the id hack alerts are targeted by.

**The sibling path that nearly got away.** `cancelAuthRetry` is called from FOUR places, not just
the `disconnect` handler — because `connect()` and `disconnect()` both call `removeAllListeners()`
*before* `socket.disconnect()`, so that handler does not run on either of them. A timer surviving
`connect()` would fire against the NEW socket and run a second retry chain alongside the one
`connect` had just started.

### 2. The limiter sweep no longer hands back budgets

Two defects, one cause. `lastUsed` was written only by `limitersFor`, which runs once per
CONNECTION — so the sweep's own safety argument ("an entry untouched for longer than the window
has an empty sliding window by definition") was false for any actively-playing user. And the
socket CAPTURED the limiter closures, which keep working after their map entry is swept, so a
second tab built a fresh independent budget. Together: every published limit silently became
per-tab for tabs opened more than 60s apart — exactly the multiplication S9 exists to prevent,
reintroduced through its own memory sweep.

Fixed by resolving per event — `limitersFor(userId)[kind]()` — which makes the map the single
source of the budget *and* stamps `lastUsed` by use.

### 3. Cascade-deleted servers release their drains first

`Backdoor.server` is `onDelete: Cascade` and three paths delete servers
(`serverService`, `darknetDungeonService`, `adminApi/servers`). After the delete there is no row
left to say whose resources the backdoor was costing, so the consumer became unreachable by every
release path — `removeBackdoor` truthfully answers "No backdoor installed on this server" while
the drain keeps charging. The player-visible version: hack a dungeon box, install a backdoor, and
pay for it forever once the dungeon hits its TTL and regenerates.

`releaseDrainsForServers(serverIds)` is called before the delete at all three sites. The harness
proves the ORDERING rather than just the call: it releases, asserts the drain is gone, then
re-registers, deletes the server, and asserts that calling it afterwards **cannot** free anything.

### 4. registerForumAccount enforces the checks it was missing

`forum register <forumId> <handle>` takes a raw id from the player and enforced only existence.
Now also:
- **Discovery.** You must have found the forum. `accessForum` auto-discovers rather than refusing,
  so the legitimate route is unchanged — access it, then register. The error says so, because
  "Forum not found" for a forum that plainly exists reads as a bug.
- **The proxy requirement**, which only `accessForum` enforced. Reading a proxy-only forum needed
  a proxy; creating an identity on one needed nothing.

Checked against LIVE proxy status rather than `accessForum`'s `useProxy` flag — there is no flag
on this path, and status is the stronger question. The two are deliberately **not** shared: one
asks "did this request opt into the proxy", the other "is this player actually behind one", and
collapsing them would change `accessForum` as a side effect. Stated here so the difference reads
as a decision rather than drift.

Sibling paths enumerated: the three other `forumMember.create`/`upsert` sites are all AI/NPC
identities (`aiUserId`, `npcUserId`), so `registerForumAccount` really is the only player route.

Each of the four is negative-controlled individually, including one control per deletion path and
one per forum gate.

### The suite caught both of these before they landed

Running the full suite after the four fixes turned two harnesses red. Worth recording because
they are opposite failure modes and both were mine.

**A real violation.** Wiring `releaseDrainsForServers` into three deletion paths, I reached for
`await import("../di/tokens")` out of habit. `verify-phase7-a5-cycles` forbids exactly that, and
is right to: `di/tokens.ts` has zero imports and 60 plain-string exports, so there is no cycle to
defer and the dynamic form is pure churn. All three files already imported from it statically; the
fix was to add `BACKDOOR_SERVICE` to the existing import. A rule established three phases ago
caught a lapse the same day it was written.

**A brittle check of my own.** `verify-phase7-a3-socket-contract` asserted
`/emit\("authenticated",\s*\(/` — which requires `emit(` and the event name to be ADJACENT.
Moving the call into `authenticateSocket` wrapped the arguments across lines, and the check went
red against code that was correct. Its sibling, `!/emit\("authenticated"\)\s*;/`, had the
complementary bug: it would have gone vacuously GREEN against a bare wrapped emit. Both are now
whitespace-tolerant (`/emit\(\s*"authenticated"\s*,\s*\(/`) and controlled by reintroducing a bare
emit, which turns both red.

That is the fourth time in this changeset a check has tested layout rather than behaviour. The
pattern is specific enough to name: **if a regex spans a call boundary, assume prettier will break
it, and allow `\s*` at every join.**
