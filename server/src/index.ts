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
  const forumService = getService<ForumService>(FORUM_SERVICE);

  // 5b. Initialize Story Progression (The Architect's staging engine)
  const storyProgression = getService<StoryProgressionService>(
    STORY_PROGRESSION_SERVICE,
  );
  await storyProgression.initializeFirstEpoch();
  logger.info("✅ Story Progression initialized (Epoch 0)");

  // 6. Wire dynamic content hooks to game events
  const dynamicContent = getService<DynamicContentService>(
    DYNAMIC_CONTENT_SERVICE,
  );

  hackService.on("hack:detected", (data: any) => {
    dynamicContent.processEvent("hack:detected", data).catch(() => {});
  });

  hackService.on("hack:attempt", (data: any) => {
    dynamicContent.processEvent("hack:attempt", data).catch(() => {});
    if (data.result?.success || data.success) {
      storyProgression
        .recordEvent({
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
        })
        .catch((err) => console.error("Story ledger error:", err));
    }
  });

  hackService.on("ids_alert", (data: any) => {
    dynamicContent.processEvent("ids_alert", data).catch(() => {});
  });

  hackService.on("bounty:posted", (data: any) => {
    dynamicContent.processEvent("bounty:posted", data).catch(() => {});
  });

  // IDS alerts: push to player via Socket.IO
  hackService.on(
    "ids_alert",
    (data: { targetUserId: string; message: string; severity: string }) => {
      io.to(`player:${data.targetUserId}`).emit("command:result", {
        success: false,
        output: data.message,
        timestamp: new Date(),
      });
    },
  );

  hackService.on("hack:attempt", (data: any) => {
    if (data.result?.success) {
      personaService
        .onServerHacked({
          userId: data.attackerId,
          serverId: data.targetServerId,
          serverName: data.serverName,
          difficulty: data.difficulty,
        })
        .catch(() => {});
      // Check achievements after successful hack
      if (data.attackerId) {
        // Lazy-load to avoid ordering issues (achievementService resolved later)
        try {
          const achSvc =
            getService<
              import("./services/achievementService").AchievementService
            >(ACHIEVEMENT_SERVICE);
          achSvc.checkAndAward(data.attackerId).catch(() => {});
        } catch {
          /* service not yet available */
        }
      }
    }
  });

  // Story arc advancement on mission completion/failure
  const storyMissionService = getService<StoryMissionService>(
    STORY_MISSION_SERVICE,
  );

  // Achievement checks on key events
  const achievementService =
    getService<import("./services/achievementService").AchievementService>(
      ACHIEVEMENT_SERVICE,
    );

  missionService.on("mission:completed", (data: any) => {
    personaService.onMissionCompleted(data).catch(() => {});
    dynamicContent.processEvent("mission:completed", data).catch(() => {});
    if (data.userId)
      achievementService.checkAndAward(data.userId).catch(() => {});
    if (data.missionId) {
      storyMissionService
        .advanceStory(data.missionId, "completed")
        .catch(() => {});
    }
    storyProgression
      .recordEvent({
        type: "player_choice",
        category: "narrative",
        actorId: data.userId,
        actorType: "player",
        summary: `Completed mission: ${data.title || data.missionId}`,
        data: {
          missionId: data.missionId,
          type: data.type,
          factionId: data.factionId,
        },
        impact: data.factionId ? { factions: { [data.factionId]: 2 } } : {},
        weight: 4,
      })
      .catch((err) => console.error("Story ledger error:", err));
  });

  missionService.on("mission:failed", (data: any) => {
    if (data.missionId) {
      storyMissionService
        .advanceStory(data.missionId, "failed")
        .catch(() => {});
    }
    storyProgression
      .recordEvent({
        type: "player_choice",
        category: "narrative",
        actorId: data.userId,
        actorType: "player",
        summary: `Failed mission: ${data.missionId}`,
        data: { missionId: data.missionId, reason: data.reason },
        weight: 2,
      })
      .catch((err) => console.error("Story ledger error:", err));
  });

  // Faction events → story ledger
  factionService.on("faction:member_joined", (data: any) => {
    storyProgression
      .recordEvent({
        type: "player_choice",
        category: "diplomacy",
        actorId: data.userId,
        actorType: "player",
        summary: `Player joined faction ${data.factionName || data.factionId}`,
        data: { factionId: data.factionId },
        impact: { factions: { [data.factionId]: 5 } },
        weight: 5,
      })
      .catch((err) => console.error("Story ledger error:", err));
  });

  // Key fragment discovery → story ledger
  forumService.on("key:fragment-found", (data: any) => {
    storyProgression
      .recordEvent({
        type: "fragment_found",
        category: "discovery",
        actorId: data.userId,
        actorType: "player",
        summary: `Player discovered key fragment: ${data.keyType || data.fragmentId}`,
        data: {
          fragmentId: data.fragmentId,
          keyType: data.keyType,
          fragmentNum: data.fragmentNum,
        },
        impact: { discoveryWeight: 3, tension: 1 },
        weight: 7,
      })
      .catch((err: any) => console.error("Story ledger error:", err));
  });

  // Faction member left → story ledger
  factionService.on("faction:member_left", (data: any) => {
    storyProgression
      .recordEvent({
        type: "player_choice",
        category: "diplomacy",
        actorId: data.userId,
        actorType: "player",
        summary: `Player left faction ${data.factionName || data.factionId}`,
        data: { factionId: data.factionId },
        impact: { factions: { [data.factionId]: -5 } },
        weight: 4,
      })
      .catch((err: any) => console.error("Story ledger error:", err));
  });

  // Faction reputation changed → story ledger
  factionService.on("faction:reputation_changed", (data: any) => {
    storyProgression
      .recordEvent({
        type: "player_choice",
        category: "diplomacy",
        actorId: data.userId,
        actorType: "player",
        summary: `Player reputation changed with faction ${data.factionId}: ${data.amount > 0 ? "+" : ""}${data.amount} (now ${data.newReputation})`,
        data: {
          factionId: data.factionId,
          amount: data.amount,
          newReputation: data.newReputation,
        },
        impact: { factions: { [data.factionId]: data.amount > 0 ? 1 : -1 } },
        weight: 2,
      })
      .catch((err: any) => console.error("Story ledger error:", err));
  });

  // Faction rank achieved → story ledger
  factionService.on("faction:rank_achieved", (data: any) => {
    storyProgression
      .recordEvent({
        type: "player_choice",
        category: "diplomacy",
        actorId: data.userId,
        actorType: "player",
        summary: `Player achieved rank ${data.newRank} in faction ${data.factionId}`,
        data: {
          factionId: data.factionId,
          newRank: data.newRank,
        },
        impact: { factions: { [data.factionId]: 3 } },
        weight: 5,
      })
      .catch((err: any) => console.error("Story ledger error:", err));
  });

  // Tutorial system: advance tutorial when tutorial missions complete
  const tutorialService = getService<TutorialService>(TUTORIAL_SERVICE);

  missionService.on("mission:completed", (data: any) => {
    if (data.userId) {
      tutorialService
        .advanceTutorial(data.userId, data.missionId)
        .catch(() => {});
    }
  });

  // Wire message hook: intercept replies to The Architect for training hints
  const msgSvc = getService<MessageService>(MESSAGE_SERVICE);
  msgSvc.onPrivateMessageSent((senderId, recipientId, content, subject) => {
    tutorialService
      .handlePlayerReply(senderId, recipientId, content, subject)
      .catch(() => {});
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
    2 * 60 * 60 * 1000,
  ); // 2 hours
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
    60 * 60 * 1000,
  ); // 1 hour
  logger.info("✅ DarkNet Dungeon expiration checker scheduled (every 1h)");

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
