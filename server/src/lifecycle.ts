import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import logger from "./logger";
import { db } from "./database/client";
import { getService } from "./di/container";
import { GAME_STATE_MANAGER, PROGRESS_SERVICE, AI_SCHEDULER_SERVICE, RESOURCE_SERVICE, WARFARE_SERVICE, AI_SERVICE, CONTENT_QUEUE_SERVICE, HACK_SERVICE } from "./di/tokens";
import { stopCsrfCleanup } from "./middleware/csrf";
import type GameStateManager from "./services/gameStateManager";
import type ProgressService from "./services/progressService";
import type AISchedulerService from "./services/aiSchedulerService";
import type ResourceService from "./services/resourceService";

import type { AIService } from "./services/aiService";
import type { ContentQueueService } from "./services/contentQueueService";
import type HackService from "./services/hackService";
import type MissionService from "./services/missionService";
import type { PersonaMailQueueService } from "./services/personaMailQueueService";
let isShuttingDown = false;

/**
 * Perform a graceful shutdown: save state, close connections, exit.
 */
/**
 * Shutdown triggers that represent a crash rather than an orderly stop.
 * These must exit non-zero so process supervisors restart the server.
 */
const FAULT_SIGNALS = new Set(["uncaughtException", "unhandledRejection"]);

export async function gracefulShutdown(
  signal: string,
  server: HttpServer,
  io: SocketIOServer,
): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  // Force exit after 15 seconds if graceful shutdown hangs
  const forceExitTimer = setTimeout(() => {
    logger.error("Shutdown timed out after 15s, forcing exit");
    process.exit(1);
  }, 15_000);
  forceExitTimer.unref(); // Don't prevent exit if everything else finishes

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

    // Stop mission expiration checker
    try {
      const { MISSION_SERVICE } = await import("./di/tokens");
      const missionService = getService<MissionService>(MISSION_SERVICE);
      missionService.stopExpirationChecker();
      logger.info("Mission expiration checker stopped");
    } catch { /* Not fatal */ }

    // Stop AI retry queue
    try {
      const aiService = getService<AIService>(AI_SERVICE);
      aiService.stopRetryQueue();
      logger.info("AI retry queue stopped");
    } catch { /* Not fatal */ }

    // Stop content queue
    try {
      const contentQueueService = getService<ContentQueueService>(CONTENT_QUEUE_SERVICE);
      await contentQueueService.stop();
      logger.info("Content queue stopped");
    } catch { /* Not fatal */ }

    // Stop persona mail queue. Queued rows survive in the database, so anything
    // undelivered is picked up on the next boot rather than lost.
    try {
      const { PERSONA_MAIL_QUEUE_SERVICE } = await import("./di/tokens");
      const mailQueue = getService<PersonaMailQueueService>(PERSONA_MAIL_QUEUE_SERVICE);
      mailQueue.stop();
      logger.info("Persona mail queue stopped");
    } catch { /* Not fatal */ }

    // O9 — the timers shutdown used to forget.
    //
    // Ten subsystems were stopped and these six were not. The process exits
    // explicitly, so an unstopped interval does not HANG exit — the harm is
    // that it keeps firing while the server tears down. `db.disconnect()`
    // happens at the end of this sequence, so a tick landing after it rejects,
    // and an unhandled rejection re-enters this very handler.
    //
    // Each is independent: one failing must not skip the rest, hence the
    // per-entry catch rather than one try around the group.
    for (const [token, label, method] of [
      ["TRACE_SERVICE", "Trace progress loop", "stop"],
      ["COMMAND_PROCESSOR", "Command processor timer", "stop"],
      ["EPOCH_SCHEDULER_SERVICE", "Epoch scheduler", "stop"],
      ["MESSAGE_SERVICE", "Message delivery processor", "stop"],
      ["CACHE_SERVICE", "Cache cleanup", "dispose"],
      ["EVENT_SERVICE", "Event sweep", "stop"],
      ["PLAYER_PRESENCE_SERVICE", "Presence cleanup", "stop"],
    ] as const) {
      try {
        const tokens = await import("./di/tokens");
        const svc = getService<Record<string, () => void>>(
          (tokens as Record<string, string>)[token]!,
        );
        svc[method]?.();
        logger.info(`${label} stopped`);
      } catch {
        /* Not fatal — a timer we could not stop is noise, not corruption. */
      }
    }

    // O9: clear the inline timers that have no owning service — the Architect
    // evaluation and dungeon expiry sweeps in `index.ts`, which captured no
    // handle at all before this and so could not be stopped even in principle.
    try {
      const { clearShutdownTimers } = await import("./utils/shutdownTimers");
      const cleared = clearShutdownTimers();
      if (cleared > 0) logger.info({ cleared }, "Inline timers cleared");
    } catch { /* Not fatal */ }

    // Clear hack session timers
    try {
      const hackService = getService<HackService>(HACK_SERVICE);
      hackService.cleanup();
      logger.info("Hack session timers cleared");
    } catch { /* Not fatal */ }

    // Stop CSRF cleanup timer
    stopCsrfCleanup();

    // Stop accepting new connections
    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info("HTTP server closed");
        resolve();
      });
    });

    // Close Socket.IO connections
    await new Promise<void>((resolve) => {
      io.close(() => {
        logger.info("Socket.IO server closed");
        resolve();
      });
    });

    // Disconnect from database
    await db.disconnect();

    logger.info("Graceful shutdown completed");
    // A fault-triggered shutdown must NOT report success. systemd's
    // Restart=on-failure, Docker's --restart on-failure, and Kubernetes all read
    // exit 0 as "this process finished its job" and will not restart it — which
    // turned any uncaught error into a silent, permanent outage.
    process.exit(FAULT_SIGNALS.has(signal) ? 1 : 0);
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
