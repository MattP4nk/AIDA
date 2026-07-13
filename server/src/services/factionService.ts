import { injectable, inject } from "tsyringe";
import { EventEmitter } from "events";
import {
  PrismaClient,
  Faction,
  FactionMember,
  Mission,
  GameServer,
} from "@prisma/client";
import { Logger } from "pino";
import { FactionStandingInfo, FactionRank } from "../../../shared/types";
import { LOGGER, MISSION_INTEGRATION_SERVICE } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";
import {
  REPUTATION_MIN,
  REPUTATION_MAX,
  REPUTATION_ALLIED_THRESHOLD,
  REPUTATION_HOSTILE_THRESHOLD,
} from "../config/gameBalance";

/** Rank promotion requirements per faction (overridable via Faction.rankRequirements JSON). */
const DEFAULT_RANK_REQUIREMENTS: Record<
  string,
  { reputation: number; missions?: number }
> = {
  operative: { reputation: 20, missions: 3 },
  elite: { reputation: 50, missions: 10 },
  council_member: { reputation: 80, missions: 25 },
};

const RANK_ORDER: FactionRank[] = [
  "recruit",
  "operative",
  "elite",
  "council_member",
];

@injectable()
export class FactionService extends EventEmitter {
  private prisma: PrismaClient;
  private logger: Logger;
  private missionIntegration: MissionIntegrationService | null = null;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) logger: Logger,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
  ) {
    super();
    this.prisma = prisma;
    this.logger = logger;
    this.missionIntegration = missionIntegrationService || null;
  }

  // ==================== FACTION QUERIES ====================

  /**
   * Get all visible factions (excludes hidden factions like DarkNet).
   * Pass includeHidden=true for admin/internal use or after player discovery.
   */
  public async getAllFactions(
    includeHidden = false,
    userId?: string,
  ): Promise<Faction[]> {
    if (includeHidden) {
      return this.prisma.faction.findMany({ orderBy: { name: "asc" } });
    }

    // Check if user has discovered DarkNet
    let showHidden = false;
    if (userId) {
      try {
        const { getService } = await import("../di/container");
        const darknetService = getService<
          import("./darknetDiscoveryService").default
        >("DarkNetDiscoveryService");
        showHidden = darknetService.hasDiscoveredDarkNet(userId);
      } catch {
        /* Not available */
      }
    }

    return this.prisma.faction.findMany({
      where: showHidden ? {} : { isHidden: false },
      orderBy: { name: "asc" },
    });
  }

  public async getFactionById(factionId: string): Promise<Faction | null> {
    return this.prisma.faction.findUnique({
      where: { id: factionId },
    });
  }

  /** Case-insensitive search by name or shortName. */
  public async getFactionByName(name: string): Promise<Faction | null> {
    return this.prisma.faction.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { shortName: { equals: name, mode: "insensitive" } },
        ],
      },
    });
  }

  // ==================== MEMBERSHIP ====================

  public async getUserFaction(
    userId: string,
  ): Promise<(FactionMember & { faction: Faction }) | null> {
    return this.prisma.factionMember.findFirst({
      where: { userId },
      include: { faction: true },
    });
  }

  public async joinFaction(
    userId: string,
    factionId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const existingMembership = await this.prisma.factionMember.findFirst({
        where: { userId },
      });

      if (existingMembership) {
        if (existingMembership.factionId === factionId) {
          return {
            success: false,
            message: "You are already a member of this faction.",
          };
        }
        return {
          success: false,
          message:
            "You must leave your current faction before joining a new one.",
        };
      }

      const faction = await this.prisma.faction.findUnique({
        where: { id: factionId },
      });

      if (!faction) {
        return { success: false, message: "Faction not found." };
      }

      // Check if faction is hidden and player hasn't discovered it
      if (faction.isHidden) {
        try {
          const { getService } = await import("../di/container");
          const darknetService = getService<
            import("./darknetDiscoveryService").default
          >("DarkNetDiscoveryService");
          if (!darknetService.hasDiscoveredDarkNet(userId)) {
            return { success: false, message: "Faction not found." };
          }
        } catch {
          return { success: false, message: "Faction not found." };
        }
      }

      // Check standing — cannot join if hostile
      const standing = await this.prisma.factionStanding.findUnique({
        where: { userId_factionId: { userId, factionId } },
      });
      if (standing?.isHostile) {
        return {
          success: false,
          message: `${faction.name} considers you hostile. Improve your standing first.`,
        };
      }

      // Create membership
      await this.prisma.factionMember.create({
        data: {
          userId,
          factionId,
          rank: "recruit",
          reputation: 0,
          totalReputationEarned: 0,
        },
      });

      // Upsert standing to allied
      await this.prisma.factionStanding.upsert({
        where: { userId_factionId: { userId, factionId } },
        update: { isAllied: true, isNeutral: false, isHostile: false },
        create: {
          userId,
          factionId,
          reputation: 0,
          isAllied: true,
          isNeutral: false,
          isHostile: false,
        },
      });

      // Increment active members
      await this.prisma.faction.update({
        where: { id: factionId },
        data: { activeMembers: { increment: 1 } },
      });

      // Create faction event
      await this.prisma.factionEvent.create({
        data: {
          userId,
          factionId,
          eventType: "membership",
          title: "New Member",
          description: "A new recruit has joined the faction.",
          impact: "positive",
        },
      });

      this.emit("faction:member_joined", {
        factionId,
        userId,
        factionName: faction.name,
      });

      // Track for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onFactionEvent(userId, "join", factionId)
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onFactionEvent error",
            ),
          );
      }

      return { success: true, message: `Successfully joined ${faction.name}.` };
    } catch (error) {
      this.logger.error(error, "Error joining faction");
      return {
        success: false,
        message: "Failed to join faction due to an internal error.",
      };
    }
  }

  public async leaveFaction(
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const membership = await this.prisma.factionMember.findFirst({
        where: { userId },
        include: { faction: true },
      });

      if (!membership) {
        return { success: false, message: "You are not in any faction." };
      }

      // Delete membership
      await this.prisma.factionMember.delete({
        where: { id: membership.id },
      });

      // Reset standing to neutral, apply reputation penalty (-5)
      await this.prisma.factionStanding.update({
        where: {
          userId_factionId: { userId, factionId: membership.factionId },
        },
        data: {
          isAllied: false,
          isNeutral: true,
          reputation: { decrement: 5 },
          lastAction: "left_faction",
          lastChange: -5,
        },
      });

      // Decrement active members
      await this.prisma.faction.update({
        where: { id: membership.factionId },
        data: { activeMembers: { decrement: 1 } },
      });

      // Create faction event
      await this.prisma.factionEvent.create({
        data: {
          userId,
          factionId: membership.factionId,
          eventType: "membership",
          title: "Member Left",
          description: "A member has left the faction.",
          impact: "negative",
          reputationChange: -5,
        },
      });

      this.emit("faction:member_left", {
        factionId: membership.factionId,
        userId,
        factionName: membership.faction.name,
      });

      // Track for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onFactionEvent(userId, "leave", membership.factionId)
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onFactionEvent error",
            ),
          );
      }

      return {
        success: true,
        message: `Successfully left ${membership.faction.name}. (-5 reputation)`,
      };
    } catch (error) {
      this.logger.error(error, "Error leaving faction");
      return {
        success: false,
        message: "Failed to leave faction due to an internal error.",
      };
    }
  }

  // ==================== STANDINGS & REPUTATION ====================

  /** Get all faction standings for a user (used by gameStateManager for client state). */
  public async getAllStandings(userId: string): Promise<FactionStandingInfo[]> {
    const standings = await this.prisma.factionStanding.findMany({
      where: { userId },
      include: { faction: true },
    });

    return standings.map((s) => ({
      factionId: s.factionId,
      factionName: s.faction.name,
      factionShortName: s.faction.shortName || s.faction.name.toLowerCase(),
      reputation: s.reputation,
      isHostile: s.isHostile,
      isAllied: s.isAllied,
    }));
  }

  /** Build a FactionReputation map { shortName: reputation } for client consumption. */
  public async getReputationMap(
    userId: string,
  ): Promise<Record<string, number>> {
    const standings = await this.getAllStandings(userId);
    const map: Record<string, number> = {};
    for (const s of standings) {
      map[s.factionShortName] = s.reputation;
    }
    return map;
  }

  public async getFactionReputation(
    userId: string,
    factionId: string,
  ): Promise<number> {
    const standing = await this.prisma.factionStanding.findUnique({
      where: { userId_factionId: { userId, factionId } },
    });
    return standing?.reputation || 0;
  }

  public async addReputation(
    userId: string,
    factionId: string,
    amount: number,
  ): Promise<void> {
    try {
      const standing = await this.prisma.factionStanding.upsert({
        where: { userId_factionId: { userId, factionId } },
        update: {
          reputation: { increment: amount },
          lastChange: amount,
          lastAction: amount > 0 ? "reputation_gain" : "reputation_loss",
        },
        create: {
          userId,
          factionId,
          reputation: amount,
          lastChange: amount,
          lastAction: amount > 0 ? "reputation_gain" : "reputation_loss",
        },
      });

      // Clamp reputation to configured bounds
      const clamped = Math.max(REPUTATION_MIN, Math.min(REPUTATION_MAX, standing.reputation));
      if (clamped !== standing.reputation) {
        await this.prisma.factionStanding.update({
          where: { id: standing.id },
          data: { reputation: clamped },
        });
      }

      // Update standing flags based on configured thresholds
      const newRep = clamped;
      await this.prisma.factionStanding.update({
        where: { id: standing.id },
        data: {
          isAllied: newRep >= REPUTATION_ALLIED_THRESHOLD,
          isHostile: newRep <= REPUTATION_HOSTILE_THRESHOLD,
          isNeutral: newRep > REPUTATION_HOSTILE_THRESHOLD && newRep < REPUTATION_ALLIED_THRESHOLD,
        },
      });

      this.emit("faction:reputation_changed", {
        userId,
        factionId,
        amount,
        newReputation: newRep,
      });

      // Track for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onFactionEvent(userId, "reputation_gain", factionId, { amount })
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onFactionEvent error",
            ),
          );
      }

      // Sync to FactionMember if they are a member + track total earned
      const membership = await this.prisma.factionMember.findUnique({
        where: { userId_factionId: { userId, factionId } },
      });

      if (membership) {
        const updateData: any = { reputation: newRep };
        if (amount > 0) {
          updateData.totalReputationEarned = { increment: amount };
        }
        await this.prisma.factionMember.update({
          where: { id: membership.id },
          data: updateData,
        });
      }
    } catch (error) {
      this.logger.error(error, "Error adding reputation");
    }
  }

  // ==================== RANKS ====================

  public async getUserRank(
    userId: string,
    factionId: string,
  ): Promise<FactionRank | null> {
    const membership = await this.prisma.factionMember.findUnique({
      where: { userId_factionId: { userId, factionId } },
    });
    return (membership?.rank as FactionRank) || null;
  }

  /**
   * Check if a user qualifies for promotion to the next rank.
   */
  public async checkRankRequirements(
    userId: string,
    factionId: string,
  ): Promise<{
    eligible: boolean;
    currentRank: FactionRank;
    nextRank: FactionRank | null;
    requirements: { reputation: number; missions?: number } | null;
    progress: { reputation: number; missions: number };
  }> {
    const membership = await this.prisma.factionMember.findUnique({
      where: { userId_factionId: { userId, factionId } },
      include: { faction: true },
    });

    if (!membership) {
      return {
        eligible: false,
        currentRank: "recruit",
        nextRank: null,
        requirements: null,
        progress: { reputation: 0, missions: 0 },
      };
    }

    const currentRank = membership.rank as FactionRank;
    const currentIndex = RANK_ORDER.indexOf(currentRank);
    const nextRank =
      currentIndex < RANK_ORDER.length - 1
        ? RANK_ORDER[currentIndex + 1]!
        : null;

    if (!nextRank) {
      return {
        eligible: false,
        currentRank,
        nextRank: null,
        requirements: null,
        progress: { reputation: membership.totalReputationEarned, missions: 0 },
      };
    }

    // Get requirements — faction-specific overrides or defaults
    const factionReqs =
      (membership.faction.rankRequirements as Record<string, any>) || {};
    const reqs = factionReqs[nextRank] ||
      DEFAULT_RANK_REQUIREMENTS[nextRank] || { reputation: 999 };

    // Count completed missions for this faction
    const completedMissions = await this.prisma.mission.count({
      where: {
        assignedTo: userId,
        factionId,
        status: "completed",
      },
    });

    const eligible =
      membership.totalReputationEarned >= reqs.reputation &&
      (!reqs.missions || completedMissions >= reqs.missions);

    return {
      eligible,
      currentRank,
      nextRank,
      requirements: reqs,
      progress: {
        reputation: membership.totalReputationEarned,
        missions: completedMissions,
      },
    };
  }

  /**
   * Promote a user to the next rank if eligible.
   */
  public async promoteUser(
    userId: string,
    factionId: string,
  ): Promise<{ success: boolean; message: string; newRank?: FactionRank }> {
    const check = await this.checkRankRequirements(userId, factionId);

    if (!check.nextRank) {
      return {
        success: false,
        message: "You are already at the highest rank.",
      };
    }

    if (!check.eligible) {
      const reqs = check.requirements!;
      let msg = `Promotion to ${check.nextRank.toUpperCase()} requires:`;
      msg += ` ${reqs.reputation} total reputation (you have ${check.progress.reputation})`;
      if (reqs.missions) {
        msg += `, ${reqs.missions} completed missions (you have ${check.progress.missions})`;
      }
      return { success: false, message: msg };
    }

    await this.prisma.factionMember.update({
      where: { userId_factionId: { userId, factionId } },
      data: { rank: check.nextRank },
    });

    // Create faction event for promotion
    await this.prisma.factionEvent.create({
      data: {
        userId,
        factionId,
        eventType: "reputation",
        title: "Rank Promotion",
        description: `Promoted to ${check.nextRank.toUpperCase()}.`,
        impact: "positive",
      },
    });

    this.emit("faction:rank_achieved", {
      userId,
      factionId,
      newRank: check.nextRank,
    });
    return {
      success: true,
      message: `Promoted to ${check.nextRank.toUpperCase()}!`,
      newRank: check.nextRank,
    };
  }

  // ==================== INITIALIZATION ====================

  /**
   * Create FactionStanding rows for all visible factions for a new user.
   * Called during registration.
   */
  public async initializeStandings(userId: string): Promise<void> {
    try {
      const visibleFactions = await this.prisma.faction.findMany({
        where: { isHidden: false },
        select: { id: true },
      });

      for (const faction of visibleFactions) {
        await this.prisma.factionStanding.upsert({
          where: { userId_factionId: { userId, factionId: faction.id } },
          update: {},
          create: {
            userId,
            factionId: faction.id,
            reputation: 0,
            isAllied: false,
            isHostile: false,
            isNeutral: true,
          },
        });
      }
    } catch (error) {
      this.logger.error(error, "Error initializing faction standings");
    }
  }

  // ==================== MISSIONS & SERVERS ====================

  public async getFactionMissions(factionId: string): Promise<Mission[]> {
    return this.prisma.mission.findMany({
      where: { factionId, status: "available" },
      orderBy: { createdAt: "desc" },
    });
  }

  public async getFactionServers(factionId: string): Promise<GameServer[]> {
    return this.prisma.gameServer.findMany({
      where: { factionId },
    });
  }
}
