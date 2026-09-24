# Orphan audit — 2026-09-24

Five dimensions, run in parallel, every claim positive-controlled. Two of the four
reports landed findings that contradict comments **I wrote earlier the same day** —
those are marked ⚠️ and were corrected immediately.

Method note that generalises: **matching names is not enough.** Two of the biggest
findings below are invisible to a name-comparison audit — an event can be emitted and
listened for and still reach nobody (wrong room), and a service can be registered,
resolved and injected everywhere and still be dead (no method ever called).

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
