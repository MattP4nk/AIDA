import { injectable, inject } from "tsyringe";
import { PrismaClient, Faction, FactionMember, Mission, GameServer } from "@prisma/client";
import { Logger } from "pino";

@injectable()
export class FactionService {
  private prisma: PrismaClient;
  private logger: Logger;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject("Logger") logger: Logger
  ) {
    this.prisma = prisma;
    this.logger = logger;
  }

  /**
   * Get all available factions
   */
  public async getAllFactions(): Promise<Faction[]> {
    return this.prisma.faction.findMany({
      orderBy: { name: "asc" },
    });
  }

  /**
   * Get a faction by ID
   */
  public async getFactionById(factionId: string): Promise<Faction | null> {
    return this.prisma.faction.findUnique({
      where: { id: factionId },
    });
  }

  /**
   * Get a faction by name (or short name)
   */
  public async getFactionByName(name: string): Promise<Faction | null> {
    const faction = await this.prisma.faction.findFirst({
      where: {
        OR: [
          { name: { equals: name, mode: "insensitive" } },
          { shortName: { equals: name, mode: "insensitive" } },
        ],
      },
    });
    return faction;
  }

  /**
   * Get a user's current faction membership
   */
  public async getUserFaction(userId: string): Promise<FactionMember & { faction: Faction } | null> {
    return this.prisma.factionMember.findFirst({
      where: { userId },
      include: { faction: true },
    });
  }

  /**
   * Join a faction
   */
  public async joinFaction(userId: string, factionId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user is already in a faction
      const existingMembership = await this.prisma.factionMember.findFirst({
        where: { userId },
      });

      if (existingMembership) {
        if (existingMembership.factionId === factionId) {
          return { success: false, message: "You are already a member of this faction." };
        }
        return { success: false, message: "You must leave your current faction before joining a new one." };
      }

      // Check if faction exists
      const faction = await this.prisma.faction.findUnique({
        where: { id: factionId },
      });

      if (!faction) {
        return { success: false, message: "Faction not found." };
      }

      // Create membership
      await this.prisma.factionMember.create({
        data: {
          userId,
          factionId,
          rank: "recruit",
          reputation: 0,
        },
      });

      // Initialize standing if not exists
      await this.prisma.factionStanding.upsert({
        where: {
          userId_factionId: {
            userId,
            factionId,
          },
        },
        update: {
          isAllied: true,
          isNeutral: false,
          isHostile: false,
        },
        create: {
          userId,
          factionId,
          reputation: 0,
          isAllied: true,
          isNeutral: false,
          isHostile: false,
        },
      });

      // Update faction active members count
      await this.prisma.faction.update({
        where: { id: factionId },
        data: {
          activeMembers: { increment: 1 },
        },
      });

      return { success: true, message: `Successfully joined ${faction.name}.` };
    } catch (error) {
      this.logger.error(error, "Error joining faction");
      return { success: false, message: "Failed to join faction due to an internal error." };
    }
  }

  /**
   * Leave current faction
   */
  public async leaveFaction(userId: string): Promise<{ success: boolean; message: string }> {
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

      // Update standing (reset to neutral, maybe keep some rep?)
      await this.prisma.factionStanding.update({
        where: {
          userId_factionId: {
            userId,
            factionId: membership.factionId,
          },
        },
        data: {
          isAllied: false,
          isNeutral: true,
          // Penalty for leaving? For now, just reset status.
        },
      });

      // Update faction active members count
      await this.prisma.faction.update({
        where: { id: membership.factionId },
        data: {
          activeMembers: { decrement: 1 },
        },
      });

      return { success: true, message: `Successfully left ${membership.faction.name}.` };
    } catch (error) {
      this.logger.error(error, "Error leaving faction");
      return { success: false, message: "Failed to leave faction due to an internal error." };
    }
  }

  /**
   * Get user's reputation with a specific faction
   */
  public async getFactionReputation(userId: string, factionId: string): Promise<number> {
    const standing = await this.prisma.factionStanding.findUnique({
      where: {
        userId_factionId: {
          userId,
          factionId,
        },
      },
    });

    return standing?.reputation || 0;
  }

  /**
   * Modify user's reputation with a faction
   */
  public async addReputation(userId: string, factionId: string, amount: number): Promise<void> {
    try {
      const standing = await this.prisma.factionStanding.upsert({
        where: {
          userId_factionId: {
            userId,
            factionId,
          },
        },
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

      // Update member reputation if they are a member
      const membership = await this.prisma.factionMember.findUnique({
        where: {
          userId_factionId: {
            userId,
            factionId,
          },
        },
      });

      if (membership) {
        await this.prisma.factionMember.update({
          where: { id: membership.id },
          data: {
            reputation: standing.reputation,
          },
        });
      }
    } catch (error) {
      this.logger.error(error, "Error adding reputation");
    }
  }

  /**
   * Get missions available for a faction
   */
  public async getFactionMissions(factionId: string): Promise<Mission[]> {
    return this.prisma.mission.findMany({
      where: {
        factionId,
        status: "available",
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Get servers owned/controlled by a faction
   */
  public async getFactionServers(factionId: string): Promise<GameServer[]> {
    return this.prisma.gameServer.findMany({
      where: {
        factionId,
      },
    });
  }
}
