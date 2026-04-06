import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { Server as SocketIOServer } from "socket.io";
import { FactionService } from "./factionService";
import { LOGGER } from "../di/tokens";

/**
 * Cross-faction rivalry matrix.
 *
 * When a player gains reputation with faction A, they gain/lose a percentage
 * of that amount with rival/allied factions. Negative = rivalry, positive = alliance.
 *
 * Key format: "sourceFaction:affectedFaction" → multiplier
 */
const RIVALRY_MATRIX: Record<string, Record<string, number>> = {
  garrison: {
    dothackers: -0.5,   // enemies
    cybercorp: 0.2,     // allies
    darknet: -0.3,      // suspicious of shadow ops
  },
  dothackers: {
    garrison: -0.5,     // enemies
    cybercorp: -0.6,    // ideological enemies
    darknet: -0.3,      // distrust the unknown
  },
  cybercorp: {
    garrison: 0.2,      // allies (business relationship)
    dothackers: -0.6,   // ideological enemies
    darknet: -0.3,      // unknown variable
  },
  darknet: {
    garrison: -0.3,     // everyone's hidden enemy
    dothackers: -0.3,
    cybercorp: -0.3,
  },
};

export interface ReputationChangeEvent {
  userId: string;
  factionId: string;
  amount: number;
  reason: string;
  source: "mission" | "hack" | "forum" | "caught" | "trade" | "event" | "system";
}

@injectable()
export class ReputationEngine {
  private prisma: PrismaClient;
  private logger: Logger;
  private io: SocketIOServer;
  private factionService: FactionService;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) logger: Logger,
    @inject("SocketIO") io: SocketIOServer,
    @inject("FactionService") factionService: FactionService,
  ) {
    this.prisma = prisma;
    this.logger = logger;
    this.io = io;
    this.factionService = factionService;
  }

  /**
   * Apply a reputation change with cross-faction rivalry effects.
   * This is the single entry point for all reputation changes in the game.
   */
  public async applyReputationChange(event: ReputationChangeEvent): Promise<void> {
    const { userId, factionId, amount, reason, source } = event;

    if (amount === 0) return;

    try {
      // Resolve faction shortName for rivalry lookup
      const faction = await this.prisma.faction.findUnique({
        where: { id: factionId },
        select: { shortName: true, name: true },
      });

      if (!faction) {
        this.logger.warn({ factionId }, "ReputationEngine: faction not found");
        return;
      }

      const shortName = faction.shortName || faction.name.toLowerCase();

      // 1. Apply primary reputation change
      await this.factionService.addReputation(userId, factionId, amount);

      // 2. Create FactionEvent for the change
      await this.prisma.factionEvent.create({
        data: {
          userId,
          factionId,
          eventType: "reputation",
          title: amount > 0 ? "Reputation Gained" : "Reputation Lost",
          description: reason,
          impact: amount > 0 ? "positive" : "negative",
          reputationChange: amount,
        },
      });

      // 3. Apply rivalry matrix effects
      const rivalryEffects = RIVALRY_MATRIX[shortName];
      if (rivalryEffects) {
        for (const [rivalShortName, multiplier] of Object.entries(rivalryEffects)) {
          const rivalAmount = Math.round(amount * multiplier);
          if (rivalAmount === 0) continue;

          const rivalFaction = await this.prisma.faction.findFirst({
            where: { shortName: rivalShortName },
            select: { id: true, name: true },
          });

          if (!rivalFaction) continue;

          await this.factionService.addReputation(userId, rivalFaction.id, rivalAmount);

          // Create FactionEvent for the ripple effect
          await this.prisma.factionEvent.create({
            data: {
              userId,
              factionId: rivalFaction.id,
              eventType: "reputation",
              title: rivalAmount > 0 ? "Reputation Gained (Rivalry)" : "Reputation Lost (Rivalry)",
              description: `Cross-faction effect: ${reason}`,
              impact: rivalAmount > 0 ? "positive" : "negative",
              reputationChange: rivalAmount,
            },
          });
        }
      }

      // 4. Emit socket notification to player
      this.io.to(`player:${userId}`).emit("reputation:changed", {
        factionId,
        factionName: faction.name,
        amount,
        reason,
        source,
      });

      this.logger.info(
        { userId, factionId: shortName, amount, reason, source },
        "Reputation change applied",
      );
    } catch (error) {
      this.logger.error(error, "ReputationEngine: error applying reputation change");
    }
  }

  // ==================== EVENT HANDLERS ====================

  /**
   * Called when a player completes a mission.
   * Awards reputation to the mission's faction.
   */
  public async onMissionCompleted(userId: string, missionId: string): Promise<void> {
    try {
      const mission = await this.prisma.mission.findUnique({
        where: { id: missionId },
        select: { factionId: true, title: true, difficulty: true, reward: true },
      });

      if (!mission?.factionId) return;

      // Base rep: 5 + difficulty * 3
      const baseRep = 5 + (mission.difficulty || 1) * 3;

      // Check for reputation bonus in mission rewards
      const reward = mission.reward as any;
      const bonusRep = reward?.reputation || 0;

      const totalRep = baseRep + bonusRep;

      await this.applyReputationChange({
        userId,
        factionId: mission.factionId,
        amount: totalRep,
        reason: `Completed mission: ${mission.title}`,
        source: "mission",
      });
    } catch (error) {
      this.logger.error(error, "ReputationEngine: error on mission completed");
    }
  }

  /**
   * Called when a player fails a mission.
   * Applies a small reputation penalty to the mission's faction.
   */
  public async onMissionFailed(userId: string, missionId: string): Promise<void> {
    try {
      const mission = await this.prisma.mission.findUnique({
        where: { id: missionId },
        select: { factionId: true, title: true, difficulty: true },
      });

      if (!mission?.factionId) return;

      const penalty = -Math.max(2, Math.floor((mission.difficulty || 1) * 1.5));

      await this.applyReputationChange({
        userId,
        factionId: mission.factionId,
        amount: penalty,
        reason: `Failed mission: ${mission.title}`,
        source: "mission",
      });
    } catch (error) {
      this.logger.error(error, "ReputationEngine: error on mission failed");
    }
  }

  /**
   * Called when a player hacks a server.
   * If the server belongs to a faction and the player was detected, lose rep.
   * If undetected, gain a small amount (proving skill).
   */
  public async onServerHacked(
    userId: string,
    serverId: string,
    detected: boolean,
  ): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
        select: { factionId: true, name: true, securityLevel: true },
      });

      if (!server?.factionId) return;

      if (detected) {
        const penalty = -Math.max(5, (server.securityLevel || 1) * 2);
        await this.applyReputationChange({
          userId,
          factionId: server.factionId,
          amount: penalty,
          reason: `Detected hacking ${server.name}`,
          source: "hack",
        });
      } else {
        // Undetected hack: small positive rep with rival factions handled via rivalry matrix
        // No direct rep change with the server's faction for undetected hacks
      }
    } catch (error) {
      this.logger.error(error, "ReputationEngine: error on server hacked");
    }
  }

  /**
   * Called when a player posts on a faction forum.
   * Small reputation gain with the forum's faction.
   */
  public async onForumPost(userId: string, forumId: string): Promise<void> {
    try {
      const forum = await this.prisma.forum.findUnique({
        where: { id: forumId },
        select: { factionId: true, name: true },
      });

      if (!forum?.factionId) return;

      await this.applyReputationChange({
        userId,
        factionId: forum.factionId,
        amount: 1,
        reason: `Posted on ${forum.name}`,
        source: "forum",
      });
    } catch (error) {
      this.logger.error(error, "ReputationEngine: error on forum post");
    }
  }

  /**
   * Called when a player is caught by a faction (honeypot, failed stealth, etc).
   */
  public async onCaughtByFaction(
    userId: string,
    factionId: string,
    severity: "low" | "medium" | "high" | "critical",
  ): Promise<void> {
    const penaltyMap = { low: -3, medium: -8, high: -15, critical: -25 };
    const penalty = penaltyMap[severity] || -5;

    await this.applyReputationChange({
      userId,
      factionId,
      amount: penalty,
      reason: `Caught by faction (${severity} severity)`,
      source: "caught",
    });
  }
}
