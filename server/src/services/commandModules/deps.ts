/**
 * What command modules may depend on — one lazy, typed accessor per service.
 *
 * A4: every command received `context.services`, a bag of 26 services typed
 * with an `[key: string]: any` index signature. Three consequences:
 *
 *   - A module's dependencies were invisible: any of them could reach any
 *     service, and a misspelt or undeclared key type-checked as `any`
 *     (`storyMissionService` was used that way, declared nowhere).
 *   - Eleven services were typed OPTIONAL, though all are registered
 *     singletons, so commands carried `if (service)` guards and "service
 *     unavailable" branches — and a whole second, synchronous implementation
 *     of several commands for when `memoryService` was absent. None of it
 *     could run: the builder turned a failed resolution into a logged warning
 *     and `undefined`, so the only way to reach those branches was a real
 *     construction failure, which they then hid as a silent skip.
 *   - Each command execution resolved all 26 up front.
 *
 * Now a module imports exactly what it uses from here, so its import line IS
 * its dependency interface, checked by the compiler. Resolution is lazy (it
 * happens at the call, through the `di/resolve` leaf, so no import cycle) and
 * loud: a service that cannot be constructed throws at the command that needs
 * it, and the command processor reports the error.
 */
import { getService } from "../../di/resolve";
import * as T from "../../di/tokens";

import type ShopService from "../shopService";
import type MissionService from "../missionService";
import type MissionGeneratorService from "../missionGenerator";
import type ServerService from "../serverService";
import type MemoryService from "../memoryService";
import type PlayerPresenceService from "../playerPresenceService";
import type HackService from "../hackService";
import type MessageService from "../messageService";
import type { ChatService } from "../chatService";
import type { MessageEncryptionService } from "../messageEncryptionService";
import type ForumService from "../forumService";
import type { FactionService } from "../factionService";
import type { InventoryService } from "../inventoryService";
import type BackdoorService from "../backdoorService";
import type TraceService from "../traceService";
import type { FactionKnowledgeService } from "../factionKnowledgeService";
import type { NetworkTopologyService } from "../networkTopologyService";
import type MissionIntegrationService from "../missionIntegration";
import type { LeaderboardService } from "../leaderboardService";
import type { AchievementService } from "../achievementService";
import type { KeyFragmentService } from "../keyFragmentService";
import type { DarkNetDungeonService } from "../darknetDungeonService";
import type DarkNetDiscoveryService from "../darknetDiscoveryService";
import type { ConnectionChallengeService } from "../connectionChallengeService";
import type { StoryMissionService } from "../storyMissionService";
import type { UserRepository } from "../../repositories/userRepository";
import type { BountyService } from "../bountyService";
import type { AccountAdminService } from "../accountAdminService";
import type AliasService from "../aliasService";
import type ResourceService from "../resourceService";
import type ContestService from "../contestService";
import type WarfareService from "../warfareService";
import type { AIService } from "../aiService";
import type { EventService } from "../eventService";
import type { ContentQueueService } from "../contentQueueService";

export const shop = () => getService<ShopService>(T.SHOP_SERVICE);
export const inventory = () => getService<InventoryService>(T.INVENTORY_SERVICE);
export const missions = () => getService<MissionService>(T.MISSION_SERVICE);
export const missionGenerator = () => getService<MissionGeneratorService>(T.MISSION_GENERATOR_SERVICE);
export const missionIntegration = () => getService<MissionIntegrationService>(T.MISSION_INTEGRATION_SERVICE);
export const storyMissions = () => getService<StoryMissionService>(T.STORY_MISSION_SERVICE);
export const servers = () => getService<ServerService>(T.SERVER_SERVICE);
export const memory = () => getService<MemoryService>(T.MEMORY_SERVICE);
export const presence = () => getService<PlayerPresenceService>(T.PLAYER_PRESENCE_SERVICE);
export const hacks = () => getService<HackService>(T.HACK_SERVICE);
export const backdoors = () => getService<BackdoorService>(T.BACKDOOR_SERVICE);
export const traces = () => getService<TraceService>(T.TRACE_SERVICE);
export const messages = () => getService<MessageService>(T.MESSAGE_SERVICE);
export const messageEncryption = () => getService<MessageEncryptionService>(T.MESSAGE_ENCRYPTION_SERVICE);
export const chat = () => getService<ChatService>(T.CHAT_SERVICE);
export const forums = () => getService<ForumService>(T.FORUM_SERVICE);
export const factions = () => getService<FactionService>(T.FACTION_SERVICE);
export const factionKnowledge = () => getService<FactionKnowledgeService>(T.FACTION_KNOWLEDGE_SERVICE);
export const topology = () => getService<NetworkTopologyService>(T.NETWORK_TOPOLOGY_SERVICE);
export const connectionChallenges = () => getService<ConnectionChallengeService>(T.CONNECTION_CHALLENGE_SERVICE);
export const leaderboard = () => getService<LeaderboardService>(T.LEADERBOARD_SERVICE);
export const achievements = () => getService<AchievementService>(T.ACHIEVEMENT_SERVICE);
export const fragments = () => getService<KeyFragmentService>(T.KEY_FRAGMENT_SERVICE);
export const darknetDungeons = () => getService<DarkNetDungeonService>(T.DARKNET_DUNGEON_SERVICE);
export const darknetDiscovery = () => getService<DarkNetDiscoveryService>(T.DARKNET_DISCOVERY_SERVICE);
export const users = () => getService<UserRepository>(T.USER_REPOSITORY);
export const bounties = () => getService<BountyService>(T.BOUNTY_SERVICE);
export const accounts = () => getService<AccountAdminService>(T.ACCOUNT_ADMIN_SERVICE);
export const aliases = () => getService<AliasService>(T.ALIAS_SERVICE);
export const resources = () => getService<ResourceService>(T.RESOURCE_SERVICE);
export const contests = () => getService<ContestService>(T.CONTEST_SERVICE);
export const warfare = () => getService<WarfareService>(T.WARFARE_SERVICE);
export const ai = () => getService<AIService>(T.AI_SERVICE);
export const events = () => getService<EventService>(T.EVENT_SERVICE);
export const contentQueue = () => getService<ContentQueueService>(T.CONTENT_QUEUE_SERVICE);
