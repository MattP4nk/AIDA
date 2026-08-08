import { Command, CommandResult } from "../../../../shared/types";
import { PrismaClient } from "@prisma/client";
import { Server as SocketIOServer } from "socket.io";

// Use type-only imports to avoid circular dependency issues
import type FileService from "../fileService";
import type ShopService from "../shopService";
import type MissionService from "../missionService";
import type MissionGeneratorService from "../missionGenerator";
import type ServerService from "../serverService";
import type MemoryService from "../memoryService";
import type ProcessStateService from "../processStateService";
import type PlayerPresenceService from "../playerPresenceService";
import type HackService from "../hackService";
import type MessageService from "../messageService";
import type { ChatService } from "../chatService";
import type { MessageEncryptionService } from "../messageEncryptionService";
import type ForumService from "../forumService";
import type { FactionService } from "../factionService";
import type { InventoryService } from "../inventoryService";
import type GameStateManager from "../gameStateManager";
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

export interface CommandContext {
  userId: string;
  role: string;
  terminalWidth: number;
  db: { client: PrismaClient };
  fileService: FileService;
  io?: SocketIOServer;
  commandHistory: Map<string, Command[]>;
  gameStateManager: GameStateManager;
  modules: CommandModule[];
  services: {
    shopService: ShopService;
    missionService: MissionService;
    missionGenerator: MissionGeneratorService;
    serverService: ServerService;
    memoryService: MemoryService;
    processStateService: ProcessStateService;
    playerPresenceService?: PlayerPresenceService;
    hackService: HackService;
    messageService: MessageService;
    forumService: ForumService;
    factionService: FactionService;
    inventoryService: InventoryService;
    backdoorService: BackdoorService;
    traceService: TraceService;
    factionKnowledgeService?: FactionKnowledgeService;
    networkTopologyService?: NetworkTopologyService;
    missionIntegrationService?: MissionIntegrationService;
    leaderboardService?: LeaderboardService;
    achievementService?: AchievementService;
    keyFragmentService?: KeyFragmentService;
    darknetDungeonService?: DarkNetDungeonService;
    darknetDiscoveryService?: DarkNetDiscoveryService;
    connectionChallengeService?: ConnectionChallengeService;
    chatService?: ChatService;
    messageEncryptionService?: MessageEncryptionService;
    [key: string]: any;
  };
}

export interface CommandInfo {
  command: string;
  category: string;
  description: string;
  usage: string;
  examples?: string[];
}

export interface CommandModule {
  /** The category name for this module (e.g. "system", "network", "hack"). */
  category: string;
  commands: Set<string>;
  execute(command: Command, context: CommandContext): Promise<CommandResult>;
  getCommandInfo?(): CommandInfo[];
}
