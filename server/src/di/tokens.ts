/**
 * Dependency Injection Tokens
 *
 * Define injection tokens as const symbols for type-safe DI.
 * These are used with the @inject() decorator to specify dependencies.
 */

// External Dependencies
export const LOGGER = "Logger";
export const SOCKET_IO = "SocketIO";
export const PRISMA_CLIENT = "PrismaClient";

// Core Services
export const GAME_STATE_MANAGER = "GameStateManager";
export const PROGRESS_SERVICE = "ProgressService";
export const EVENT_SERVICE = "EventService";
export const SHOP_SERVICE = "ShopService";
export const INVENTORY_SERVICE = "InventoryService";
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

// Mission Services
export const MISSION_INTEGRATION_SERVICE = "MissionIntegrationService";
export const MISSION_GENERATOR_SERVICE = "MissionGeneratorService";

// Server Content
export const SERVER_CONTENT_SERVICE = "ServerContentService";

// Reputation
export const REPUTATION_ENGINE = "ReputationEngine";

// Territory & Resources (Phase 3)
export const RESOURCE_SERVICE = "ResourceService";
export const CONTEST_SERVICE = "ContestService";

// Phase 5: AI Services
export const FACTION_SERVICE = "FactionService";
export const AI_SERVICE = "AIService";
export const PERSONA_SERVICE = "PersonaService";
export const AI_SCHEDULER_SERVICE = "AISchedulerService";

// Phase 5: Warfare, Alias, DarkNet, Censorship
export const WARFARE_SERVICE = "WarfareService";
export const ALIAS_SERVICE = "AliasService";
export const DARKNET_DISCOVERY_SERVICE = "DarkNetDiscoveryService";
export const CENSORSHIP_SERVICE = "CensorshipService";

// Faction Knowledge
export const FACTION_KNOWLEDGE_SERVICE = "FactionKnowledgeService";

// Network Topology
export const NETWORK_TOPOLOGY_SERVICE = "NetworkTopologyService";

// PvP Hacking Improvements
export const BACKDOOR_SERVICE = "BackdoorService";
export const TRACE_SERVICE = "TraceService";

// Dynamic Content
export const DYNAMIC_CONTENT_SERVICE = "DynamicContentService";

// Story Missions
export const STORY_MISSION_SERVICE = "StoryMissionService";

// Leaderboard & Achievements
export const LEADERBOARD_SERVICE = "LeaderboardService";
export const ACHIEVEMENT_SERVICE = "AchievementService";

// Tutorial
export const TUTORIAL_SERVICE = "TutorialService";

// Story Progression
export const STORY_PROGRESSION_SERVICE = "StoryProgressionService";

// Architect Intervention Executor
export const ARCHITECT_INTERVENTION_EXECUTOR = "ArchitectInterventionExecutor";

// DarkNet Dungeon
export const DARKNET_DUNGEON_SERVICE = "DarkNetDungeonService";
