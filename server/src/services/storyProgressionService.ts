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
import { validateOrRetry, validateArchitectEvaluation } from "../utils/aiOutputValidator";
import { safeAI } from "../utils/safeExecute";

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
  /** Cooldown for reactive Architect — max 1 immediate response per 10 minutes. */
  private lastReactiveAt: number = 0;
  private readonly REACTIVE_COOLDOWN_MS = 10 * 60 * 1000;

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

    // ── Reactive Architect: immediate response to critical events ──
    if (weight >= 8) {
      this.onHighWeightEvent(input, weight).catch((err) => {
        this.logger.debug({ err }, "Reactive Architect failed (non-critical)");
      });
    }
  }

  /**
   * Reactive Architect — immediate mini-evaluation for critical events.
   * Responds to weight >= 8 events (fragment stolen, endgame, war) within seconds
   * instead of waiting for the 2-hour evaluation cycle.
   * Cooldown: max 1 immediate response per 10 minutes.
   */
  private async onHighWeightEvent(event: StoryEventInput, weight: number): Promise<void> {
    const now = Date.now();
    if (now - this.lastReactiveAt < this.REACTIVE_COOLDOWN_MS) {
      this.logger.debug({ weight, type: event.type }, "Reactive Architect on cooldown — skipping");
      return;
    }
    this.lastReactiveAt = now;

    this.logger.info(
      { type: event.type, weight, summary: event.summary?.slice(0, 80) },
      "Reactive Architect triggered by high-weight event",
    );

    const prompt = `URGENT EVENT just occurred in the AIDA simulation:

Type: ${event.type}
Category: ${event.category}
Weight: ${weight}/10
Summary: ${event.summary}
Actor: ${event.actorId} (${event.actorType})
${event.targetId ? `Target: ${event.targetId}` : ""}

You are The Architect. This event JUST happened. Respond with ONE immediate action, or "none" if no response is needed.

Choose from:
- send_message: Send a cryptic in-character message to a player (targetId = userId, data.subject, data.content)
- trigger_event: Create a world event notification (data.eventTitle, data.eventDescription)
- none: No immediate action needed

Consider: Is this event narratively significant enough for an immediate Architect response?
Fragment discoveries, endgame events, and major faction shifts usually warrant a response.
Routine hacks or mission completions usually don't.`;

    type ReactiveAction = { action: string; targetId?: string; data?: any; reasoning?: string };

    const validateReactiveAction = (parsed: any): ReactiveAction | null => {
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.action !== "string") return null;
      return {
        action: parsed.action,
        targetId: parsed.targetId,
        data: parsed.data,
        reasoning: parsed.reasoning,
      };
    };

    const parsed = await safeAI<ReactiveAction>({
      aiService: this.aiService,
      prompt,
      systemPrompt: "You are The Architect — the omniscient game master of AIDA. Respond with a single JSON action. Be cryptic and in-character.",
      expectedFormat: '{ "action": "send_message|trigger_event|none", "targetId": "string", "data": { "subject": "string", "content": "string" }, "reasoning": "string" }',
      validate: validateReactiveAction,
      fallback: { action: "none" },
      context: "Reactive Architect response",
      logger: this.logger,
    });

    if (parsed.action === "none") return;
    if (parsed.action !== "send_message" && parsed.action !== "trigger_event") return;

    try {
      // Execute via the intervention executor
      const { getService } = await import("../di/container");
      const { ARCHITECT_INTERVENTION_EXECUTOR } = await import("../di/tokens");
      const executor = getService<any>(ARCHITECT_INTERVENTION_EXECUTOR);

      await executor.execute({
        type: parsed.action,
        targetId: parsed.targetId || event.actorId,
        data: parsed.data || {},
        reasoning: parsed.reasoning || `Reactive response to ${event.type}`,
      });

      this.logger.info(
        { action: parsed.action, targetId: parsed.targetId, eventType: event.type },
        "Reactive Architect executed immediate intervention",
      );
    } catch (err) {
      this.logger.debug({ err }, "Reactive Architect: failed to execute intervention");
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

    // Recent significant events: weight >= 3, unprocessed first, capped at 30
    // Low-weight events (1-2) are noise that wastes AI tokens without adding context.
    const recentEvents: Array<{
      type: string;
      summary: string;
      weight: number;
      createdAt: Date;
    }> = await prisma.storyLedger.findMany({
      where: { weight: { gte: 3 } },
      orderBy: [{ isProcessed: "asc" }, { createdAt: "desc" }],
      take: 30,
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
        const fragmentType = data.keyType as string | undefined;
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

    // Store current themes for staleness tracking
    if (currentEpoch) {
      try {
        const ws = (currentEpoch.worldState as any) || {};
        const previousThemes: string[] = ws.lastThemes || [];
        const previousThemeDate: string | null = ws.lastThemeDate || null;

        // Check for staleness — if themes haven't changed in 7 days
        const themesChanged = narrativeThemes.length !== previousThemes.length ||
          narrativeThemes.some((t, i) => t !== previousThemes[i]);
        const daysSinceChange = previousThemeDate
          ? Math.floor((Date.now() - new Date(previousThemeDate).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        if (themesChanged) {
          // Themes changed — update
          await (db.client as any).narrativeEpoch.update({
            where: { id: currentEpoch.id },
            data: {
              worldState: {
                ...ws,
                lastThemes: narrativeThemes,
                lastThemeDate: new Date().toISOString(),
              },
            },
          });
        } else if (daysSinceChange >= 7) {
          // Themes stale — add warning to themes list
          narrativeThemes.push("⚠ NARRATIVE STAGNATION — themes unchanged for 7+ days. Consider a disruptive event.");
        }
      } catch { /* non-critical */ }
    }

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

    // Fetch intervention outcomes for Architect self-evaluation
    let interventionOutcomes = "";
    try {
      const { getService } = await import("../di/container");
      const { ARCHITECT_INTERVENTION_EXECUTOR } = await import("../di/tokens");
      const executor = getService<any>(ARCHITECT_INTERVENTION_EXECUTOR);
      if (executor?.checkInterventionOutcomes) {
        interventionOutcomes = await executor.checkInterventionOutcomes();
      }
    } catch { /* non-critical */ }

    // Build the Architect's evaluation prompt (includes intervention outcomes)
    const prompt = this.buildArchitectPrompt(worldState) +
      (interventionOutcomes ? `\n\n${interventionOutcomes}` : "");
    const systemPrompt =
      "You are The Architect — the omniscient game master AI of AIDA. " +
      "You observe all events in the simulation and decide how the narrative should evolve. " +
      "You respond ONLY with valid JSON, never with prose or markdown.";

    let evaluation: ArchitectEvaluation;

    const expectedFormat = '{ "narrativeSummary": "string", "interventions": [{"type": "send_message|plant_clue|trigger_event|adjust_tension|create_mission|grant_token|reveal_faction", "target": "string", "data": {}, "reasoning": "string"}], "shouldTransitionEpoch": false }';

    // Try agent loop first so Architect can query DB and create entities
    let responseText: string | null = null;
    try {
      const { runAgentLoop } = await import("./aiAgentTools");
      const agentPrompt = prompt + `\n\nYour final response MUST be JSON in this format:\n${expectedFormat}`;
      responseText = await runAgentLoop(
        this.aiService, db.client as any, systemPrompt, agentPrompt, this.logger, 6,
      );
    } catch { /* fall through to direct call */ }

    if (responseText) {
      evaluation = this.parseArchitectResponse(responseText);
    } else {
      // Agent loop failed — fall back to direct AI call via safeAI
      const fallbackEval: ArchitectEvaluation = {
        shouldTransitionEpoch: false,
        interventions: [],
        narrativeSummary: "Architect evaluation produced no actionable output.",
      };

      const result = await safeAI<ArchitectEvaluation>({
        aiService: this.aiService,
        prompt,
        systemPrompt,
        expectedFormat,
        validate: (parsed) => {
          // Re-use the existing parseArchitectResponse via validateArchitectEvaluation
          if (!parsed) return null;
          if (parsed.shouldTransitionEpoch && parsed.newEpochTitle && !parsed.epochTransition) {
            parsed.epochTransition = {
              title: parsed.newEpochTitle,
              summary: parsed.newEpochSummary || parsed.newEpochTitle,
            };
          }
          const validated = validateArchitectEvaluation(parsed);
          if (!validated) return null;
          // Map to ArchitectEvaluation
          return {
            shouldTransitionEpoch: Boolean(validated.epochTransition),
            ...(validated.epochTransition ? {
              newEpochTitle: validated.epochTransition.title,
              newEpochSummary: validated.epochTransition.summary,
            } : {}),
            interventions: validated.interventions.map((i) => ({
              type: i.type as ArchitectIntervention["type"],
              ...(i.target ? { targetId: i.target } : {}),
              data: i.data && typeof i.data === "object" ? i.data : {},
              reasoning: i.reasoning || "No reasoning provided",
            })),
            narrativeSummary: validated.narrativeSummary,
          };
        },
        fallback: fallbackEval,
        context: "Architect evaluation",
        logger: this.logger,
      });

      evaluation = result;
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
  async getArchitectContext(maxEvents: number = 15): Promise<string> {
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
        status: "active",
        order: 0,
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
    // Prefer the active epoch; fall back to latest by number
    const active = await (db.client as any).narrativeEpoch.findFirst({
      where: { status: "active" },
    });
    if (active) return active;
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
    // Strip markdown code fences if present before extraction
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) {
      jsonStr = fenceMatch[1].trim();
    }

    // Wrapper validator that maps flat epoch fields before validation
    const architectValidator = (parsed: any) => {
      if (!parsed) return null;
      if (parsed.shouldTransitionEpoch && parsed.newEpochTitle && !parsed.epochTransition) {
        parsed.epochTransition = {
          title: parsed.newEpochTitle,
          summary: parsed.newEpochSummary || parsed.newEpochTitle,
        };
      }
      return validateArchitectEvaluation(parsed);
    };

    // No retry context — story progression naturally retries on next cycle
    const validated = validateOrRetry(jsonStr, architectValidator);

    if (!validated) {
      this.logger.warn(
        { rawLength: raw.length },
        "Architect response failed validation — returning empty evaluation",
      );
      return {
        shouldTransitionEpoch: false,
        interventions: [],
        narrativeSummary: "Architect evaluation produced no actionable output.",
      };
    }

    // Map validated result to ArchitectEvaluation interface
    const evaluation: ArchitectEvaluation = {
      shouldTransitionEpoch: Boolean(validated.epochTransition),
      interventions: validated.interventions.map((i) => ({
        type: i.type as ArchitectIntervention["type"],
        ...(i.target ? { targetId: i.target } : {}),
        data: i.data && typeof i.data === "object" ? i.data : {},
        reasoning: i.reasoning || "No reasoning provided",
      })),
      narrativeSummary: validated.narrativeSummary,
    };

    if (validated.epochTransition) {
      evaluation.newEpochTitle = validated.epochTransition.title;
      evaluation.newEpochSummary = validated.epochTransition.summary;
    }

    return evaluation;
  }
}
