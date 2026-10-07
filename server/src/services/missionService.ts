import { EventEmitter } from "events";
import { MissionStatus as SharedMissionStatus } from "../../../shared/types";
import { Mission } from "@prisma/client";
import { db } from "../database/client";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import {
  CACHE_SERVICE,
  LOGGER,
  PLAYER_MISSION_REPOSITORY,
  PLAYER_PROGRESS_REPOSITORY,
  SOCKET_IO,
} from "../di/tokens";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";
import type PlayerMissionRepository from "../repositories/playerMissionRepository";
import { NO_CHANGE } from "../repositories/playerMissionRepository";
import type { CacheService } from "./cacheService";
import { Server as SocketIOServer } from "socket.io";
import { notifyUser } from "../utils/notify";

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
// A2: was a private duplicate of the shared enum that disagreed with it
// (this one had "active", the shared one had a phantom "in_progress").
// `MissionStatusValue` is the string-literal view of the shared enum, so the
// two cannot drift again — adding a member there is a compile error here.
type MissionStatus = `${SharedMissionStatus}`;

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
    @inject(PLAYER_PROGRESS_REPOSITORY)
    private playerProgress: PlayerProgressRepository,
    @inject(PLAYER_MISSION_REPOSITORY)
    private playerMissions: PlayerMissionRepository,
    // INJECTED. `setSocketIO()` was only ever called by
    // `missionIntegration.setSocketIO()`, which itself has ZERO callers — so
    // `this.io` was permanently null and all 12 socket emits here were dead:
    // mission:accepted/assigned/completed/abandoned/expired/feedback,
    // rewards:xp_granted, rewards:credits_granted, and player:levelup — the last
    // of which the client answers with a sound and an urgent notification that
    // has therefore never fired.
    @inject(SOCKET_IO) io?: SocketIOServer,
  ) {
    super();
    this.io = io || null;
  }

  /**
   * Start a periodic interval that checks for expired missions every 15 minutes.
   */
  public startExpirationChecker(): void {
    if (this.expirationInterval) return; // Already running

    const INTERVAL_MS = MISSION_EXPIRATION_INTERVAL_MS; // 15 minutes

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

  // REMOVED 2026-10-07: `setSocketIO`. `io` is injected (see the constructor
  // note above); this setter's only caller was `missionIntegration.setSocketIO`,
  // which was itself dead and has been removed. A setter that duplicates
  // injection can only ever re-assign the same instance, and leaving one
  // around is how `this.io` ends up null in the first place.


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
          // S5c: backstop. Every mission creator lands here, so bounding at
          // this single write point covers the Architect, the generators, and
          // anything added later — no caller can persist an unbounded reward.
          difficulty: boundMissionDifficulty(data.difficulty),
          requiredSkills: (data.requiredSkills ?? {}) as any,
          reward: boundMissionRewards(data.reward) as any,
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

      if (progress && (await this.playerMissions.has(userId, missionId))) {
        throw new Error("Mission is not available");
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
        expiresAt: missionExpiresAt(mission.timeLimit),
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

      // Store player mission in progress (create progress record if missing).
      // D3: the update path goes through the repository so it is serialised
      // against the player's other mission writes. The create path stays a
      // direct `create` — there is no blob to race with when the row does not
      // exist yet, and row creation is PlayerProgress's concern, not this
      // repository's.
      // D3 pass 2: the row must be created FIRST, then the mission written
      // through the repository. Seeding `missionProgress` in the `create` would
      // put it in a column nothing reads any more — the mission would be
      // invisible to `getPlayerMissions` and `accept` would report "Mission not
      // assigned to player" forever.
      if (!progress) {
        await this.prisma.playerProgress.create({
          data: {
            userId,
            experience: 0,
            level: 1,
            credits: 0,
            skills: {},
            inventory: [],
            equipment: {},
          },
        });
      }
      await this.playerMissions.put(userId, missionId, playerMission as never);

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
      // D3: the whole-row `findUnique` is gone with the blob access — this only
      // ever needed `missionProgress`, and the repository selects just that.
      let playerMissions =
        (await this.playerMissions.list(userId)) as unknown as PlayerMission[];

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
        select: { userId: true },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      // ── D3: the whole check-and-flip is one critical section ───────────
      // Read-check-mutate-write used to be four separate steps over a blob, so
      // two concurrent accepts (a double-click, or a retried socket event) both
      // read `available`, both passed the state check, and both wrote `active`
      // — with the second also resetting `startedAt`, moving the expiry window.
      // Inside `mutate` the second caller sees `active` and takes the
      // idempotent no-op branch that was always intended.
      let alreadyActive = false;

      // REVERTED 2026-08-31. A lazy "materialise the progress entry from the
      // Mission row" branch briefly lived here. It was wrong on two counts:
      //
      //  - It was unnecessary. `missionGenerator` ALREADY writes each generated
      //    mission into the player's own missionProgress with
      //    `status: "available"` (missionGenerator.ts:178-205), precisely so
      //    getPlayerMissions() returns it. Offers are per-player by design; they
      //    are not anonymous rows waiting to be claimed. The reason no offer was
      //    ever visible was that generation had never run at all.
      //  - It was harmful. Materialising here while the generator also writes a
      //    blob entry for the same globally-shared row lets TWO players hold the
      //    same mission "active" and both complete it.
      //
      // So this correctly stays a hard requirement: you can only accept a
      // mission that is already on offer TO YOU.
      // R7 REVIEW FIX: the clock starts when the mission is ACCEPTED.
      //
      // `expiresAt` was stamped once, at GENERATION time, on the `available`
      // offer, and `acceptMission` carried it over untouched. While
      // `timeLimit` was (wrongly) milliseconds that was invisible — the expiry
      // sat 41–83 days out, so no offer could go stale. Fixing the unit made
      // template limits 1–2 HOURS, which turned every daily-generated offer
      // into a trap: accept it the next day and `checkExpiredMissions` (which
      // matches `status:"active" AND expiresAt < now`) kills it within 15
      // minutes, before the player can touch an objective.
      //
      // Accept time is also the semantics the rest of the code already
      // assumes: `startedAt` is set here, and `calculateRewards` measures
      // `timeElapsed` from `startedAt` against this same `timeLimit`.
      // ORPHAN AUDIT 2026-09-24: the active-mission cap is now enforced.
      //
      // `MAX_ACTIVE_MISSIONS = 5` sat in gameBalance with no consumer AND no
      // hardcoded twin — so unlike the other dead constants, nothing anywhere
      // limited how many missions a player could hold at once. Verified there
      // was no competing implementation before wiring.
      //
      // Read through the repository, which owns mission state (CLAUDE.md
      // invariant), rather than querying `playerMission` directly.
      //
      // Checked BEFORE the mutate: a cap applied inside the callback would
      // already have claimed the offer, and `mutate` treats a throw as a
      // failed write rather than a clean refusal.
      const held = await this.playerMissions.list(userId);
      const activeCount = held.filter((m) => m.status === "active").length;
      if (activeCount >= MAX_ACTIVE_MISSIONS) {
        throw new Error(
          `You are already running ${activeCount} missions (limit ${MAX_ACTIVE_MISSIONS}). ` +
            `Complete or abandon one before accepting another.`,
        );
      }

      const missionRow = await this.prisma.mission.findUnique({
        where: { id: missionId },
        select: { timeLimit: true },
      });

      await this.playerMissions.mutate(userId, missionId, (playerMission) => {
      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      // Accepting an already-active mission is a no-op, not an error — a
      // double-click or a retried socket event shouldn't fail.
      if (playerMission.status === "active") {
        alreadyActive = true;
        return NO_CHANGE;
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
      playerMission.expiresAt = missionExpiresAt(missionRow?.timeLimit);
      return playerMission;
      });

      if (alreadyActive) return;

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

      // `mission:accepted` DELETED 2026-10-07. No listener anywhere, and
      // `acceptMission`'s one caller (missionCommands:522) renders a
      // "MISSION ACCEPTED" box with the title and difficulty.
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
      // Only `level` is needed from the row now — the blob comes from the
      // repository. Kept as an explicit existence check so abandoning with no
      // progress row still reports the same error it always did.
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
        select: { level: true },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      // R12: tutorial missions cannot be abandoned.
      //
      // Nothing checked the type, so a player could abandon a tutorial step —
      // which sets it "failed" and frees the Mission row, while
      // `advanceTutorial` only ever fires on COMPLETION. The tutorial chain
      // then stalls with no way to resume it and no message saying why.
      const missionRow = await this.prisma.mission.findUnique({
        where: { id: missionId },
        select: { type: true },
      });
      if (missionRow?.type === "tutorial") {
        throw new Error(
          "Tutorial missions cannot be abandoned — complete it to continue.",
        );
      }

      // D3: serialised, so abandoning cannot race a concurrent completion and
      // overwrite it with "failed".
      const playerMission = await this.playerMissions.mutate(
        userId,
        missionId,
        (stored) => {
          if (!stored) {
            throw new Error("Mission not assigned to player");
          }
          stored.status = "failed";
          return stored;
        },
      );

      // R12: emit the Node event. `index.ts` has listened for `mission:failed`
      // all along — it advances the story arc and writes a story-ledger entry —
      // but NOTHING ever emitted it, so failing a mission had no narrative
      // consequence whatsoever. Same shape as R4's traces: a wired-up listener
      // waiting on a producer that was never written.
      this.emit("mission:failed", {
        missionId,
        userId,
        reason: "abandoned",
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

      // `mission:abandoned` DELETED 2026-10-07. No listener anywhere, and
      // `abandonMission`'s one caller (missionCommands:612) renders
      // "[!] MISSION ABANDONED" plus the reputation warning.

      // Feedback: abandoned missions are important signal
      const mission = await this.getMission(missionId);
      if (mission) {
        const timeActive = playerMission?.startedAt
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
      // ── D3: read-modify-write of the objective is one critical section ──
      // This is the hottest blob mutation in the game — `missionIntegration`
      // drives it from every credited event. It used to read the whole row,
      // mutate a nested objective, and write the entire blob back, so two
      // events landing together lost one another's progress completely.
      //
      // CAVEAT, recorded rather than hidden: callers pass an ABSOLUTE value
      // computed from a `current` THEY read (see the note below), so their read
      // is still outside this lock. Serialising here stops the blob write from
      // clobbering unrelated missions, but two concurrent counters for the SAME
      // objective can still collapse into one. Fixing that properly means
      // making the increment relative, which is pass 2's conditional-update
      // work — not something a lock here can reach.
      type ObjectiveOutcome = {
        current: number | string | boolean;
        completed: boolean;
        allCompleted: boolean;
      };
      // Held in a box: TypeScript cannot see assignments made inside the
      // callback below, so a bare `let` would stay narrowed to `null` and the
      // reads after `mutate` would not typecheck.
      const outcome: { value: ObjectiveOutcome | null } = { value: null };

      const objectiveResult = await this.playerMissions.mutate(
        userId,
        missionId,
        (playerMission) => {
      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      if (playerMission.status !== "active") {
        return NO_CHANGE; // Only update active missions
      }

      // Find and update objective
      const objective = playerMission.objectives.find(
        (obj) => obj.id === objectiveId,
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

      outcome.value = {
        current: objective.current,
        completed: objective.completed,
        allCompleted: requiredObjectivesComplete(playerMission.objectives),
      };
      return playerMission;
        },
      );

      // Nothing to report if the mission was not active.
      const updated = outcome.value;
      if (!updated || !objectiveResult) return;

      // Emit Socket.IO event
      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:objective:updated", {
          missionId,
          objectiveId,
          progress: updated.current,
          completed: updated.completed,
        });
      }

      // Check if all objectives completed.
      //
      // MUST be outside the `mutate` callback: `completeMission` takes the same
      // per-user lock, and the mutex is NOT reentrant — calling it from inside
      // would deadlock the player permanently.
      if (updated.allCompleted) {
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
   * D7 — grant one of `shopItem` to a player, atomically and respecting the
   * stack ceiling.
   *
   * Replaces two copies of `findFirst` → branch → `create`-or-`update`. The
   * check and the write were separated by an await, so two rewards landing
   * together both saw no row and both created: that used to leave a hidden
   * duplicate (every reader resolves inventory with `findFirst`, so the second
   * row was invisible stock — the player owned 2 and the game could see 1) and
   * since `@@unique([userId, shopItemId])` landed it throws P2002 instead.
   *
   * Create-then-handle-conflict rather than `upsert`, because the cap makes the
   * update conditional: a P2002 tells us the row exists, and the follow-up
   * `updateMany` tops it up only `WHERE quantity < cap`. Both statements are
   * atomic, and the ceiling is enforced by the database rather than computed
   * from a quantity read a moment earlier.
   */
  private async grantInventoryItem(
    userId: string,
    shopItem: { id: string; isStackable: boolean; maxStack: number },
    source: string,
  ): Promise<void> {
    // Non-stackable items cap at a single copy.
    const cap = shopItem.isStackable ? Math.max(1, shopItem.maxStack) : 1;

    try {
      await this.prisma.inventoryItem.create({
        data: { userId, shopItemId: shopItem.id, quantity: 1, source },
      });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      // The player already holds it. Top up only if below the ceiling; a
      // rowcount of 0 here means they were already at the cap.
      await this.prisma.inventoryItem.updateMany({
        where: { userId, shopItemId: shopItem.id, quantity: { lt: cap } },
        data: { quantity: { increment: 1 } },
      });
    }
  }

  /**
   * Credit a COUNT objective by a relative amount.
   *
   * D3 pass 2 — this is the half of the race a lock could never reach. Callers
   * used to compute `objective.current + n` from a mission object they had
   * loaded earlier and pass the ABSOLUTE result to `updateObjective`; that read
   * sat outside any critical section, so two credits arriving together both
   * computed the same base and one was silently lost. Serialising the write
   * could not recover it — the information was already gone by then.
   *
   * `incrementObjective` is a single `UPDATE … SET current_count =
   * current_count + n` with the completion recomputed in the same statement, so
   * there is no read to lose. Completion is sticky, matching G1.
   *
   * Falls back to `updateObjective` when the objective is not a count (boolean
   * objectives are not incrementable) so a mis-registered type degrades to the
   * old behaviour rather than silently doing nothing.
   */
  public async creditObjective(
    userId: string,
    missionId: string,
    objectiveId: string,
    delta: number,
  ): Promise<void> {
    try {
      const result = await this.playerMissions.incrementObjective(
        userId,
        missionId,
        objectiveId,
        delta,
      );

      if (!result) {
        // `incrementObjective` returns null for THREE different reasons: the
        // objective is not a count, the mission is not active, or there is no
        // such objective. Only the first deserves a fallback.
        //
        // The fallback is restricted to BOOLEAN targets. It used to fire for
        // anything non-numeric, which included the string-target case the
        // schema deliberately keeps alive for AI-invented shapes — writing
        // `true` into it, so `current` became the literal "true" and the
        // objective could never again match its real string target. That turned
        // "a new shape is a silent no-op" into "a new shape is silently
        // corrupted".
        const stored = await this.playerMissions.get(userId, missionId);
        if (stored?.status !== "active") return;
        const objective = stored.objectives.find((o) => o.id === objectiveId);
        if (objective && typeof objective.target === "boolean") {
          await this.updateObjective(userId, missionId, objectiveId, true);
        }
        return;
      }

      if (this.io) {
        this.io.to(`player:${userId}`).emit("mission:objective:updated", {
          missionId,
          objectiveId,
          progress: result.current,
          completed: result.completed,
        });
      }

      // Completion check runs OUTSIDE any lock — `completeMission` takes the
      // per-user mutex and it is not reentrant.
      if (
        result.completed &&
        (await this.playerMissions.allObjectivesComplete(userId, missionId))
      ) {
        await this.completeMission(userId, missionId);
      }
    } catch (error) {
      this.logger.error({ err: error, userId, missionId, objectiveId }, "Error crediting objective");
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
      // D3: read-only, so no lock needed — but it goes through the repository
      // so the blob has exactly one reader too, which is what makes pass 2's
      // storage swap a single-file change.
      const playerMission = await this.playerMissions.get(userId, missionId);

      if (!playerMission) {
        return false;
      }

      const objective = playerMission.objectives.find(
        (obj) => obj.id === objectiveId,
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

      // The payability guard must run BEFORE the claim. `grantRewards` still
      // throws "Player progress not found", and with claim-then-pay that throw
      // would land AFTER the mission was already marked completed on both rows
      // — burning it with no rewards and no recovery ("Mission already
      // completed" on retry). This guard is what makes that unreachable.
      const payable = await this.prisma.playerProgress.findUnique({
        where: { userId },
        select: { userId: true },
      });
      if (!payable) {
        throw new Error("Player progress not found");
      }

      // ── D3: CLAIM the completion atomically, before paying anything ─────
      // This is the double-reward site. The `"already completed"` guard and the
      // status flip used to be separate steps over a blob, so the expiry
      // sweep's stale write could revert `completed` back to `active` — after
      // which this guard passed a SECOND time and the rewards below were
      // granted again. Inside `mutate` the check and the flip are one critical
      // section, so exactly one caller can ever transition the mission and
      // therefore exactly one can pay.
      //
      // Deliberately ordered claim-then-pay. D5 notes the downside honestly: a
      // crash between them leaves the mission complete with rewards unpaid.
      // The alternative — pay first — is strictly worse, because a crash there
      // is repeatable and therefore exploitable. Making the pair genuinely
      // atomic needs both sides in one transaction, which is pass 2's work.
      const alreadyCompleted = { value: false };
      const playerMission = await this.playerMissions.mutate(
        userId,
        missionId,
        (stored) => {
          if (!stored) {
            throw new Error("Mission not assigned to player");
          }
          if (stored.status === "completed") {
            alreadyCompleted.value = true;
            return NO_CHANGE;
          }
          stored.status = "completed";
          stored.completedAt = new Date();
          return stored;
        },
      );

      if (alreadyCompleted.value) {
        throw new Error("Mission already completed");
      }
      if (!playerMission) {
        throw new Error("Mission not assigned to player");
      }

      // Calculate performance metrics
      const timeElapsed = playerMission.startedAt
        ? Date.now() - new Date(playerMission.startedAt).getTime()
        : 0;

      // Calculate real performance metrics from objective completion data
      const objectives = playerMission.objectives || [];

      // Stealth: based on detection data stored in mission metadata, default to base score
      const missionMeta = (playerMission as any).metadata || {};
      const detectionEvents = missionMeta.detectionCount || 0;
      const hintCount = missionMeta.hintCount || 0;
      const stealthScore = Math.max(
        0,
        100 - detectionEvents * 15 - hintCount * 5,
      );

      // Efficiency: ratio of REQUIRED objectives completed, penalised by hints.
      //
      // R7 REVIEW FIX: this counted bonus objectives in the denominator. Once
      // R7 made bonus objectives optional, a player who did everything the
      // mission actually demanded scored 50 on a 1-required/1-bonus template
      // and lost the `> 90` reward — so the change quietly made all 39
      // bonus-carrying templates pay LESS than before it. Efficiency measures
      // how cleanly you did the required work; the optional work is already
      // rewarded by its own per-bonus term.
      const requiredObjectives = objectives.filter((o: any) => !o.isBonus);
      const requiredTotal = requiredObjectives.length;
      const requiredDone = requiredObjectives.filter((o: any) => o.completed).length;
      const efficiencyScore =
        requiredTotal > 0
          ? Math.max(
              0,
              Math.round((requiredDone / requiredTotal) * 100) - hintCount * 10,
            )
          : 100;

      // R7: count COMPLETED BONUS objectives.
      //
      // This was `max(0, completedObjectives - totalObjectives)` — completed
      // counts a subset of total, so the expression was mathematically always
      // 0 and the `* 0.1` reward term could never pay out.
      const bonusObjectivesCompleted = objectives.filter(
        (o: any) => o.isBonus && o.completed,
      ).length;

      const performance: PerformanceMetrics = {
        timeElapsed,
        stealthScore,
        efficiencyScore,
        bonusObjectivesCompleted,
      };

      // Calculate rewards
      const rewards = this.calculateRewards(mission, performance);

      // The status flip already happened, atomically, in the claim above.
      // The counter is now a SEPARATE statement — it can no longer ride the
      // same write as the blob, because the blob write lives inside the lock.
      // Accepted trade: a crash between them leaves a stat counter one short,
      // which is strictly less bad than the double-reward the claim closes.
      await this.playerProgress.incrementCounter(userId, "missionsCompleted");

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
        // The story ledger records the mission TYPE and read it as `data.type`,
        // which this payload never had — only the per-objective types below.
        // `mission.type` is in scope and is what the ledger meant.
        missionType: mission.type,
        factionId: mission.factionId || undefined,
        targetServerId: (mission as any).targetServerId || undefined,
        objectives: ((mission.objectives as any[]) || []).map((obj: any) => ({
          type: obj.type,
          metadata: obj.metadata || {},
        })),
      });

      // ═══ Mission Feedback — AI learns from outcomes ═══
      // Grade the mission difficulty relative to the player.
      // Read AFTER `grantRewards` on purpose: the level may have just gone up,
      // and grading against the pre-reward level would misreport the mission as
      // harder than it was. Narrowed to the one column — the whole-row
      // `findUnique` this replaces existed only to reach the blob.
      const playerLevel =
        (
          await this.prisma.playerProgress.findUnique({
            where: { userId },
            select: { level: true },
          })
        )?.level ?? 1;
      const timeToCompleteMin = Math.round(timeElapsed / 60000);
      const expectedTimeMin = mission.difficulty * 5; // ~5 min per difficulty level as baseline
      const levelDiffRatio = playerLevel / Math.max(1, mission.difficulty);

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
        playerLevel,
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
      // S5c: bound the stored blob before it is multiplied.
      //
      // This was `mission.reward as unknown as MissionRewards` — a cast, so a
      // row written before these bounds existed (or edited by hand) arrives
      // unchecked. It matters that this runs BEFORE the multiplier: JS coerces
      // in `baseRewards.credits * multiplier`, so the STRING "1000000000"
      // would multiply happily and never trip a `typeof` check downstream.
      const baseRewards: MissionRewards = boundMissionRewards(mission.reward);

      // Calculate multipliers based on performance
      let multiplier = 1.0;

      // Time bonus (faster completion = higher multiplier)
      // R7: one conversion point. `timeElapsed` is ms; `timeLimit` is seconds.
      const limitMs = missionTimeLimitMs(mission.timeLimit);
      if (limitMs !== null && performance.timeElapsed < limitMs) {
        const timeRatio = performance.timeElapsed / limitMs;
        multiplier += (1 - timeRatio) * 0.5; // Up to 50% bonus
      }

      // R7 + review: efficiency is a LIVE signal again.
      //
      // Bonus objectives became optional in the same change, so a mission can
      // now complete with `completed < total` and this score genuinely varies
      // — a 3-objective mission finished without its bonus scores 67 and does
      // not earn this. Folding it into the flat constant (as the first draft
      // did) would have overpaid exactly the player who skipped the optional
      // work, and deleted the incentive to do it.
      if (performance.efficiencyScore > 90) {
        multiplier += 0.15;
      }

      // Stealth, by contrast, IS still constant.
      //
      // `stealthScore` is `100 - detectionCount*15 - hintCount*5`, and nothing
      // in the codebase writes either input — so it is pinned at 100, its
      // `> 80` threshold always passed, and it paid a flat +0.2 while reading
      // as a skill bonus. Same value, honest name. A full completion therefore
      // still earns the historical +0.35 (0.2 here plus 0.15 for efficiency
      // above); only a bonus-skipping completion now earns less, which is the
      // point.
      //
      // `stealthScore` is still computed: mission grading and the AI feedback
      // line consume it, which is a fair use of a constant in a way that
      // calling it a "bonus" was not.
      multiplier += BASELINE_COMPLETION_BONUS;

      // Bonus objectives — now able to vary, see `bonusObjectivesCompleted`.
      multiplier += performance.bonusObjectivesCompleted * 0.1;

      // Apply multiplier, then bound AGAIN — the multiplier reaches ~2.35x
      // (1.0 + 0.5 time + 0.15 efficiency + 0.2 baseline + 0.1 per bonus
      // objective), so clamping only the stored value would leave the amount
      // actually granted unbounded by that factor. This is the last point
      // before `grantRewards` calls addCredits/addExperience.
      const finalRewards: MissionRewards = boundMissionRewards({
        xp: Math.floor(baseRewards.xp * multiplier),
        credits: Math.floor(baseRewards.credits * multiplier),
        items: baseRewards.items,
        reputation: baseRewards.reputation,
        skillPoints: baseRewards.skillPoints,
        unlocks: baseRewards.unlocks,
      });

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
      // ── D5: increments, not absolute writes ────────────────────────────
      // This method used to read `progress` once and then write
      // `experience = progress.experience + rewards.xp` and
      // `credits = progress.credits + rewards.credits` — absolute values from a
      // stale read, outside any transaction, while `hackService` concurrently
      // issued `{ increment }` against the same row. A hack award landing
      // between the read and the write was silently erased. Every field below
      // is now a relative update, so concurrent grants add up instead of
      // clobbering each other.
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
        select: { userId: true },
      });

      if (!progress) {
        throw new Error("Player progress not found");
      }

      /** Level after the XP grant, for the `rewards:xp_granted` event below. */
      let grantedLevel = 0;

      if (rewards.credits > 0) {
        await this.playerProgress.addCredits(userId, rewards.credits);
      }

      if (rewards.reputation) {
        // Reputation is not a repository concern (it is per-faction and has its
        // own service); increment it here rather than assigning from a stale read.
        await this.prisma.playerProgress.updateMany({
          where: { userId },
          data: { repNeutral: { increment: rewards.reputation } },
        });
      }

      if (rewards.xp > 0) {
        // `addExperience` recomputes `level` from the POST-increment total and
        // only ever raises it, so a racing grant cannot lower it. Note this
        // method used to be the ONLY place `level` was written at all.
        const xp = await this.playerProgress.addExperience(userId, rewards.xp);
        grantedLevel = xp.level;

        if (xp.leveledUp) {
          if (this.io) {
            this.io.to(`player:${userId}`).emit("player:levelup", {
              newLevel: xp.level,
              experience: xp.experience,
              userId,
            });
            await notifyUser(this.io, userId, {
              type: "levelup",
              category: "game",
              title: "Level Up!",
              message: `You reached Level ${xp.level}!`,
              priority: "high",
              data: { newLevel: xp.level },
            });
          }
          // Emit for internal listeners (dynamic content, etc.)
          this.emit("player:levelup", {
            userId,
            newLevel: xp.level,
            experience: xp.experience,
          });
        }
      }

      // Send reward notification toast
      if (this.io && (rewards.xp > 0 || rewards.credits > 0)) {
        const parts: string[] = [];
        if (rewards.xp > 0) parts.push(`+${rewards.xp} XP`);
        if (rewards.credits > 0) parts.push(`+${rewards.credits} Credits`);
        if (rewards.skillPoints && rewards.skillPoints > 0) parts.push(`+${rewards.skillPoints} Skill Points`);
        await notifyUser(this.io, userId, {
          type: "reward",
          category: "mission",
          title: "Rewards",
          message: parts.join(", "),
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

            await this.grantInventoryItem(userId, shopItem, "mission_reward");

            // Notify the player
            if (this.io) {
              await notifyUser(this.io, userId, {
                type: "item",
                category: "mission",
                title: "Item Acquired",
                message: `You received: ${shopItem.name}`,
                data: { itemId: shopItem.id, itemName: shopItem.name },
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
          newLevel: grantedLevel,
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

    await this.grantInventoryItem(userId, shopItem, "mission_reward");

    // Notify the player
    if (this.io) {
      await notifyUser(this.io, userId, {
        type: "item",
        category: "mission",
        title: "Rare Drop!",
        message: `You found: ${shopItem.name}`,
        data: { itemId: shopItem.id, itemName: shopItem.name },
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
      // ── D3: this method WAS the headline race ──────────────────────────
      // It loaded every player's blob up front with a bare
      // `playerProgress.findMany()` (no where/select/take, four JSON blobs per
      // player), then per player awaited an audit-log write AND a
      // `mission.update` BEFORE writing its copy back. That window is two round
      // trips wide, and the player is racing it with their own commands: a
      // mission completed inside it was reverted to `active` by the sweep's
      // stale copy, after which the `"already completed"` guard passed a second
      // time and **rewards were granted twice**.
      //
      // Two changes, and both matter:
      //   1. the read-modify-write runs inside `mutateAll`, so it is one
      //      critical section per player rather than a stale snapshot; and
      //   2. the side effects (socket emit, audit log, mission row) moved OUT
      //      of that section — they are what made the window wide, and none of
      //      them needs to see the blob.
      // Reproduced and pinned by `verify-phase3-d3-mission-lock.ts`, whose
      // negative control still shows the old shape clobbering a completion.
      // PASS 2: one indexed query replaces "read every player's blob and filter
      // in JS". The pass-1 version already fixed the clobbering, but it still
      // had to scan every player, because `status = active AND expiresAt < now`
      // is not expressible as a predicate over a JSON map keyed by mission id.
      const due = await this.playerMissions.findExpired(new Date());

      for (const { userId, missionId } of due) {
        // Still through `mutate`, and still serialised: a player completing
        // this exact mission right now must win or lose cleanly, not both.
        // `NO_CHANGE` covers the case where they completed it between the query
        // above and the lock below — then there is nothing to expire and no
        // event to emit.
        let expired = false;
        await this.playerMissions.mutate(userId, missionId, (playerMission) => {
          if (!playerMission || playerMission.status !== "active") return NO_CHANGE;
          playerMission.status = "expired";
          expired = true;
          return playerMission;
        });

        if (!expired) continue;

        // Side effects only after the lock is released — they are what made the
        // original sweep's window two round trips wide.
        if (this.io) {
          this.io.to(`player:${userId}`).emit("mission:expired", { missionId });
        }

        // R12: expiry is a failure as far as the story is concerned, so the
        // Node event fires here too. The socket event above only tells the
        // player's client; it is `mission:failed` that advances the arc and
        // writes the ledger entry.
        this.emit("mission:failed", {
          missionId,
          userId,
          reason: "expired",
        });
        await this.auditLog(userId, "MISSION_EXPIRED", { missionId });
        await this.prisma.mission.update({
          where: { id: missionId },
          data: { status: "available", assignedTo: null },
        });
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
      // D3: serialised. Manually expiring a mission is the same race the sweep
      // had — without the lock it could overwrite a completion in flight.
      await this.playerMissions.mutate(userId, missionId, (playerMission) => {
        if (!playerMission) {
          throw new Error("Mission not assigned to player");
        }
        playerMission.status = "expired";
        return playerMission;
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
  // `calculateLevel` lived here as a private copy, with an identical twin in
  // `missionGenerator`. The curve decides mission difficulty matching, shop
  // `requiredLevel` gates and the player's base CPU/RAM/bandwidth, so two
  // copies is two places for it to drift. It is now `levelForExperience` in
  // `repositories/playerProgressRepository`, beside the only code that writes
  // the column it derives.

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
import { container } from "tsyringe";
import { MISSION_SERVICE } from "../di/tokens";
import { missionExpiresAt, missionTimeLimitMs } from "../utils/missionTime";
import { requiredObjectivesComplete } from "../utils/missionCompletion";
import { BASELINE_COMPLETION_BONUS, MAX_ACTIVE_MISSIONS, MISSION_EXPIRATION_INTERVAL_MS } from "../config/gameBalance";
import { boundMissionRewards, boundMissionDifficulty } from "../utils/missionRewards";
export const missionService = new Proxy({} as MissionService, {
  get(_target, prop) {
    const instance = container.resolve(MISSION_SERVICE as any);
    return (instance as any)[prop];
  },
});
