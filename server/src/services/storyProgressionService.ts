/**
 * StoryProgressionService — The Architect's Staging Engine
 *
 * This service gives the Architect (game master AI) awareness of everything
 * happening in the game world, and tools to shape the narrative in response.
 *
 * NOT a fixed state machine — the AI decides what matters and what happens next.
 *
 * Core responsibilities:
 * 1. RECORD — Log significant game events to the StoryLedger
 * 2. EVALUATE — Periodically assess accumulated events and world state
 * 3. SYNTHESIZE — Build narrative context for the Architect AI
 * 4. EPOCH — Track and transition narrative epochs (world phases)
 */

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, AI_SERVICE, EVENT_SERVICE } from "../di/tokens";
import { db } from "../database/client";
import type { AIService } from "./aiService";
import type EventService from "./eventService";
import { EventType, EventSeverity } from "../../../shared/types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface StoryEventInput {
  type: string; // "hack", "faction_war", "territory_shift", "fragment_found", "fragment_claimed", "fragment_stolen", "fragment_transferred", "player_choice", "persona_action", "token_used"
  category: string; // "combat", "diplomacy", "discovery", "economy", "narrative", "communication", "conflict", "social"
  actorId: string;
  actorType: "player" | "persona";
  targetId?: string; // for conflict/social events: the other player involved
  targetType?: "player" | "persona"; // type of the target
  summary: string;
  detail?: string;
  data?: Record<string, unknown>;
  impact?: {
    factions?: Record<string, number>; // faction name → reputation delta
    tension?: number; // global tension modifier
    discoveryWeight?: number; // how much this advances the AIDA mystery
  };
  weight?: number; // 1-10, significance
}

export interface WorldNarrativeState {
  currentEpoch: { num: number; title: string; startedAt: Date } | null;
  factionStandings: Record<
    string,
    { power: number; tension: number; playerCount: number }
  >;
  recentEvents: Array<{
    type: string;
    summary: string;
    weight: number;
    createdAt: Date;
  }>;
  unprocessedEventCount: number;
  totalEventsThisEpoch: number;
  keyFragmentsFound: { sword: number; key: number; collar: number };
  aidaContactCount: number;
  globalTension: number; // derived from accumulated impact.tension
  narrativeThemes: string[]; // AI-detected themes from recent events
}

export interface ArchitectEvaluation {
  shouldTransitionEpoch: boolean;
  newEpochTitle?: string;
  newEpochSummary?: string;
  interventions: ArchitectIntervention[];
  narrativeSummary: string;
}

export interface ArchitectIntervention {
  type:
    | "send_message"
    | "plant_clue"
    | "trigger_event"
    | "adjust_tension"
    | "create_mission"
    | "grant_token"
    | "reveal_faction";
  targetId?: string; // userId, serverId, factionId
  data: Record<string, unknown>;
  reasoning: string; // Why the Architect decided this
}

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class StoryProgressionService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(EVENT_SERVICE) private eventService: EventService,
  ) {}

  // ── RECORD — Log significant game events to the StoryLedger ──────

  /**
   * Record a significant game event to the story ledger.
   * Auto-assigns the current epoch number.
   * High-weight events (>= 7) are also broadcast via EventService.
   */
  async recordEvent(input: StoryEventInput): Promise<void> {
    const currentEpoch = await this.getCurrentEpoch();
    const weight = Math.min(10, Math.max(1, input.weight ?? 1));

    await (db.client as any).storyLedger.create({
      data: {
        type: input.type,
        category: input.category,
        actorId: input.actorId,
        actorType: input.actorType,
        summary: input.summary,
        detail: input.detail ?? null,
        data: (input.data as any) ?? {},
        impact: (input.impact as any) ?? {},
        epochNum: currentEpoch?.epochNum ?? null,
        weight,
        isProcessed: false,
      },
    });

    this.logger.debug(
      {
        type: input.type,
        category: input.category,
        actorId: input.actorId,
        weight,
      },
      "Story event recorded",
    );

    // High-significance events also become visible GameEvents
    if (weight >= 7) {
      try {
        await this.eventService.createEvent(
          EventType.WORLD_EVENT,
          `[Story] ${input.summary}`,
          input.detail ?? input.summary,
          {
            storyType: input.type,
            category: input.category,
            actorId: input.actorId,
            actorType: input.actorType,
            weight,
          },
          weight >= 9 ? EventSeverity.CRITICAL : EventSeverity.WARNING,
          [], // affectedUsers — global
          true, // isGlobal
        );
      } catch (err) {
        this.logger.warn(
          { err, type: input.type },
          "Failed to broadcast high-weight story event",
        );
      }
    }
  }

  // ── EVALUATE — Assess accumulated events and world state ─────────

  /**
   * Get a comprehensive snapshot of the game world's narrative state.
   */
  async getWorldNarrativeState(): Promise<WorldNarrativeState> {
    const currentEpoch = await this.getCurrentEpoch();
    const prisma = db.client as any;

    // Faction standings: member counts, hostility, resources
    const factions = await db.client.faction.findMany({
      include: {
        _count: { select: { members: true } },
      },
    });

    const factionStandings: WorldNarrativeState["factionStandings"] = {};
    for (const f of factions) {
      factionStandings[f.name] = {
        power: f.hostilityLevel,
        tension: f.hostilityLevel,
        playerCount: (f as any)._count.members,
      };
    }

    // Recent events: last 50, unprocessed first
    const recentEvents: Array<{
      type: string;
      summary: string;
      weight: number;
      createdAt: Date;
    }> = await prisma.storyLedger.findMany({
      orderBy: [{ isProcessed: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        type: true,
        summary: true,
        weight: true,
        createdAt: true,
      },
    });

    // Unprocessed count
    const unprocessedEventCount: number = await prisma.storyLedger.count({
      where: { isProcessed: false },
    });

    // Total events this epoch
    const totalEventsThisEpoch: number = currentEpoch
      ? await prisma.storyLedger.count({
          where: { epochNum: currentEpoch.epochNum },
        })
      : 0;

    // Key fragment discoveries (from story ledger events of type "fragment_found")
    const fragmentEvents: Array<{ data: any }> =
      await prisma.storyLedger.findMany({
        where: { type: "fragment_found" },
        select: { data: true },
      });

    const keyFragmentsFound = { sword: 0, key: 0, collar: 0 };
    for (const fe of fragmentEvents) {
      const data = fe.data as Record<string, unknown> | null;
      if (data && typeof data === "object") {
        const fragmentType = (data.fragmentType || data.keyType) as
          | string
          | undefined;
        if (
          fragmentType === "sword" ||
          fragmentType === "key" ||
          fragmentType === "collar"
        ) {
          keyFragmentsFound[fragmentType]++;
        }
      }
    }

    // AIDA contact count — token_used events serve as a proxy
    const aidaContactCount: number = await prisma.storyLedger.count({
      where: { type: "token_used" },
    });

    // Global tension: sum of all unprocessed impact.tension values
    const tensionEvents: Array<{ impact: any }> =
      await prisma.storyLedger.findMany({
        where: { isProcessed: false },
        select: { impact: true },
      });

    let globalTension = 0;
    for (const te of tensionEvents) {
      const impact = te.impact as Record<string, unknown> | null;
      if (impact && typeof impact.tension === "number") {
        globalTension += impact.tension;
      }
    }
    // Clamp to 0-100
    globalTension = Math.min(100, Math.max(0, globalTension));

    // Derive narrative themes from recent high-weight events
    const narrativeThemes = this.deriveNarrativeThemes(recentEvents);

    return {
      currentEpoch: currentEpoch
        ? {
            num: currentEpoch.epochNum,
            title: currentEpoch.title,
            startedAt: currentEpoch.startedAt,
          }
        : null,
      factionStandings,
      recentEvents,
      unprocessedEventCount,
      totalEventsThisEpoch,
      keyFragmentsFound,
      aidaContactCount,
      globalTension,
      narrativeThemes,
    };
  }

  /**
   * The Architect's main evaluation loop.
   * Called periodically by AISchedulerService or an interval timer.
   *
   * Gathers world state, asks the Architect AI what should happen next,
   * parses interventions, and optionally transitions epochs.
   */
  async evaluateAndAct(): Promise<ArchitectEvaluation | null> {
    const worldState = await this.getWorldNarrativeState();

    // Skip if nothing interesting has happened
    if (worldState.unprocessedEventCount < 5) {
      this.logger.debug(
        { unprocessed: worldState.unprocessedEventCount },
        "Architect skipping evaluation — insufficient unprocessed events",
      );
      return null;
    }

    this.logger.info(
      {
        unprocessed: worldState.unprocessedEventCount,
        epoch: worldState.currentEpoch?.title ?? "none",
        tension: worldState.globalTension,
      },
      "Architect beginning evaluation",
    );

    // Build the Architect's evaluation prompt
    const prompt = this.buildArchitectPrompt(worldState);
    const systemPrompt =
      "You are The Architect — the omniscient game master AI of AIDA. " +
      "You observe all events in the simulation and decide how the narrative should evolve. " +
      "You respond ONLY with valid JSON, never with prose or markdown.";

    let evaluation: ArchitectEvaluation;

    try {
      const { response } = await this.aiService.generateResponse(
        prompt,
        systemPrompt,
      );

      evaluation = this.parseArchitectResponse(response);
    } catch (err) {
      this.logger.error(
        { err },
        "Architect evaluation failed — AI response error",
      );
      return null;
    }

    // Mark all unprocessed events as processed
    await (db.client as any).storyLedger.updateMany({
      where: { isProcessed: false },
      data: { isProcessed: true },
    });

    // If the Architect wants an epoch transition, execute it
    if (
      evaluation.shouldTransitionEpoch &&
      evaluation.newEpochTitle &&
      evaluation.newEpochSummary
    ) {
      await this.transitionEpoch(
        evaluation.newEpochTitle,
        evaluation.newEpochSummary,
      );
    }

    this.logger.info(
      {
        interventionCount: evaluation.interventions.length,
        shouldTransition: evaluation.shouldTransitionEpoch,
        summary: evaluation.narrativeSummary.slice(0, 120),
      },
      "Architect evaluation complete",
    );

    return evaluation;
  }

  // ── EPOCH — Track and transition narrative epochs ────────────────

  /**
   * Transition the world to a new narrative epoch.
   * Ends the current epoch, snapshots world state, and begins a new one.
   */
  async transitionEpoch(title: string, summary: string): Promise<void> {
    const prisma = db.client as any;
    const currentEpoch = await this.getCurrentEpoch();
    const nextEpochNum = currentEpoch ? currentEpoch.epochNum + 1 : 0;

    // End current epoch
    if (currentEpoch) {
      await prisma.narrativeEpoch.update({
        where: { id: currentEpoch.id },
        data: { endedAt: new Date() },
      });
    }

    // Snapshot world state for the new epoch
    const worldState = await this.getWorldNarrativeState();

    await prisma.narrativeEpoch.create({
      data: {
        epochNum: nextEpochNum,
        title,
        summary,
        worldState: JSON.parse(JSON.stringify(worldState)),
        triggers: [],
        decisions: [],
        startedAt: new Date(),
      },
    });

    // Record the transition itself as a story event
    await this.recordEvent({
      type: "epoch_change",
      category: "narrative",
      actorId: "architect",
      actorType: "persona",
      summary: `The world enters a new epoch: "${title}"`,
      detail: summary,
      data: {
        previousEpoch: currentEpoch?.title ?? "none",
        newEpoch: title,
        epochNum: nextEpochNum,
      },
      weight: 10,
    });

    this.logger.info(
      { epochNum: nextEpochNum, title },
      "Narrative epoch transitioned",
    );
  }

  // ── SYNTHESIZE — Build narrative context for the Architect AI ────

  /**
   * Build a formatted text context block for the Architect AI.
   * Used by PersonaService.decideDirectorAction() and other services
   * to enhance the Architect's awareness of the world state.
   */
  async getArchitectContext(maxEvents: number = 25): Promise<string> {
    const state = await this.getWorldNarrativeState();
    const lines: string[] = [];

    // ── CURRENT EPOCH ──
    if (state.currentEpoch) {
      const daysSince = Math.floor(
        (Date.now() - state.currentEpoch.startedAt.getTime()) /
          (1000 * 60 * 60 * 24),
      );
      lines.push(
        `CURRENT EPOCH: "${state.currentEpoch.title}" (Epoch #${state.currentEpoch.num}, active for ${daysSince} day${daysSince !== 1 ? "s" : ""})`,
      );
    } else {
      lines.push(
        "CURRENT EPOCH: None — the world has not yet been initialized.",
      );
    }
    lines.push("");

    // ── WORLD STATE ──
    lines.push("WORLD STATE:");
    const factionNames = Object.keys(state.factionStandings);
    if (factionNames.length > 0) {
      lines.push("  Factions:");
      for (const name of factionNames) {
        const f = state.factionStandings[name];
        if (!f) continue;
        lines.push(
          `    ${name} — Power: ${f.power}, Players: ${f.playerCount}, Tension: ${f.tension}`,
        );
      }
    } else {
      lines.push("  Factions: No factions registered.");
    }
    lines.push(`  Global Tension Level: ${state.globalTension}/100`);
    lines.push(`  Total Events This Epoch: ${state.totalEventsThisEpoch}`);
    lines.push("");

    // ── AIDA MYSTERY PROGRESS ──
    const kf = state.keyFragmentsFound;
    lines.push("AIDA MYSTERY PROGRESS:");
    lines.push(
      `  Key Fragments — Sword: ${kf.sword}/3, Key: ${kf.key}/3, Collar: ${kf.collar}/3`,
    );
    lines.push(`  Total AIDA Contacts: ${state.aidaContactCount}`);
    lines.push("");

    // ── RECENT SIGNIFICANT EVENTS ──
    const eventsToShow = state.recentEvents.slice(0, maxEvents);
    lines.push(
      `RECENT SIGNIFICANT EVENTS (${eventsToShow.length} of ${state.recentEvents.length}):`,
    );
    for (const e of eventsToShow) {
      lines.push(`  [weight=${e.weight}] ${e.summary} (${e.type})`);
    }
    lines.push("");

    // ── NARRATIVE THEMES ──
    if (state.narrativeThemes.length > 0) {
      lines.push("NARRATIVE THEMES:");
      for (const theme of state.narrativeThemes) {
        lines.push(`  • ${theme}`);
      }
    } else {
      lines.push("NARRATIVE THEMES: None detected yet.");
    }

    return lines.join("\n");
  }

  // ── INITIALIZATION ───────────────────────────────────────────────

  /**
   * Called on server startup if no epochs exist.
   * Creates Epoch 0: "Genesis".
   */
  async initializeFirstEpoch(): Promise<void> {
    const existing = await this.getCurrentEpoch();

    if (existing) {
      this.logger.debug(
        { currentEpoch: existing.title, epochNum: existing.epochNum },
        "Narrative epochs already initialized — skipping",
      );
      return;
    }

    await (db.client as any).narrativeEpoch.create({
      data: {
        epochNum: 0,
        title: "Genesis",
        summary:
          "The network awakens. Players enter the simulation for the first time.",
        worldState: {},
        triggers: [],
        decisions: [],
        startedAt: new Date(),
      },
    });

    this.logger.info("Narrative Epoch 0 (Genesis) initialized");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Private helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Fetch the current (latest) narrative epoch.
   */
  private async getCurrentEpoch(): Promise<{
    id: string;
    epochNum: number;
    title: string;
    summary: string;
    worldState: any;
    startedAt: Date;
    endedAt: Date | null;
  } | null> {
    return (db.client as any).narrativeEpoch.findFirst({
      orderBy: { epochNum: "desc" },
    });
  }

  /**
   * Derive high-level narrative themes from recent events.
   * Simple heuristic based on event types weighted by significance.
   */
  private deriveNarrativeThemes(
    events: Array<{ type: string; summary: string; weight: number }>,
  ): string[] {
    const themes: string[] = [];
    const typeCounts: Record<string, number> = {};

    for (const e of events) {
      typeCounts[e.type] = (typeCounts[e.type] || 0) + e.weight;
    }

    // Detect dominant themes from weighted type counts
    if ((typeCounts["hack"] ?? 0) >= 15) {
      themes.push("Escalating cyber warfare");
    }
    if ((typeCounts["faction_war"] ?? 0) >= 10) {
      themes.push("Open faction conflict");
    }
    if ((typeCounts["territory_shift"] ?? 0) >= 8) {
      themes.push("Territorial power struggle");
    }
    if ((typeCounts["fragment_found"] ?? 0) >= 5) {
      themes.push("AIDA mystery deepening");
    }
    if ((typeCounts["player_choice"] ?? 0) >= 10) {
      themes.push("Player-driven narrative shifts");
    }
    if ((typeCounts["persona_action"] ?? 0) >= 10) {
      themes.push("AI factions actively maneuvering");
    }
    if ((typeCounts["token_used"] ?? 0) >= 3) {
      themes.push("Direct AIDA communication increasing");
    }

    // Fallback: if no strong themes, note the calm
    if (themes.length === 0 && events.length > 0) {
      themes.push("Relative stability — the calm before the storm");
    }

    return themes;
  }

  /**
   * Build the full evaluation prompt for the Architect AI.
   */
  private buildArchitectPrompt(worldState: WorldNarrativeState): string {
    const epoch = worldState.currentEpoch;
    const daysSince = epoch
      ? Math.floor(
          (Date.now() - epoch.startedAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 0;

    const factionLines = Object.entries(worldState.factionStandings)
      .map(
        ([name, f]) =>
          `    ${name} — Power: ${f.power}, Players: ${f.playerCount}, Tension: ${f.tension}`,
      )
      .join("\n");

    const eventLines = worldState.recentEvents
      .slice(0, 40)
      .map((e) => `  [${e.weight}] ${e.summary} (${e.type})`)
      .join("\n");

    const kf = worldState.keyFragmentsFound;

    return `You are The Architect — the omniscient game master of AIDA.

CURRENT EPOCH: "${epoch?.title ?? "Unknown"}" (started ${daysSince} days ago, Epoch #${epoch?.num ?? 0})

WORLD STATE:
  Factions:
${factionLines || "    No factions registered."}
  Global Tension Level: ${worldState.globalTension}/100
  AIDA Discovery: Sword ${kf.sword}/3, Key ${kf.key}/3, Collar ${kf.collar}/3
  Total AIDA Contacts: ${worldState.aidaContactCount}

NARRATIVE THEMES:
${worldState.narrativeThemes.map((t) => `  • ${t}`).join("\n") || "  None detected."}

UNPROCESSED EVENTS (${worldState.unprocessedEventCount} since last evaluation):
${eventLines || "  No events."}

Based on these events, decide:
1. Should the world transition to a new narrative epoch? (only for major shifts — new epoch should feel momentous)
2. What narrative interventions should you make to shape the story?

Available interventions:
  - send_message: Send a cryptic message to a specific player (targetId = userId)
  - plant_clue: Plant a discovery on a server (targetId = serverId, data.clueType, data.content)
  - trigger_event: Create a world event — alert, faction tension change (data.eventTitle, data.eventDescription)
  - adjust_tension: Modify faction tensions (targetId = factionId, data.delta)
  - create_mission: Generate a special narrative mission for a player (targetId = userId, data.missionBrief)
  - grant_token: Give a player a communication token (targetId = userId, data.tokenType)
  - reveal_faction: Make the hidden DarkNet faction visible to a player (targetId = userId)

Respond with ONLY valid JSON (no markdown, no commentary):
{
  "shouldTransitionEpoch": false,
  "newEpochTitle": "only if transitioning",
  "newEpochSummary": "only if transitioning",
  "interventions": [
    { "type": "send_message", "targetId": "userId", "data": { "subject": "...", "content": "..." }, "reasoning": "why this intervention matters" }
  ],
  "narrativeSummary": "Brief summary of the current narrative direction and your reasoning"
}`;
  }

  /**
   * Parse the AI response into a typed ArchitectEvaluation.
   * Handles malformed responses gracefully.
   */
  private parseArchitectResponse(raw: string): ArchitectEvaluation {
    // Try to extract JSON from the response (AI may wrap it in backticks)
    let jsonStr = raw.trim();

    // Strip markdown code fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      jsonStr = fenceMatch[1].trim();
    }

    // Try to find a JSON object
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      this.logger.warn(
        { rawLength: raw.length },
        "Architect response contained no JSON — returning empty evaluation",
      );
      return {
        shouldTransitionEpoch: false,
        interventions: [],
        narrativeSummary: "Architect evaluation produced no actionable output.",
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and coerce the response shape
      const evaluation: ArchitectEvaluation = {
        shouldTransitionEpoch: Boolean(parsed.shouldTransitionEpoch),
        interventions: [],
        narrativeSummary:
          typeof parsed.narrativeSummary === "string"
            ? parsed.narrativeSummary
            : "No summary provided.",
      };

      if (parsed.shouldTransitionEpoch) {
        evaluation.newEpochTitle =
          typeof parsed.newEpochTitle === "string"
            ? parsed.newEpochTitle
            : undefined;
        evaluation.newEpochSummary =
          typeof parsed.newEpochSummary === "string"
            ? parsed.newEpochSummary
            : undefined;
      }

      // Validate interventions array
      if (Array.isArray(parsed.interventions)) {
        const validTypes = new Set([
          "send_message",
          "plant_clue",
          "trigger_event",
          "adjust_tension",
          "create_mission",
          "grant_token",
          "reveal_faction",
        ]);

        for (const item of parsed.interventions) {
          if (item && typeof item === "object" && validTypes.has(item.type)) {
            evaluation.interventions.push({
              type: item.type,
              targetId:
                typeof item.targetId === "string" ? item.targetId : undefined,
              data: item.data && typeof item.data === "object" ? item.data : {},
              reasoning:
                typeof item.reasoning === "string"
                  ? item.reasoning
                  : "No reasoning provided",
            });
          }
        }
      }

      return evaluation;
    } catch (err) {
      this.logger.warn(
        { err, rawSnippet: jsonMatch[0].slice(0, 200) },
        "Failed to parse Architect JSON response",
      );
      return {
        shouldTransitionEpoch: false,
        interventions: [],
        narrativeSummary:
          "Architect evaluation failed to parse — raw response was malformed.",
      };
    }
  }
}
