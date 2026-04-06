import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { Server as SocketIOServer } from "socket.io";
import { LOGGER } from "../di/tokens";

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  category: "combat" | "exploration" | "social" | "progression" | "faction" | "stealth" | "special";
  check: (ctx: AchievementContext) => boolean;
}

export interface AchievementContext {
  level: number;
  credits: number;
  hacking: number;
  networking: number;
  cryptography: number;
  stealth: number;
  socialEng: number;
  forensics: number;
  achievements: string[];
  missionsCompleted: number;
  hacksCompleted: number;
  factionRank?: string | undefined;
  factionReputation?: number | undefined;
}

/** All achievements in the game */
const ACHIEVEMENTS: AchievementDef[] = [
  // ── Progression ──
  { id: "first_steps", name: "First Steps", description: "Reach level 5", category: "progression", check: (c) => c.level >= 5 },
  { id: "getting_serious", name: "Getting Serious", description: "Reach level 15", category: "progression", check: (c) => c.level >= 15 },
  { id: "veteran", name: "Veteran", description: "Reach level 30", category: "progression", check: (c) => c.level >= 30 },
  { id: "elite_operator", name: "Elite Operator", description: "Reach level 50", category: "progression", check: (c) => c.level >= 50 },
  { id: "ghost_rank", name: "Ghost Rank", description: "Reach level 75", category: "progression", check: (c) => c.level >= 75 },

  // ── Combat / Hacking ──
  { id: "script_kiddie", name: "Script Kiddie", description: "Complete your first hack", category: "combat", check: (c) => c.hacksCompleted >= 1 },
  { id: "breacher", name: "Breacher", description: "Complete 10 hacks", category: "combat", check: (c) => c.hacksCompleted >= 10 },
  { id: "apex_predator", name: "Apex Predator", description: "Complete 50 hacks", category: "combat", check: (c) => c.hacksCompleted >= 50 },
  { id: "hacking_master", name: "Hacking Master", description: "Reach hacking skill 80", category: "combat", check: (c) => c.hacking >= 80 },

  // ── Stealth ──
  { id: "shadow", name: "Shadow", description: "Reach stealth skill 50", category: "stealth", check: (c) => c.stealth >= 50 },
  { id: "invisible", name: "Invisible", description: "Reach stealth skill 90", category: "stealth", check: (c) => c.stealth >= 90 },

  // ── Exploration ──
  { id: "network_mapper", name: "Network Mapper", description: "Reach networking skill 50", category: "exploration", check: (c) => c.networking >= 50 },
  { id: "cryptographer", name: "Cryptographer", description: "Reach cryptography skill 50", category: "exploration", check: (c) => c.cryptography >= 50 },
  { id: "forensic_analyst", name: "Forensic Analyst", description: "Reach forensics skill 50", category: "exploration", check: (c) => c.forensics >= 50 },

  // ── Missions ──
  { id: "first_mission", name: "First Mission", description: "Complete your first mission", category: "progression", check: (c) => c.missionsCompleted >= 1 },
  { id: "mission_runner", name: "Mission Runner", description: "Complete 10 missions", category: "progression", check: (c) => c.missionsCompleted >= 10 },
  { id: "operative", name: "Operative", description: "Complete 25 missions", category: "progression", check: (c) => c.missionsCompleted >= 25 },
  { id: "legend", name: "Legend", description: "Complete 100 missions", category: "progression", check: (c) => c.missionsCompleted >= 100 },

  // ── Wealth ──
  { id: "pocket_change", name: "Pocket Change", description: "Accumulate 10,000 credits", category: "progression", check: (c) => c.credits >= 10000 },
  { id: "wealthy", name: "Wealthy", description: "Accumulate 100,000 credits", category: "progression", check: (c) => c.credits >= 100000 },
  { id: "tycoon", name: "Tycoon", description: "Accumulate 1,000,000 credits", category: "progression", check: (c) => c.credits >= 1000000 },

  // ── Faction ──
  { id: "faction_recruit", name: "Faction Recruit", description: "Join a faction", category: "faction", check: (c) => !!c.factionRank },
  { id: "faction_elite", name: "Faction Elite", description: "Reach elite rank in a faction", category: "faction", check: (c) => c.factionRank === "elite" || c.factionRank === "council_member" },
  { id: "council_member", name: "Council Member", description: "Reach council member rank", category: "faction", check: (c) => c.factionRank === "council_member" },
  { id: "faction_hero", name: "Faction Hero", description: "Earn 500 total faction reputation", category: "faction", check: (c) => (c.factionReputation || 0) >= 500 },

  // ── Social ──
  { id: "social_engineer", name: "Social Engineer", description: "Reach social engineering skill 50", category: "social", check: (c) => c.socialEng >= 50 },

  // ── Special ──
  { id: "jack_of_all", name: "Jack of All Trades", description: "All skills at 30+", category: "special",
    check: (c) => c.hacking >= 30 && c.networking >= 30 && c.cryptography >= 30 && c.stealth >= 30 && c.socialEng >= 30 && c.forensics >= 30 },
  { id: "polymath", name: "Polymath", description: "All skills at 60+", category: "special",
    check: (c) => c.hacking >= 60 && c.networking >= 60 && c.cryptography >= 60 && c.stealth >= 60 && c.socialEng >= 60 && c.forensics >= 60 },
];

@injectable()
export class AchievementService {
  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject("SocketIO") private io: SocketIOServer,
  ) {}

  /** Check and award any new achievements for a player. Returns newly awarded IDs. */
  async checkAndAward(userId: string): Promise<string[]> {
    const ctx = await this.buildContext(userId);
    if (!ctx) return [];

    const newAchievements: string[] = [];

    for (const def of ACHIEVEMENTS) {
      if (ctx.achievements.includes(def.id)) continue;
      if (def.check(ctx)) {
        newAchievements.push(def.id);
      }
    }

    if (newAchievements.length === 0) return [];

    // Award achievements
    const updated = [...ctx.achievements, ...newAchievements];
    await this.prisma.playerProgress.update({
      where: { userId },
      data: { achievements: updated },
    });

    // Notify player
    for (const achId of newAchievements) {
      const def = ACHIEVEMENTS.find((a) => a.id === achId);
      if (def) {
        this.io.to(`player:${userId}`).emit("achievement:unlocked", {
          id: def.id,
          name: def.name,
          description: def.description,
          category: def.category,
        });
        this.logger.info({ userId, achievement: def.id }, "Achievement unlocked");
      }
    }

    return newAchievements;
  }

  /** Get all achievements with unlock status for a player */
  async getPlayerAchievements(userId: string): Promise<{ def: AchievementDef; unlocked: boolean }[]> {
    const progress = await this.prisma.playerProgress.findUnique({
      where: { userId },
      select: { achievements: true },
    });
    const unlocked = new Set(progress?.achievements || []);

    return ACHIEVEMENTS.map((def) => ({
      def,
      unlocked: unlocked.has(def.id),
    }));
  }

  /** Get all achievement definitions */
  getDefinitions(): AchievementDef[] {
    return ACHIEVEMENTS;
  }

  private async buildContext(userId: string): Promise<AchievementContext | null> {
    const progress = await this.prisma.playerProgress.findUnique({
      where: { userId },
    });
    if (!progress) return null;

    const missionsCompleted = await this.prisma.mission.count({
      where: { assignedTo: userId, status: "completed" },
    });

    const hacksCompleted = await this.prisma.hackLog.count({
      where: { attackerId: userId, success: true },
    });

    const factionMember = await this.prisma.factionMember.findFirst({
      where: { userId },
      orderBy: { reputation: "desc" },
    });

    return {
      level: progress.level,
      credits: progress.credits,
      hacking: progress.hacking,
      networking: progress.networking,
      cryptography: progress.cryptography,
      stealth: progress.stealth,
      socialEng: progress.socialEng,
      forensics: progress.forensics,
      achievements: progress.achievements,
      missionsCompleted,
      hacksCompleted,
      factionRank: factionMember?.rank,
      factionReputation: factionMember?.totalReputationEarned || 0,
    };
  }
}

export default AchievementService;
