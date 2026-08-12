import { injectable, inject } from "tsyringe";
import { PrismaClient, FactionWar } from "@prisma/client";
import { Logger } from "pino";
import { FactionWarInfo, WarStatus } from "../../../shared/types";
import { getService } from "../di/container";
import { LOGGER, PERSONA_SERVICE, RESOURCE_SERVICE, DYNAMIC_CONTENT_SERVICE } from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";

/** War duration safety valve: 14 days */
const MAX_WAR_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** Resource bleed per faction per tick during war */
const WAR_RESOURCE_BLEED = { credits: 10, intel: 5, compute: 5 };

@injectable()
export default class WarfareService {
  private warCheckInterval: NodeJS.Timeout | undefined;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
  ) {}

  /**
   * Start periodic war checks (resource bleed + safety valve).
   * Called during app initialization.
   */
  startWarMonitor(): void {
    // Check every 5 minutes
    this.warCheckInterval = setInterval(async () => {
      await safeExecute({
        fn: () => this.processActiveWars(),
        context: "Process active wars",
        logger: this.logger,
      })();
    }, 5 * 60 * 1000);
    this.warCheckInterval.unref?.();
    this.logger.info("Warfare monitor started");
  }

  stopWarMonitor(): void {
    if (this.warCheckInterval) {
      clearInterval(this.warCheckInterval);
      this.warCheckInterval = undefined;
    }
  }

  /**
   * Declare war between two factions. Only AI faction leaders can declare war.
   */
  async declareWar(
    attackerFactionId: string,
    defenderFactionId: string,
    declaredBy: string, // AI persona ID
  ): Promise<{ success: boolean; message: string; war?: FactionWarInfo }> {
    // Prevent self-war
    if (attackerFactionId === defenderFactionId) {
      return { success: false, message: "A faction cannot declare war on itself." };
    }

    // Check for existing active war between these factions
    const existingWar = await this.prisma.factionWar.findFirst({
      where: {
        status: "active",
        OR: [
          { attackerFactionId, defenderFactionId },
          { attackerFactionId: defenderFactionId, defenderFactionId: attackerFactionId },
        ],
      },
    });

    if (existingWar) {
      return { success: false, message: "These factions are already at war." };
    }

    const [attacker, defender] = await Promise.all([
      this.prisma.faction.findUnique({ where: { id: attackerFactionId } }),
      this.prisma.faction.findUnique({ where: { id: defenderFactionId } }),
    ]);

    if (!attacker || !defender) {
      return { success: false, message: "One or both factions not found." };
    }

    const war = await this.prisma.factionWar.create({
      data: {
        attackerFactionId,
        defenderFactionId,
        declaredBy,
        status: "active",
        reputationMultiplier: 2.0,
      },
      include: { attackerFaction: true, defenderFaction: true },
    });

    // Create faction events for both sides
    await Promise.all([
      this.prisma.factionEvent.create({
        data: {
          factionId: attackerFactionId,
          eventType: "war",
          title: "War Declared!",
          description: `${attacker.name} has declared war on ${defender.name}!`,
          impact: "negative",
        },
      }),
      this.prisma.factionEvent.create({
        data: {
          factionId: defenderFactionId,
          eventType: "war",
          title: "War Declared Against Us!",
          description: `${attacker.name} has declared war on ${defender.name}!`,
          impact: "negative",
        },
      }),
    ]);

    // Notify faction leaders via PersonaService
    await safeExecute({
      fn: async () => {
        const personaService = getService<import("./personaService").PersonaService>(PERSONA_SERVICE);
        await personaService.onWarDeclared(attackerFactionId, defenderFactionId, war.id);
      },
      context: "Notify personas of war declaration",
      logger: this.logger,
      silent: true,
    })();

    // Inject war notices into faction servers
    await safeExecute({
      fn: async () => {
        const dynamicContent = getService<import("./dynamicContentService").DynamicContentService>(DYNAMIC_CONTENT_SERVICE);
        await dynamicContent.processEvent("war:declared", {
          attackerFactionId,
          defenderFactionId,
          attackerName: attacker.name,
          defenderName: defender.name,
          warId: war.id,
        });
      },
      context: "Inject war notices into faction servers",
      logger: this.logger,
      silent: true,
    })();

    this.logger.info({ warId: war.id, attacker: attacker.name, defender: defender.name }, "War declared");

    return {
      success: true,
      message: `${attacker.name} has declared war on ${defender.name}!`,
      war: this.toWarInfo(war),
    };
  }

  /**
   * Surrender a war. Loser pays proportionally to war score difference.
   */
  async surrender(
    factionId: string,
    warId: string,
  ): Promise<{ success: boolean; message: string }> {
    const war = await this.prisma.factionWar.findUnique({
      where: { id: warId },
      include: { attackerFaction: true, defenderFaction: true },
    });

    if (!war || war.status !== "active") {
      return { success: false, message: "No active war found." };
    }

    if (war.attackerFactionId !== factionId && war.defenderFactionId !== factionId) {
      return { success: false, message: "Your faction is not part of this war." };
    }

    const isAttackerSurrendering = factionId === war.attackerFactionId;
    const winnerId = isAttackerSurrendering ? war.defenderFactionId : war.attackerFactionId;
    const winnerName = isAttackerSurrendering ? war.defenderFaction.name : war.attackerFaction.name;
    const loserName = isAttackerSurrendering ? war.attackerFaction.name : war.defenderFaction.name;

    // Calculate terms based on war score difference
    const scoreDiff = Math.abs(war.attackerScore - war.defenderScore);
    const reparations = { credits: scoreDiff * 50, intel: scoreDiff * 20, compute: scoreDiff * 20 };

    await this.prisma.factionWar.update({
      where: { id: warId },
      data: {
        status: "surrendered",
        endedAt: new Date(),
        terms: { winnerId, reparations, surrenderedBy: factionId },
      },
    });

    // Transfer resources from loser to winner
    await safeExecute({
      fn: async () => {
        const resourceService = getService<import("./resourceService").default>(RESOURCE_SERVICE);
        await resourceService.spendResources(factionId, reparations);
      },
      context: "Transfer war reparation resources",
      logger: this.logger,
      silent: true,
    })();

    // Notify AI personas of war end
    await safeExecute({
      fn: async () => {
        const personaService = getService<import("./personaService").PersonaService>(PERSONA_SERVICE);
        await personaService.onWarEnded(warId, winnerId, factionId, "surrender");
      },
      context: "Notify personas of war surrender",
      logger: this.logger,
      silent: true,
    })();

    // Inject ceasefire notices into faction servers
    await safeExecute({
      fn: async () => {
        const dynamicContent = getService<import("./dynamicContentService").DynamicContentService>(DYNAMIC_CONTENT_SERVICE);
        await dynamicContent.processEvent("war:ended", {
          winnerFactionId: winnerId,
          loserFactionId: factionId,
          winnerName: winnerName,
          loserName: loserName,
          reason: "surrendered",
          warId,
        });
      },
      context: "Inject surrender ceasefire notices",
      logger: this.logger,
      silent: true,
    })();

    this.logger.info({ warId, surrenderedBy: factionId, winnerId }, "War ended by surrender");

    return {
      success: true,
      message: `${loserName} has surrendered to ${winnerName}. Reparations: ${reparations.credits} credits, ${reparations.intel} intel, ${reparations.compute} compute.`,
    };
  }

  /**
   * Update war score (called by hack/contest/mission during active war).
   */
  async updateWarScore(warId: string, factionId: string, points: number): Promise<void> {
    const war = await this.prisma.factionWar.findUnique({ where: { id: warId } });
    if (!war || war.status !== "active") return;

    const field = factionId === war.attackerFactionId ? "attackerScore" : "defenderScore";
    await this.prisma.factionWar.update({
      where: { id: warId },
      data: { [field]: { increment: points } },
    });
  }

  /**
   * Get the reputation multiplier for a faction (2x if at war, 1x otherwise).
   */
  async getReputationMultiplier(factionId: string): Promise<number> {
    const activeWar = await this.prisma.factionWar.findFirst({
      where: {
        status: "active",
        OR: [{ attackerFactionId: factionId }, { defenderFactionId: factionId }],
      },
    });
    return activeWar?.reputationMultiplier ?? 1.0;
  }

  /**
   * Get active war for a faction (if any).
   */
  async getActiveWar(factionId: string): Promise<FactionWarInfo | null> {
    const war = await this.prisma.factionWar.findFirst({
      where: {
        status: "active",
        OR: [{ attackerFactionId: factionId }, { defenderFactionId: factionId }],
      },
      include: { attackerFaction: true, defenderFaction: true },
    });
    return war ? this.toWarInfo(war) : null;
  }

  /**
   * Get all wars (active + recent resolved).
   */
  async getWars(limit = 10): Promise<FactionWarInfo[]> {
    const wars = await this.prisma.factionWar.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { attackerFaction: true, defenderFaction: true },
    });
    return wars.map((w) => this.toWarInfo(w));
  }

  /**
   * Process active wars: apply resource bleed and check 14-day safety valve.
   */
  private async processActiveWars(): Promise<void> {
    const activeWars = await this.prisma.factionWar.findMany({
      where: { status: "active" },
      include: { attackerFaction: true, defenderFaction: true },
    });

    for (const war of activeWars) {
      // Check 14-day safety valve
      const warDuration = Date.now() - war.startedAt.getTime();
      if (warDuration > MAX_WAR_DURATION_MS) {
        await this.forceCeasefire(war);
        continue;
      }

      // Apply resource bleed to both factions
      await safeExecute({
        fn: async () => {
          const resourceService = getService<import("./resourceService").default>(RESOURCE_SERVICE);
          await resourceService.spendResources(war.attackerFactionId, WAR_RESOURCE_BLEED);
          await resourceService.spendResources(war.defenderFactionId, WAR_RESOURCE_BLEED);
        },
        context: "Apply war resource bleed",
        logger: this.logger,
        silent: true,
      })();

      // Throttled AI notification: every 6th tick (~30 min) so leaders know about war costs
      const warMinutes = Math.floor((Date.now() - war.startedAt.getTime()) / (5 * 60 * 1000));
      if (warMinutes % 6 === 0) {
        await safeExecute({
          fn: async () => {
            const personaService = getService<import("./personaService").PersonaService>(PERSONA_SERVICE);
            await personaService.onWarResourceBleed(war.attackerFactionId, war.defenderFactionId, WAR_RESOURCE_BLEED);
          },
          context: "Notify personas of war resource bleed",
          logger: this.logger,
          silent: true,
        })();
      }
    }
  }

  /**
   * Force ceasefire after 14 days — auto-negotiate terms based on war score.
   */
  private async forceCeasefire(war: FactionWar & { attackerFaction: { name: string }; defenderFaction: { name: string } }): Promise<void> {
    const winnerId = war.attackerScore >= war.defenderScore ? war.attackerFactionId : war.defenderFactionId;
    const winnerName = war.attackerScore >= war.defenderScore ? war.attackerFaction.name : war.defenderFaction.name;

    await this.prisma.factionWar.update({
      where: { id: war.id },
      data: {
        status: "ceasefire",
        endedAt: new Date(),
        terms: { winnerId, reason: "14-day safety valve", attackerScore: war.attackerScore, defenderScore: war.defenderScore },
      },
    });

    // Notify AI personas of ceasefire
    await safeExecute({
      fn: async () => {
        const personaService = getService<import("./personaService").PersonaService>(PERSONA_SERVICE);
        await personaService.onWarEnded(war.id, winnerId, null, "ceasefire");
      },
      context: "Notify personas of forced ceasefire",
      logger: this.logger,
      silent: true,
    })();

    // Inject ceasefire notices into faction servers
    await safeExecute({
      fn: async () => {
        const loserId = winnerId === war.attackerFactionId ? war.defenderFactionId : war.attackerFactionId;
        const loserName = winnerId === war.attackerFactionId ? war.defenderFaction.name : war.attackerFaction.name;
        const dynamicContent = getService<import("./dynamicContentService").DynamicContentService>(DYNAMIC_CONTENT_SERVICE);
        await dynamicContent.processEvent("war:ended", {
          winnerFactionId: winnerId,
          loserFactionId: loserId,
          winnerName,
          loserName,
          reason: "ceasefire (14-day limit)",
          warId: war.id,
        });
      },
      context: "Inject ceasefire notices into faction servers",
      logger: this.logger,
      silent: true,
    })();

    this.logger.info({ warId: war.id, winnerId, winnerName }, "War ended by forced ceasefire (14-day limit)");
  }

  private toWarInfo(war: any): FactionWarInfo {
    return {
      id: war.id,
      attackerFactionId: war.attackerFactionId,
      attackerName: war.attackerFaction?.name ?? "Unknown",
      defenderFactionId: war.defenderFactionId,
      defenderName: war.defenderFaction?.name ?? "Unknown",
      status: war.status as WarStatus,
      attackerScore: war.attackerScore,
      defenderScore: war.defenderScore,
      reputationMultiplier: war.reputationMultiplier,
      startedAt: war.startedAt,
      endedAt: war.endedAt,
    };
  }
}
