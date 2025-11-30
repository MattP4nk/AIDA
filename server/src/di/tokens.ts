/**
 * Dependency Injection Tokens
 * 
 * Define injection tokens as const symbols for type-safe DI.
 * These are used with the @inject() decorator to specify dependencies.
 */

// External Dependencies
export const SOCKET_IO = Symbol.for("SocketIO");
export const PRISMA_CLIENT = Symbol.for("PrismaClient");

// Core Services
export const GAME_STATE_MANAGER = Symbol.for("GameStateManager");
export const IP_SERVICE = Symbol.for("IPService");
export const PROGRESS_SERVICE = Symbol.for("ProgressService");
export const EVENT_SERVICE = Symbol.for("EventService");
export const CACHE_SERVICE = Symbol.for("CacheService");

// Feature Services
export const SHOP_SERVICE = Symbol.for("ShopService");
export const MISSION_SERVICE = Symbol.for("MissionService");
export const SERVER_SERVICE = Symbol.for("ServerService");
export const HACK_SERVICE = Symbol.for("HackService");

// Supporting Services
export const FILE_SERVICE = Symbol.for("FileService");
export const MESSAGE_SERVICE = Symbol.for("MessageService");
export const FORUM_SERVICE = Symbol.for("ForumService");
export const PLAYER_PRESENCE_SERVICE = Symbol.for("PlayerPresenceService");
export const COMMAND_PROCESSOR = Symbol.for("CommandProcessor");
export const MEMORY_SERVICE = Symbol.for("MemoryService");
export const PROCESS_STATE_SERVICE = Symbol.for("ProcessStateService");
