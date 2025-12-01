import { container } from "tsyringe";
import * as TOKENS from "./tokens";

// Import service types
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
import { FactionService } from "../services/factionService";
import { AIService } from "../services/aiService";
import { PersonaService } from "../services/personaService";

/**
 * Service Registry
 * 
 * Provides a central, type-safe access point for all services.
 * Uses lazy resolution to prevent circular dependency issues.
 * 
 * Usage:
 * import { ServiceRegistry } from "../di/serviceRegistry";
 * const shopService = ServiceRegistry.shopService;
 */
export class ServiceRegistry {
  // Core Services
  static get gameStateManager(): GameStateManager {
    return container.resolve<GameStateManager>(TOKENS.GAME_STATE_MANAGER);
  }

  static get progressService(): ProgressService {
    return container.resolve<ProgressService>(TOKENS.PROGRESS_SERVICE);
  }

  static get eventService(): EventService {
    return container.resolve<EventService>(TOKENS.EVENT_SERVICE);
  }

  static get ipService(): IPService {
    return container.resolve<IPService>(TOKENS.IP_SERVICE);
  }

  static get cacheService(): CacheService {
    return container.resolve<CacheService>(TOKENS.CACHE_SERVICE);
  }

  // Feature Services
  static get shopService(): ShopService {
    return container.resolve<ShopService>(TOKENS.SHOP_SERVICE);
  }

  static get missionService(): MissionService {
    return container.resolve<MissionService>(TOKENS.MISSION_SERVICE);
  }

  static get serverService(): ServerService {
    return container.resolve<ServerService>(TOKENS.SERVER_SERVICE);
  }

  static get hackService(): HackService {
    return container.resolve<HackService>(TOKENS.HACK_SERVICE);
  }

  static get factionService(): FactionService {
    return container.resolve<FactionService>(TOKENS.FACTION_SERVICE);
  }

  static get aiService(): AIService {
    return container.resolve<AIService>(TOKENS.AI_SERVICE);
  }

  static get personaService(): PersonaService {
    return container.resolve<PersonaService>(TOKENS.PERSONA_SERVICE);
  }

  // Supporting Services
  static get fileService(): FileService {
    return container.resolve<FileService>(TOKENS.FILE_SERVICE);
  }

  static get messageService(): MessageService {
    return container.resolve<MessageService>(TOKENS.MESSAGE_SERVICE);
  }

  static get forumService(): ForumService {
    return container.resolve<ForumService>(TOKENS.FORUM_SERVICE);
  }

  static get playerPresenceService(): PlayerPresenceService {
    return container.resolve<PlayerPresenceService>(TOKENS.PLAYER_PRESENCE_SERVICE);
  }

  static get memoryService(): MemoryService {
    return container.resolve<MemoryService>(TOKENS.MEMORY_SERVICE);
  }

  static get processStateService(): ProcessStateService {
    return container.resolve<ProcessStateService>(TOKENS.PROCESS_STATE_SERVICE);
  }

  static get commandProcessor(): CommandProcessor {
    return container.resolve<CommandProcessor>(TOKENS.COMMAND_PROCESSOR);
  }
}
