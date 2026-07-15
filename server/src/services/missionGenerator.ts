import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import {
  LOGGER,
  MISSION_SERVICE,
  PERSONA_SERVICE,
  AI_SERVICE,
  SERVER_CONTENT_SERVICE,
} from "../di/tokens";
import MissionService from "./missionService";
import { PersonaService } from "./personaService";
import { AIService } from "./aiService";
import type { ServerContentService } from "./serverContentService";
import { db } from "../database/client";
import { CronJob } from "cron";
import {
  MissionTemplate,
  getEligibleTemplates,
  selectWeightedTemplate,
  MISSION_TEMPLATES,
} from "./missionTemplatePool";
import { validateObjective, OBJECTIVE_TYPES } from "./missionObjectiveTypes";

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
  tier?: number;
  targetServerId?: string;
}

@injectable()
export class MissionGeneratorService {
  private generationStats = {
    totalGenerated: 0,
    templateBased: 0,
    aiGenerated: 0,
    lastReset: new Date(),
  };
  private midnightJob: CronJob | null = null;

  private serverContent: ServerContentService | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_SERVICE) private missionService: MissionService,
    @inject(PERSONA_SERVICE) private personaService: PersonaService,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(SERVER_CONTENT_SERVICE)
    serverContentService?: ServerContentService,
  ) {
    this.serverContent = serverContentService || null;
    this.startMidnightScheduler();
  }

  // ==================== TEMPLATE ACCESS ====================

  private get templates(): MissionTemplate[] {
    return Array.from(MISSION_TEMPLATES.values());
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

      // Track used template IDs for deduplication within this batch
      const usedTemplateIds = new Set<string>();

      // Determine AI mission count (10% of missions)
      const aiMissionCount = Math.floor(count * 0.1);
      const templateMissionCount = count - aiMissionCount;

      // Generate template-based missions
      for (let i = 0; i < templateMissionCount; i++) {
        const template = this.selectTemplate(
          playerLevel,
          undefined,
          usedTemplateIds,
        );
        if (template) {
          usedTemplateIds.add(template.id);
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
          const template = this.selectTemplate(
            playerLevel,
            undefined,
            usedTemplateIds,
          );
          if (template) {
            usedTemplateIds.add(template.id);
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

      // Add generated missions to the player's missionProgress as "available"
      // so they appear in getPlayerMissions() results
      if (missionIds.length > 0) {
        try {
          const missions = await db.client.mission.findMany({
            where: { id: { in: missionIds } },
          });

          const missionProgress =
            (progress.missionProgress as Record<string, any>) || {};

          for (const mission of missions) {
            const objectives = (mission.objectives as unknown as any[]) || [];

            missionProgress[mission.id] = {
              missionId: mission.id,
              userId,
              status: "available",
              objectives: objectives.map((obj: any) => ({
                ...obj,
                current:
                  typeof obj.target === "number"
                    ? 0
                    : typeof obj.target === "boolean"
                      ? false
                      : "",
                completed: false,
              })),
              startedAt: null,
              completedAt: null,
              expiresAt: mission.timeLimit
                ? new Date(Date.now() + (mission.timeLimit as number) * 1000)
                : null,
            };
          }

          await db.client.playerProgress.update({
            where: { userId },
            data: {
              missionProgress: missionProgress as any,
            },
          });

          this.logger.info(
            { userId, count: missionIds.length },
            "Generated missions added to player missionProgress",
          );
        } catch (progressError) {
          this.logger.error(
            { err: progressError, userId },
            "Failed to update missionProgress with generated missions",
          );
        }
      }

      return missionIds;
    } catch (error) {
      this.logger.error({ err: error }, "Error generating missions");
      return [];
    }
  }

  /**
   * Select appropriate template based on player level
   */
  private selectTemplate(
    playerLevel: number,
    missionType?: string,
    excludeIds?: Set<string>,
  ): MissionTemplate | null {
    let eligible = getEligibleTemplates(playerLevel);

    // Exclude already-used template IDs in this batch
    if (excludeIds && excludeIds.size > 0) {
      eligible = eligible.filter((t) => !excludeIds.has(t.id));
    }

    // Filter by type if specified
    if (missionType) {
      const typed = eligible.filter((t) => t.type === missionType);
      if (typed.length > 0) eligible = typed;
    }

    if (eligible.length === 0) return null;
    return selectWeightedTemplate(eligible, playerLevel) ?? null;
  }

  /**
   * Generate mission from template
   */
  private generateFromTemplate(
    template: MissionTemplate,
    progress: any,
  ): GeneratedMission {
    const playerLevel = this.calculateLevel(progress.experience);

    // Select random title and description
    const title =
      template.titleTemplates[
        Math.floor(Math.random() * template.titleTemplates.length)
      ] || "Mission";
    const description =
      template.descriptionTemplates[
        Math.floor(Math.random() * template.descriptionTemplates.length)
      ] || "Complete the mission objectives.";

    // Pick a difficulty value from the template's range
    const difficulty =
      Math.floor(
        Math.random() * (template.difficulty.max - template.difficulty.min + 1),
      ) + template.difficulty.min;

    // Generate objectives with unique IDs
    const objectives = template.objectives.map((obj) => {
      const descriptionText = obj.descriptionTemplate || "";

      const built = {
        id: `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: obj.type,
        description: this.interpolateString(descriptionText, {
          count: obj.target,
          target: obj.target,
          level: playerLevel + 5,
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
      };

      // Validate objective against canonical types
      const validation = validateObjective({
        type: built.type,
        target: built.target,
        ...(built.metadata !== undefined && { metadata: built.metadata }),
      });

      if (!validation.valid) {
        this.logger.warn(
          {
            templateId: template.id,
            objectiveType: built.type,
            errors: validation.errors,
          },
          "Objective validation warning in template-based generation",
        );
      }

      return built;
    });

    // Calculate rewards using RewardScaling: base + perLevel * playerLevel
    const xpReward = Math.floor(
      template.rewards.xp.base + template.rewards.xp.perLevel * playerLevel,
    );
    const creditsReward = Math.floor(
      template.rewards.credits.base +
        template.rewards.credits.perLevel * playerLevel,
    );

    // Calculate time limit: random between min and max (seconds), convert to ms
    const timeLimitSeconds =
      Math.floor(
        Math.random() * (template.timeLimit.max - template.timeLimit.min + 1),
      ) + template.timeLimit.min;
    const timeLimit = timeLimitSeconds * 1000;

    return {
      title: this.interpolateString(title, {
        count: objectives[0]?.target || 3,
        target: "Agent_X",
        codename: this.generateCodename(),
        level: playerLevel + 5,
        amount: 5000,
      }),
      description: this.interpolateString(description, {
        count: objectives[0]?.target || 3,
        target: objectives[0]?.target || 3,
        level: playerLevel + 5,
        xp: 1000,
        amount: 5000,
      }),
      type: template.type,
      difficulty,
      objectives,
      reward: {
        xp: xpReward,
        credits: creditsReward,
        reputation: template.rewards.reputation,
        items: template.rewards.items || [],
      },
      timeLimit,
      tier: template.tier,
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

      // Build canonical objective type list for the prompt
      const canonicalTypes = [...OBJECTIVE_TYPES.keys()].join(", ");

      // Generate mission using AI
      const prompt = `Create a unique hacking mission for a player at level ${playerLevel}.

Mission should include:
- Engaging narrative-driven title
- Detailed backstory (2-3 sentences)
- Mission type (hack/steal/social/explore/mixed)
- 1-3 objectives with clear goals

IMPORTANT: Objective types MUST be one of these canonical types:
${canonicalTypes}

Appropriate rewards for level ${playerLevel}.

Format as JSON:
{
  "title": "...",
  "description": "...",
  "type": "hack",
  "objectives": [
    {"type": "hack", "description": "...", "target": 3}
  ]
}`;

      const result = await this.aiService.generateResponse(
        prompt,
        gameMaster.systemPrompt,
        undefined,
        '{ "title": "string (3-80 chars)", "description": "string", "difficulty": "number (1-10)", "type": "hack|steal|explore|social", "objectives": [{"type": "string", "description": "string", "target": "number"}] }',
      );

      if (!result.success) {
        this.logger.warn({ error: result.error }, "AI mission generation failed");

        // Queue for retry — when AI comes back, create the AI mission
        const aiSvc = this.aiService;
        const missionSvc = this.missionService;
        const gmId = gameMaster.id;
        const gmSystemPrompt = gameMaster.systemPrompt;
        const pLevel = playerLevel;
        aiSvc.queueForRetry(prompt, gmSystemPrompt, async (response) => {
          try {
            const m = response.match(/\{[\s\S]*\}/);
            if (!m) return;
            const aiMission = JSON.parse(m[0]);
            if (!aiMission.title || !aiMission.objectives) return;

            const difficulty = Math.min(10, Math.max(1, Math.floor(pLevel / 5)));
            const objectives = (aiMission.objectives || []).map((obj: any) => ({
              id: `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              type: obj.type || "hack",
              description: obj.description || "Complete the objective",
              target: obj.target || 1,
              current: typeof obj.target === "number" ? 0 : false,
              completed: false,
            }));

            if (objectives.length === 0) return;

            await missionSvc.createMission({
              title: aiMission.title,
              description: aiMission.description || "Complete the mission.",
              type: aiMission.type || "mixed",
              difficulty,
              objectives,
              reward: {
                xp: Math.floor(100 + 50 * pLevel),
                credits: Math.floor(500 + 200 * pLevel),
                reputation: difficulty * 5,
              },
              issuedBy: gmId,
              createdBy: gmId,
            });
          } catch { /* ignore retry errors */ }
        });

        return null;
      }

      // Parse AI response
      const jsonMatch = result.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return null;
      }

      const aiMission = JSON.parse(jsonMatch[0]);

      // Enhance with calculated values
      const difficulty = Math.min(10, Math.max(1, Math.floor(playerLevel / 5)));

      // Validate and filter AI-generated objectives
      const rawObjectives: any[] = aiMission.objectives || [];
      const objectives = rawObjectives
        .map((obj: any) => {
          let objectiveType: string = obj.type;

          // If the AI-generated type is not canonical, try to map it
          if (!OBJECTIVE_TYPES.has(objectiveType)) {
            const mapped = this.mapToCanonicalType(objectiveType);
            if (mapped) {
              this.logger.warn(
                { original: objectiveType, mapped },
                "Mapped non-canonical AI objective type to canonical type",
              );
              objectiveType = mapped;
            } else {
              this.logger.warn(
                { type: objectiveType },
                "Dropping AI-generated objective with unknown type",
              );
              return null;
            }
          }

          const built = {
            id: `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: objectiveType,
            description: obj.description,
            target: obj.target,
            current:
              typeof obj.target === "number"
                ? 0
                : typeof obj.target === "boolean"
                  ? false
                  : "",
            completed: false,
          };

          // Validate the objective
          const validation = validateObjective({
            type: built.type,
            target: built.target,
            metadata: obj.metadata,
          });

          if (!validation.valid) {
            this.logger.warn(
              { type: built.type, errors: validation.errors },
              "AI-generated objective validation warning",
            );
          }

          return built;
        })
        .filter((obj: any): obj is NonNullable<typeof obj> => obj !== null);

      // If all objectives were dropped, bail out
      if (objectives.length === 0) {
        this.logger.warn(
          "All AI-generated objectives were invalid, aborting mission",
        );
        return null;
      }

      // Use same RewardScaling calculation pattern as templates
      const xpReward = Math.floor(100 + 50 * playerLevel);
      const creditsReward = Math.floor(500 + 200 * playerLevel);

      return {
        title: aiMission.title,
        description: aiMission.description,
        type: aiMission.type || "mixed",
        difficulty,
        objectives,
        reward: {
          xp: xpReward,
          credits: creditsReward,
          reputation: difficulty * 5,
        },
        timeLimit: difficulty * 60 * 60 * 1000,
        issuedBy: gameMaster.id,
      };
    } catch (error) {
      this.logger.error({ err: error }, "AI generation failed");
      return null;
    }
  }

  /**
   * Attempt to map a non-canonical objective type to the closest canonical type.
   * Returns null if no reasonable mapping exists.
   */
  private mapToCanonicalType(aiType: string): string | null {
    const normalized = aiType.toLowerCase().replace(/[\s\-]/g, "_");

    // Direct match after normalization
    if (OBJECTIVE_TYPES.has(normalized)) return normalized;

    // Common AI-generated type → canonical type mappings
    const mappings: Record<string, string> = {
      infiltrate: "hack",
      breach: "hack",
      crack: "hack",
      intrude: "hack",
      penetrate: "hack",
      access: "gain_access",
      gain_access_to: "gain_access",
      download: "steal_count",
      extract: "steal_count",
      exfiltrate: "steal_count",
      steal_data: "steal_count",
      steal_files: "steal_count",
      upload: "upload_file",
      delete: "delete_file",
      remove: "delete_file",
      erase: "delete_file",
      send_message: "message",
      communicate: "message",
      contact: "contact_player",
      reach_out: "contact_player",
      post: "forum_post",
      reply: "forum_reply",
      discover: "explore",
      find: "explore",
      scan: "explore",
      map: "explore",
      connect: "connect_server",
      level_up: "skill_level",
      train: "gain_xp",
      earn: "earn_credits",
      collect_credits: "earn_credits",
      spend: "spend_credits",
      join: "join_faction",
    };

    if (mappings[normalized]) return mappings[normalized];

    // Prefix matching: e.g. "hack_something" → "hack"
    for (const [key] of OBJECTIVE_TYPES) {
      if (normalized.startsWith(key)) return key;
    }

    return null;
  }

  /**
   * Create mission in database
   */
  private async createMission(
    mission: GeneratedMission,
    createdBy: string,
  ): Promise<string | null> {
    try {
      // Provision mission infrastructure (target server, objective files, etc.)
      // This patches objective metadata with real server/file IDs.
      if (this.serverContent) {
        try {
          const provision =
            await this.serverContent.provisionMissionInfrastructure(
              {
                title: mission.title,
                description: mission.description,
                type: mission.type,
                difficulty: mission.difficulty,
                objectives: mission.objectives,
                ...(mission.factionId ? { factionId: mission.factionId } : {}),
              },
              createdBy,
            );

          if (provision) {
            // Set the target server on the mission
            mission.targetServerId = provision.targetServerId;

            // Patch objective metadata with real IDs
            for (const patch of provision.objectives) {
              const obj = mission.objectives[patch.index];
              if (obj) {
                obj.metadata = { ...(obj.metadata || {}), ...patch.metadata };
              }
            }

            this.logger.info(
              {
                missionTitle: mission.title,
                targetServerId: provision.targetServerId,
                patchedObjectives: provision.objectives.length,
                plantedFiles: provision.plantedFiles.length,
              },
              "Mission infrastructure provisioned",
            );
          }
        } catch (provisionErr) {
          this.logger.warn(
            { err: provisionErr, missionTitle: mission.title },
            "Mission infrastructure provisioning failed, creating mission without real targets",
          );
        }
      }

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
      if (mission.targetServerId) {
        missionData.targetServerId = mission.targetServerId;
      }
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

      return result?.id ?? null;
    } catch (error) {
      this.logger.error({ err: error }, "Failed to create mission");
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

      this.logger.info(
        { generated, playerCount: activePlayers.length },
        "Generated daily missions",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Daily generation failed");
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

      this.logger.info({ count: result.count }, "Cleaned up expired missions");
    } catch (error) {
      this.logger.error({ err: error }, "Cleanup failed");
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Calculate player level from XP
   */
  private calculateLevel(xp: number): number {
    return Math.floor(Math.sqrt(xp / 100)) + 1;
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
