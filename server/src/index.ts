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
  RESOURCE_SERVICE,
  WARFARE_SERVICE,
  CENSORSHIP_SERVICE,
} from "./di/tokens";

import type GameStateManager from "./services/gameStateManager";
import type ProgressService from "./services/progressService";
import type IPService from "./services/ipService";
import type EventService from "./services/eventService";
import type { PersonaService } from "./services/personaService";
import type AISchedulerService from "./services/aiSchedulerService";
import type HackService from "./services/hackService";
import type MissionService from "./services/missionService";

// Extracted modules
import { setupMiddleware, setupRoutes, setupErrorHandling } from "./middleware/setup";
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

  hackService.on("hack:attempt", (data: any) => {
    if (data.result?.success) {
      personaService.onServerHacked({
        userId: data.attackerId,
        serverId: data.targetServerId,
        serverName: data.serverName,
        difficulty: data.difficulty,
      }).catch(() => {});
    }
  });

  missionService.on("mission:completed", (data: any) => {
    personaService.onMissionCompleted(data).catch(() => {});
  });

  await personaService.setupEventListeners();
  logger.info("✅ Persona event listeners configured");

  const aiScheduler = getService<AISchedulerService>(AI_SCHEDULER_SERVICE);
  aiScheduler.startScheduler().catch((err) => {
    logger.error({ err }, "AI Scheduler failed to start");
  });
  logger.info("✅ AI Scheduler started");

  const resourceService = getService<import("./services/resourceService").default>(RESOURCE_SERVICE);
  resourceService.startResourceGeneration();
  logger.info("✅ Resource generation started");

  // Start warfare monitor
  const warfareService = getService<import("./services/warfareService").default>(WARFARE_SERVICE);
  warfareService.startWarMonitor();
  logger.info("✅ Warfare monitor started");

  // Load censorship rules (seed defaults if none exist)
  const censorshipService = getService<import("./services/censorshipService").default>(CENSORSHIP_SERVICE);
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
    logger.info({
      env: config.NODE_ENV,
      host: config.HOST,
      port: config.PORT,
      allocatedIPs: ipService.getAllocatedIPsCount(),
      autoSaveInterval: config.AUTO_SAVE_INTERVAL_SECONDS,
    }, "AIDA Multiplayer Server started");
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
