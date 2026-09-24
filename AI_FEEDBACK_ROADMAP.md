# AIDA AI Feedback Loops — Implementation Roadmap

## Problem

The AI ecosystem is one-directional:

```
Game Events → AI Decides → Actions Execute → Game Changes → (nothing returns to AI)
```

AI generates missions, plants clues, sends messages, creates content — but never learns if any of it was effective. The system should be circular:

```
Game Events → AI Decides → Actions Execute → Game Changes → Feedback Collected → AI Learns → Better Decisions
```

This roadmap implements 6 feedback loops and fixes 3 validation gaps identified in `AI_SYSTEMS_AUDIT.md`.

## Step Summary

| Step | Name | Status | Impact | Risk |
|------|------|--------|--------|------|
| 1 | AIService Error State | DONE | Foundation — all callers depend on it | Low |
| 1b | Smart Fallbacks | DONE | AI-down = template content, not silence | Low |
| 1c | Retry Queue | DONE | Failed AI requests auto-retry when AI recovers | Low |
| 2 | AI Output Validation | DONE | Prevents subtle bugs from bad AI output | Low |
| 3 | Mission Outcome Feedback | DONE | AI learns from player behavior | Medium |
| 4 | Architect Intervention Tracking | DONE | Architect learns what works | Medium |
| 5 | Knowledge Lifecycle | DONE | Prevents stale intel from corrupting decisions | Medium |
| 6 | Reactive Architect | DONE | Immediate narrative response to crises | Medium |

---

## Step 1: AIService Error State

### Problem
When Ollama is down or times out, AIService returns:
```typescript
return { response: "... [Connection Lost] ..." }
```
Callers try to parse this as JSON → `JSON.parse()` fails → silent fallback → subtle bugs.

### What To Build

Change `generateResponse()` return type:
```typescript
// BEFORE
{ response: string; context?: number[] }

// AFTER
{ success: boolean; response: string; context?: number[]; error?: string }
```

All callers (~10 files) add check:
```typescript
const result = await aiService.generateResponse(prompt, systemPrompt);
if (!result.success) {
  // Use fallback — don't try to parse response as JSON
  return templateFallback;
}
// Safe to parse result.response
```

### Files
- `server/src/services/aiService.ts` — Add `success` flag, set `false` on error/timeout
- `server/src/services/personaMissionGenService.ts` — Check success before parsing
- `server/src/services/personaActionService.ts` — Check success before parsing
- `server/src/services/storyProgressionService.ts` — Check success before parsing
- `server/src/services/storyMissionService.ts` — Check success before parsing
- `server/src/services/serverContentService.ts` — Check success before parsing
- `server/src/services/tutorialService.ts` — Check success before parsing
- `server/src/services/messageService.ts` — Check success before parsing
- `server/src/services/darknetDungeonService.ts` — Check success before parsing
- `server/src/services/personaService.ts` — Check success before using response text

### Acceptance Criteria
- [x] Stop Ollama → AIService returns `{ success: false, error: "TIMEOUT" }`
- [x] No caller tries to JSON.parse a failed response
- [x] All callers use template/static fallback when `success: false`
- [x] Server doesn't crash when AI is unavailable

### Status: DONE
All 12 service files + AIService updated. 30+ call sites check `result.success` before parsing.

---

## Step 1b: Smart Fallbacks (DONE)

### Problem
Original fallbacks were "return null" or "skip" — the game went silent when AI was down.

### What Was Built

Created `server/src/utils/aiFallbacks.ts` with faction-voiced template generators:

| Fallback | Content |
|----------|---------|
| `fallbackWelcomeMessage(faction, user)` | Faction-voiced welcome (garrison=military, dothackers=leet, cybercorp=corporate, darknet=cryptic) |
| `fallbackDepartureMessage(faction, user)` | In-character departure reaction |
| `fallbackPromotionMessage(faction, rank)` | Rank acknowledgment |
| `fallbackActionDecision(personaType)` | Weighted random action (leaders→issue_mission 50%, GM→plant_clue 40%) |
| `fallbackPersonaReply(name, faction)` | In-character message reply |
| `fallbackForumPost(faction, author)` | Template forum post from FACTION_MUNDANE_THEMES |

### Services Updated
- PersonaService: welcome, departure, promotion messages use faction templates
- PersonaActionService: decisions use weighted random action selection
- MessageService: persona replies use faction-voiced templates
- All fallbacks maintain the game's tone and faction identity

### Status: DONE

---

## Step 1c: AI Retry Queue (DONE)

### Problem
When AI fails, the fallback is used but the AI-quality content is lost forever. No mechanism to "catch up" when AI recovers.

### What Was Built

Added to `server/src/services/aiService.ts`:
- `queueForRetry(prompt, systemPrompt, onSuccessCallback)` — queues failed request
- `processRetryQueue()` — runs every 30s, retries oldest request
- `getRetryQueueStats()` — returns queue size + success count
- `stopRetryQueue()` — cleanup for graceful shutdown

Queue settings:
- Max queue size: 20 (oldest dropped if full)
- Process interval: 30 seconds
- Max retry attempts: 3 per request
- Max age: 10 minutes (stale requests purged)
- Concurrency: 1 at a time (no AI overload)

### Services Queuing Retries (18 call sites across 9 files)

| Service | On Retry Success |
|---------|-----------------|
| PersonaService (7) | Send follow-up messages, create forum posts, update clue files |
| PersonaActionService (3) | Create real AI action (replacing fallback), update mission title |
| MessageService (1) | Send real AI persona reply |
| TutorialService (1) | Send AI hint as follow-up |
| StoryMissionService (1) | Update step narrative |
| DarknetDungeonService (2) | Update riddle post, add AI lore files |
| ForumService (1) | Create NPC forum posts |
| MissionGenerator (1) | Create full AI mission |
| DarknetDiscoveryService (1) | Send AI AIDA recruitment DM |

**Intentionally skipped**: StoryProgressionService — events stay unprocessed and naturally retry on next evaluation cycle.

### Flow
```
AI call → FAILS → Smart fallback used immediately (player gets content NOW)
                → Request queued for retry
                        ↓ (every 30s)
                   processRetryQueue()
                        ↓
                   Retry → SUCCESS? → onSuccess callback (send message, add files, etc.)
                        → FAIL? → Leave in queue (max 3 attempts, max 10 min age)
```

### Status: DONE

---

## Step 2: AI Output Validation

### Problem
AI returns JSON, extracted via regex `/\{[\s\S]*\}/`, parsed with `JSON.parse()`. But no validation that parsed output has correct fields, non-empty values, or valid types. An empty title `""` passes all checks.

### What To Build

Create `server/src/utils/aiOutputValidator.ts` with schemas:

```typescript
// Validates mission AI output
validateMissionOutput(parsed): { valid: boolean; title: string; description: string } | null
  - title: string, 1-80 chars, non-empty
  - description: string, 10-500 chars, non-empty
  - Returns null if invalid (caller uses template fallback)

// Validates AI decision output
validateDecisionOutput(parsed): { valid: boolean; actionType: string; ... } | null
  - actionType: one of ["issue_mission", "create_story_arc", "send_message", "forum_post", "trigger_event"]
  - Required fields per action type

// Validates content plan
validateContentPlan(parsed): ServerContentPlan | null
  - directories: array of objects with non-empty path starting with "/"
  - files: array with non-empty path and content

// Validates architect evaluation
validateArchitectEvaluation(parsed): { interventions: any[]; narrativeSummary: string } | null
  - interventions: array with valid types
  - narrativeSummary: non-empty string
```

### Files
- `server/src/utils/aiOutputValidator.ts` — CREATE (~150 lines)
- `server/src/services/personaMissionGenService.ts` — Replace inline validation with `validateMissionOutput()`
- `server/src/services/personaActionService.ts` — Replace inline validation with `validateDecisionOutput()`
- `server/src/services/storyProgressionService.ts` — Replace inline validation with `validateArchitectEvaluation()`
- `server/src/services/serverContentService.ts` — Replace inline validation with `validateContentPlan()`

### Acceptance Criteria
- [x] AI returns `{ title: "" }` → validator rejects, template fallback used
- [x] AI returns `{ actionType: "invalid_type" }` → validator rejects
- [x] AI returns valid JSON → validator passes, content used
- [x] Validation failure logged with the invalid data for debugging

### Status: DONE

Created `server/src/utils/aiOutputValidator.ts` with 8 validators:
- `extractJSON(response, "object"|"array")` — replaces all `response.match(...)` + `JSON.parse()` patterns
- `validateMessageOutput` — subject/content (min 5 chars content)
- `validateMissionOutput` — title (3-80 chars) / description (10-500 chars)
- `validateDecisionOutput` — action in whitelist, reason required
- `validateContentPlan` — directories/files with valid paths and non-empty content
- `validateArchitectEvaluation` — narrativeSummary + interventions with valid types
- `validateStoryArcPlan` — premise (10+ chars) + steps (min 2, each with title/description)
- `validateForumPosts` / `validateForumReply` — array/object validation

Wired into 9 services (all AI JSON parsers replaced):
personaService, personaMissionGenService, personaActionService, storyProgressionService,
serverContentService, storyMissionService, forumService, darknetDiscoveryService, darknetDungeonService

---

## Step 3: Mission Outcome Feedback

### Problem
AI generates missions but never learns:
- Was it too easy or too hard?
- Did the player use the suggested targets?
- How long did it take?
- Did the player abandon it?

### What To Build

#### Feedback Calculation (in `missionService.completeMission()`)

After a mission is completed, calculate:
```typescript
interface MissionFeedback {
  missionId: string;
  templateId: string;        // Which template was used
  userId: string;
  playerLevel: number;
  missionDifficulty: number;
  timeToComplete: number;     // seconds from accept to complete
  difficultyGrade: "too_easy" | "appropriate" | "too_hard";
  objectivesUsed: string[];   // Which objective types were completed
  abandoned: boolean;
  factionId?: string;
}
```

Grading logic:
- `too_easy`: completed in < 30% of expected time, OR player level > difficulty × 2
- `too_hard`: took > 300% of expected time, OR mission expired/abandoned
- `appropriate`: everything else

#### Knowledge Recording

Emit `mission:feedback` event → PersonaService listens → adds knowledge to faction leader:
```
"Mission feedback: Level {level} player graded difficulty-{diff} {type} mission as {grade}.
 Time: {time}s. Objectives used: {types}. Template: {templateId}."
```

#### Prompt Enhancement

In `PersonaMissionGenService.generateDynamicMission()`, include recent feedback:
```
RECENT MISSION FEEDBACK (last 5):
- Level 12 player: difficulty-3 hack mission was "too_easy" (completed in 45s)
- Level 8 player: difficulty-5 steal mission was "appropriate" (completed in 180s)
- Level 20 player: difficulty-4 explore mission was "too_easy" (abandoned after 10s — boring)

Adjust difficulty and type based on these results.
```

### Files
- `server/src/services/missionService.ts` — Add `calculateFeedback()` in `completeMission()`, emit `mission:feedback`
- `server/src/services/personaService.ts` — Listen for `mission:feedback`, call `addKnowledge()`
- `server/src/services/factionKnowledgeService.ts` — Add method to update confidence on targets used by missions
- `server/src/services/personaMissionGenService.ts` — Query recent feedback knowledge, include in AI prompt
- `server/src/index.ts` — Wire `missionService.on("mission:feedback")` → personaService + dynamicContent

### Acceptance Criteria
- [ ] Complete easy mission at high level → feedback says "too_easy"
- [ ] Abandon mission → feedback says "abandoned"
- [ ] Next mission generation prompt includes last 5 feedback entries
- [ ] Faction leader knowledge has `mission_feedback` type entries
- [ ] Difficulty adjustment visible in generated missions over time

---

## Step 4: Architect Intervention Tracking

### Problem
The Architect plants clues, creates missions, sends messages, triggers events — but never learns if anyone engaged with them.

### What To Build

#### Record Interventions

In `ArchitectInterventionExecutor.executeBatch()`, after each intervention:
```typescript
await prisma.storyLedger.create({
  data: {
    type: "architect_intervention",
    category: "system",
    actorId: "architect",
    actorType: "system",
    summary: `Architect ${type}: ${brief description}`,
    data: {
      interventionType: type,
      targetId: target,         // serverId, userId, etc.
      trackingId: `intv_${Date.now()}`,
    },
    weight: 3,
    isProcessed: true, // Don't re-evaluate this event
  },
});
```

#### Check Outcomes

New method `checkInterventionOutcomes()` called in `buildArchitectPrompt()`:
```typescript
For each recent intervention (last 7 days):
  - plant_clue → Query: was the file read? (fileSystemNode.lastAccessedAt != null)
  - create_mission → Query: was it accepted? completed? abandoned?
  - send_message → Query: did recipient reply? (PersonaMessage with recipientId)
  - trigger_event → Query: did event reach any players? (affectedUsers.length > 0)
  - grant_token → Query: was token used? (InventoryItem.usesRemaining decreased)
```

#### Include in Prompt

```
YOUR RECENT INTERVENTIONS & OUTCOMES:
- 2 days ago: Planted clue on garrison-gw → FOUND by 1 player ✓
- 1 day ago: Created mission "Shadow Protocol" → ACCEPTED, still in progress
- 1 day ago: Sent message to player_x → NO REPLY ✗
- 3 days ago: Triggered "faction_tension" event → Reached 3 players ✓

Effectiveness: 60% engagement rate. Consider: messages are less effective than clues.
```

### Files
- `server/src/services/architectInterventionExecutor.ts` — Record metadata to StoryLedger after each intervention
- `server/src/services/storyProgressionService.ts` — Add `getInterventionOutcomes()`, include in `buildArchitectPrompt()`

### Acceptance Criteria
- [ ] Architect plants clue → StoryLedger gets `architect_intervention` entry
- [ ] Next Architect evaluation → prompt includes intervention outcome summary
- [ ] Architect can see: "clues work 60%, messages work 20%" in its context
- [ ] Architect adjusts strategy (more clues, fewer messages) over time

---

## Step 5: Knowledge Lifecycle

### Problem
Faction knowledge persists forever at original confidence. Intel from 100 missions ago still influences decisions. No verification that assets still exist.

### What To Build

#### Confidence Decay Enhancement

Current: `decayConfidence(0.05)` runs every 30 min via AISchedulerService
New: Time-based decay with source weighting:

```typescript
// Per-source decay rates (per day)
const DECAY_RATES = {
  server_hack: 0.03,      // Direct observation — decays slowly
  server_discovery: 0.05,  // Discovery — moderate decay
  mission_completion: 0.07, // Mission intel — decays faster
  forum_intel: 0.10,       // Forum gossip — unreliable, decays fast
  player_report: 0.08,     // Player-sourced — moderate decay
};
```

#### Stale Tagging

In `serializeForPrompt()`:
```typescript
for (const entry of entries) {
  const age = (Date.now() - entry.discoveredAt.getTime()) / (1000 * 60 * 60 * 24);
  const label = entry.confidence < 0.3 ? " [STALE]"
              : entry.confidence < 0.5 ? " [aging]"
              : "";
  // Include in prompt: "server:garrison-gw ip:192.168.1.1 confidence:0.4 [aging]"
}
```

#### Auto-Purge

```typescript
async purgeOldEntries(): Promise<number> {
  // Delete entries older than 14 days with confidence < 0.1
  return prisma.factionKnowledge.deleteMany({
    where: {
      confidence: { lt: 0.1 },
      discoveredAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) },
    },
  });
}
```

#### Verification

```typescript
async verifyKnowledge(factionId: string): Promise<void> {
  const entries = await prisma.factionKnowledge.findMany({ where: { factionId } });
  for (const entry of entries) {
    if (entry.assetType === "server") {
      const exists = await prisma.gameServer.findUnique({ where: { id: entry.assetId } });
      if (!exists) {
        await prisma.factionKnowledge.delete({ where: { id: entry.id } });
      }
    }
    // Similar for files, players
  }
}
```

### Files
- `server/src/services/factionKnowledgeService.ts` — Add `purgeOldEntries()`, `verifyKnowledge()`, update `serializeForPrompt()` with stale tags, source-weighted decay
- `server/src/services/aiSchedulerService.ts` — Call `purgeOldEntries()` in midnight reset, `verifyKnowledge()` daily

### Acceptance Criteria
- [ ] Knowledge entry ages 7 days → prompt shows `[aging]` tag
- [ ] Knowledge entry ages 14 days at confidence < 0.1 → auto-deleted
- [ ] Server deleted from game → knowledge entry about it removed
- [ ] Forum-sourced intel decays faster than hack-sourced intel
- [ ] AI prompt shows fresh vs stale entries clearly

---

## Step 6: Reactive Architect

### Problem
Game Master only evaluates every 2 hours (or 30 min game state check). Critical events like war declarations, fragment discoveries, or endgame completion wait for the next cycle. Narrative feels slow.

### What To Build

#### High-Weight Event Subscription

In `storyProgressionService.recordEvent()`, after saving to ledger:
```typescript
if (event.weight >= 8) {
  this.onHighWeightEvent(event).catch(err =>
    this.logger.warn({ err }, "Reactive Architect failed")
  );
}
```

#### Mini-Evaluation

```typescript
async onHighWeightEvent(event: StoryEvent): Promise<void> {
  // Cooldown: max 1 immediate reaction per 10 minutes
  if (this.lastReactiveAt && Date.now() - this.lastReactiveAt < 10 * 60 * 1000) {
    return;
  }
  this.lastReactiveAt = Date.now();

  // Build a focused prompt — just this event, not full world state
  const prompt = `
URGENT EVENT: ${event.summary}
Type: ${event.type}, Category: ${event.category}, Weight: ${event.weight}

You are The Architect. This event just happened. Respond with ONE immediate action.
Choose from: send_message, trigger_event, or "none" if no response needed.

Respond as JSON: { "action": "send_message" | "trigger_event" | "none", "target": "...", "content": "..." }
`;

  const result = await this.aiService.generateResponse(prompt, architectSystemPrompt);
  if (!result.success) return;

  // Parse and execute single intervention
  // ... validate and execute via ArchitectInterventionExecutor
}
```

#### Events That Trigger Immediate Response (weight >= 8)
- Fragment stolen (weight 8)
- Endgame unlocked (weight 10)
- Endgame completed (weight 10)
- War declared (if wired with weight 8+)

### Files
- `server/src/services/storyProgressionService.ts` — Add `onHighWeightEvent()`, cooldown tracking, mini-evaluation prompt
- `server/src/services/architectInterventionExecutor.ts` — No change needed (already supports single intervention)

### Acceptance Criteria
- [ ] Fragment stolen → Architect sends in-character message within 30 seconds
- [ ] Endgame completed → Architect triggers world event immediately
- [ ] Two high-weight events 5 min apart → only first gets immediate response (cooldown)
- [ ] Low-weight events (< 8) → no immediate response, handled in regular cycle
- [ ] AI failure → silently skipped, doesn't break regular evaluation cycle

---

## Dependency Graph

```
Step 1 (Error State)     ← FOUNDATION: every other step depends on reliable AI calls
  ↓
Step 2 (Validation)      ← Uses Step 1's success flag to know when to validate
  ↓  ↓
Step 3 (Mission FB)    Step 4 (Intervention Tracking)    ← Can run in parallel
  ↓  ↓                   ↓
Step 5 (Knowledge)     ← Uses feedback from Steps 3 + 4
  ↓
Step 6 (Reactive)      ← Benefits from fresh knowledge (Step 5) + tracking (Step 4)
```

## Risk Notes

- **Step 1** is low-risk but touches ~10 files — test each caller individually
- **Step 3** adds DB writes on every mission completion — ensure non-blocking (use `defer`)
- **Step 4** queries game state (file access, mission status) — could be slow; add caching
- **Step 5** purges data — add `--dry-run` flag for initial testing
- **Step 6** calls AI on high-weight events — could spam AI; cooldown is essential
- **All steps**: AI is optional — every feedback mechanism must degrade gracefully when AI is down
