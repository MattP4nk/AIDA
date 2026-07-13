import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { PersonaService } from "./personaService";
import { CronJob } from "cron";
import { getService } from "../di/container";
import { LOGGER, RESOURCE_SERVICE, FACTION_KNOWLEDGE_SERVICE } from "../di/tokens";
import ResourceService from "./resourceService";
import type { FactionKnowledgeService } from "./factionKnowledgeService";

/**
 * AISchedulerService - Automated AI Persona Actions
 * 
 * PHASE 5 WEEK 4: Automation & Safety
 * 
 * Responsibilities:
 * - Schedule interval-based AI actions (every 8 hours)
 * - Enforce daily action limits (3 per persona)
 * - Reset counters at midnight
 * - Handle event-triggered actions (unlimited)
 */

@injectable()
export class AISchedulerService {
  private schedulerTimers: Map<string, NodeJS.Timeout> = new Map();
  private midnightResetJob: CronJob | undefined;
  private isRunning: boolean = false;

  // Configuration
  private readonly INTERVAL_HOURS = parseInt(process.env.AI_INTERVAL_HOURS || "8");
  private readonly FACTION_LEADER_INTERVAL_HOURS = parseInt(process.env.AI_FACTION_LEADER_INTERVAL_HOURS || "4");
  private readonly MAX_ACTIONS_PER_DAY = parseInt(process.env.AI_MAX_ACTIONS_PER_DAY || "3");
  private readonly EVENT_ACTIONS_ENABLED = process.env.AI_EVENT_ACTION_ENABLED !== "false";
  private gameStateCheckInterval: NodeJS.Timeout | undefined;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject("PersonaService") private personaService: PersonaService
  ) {}

  /**
   * Start the scheduler for all active AI personas
   */
  async startScheduler(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Scheduler already running");
      return;
    }

    this.logger.info("Starting AI Scheduler...");

    // Get all AI personas
    const personas = await this.prisma.aIPersona.findMany({
      where: {
        type: {
          in: ["game_master", "faction_leader", "aida"]
        }
      }
    });

    // Start interval timer for each persona (faction leaders run on a tighter schedule)
    for (const persona of personas) {
      const isFactionLeader = persona.type === "faction_leader";
      this.schedulePersonaActions(persona.id, isFactionLeader ? this.FACTION_LEADER_INTERVAL_HOURS : this.INTERVAL_HOURS);
    }

    // Schedule midnight reset
    this.scheduleMidnightReset();

    // Start game-state-aware check every 30 minutes for faction leaders
    this.startGameStateCheck();

    this.isRunning = true;
    this.logger.info(`AI Scheduler started for ${personas.length} personas`);
  }

  /**
   * Stop all schedulers
   */
  async stopScheduler(): Promise<void> {
    this.logger.info("Stopping AI Scheduler...");

    // Clear all timers
    for (const [personaId, timer] of this.schedulerTimers.entries()) {
      clearInterval(timer);
      this.logger.debug({ personaId }, "Stopped scheduler for persona");
    }
    this.schedulerTimers.clear();

    // Stop midnight job
    if (this.midnightResetJob) {
      this.midnightResetJob.stop();
      this.midnightResetJob = undefined;
    }

    if (this.gameStateCheckInterval) {
      clearInterval(this.gameStateCheckInterval);
      this.gameStateCheckInterval = undefined;
    }

    this.isRunning = false;
    this.logger.info("AI Scheduler stopped");
  }

  /**
   * Start game-state-aware checks for faction leaders every 30 minutes.
   * If a faction is low on resources or under attack, triggers a dynamic mission.
   */
  private startGameStateCheck(): void {
    const CHECK_INTERVAL_MS = 30 * 60 * 1000;
    this.gameStateCheckInterval = setInterval(async () => {
      if (!this.isRunning) return;
      try {
        await this.checkFactionGameState();
      } catch (error) {
        this.logger.error({ error }, "Error in faction game state check");
      }
    }, CHECK_INTERVAL_MS);
    this.gameStateCheckInterval.unref?.();
  }

  private async checkFactionGameState(): Promise<void> {
    let resourceService: ResourceService | null = null;
    try {
      resourceService = getService<ResourceService>(RESOURCE_SERVICE);
    } catch {
      return; // ResourceService not available
    }

    // Expire stale faction knowledge entries + decay confidence
    let fkService: FactionKnowledgeService | null = null;
    try {
      fkService = getService<FactionKnowledgeService>(FACTION_KNOWLEDGE_SERVICE);
      await fkService.expireEntries();
      await fkService.decayConfidence();
    } catch {
      // FactionKnowledgeService not available — not fatal
    }

    const factions = await this.prisma.faction.findMany({ where: { isHidden: false } });

    for (const faction of factions) {
      try {
        const resources = await resourceService.getFactionResources(faction.id);
        const totalResources = (resources.credits ?? 0) + (resources.intel ?? 0) + (resources.compute ?? 0);
        const lowThreshold = 50;

        // Check active wars involving this faction
        const activeWars = await this.prisma.factionWar.count({
          where: {
            OR: [{ attackerFactionId: faction.id }, { defenderFactionId: faction.id }],
            status: "active",
          },
        });

        // Check contested servers
        const contestedServers = await this.prisma.serverContest.count({
          where: {
            OR: [{ attackingFactionId: faction.id }, { defendingFactionId: faction.id }],
            status: "active",
          },
        });

        // Generate mission if faction needs help
        if (totalResources < lowThreshold) {
          await this.personaService.generateDynamicMission(faction.id, { lowResources: true });
          this.logger.info({ factionId: faction.id, totalResources, activeWars }, "Generated defensive mission for low-resource faction");
        } else if (contestedServers > 0) {
          await this.personaService.generateDynamicMission(faction.id, { underAttack: true });
          this.logger.info({ factionId: faction.id, contestedServers, activeWars }, "Generated defensive mission for contested faction");
        } else if (activeWars > 0 && totalResources < 100) {
          // At war with moderate resources — generate war-support mission
          await this.personaService.generateDynamicMission(faction.id, { underAttack: true });
          this.logger.info({ factionId: faction.id, activeWars, totalResources }, "Generated war-support mission for faction at war");
        }
      } catch (error) {
        this.logger.error({ error, factionId: faction.id }, "Error checking faction game state");
      }
    }

    // Rebalancing check — weight missions toward weak factions
    try {
      const factionPower: { id: string; power: number }[] = [];
      for (const faction of factions) {
        const resources = await resourceService.getFactionResources(faction.id);
        const totalResources = (resources.credits ?? 0) + (resources.intel ?? 0) + (resources.compute ?? 0);
        const serverCount = await this.prisma.gameServer.count({
          where: { factionId: faction.id, isPlayerHome: false },
        });
        const memberCount = await this.prisma.factionMember.count({
          where: { factionId: faction.id },
        });
        factionPower.push({ id: faction.id, power: totalResources + serverCount * 50 + memberCount * 30 });
      }

      if (factionPower.length >= 2) {
        const avgPower = factionPower.reduce((s, f) => s + f.power, 0) / factionPower.length;
        const dominant = factionPower.reduce((a, b) => a.power > b.power ? a : b);

        // If dominant faction is 1.5x average, boost weaker factions
        if (dominant.power > avgPower * 1.5) {
          const weakFactions = factionPower.filter(f => f.power < avgPower * 0.8);
          for (const weak of weakFactions) {
            await this.personaService.generateDynamicMission(weak.id, { rebalance: true });
            this.logger.info(
              { factionId: weak.id, power: weak.power, avgPower, dominantPower: dominant.power },
              "Generated rebalancing mission for underpowered faction",
            );
          }
        }
      }
    } catch (error) {
      this.logger.error({ error }, "Error in faction rebalancing check");
    }

    // Game Master director check — omniscient narrative orchestration
    try {
      const gameMaster = await this.prisma.aIPersona.findFirst({ where: { type: "game_master" } });
      if (gameMaster) {
        const canAct = await this.canTakeAction(gameMaster.id);
        if (canAct) {
          const action = await this.personaService.decideDirectorAction(gameMaster.id);
          if (action) {
            await this.personaService.executeAction(action.id);
            await this.incrementActionCounter(gameMaster.id);
            this.logger.info({ actionId: action.id, actionType: action.type }, "Game Master director action executed");
          }
        }
      }
    } catch (error) {
      this.logger.error({ error }, "Error in Game Master director check");
    }
  }

  /**
   * Schedule interval-based actions for a persona
   */
  private schedulePersonaActions(personaId: string, intervalHours: number = this.INTERVAL_HOURS): void {
    const intervalMs = intervalHours * 60 * 60 * 1000; // Convert hours to ms

    const timer = setInterval(async () => {
      try {
        await this.processScheduledAction(personaId);
      } catch (error) {
        this.logger.error({ error, personaId }, "Error processing scheduled action");
      }
    }, intervalMs);

    this.schedulerTimers.set(personaId, timer);
    this.logger.debug({ personaId, intervalHours }, "Scheduled actions for persona");
  }

  /**
   * Process a scheduled action for a persona
   */
  private async processScheduledAction(personaId: string): Promise<void> {
    // Check if persona can take action (daily limit)
    const canAct = await this.canTakeAction(personaId);
    if (!canAct) {
      this.logger.info({ personaId }, "Persona reached daily action limit, skipping");
      return;
    }

    this.logger.info({ personaId }, "Processing scheduled AI action");

    // Trigger PersonaService to decide and execute action
    const action = await this.personaService.decideAction(personaId);

    if (action) {
      this.logger.info({ personaId, actionId: action.id, actionType: action.type }, "AI scheduled action created");

      // Execute the action
      await this.personaService.executeAction(action.id);

      // Update persona counters
      await this.incrementActionCounter(personaId);
    } else {
      this.logger.debug({ personaId }, "AI decided no action needed");
    }
  }

  /**
   * Check if persona can take a scheduled action (enforces daily limit)
   */
  private async canTakeAction(personaId: string): Promise<boolean> {
    const persona = await this.prisma.aIPersona.findUnique({
      where: { id: personaId },
      select: { actionsToday: true }
    });

    if (!persona) {
      this.logger.warn({ personaId }, "Persona not found");
      return false;
    }

    return persona.actionsToday < this.MAX_ACTIONS_PER_DAY;
  }

  /**
   * Increment action counter for a persona
   */
  private async incrementActionCounter(personaId: string): Promise<void> {
    await this.prisma.aIPersona.update({
      where: { id: personaId },
      data: {
        actionsToday: { increment: 1 },
        lastActionAt: new Date()
      }
    });
  }

  /**
   * Trigger an event-based action (bypasses daily limit)
   * 
   * PHASE 5 WEEK 3: Used by PersonaService event handlers
   */
  async triggerEventAction(personaId: string, eventType: string): Promise<void> {
    if (!this.EVENT_ACTIONS_ENABLED) {
      this.logger.debug("Event-triggered actions disabled");
      return;
    }

    this.logger.info({ personaId, eventType }, "Triggering event-based AI action");

    try {
      // Event-triggered actions bypass daily limits
      const action = await this.personaService.decideAction(personaId);

      if (action) {
        this.logger.info({ personaId, actionId: action.id, eventType }, "Event action created");
        await this.personaService.executeAction(action.id);
      }
    } catch (error) {
      this.logger.error({ error, personaId, eventType }, "Error in event-triggered action");
    }
  }

  /**
   * Schedule midnight reset of daily action counters
   */
  private scheduleMidnightReset(): void {
    // Cron pattern: "0 0 * * *" = every day at midnight
    this.midnightResetJob = new CronJob(
      "0 0 * * *",
      async () => {
        try {
          await this.resetDailyCounters();
        } catch (error) {
          this.logger.error({ error }, "Error in midnight reset");
        }
      },
      null,
      true, // Start immediately
      "UTC"
    );

    this.logger.info("Midnight reset job scheduled");
  }

  /**
   * Reset daily action counters for all personas
   */
  private async resetDailyCounters(): Promise<void> {
    this.logger.info("Resetting daily action counters...");

    const result = await this.prisma.aIPersona.updateMany({
      data: {
        actionsToday: 0
      }
    });

    this.logger.info({ count: result.count }, "Daily counters reset");
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    isRunning: boolean;
    activeSchedulers: number;
    config: {
      intervalHours: number;
      maxActionsPerDay: number;
      eventActionsEnabled: boolean;
    };
  } {
    return {
      isRunning: this.isRunning,
      activeSchedulers: this.schedulerTimers.size,
      config: {
        intervalHours: this.INTERVAL_HOURS,
        maxActionsPerDay: this.MAX_ACTIONS_PER_DAY,
        eventActionsEnabled: this.EVENT_ACTIONS_ENABLED
      }
    };
  }
}

export default AISchedulerService;
