/**
 * Dependency Injection Tokens
 * 
 * Define injection tokens as const symbols for type-safe DI.
 * These are used with the @inject() decorator to specify dependencies.
 */

// External Dependencies
export const SOCKET_IO = "SocketIO";
export const PRISMA_CLIENT = "PrismaClient";

// Core Services
export const GAME_STATE_MANAGER = "GameStateManager";
export const PROGRESS_SERVICE = "ProgressService";
export const EVENT_SERVICE = "EventService";
export const SHOP_SERVICE = "ShopService";
export const MISSION_SERVICE = "MissionService";
export const SERVER_SERVICE = "ServerService";
export const HACK_SERVICE = "HackService";
export const FILE_SERVICE = "FileService";
export const MESSAGE_SERVICE = "MessageService";
export const FORUM_SERVICE = "ForumService";
export const PLAYER_PRESENCE_SERVICE = "PlayerPresenceService";
export const MEMORY_SERVICE = "MemoryService";
export const PROCESS_STATE_SERVICE = "ProcessStateService";
export const COMMAND_PROCESSOR = "CommandProcessor";
export const IP_SERVICE = "IPService";
export const CACHE_SERVICE = "CacheService";

// Phase 5: AI Services
export const FACTION_SERVICE = "FactionService";
export const AI_SERVICE = "AIService";
export const PERSONA_SERVICE = "PersonaService";
export const AI_SCHEDULER_SERVICE = "AISchedulerService";
