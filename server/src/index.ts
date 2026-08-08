import "reflect-metadata";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import logger from "./logger";

import { config, validateConfig, CORS_ORIGINS } from "./config/environment";
import { db } from "./database/client";
import { initializeContainer, getService } from "./di/container";
import {
  GAME_STATE_MANAGER,
  PROGRESS_SERVICE,
  IP_SERVICE,
  EVENT_SERVICE,
  PERSONA_SERVICE,
  AI_SCHEDULER_SERVICE,
  HACK_SERVICE,
  MISSION_SERVICE,
  MESSAGE_SERVICE,
  RESOURCE_SERVICE,
  WARFARE_SERVICE,
  CENSORSHIP_SERVICE,
  DYNAMIC_CONTENT_SERVICE,
  STORY_MISSION_SERVICE,
  ACHIEVEMENT_SERVICE,
  TUTORIAL_SERVICE,
  FACTION_SERVICE,
  STORY_PROGRESSION_SERVICE,
  FORUM_SERVICE,
  ARCHITECT_INTERVENTION_EXECUTOR,
  DARKNET_DUNGEON_SERVICE,
  KEY_FRAGMENT_SERVICE,
} from "./di/tokens";

import type GameStateManager from "./services/gameStateManager";
import type ProgressService from "./services/progressService";
import type IPService from "./services/ipService";
import type EventService from "./services/eventService";
import type { PersonaService } from "./services/personaService";
import type AISchedulerService from "./services/aiSchedulerService";
import type HackService from "./services/hackService";
import type MissionService from "./services/missionService";
import type { DynamicContentService } from "./services/dynamicContentService";
import type { StoryMissionService } from "./services/storyMissionService";
import type MessageService from "./services/messageService";
import type { TutorialService } from "./services/tutorialService";
import type { StoryProgressionService } from "./services/storyProgressionService";
import type { ArchitectInterventionExecutor } from "./services/architectInterventionExecutor";
import type { DarkNetDungeonService } from "./services/darknetDungeonService";
import type { FactionService } from "./services/factionService";
import type { ForumService } from "./services/forumService";

// Extracted modules
import {
  setupMiddleware,
  setupRoutes,
  setupErrorHandling,
} from "./middleware/setup";
import { setupSocketHandlers } from "./sockets/handlers";
import { registerShutdownHandlers } from "./lifecycle";
import {
  ARCHITECT_EVAL_INTERVAL_MS,
  DUNGEON_EXPIRATION_INTERVAL_MS,
} from "./config/gameBalance";

// ── Infrastructure ────────────────────────────────────────────────
const app = express();
const server = createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// ── Initialization ────────────────────────────────────────────────
async function initialize(): Promise<void> {
  // 1. Validate configuration
  validateConfig();
  logger.info("✅ Configuration validated");

  // 2. Connect to database
  await db.connect();
  logger.info("✅ Database connection established");

  // 3. Initialize DI Container (registers all services)
  initializeContainer(io, db.client, logger);
  logger.info("✅ DI Container initialized");

  // 4. Eager-initialize services that need startup work
  const ipService = getService<IPService>(IP_SERVICE);
  await ipService.loadAllocatedIPs();
  logger.info("✅ IP Service initialized");

  const progressService = getService<ProgressService>(PROGRESS_SERVICE);
  progressService.start();
  logger.info("✅ Progress Service started");

  const eventService = getService<EventService>(EVENT_SERVICE);
  await eventService.loadSubscriptionsFromDatabase();
  logger.info("✅ Event subscriptions loaded");

  // GameStateManager is resolved to trigger its constructor/cleanup timer
  getService<GameStateManager>(GAME_STATE_MANAGER);
  logger.info("✅ Game State Manager initialized");

  // 5. Wire AI integration: connect persona event listeners and start scheduler
  const personaService = getService<PersonaService>(PERSONA_SERVICE);
  const hackService = getService<HackService>(HACK_SERVICE);
  const missionService = getService<MissionService>(MISSION_SERVICE);
  const factionService = getService<FactionService>(FACTION_SERVICE);
  void getService<ForumService>(FORUM_SERVICE); // side-effect initialization

  // 5b. Initialize Story Progression (The Architect's staging engine)
  const storyProgression = getService<StoryProgressionService>(
    STORY_PROGRESSION_SERVICE,
  );
  await storyProgression.initializeFirstEpoch();
  logger.info("✅ Story Progression initialized (Epoch 0)");

  // 5c. Initialize AI content review pipeline + epoch scheduler
  const { ContentDraftService } = await import("./services/contentDraftService");
  const { ReferenceValidationService } = await import("./services/referenceValidationService");
  const { EpochSchedulerService } = await import("./services/epochSchedulerService");
  const { CONTENT_DRAFT_SERVICE, REFERENCE_VALIDATION_SERVICE, EPOCH_SCHEDULER_SERVICE } = await import("./di/tokens");

  const contentDraftService = getService<InstanceType<typeof ContentDraftService>>(CONTENT_DRAFT_SERVICE);
  const refValidation = getService<InstanceType<typeof ReferenceValidationService>>(REFERENCE_VALIDATION_SERVICE);
  const epochScheduler = getService<InstanceType<typeof EpochSchedulerService>>(EPOCH_SCHEDULER_SERVICE);

  // Late-bind services to avoid circular DI
  refValidation.setDraftService(contentDraftService);
  epochScheduler.setDraftService(contentDraftService);
  epochScheduler.start();
  logger.info("✅ Content Draft + Reference Validation + Epoch Scheduler initialized");

  // 6. Wire dynamic content hooks to game events
  //
  // All event side-effects are deferred via queueMicrotask so the EventEmitter
  // returns immediately. This prevents slow handlers (AI calls, DB writes)
  // from blocking event delivery to other listeners.
  const dynamicContent = getService<DynamicContentService>(
    DYNAMIC_CONTENT_SERVICE,
  );

  /** Fire-and-forget async work without blocking the event emitter. */
  const defer = (fn: () => Promise<unknown>, label: string) => {
    queueMicrotask(() => {
      fn().catch((err) => logger.error({ err }, label));
    });
  };

  hackService.on("hack:detected", (data: any) => {
    defer(() => dynamicContent.processEvent("hack:detected", data), "Dynamic content error on hack:detected");
  });

  // Single unified hack:attempt handler — dynamic content, story ledger, persona, achievements
  hackService.on("hack:attempt", (data: any) => {
    defer(() => dynamicContent.processEvent("hack:attempt", data), "Dynamic content error on hack:attempt");
    if (data.result?.success || data.success) {
      defer(() => storyProgression.recordEvent({
        type: "hack",
        category: "combat",
        actorId: data.attackerId || data.userId,
        actorType: "player",
        summary: `Player hacked server ${data.serverName || data.targetServerId || data.serverId}`,
        data: {
          serverId: data.targetServerId || data.serverId,
          serverName: data.serverName,
          method: data.method,
        },
        impact: { tension: 1 },
        weight: 3,
      }), "Story ledger error on hack");
      defer(() => personaService.onServerHacked({
        userId: data.attackerId,
        serverId: data.targetServerId,
        serverName: data.serverName,
        difficulty: data.difficulty,
      }), "Persona error on hack:attempt");
      if (data.attackerId) {
        defer(() => achievementService.checkAndAward(data.attackerId), "Achievement check error after hack");
      }
    }
  });

  hackService.on("ids_alert", (data: any) => {
    defer(() => dynamicContent.processEvent("ids_alert", data), "Dynamic content error on ids_alert");
    // Push IDS alert to player via Socket.IO
    io.to(`player:${(data as any).targetUserId}`).emit("command:result", {
      success: false,
      output: (data as any).message,
      timestamp: new Date(),
    });
  });

  hackService.on("bounty:posted", (data: any) => {
    defer(() => dynamicContent.processEvent("bounty:posted", data), "Dynamic content error on bounty:posted");
  });

  // Resolve services needed by event handlers below
  const storyMissionService = getService<StoryMissionService>(STORY_MISSION_SERVICE);
  const achievementService = getService<import("./services/achievementService").AchievementService>(ACHIEVEMENT_SERVICE);

  missionService.on("mission:completed", (data: any) => {
    defer(() => personaService.onMissionCompleted(data), "Persona error on mission:completed");
    defer(() => dynamicContent.processEvent("mission:completed", data), "Dynamic content error on mission:completed");
    if (data.userId)
      defer(() => achievementService.checkAndAward(data.userId), "Achievement check error on mission:completed");
    if (data.missionId)
      defer(() => storyMissionService.advanceStory(data.missionId, "completed"), "Story mission advance error on mission:completed");
    defer(() => storyProgression.recordEvent({
      type: "player_choice",
      category: "narrative",
      actorId: data.userId,
      actorType: "player",
      summary: `Completed mission: ${data.title || data.missionId}`,
      data: { missionId: data.missionId, type: data.type, factionId: data.factionId },
      impact: data.factionId ? { factions: { [data.factionId]: 2 } } : {},
      weight: 4,
    }), "Story ledger error on mission:completed");
  });

  missionService.on("mission:failed", (data: any) => {
    if (data.missionId)
      defer(() => storyMissionService.advanceStory(data.missionId, "failed"), "Story mission advance error on mission:failed");
    defer(() => storyProgression.recordEvent({
      type: "player_choice",
      category: "narrative",
      actorId: data.userId,
      actorType: "player",
      summary: `Failed mission: ${data.missionId}`,
      data: { missionId: data.missionId, reason: data.reason },
      weight: 2,
    }), "Story ledger error on mission:failed");
  });

  // Mission feedback → AI learns from outcomes
  missionService.on("mission:feedback", (data: any) => {
    defer(async () => {
      // Record as faction leader knowledge (if faction mission)
      if (data.factionId) {
        const factionLeader = await db.client.aIPersona.findFirst({
          where: { type: "faction_leader", faction: { id: data.factionId } },
          select: { id: true },
        });
        if (factionLeader) {
          const gradeEmoji = data.difficultyGrade === "too_easy" ? "trivial" : data.difficultyGrade === "too_hard" ? "overwhelming" : "well-calibrated";
          const abandonNote = data.abandoned ? " (ABANDONED)" : "";
          await personaService.addKnowledge(factionLeader.id, {
            source: "mission_feedback",
            type: "mission_feedback",
            content: `Mission feedback${abandonNote}: Level ${data.playerLevel} operative graded difficulty-${data.missionDifficulty} ${data.missionType} mission as "${gradeEmoji}". Time: ${data.timeToCompleteMin}min. Efficiency: ${data.efficiencyScore}%. Objectives: ${data.objectiveTypes.join(", ")}.`,
            confidence: 1.0,
          });
        }
      }

      // Also inform the Game Master
      const gm = await db.client.aIPersona.findFirst({
        where: { type: "game_master" },
        select: { id: true },
      });
      if (gm) {
        await personaService.addKnowledge(gm.id, {
          source: "mission_feedback",
          type: "mission_feedback",
          content: `Mission outcome: Level ${data.playerLevel} player ${data.abandoned ? "abandoned" : "completed"} difficulty-${data.missionDifficulty} ${data.missionType} mission. Grade: ${data.difficultyGrade}. Time: ${data.timeToCompleteMin}min.`,
          confidence: 1.0,
        });
      }
    }, "Mission feedback knowledge error");
  });

  // Faction events → story ledger
  factionService.on("faction:member_joined", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player joined faction ${data.factionName || data.factionId}`,
      data: { factionId: data.factionId },
      impact: { factions: { [data.factionId]: 5 } }, weight: 5,
    }), "Story ledger error on faction:member_joined");
    defer(() => dynamicContent.processEvent("faction:member_joined", data), "Dynamic content error on faction:member_joined");
  });

  factionService.on("faction:member_left", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player left faction ${data.factionName || data.factionId}`,
      data: { factionId: data.factionId },
      impact: { factions: { [data.factionId]: -5 } }, weight: 4,
    }), "Story ledger error on faction:member_left");
    defer(() => dynamicContent.processEvent("faction:member_left", data), "Dynamic content error on faction:member_left");
  });

  factionService.on("faction:reputation_changed", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player reputation changed with faction ${data.factionId}: ${data.amount > 0 ? "+" : ""}${data.amount} (now ${data.newReputation})`,
      data: { factionId: data.factionId, amount: data.amount, newReputation: data.newReputation },
      impact: { factions: { [data.factionId]: data.amount > 0 ? 1 : -1 } }, weight: 2,
    }), "Story ledger error on faction:reputation_changed");
  });

  factionService.on("faction:rank_achieved", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player achieved rank ${data.newRank} in faction ${data.factionId}`,
      data: { factionId: data.factionId, newRank: data.newRank },
      impact: { factions: { [data.factionId]: 3 } }, weight: 5,
    }), "Story ledger error on faction:rank_achieved");
  });

  // Key Fragment Service events
  const keyFragmentService =
    getService<import("./services/keyFragmentService").KeyFragmentService>(
      KEY_FRAGMENT_SERVICE,
    );

  keyFragmentService.on("fragment:claimed", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "fragment_claimed", category: "discovery", actorId: data.userId, actorType: "player",
      summary: `Player claimed AIDA fragment: ${data.name} (${data.keyType} ${data.fragmentNum}/3)`,
      data: { fragmentId: data.fragmentId, keyType: data.keyType, fragmentNum: data.fragmentNum },
      impact: { discoveryWeight: 5, tension: 2 }, weight: 7,
    }), "Story ledger error on fragment:claimed");
    defer(() => dynamicContent.processEvent("fragment:claimed", data), "Dynamic content error on fragment:claimed");
  });

  keyFragmentService.on("fragment:stolen", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "fragment_stolen", category: "conflict", actorId: data.attackerUserId, actorType: "player",
      targetId: data.victimUserId, targetType: "player",
      summary: `Player stole AIDA fragment ${data.name} (${data.keyType}) from another player`,
      data: { fragmentId: data.fragmentId, keyType: data.keyType, fragmentNum: data.fragmentNum, attackerUserId: data.attackerUserId, victimUserId: data.victimUserId },
      impact: { discoveryWeight: 7, tension: 4 }, weight: 8,
    }), "Story ledger error on fragment:stolen");
    defer(() => dynamicContent.processEvent("fragment:stolen", data), "Dynamic content error on fragment:stolen");
  });

  keyFragmentService.on("fragment:transferred", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "fragment_transferred", category: "social", actorId: data.fromUserId, actorType: "player",
      targetId: data.toUserId, targetType: "player",
      summary: `Player traded AIDA fragment ${data.name} (${data.keyType}) to another player`,
      data: { fragmentId: data.fragmentId, keyType: data.keyType, fragmentNum: data.fragmentNum, fromUserId: data.fromUserId, toUserId: data.toUserId },
      impact: { discoveryWeight: 3, tension: 1 }, weight: 6,
    }), "Story ledger error on fragment:transferred");
  });

  keyFragmentService.on("endgame:unlocked", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "endgame_unlocked", category: "milestone", actorId: data.userId, actorType: "player",
      summary: "A player has collected all 9 AIDA fragments. The endgame is unlocked.",
      data: { userId: data.userId },
      impact: { discoveryWeight: 10, tension: 5 }, weight: 10,
    }), "Story ledger error on endgame:unlocked");
  });

  keyFragmentService.on("endgame:completed", (data: any) => {
    defer(() => storyProgression.recordEvent({
      type: "endgame_completed", category: "milestone", actorId: data.userId, actorType: "player",
      summary: `A player has completed the endgame. Choice: ${data.choice}`,
      data: { userId: data.userId, choice: data.choice },
      impact: { discoveryWeight: 10, tension: 10 }, weight: 10,
    }), "Story ledger error on endgame:completed");
    defer(() => dynamicContent.processEvent("endgame:completed", data), "Dynamic content error on endgame:completed");
  });

  // Level up → dynamic content (home server log)
  missionService.on("player:levelup", (data: any) => {
    defer(() => dynamicContent.processEvent("player:levelup", data), "Dynamic content error on player:levelup");
  });

  // Tutorial system: advance tutorial when tutorial missions complete
  const tutorialService = getService<TutorialService>(TUTORIAL_SERVICE);

  missionService.on("mission:completed", (data: any) => {
    if (data.userId) {
      defer(() => tutorialService.advanceTutorial(data.userId, data.missionId), "Tutorial advance error on mission:completed");
    }
  });

  // Wire message hook: intercept replies to The Architect for training hints
  const msgSvc = getService<MessageService>(MESSAGE_SERVICE);
  msgSvc.onPrivateMessageSent((senderId, recipientId, content, subject) => {
    defer(() => tutorialService.handlePlayerReply(senderId, recipientId, content, subject), "Tutorial reply handler error");
  });

  logger.info("✅ Tutorial service initialized");

  await personaService.setupEventListeners();
  logger.info("✅ Persona event listeners configured");

  const aiScheduler = getService<AISchedulerService>(AI_SCHEDULER_SERVICE);
  aiScheduler.startScheduler().catch((err) => {
    logger.error({ err }, "AI Scheduler failed to start");
  });
  logger.info("✅ AI Scheduler started");

  // Resolve the Architect Intervention Executor
  const interventionExecutor = getService<ArchitectInterventionExecutor>(
    ARCHITECT_INTERVENTION_EXECUTOR,
  );

  // Periodic Architect evaluation — every 2 hours
  setInterval(
    async () => {
      try {
        const evaluation = await storyProgression.evaluateAndAct();
        if (evaluation) {
          logger.info(`[Architect] Evaluated: ${evaluation.narrativeSummary}`);
          logger.info(
            `[Architect] Interventions: ${evaluation.interventions.length}`,
          );

          // Execute interventions — each one is independent, failures don't block others
          if (evaluation.interventions.length > 0) {
            const results = await interventionExecutor.executeBatch(
              evaluation.interventions,
            );
            const succeeded = results.filter((r) => r.success).length;
            const failed = results.length - succeeded;
            logger.info(
              `[Architect] Intervention execution complete: ${succeeded} succeeded, ${failed} failed`,
            );
          }
        }
      } catch (err) {
        logger.error({ err }, "[Architect] Evaluation error");
      }
    },
    ARCHITECT_EVAL_INTERVAL_MS,
  );
  logger.info("✅ Architect periodic evaluation scheduled (every 2h)");

  // Initialize DarkNet Dungeon system — ensure at least one active dungeon
  const dungeonService = getService<DarkNetDungeonService>(
    DARKNET_DUNGEON_SERVICE,
  );
  try {
    await dungeonService.ensureActiveDungeon();
    logger.info("✅ DarkNet Dungeon system initialized");
  } catch (err) {
    logger.warn(
      { err },
      "DarkNet Dungeon initialization failed (non-critical)",
    );
  }

  // Periodic dungeon expiration check — every 1 hour
  setInterval(
    async () => {
      try {
        await dungeonService.expireOldDungeons();
      } catch (err) {
        logger.error({ err }, "Dungeon expiration check failed");
      }
    },
    DUNGEON_EXPIRATION_INTERVAL_MS,
  );
  logger.info("✅ DarkNet Dungeon expiration checker scheduled (every 1h)");

  // Tier 3: Batch-provision all seeded servers that lack content
  try {
    const { SERVER_CONTENT_SERVICE } = await import("./di/tokens");
    const contentService = getService<any>(SERVER_CONTENT_SERVICE);
    if (contentService?.provisionAllUnpopulatedServers) {
      contentService.provisionAllUnpopulatedServers().catch((err: unknown) => {
        logger.warn({ err }, "Batch server content provisioning failed (non-critical)");
      });
      logger.info("✅ Server content batch provisioning started");
    }
  } catch {
    logger.debug("ServerContentService not available for batch provisioning");
  }

  const resourceService =
    getService<import("./services/resourceService").default>(RESOURCE_SERVICE);
  resourceService.startResourceGeneration();
  logger.info("✅ Resource generation started");

  // Start warfare monitor
  const warfareService =
    getService<import("./services/warfareService").default>(WARFARE_SERVICE);
  warfareService.startWarMonitor();
  logger.info("✅ Warfare monitor started");

  // Start mission expiration checker (every 15 min)
  missionService.startExpirationChecker();
  logger.info("✅ Mission expiration checker started");

  // Load censorship rules (seed defaults if none exist)
  const censorshipService =
    getService<import("./services/censorshipService").default>(
      CENSORSHIP_SERVICE,
    );
  await censorshipService.seedDefaultRules();
  logger.info("✅ Censorship rules loaded");

  // 6. Setup Express middleware & routes
  setupMiddleware(app);
  logger.info("✅ Middleware configured");

  await setupRoutes(app);
  logger.info("✅ Routes configured");

  // 7. Setup Socket.IO handlers
  setupSocketHandlers(io);
  logger.info("✅ Socket.IO handlers configured");

  // 8. Setup error handling & graceful shutdown
  setupErrorHandling(app);
  registerShutdownHandlers(server, io);
  logger.info("✅ Error handling configured");

  logger.info("AIDA Server initialized successfully");
}

// ── Start ─────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await initialize();

  const ipService = getService<IPService>(IP_SERVICE);

  server.listen(config.PORT, config.HOST, () => {
    logger.info(
      {
        env: config.NODE_ENV,
        host: config.HOST,
        port: config.PORT,
        allocatedIPs: ipService.getAllocatedIPsCount(),
        autoSaveInterval: config.AUTO_SAVE_INTERVAL_SECONDS,
      },
      "AIDA Multiplayer Server started",
    );
  });
}

if (require.main === module) {
  start().catch((error) => {
    logger.fatal({ err: error }, "Failed to start server");
    process.exit(1);
  });
}

export { app, server, io };
export default { start, initialize };
