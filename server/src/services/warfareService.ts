import { injectable, inject } from "tsyringe";
import { PrismaClient, FactionWar } from "@prisma/client";
import { Logger } from "pino";
import { FactionWarInfo, WarStatus } from "../../../shared/types";
import { getService } from "../di/container";
import {
  WAR_POINTS_PER_HACK,
  WAR_SCORE_COOLDOWN_MS,
  WAR_MAX_POINTS_PER_PLAYER,
} from "../config/gameBalance";
import { LOGGER, PERSONA_SERVICE, RESOURCE_SERVICE, DYNAMIC_CONTENT_SERVICE } from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";

/** War duration safety valve: 14 days */
const MAX_WAR_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** Resource bleed per faction per tick during war */
const WAR_RESOURCE_BLEED = { credits: 10, intel: 5, compute: 5 };

@injectable()
export default class WarfareService {
  private warCheckInterval: NodeJS.Timeout | undefined;

  /**
   * War-scoring windows, held IN MEMORY.
   *
   *   warScoredAt    `${warId}:${userId}:${serverId}` -> last scored at (ms)
   *   warContributed `${warId}:${userId}`             -> points contributed
   *
   * KNOWN LIMIT, stated rather than left to be discovered: both are REBUILT
   * EMPTY ON RESTART, so a process restart resets every cooldown and every
   * player's contribution total for wars still running. That is a real hole —
   * a restart is not player-triggered, but it does mean the cap is a
   * per-process cap rather than a per-war one.
   *
   * `HackLog` has the right columns to derive this durably and was rejected on
   * purpose: it is written FIRE-AND-FORGET one step earlier in the same
   * pipeline, so whether the current hack is present when scoring runs is a
   * race. Making the rule durable properly needs a small schema addition and a
   * maintainer `db:push`; it is filed rather than faked.
   */
  private warScoredAt = new Map<string, number>();
  private warContributed = new Map<string, number>();
  private warSweepInterval: NodeJS.Timeout | undefined;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
  ) {
    // Sweep hourly so the windows cannot grow without bound. `unref` so it
    // never holds the process open, and it only touches in-memory maps plus
    // one indexed read.
    this.warSweepInterval = setInterval(
      () => {
        void safeExecute({
          fn: () => this.sweepWarScoreWindows(),
          context: "Sweep war score windows",
          logger: this.logger,
        })();
      },
      WAR_SCORE_COOLDOWN_MS,
    );
    (this.warSweepInterval as NodeJS.Timeout & { unref?: () => void }).unref?.();
  }

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
    // The sweep is armed in the constructor, not by startWarMonitor, but it
    // still has to stop here: it is the only shutdown hook warfareService has,
    // and a sweep that fires after `prisma.$disconnect()` throws from inside a
    // timer callback.
    if (this.warSweepInterval) {
      clearInterval(this.warSweepInterval);
      this.warSweepInterval = undefined;
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
   * Score a successful hack toward an active war, if the hack is part of one.
   *
   * ORPHAN AUDIT: `updateWarScore` had NO PRODUCER. A declared war sat 0-0 for
   * its whole life and `startWarMonitor` resolved it on elapsed time rather
   * than on anything either side did — which is why the feature read as
   * "wired" (rows existed, the monitor ran) while being decorative.
   *
   * The war lookup lives here rather than in hackService because this service
   * owns what a war IS; the caller only knows that a hack succeeded.
   *
   * Returns the war it scored, or null when the hack has nothing to do with
   * one — which is the common case, so this must stay cheap and silent.
   */
  async recordHackForWar(
    attackerUserId: string,
    targetServerId: string,
    points: number = WAR_POINTS_PER_HACK,
  ): Promise<{ warId: string; factionId: string } | null> {
    const [attacker, server] = await Promise.all([
      this.prisma.factionMember.findFirst({
        where: { userId: attackerUserId },
        select: { factionId: true },
      }),
      this.prisma.gameServer.findUnique({
        where: { id: targetServerId },
        select: { factionId: true },
      }),
    ]);
    if (!attacker?.factionId || !server?.factionId) return null;
    // Hacking your own faction's server is not a war contribution.
    if (attacker.factionId === server.factionId) return null;

    const war = await this.prisma.factionWar.findFirst({
      where: {
        status: "active",
        OR: [
          { attackerFactionId: attacker.factionId, defenderFactionId: server.factionId },
          { attackerFactionId: server.factionId, defenderFactionId: attacker.factionId },
        ],
      },
      select: { id: true },
    });
    if (!war) return null;

    // ── Two limits, because each alone is farmable ───────────────────
    //
    // The per-server cooldown stops re-hacking one weak target on the hack
    // cooldown (~6/min = 3,600 points/hour before this). The per-player cap
    // stops the obvious answer to that, which is to rotate targets. A war is
    // decided by `forceCeasefire` comparing the two scores, so an uncapped
    // single account decided a fourteen-day war on its own.
    const now = Date.now();
    const serverKey = `${war.id}:${attackerUserId}:${targetServerId}`;
    const lastScored = this.warScoredAt.get(serverKey);
    if (lastScored !== undefined && now - lastScored < WAR_SCORE_COOLDOWN_MS) {
      return null;
    }

    const playerKey = `${war.id}:${attackerUserId}`;
    const contributed = this.warContributed.get(playerKey) ?? 0;
    if (contributed >= WAR_MAX_POINTS_PER_PLAYER) return null;

    // Never overshoot the cap on the last award.
    const award = Math.min(points, WAR_MAX_POINTS_PER_PLAYER - contributed);
    if (award <= 0) return null;

    // Claim the cooldown slot and the contribution BEFORE awaiting the write.
    // Both maps are the shared state the two limits above are read from, so
    // updating them afterwards leaves a window in which concurrent hacks all
    // read the same pre-write total and all award — which is exactly the
    // uncapped single account the cap exists to prevent.
    this.warScoredAt.set(serverKey, now);
    this.warContributed.set(playerKey, contributed + award);
    try {
      await this.updateWarScore(war.id, attacker.factionId, award);
    } catch (err) {
      // Undo the claim; a failed write must not consume the player's cap.
      //
      // SUBTRACT, do not restore the snapshot. Two hacks on DIFFERENT servers
      // run concurrently (different serverKeys, so neither is cooldown-blocked
      // and both reach here). A reads 0 and writes 50; B reads 50 and writes
      // 100; B commits and A throws. Restoring A's snapshot would write 0 back
      // over B's 100 — losing B's committed award and handing the player the
      // whole cap again on top of it.
      if (lastScored === undefined) this.warScoredAt.delete(serverKey);
      else this.warScoredAt.set(serverKey, lastScored);
      this.warContributed.set(
        playerKey,
        Math.max(0, (this.warContributed.get(playerKey) ?? 0) - award),
      );
      throw err;
    }
    return { warId: war.id, factionId: attacker.factionId };
  }

  /**
   * Drop cooldown entries that have expired, and contribution totals for wars
   * that are over.
   *
   * Contributions are deliberately NOT aged out — expiring them would restore
   * the rotation exploit the cap exists to stop — so they are cleared by war
   * status instead.
   */
  private async sweepWarScoreWindows(): Promise<void> {
    const now = Date.now();
    for (const [key, at] of this.warScoredAt) {
      if (now - at >= WAR_SCORE_COOLDOWN_MS) this.warScoredAt.delete(key);
    }
    if (this.warContributed.size === 0) return;
    const warIds = [...new Set([...this.warContributed.keys()].map((k) => k.split(":")[0]!))];
    const live = await this.prisma.factionWar.findMany({
      where: { id: { in: warIds }, status: "active" },
      select: { id: true },
    });
    const liveIds = new Set(live.map((w) => w.id));
    for (const key of [...this.warContributed.keys()]) {
      if (!liveIds.has(key.split(":")[0]!)) this.warContributed.delete(key);
    }
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
