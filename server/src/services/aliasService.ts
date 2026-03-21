import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { PlayerAliasInfo } from "../../../shared/types";
import { LOGGER, MISSION_INTEGRATION_SERVICE } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";

const BASE_ALIAS_COST = 10000;
const REPLACEMENT_MULTIPLIER = 3;

@injectable()
export default class AliasService {
  private missionIntegration: MissionIntegrationService | null = null;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
  ) {
    this.missionIntegration = missionIntegrationService || null;
  }

  /**
   * Create an alias for a player. Requires finding the Forger NPC first
   * (caller should validate that the player is on the correct server).
   */
  async createAlias(
    userId: string,
    aliasName: string,
    apparentFactionId?: string,
  ): Promise<{ success: boolean; message: string }> {
    // Check if player already has an alias
    const existing = await this.prisma.playerAlias.findUnique({
      where: { userId },
    });
    const cost = existing
      ? BASE_ALIAS_COST * REPLACEMENT_MULTIPLIER
      : BASE_ALIAS_COST;

    // Check if alias name is taken
    const nameTaken = await this.prisma.playerAlias.findUnique({
      where: { aliasName },
    });
    if (nameTaken) {
      return { success: false, message: "That alias name is already in use." };
    }

    // Check if player has enough credits
    const progress = await this.prisma.playerProgress.findFirst({
      where: { userId },
    });
    if (!progress || progress.credits < cost) {
      return {
        success: false,
        message: `Insufficient credits. An alias costs ${cost} credits${existing ? " (replacement cost: 3x)" : ""}.`,
      };
    }

    // Deduct credits
    await this.prisma.playerProgress.update({
      where: { userId },
      data: { credits: { decrement: cost } },
    });

    // Track credit spending for mission objectives
    if (this.missionIntegration) {
      this.missionIntegration
        .onCreditsTransaction(userId, cost, "spent")
        .catch((err) =>
          this.logger.error(
            { err },
            "Mission integration onCreditsTransaction error",
          ),
        );
    }

    // Delete existing alias if replacing
    if (existing) {
      await this.prisma.playerAlias.delete({ where: { userId } });
    }

    // Create new alias
    await this.prisma.playerAlias.create({
      data: {
        userId,
        aliasName,
        aliasEmail: `${aliasName.toLowerCase().replace(/\s/g, ".")}@shadow.net`,
        apparentFactionId: apparentFactionId || null,
        cost,
        isActive: true,
      },
    });

    this.logger.info({ userId, aliasName, cost }, "Alias created");
    return {
      success: true,
      message: `Alias "${aliasName}" created. You are now hidden behind this identity.`,
    };
  }

  /**
   * Destroy the player's alias.
   */
  async destroyAlias(
    userId: string,
  ): Promise<{ success: boolean; message: string }> {
    const alias = await this.prisma.playerAlias.findUnique({
      where: { userId },
    });
    if (!alias) {
      return { success: false, message: "You don't have an alias." };
    }

    await this.prisma.playerAlias.delete({ where: { userId } });
    this.logger.info({ userId, aliasName: alias.aliasName }, "Alias destroyed");
    return {
      success: true,
      message: `Alias "${alias.aliasName}" has been destroyed. Your true identity is now visible.`,
    };
  }

  /**
   * Get a player's alias info (for display purposes).
   */
  async getAlias(userId: string): Promise<PlayerAliasInfo | null> {
    const alias = await this.prisma.playerAlias.findUnique({
      where: { userId },
    });
    if (!alias || !alias.isActive) return null;
    return {
      aliasName: alias.aliasName,
      apparentFactionId: alias.apparentFactionId,
      isActive: alias.isActive,
    };
  }

  /**
   * Get the apparent identity of a player — returns alias name if active,
   * otherwise null (meaning use real identity).
   */
  async getApparentIdentity(
    userId: string,
    observerId?: string,
  ): Promise<string | null> {
    const alias = await this.prisma.playerAlias.findUnique({
      where: { userId },
    });
    if (!alias || !alias.isActive) return null;

    // If observer has revealed this alias, show real identity
    if (observerId && alias.revealedBy.includes(observerId)) {
      return null;
    }

    return alias.aliasName;
  }

  /**
   * Attempt to reveal another player's alias. Requires forensics + socialEng skills.
   * Returns true if successful.
   */
  async attemptReveal(
    observerId: string,
    targetUserId: string,
  ): Promise<{ success: boolean; message: string; realName?: string }> {
    const alias = await this.prisma.playerAlias.findUnique({
      where: { userId: targetUserId },
      include: { user: { select: { username: true } } },
    });

    if (!alias || !alias.isActive) {
      return {
        success: false,
        message: "That player doesn't appear to have an alias.",
      };
    }

    if (alias.revealedBy.includes(observerId)) {
      return {
        success: false,
        message: `You already know this is ${alias.user.username}.`,
      };
    }

    // Skill check: forensics + socialEng vs threshold
    const observerProgress = await this.prisma.playerProgress.findFirst({
      where: { userId: observerId },
    });
    if (!observerProgress) {
      return { success: false, message: "Cannot assess your skills." };
    }

    const skills = observerProgress.skills as Record<string, number> | null;
    const forensics = skills?.forensics ?? 0;
    const socialEng = skills?.socialEng ?? 0;
    const combinedSkill = forensics + socialEng;
    const threshold = 40; // Combined skill needed to reveal

    if (combinedSkill < threshold) {
      return {
        success: false,
        message: `Your investigation skills are insufficient. (forensics + socialEng: ${combinedSkill}/${threshold})`,
      };
    }

    // Random element: 60% base chance + skill bonus
    const chance = Math.min(0.95, 0.6 + (combinedSkill - threshold) * 0.01);
    if (Math.random() > chance) {
      return {
        success: false,
        message:
          "Your investigation didn't uncover anything this time. Try again later.",
      };
    }

    // Reveal successful
    await this.prisma.playerAlias.update({
      where: { userId: targetUserId },
      data: { revealedBy: { push: observerId } },
    });

    this.logger.info(
      { observerId, targetUserId, aliasName: alias.aliasName },
      "Alias revealed",
    );
    return {
      success: true,
      message: `Investigation complete! "${alias.aliasName}" is actually ${alias.user.username}.`,
      realName: alias.user.username,
    };
  }
}
