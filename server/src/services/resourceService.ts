import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { FactionResources } from "../../../shared/types";
import { LOGGER } from "../di/tokens";

const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@injectable()
export default class ResourceService {
  private prisma: PrismaClient;
  private logger: Logger;
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) logger: Logger,
  ) {
    this.prisma = prisma;
    this.logger = logger;
  }

  /**
   * Start the resource generation tick loop.
   * Called from lifecycle/index on app startup.
   */
  public startResourceGeneration(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => {
      this.tickResources().catch((err) =>
        this.logger.error(err, "Resource tick failed"),
      );
    }, TICK_INTERVAL_MS);
    this.logger.info("Resource generation started (5-min interval)");
  }

  /**
   * Stop the resource generation tick loop.
   * Called from lifecycle on graceful shutdown.
   */
  public stopResourceGeneration(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      this.logger.info("Resource generation stopped");
    }
  }

  /**
   * Perform one resource tick: sum non-contested server outputs per faction,
   * update Faction.resources JSON, and record a FactionResourceTick.
   */
  public async tickResources(): Promise<void> {
    // Get all faction-owned servers that are online and not contested
    const servers = await this.prisma.gameServer.findMany({
      where: {
        factionId: { not: null },
        isOnline: true,
        isContested: false,
        resourceOutput: { gt: 0 },
      },
      select: {
        factionId: true,
        resourceType: true,
        resourceOutput: true,
      },
    });

    // Aggregate per faction
    const factionTotals = new Map<
      string,
      { credits: number; intel: number; compute: number }
    >();

    for (const server of servers) {
      if (!server.factionId || !server.resourceType) continue;

      let totals = factionTotals.get(server.factionId);
      if (!totals) {
        totals = { credits: 0, intel: 0, compute: 0 };
        factionTotals.set(server.factionId, totals);
      }

      const rt = server.resourceType as keyof typeof totals;
      if (rt in totals) {
        totals[rt] += server.resourceOutput;
      }
    }

    // Apply to each faction
    for (const [factionId, tick] of factionTotals) {
      if (tick.credits === 0 && tick.intel === 0 && tick.compute === 0) continue;

      const faction = await this.prisma.faction.findUnique({
        where: { id: factionId },
        select: { resources: true },
      });

      if (!faction) continue;

      const currentResources = (faction.resources as unknown as FactionResources) || {
        credits: 0,
        intel: 0,
        compute: 0,
      };

      const newResources: FactionResources = {
        credits: (currentResources.credits || 0) + tick.credits,
        intel: (currentResources.intel || 0) + tick.intel,
        compute: (currentResources.compute || 0) + tick.compute,
      };

      await this.prisma.faction.update({
        where: { id: factionId },
        data: { resources: newResources as any },
      });

      // Record tick history
      await this.prisma.factionResourceTick.create({
        data: {
          factionId,
          credits: tick.credits,
          intel: tick.intel,
          compute: tick.compute,
        },
      });
    }

    if (factionTotals.size > 0) {
      this.logger.info(
        { factionCount: factionTotals.size },
        "Resource tick completed",
      );
    }
  }

  /**
   * Get current resources for a faction.
   */
  public async getFactionResources(
    factionId: string,
  ): Promise<FactionResources> {
    const faction = await this.prisma.faction.findUnique({
      where: { id: factionId },
      select: { resources: true },
    });

    if (!faction) return { credits: 0, intel: 0, compute: 0 };

    return (faction.resources as unknown as FactionResources) || {
      credits: 0,
      intel: 0,
      compute: 0,
    };
  }

  /**
   * Spend faction resources. Returns false if insufficient.
   */
  public async spendResources(
    factionId: string,
    cost: Partial<FactionResources>,
  ): Promise<boolean> {
    const current = await this.getFactionResources(factionId);

    if (
      (cost.credits && current.credits < cost.credits) ||
      (cost.intel && current.intel < cost.intel) ||
      (cost.compute && current.compute < cost.compute)
    ) {
      return false;
    }

    const updated: FactionResources = {
      credits: current.credits - (cost.credits || 0),
      intel: current.intel - (cost.intel || 0),
      compute: current.compute - (cost.compute || 0),
    };

    await this.prisma.faction.update({
      where: { id: factionId },
      data: { resources: updated as any },
    });

    return true;
  }

  /**
   * Get recent resource tick history for a faction.
   */
  public async getResourceHistory(
    factionId: string,
    limit = 10,
  ): Promise<{ credits: number; intel: number; compute: number; tickedAt: Date }[]> {
    return this.prisma.factionResourceTick.findMany({
      where: { factionId },
      orderBy: { tickedAt: "desc" },
      take: limit,
      select: {
        credits: true,
        intel: true,
        compute: true,
        tickedAt: true,
      },
    });
  }
}
