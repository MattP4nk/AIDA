import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { PersonaService } from "./personaService";
import { CronJob } from "cron";

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
  private readonly MAX_ACTIONS_PER_DAY = parseInt(process.env.AI_MAX_ACTIONS_PER_DAY || "3");
  private readonly EVENT_ACTIONS_ENABLED = process.env.AI_EVENT_ACTION_ENABLED !== "false";

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject("Logger") private logger: Logger,
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

    // Start interval timer for each persona
    for (const persona of personas) {
      this.schedulePersonaActions(persona.id);
    }

    // Schedule midnight reset
    this.scheduleMidnightReset();

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

    this.isRunning = false;
    this.logger.info("AI Scheduler stopped");
  }

  /**
   * Schedule interval-based actions for a persona
   */
  private schedulePersonaActions(personaId: string): void {
    const intervalMs = this.INTERVAL_HOURS * 60 * 60 * 1000; // Convert hours to ms

    const timer = setInterval(async () => {
      try {
        await this.processScheduledAction(personaId);
      } catch (error) {
        this.logger.error({ error, personaId }, "Error processing scheduled action");
      }
    }, intervalMs);

    this.schedulerTimers.set(personaId, timer);
    this.logger.debug({ personaId, intervalHours: this.INTERVAL_HOURS }, "Scheduled actions for persona");
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
      "America/Sao_Paulo" // Timezone (adjust as needed)
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
