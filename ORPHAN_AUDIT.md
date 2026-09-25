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
| 4 | **Event subscriptions — dead on BOTH ends** | `eventService.createSubscription`/`removeSubscription`/`getUserSubscriptions` + 6 typed factories unreachable; `client/src/services/api.ts` has the matching dead `subscribeToEvent`/`getEventSubscriptions`/`unsubscribeFromEvent`. `loadSubscriptionsFromDatabase` runs at startup and loads rows **nothing can write**. | 212 LOC + client |
| 5 | **Progress backup / restore** | Entire subsystem dead: `createBackup`, `restoreBackup`, `getBackups`, `deleteOldBackups`, `createBackupForAll`. `ProgressBackup` table: 0 rows. There is no recovery path for player progress. | 168 LOC |
| 6 | **Faction standing changes are silent** | `reputation:changed` emitted, no listener. The cross-faction rivalry mechanic — hacking A helps A's rival — is invisible to the player. | wire only |
| 7 | **Honeypot trap gives no warning** | On the `registerForumAccount` path the player sees `✓ Successfully registered` while their IP is logged and rep drops. `security:warning` is emitted and dropped. | wire only |
| 8 | **Territory changing hands is invisible** | `faction:contest_started` / `faction:contest_resolved` are global emits with no listener. The payoff of the whole contest system produces no on-screen event. | wire only |
| 9 | **Notifications do not survive a reload** | The `Notification` model is fully specced (5 indexes, read/dismiss/expiry) and **never written or read**. Delivery is socket-only, client store in-memory. | 32 schema lines |
| 10 | **Hack cooldown** ✅ WIRED 2026-09-24 — skill now reduces it. **Trace duration ❌ NOT wired: the function is INVERTED** (see below). | | |
| 11 | **No active-mission cap exists** | `MAX_ACTIVE_MISSIONS = 5` has no consumer and no hardcoded twin — nothing anywhere limits how many missions a player holds. | 1 constant |
| 12 | **Failed terminal tab operations do nothing** | `terminal:error` emitted from 5 sites; client uses `socket.once(...)` with no error listener and no timeout, so the click appears ignored. | wire only |
| 13 | **Kicked/banned players are never told why** | `force:disconnect` carries the admin's reason; the client's `disconnect` handler returns early without surfacing it. Same for `connection:refused` at the socket cap → frozen UI. | wire only |
| 14 | **No live forum updates reach anyone** | `forum:new-post`/`forum:new-reply` are emitted to room `forum:<id>`, **which nothing ever joins**. | join the room |
| 15 | **NPCs post but never answer** | `forumService.handleNPCReply` — zero callers. (Filed Phase 8.) | 162 LOC |
| 16 | **Passive resource drain never happens** | `registerConnection`/`registerBackdoor` zero callers; `registerTerminal` is called only from `initializeSession`, which itself has zero callers. Nothing feeds `addPassiveConsumer`. | 6 methods |
| 17 | **Drafts can be approved but never rejected** | `contentDraftService.rejectDraft` — zero callers. | 1 method |
| 18 | **Moderated content vanishes unexplained** | `moderation:flagged` carries the reason; nothing listens. (From my own Phase 6 work.) | wire only |
| 19 | **Attacker never learns they tripped an alarm** | `server:alert` attacker branch has no client-side equivalent, so a trace can begin with no warning. | wire only |
| 20 | **A plot lead is composed and discarded** | `story:fragment-intel` tells you who holds the fragment you need. No listener. | wire only |

### B. UNIFY, don't delete — 15 tunable knobs with live hardcoded twins

These look like dead constants but deleting them **loses the ability to tune the game**. The fix
is the reverse: make the service read the constant. Worst case — the **entire bounty economy**
is five bare literals in one expression at `hackService.ts:2192-2194`, sitting under a comment
that restates the formula, while the named config is unreferenced 1,800 lines away. Also
`DETECTION_FLOOR_PCT` (3 twins), `BOUNTY_EVIDENCE_THRESHOLD` (4 twins), the AI cadence values
(env-shadowed), `MISSION_EXPIRATION_INTERVAL_MS`, `DAILY_MISSIONS_PER_PLAYER`, `DUNGEON_*`.

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

- **`Notification` is the notable find:** fully specced with 5 indexes, read/dismiss/expiry
  columns and a `User` back-relation — and never written or read. All notification delivery is
  socket-only and the client store is in-memory, so **nothing survives a reload**.
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
