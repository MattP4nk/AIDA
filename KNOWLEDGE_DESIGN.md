# AIDA Knowledge & Redaction — Design

Design for turning content redaction into a real progression system, and wiring the existing
minigames into it as the earn mechanic.

**Intent (stated 2026-08-30):** *make players earn the information they find.*

**This is already a broader effort than the redaction file.** The same uncommitted changeset also
renamed the giveaway servers (`[AIDA] Primary Node` → `Unknown Signal Source`, `[AIDA] Archive` →
`Phantom Archive`, `[AIDA] Mesh Router` → `Ghost Relay`) and added access-key discovery — a `cat`
hint via `scanForAccessKeys`, and a grant on `download`. Those are the same design instinct applied
to *names* and *access* rather than *body text*, and they belong to this system:

- **Server names** should become `KnowledgeTopic`s too. A player who has earned `entity.aida`
  should see the real designation in `scan` output; everyone else sees the cover name. That is
  strictly better than renaming them globally, because the lore is still *discoverable* rather than
  deleted.
- **Access keys** are already a working earn-loop (find file → download → gain access). The
  knowledge system should reuse its shape, and `source: "download"` in §4 mirrors it deliberately.

Companion to `PLAN.md` (Phase 8) and `SHELL_DESIGN.md`. Supersedes the uncommitted
`server/src/utils/contentRedaction.ts`.

---

## 1. The core problem with the current implementation

Redaction today is a **pure function** of `(content, cryptoSkill, isHomeServer)`. Nothing records
what a player has already uncovered.

That single fact causes most of the observed weaknesses: you cannot reward a player *once* and
have it stick. Download a file to your home server and it reads clear there; find the same lore in
a file on another box and it's garbled again. The player earned the knowledge and the game forgot.

**Earning implies earned state.** Everything below follows from adding it.

Secondary defects in the current implementation, all fixed by this design:

| | Problem | Fix |
|---|---|---|
| K1 | Deterministic garble seeded only on the term → identical output everywhere, so one unlock silently reveals that term globally (ECB-mode for lore) | Seed on `(topic + fileId)` |
| K2 | `Math.max(original.length, 4)` preserves length → "AIDA" (4) vs "the emperor" (11) trivially distinguished | Pad to length buckets |
| K3 | `cryptoSkill >= 50` reveals **first and last character** → `AIDA` renders `A…A`, 4 chars. Hands over the answer for the most protected term | Replace with **category** reveal |
| K4 | `skipRedaction` is never passed `true` anywhere; `decrypt` does nothing to redaction. 1 of 3 advertised earn paths is wired | Knowledge levels replace the flag |
| K5 | Applied to `render(lines)` — *after* ASCII layout. The hex style's `[a:b:c]` brackets change length and will misalign table columns | Redact content pre-render |
| K6 | Coverage is 2 files. `messageService`, `forumService`, `missionService`, `personaService`, `storyMissionService` are all unredacted — the most lore-dense AI output | Central helper, explicit tiers |
| K7 | `redactionCount++` skipped on the high-skill path → the `[N sections redacted]` footer vanishes for the most invested players | Count before branching |

---

## 2. Model: topics, not patterns

Redaction stops operating on regexes-in-code and starts operating on **knowledge topics** — first
class, seeded, referenceable by missions and story.

```prisma
model KnowledgeTopic {
  id          String  @id @default(cuid())
  slug        String  @unique              // "entity.aida", "person.emperor", "event.shattering"
  label       String                       // "ENTITY" — shown at partial reveal
  category    String                       // entity | classified | contact | location | event
  tier        Int     @default(1)          // 1-5 — drives which minigame gates it
  patterns    String[]                     // regex sources matching this topic in text
  codexEntry  String?                      // prose shown in `codex <slug>` once fully known
  revealStyle String  @default("hex")      // "hex" | "glitch"

  knowledge   PlayerKnowledge[]
  @@index([tier])
}

model PlayerKnowledge {
  id           String   @id @default(cuid())
  userId       String
  topicId      String
  level        Int      @default(1)        // 1 = category known, 2 = fully revealed
  source       String                      // "minigame:cipher_storm" | "download" | "story" | "skill" | "trade"
  sourceRef    String?                     // fileId / serverId / missionId that granted it
  discoveredAt DateTime @default(now())

  user         User           @relation(fields: [userId], references: [id], onDelete: Cascade)
  topic        KnowledgeTopic @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@unique([userId, topicId])
  @@index([userId])
}
```

Note the FK + `onDelete: Cascade` and the `@@unique` — deliberately avoiding the two mistakes
catalogued as D7/D10 in the audit.

### Three knowledge levels

| Level | Player sees | Meaning |
|---|---|---|
| **0** (no row) | `[0a3f:b7c2:9e41]` | You don't know this exists |
| **1** | `[ENTITY]` | You know *what kind* of thing is hidden, not which |
| **2** | `AIDA` | Fully earned |

Level 1 is the important addition. It replaces the character-reveal (K3) with something that
rewards progress **without leaking the answer**, and it makes a document legible as a map:
*"this file hides two entities and a contact"* is a genuinely useful intermediate reward.

---

## 3. Redaction engine v2

```ts
interface RedactionContext {
  known: Map<string, 1 | 2>;   // topic slug → level, from PlayerKnowledge
  fileId: string;              // garble seed scope (fixes K1)
  autoTier?: number;           // topics at/below this tier auto-resolve to level 1 via skill
}

function redactContent(content: string, ctx: RedactionContext): {
  text: string;
  hidden: { category: string; count: number }[];   // drives the footer
}
```

Rules:
- **Level 0** → `garble(topic.slug + ctx.fileId)`, padded to the next multiple of 4 (fixes K1, K2).
- **Level 1** → `[ENTITY]` / `[CLASSIFIED]` / `[CONTACT]` from `topic.label`.
- **Level 2** → the original text, untouched.
- Called on **raw content, before `render()`** (fixes K5).
- Returns the hidden-summary separately, so the footer is composed by the caller and counted
  correctly at every level (fixes K7).

Footer becomes informative rather than just a count:

```
[3 sections redacted — 2 ENTITY, 1 CONTACT]
[run 'analyze notes.txt' to attempt decryption]
```

**Style:** default to the `hex` presentation (`[0a3f:b7c2]`). The block-character glitch set
(`░▒▓█`) reads as game UI rather than terminal output and works against the console-realism goal
(`SHELL_DESIGN.md`). Keep `glitch` available per-topic via `revealStyle` for deliberate effect.

### Coverage (fixes K6)

One helper, applied at every player-facing content boundary:

| Path | Tier | Redacted? |
|---|---|---|
| `cat` / file reads | full | **yes** |
| network command output (`probe`, `scan`, `whois`…) | full | **yes** |
| persona DMs (`messageService`) | full | **yes** — currently unredacted, most lore-dense |
| AI forum posts (`forumService`) | partial — public rumour tier | **yes**, but topics may be seeded at level 1 |
| mission briefings | **no** — never gate the critical path (§6) | no |

---

## 4. Minigames as the earn mechanic

You already have three complete minigame generators. **This design adds no new minigame code** —
it routes the existing ones.

| Generator | Challenge | Skill | Existing command |
|---|---|---|---|
| `fileAccessMinigameGenerator` | `anomaly_scan` | forensics | `sweep` |
| | `disk_sector` | forensics | `sweep` (hard) |
| | `brute_force` | cryptography | `crack` |
| | `cipher_storm` | cryptography | `crack.storm` |
| | `entropy_overload` | cryptography | `crack.storm` |
| `hackMinigameGenerator` | `cipher`, `port_sequence`, `memory_trace` | hacking | hack layers |
| `connectionChallengeGenerator` | `handshake`, `signal_trace` | networking | `connect` |

### Routing: topic tier selects the challenge

`analyze <file>` inspects the highest-tier unknown topic in that file and spawns the matching
challenge:

| Topic tier | Challenge | Grants |
|---|---|---|
| 1 | `anomaly_scan` | level 2 for tier-1 topics in the file |
| 2 | `disk_sector` | level 2 for tier ≤2 |
| 3 | `brute_force` | level 2 for tier ≤3 |
| 4 | `cipher_storm` | level 2 for tier ≤4 |
| 5 | `entropy_overload` | level 2 for tier ≤5 |

Outcomes:
- **Win** → `PlayerKnowledge` at level 2 for every topic at/below that tier in the file,
  `source: "minigame:<type>"`, `sourceRef: fileId`.
- **Partial** (correct category, wrong answer) → level **1**. Progress is never zero.
- **Fail** → cooldown on that file, and evidence increases — you tripped something. Thematic, and
  it reuses `calculateEvidence`.

This finally gives `sweep`/`crack`/`crack.storm` a **persistent** reward. Today they grant one-shot
file access; here they grant knowledge that applies everywhere, forever.

### Other earn paths

| Source | Grants | Notes |
|---|---|---|
| `minigame:*` | level 2 | primary path |
| `download` | level 2 for that file's topics | **preserves today's behaviour** — but persistently, and it applies on every server rather than only at home |
| `decrypt` | level 2 | finally wires K4's dead path |
| `skill` | level 1, auto, for `tier <= floor(cryptography / 25)` | skill still matters, but only ever grants *category* — never the answer |
| `story` | level 2 | narrative beats can hand over knowledge directly |
| `trade` | level 2 | **see §7** |

---

## 5. New commands

- **`analyze <file>`** — spawn the tier-appropriate challenge. Reuses `ReservedPID.FILE_CHALLENGE`
  (-3) and the existing `activeFileChallenge` client store; no new client panel needed.
- **`codex`** — list earned topics by category, with counts of what remains at level 0/1.
  This is the progression display. Earning is invisible without it.
- **`codex <slug>`** — show `codexEntry` for a fully-known topic.

`codex` is what makes the whole system *feel* like progression rather than an obstacle. It's cheap
and it should ship in the same change.

---

## 6. Anti-frustration rules

Per `PLAN.md` decision 5 (shallow entry, deep ceiling), these are hard constraints:

1. **Never gate the critical path.** Redaction hides *depth*, never *progress*. Every mission must
   be completable with zero knowledge topics earned. Lore is the reward layer, not the road.
2. **Progress is never zero.** A failed attempt that identified the right category still grants
   level 1.
3. **No dead ends.** Every topic must be reachable by at least two sources — typically a minigame
   *and* a downloadable file — so a player who can't beat `entropy_overload` is never permanently
   locked out.
4. **Failure costs time and stealth, never knowledge.** Never revoke a `PlayerKnowledge` row.
5. **The footer always tells you something is there.** Hidden content the player can't detect isn't
   a mystery, it's an absence.

---

## 7. Knowledge as a social object

The schema makes something new possible, and it fits the shared-world-with-PvP model
(`PLAN.md` decision 4):

- **`share <topic> <player>`** — grant another player level 1 or 2. Knowledge becomes tradeable,
  which gives factions a genuine economy beyond credits.
- Faction-wide knowledge pools: a topic known by *N* faction members becomes faction-known.
- `report file` (which already publishes a content excerpt to the faction) becomes coherent —
  it's a knowledge-sharing act, and it should grant topics rather than raw text.

This is optional for v1 but the schema shouldn't preclude it — hence `source: "trade"` and the
`sourceRef` column existing from the start.

---

## 8. Rollout

| Step | Work |
|---|---|
| 1 | **Fix K7 now** — the counting bug is live in your working tree. One line. |
| 2 | `KnowledgeTopic` + `PlayerKnowledge` schema; seed topics from today's `REDACTION_RULES` |
| 3 | `redactContent` v2 (levels, per-file seed, length buckets, pre-render) — behaviour-compatible at level 0 |
| 4 | Wire `download` and `decrypt` to grant knowledge; delete the `isHomeServer` special case |
| 5 | `codex` command |
| 6 | `analyze <file>` routing to existing generators |
| 7 | Extend coverage to `messageService` / `forumService` |
| 8 | Optional: sharing and faction pools (§7) |

Steps 1–4 are behaviour-preserving from the player's perspective *except* that reveals now persist
— strictly better. Steps 5–6 are where it becomes a system.

**Schema work belongs in Phase 3** (one migration regeneration carries it, per `PLAN.md`).
**Gameplay work belongs in Phase 8.**

---

## 9. Open decisions

1. **Does knowledge gate anything mechanical, or only display?** Recommend display-only in v1
   (rule 1 in §6). Later, knowing `entity.aida` could unlock dialogue options with personas — but
   that's a second system.
2. **Do topics expire?** The AI content pipeline has knowledge decay for NPCs
   (`step_5_knowledge_lifecycle`). Recommend **no** for players — decay punishes exploration.
3. **Should `analyze` cost resources?** It spawns a process, so CPU/RAM/bandwidth apply
   automatically. Recommend yes, no extra cost beyond that.
4. **Auto-tier from skill: 25 per tier?** `floor(cryptography / 25)` gives category-knowledge of
   tier 1 at skill 25, tier 4 at 100. Needs a balance pass alongside the Phase 8 economy work,
   especially since item effects are currently dead code and nothing is validated.
5. **Do redacted terms in AI *forum* posts seed at level 1 automatically?** Rumour should be
   cheaper than documents. Recommend yes — it gives forums a distinct informational role.
