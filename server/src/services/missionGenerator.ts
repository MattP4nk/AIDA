import { injectable, inject } from "tsyringe";
import { MISSION_SERVICE, PERSONA_SERVICE, AI_SERVICE } from "../di/tokens";
import MissionService from "./missionService";
import { PersonaService } from "./personaService";
import { AIService } from "./aiService";
import { db } from "../database/client";
import { CronJob } from "cron";

/**
 * MissionGenerator Service
 *
 * Generates missions dynamically based on:
 * - Player level and progression
 * - Faction affiliations
 * - Story progression
 * - AI-generated narrative content
 *
 * Uses hybrid approach:
 * - 90% Template-based (fast, balanced)
 * - 10% AI-generated (narrative, special)
 */

interface MissionTemplate {
  id: string;
  type: "hack" | "steal" | "social" | "explore" | "mixed";
  minLevel: number;
  maxLevel: number;
  difficulty: number;
  titleTemplates: string[];
  descriptionTemplates: string[];
  objectives: ObjectiveTemplate[];
  rewards: RewardTemplate;
  tags?: string[];
}

interface ObjectiveTemplate {
  type: string;
  description: string;
  target: number | string | boolean;
  metadata?: Record<string, any>;
}

interface RewardTemplate {
  xp: { min: number; max: number };
  credits: { min: number; max: number };
  reputation?: number;
  items?: string[];
}

interface GeneratedMission {
  title: string;
  description: string;
  type: string;
  difficulty: number;
  objectives: any[];
  reward: any;
  timeLimit?: number;
  factionId?: string;
  issuedBy?: string;
}

@injectable()
export class MissionGeneratorService {
  private templates: MissionTemplate[] = [];
  private generationStats = {
    totalGenerated: 0,
    templateBased: 0,
    aiGenerated: 0,
    lastReset: new Date(),
  };
  private midnightJob: CronJob | null = null;

  constructor(
    @inject(MISSION_SERVICE) private missionService: MissionService,
    @inject(PERSONA_SERVICE) private personaService: PersonaService,
    @inject(AI_SERVICE) private aiService: AIService,
  ) {
    this.initializeTemplates();
    this.startMidnightScheduler();
  }

  // ==================== INITIALIZATION ====================

  /**
   * Initialize mission templates
   */
  private initializeTemplates(): void {
    this.templates = [
      // Beginner Hack Missions
      {
        id: "hack_basic_1",
        type: "hack",
        minLevel: 1,
        maxLevel: 10,
        difficulty: 1,
        titleTemplates: [
          "First Steps: Hack {count} Servers",
          "Network Intrusion Training",
          "Breaking In: {count} Systems",
        ],
        descriptionTemplates: [
          "Every hacker starts somewhere. Gain access to {count} different servers to prove your skills.",
          "Time to test your abilities. Successfully hack into {count} servers and report back.",
          "The underground needs new talent. Show us what you can do by hacking {count} systems.",
        ],
        objectives: [
          {
            type: "hack",
            description: "Successfully hack into {count} servers",
            target: 3,
          },
        ],
        rewards: {
          xp: { min: 100, max: 200 },
          credits: { min: 500, max: 1000 },
          reputation: 5,
        },
        tags: ["beginner", "training"],
      },

      // Stealth Missions
      {
        id: "hack_stealth_1",
        type: "hack",
        minLevel: 5,
        maxLevel: 20,
        difficulty: 3,
        titleTemplates: [
          "Ghost Protocol: Undetected Intrusion",
          "Shadow Ops: Silent Hack",
          "The Invisible Threat",
        ],
        descriptionTemplates: [
          "Stealth is key. Hack {count} servers without triggering any alarms or leaving traces.",
          "A true professional leaves no evidence. Complete {count} undetected hacks.",
          "They'll never know you were there. Infiltrate {count} systems silently.",
        ],
        objectives: [
          {
            type: "hack_stealth",
            description: "Hack {count} servers without being detected",
            target: 3,
          },
        ],
        rewards: {
          xp: { min: 300, max: 500 },
          credits: { min: 2000, max: 3500 },
          reputation: 15,
        },
        tags: ["stealth", "advanced"],
      },

      // Data Theft Missions
      {
        id: "steal_files_1",
        type: "steal",
        minLevel: 3,
        maxLevel: 15,
        difficulty: 2,
        titleTemplates: [
          "Data Extraction: {target} Files",
          "Corporate Espionage",
          "Information Acquisition",
        ],
        descriptionTemplates: [
          "A client needs data. Download {target} files from corporate servers.",
          "Steal {target} files from secured systems. Payment on delivery.",
          "Industrial espionage pays well. Acquire {target} files and return them safely.",
        ],
        objectives: [
          {
            type: "steal_count",
            description: "Download {target} files from any servers",
            target: 5,
          },
        ],
        rewards: {
          xp: { min: 200, max: 400 },
          credits: { min: 1500, max: 2500 },
          reputation: 10,
        },
        tags: ["theft", "corporate"],
      },

      // Cover Your Tracks
      {
        id: "delete_evidence_1",
        type: "hack",
        minLevel: 10,
        maxLevel: 30,
        difficulty: 4,
        titleTemplates: [
          "Clean Sweep: Evidence Removal",
          "Erase the Past",
          "No Witnesses",
        ],
        descriptionTemplates: [
          "Someone left evidence behind. Break in and delete the incriminating files.",
          "Clean up operation required. Remove all traces from the target system.",
          "A job went sideways. Delete the evidence before they connect the dots.",
        ],
        objectives: [
          {
            type: "hack",
            description: "Gain access to the target server",
            target: 1,
          },
          {
            type: "delete_file",
            description: "Delete the evidence file",
            target: "evidence.log",
            metadata: { filePattern: "evidence" },
          },
        ],
        rewards: {
          xp: { min: 400, max: 700 },
          credits: { min: 3000, max: 5000 },
          reputation: 20,
        },
        tags: ["cleanup", "urgent"],
      },

      // Social Engineering
      {
        id: "social_contact_1",
        type: "social",
        minLevel: 5,
        maxLevel: 25,
        difficulty: 2,
        titleTemplates: [
          "Establish Contact: {target}",
          "Network Building",
          "Making Connections",
        ],
        descriptionTemplates: [
          "Reach out to {target}. They have information we need.",
          "Open a secure channel with {target}. Be professional.",
          "We need someone on the inside. Make contact with {target}.",
        ],
        objectives: [
          {
            type: "contact_player",
            description: "Send a message to {target}",
            target: "npc_contact",
            metadata: { requiresResponse: false },
          },
        ],
        rewards: {
          xp: { min: 150, max: 300 },
          credits: { min: 1000, max: 2000 },
          reputation: 8,
        },
        tags: ["social", "network"],
      },

      // Exploration
      {
        id: "explore_network_1",
        type: "explore",
        minLevel: 1,
        maxLevel: 15,
        difficulty: 1,
        titleTemplates: [
          "Network Mapping: Discover {count} Servers",
          "Digital Exploration",
          "Expanding the Map",
        ],
        descriptionTemplates: [
          "The network is vast. Discover {count} new servers and map the terrain.",
          "Knowledge is power. Find and document {count} previously unknown servers.",
          "Expand your network. Locate {count} new systems.",
        ],
        objectives: [
          {
            type: "explore",
            description: "Discover {count} new servers",
            target: 5,
          },
        ],
        rewards: {
          xp: { min: 100, max: 250 },
          credits: { min: 500, max: 1500 },
          reputation: 5,
        },
        tags: ["exploration", "mapping"],
      },

      // Forum Intelligence
      {
        id: "forum_post_1",
        type: "social",
        minLevel: 8,
        maxLevel: 20,
        difficulty: 2,
        titleTemplates: [
          "Spread the Word",
          "Information Warfare",
          "Public Disclosure",
        ],
        descriptionTemplates: [
          "Post about your findings on a darkweb forum. The public deserves to know.",
          "Share intelligence on underground forums. Stir up the community.",
          "Make some noise. Post about the breach and watch the chaos unfold.",
        ],
        objectives: [
          {
            type: "forum_post",
            description: "Post on any darkweb forum",
            target: 1,
          },
        ],
        rewards: {
          xp: { min: 200, max: 350 },
          credits: { min: 1000, max: 2000 },
          reputation: 12,
        },
        tags: ["forum", "intelligence"],
      },

      // Skill Development
      {
        id: "skill_progression_1",
        type: "mixed",
        minLevel: 5,
        maxLevel: 50,
        difficulty: 3,
        titleTemplates: [
          "Skill Enhancement: Reach Level {level}",
          "Training Regiment",
          "Leveling Up",
        ],
        descriptionTemplates: [
          "Practice makes perfect. Reach hacking level {level} through experience.",
          "Your skills need work. Gain enough XP to reach level {level}.",
          "The underground rewards competence. Prove yourself by reaching level {level}.",
        ],
        objectives: [
          {
            type: "gain_xp",
            description: "Gain {xp} experience points",
            target: 1000,
          },
        ],
        rewards: {
          xp: { min: 500, max: 1000 },
          credits: { min: 2000, max: 4000 },
          reputation: 15,
        },
        tags: ["progression", "training"],
      },

      // Economic
      {
        id: "earn_credits_1",
        type: "mixed",
        minLevel: 1,
        maxLevel: 20,
        difficulty: 2,
        titleTemplates: [
          "Money Talks: Earn {amount} Credits",
          "Economic Opportunity",
          "Building Capital",
        ],
        descriptionTemplates: [
          "You need resources. Earn {amount} credits through any means necessary.",
          "Cash is king in this world. Accumulate {amount} credits.",
          "Fund your operations. Generate {amount} credits through hacking and trading.",
        ],
        objectives: [
          {
            type: "earn_credits",
            description: "Earn {amount} credits",
            target: 5000,
          },
        ],
        rewards: {
          xp: { min: 300, max: 500 },
          credits: { min: 2000, max: 3000 },
          reputation: 10,
        },
        tags: ["economic", "grind"],
      },

      // Advanced Multi-Objective
      {
        id: "complex_operation_1",
        type: "mixed",
        minLevel: 15,
        maxLevel: 50,
        difficulty: 5,
        titleTemplates: [
          "Operation {codename}",
          "Complex Infiltration",
          "Multi-Stage Attack",
        ],
        descriptionTemplates: [
          "This is a complex operation. Hack the target, steal the data, and cover your tracks.",
          "High-value target requires precision. Infiltrate, extract, and eliminate evidence.",
          "Multi-phase mission: breach security, acquire files, delete logs, escape undetected.",
        ],
        objectives: [
          {
            type: "hack",
            description: "Hack into the target server",
            target: 1,
          },
          {
            type: "steal_count",
            description: "Download 3 classified files",
            target: 3,
          },
          {
            type: "delete_file",
            description: "Delete access logs",
            target: "access.log",
          },
        ],
        rewards: {
          xp: { min: 800, max: 1500 },
          credits: { min: 5000, max: 10000 },
          reputation: 30,
          items: ["advanced_toolkit"],
        },
        tags: ["complex", "high-value", "multi-stage"],
      },
    ];
  }

  // ==================== MISSION GENERATION ====================

  /**
   * Generate missions for a player
   */
  public async generateMissionsForPlayer(
    userId: string,
    count: number = 5,
  ): Promise<string[]> {
    try {
      // Get player progress
      const progress = await db.client.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      const playerLevel = this.calculateLevel(progress.experience);
      const missionIds: string[] = [];

      // Determine AI mission count (10% of missions)
      const aiMissionCount = Math.floor(count * 0.1);
      const templateMissionCount = count - aiMissionCount;

      // Generate template-based missions
      for (let i = 0; i < templateMissionCount; i++) {
        const template = this.selectTemplate(playerLevel);
        if (template) {
          const mission = this.generateFromTemplate(template, progress);
          const missionId = await this.createMission(mission, userId);
          if (missionId) {
            missionIds.push(missionId);
            this.generationStats.templateBased++;
          }
        }
      }

      // Generate AI missions (if enabled and available)
      if (aiMissionCount > 0) {
        try {
          const aiMission = await this.generateAIMission(userId, playerLevel);
          if (aiMission) {
            const missionId = await this.createMission(aiMission, userId);
            if (missionId) {
              missionIds.push(missionId);
              this.generationStats.aiGenerated++;
            }
          }
        } catch (error) {
          // AI generation failed, generate template instead
          const template = this.selectTemplate(playerLevel);
          if (template) {
            const mission = this.generateFromTemplate(template, progress);
            const missionId = await this.createMission(mission, userId);
            if (missionId) {
              missionIds.push(missionId);
              this.generationStats.templateBased++;
            }
          }
        }
      }

      this.generationStats.totalGenerated += missionIds.length;
      return missionIds;
    } catch (error) {
      console.error("[MissionGenerator] Error generating missions:", error);
      return [];
    }
  }

  /**
   * Select appropriate template based on player level
   */
  private selectTemplate(playerLevel: number): MissionTemplate | null {
    // Filter templates by level
    // Fallback to any template
    const eligible = this.templates.filter(
      (t) => playerLevel >= t.minLevel && playerLevel <= t.maxLevel,
    );

    if (eligible.length === 0) {
      // Fallback to any template
      return (
        this.templates[Math.floor(Math.random() * this.templates.length)] ||
        null
      );
    }

    // Weighted random selection (prefer appropriate difficulty)
    const weights = eligible.map((t) => {
      const levelDiff = Math.abs(playerLevel - (t.minLevel + t.maxLevel) / 2);
      return Math.max(1, 10 - levelDiff);
    });

    const totalWeight = weights.reduce((sum, w) => sum + w, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < eligible.length; i++) {
      const weight = weights[i];
      if (weight === undefined) continue;
      random -= weight;
      if (random <= 0) {
        return eligible[i] ?? null;
      }
    }

    return eligible[0] ?? null;
  }

  /**
   * Generate mission from template
   */
  private generateFromTemplate(
    template: MissionTemplate,
    progress: any,
  ): GeneratedMission {
    // Select random title and description
    const title =
      template.titleTemplates[
        Math.floor(Math.random() * template.titleTemplates.length)
      ] || "Mission";
    const description =
      template.descriptionTemplates[
        Math.floor(Math.random() * template.descriptionTemplates.length)
      ] || "Complete the mission objectives.";

    // Generate objectives with unique IDs
    const objectives = template.objectives.map((obj) => ({
      id: `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: obj.type,
      description: this.interpolateString(obj.description, {
        count: obj.target,
        target: obj.target,
        level: this.calculateLevel(progress.experience) + 5,
        xp: 1000,
        amount: 5000,
      }),
      target: obj.target,
      current:
        typeof obj.target === "number"
          ? 0
          : typeof obj.target === "boolean"
            ? false
            : "",
      completed: false,
      metadata: obj.metadata,
    }));

    // Calculate rewards based on difficulty and player level
    const xpReward =
      Math.floor(
        Math.random() * (template.rewards.xp.max - template.rewards.xp.min),
      ) + template.rewards.xp.min;
    const creditsReward =
      Math.floor(
        Math.random() *
          (template.rewards.credits.max - template.rewards.credits.min),
      ) + template.rewards.credits.min;

    // Calculate time limit (1 hour per difficulty level)
    const timeLimit = template.difficulty * 60 * 60 * 1000;

    return {
      title: this.interpolateString(title, {
        count: objectives[0]?.target || 3,
        target: "Agent_X",
        codename: this.generateCodename(),
        level: this.calculateLevel(progress.experience) + 5,
        amount: 5000,
      }),
      description: this.interpolateString(description, {
        count: objectives[0]?.target || 3,
        target: objectives[0]?.target || 3,
        level: this.calculateLevel(progress.experience) + 5,
        xp: 1000,
        amount: 5000,
      }),
      type: template.type,
      difficulty: template.difficulty,
      objectives,
      reward: {
        xp: xpReward,
        credits: creditsReward,
        reputation: template.rewards.reputation,
        items: template.rewards.items || [],
      },
      timeLimit,
    };
  }

  /**
   * Generate AI-powered mission
   */
  private async generateAIMission(
    _userId: string,
    playerLevel: number,
  ): Promise<GeneratedMission | null> {
    try {
      // Get Game Master persona
      const gameMaster =
        await this.personaService.getPersonaByType("game_master");
      if (!gameMaster) {
        return null;
      }

      // Generate mission using AI
      const prompt = `Create a unique hacking mission for a player at level ${playerLevel}.

Mission should include:
- Engaging narrative-driven title
- Detailed backstory (2-3 sentences)
- Mission type (hack/steal/social/explore/mixed)
- 1-3 objectives with clear goals
- Appropriate rewards for level ${playerLevel}

Format as JSON:
{
  "title": "...",
  "description": "...",
  "type": "hack",
  "objectives": [
    {"type": "hack", "description": "...", "target": 3}
  ]
}`;

      const response = await this.aiService.generateResponse(
        prompt,
        gameMaster.systemPrompt,
      );

      // Parse AI response
      const jsonMatch = response.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const aiMission = JSON.parse(jsonMatch[0]);

      // Enhance with calculated values
      const difficulty = Math.min(10, Math.max(1, Math.floor(playerLevel / 5)));
      const objectives = aiMission.objectives.map((obj: any) => ({
        id: `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: obj.type,
        description: obj.description,
        target: obj.target,
        current:
          typeof obj.target === "number"
            ? 0
            : typeof obj.target === "boolean"
              ? false
              : "",
        completed: false,
      }));

      return {
        title: aiMission.title,
        description: aiMission.description,
        type: aiMission.type || "mixed",
        difficulty,
        objectives,
        reward: {
          xp: difficulty * 200 + playerLevel * 50,
          credits: difficulty * 1000 + playerLevel * 200,
          reputation: difficulty * 5,
        },
        timeLimit: difficulty * 60 * 60 * 1000,
        issuedBy: gameMaster.id,
      };
    } catch (error) {
      console.error("[MissionGenerator] AI generation failed:", error);
      return null;
    }
  }

  /**
   * Create mission in database
   */
  private async createMission(
    mission: GeneratedMission,
    createdBy: string,
  ): Promise<string | null> {
    try {
      const missionData: any = {
        title: mission.title,
        description: mission.description,
        type: mission.type,
        difficulty: mission.difficulty,
        reward: mission.reward,
        objectives: mission.objectives,
        createdBy,
      };

      // Only add optional fields if they exist
      if (mission.factionId) {
        missionData.factionId = mission.factionId;
      }
      if (mission.issuedBy) {
        missionData.issuedBy = mission.issuedBy;
      }
      if (mission.timeLimit) {
        missionData.timeLimit = mission.timeLimit;
      }

      const result = await this.missionService.createMission(missionData);

      return typeof result === "string" ? result : null;
    } catch (error) {
      console.error("[MissionGenerator] Failed to create mission:", error);
      return null;
    }
  }

  // ==================== SCHEDULED GENERATION ====================

  /**
   * Start midnight scheduler for daily mission generation
   */
  private startMidnightScheduler(): void {
    // Run at midnight every day (00:00:00)
    this.midnightJob = new CronJob(
      "0 0 * * *",
      async () => {
        await this.generateDailyMissions();
      },
      null,
      true,
      "UTC",
    );
  }

  /**
   * Stop the midnight scheduler
   */
  public stopMidnightScheduler(): void {
    if (this.midnightJob) {
      this.midnightJob.stop();
      this.midnightJob = null;
    }
  }

  /**
   * Generate daily missions for all active players
   */
  public async generateDailyMissions(): Promise<void> {
    try {
      // Get all active players (logged in within last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const activePlayers = await db.client.user.findMany({
        where: {
          lastLogin: {
            gte: sevenDaysAgo,
          },
        },
        select: { id: true },
      });

      let generated = 0;
      for (const player of activePlayers) {
        const missions = await this.generateMissionsForPlayer(player.id, 3);
        generated += missions.length;
      }

      console.log(
        `[MissionGenerator] Generated ${generated} daily missions for ${activePlayers.length} players`,
      );
    } catch (error) {
      console.error("[MissionGenerator] Daily generation failed:", error);
    }
  }

  /**
   * Clean up expired missions
   */
  public async cleanupExpiredMissions(): Promise<void> {
    try {
      const result = await db.client.mission.deleteMany({
        where: {
          expiresAt: {
            lt: new Date(),
          },
          status: "available",
        },
      });

      console.log(
        `[MissionGenerator] Cleaned up ${result.count} expired missions`,
      );
    } catch (error) {
      console.error("[MissionGenerator] Cleanup failed:", error);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Calculate player level from XP
   */
  private calculateLevel(xp: number): number {
    return Math.floor(Math.sqrt(xp / 100));
  }

  /**
   * Interpolate template strings
   */
  private interpolateString(
    template: string,
    values: Record<string, any>,
  ): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      return values[key] !== undefined ? values[key].toString() : match;
    });
  }

  /**
   * Generate random codename
   */
  private generateCodename(): string {
    const adjectives = [
      "Shadow",
      "Silent",
      "Dark",
      "Ghost",
      "Phantom",
      "Raven",
      "Viper",
      "Crimson",
      "Azure",
      "Obsidian",
    ];
    const nouns = [
      "Wolf",
      "Hawk",
      "Dragon",
      "Phoenix",
      "Cobra",
      "Tiger",
      "Eagle",
      "Panther",
      "Serpent",
      "Falcon",
    ];

    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];

    return `${adj} ${noun}`;
  }

  /**
   * Get generation statistics
   */
  public getStats() {
    return {
      ...this.generationStats,
      templatesAvailable: this.templates.length,
      aiSuccessRate:
        this.generationStats.aiGenerated /
        Math.max(1, this.generationStats.totalGenerated),
    };
  }
}

export default MissionGeneratorService;
