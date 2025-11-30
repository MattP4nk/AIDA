import { Mission } from "@prisma/client";
import { db } from "../database/client";
import { injectable, inject } from "tsyringe";
import { CACHE_SERVICE } from "../di/tokens";
import type { CacheService } from "./cacheService";
import { Server as SocketIOServer } from "socket.io";

/**
 * Mission objective interface
 */
interface MissionObjective {
  id: string;
  type:
    | "hack"
    | "steal"
    | "defend"
    | "explore"
    | "message"
    | "count"
    | "boolean";
  description: string;
  target: number | string | boolean;
  current: number | string | boolean;
  completed: boolean;
}

/**
 * Mission rewards interface
 */
interface MissionRewards {
  xp: number;
  credits: number;
  items?: string[];
  reputation?: number;
  skillPoints?: number;
  unlocks?: string[];
}

/**
 * Performance metrics for reward calculation
 */
interface PerformanceMetrics {
  timeElapsed: number;
  stealthScore: number;
  efficiencyScore: number;
  bonusObjectivesCompleted: number;
}

/**
 * Create mission data interface
 */
interface CreateMissionData {
  title: string;
  description: string;
  type: string;
  difficulty: number;
  requiredSkills?: Record<string, number>;
  reward: MissionRewards;
  timeLimit?: number;
  targetServerId?: string;
  targetUserId?: string;
  objectives: MissionObjective[];
  createdBy: string;
}

/**
 * Mission status type
 */
type MissionStatus =
  | "available"
  | "assigned"
  | "active"
  | "completed"
  | "failed"
  | "expired";

/**
 * Player mission tracking
 */
interface PlayerMission {
  missionId: string;
  userId: string;
  status: MissionStatus;
  objectives: MissionObjective[];
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
}

/**
 * MissionService - Manages missions, objectives, rewards, and quest chains
 *
 * Responsibilities:
 * - Mission creation and management
 * - Mission assignment to players
 * - Objective tracking and completion
 * - Reward calculation and distribution
 * - Mission expiry handling
 */
@injectable()
class MissionService {
  private prisma = db.client;
  private io: SocketIOServer | null = null; // Initialize as null

  constructor(
    @inject(CACHE_SERVICE) private cacheService: CacheService
  ) {
    console.log("🎯 MissionService initialized");
  }

  /**
   * Set Socket.IO instance for real-time events
   * @param io - Socket.IO server instance
   */
  public setSocketIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Create a new mission
   * @param data - Mission creation data
   * @returns Created mission
   */
  public async createMission(data: CreateMissionData): Promise<Mission> {
    try {
      const mission = await this.prisma.mission.create({
        data: {
          title: data.title,
          description: data.description,
          type: data.type,
          difficulty: data.difficulty,
          requiredSkills: (data.requiredSkills ?? {}) as any,
          reward: data.reward as any,
          timeLimit: data.timeLimit ?? null,
          targetServerId: data.targetServerId ?? null,
          targetUserId: data.targetUserId ?? null,
          objectives: data.objectives as any,
          status: "available",
          assignedTo: null,
          createdBy: data.createdBy,
          expiresAt: null,
        },
      });

      // Audit log
      await this.auditLog("system", "MISSION_CREATED", {
        missionId: mission.id,
        title: mission.title,
        type: mission.type,
      });

      return mission;
    } catch (error) {
      console.error("[MissionService] Error creating mission:", error);
      throw new Error(
        `Failed to create mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get mission by ID
   * @param missionId - Mission ID
   * @returns Mission or null
   */
  public async getMission(missionId: string): Promise<Mission | null> {
    try {
      // Check cache
      const cached = this.cacheService.get<Mission>(`mission:${missionId}`);
      if (cached) {
        return cached;
      }

      const mission = await this.prisma.mission.findUnique({
        where: { id: missionId },
      });

      if (mission) {
        // Cache mission (TTL 5 minutes)
        this.cacheService.set(`mission:${missionId}`, mission, 300);
      }

      return mission;
    } catch (error) {
      console.error("[MissionService] Error getting mission:", error);
      throw new Error(
        `Failed to get mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Update mission properties
   * @param missionId - Mission ID
   * @param updates - Partial mission data to update
   * @returns Updated mission
   */
  public async updateMission(
    missionId: string,
    updates: Partial<CreateMissionData>,
  ): Promise<Mission> {
    try {
      const updateData: any = {};
      if (updates.title) updateData.title = updates.title;
      if (updates.description) updateData.description = updates.description;
      if (updates.type) updateData.type = updates.type;
      if (updates.difficulty !== undefined)
        updateData.difficulty = updates.difficulty;
      if (updates.requiredSkills)
        updateData.requiredSkills = updates.requiredSkills as any;
      if (updates.reward) updateData.reward = updates.reward as any;
      if (updates.timeLimit !== undefined)
        updateData.timeLimit = updates.timeLimit ?? null;
      if (updates.objectives) updateData.objectives = updates.objectives as any;
      if (updates.targetServerId)
        updateData.targetServerId = updates.targetServerId;
      if (updates.targetUserId) updateData.targetUserId = updates.targetUserId;

      const mission = await this.prisma.mission.update({
        where: { id: missionId },
        data: updateData,
      });

      // Invalidate cache
      this.cacheService.del(`mission:${missionId}`);

      // Audit log
      await this.auditLog("system", "MISSION_UPDATED", {
        missionId: mission.id,
        updates: Object.keys(updates),
      });

      return mission;
    } catch (error) {
      console.error("[MissionService] Error updating mission:", error);
      throw new Error(
        `Failed to update mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Delete a mission
   * @param missionId - Mission ID
   */
  public async deleteMission(missionId: string): Promise<void> {
    try {
      await this.prisma.mission.delete({
        where: { id: missionId },
      });

      // Invalidate cache
      this.cacheService.del(`mission:${missionId}`);

      // Audit log
      await this.auditLog("system", "MISSION_DELETED", {
        missionId,
      });
    } catch (error) {
      console.error("[MissionService] Error deleting mission:", error);
      throw new Error(
        `Failed to delete mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Assign a mission to a player
   * @param userId - User ID
   * @param missionId - Mission ID
   * @returns Player mission tracking data
   */
  public async assignMission(
    userId: string,
    missionId: string,
  ): Promise<PlayerMission> {
    try {
      const mission = await this.getMission(missionId);
      if (!mission) {
        throw new Error("Mission not found");
      }

      if (mission.status !== "available") {
        throw new Error("Mission is not available");
      }

      // Parse objectives
      const objectives =
        (mission.objectives as unknown as MissionObjective[]) || [];

      // Create player mission tracking
      const playerMission: PlayerMission = {
        missionId,
        userId,
        status: "assigned",
        objectives: objectives.map((obj) => ({
          ...obj,
          current: 0,
          completed: false,
        })),
        startedAt: null,
        completedAt: null,
        expiresAt: mission.timeLimit
          ? new Date(Date.now() + mission.timeLimit * 1000)
          : null,
      };

      // Update mission status and assign to user
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: "assigned",
          assignedTo: userId,
        },
      });

      // Store player mission in progress
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (progress) {
        const missionProgress = (progress.missionProgress as any) || {};
        missionProgress[missionId] = playerMission;

        await this.prisma.playerProgress.update({
          where: { userId },
          data: {
            missionProgress: missionProgress as any,
          },
        });
      }

      // Audit log
      await this.auditLog(userId, "MISSION_ASSIGNED", {
        missionId,
        missionTitle: mission.title,
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:assigned", {
          missionId,
          title: mission.title,
          description: mission.description,
          difficulty: mission.difficulty,
          rewards: mission.reward,
        });
      }

      return playerMission;
    } catch (error) {
      console.error("[MissionService] Error assigning mission:", error);
      throw new Error(
        `Failed to assign mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get all missions for a player
   * @param userId - User ID
   * @param status - Optional status filter
   * @returns Array of player missions
   */
  public async getPlayerMissions(
    userId: string,
    status?: MissionStatus,
  ): Promise<PlayerMission[]> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return [];
      }

      const missionProgress = (progress.missionProgress as any) || {};
      let playerMissions: PlayerMission[] = Object.values(missionProgress);

      // Filter by status if provided
      if (status) {
        playerMissions = playerMissions.filter((m) => m.status === status);
      }

      // Enrich with mission details
      // Enrich with mission details using batch fetch
      const missionIds = playerMissions.map(pm => pm.missionId);
      
      // Check cache for all missions first
      const cachedMissions = new Map<string, Mission>();
      const missingIds: string[] = [];

      for (const id of missionIds) {
        const cached = this.cacheService.get<Mission>(`mission:${id}`);
        if (cached) {
          cachedMissions.set(id, cached);
        } else {
          missingIds.push(id);
        }
      }

      // Fetch missing missions from DB
      if (missingIds.length > 0) {
        const dbMissions = await this.prisma.mission.findMany({
          where: { id: { in: missingIds } },
        });

        for (const mission of dbMissions) {
          cachedMissions.set(mission.id, mission);
          // Cache fetched missions
          this.cacheService.set(`mission:${mission.id}`, mission, 300);
        }
      }

      const enrichedMissions = playerMissions.map((pm) => {
        const mission = cachedMissions.get(pm.missionId);
        if (!mission) return pm;
        
        return {
          ...pm,
          title: mission.title,
          description: mission.description,
          type: mission.type,
          difficulty: mission.difficulty,
          reward: mission.reward,
          timeLimit: mission.timeLimit,
        };
      });

      return enrichedMissions;
    } catch (error) {
      console.error("[MissionService] Error getting player missions:", error);
      throw new Error(
        `Failed to get player missions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Accept a mission (change status from assigned to active)
   * @param userId - User ID
   * @param missionId - Mission ID
   */
  public async acceptMission(userId: string, missionId: string): Promise<void> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      const missionProgress = (progress.missionProgress as any) || {};
      const playerMission = missionProgress[missionId];

      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      if (playerMission.status !== "assigned") {
        throw new Error("Mission cannot be accepted in current state");
      }

      // Update status
      playerMission.status = "active";
      playerMission.startedAt = new Date();

      missionProgress[missionId] = playerMission;
      await this.prisma.playerProgress.update({
        where: { userId },
        data: {
          missionProgress: missionProgress as any,
        },
      });

      // Update mission in database
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: "active",
        },
      });

      // Audit log
      await this.auditLog(userId, "MISSION_ACCEPTED", {
        missionId,
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:accepted", {
          missionId,
        });
      }
    } catch (error) {
      console.error("[MissionService] Error accepting mission:", error);
      throw new Error(
        `Failed to accept mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Abandon a mission
   * @param userId - User ID
   * @param missionId - Mission ID
   */
  public async abandonMission(
    userId: string,
    missionId: string,
  ): Promise<void> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      const missionProgress = (progress.missionProgress as any) || {};
      const playerMission = missionProgress[missionId];

      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      // Update status
      playerMission.status = "failed";
      missionProgress[missionId] = playerMission;

      await this.prisma.playerProgress.update({
        where: { userId },
        data: {
          missionProgress: missionProgress as any,
        },
      });

      // Update mission in database to make it available again
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: "available",
          assignedTo: null,
        },
      });

      // Audit log
      await this.auditLog(userId, "MISSION_ABANDONED", {
        missionId,
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:abandoned", {
          missionId,
        });
      }
    } catch (error) {
      console.error("[MissionService] Error abandoning mission:", error);
      throw new Error(
        `Failed to abandon mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Update objective progress
   * @param userId - User ID
   * @param missionId - Mission ID
   * @param objectiveId - Objective ID
   * @param progress - Progress value
   */
  public async updateObjective(
    userId: string,
    missionId: string,
    objectiveId: string,
    progress: number | string | boolean,
  ): Promise<void> {
    try {
      const playerProgress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!playerProgress) {
        throw new Error("Player progress not found");
      }

      const missionProgress = (playerProgress.missionProgress as any) || {};
      const playerMission = missionProgress[missionId];

      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      if (playerMission.status !== "active") {
        return; // Only update active missions
      }

      // Find and update objective
      const objective = playerMission.objectives.find(
        (obj: MissionObjective) => obj.id === objectiveId,
      );
      if (!objective) {
        throw new Error("Objective not found");
      }

      // Update progress based on type
      if (objective.type === "count") {
        objective.current = Math.min(
          objective.target as number,
          (objective.current as number) + (progress as number),
        );
        objective.completed = objective.current >= objective.target;
      } else if (objective.type === "boolean") {
        objective.current = progress;
        objective.completed = progress === true;
      } else {
        objective.current = progress;
        objective.completed = true;
      }

      missionProgress[missionId] = playerMission;
      await this.prisma.playerProgress.update({
        where: { userId },
        data: {
          missionProgress: missionProgress as any,
        },
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:objective:updated", {
          missionId,
          objectiveId,
          progress: objective.current,
          completed: objective.completed,
        });
      }

      // Check if all objectives completed
      const allCompleted = playerMission.objectives.every(
        (obj: MissionObjective) => obj.completed,
      );
      if (allCompleted) {
        await this.completeMission(userId, missionId);
      }
    } catch (error) {
      console.error("[MissionService] Error updating objective:", error);
      throw new Error(
        `Failed to update objective: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Check if an objective is completed
   * @param userId - User ID
   * @param missionId - Mission ID
   * @param objectiveId - Objective ID
   * @returns True if completed
   */
  public async checkObjectiveCompletion(
    userId: string,
    missionId: string,
    objectiveId: string,
  ): Promise<boolean> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return false;
      }

      const missionProgress = (progress.missionProgress as any) || {};
      const playerMission = missionProgress[missionId];

      if (!playerMission) {
        return false;
      }

      const objective = playerMission.objectives.find(
        (obj: MissionObjective) => obj.id === objectiveId,
      );
      return objective ? objective.completed : false;
    } catch (error) {
      console.error(
        "[MissionService] Error checking objective completion:",
        error,
      );
      return false;
    }
  }

  /**
   * Complete a mission and grant rewards
   * @param userId - User ID
   * @param missionId - Mission ID
   * @returns Mission rewards
   */
  public async completeMission(
    userId: string,
    missionId: string,
  ): Promise<MissionRewards> {
    try {
      const mission = await this.getMission(missionId);
      if (!mission) {
        throw new Error("Mission not found");
      }

      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      const missionProgress = (progress.missionProgress as any) || {};
      const playerMission = missionProgress[missionId];

      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      if (playerMission.status === "completed") {
        throw new Error("Mission already completed");
      }

      // Calculate performance metrics
      const timeElapsed = playerMission.startedAt
        ? Date.now() - new Date(playerMission.startedAt).getTime()
        : 0;

      const performance: PerformanceMetrics = {
        timeElapsed,
        stealthScore: 100,
        efficiencyScore: 100,
        bonusObjectivesCompleted: 0,
      };

      // Calculate rewards
      const rewards = this.calculateRewards(mission, performance);

      // Update mission status
      playerMission.status = "completed";
      playerMission.completedAt = new Date();
      missionProgress[missionId] = playerMission;

      await this.prisma.playerProgress.update({
        where: { userId },
        data: {
          missionProgress: missionProgress as any,
        },
      });

      // Update mission in database
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: "completed",
        },
      });

      // Grant rewards
      await this.grantRewards(userId, rewards);

      // Audit log
      await this.auditLog(userId, "MISSION_COMPLETED", {
        missionId,
        missionTitle: mission.title,
        rewards,
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:completed", {
          missionId,
          title: mission.title,
          rewards,
        });
      }

      return rewards;
    } catch (error) {
      console.error("[MissionService] Error completing mission:", error);
      throw new Error(
        `Failed to complete mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Calculate mission rewards based on performance
   * @param mission - Mission
   * @param performance - Performance metrics
   * @returns Calculated rewards
   */
  public calculateRewards(
    mission: Mission,
    performance: PerformanceMetrics,
  ): MissionRewards {
    try {
      const baseRewards = (mission.reward as unknown as MissionRewards) || {
        xp: 100,
        credits: 50,
      };

      // Calculate multipliers based on performance
      let multiplier = 1.0;

      // Time bonus (faster completion = higher multiplier)
      if (
        mission.timeLimit &&
        performance.timeElapsed < mission.timeLimit * 1000
      ) {
        const timeRatio = performance.timeElapsed / (mission.timeLimit * 1000);
        multiplier += (1 - timeRatio) * 0.5; // Up to 50% bonus
      }

      // Stealth bonus
      if (performance.stealthScore > 80) {
        multiplier += 0.2;
      }

      // Efficiency bonus
      if (performance.efficiencyScore > 90) {
        multiplier += 0.15;
      }

      // Bonus objectives
      multiplier += performance.bonusObjectivesCompleted * 0.1;

      // Apply multiplier
      const finalRewards: MissionRewards = {
        xp: Math.floor(baseRewards.xp * multiplier),
        credits: Math.floor(baseRewards.credits * multiplier),
        items: baseRewards.items || [],
        reputation: baseRewards.reputation || 0,
        skillPoints: baseRewards.skillPoints || 0,
        unlocks: baseRewards.unlocks || [],
      };

      return finalRewards;
    } catch (error) {
      console.error("[MissionService] Error calculating rewards:", error);
      return {
        xp: 100,
        credits: 50,
      };
    }
  }

  /**
   * Grant rewards to a player
   * @param userId - User ID
   * @param rewards - Rewards to grant
   */
  public async grantRewards(
    userId: string,
    rewards: MissionRewards,
  ): Promise<void> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      // Update player progress with rewards
      const updateData: any = {};

      if (rewards.xp > 0) {
        updateData.experience = progress.experience + rewards.xp;

        // Check for level up
        const newLevel = this.calculateLevel(updateData.experience);
        if (newLevel > progress.level) {
          updateData.level = newLevel;

          // Emit level up event
          if (this.io) {
            this.io.to(`player:${userId}`).emit("player:levelup", {
              newLevel,
              experience: updateData.experience,
            });
          }
        }
      }

      if (rewards.credits > 0) {
        updateData.credits = progress.credits + rewards.credits;
      }

      if (rewards.reputation) {
        // Add reputation to neutral faction by default
        updateData.repNeutral = (progress.repNeutral || 0) + rewards.reputation;
      }

      await this.prisma.playerProgress.update({
        where: { userId },
        data: updateData,
      });

      // Audit log
      await this.auditLog(userId, "REWARDS_GRANTED", {
        rewards,
      });
    } catch (error) {
      console.error("[MissionService] Error granting rewards:", error);
      throw new Error(
        `Failed to grant rewards: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Get available missions for a player
   * @param userId - User ID
   * @returns Array of available missions
   */
  public async getAvailableMissions(userId: string): Promise<Mission[]> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return [];
      }

      const playerLevel = progress.level;

      // Find missions that:
      // 1. Are available
      // 2. Match player's level (±2 levels)
      // 3. Not already assigned to this player
      const missions = await this.prisma.mission.findMany({
        where: {
          status: "available",
          difficulty: {
            gte: Math.max(1, playerLevel - 2),
            lte: playerLevel + 2,
          },
        },
        orderBy: {
          difficulty: "asc",
        },
      });

      return missions;
    } catch (error) {
      console.error(
        "[MissionService] Error getting available missions:",
        error,
      );
      throw new Error(
        `Failed to get available missions: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Check for expired missions and update their status
   */
  public async checkExpiredMissions(): Promise<void> {
    try {
      const allProgress = await this.prisma.playerProgress.findMany();

      const now = Date.now();

      for (const progress of allProgress) {
        const missionProgress = (progress.missionProgress as any) || {};
        let updated = false;

        for (const missionId in missionProgress) {
          const playerMission = missionProgress[missionId];

          if (
            playerMission.status === "active" &&
            playerMission.expiresAt &&
            new Date(playerMission.expiresAt).getTime() < now
          ) {
            playerMission.status = "expired";
            updated = true;

            // Emit Socket.IO event
            if (this.io) {
              this.io.to(`player:${progress.userId}`).emit("mission:expired", {
                missionId,
              });
            }

            // Audit log
            await this.auditLog(progress.userId, "MISSION_EXPIRED", {
              missionId,
            });

            // Update mission in database
            await this.prisma.mission.update({
              where: { id: missionId },
              data: {
                status: "available",
                assignedTo: null,
              },
            });
          }
        }

        if (updated) {
          await this.prisma.playerProgress.update({
            where: { userId: progress.userId },
            data: {
              missionProgress: missionProgress as any,
            },
          });
        }
      }
    } catch (error) {
      console.error("[MissionService] Error checking expired missions:", error);
    }
  }

  /**
   * Manually expire a mission for a player
   * @param userId - User ID
   * @param missionId - Mission ID
   */
  public async expireMission(userId: string, missionId: string): Promise<void> {
    try {
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      const missionProgress = (progress.missionProgress as any) || {};
      const playerMission = missionProgress[missionId];

      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      playerMission.status = "expired";
      missionProgress[missionId] = playerMission;

      await this.prisma.playerProgress.update({
        where: { userId },
        data: {
          missionProgress: missionProgress as any,
        },
      });

      // Update mission in database
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: "available",
          assignedTo: null,
        },
      });

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:expired", {
          missionId,
        });
      }

      // Audit log
      await this.auditLog(userId, "MISSION_EXPIRED", {
        missionId,
      });
    } catch (error) {
      console.error("[MissionService] Error expiring mission:", error);
      throw new Error(
        `Failed to expire mission: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  // ==================== PRIVATE HELPER METHODS ====================

  /**
   * Calculate player level from XP
   * @param xp - Total XP
   * @returns Player level
   */
  private calculateLevel(xp: number): number {
    // Simple level calculation: level = floor(sqrt(xp / 100))
    return Math.floor(Math.sqrt(xp / 100)) + 1;
  }

  /**
   * Create audit log entry
   * @param userId - User ID
   * @param action - Action performed
   * @param details - Additional details
   */
  private async auditLog(
    userId: string,
    action: string,
    details: Record<string, any>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: userId === "system" ? null : userId,
          action,
          resource: "MISSION",
          metadata: details as any,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error("[MissionService] Error creating audit log:", error);
      // Don't throw - audit log failure shouldn't break main functionality
    }
  }
}

export default MissionService;

// Backward compatibility
import { container } from "../di/container";
import { MISSION_SERVICE } from "../di/tokens";
export const missionService = new Proxy({} as MissionService, {
  get(_target, prop) {
    const instance = container.resolve(MISSION_SERVICE as any);
    return (instance as any)[prop];
  }
});
