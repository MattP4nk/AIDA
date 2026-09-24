# AIDA 4-Tier Content Generation System

## Problem

Servers are empty when players connect. The AI content generation (5-30s) runs on first connect but:
- AI calls fail silently → no content
- Static fallback only runs when AI fails, not proactively
- Permissions bug prevented reading files (now fixed)
- No pre-generation — content only created on demand

Result: players `ls` into empty directories. The game world feels dead.

## Solution: 4-Tier Layered Content

Each tier adds content at a different time. Combined, servers feel alive, unique, and responsive to gameplay.

```
Tier 1 (Instant)     ████████████████████  Parametric static templates — ALWAYS applied on first access
Tier 2 (Background)  ░░░░████████████████  AI enrichment — unique files appear 5-30s later
Tier 3 (Pre-warm)    ████████████████████  Triggered on scan/discovery — ready before player connects
Tier 4 (Live)        ░░░░░░░░░░░░████████  Event-driven — files injected as game events happen
```

---

## Tier 1: Instant Static Templates

### Status: TODO

### When
Immediately inside `provisionServerContent()`, before any AI call returns.

### What
8-15 files using parametric templates. Uses existing data:
- Employee names from `EMPLOYEE_ROSTERS` (15 per faction)
- Linked server IPs and names from `NetworkContext`
- Faction-specific jargon from `FACTION_VOICE`
- Server role determines file types (gateway→firewall rules, database→SQL exports, etc.)

### Why
Server is NEVER empty. Player can `ls` and `cat` from the moment they connect.

### Current State
`generateRoleContent()` already exists at line 600 of `serverContentService.ts` with 7 role templates (gateway, router, database, email, workstation, firewall, dns, general). Each generates 3-8 files with realistic content using real employee names and linked server IPs. BUT it's only used as a fallback when AI fails — not as the primary content source.

### Implementation

**File**: `server/src/services/serverContentService.ts`

1. In `provisionServerContent()`, restructure the flow:

```
CURRENT:
  ensureBaseFilesystem → try AI lore → try AI ambient → IF BOTH FAIL → static fallback → apply

NEW:
  ensureBaseFilesystem → ALWAYS apply static (Tier 1) → return →
    fire-and-forget: AI enrichment (Tier 2)
```

2. Specific changes to `provisionServerContent()`:
   - After `ensureBaseFilesystem()` and `buildNetworkContext()`, immediately call `generateRoleContent(networkCtx)` or `getStaticContentPlan(server.type)` for the base plan
   - Add faction secrets and encoded files to the base plan (lines 1580-1597)
   - Apply the base plan via `applyContentPlan()` — this is SYNCHRONOUS (awaited)
   - After base plan is applied, fire AI enrichment as background task (Tier 2)

3. Change idempotency check (line 1515):
   - Current: skips if `fileCount > 8`
   - New: track provisioning state per-server using a marker. Option A: use a GameConfig key per server. Option B: use an in-memory Set + check file count > 15 (Tier 1 creates ~15 files, so > 15 means Tier 1 done).

### Acceptance Criteria
- [ ] Connect to any server → `ls` immediately shows 8+ files
- [ ] Files include employee names, server IPs, faction-appropriate content
- [ ] Different roles (gateway vs database vs email) show different file structures
- [ ] Content is deterministic — same server always gets same Tier 1 content
- [ ] Time to first `ls` result: < 100ms (no AI dependency)

---

## Tier 2: AI Enrichment

### Status: TODO

### When
After Tier 1 is applied, AI runs in background. Files appear when generation completes (5-30s).

### What
3-5 unique AI-generated files:
- **Lore files** (faction servers only): Intelligence reports, intercepted transmissions, encrypted memos, AIDA hints
- **Ambient files** (all servers): Personal notes, gossip, news articles, IRC logs, sysadmin complaints

### Why
Makes each server unique. Two databases in the same faction get different stories, different personalities, different hidden secrets.

### Current State
AI generation exists via `generatePlanFromAI()` with two prompts (LORE_SYSTEM_PROMPT + AMBIENT_SYSTEM_PROMPT). The prompts are well-designed with faction voice, employee names, and role-specific instructions. But AI calls block the connect flow and fail silently.

### Implementation

**File**: `server/src/services/serverContentService.ts`

1. Add new method `provisionAIContent(serverId: string)`:
   - Runs the existing lore + ambient AI processes (lines 1536-1562)
   - Applies results as ADDITIONAL files (doesn't replace Tier 1)
   - Emits Socket.IO notification when done: `[ServerName] New files detected.`
   - Tracks AI-enriched servers in `Set<string>` to avoid duplicate enrichment

2. In restructured `provisionServerContent()`:
   - After Tier 1 plan is applied, call `this.provisionAIContent(serverId).catch(...)` (fire-and-forget)
   - Don't await — return immediately after Tier 1

3. AI completion notification:
   ```typescript
   if (this.io) {
     this.io.to(`user:${userId}`).emit("command:result", {
       success: true,
       output: `[${serverName}] New files detected.`,
       timestamp: new Date(),
     });
   }
   ```
   Problem: `provisionServerContent()` doesn't receive `userId`. Options:
   - Option A: Pass `userId` as parameter (cleanest)
   - Option B: Broadcast to server room `server:${serverId}`
   - Option C: Don't notify (files just appear on next `ls`)

### Acceptance Criteria
- [ ] After connecting and seeing Tier 1 files, 3-5 more files appear within 30s
- [ ] AI-generated files are unique per server (not the same templates)
- [ ] Faction servers get lore-appropriate content (garrison = military, dothackers = anarchist, etc.)
- [ ] AI failure doesn't block or break anything — Tier 1 content remains
- [ ] Notification appears when AI content lands (or files silently appear)

---

## Tier 3: Pre-warm on Discovery

### Status: TODO

### When
Player runs `scan`, `traceroute`, `probe`, or `netmap` — any command that reveals server existence.

### What
Triggers Tier 1 + Tier 2 for discovered servers BEFORE the player connects.

### Why
By the time they `connect`, ALL content (static + AI) is already there. Zero wait time.

### Current State
`scan` calls `topoService.discoverNeighbors()` which returns discovered servers. No content provisioning happens until `connect`. There's a 5-30 second gap between discovery and connection where content could be pre-generated.

### Implementation

**File**: `server/src/services/commandModules/networkCommands.ts`

1. In scan adjacency callback (line ~207 after `discoverNeighbors()`):
   ```typescript
   // Pre-warm discovered servers (fire-and-forget)
   for (const server of results) {
     if (server.serverId) {
       contentService.provisionServerContent(server.serverId).catch(() => {});
     }
   }
   ```

2. In scan subnet sweep callback (after `scanByPartialIp()`):
   Same pattern — provision each discovered server.

3. In traceroute callback (after path is computed):
   Provision each hop server along the path.

**File**: `server/src/services/serverContentService.ts`

4. Add startup batch provisioning method:
   ```typescript
   async provisionAllUnpopulatedServers(): Promise<void> {
     const unpopulated = await this.prisma.gameServer.findMany({
       where: { isPlayerHome: false, type: { not: "player_home" } },
     });
     for (const server of unpopulated) {
       const fileCount = await this.prisma.fileSystemNode.count({ where: { serverId: server.id } });
       if (fileCount <= 8) {
         await this.provisionServerContent(server.id);
       }
     }
   }
   ```

**File**: `server/src/index.ts`

5. Call on startup (after DI init):
   ```typescript
   contentService.provisionAllUnpopulatedServers().catch(err =>
     logger.warn({ err }, "Batch provisioning failed (non-critical)")
   );
   ```

### Acceptance Criteria
- [ ] Run `scan` → discovered servers get provisioned in background
- [ ] `connect` to a previously-scanned server → content already there (no empty dirs)
- [ ] Server startup logs show batch provisioning of seeded servers
- [ ] Provisioning is idempotent — calling multiple times doesn't duplicate content
- [ ] Batch provisioning doesn't crash the server or overwhelm the AI

---

## Tier 4: Event-Driven Content

### Status: PARTIALLY EXISTS

### When
Game events happen in real-time — hacks, wars, missions, bounties.

### What
New files injected into relevant servers in response to events. The game world evolves.

### Why
Servers aren't static snapshots. Revisiting a server after a faction war shows new bulletins, casualty reports, policy changes.

### Current State
`DynamicContentService` exists with 9+ hooks registered:
- `hack:detected` → Injects security log on target server
- `hack:attempt` → Injects intrusion alert
- `bounty:posted` → Injects wanted notice
- `ids_alert` → Injects IDS alert log
- `honeypot:triggered` → Injects honeypot alert
- `war:declared` → Injects war bulletin on faction servers
- `war:ended` → Injects ceasefire notice
- `mission:completed` → Injects mission outcome log
- `contest:resolved` → Injects territory change notice

These are wired in `index.ts` via `dynamicContent.processEvent()`. The PrismaClient bug was already fixed.

### Implementation

1. **Verify existing hooks work** — test each by triggering the event and checking if files appear
2. **Add missing hooks**:
   - When player reads a key fragment → inject AIDA signal trace on nearby servers
   - When player joins faction → inject welcome/briefing file on faction gateway
3. **Ensure content has readable permissions** — files created by hooks should use `others: READ`

### Acceptance Criteria
- [ ] Hack a server → IDS alert log file appears on that server
- [ ] Faction war declared → war bulletin appears on both faction gateways
- [ ] Mission completed → outcome log appears on mission target server
- [ ] Revisiting a server after events shows new content

---

## Implementation Order

```
Step 1: Restructure provisionServerContent() for Tier 1 always-on
  ↓
Step 2: Add provisionAIContent() for Tier 2 background enrichment
  ↓
Step 3: Pre-warm on scan/traceroute (Tier 3)
  ↓
Step 4: Startup batch provisioning (Tier 3 init)
  ↓
Step 5: Verify event-driven hooks (Tier 4)
```

## Files Changed

| File | Step | Change |
|------|------|--------|
| `server/src/services/serverContentService.ts` | 1, 2, 4 | Restructure provision flow, add `provisionAIContent()`, add `provisionAllUnpopulatedServers()` |
| `server/src/services/commandModules/networkCommands.ts` | 3 | Pre-warm discovered servers in scan/traceroute callbacks |
| `server/src/index.ts` | 4 | Add startup batch provisioning call |
| `server/src/services/dynamicContentService.ts` | 5 | Verify hooks, add missing hooks |

## Risk Notes

- **AI rate limiting**: Pre-warming many servers at once could overwhelm the AI service. Add a queue with concurrency limit (max 2 concurrent AI requests).
- **Startup time**: Batch provisioning 28+ servers at startup could take minutes. Run non-blocking and log progress.
- **Idempotency**: Multiple code paths trigger provisioning. The `fileCount > N` check prevents duplication but needs careful threshold management (Tier 1 creates ~15 files, Tier 2 adds ~5, so skip threshold should be ~20).
- **Permissions**: All new files must use `others: READ` (already fixed in `getDefaultPermissions()`).
