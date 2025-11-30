/**
 * Dependency Injection Container Configuration
 * 
 * This file sets up the tsyringe DI container and registers all services.
 * Services are registered as singletons by default to maintain state.
 */

import "reflect-metadata";
import { container } from "tsyringe";
import type { Server as SocketIOServer } from "socket.io";
import type { PrismaClient } from "@prisma/client";

import * as TOKENS from "./tokens";
import GameStateManager from "../services/gameStateManager";
import ProgressService from "../services/progressService";
import EventService from "../services/eventService";
import IPService from "../services/ipService";
import { CacheService } from "../services/cacheService";
import ShopService from "../services/shopService";
import MissionService from "../services/missionService";
import ServerService from "../services/serverService";
import HackService from "../services/hackService";
import FileService from "../services/fileService";
import MessageService from "../services/messageService";
import ForumService from "../services/forumService";
import PlayerPresenceService from "../services/playerPresenceService";
import MemoryService from "../services/memoryService";
import ProcessStateService from "../services/processStateService";
import CommandProcessor from "../services/commandProcessor";

/**
 * Initialize the DI container with all service registrations
 */
export function initializeContainer(
  io: SocketIOServer,
  prismaClient: PrismaClient
): void {
  // Register external dependencies
  container.registerInstance(TOKENS.SOCKET_IO, io);
  container.registerInstance(TOKENS.PRISMA_CLIENT, prismaClient);

  // Register core services as singletons
  container.registerSingleton(TOKENS.GAME_STATE_MANAGER, GameStateManager);
  container.registerSingleton(TOKENS.PROGRESS_SERVICE, ProgressService);
  container.registerSingleton(TOKENS.EVENT_SERVICE, EventService);
  container.registerSingleton(TOKENS.IP_SERVICE, IPService);
  container.registerSingleton(TOKENS.CACHE_SERVICE, CacheService);
  
  // Register feature services as singletons
  container.registerSingleton(TOKENS.SHOP_SERVICE, ShopService);
  container.registerSingleton(TOKENS.MISSION_SERVICE, MissionService);
  container.registerSingleton(TOKENS.SERVER_SERVICE, ServerService);
  container.registerSingleton(TOKENS.HACK_SERVICE, HackService);
  container.registerSingleton(TOKENS.FILE_SERVICE, FileService);
  container.registerSingleton(TOKENS.MESSAGE_SERVICE, MessageService);
  container.registerSingleton(TOKENS.FORUM_SERVICE, ForumService);
  container.registerSingleton(TOKENS.PLAYER_PRESENCE_SERVICE, PlayerPresenceService);
  container.registerSingleton(TOKENS.MEMORY_SERVICE, MemoryService);
  container.registerSingleton(TOKENS.PROCESS_STATE_SERVICE, ProcessStateService);
  container.registerSingleton(TOKENS.COMMAND_PROCESSOR, CommandProcessor);

  console.log("✅ DI Container initialized");
}

/**
 * Get a service from the container
 */
export function getService<T>(token: symbol): T {
  return container.resolve<T>(token as any);
}

/**
 * Clear all registrations (useful for testing)
 */
export function clearContainer(): void {
  container.clearInstances();
}

export { container };
