import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  value: number;
  detail?: string;
}

export type LeaderboardCategory =
  | "level"
  | "credits"
  | "hacking"
  | "networking"
  | "cryptography"
  | "stealth"
  | "reputation"
  | "achievements"
  | "missions";

@injectable()
export class LeaderboardService {
  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
  ) {}

  async getLeaderboard(
    category: LeaderboardCategory,
    limit: number = 10,
  ): Promise<LeaderboardEntry[]> {
    switch (category) {
      case "level":
        return this.byProgress("level", limit);
      case "credits":
        return this.byProgress("credits", limit);
      case "hacking":
        return this.byProgress("hacking", limit);
      case "networking":
        return this.byProgress("networking", limit);
      case "cryptography":
        return this.byProgress("cryptography", limit);
      case "stealth":
        return this.byProgress("stealth", limit);
      case "reputation":
        return this.byReputation(limit);
      case "achievements":
        return this.byAchievements(limit);
      case "missions":
        return this.byMissions(limit);
      default:
        return this.byProgress("level", limit);
    }
  }

  private async byProgress(
    field: string,
    limit: number,
  ): Promise<LeaderboardEntry[]> {
    const rows = await this.prisma.playerProgress.findMany({
      orderBy: { [field]: "desc" },
      take: limit,
      include: { user: { select: { username: true } } },
    });

    return rows.map((r: any, i: number) => ({
      rank: i + 1,
      userId: r.userId,
      username: r.user.username,
      value: r[field] as number,
    }));
  }

  private async byReputation(limit: number): Promise<LeaderboardEntry[]> {
    const rows = await this.prisma.factionMember.findMany({
      orderBy: { totalReputationEarned: "desc" },
      take: limit,
      include: {
        user: { select: { username: true } },
        faction: { select: { shortName: true } },
      },
    });

    return rows.map((r: any, i: number) => ({
      rank: i + 1,
      userId: r.userId,
      username: r.user.username,
      value: r.totalReputationEarned,
      detail: r.faction.shortName,
    }));
  }

  private async byAchievements(limit: number): Promise<LeaderboardEntry[]> {
    const rows = await this.prisma.playerProgress.findMany({
      orderBy: { level: "desc" }, // Secondary sort
      include: { user: { select: { username: true } } },
    });

    // Sort by achievement count (not a DB-sortable field since it's String[])
    const sorted = rows
      .map((r: any) => ({
        userId: r.userId,
        username: r.user.username,
        count: (r.achievements as string[])?.length || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    return sorted.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      username: r.username,
      value: r.count,
    }));
  }

  private async byMissions(limit: number): Promise<LeaderboardEntry[]> {
    const rows = await this.prisma.mission.groupBy({
      by: ["assignedTo"],
      where: { status: "completed", assignedTo: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: limit,
    });

    // Fetch usernames
    const userIds = rows.map((r) => r.assignedTo).filter(Boolean) as string[];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.username]));

    return rows.map((r, i) => ({
      rank: i + 1,
      userId: r.assignedTo || "",
      username: userMap.get(r.assignedTo || "") || "Unknown",
      value: r._count.id,
    }));
  }

  /** Get a player's rank in a specific category */
  async getPlayerRank(
    userId: string,
    category: LeaderboardCategory,
  ): Promise<number | null> {
    const board = await this.getLeaderboard(category, 100);
    const entry = board.find((e) => e.userId === userId);
    return entry?.rank ?? null;
  }
}

export default LeaderboardService;
