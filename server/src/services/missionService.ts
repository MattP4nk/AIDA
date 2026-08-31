import { EventEmitter } from "events";
import { Mission } from "@prisma/client";
import { db } from "../database/client";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { CACHE_SERVICE, LOGGER } from "../di/tokens";
import type { CacheService } from "./cacheService";
import { Server as SocketIOServer } from "socket.io";

/**
 * Mission objective interface
 */
interface MissionObjective {
  id: string;
  /**
   * Semantic objective type, e.g. "hack_stealth", "earn_credits",
   * "connect_server". Deliberately a free string: missionTemplatePool defines
   * ~30 distinct types and the AI mission generator can emit more.
   *
   * Progress semantics are driven by the runtime type of `target`, NOT by this
   * field — a number means "count up to N", a boolean means "did it happen".
   * The previous union listed "count" | "boolean", which no template ever used,
   * so every objective silently took the wrong branch. See updateObjective().
   */
  type: string;
  description: string;
  target: number | string | boolean;
  current: number | string | boolean;
  completed: boolean;
  /** Entity ids for target matching live here, not in `target`. See G6. */
  metadata?: Record<string, unknown>;
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
  factionId?: string;
  issuedBy?: string;
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
class MissionService extends EventEmitter {
  private prisma = db.client;
  private io: SocketIOServer | null = null; // Initialize as null
  private expirationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(CACHE_SERVICE) private cacheService: CacheService,
  ) {
    super();
  }

  /**
   * Start a periodic interval that checks for expired missions every 15 minutes.
   */
  public startExpirationChecker(): void {
    if (this.expirationInterval) return; // Already running

    const INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

    // Run once immediately, then on interval
    this.checkExpiredMissions().catch((err) => {
      this.logger.error({ err }, "Initial mission expiration check failed");
    });

    this.expirationInterval = setInterval(() => {
      this.checkExpiredMissions().catch((err) => {
        this.logger.error({ err }, "Mission expiration check failed");
      });
    }, INTERVAL_MS);

    this.logger.info("Mission expiration checker started (every 15 min)");
  }

  /**
   * Stop the periodic mission expiration checker.
   */
  public stopExpirationChecker(): void {
    if (this.expirationInterval) {
      clearInterval(this.expirationInterval);
      this.expirationInterval = null;
      this.logger.info("Mission expiration checker stopped");
    }
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
          factionId: data.factionId ?? null,
          issuedBy: data.issuedBy ?? null,
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
      this.logger.error({ err: error }, "Error creating mission");
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
      this.logger.error({ err: error }, "Error getting mission");
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
      this.logger.error({ err: error }, "Error updating mission");
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
      this.logger.error({ err: error }, "Error deleting mission");
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

      // Check if mission is already assigned to this user
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (progress) {
        const missionProgress = (progress.missionProgress as any) || {};
        if (missionProgress[missionId]) {
          throw new Error("Mission is not available");
        }
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
      this.cacheService.del(`mission:${missionId}`);

      // Store player mission in progress (create progress record if missing)
      const existingProgress = progress || { missionProgress: {} };
      const missionProgress =
        (existingProgress.missionProgress as Record<string, any>) || {};
      missionProgress[missionId] = playerMission;

      if (progress) {
        await this.prisma.playerProgress.update({
          where: { userId },
          data: {
            missionProgress: missionProgress as any,
          },
        });
      } else {
        await this.prisma.playerProgress.create({
          data: {
            userId,
            missionProgress: missionProgress as any,
            experience: 0,
            level: 1,
            credits: 0,
            skills: {},
            inventory: [],
            equipment: {},
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
      this.logger.error({ err: error }, "Error assigning mission");
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
      const missionIds = playerMissions.map((pm) => pm.missionId);

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
      this.logger.error({ err: error }, "Error getting player missions");
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

      // Accepting an already-active mission is a no-op, not an error — a
      // double-click or a retried socket event shouldn't fail.
      if (playerMission.status === "active") {
        return;
      }

      // The mission lifecycle is: available → active → completed/failed/expired.
      //
      // This previously required "assigned", which NOTHING ever writes:
      // missionGenerator.ts:181 writes "available", while the tutorial and story
      // paths write "active" directly and skip accept altogether. The only
      // producer of "assigned" would be assignMission(), which has zero callers.
      // Net effect: every generated mission threw "Mission cannot be accepted in
      // current state", so no non-tutorial mission in the game could be started.
      //
      // "assigned" is still honoured so that wiring assignMission() back up
      // later doesn't reintroduce the same mismatch.
      if (
        playerMission.status !== "available" &&
        playerMission.status !== "assigned"
      ) {
        throw new Error(
          `Mission cannot be accepted in current state (${playerMission.status})`,
        );
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
      this.cacheService.del(`mission:${missionId}`);

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
      this.logger.error({ err: error }, "Error accepting mission");
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
      this.cacheService.del(`mission:${missionId}`);

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

      // Feedback: abandoned missions are important signal
      const mission = await this.getMission(missionId);
      if (mission) {
        const timeActive = playerMission.startedAt
          ? Math.round((Date.now() - new Date(playerMission.startedAt).getTime()) / 60000)
          : 0;

        this.emit("mission:feedback", {
          missionId,
          templateId: (mission as any).templateId || "unknown",
          userId,
          playerLevel: progress.level,
          missionDifficulty: mission.difficulty,
          missionType: mission.type,
          timeToCompleteMin: timeActive,
          difficultyGrade: "too_hard" as const,
          objectiveTypes: ((mission.objectives as any[]) || []).map((o: any) => o.type),
          efficiencyScore: 0,
          stealthScore: 0,
          factionId: mission.factionId || undefined,
          abandoned: true,
        });
      }
    } catch (error) {
      this.logger.error({ err: error }, "Error abandoning mission");
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

      // Update progress.
      //
      // Semantics are derived from the TARGET's runtime type, not from
      // `objective.type`. The declared union here (…|"count"|"boolean") matches
      // ZERO of the 200+ entries in missionTemplatePool — they all use semantic
      // types like "hack_stealth", "earn_credits", "steal_count". So every
      // objective fell through to the old `else`, which set completed = true
      // unconditionally: "Earn 5,000 credits" completed on the first credit.
      // Targets in the pool are only ever numbers (75) or booleans (59), and
      // switching on the target's type covers both plus any future type string.
      //
      // NOTE: callers pass an ABSOLUTE value, not a delta — they compute
      // `objective.current + amount` themselves (missionIntegration.ts:255,565,570)
      // — so this must not add anything on top.
      const target = objective.target;

      if (typeof target === "number") {
        const value = Number(progress);
        objective.current = Number.isFinite(value) ? value : 0;
        objective.completed =
          objective.completed || (objective.current as number) >= target;
      } else if (typeof target === "boolean") {
        objective.current = progress;
        objective.completed = objective.completed || progress === true;
      } else {
        // Defensive: no string targets exist in the pool today.
        objective.current = progress;
        objective.completed =
          objective.completed || String(progress) === String(target);
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
      this.logger.error({ err: error }, "Error updating objective");
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
      this.logger.error({ err: error }, "Error checking objective completion");
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

      // Calculate real performance metrics from objective completion data
      const objectives = playerMission.objectives || [];
      const totalObjectives = objectives.length;
      const completedObjectives = objectives.filter(
        (o: any) => o.completed,
      ).length;

      // Stealth: based on detection data stored in mission metadata, default to base score
      const missionMeta = (playerMission as any).metadata || {};
      const detectionEvents = missionMeta.detectionCount || 0;
      const hintCount = missionMeta.hintCount || 0;
      const stealthScore = Math.max(
        0,
        100 - detectionEvents * 15 - hintCount * 5,
      );

      // Efficiency: ratio of completed vs attempted objectives, penalized by hints
      const efficiencyScore =
        totalObjectives > 0
          ? Math.max(
              0,
              Math.round((completedObjectives / totalObjectives) * 100) -
                hintCount * 10,
            )
          : 100;

      // Bonus objectives: count objectives beyond the minimum required
      const bonusObjectivesCompleted = Math.max(
        0,
        completedObjectives - totalObjectives,
      );

      const performance: PerformanceMetrics = {
        timeElapsed,
        stealthScore,
        efficiencyScore,
        bonusObjectivesCompleted,
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
          missionsCompleted: { increment: 1 },
        },
      });

      // Update mission in database
      await this.prisma.mission.update({
        where: { id: missionId },
        data: {
          status: "completed",
        },
      });
      this.cacheService.del(`mission:${missionId}`);

      // Grant rewards
      await this.grantRewards(userId, rewards);

      // Roll for bonus token drop
      try {
        await this.rollTokenDrop(userId, {
          difficulty: mission.difficulty,
          type: mission.type,
          factionId: mission.factionId,
        });
      } catch (err) {
        this.logger.warn({ err }, "Token drop roll failed (non-critical)");
      }

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

      // Emit Node.js event for service-level listeners (e.g. AI persona reactions, faction knowledge)
      this.emit("mission:completed", {
        userId,
        missionId,
        missionTitle: mission.title,
        factionId: mission.factionId || undefined,
        targetServerId: (mission as any).targetServerId || undefined,
        objectives: ((mission.objectives as any[]) || []).map((obj: any) => ({
          type: obj.type,
          metadata: obj.metadata || {},
        })),
      });

      // ═══ Mission Feedback — AI learns from outcomes ═══
      // Grade the mission difficulty relative to the player
      const timeToCompleteMin = Math.round(timeElapsed / 60000);
      const expectedTimeMin = mission.difficulty * 5; // ~5 min per difficulty level as baseline
      const levelDiffRatio = progress.level / Math.max(1, mission.difficulty);

      let difficultyGrade: "too_easy" | "appropriate" | "too_hard";
      if (levelDiffRatio > 2.5 || timeToCompleteMin < expectedTimeMin * 0.3) {
        difficultyGrade = "too_easy";
      } else if (timeToCompleteMin > expectedTimeMin * 3 || efficiencyScore < 40) {
        difficultyGrade = "too_hard";
      } else {
        difficultyGrade = "appropriate";
      }

      const objectiveTypes = ((mission.objectives as any[]) || []).map((o: any) => o.type);

      this.emit("mission:feedback", {
        missionId,
        templateId: (mission as any).templateId || "unknown",
        userId,
        playerLevel: progress.level,
        missionDifficulty: mission.difficulty,
        missionType: mission.type,
        timeToCompleteMin,
        difficultyGrade,
        objectiveTypes,
        efficiencyScore,
        stealthScore,
        factionId: mission.factionId || undefined,
        abandoned: false,
      });

      return rewards;
    } catch (error) {
      this.logger.error({ err: error }, "Error completing mission");
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
      this.logger.error({ err: error }, "Error calculating rewards");
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

          // Emit level up event + notification toast to client
          if (this.io) {
            this.io.to(`player:${userId}`).emit("player:levelup", {
              newLevel,
              experience: updateData.experience,
              userId,
            });
            this.io.to(`player:${userId}`).emit("notification", {
              type: "levelup",
              title: "Level Up!",
              message: `You reached Level ${newLevel}!`,
              severity: "success",
            });
          }
          // Emit for internal listeners (dynamic content, etc.)
          this.emit("player:levelup", { userId, newLevel, experience: updateData.experience });
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

      // Send reward notification toast
      if (this.io && (rewards.xp > 0 || rewards.credits > 0)) {
        const parts: string[] = [];
        if (rewards.xp > 0) parts.push(`+${rewards.xp} XP`);
        if (rewards.credits > 0) parts.push(`+${rewards.credits} Credits`);
        if (rewards.skillPoints && rewards.skillPoints > 0) parts.push(`+${rewards.skillPoints} Skill Points`);
        this.io.to(`player:${userId}`).emit("notification", {
          type: "reward",
          title: "Rewards",
          message: parts.join(", "),
          severity: "success",
        });
      }

      // Grant items (shop items by name)
      if (rewards.items && rewards.items.length > 0) {
        for (const itemName of rewards.items) {
          try {
            // Look up the shop item by name (case-insensitive)
            const shopItem = await this.prisma.shopItem.findFirst({
              where: {
                name: { equals: itemName, mode: "insensitive" },
              },
              select: {
                id: true,
                name: true,
                isStackable: true,
                maxStack: true,
              },
            });

            if (!shopItem) {
              this.logger.warn({ itemName }, "Reward item not found in shop");
              continue;
            }

            // Check if player already has this item
            const existing = await this.prisma.inventoryItem.findFirst({
              where: { userId, shopItemId: shopItem.id },
            });

            if (existing && shopItem.isStackable) {
              // Stack it up to maxStack
              const newQty = Math.min(existing.quantity + 1, shopItem.maxStack);
              if (newQty > existing.quantity) {
                await this.prisma.inventoryItem.update({
                  where: { id: existing.id },
                  data: { quantity: newQty },
                });
              }
            } else if (!existing) {
              // Create new inventory entry
              await this.prisma.inventoryItem.create({
                data: {
                  userId,
                  shopItemId: shopItem.id,
                  quantity: 1,
                  source: "mission_reward",
                },
              });
            }

            // Notify the player
            if (this.io) {
              this.io.to(`player:${userId}`).emit("notification", {
                type: "item",
                title: "Item Acquired",
                message: `You received: ${shopItem.name}`,
                severity: "success",
              });
            }

            this.logger.info(
              { userId, itemName: shopItem.name },
              "Granted reward item",
            );
          } catch (err) {
            this.logger.error({ err, itemName }, "Failed to grant reward item");
          }
        }
      }

      // Emit events for mission integration (skill/credits tracking)
      if (rewards.xp > 0) {
        this.emit("rewards:xp_granted", {
          userId,
          skillName: "general",
          newLevel: updateData.level || progress.level,
          xpGained: rewards.xp,
        });
      }
      if (rewards.credits > 0) {
        this.emit("rewards:credits_granted", {
          userId,
          amount: rewards.credits,
          type: "earned" as const,
        });
      }

      // Audit log
      await this.auditLog(userId, "REWARDS_GRANTED", {
        rewards,
      });
    } catch (error) {
      this.logger.error({ err: error }, "Error granting rewards");
      throw new Error(
        `Failed to grant rewards: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  /**
   * Roll for a communication token drop based on mission difficulty and faction.
   * Higher difficulty missions have better chances. Faction missions drop
   * faction-appropriate tokens.
   */
  private async rollTokenDrop(
    userId: string,
    mission: { difficulty: number; type: string; factionId?: string | null },
  ): Promise<void> {
    const difficulty = mission.difficulty || 1;

    // Base drop chance scales with difficulty:
    // difficulty 1-4: 0% (too easy)
    // difficulty 5-6: 8%
    // difficulty 7-8: 18%
    // difficulty 9-10: 30%
    let dropChance = 0;
    if (difficulty >= 9) dropChance = 0.3;
    else if (difficulty >= 7) dropChance = 0.18;
    else if (difficulty >= 5) dropChance = 0.08;
    else return; // No drops for easy missions

    // Story missions get a bonus
    if (mission.type === "story" || mission.type === "espionage") {
      dropChance += 0.1;
    }

    const roll = Math.random();
    if (roll > dropChance) return; // No drop

    // Determine which token to drop
    let tokenName: string | null = null;

    if (mission.factionId) {
      // Faction missions: drop the corresponding faction leader token
      try {
        const faction = await this.prisma.faction.findUnique({
          where: { id: mission.factionId },
          select: { shortName: true, name: true },
        });

        if (faction) {
          const factionTokenMap: Record<string, string> = {
            garrison: "Commander Steele's Briefing Token",
            dothackers: "gh0st's Dead Drop Token",
            cybercorp: "Director Chen's Business Card",
          };

          const shortName = (faction.shortName || "").toLowerCase();
          tokenName = factionTokenMap[shortName] || null;
        }
      } catch {
        // Faction lookup failed — fall through to generic token
      }
    }

    // For non-faction or unknown factions, roll a generic token
    if (!tokenName) {
      // Higher difficulty → rarer tokens
      if (difficulty >= 9 && Math.random() < 0.3) {
        // 30% chance of AIDA Signal Fragment at difficulty 9+
        tokenName = "AIDA Signal Fragment";
      } else if (difficulty >= 7 && Math.random() < 0.5) {
        tokenName = "Envoy's Cipher Token";
      } else {
        // Random faction leader token
        const leaderTokens = [
          "Commander Steele's Briefing Token",
          "gh0st's Dead Drop Token",
          "Director Chen's Business Card",
        ];
        tokenName =
          leaderTokens[Math.floor(Math.random() * leaderTokens.length)]!;
      }
    }

    // Find the shop item
    const shopItem = await this.prisma.shopItem.findFirst({
      where: {
        name: tokenName,
        itemType: "token",
      },
      select: { id: true, name: true, isStackable: true, maxStack: true },
    });

    if (!shopItem) {
      this.logger.warn({ tokenName }, "Token shop item not found for drop");
      return;
    }

    // Check existing inventory
    const existing = await this.prisma.inventoryItem.findFirst({
      where: { userId, shopItemId: shopItem.id },
    });

    if (existing && existing.quantity >= (shopItem.maxStack || 5)) {
      // Already at max stack — skip
      return;
    }

    if (existing) {
      await this.prisma.inventoryItem.update({
        where: { id: existing.id },
        data: { quantity: { increment: 1 } },
      });
    } else {
      await this.prisma.inventoryItem.create({
        data: {
          userId,
          shopItemId: shopItem.id,
          quantity: 1,
          source: "mission_reward",
        },
      });
    }

    // Notify the player
    if (this.io) {
      this.io.to(`player:${userId}`).emit("notification", {
        type: "item",
        title: "Rare Drop!",
        message: `You found: ${shopItem.name}`,
        severity: "info",
      });
    }

    this.logger.info(
      { userId, tokenName: shopItem.name, difficulty },
      "Player received token drop from mission",
    );
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
      this.logger.error({ err: error }, "Error getting available missions");
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
      this.logger.error({ err: error }, "Error checking expired missions");
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
      this.cacheService.del(`mission:${missionId}`);

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
      this.logger.error({ err: error }, "Error expiring mission");
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
      this.logger.error({ err: error }, "Error creating audit log");
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
  },
});
