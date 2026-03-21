import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import logger from "./logger";
import { db } from "./database/client";
import { getService } from "./di/container";
import { GAME_STATE_MANAGER, PROGRESS_SERVICE, AI_SCHEDULER_SERVICE, RESOURCE_SERVICE, WARFARE_SERVICE } from "./di/tokens";
import { stopCsrfCleanup } from "./middleware/csrf";
import type GameStateManager from "./services/gameStateManager";
import type ProgressService from "./services/progressService";
import type AISchedulerService from "./services/aiSchedulerService";
import type ResourceService from "./services/resourceService";

let isShuttingDown = false;

/**
 * Perform a graceful shutdown: save state, close connections, exit.
 */
export async function gracefulShutdown(
  signal: string,
  server: HttpServer,
  io: SocketIOServer,
): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, "Received signal, starting graceful shutdown");

  try {
    // Save all player progress
    const progressService = getService<ProgressService>(PROGRESS_SERVICE);
    logger.info("Saving all player progress");
    await progressService.saveAll("shutdown");
    progressService.stop();
    logger.info("Progress Service stopped");

    // Cleanup game state manager
    const gameStateManager = getService<GameStateManager>(GAME_STATE_MANAGER);
    await gameStateManager.cleanup();
    logger.info("Game State Manager cleaned up");

    // Stop AI scheduler
    try {
      const aiScheduler = getService<AISchedulerService>(AI_SCHEDULER_SERVICE);
      await aiScheduler.stopScheduler();
      logger.info("AI Scheduler stopped");
    } catch { /* Not fatal if scheduler wasn't started */ }

    // Stop resource generation
    try {
      const resourceService = getService<ResourceService>(RESOURCE_SERVICE);
      resourceService.stopResourceGeneration();
      logger.info("Resource generation stopped");
    } catch { /* Not fatal */ }

    // Stop warfare monitor
    try {
      const warfareService = getService<import("./services/warfareService").default>(WARFARE_SERVICE);
      warfareService.stopWarMonitor();
      logger.info("Warfare monitor stopped");
    } catch { /* Not fatal */ }

    // Stop CSRF cleanup timer
    stopCsrfCleanup();

    // Stop accepting new connections
    server.close(() => {
      logger.info("HTTP server closed");
    });

    // Close Socket.IO connections
    io.close(() => {
      logger.info("Socket.IO server closed");
    });

    // Disconnect from database
    await db.disconnect();

    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, "Error during shutdown");
    process.exit(1);
  }
}

/**
 * Register process signal handlers for graceful shutdown.
 */
export function registerShutdownHandlers(
  server: HttpServer,
  io: SocketIOServer,
): void {
  const shutdown = (signal: string) => gracefulShutdown(signal, server, io);

  process.on("uncaughtException", (error) => {
    logger.error({ err: error }, "Uncaught Exception");
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error({ reason, promise }, "Unhandled Rejection");
    shutdown("unhandledRejection");
  });

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
