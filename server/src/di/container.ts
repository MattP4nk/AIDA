/**
 * Dependency Injection Container Configuration
 *
 * This file sets up the tsyringe DI container and registers all services.
 * Services are registered as singletons by default to maintain state.
 */

import "reflect-metadata";
import { container } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";
import { Logger } from "pino";

// Import all services
import GameStateManager from "../services/gameStateManager";
import ProgressService from "../services/progressService";
import EventService from "../services/eventService";
import IPService from "../services/ipService";
import { CacheService } from "../services/cacheService";
import ShopService from "../services/shopService";
import { InventoryService } from "../services/inventoryService";
import MissionService from "../services/missionService";
import ServerService from "../services/serverService";
import HackService from "../services/hackService";
import FileService from "../services/fileService";
import MessageService from "../services/messageService";
import { MessageEncryptionService } from "../services/messageEncryptionService";
import { ChatService } from "../services/chatService";
import ForumService from "../services/forumService";
import PlayerPresenceService from "../services/playerPresenceService";
import MemoryService from "../services/memoryService";
import ProcessStateService from "../services/processStateService";
import CommandProcessor from "../services/commandProcessor";
import { FactionService } from "../services/factionService";
import { ReputationEngine } from "../services/reputationEngine";
import { AIService } from "../services/aiService";
import { PersonaService } from "../services/personaService";
import { PersonaMissionGenService } from "../services/personaMissionGenService";
import { PersonaActionService } from "../services/personaActionService";
import AISchedulerService from "../services/aiSchedulerService";
import MissionIntegrationService from "../services/missionIntegration";
import MissionGeneratorService from "../services/missionGenerator";
import { ServerContentService } from "../services/serverContentService";
import ResourceService from "../services/resourceService";
import ContestService from "../services/contestService";
import WarfareService from "../services/warfareService";
import AliasService from "../services/aliasService";
import DarkNetDiscoveryService from "../services/darknetDiscoveryService";
import CensorshipService from "../services/censorshipService";
import { FactionKnowledgeService } from "../services/factionKnowledgeService";
import { NetworkTopologyService } from "../services/networkTopologyService";
import BackdoorService from "../services/backdoorService";
import TraceService from "../services/traceService";
import { DynamicContentService } from "../services/dynamicContentService";
import { StoryMissionService } from "../services/storyMissionService";
import { LeaderboardService } from "../services/leaderboardService";
import { AchievementService } from "../services/achievementService";
import { TutorialService } from "../services/tutorialService";
import { StoryProgressionService } from "../services/storyProgressionService";
import { ArchitectInterventionExecutor } from "../services/architectInterventionExecutor";
import { DarkNetDungeonService } from "../services/darknetDungeonService";
import { KeyFragmentService } from "../services/keyFragmentService";
import { ConnectionChallengeService } from "../services/connectionChallengeService";

import * as TOKENS from "./tokens";

/**
 * Initialize and configure the DI container
 */
export function setupContainer(
  io: SocketIOServer,
  prismaClient: PrismaClient,
  logger: Logger,
): void {
  // Register external dependencies
  container.registerInstance(TOKENS.LOGGER, logger);
  container.registerInstance(TOKENS.SOCKET_IO, io);
  container.registerInstance(TOKENS.PRISMA_CLIENT, prismaClient);

  // Core Services
  container.registerSingleton(TOKENS.GAME_STATE_MANAGER, GameStateManager);
  container.registerSingleton(TOKENS.PROGRESS_SERVICE, ProgressService);
  container.registerSingleton(TOKENS.EVENT_SERVICE, EventService);
  container.registerSingleton(TOKENS.IP_SERVICE, IPService);
  container.registerSingleton(TOKENS.CACHE_SERVICE, CacheService);

  // Feature Services
  container.registerSingleton(TOKENS.SHOP_SERVICE, ShopService);
  container.registerSingleton(TOKENS.INVENTORY_SERVICE, InventoryService);
  container.registerSingleton(TOKENS.MISSION_SERVICE, MissionService);
  container.registerSingleton(
    TOKENS.MISSION_INTEGRATION_SERVICE,
    MissionIntegrationService,
  );
  container.registerSingleton(
    TOKENS.MISSION_GENERATOR_SERVICE,
    MissionGeneratorService,
  );
  container.registerSingleton(
    TOKENS.SERVER_CONTENT_SERVICE,
    ServerContentService,
  );
  container.registerSingleton(TOKENS.SERVER_SERVICE, ServerService);
  container.registerSingleton(TOKENS.HACK_SERVICE, HackService);
  container.registerSingleton(TOKENS.FILE_SERVICE, FileService);
  container.registerSingleton(TOKENS.MESSAGE_ENCRYPTION_SERVICE, MessageEncryptionService);
  container.registerSingleton(TOKENS.CHAT_SERVICE, ChatService);
  container.registerSingleton(TOKENS.MESSAGE_SERVICE, MessageService);
  container.registerSingleton(TOKENS.FORUM_SERVICE, ForumService);
  container.registerSingleton(
    TOKENS.PLAYER_PRESENCE_SERVICE,
    PlayerPresenceService,
  );
  container.registerSingleton(TOKENS.MEMORY_SERVICE, MemoryService);
  container.registerSingleton(
    TOKENS.PROCESS_STATE_SERVICE,
    ProcessStateService,
  );
  container.registerSingleton(TOKENS.COMMAND_PROCESSOR, CommandProcessor);
  container.registerSingleton(TOKENS.FACTION_SERVICE, FactionService);
  container.registerSingleton(TOKENS.REPUTATION_ENGINE, ReputationEngine);
  container.registerSingleton(TOKENS.AI_SERVICE, AIService);
  container.registerSingleton(TOKENS.PERSONA_MISSION_GEN_SERVICE, PersonaMissionGenService);
  container.registerSingleton(TOKENS.PERSONA_ACTION_SERVICE, PersonaActionService);
  container.registerSingleton(TOKENS.PERSONA_SERVICE, PersonaService);
  container.registerSingleton(TOKENS.AI_SCHEDULER_SERVICE, AISchedulerService);

  // Territory & Resources (Phase 3)
  container.registerSingleton(TOKENS.RESOURCE_SERVICE, ResourceService);
  container.registerSingleton(TOKENS.CONTEST_SERVICE, ContestService);

  // Phase 5: Warfare, Alias, DarkNet, Censorship
  container.registerSingleton(TOKENS.WARFARE_SERVICE, WarfareService);
  container.registerSingleton(TOKENS.ALIAS_SERVICE, AliasService);
  container.registerSingleton(
    TOKENS.DARKNET_DISCOVERY_SERVICE,
    DarkNetDiscoveryService,
  );
  container.registerSingleton(TOKENS.CENSORSHIP_SERVICE, CensorshipService);

  // Faction Knowledge
  container.registerSingleton(
    TOKENS.FACTION_KNOWLEDGE_SERVICE,
    FactionKnowledgeService,
  );

  // Network Topology
  container.registerSingleton(
    TOKENS.NETWORK_TOPOLOGY_SERVICE,
    NetworkTopologyService,
  );

  // PvP Hacking Improvements
  container.registerSingleton(TOKENS.BACKDOOR_SERVICE, BackdoorService);
  container.registerSingleton(TOKENS.TRACE_SERVICE, TraceService);

  // Dynamic Content
  container.registerSingleton(
    TOKENS.DYNAMIC_CONTENT_SERVICE,
    DynamicContentService,
  );

  // Story Missions
  container.registerSingleton(
    TOKENS.STORY_MISSION_SERVICE,
    StoryMissionService,
  );

  // Leaderboard & Achievements
  container.registerSingleton(TOKENS.LEADERBOARD_SERVICE, LeaderboardService);
  container.registerSingleton(TOKENS.ACHIEVEMENT_SERVICE, AchievementService);

  // Tutorial
  container.registerSingleton(TOKENS.TUTORIAL_SERVICE, TutorialService);

  // Story Progression
  container.registerSingleton(
    TOKENS.STORY_PROGRESSION_SERVICE,
    StoryProgressionService,
  );

  // Architect Intervention Executor
  container.registerSingleton(
    TOKENS.ARCHITECT_INTERVENTION_EXECUTOR,
    ArchitectInterventionExecutor,
  );

  // DarkNet Dungeon Service
  container.registerSingleton(
    TOKENS.DARKNET_DUNGEON_SERVICE,
    DarkNetDungeonService,
  );

  // Key Fragment / Endgame
  container.registerSingleton(TOKENS.KEY_FRAGMENT_SERVICE, KeyFragmentService);

  // Connection Challenge
  container.registerSingleton(TOKENS.CONNECTION_CHALLENGE_SERVICE, ConnectionChallengeService);

  logger.info("DI Container initialized with all services");
}

// Alias for backward compatibility
export const initializeContainer = setupContainer;

/**
 * Get a service from the container
 */
export function getService<T>(token: string | symbol): T {
  return container.resolve<T>(token as any);
}

/**
 * Clear all registrations (useful for testing)
 */
export function clearContainer(): void {
  container.clearInstances();
}

export { container };
