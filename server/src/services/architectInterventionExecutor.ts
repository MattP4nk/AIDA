/**
 * ArchitectInterventionExecutor
 *
 * Takes interventions proposed by the Architect AI (via StoryProgressionService)
 * and actually executes them by delegating to existing services.
 *
 * Each intervention type maps to a specific handler that validates inputs,
 * performs the action through the appropriate service, and records the result
 * in the StoryLedger for narrative continuity.
 *
 * All service lookups are lazy (dynamic imports) to avoid circular dependency
 * issues, since many services depend on each other transitively.
 */

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import {
  LOGGER,
  MESSAGE_SERVICE,
  MISSION_SERVICE,
  EVENT_SERVICE,
  PERSONA_SERVICE,
  STORY_PROGRESSION_SERVICE,
} from "../di/tokens";
import { db } from "../database/client";
import { EventSeverity } from "../../../shared/types";
import type { ArchitectIntervention } from "./storyProgressionService";
import type { MessageService } from "./messageService";
import type { PersonaService } from "./personaService";
import type { StoryProgressionService } from "./storyProgressionService";
import type EventService from "./eventService";
import type MissionService from "./missionService";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/**
 * Result of executing a single Architect intervention.
 */
export interface InterventionResult {
  type: ArchitectIntervention["type"];
  success: boolean;
  reasoning: string;
  output?: Record<string, unknown>;
  error?: string;
}

/**
 * Handler dispatch map type — maps intervention types to their handlers.
 */
type InterventionHandler = (
  intervention: ArchitectIntervention,
) => Promise<InterventionResult>;

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class ArchitectInterventionExecutor {
  /** Dispatch table mapping intervention types to handler methods. */
  private readonly handlers: Record<
    ArchitectIntervention["type"],
    InterventionHandler
  >;

  constructor(@inject(LOGGER) private logger: Logger) {
    // Build the dispatch table once at construction time
    this.handlers = {
      send_message: this.handleSendMessage.bind(this),
      plant_clue: this.handlePlantClue.bind(this),
      trigger_event: this.handleTriggerEvent.bind(this),
      adjust_tension: this.handleAdjustTension.bind(this),
      create_mission: this.handleCreateMission.bind(this),
      grant_token: this.handleGrantToken.bind(this),
      reveal_faction: this.handleRevealFaction.bind(this),
    };
  }

  // ── Lazy Service Accessors ───────────────────────────────────────

  /**
   * Lazily resolve a service from the DI container.
   * Uses dynamic import to break circular dependency chains.
   */
  private async getService<T>(token: string): Promise<T> {
    const { getService } = await import("../di/container");
    return getService<T>(token);
  }

  private async getMessageService(): Promise<MessageService> {
    return this.getService<MessageService>(MESSAGE_SERVICE);
  }

  private async getPersonaService(): Promise<PersonaService> {
    return this.getService<PersonaService>(PERSONA_SERVICE);
  }

  private async getEventService(): Promise<EventService> {
    return this.getService<EventService>(EVENT_SERVICE);
  }

  private async getMissionService(): Promise<MissionService> {
    return this.getService<MissionService>(MISSION_SERVICE);
  }

  private async getStoryProgressionService(): Promise<StoryProgressionService> {
    return this.getService<StoryProgressionService>(STORY_PROGRESSION_SERVICE);
  }

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Execute a batch of interventions returned by the Architect evaluation.
   * Each intervention is executed independently — failures don't block others.
   * Returns a summary of results.
   */
  async executeBatch(
    interventions: ArchitectIntervention[],
  ): Promise<InterventionResult[]> {
    if (!interventions.length) {
      return [];
    }

    this.logger.info(
      { count: interventions.length },
      "Architect executing intervention batch",
    );

    const results: InterventionResult[] = [];

    for (const intervention of interventions) {
      const result = await this.execute(intervention);
      results.push(result);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    this.logger.info(
      { total: results.length, succeeded, failed },
      "Architect intervention batch complete",
    );

    return results;
  }

  /**
   * Execute a single intervention. Dispatches to the appropriate handler.
   */
  async execute(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const handler = this.handlers[intervention.type];

    if (!handler) {
      this.logger.warn(
        { type: intervention.type },
        "Unknown intervention type — skipping",
      );
      return {
        type: intervention.type,
        success: false,
        reasoning: intervention.reasoning,
        error: `Unknown intervention type: ${intervention.type}`,
      };
    }

    this.logger.info(
      {
        type: intervention.type,
        targetId: intervention.targetId,
        reasoning: intervention.reasoning.slice(0, 120),
      },
      "Executing Architect intervention",
    );

    try {
      const result = await handler(intervention);

      if (result.success) {
        this.logger.info(
          { type: intervention.type, output: result.output },
          "Intervention executed successfully",
        );
      } else {
        this.logger.warn(
          { type: intervention.type, error: result.error },
          "Intervention execution failed",
        );
      }

      return result;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown execution error";
      this.logger.error(
        { err, type: intervention.type },
        "Intervention threw an unhandled error",
      );
      return {
        type: intervention.type,
        success: false,
        reasoning: intervention.reasoning,
        error: message,
      };
    }
  }

  // ── Private Handlers ─────────────────────────────────────────────

  /**
   * send_message — Send a message from an AI persona to a player.
   *
   * data: { content: string, subject?: string, personaId?: string }
   * targetId: userId of the player
   */
  private async handleSendMessage(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { data, targetId, reasoning } = intervention;
    const content = data.content as string | undefined;
    const subject = (data.subject as string) ?? "Message from The Architect";
    const personaId = data.personaId as string | undefined;

    if (!content) {
      return {
        type: "send_message",
        success: false,
        reasoning,
        error: "Missing required field: data.content",
      };
    }

    if (!targetId) {
      return {
        type: "send_message",
        success: false,
        reasoning,
        error: "Missing required field: targetId (userId)",
      };
    }

    // Resolve the persona — use the provided ID or fall back to The Architect
    let resolvedPersonaId = personaId;
    if (!resolvedPersonaId) {
      const architect = await db.client.aIPersona.findFirst({
        where: { type: "game_master" },
        select: { id: true },
      });
      if (!architect) {
        return {
          type: "send_message",
          success: false,
          reasoning,
          error: "No game_master persona found in database",
        };
      }
      resolvedPersonaId = architect.id;
    }

    const messageService = await this.getMessageService();
    const result = await messageService.sendAIMessage(
      resolvedPersonaId!,
      targetId,
      subject,
      content,
    );

    // Record the intervention in the StoryLedger
    await this.recordLedgerEvent(intervention, {
      personaId: resolvedPersonaId,
      recipientId: targetId,
      messageSent: result.success,
    });

    const sendResult: InterventionResult = {
      type: "send_message",
      success: result.success,
      reasoning,
      output: {
        personaId: resolvedPersonaId,
        recipientId: targetId,
        subject,
      },
    };
    if (!result.success) {
      sendResult.error = result.message;
    }
    return sendResult;
  }

  /**
   * plant_clue — Plant a hidden file (clue) on a server.
   *
   * data: { clueType?: string, content?: string }
   * targetId: serverId (or finds a suitable server if not provided)
   */
  private async handlePlantClue(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { data, targetId, reasoning } = intervention;
    const clueType = (data.clueType as string) ?? "signal";

    // Resolve the target server
    let serverId = targetId;
    if (!serverId) {
      // Pick a random accessible server
      const server = await db.client.gameServer.findFirst({
        orderBy: { securityLevel: "asc" },
        select: { id: true },
      });
      if (!server) {
        return {
          type: "plant_clue",
          success: false,
          reasoning,
          error: "No suitable server found to plant clue on",
        };
      }
      serverId = server.id;
    }

    const personaService = await this.getPersonaService();
    const clueResult = await personaService.generateClue(clueType, serverId);

    await this.recordLedgerEvent(intervention, {
      serverId,
      clueType,
      fileId: clueResult?.fileId ?? clueResult?.id,
    });

    return {
      type: "plant_clue",
      success: true,
      reasoning,
      output: {
        serverId,
        clueType,
        fileId: clueResult?.fileId ?? clueResult?.id,
      },
    };
  }

  /**
   * trigger_event — Create a system-wide alert/event.
   *
   * data: { title: string, content: string, severity?: "info" | "warning" | "critical" }
   */
  private async handleTriggerEvent(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { data, reasoning } = intervention;
    const title = data.title as string | undefined;
    const content = data.content as string | undefined;
    const severityStr = (data.severity as string) ?? "info";

    if (!title || !content) {
      return {
        type: "trigger_event",
        success: false,
        reasoning,
        error: "Missing required fields: data.title and data.content",
      };
    }

    // Map the severity string to the EventSeverity enum
    const severityMap: Record<string, EventSeverity> = {
      info: EventSeverity.INFO,
      warning: EventSeverity.WARNING,
      critical: EventSeverity.CRITICAL,
    };
    const severity = severityMap[severityStr] ?? EventSeverity.INFO;

    const eventService = await this.getEventService();
    const event = await eventService.createSystemAlert(
      title,
      content,
      severity,
    );

    await this.recordLedgerEvent(intervention, {
      eventId: event.id,
      title,
      severity: severityStr,
    });

    return {
      type: "trigger_event",
      success: true,
      reasoning,
      output: {
        eventId: event.id,
        title,
        severity: severityStr,
      },
    };
  }

  /**
   * adjust_tension — Modify global tension level.
   *
   * data: { delta: number, reason?: string }
   */
  private async handleAdjustTension(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { data, reasoning } = intervention;
    const delta = data.delta as number | undefined;
    const reason = (data.reason as string) ?? reasoning;

    if (delta === undefined || typeof delta !== "number") {
      return {
        type: "adjust_tension",
        success: false,
        reasoning,
        error:
          "Missing or invalid required field: data.delta (must be a number)",
      };
    }

    // Record a StoryLedger event with impact.tension set to the delta
    const storyService = await this.getStoryProgressionService();
    await storyService.recordEvent({
      type: "persona_action",
      category: "narrative",
      actorId: "architect",
      actorType: "persona",
      summary: `Architect adjusted global tension by ${delta > 0 ? "+" : ""}${delta}`,
      detail: reason,
      impact: {
        tension: delta,
      },
      weight: Math.min(10, Math.max(1, Math.abs(delta))),
    });

    return {
      type: "adjust_tension",
      success: true,
      reasoning,
      output: {
        delta,
        reason,
      },
    };
  }

  /**
   * create_mission — Create a new mission.
   *
   * data: { title: string, description: string, type?: string, difficulty?: number,
   *         reward?: object, factionId?: string }
   */
  private async handleCreateMission(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { data, reasoning } = intervention;
    const title = data.title as string | undefined;
    const description = data.description as string | undefined;

    if (!title || !description) {
      return {
        type: "create_mission",
        success: false,
        reasoning,
        error: "Missing required fields: data.title and data.description",
      };
    }

    const missionType = (data.type as string) ?? "story";
    const difficulty = (data.difficulty as number) ?? 3;
    const reward = (data.reward as Record<string, unknown>) ?? {
      xp: difficulty * 100,
      credits: difficulty * 50,
    };
    const factionId = data.factionId as string | undefined;

    const missionService = await this.getMissionService();
    const missionData: Parameters<typeof missionService.createMission>[0] = {
      title,
      description,
      type: missionType,
      difficulty,
      reward: reward as any,
      createdBy: "architect",
      issuedBy: "The Architect",
      objectives: [
        {
          id: `obj_${Date.now().toString(36)}`,
          type: "boolean" as const,
          description,
          target: 1,
          current: 0,
          completed: false,
        },
      ],
    };
    if (factionId) {
      missionData.factionId = factionId;
    }
    const mission = await missionService.createMission(missionData);

    await this.recordLedgerEvent(intervention, {
      missionId: mission.id,
      title: mission.title,
      difficulty,
      factionId,
    });

    return {
      type: "create_mission",
      success: true,
      reasoning,
      output: {
        missionId: mission.id,
        title: mission.title,
        difficulty,
      },
    };
  }

  /**
   * grant_token — Grant a communication token to a player.
   *
   * data: { tokenName?: string, shopItemId?: string }
   * targetId: userId
   */
  private async handleGrantToken(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { data, targetId, reasoning } = intervention;
    const tokenName = data.tokenName as string | undefined;
    const shopItemId = data.shopItemId as string | undefined;

    if (!targetId) {
      return {
        type: "grant_token",
        success: false,
        reasoning,
        error: "Missing required field: targetId (userId)",
      };
    }

    // Find the shop item — by explicit ID or by name match
    let resolvedItemId = shopItemId;

    if (!resolvedItemId && tokenName) {
      const item = await db.client.shopItem.findFirst({
        where: {
          itemType: "token",
          name: { contains: tokenName, mode: "insensitive" },
        },
        select: { id: true, name: true },
      });
      if (item) {
        resolvedItemId = item.id;
      }
    }

    if (!resolvedItemId) {
      return {
        type: "grant_token",
        success: false,
        reasoning,
        error: `No token shop item found matching: ${tokenName ?? "(no name provided)"}`,
      };
    }

    // Create an inventory item for the user
    const inventoryItem = await db.client.inventoryItem.create({
      data: {
        userId: targetId,
        shopItemId: resolvedItemId,
        quantity: 1,
        source: "story_event",
      },
    });

    await this.recordLedgerEvent(intervention, {
      userId: targetId,
      shopItemId: resolvedItemId,
      inventoryItemId: inventoryItem.id,
      tokenName,
    });

    return {
      type: "grant_token",
      success: true,
      reasoning,
      output: {
        userId: targetId,
        shopItemId: resolvedItemId,
        inventoryItemId: inventoryItem.id,
      },
    };
  }

  /**
   * reveal_faction — Make a hidden faction visible to all players.
   *
   * targetId: factionId
   */
  private async handleRevealFaction(
    intervention: ArchitectIntervention,
  ): Promise<InterventionResult> {
    const { targetId, reasoning } = intervention;

    if (!targetId) {
      return {
        type: "reveal_faction",
        success: false,
        reasoning,
        error: "Missing required field: targetId (factionId)",
      };
    }

    // Verify the faction exists
    const faction = await db.client.faction.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, isHidden: true },
    });

    if (!faction) {
      return {
        type: "reveal_faction",
        success: false,
        reasoning,
        error: `Faction not found: ${targetId}`,
      };
    }

    if (!faction.isHidden) {
      return {
        type: "reveal_faction",
        success: true,
        reasoning,
        output: {
          factionId: faction.id,
          factionName: faction.name,
          alreadyVisible: true,
        },
      };
    }

    // Reveal the faction
    await db.client.faction.update({
      where: { id: targetId },
      data: { isHidden: false },
    });

    // Announce the discovery with a system alert
    const eventService = await this.getEventService();
    await eventService.createSystemAlert(
      `New Faction Discovered: ${faction.name}`,
      `A previously hidden faction — ${faction.name} — has emerged from the shadows. Their motives remain unclear.`,
      EventSeverity.WARNING,
    );

    await this.recordLedgerEvent(intervention, {
      factionId: faction.id,
      factionName: faction.name,
    });

    return {
      type: "reveal_faction",
      success: true,
      reasoning,
      output: {
        factionId: faction.id,
        factionName: faction.name,
      },
    };
  }

  // ── Ledger Recording ─────────────────────────────────────────────

  /**
   * Record an intervention execution in the StoryLedger for narrative tracking.
   * This ensures the Architect's actions become part of the world's history
   * and are visible during future evaluations.
   */
  private async recordLedgerEvent(
    intervention: ArchitectIntervention,
    details: Record<string, unknown>,
  ): Promise<void> {
    try {
      const storyService = await this.getStoryProgressionService();
      await storyService.recordEvent({
        type: "persona_action",
        category: "narrative",
        actorId: "architect",
        actorType: "persona",
        summary: `Architect intervention [${intervention.type}]: ${intervention.reasoning.slice(0, 100)}`,
        detail: intervention.reasoning,
        data: {
          interventionType: intervention.type,
          targetId: intervention.targetId,
          interventionData: intervention.data,
          executionDetails: details,
        },
        weight: 5,
      });
    } catch (err) {
      // Ledger recording failure should not break the intervention itself
      this.logger.warn(
        { err, type: intervention.type },
        "Failed to record intervention in StoryLedger",
      );
    }
  }
}

export default ArchitectInterventionExecutor;
