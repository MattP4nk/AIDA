import { EventEmitter } from "events";
import { Server as SocketIOServer } from "socket.io";
import { db } from "../database/client";
import type {
  Command,
  ParsedCommand,
  CommandResult,
  ValidationResult,
} from "../types/game";
import { CommandModule, CommandContext } from "./commandModules/interface";
import { createAllModules } from "./commandModules/registry";
import { checkSkillRequirement } from "./commandModules/skillRequirements";
import { TERM_WIDTH } from "./commandModules/asciiBox";
import { formatCommandOutput } from "./commandModules/outputFormatter";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import {
  LOGGER,
  SOCKET_IO,
  PROGRESS_SERVICE,
  GAME_STATE_MANAGER,
} from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";
import { getService } from "../di/container";
import * as TOKENS from "../di/tokens";
import {
  validateCommand,
  validateArgs,
  validateUserId,
} from "../utils/validators";
import { COMMAND_RATE_LIMIT, COMMAND_RATE_WINDOW_MS } from "../config/gameBalance";

import type ProgressService from "./progressService";
import type GameStateManager from "./gameStateManager";
import type FileService from "./fileService";
import type ShopService from "./shopService";
import type MissionService from "./missionService";
import type MissionGeneratorService from "./missionGenerator";
import type ServerService from "./serverService";
import type MemoryService from "./memoryService";
import type ProcessStateService from "./processStateService";
import type HackService from "./hackService";
import type MessageService from "./messageService";
import type { ChatService } from "./chatService";
import type { MessageEncryptionService } from "./messageEncryptionService";
import type ForumService from "./forumService";
import type { FactionService } from "./factionService";
import type InventoryService from "./inventoryService";
import type PlayerPresenceService from "./playerPresenceService";
import type BackdoorService from "./backdoorService";
import type TraceService from "./traceService";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import type { NetworkTopologyService } from "./networkTopologyService";
import type MissionIntegrationService from "./missionIntegration";
import type { StoryMissionService } from "./storyMissionService";
import type { PlayerProgress } from "@prisma/client";

/**
 * CommandProcessor - Server-side command processing and execution
 *
 * Handles:
 * - Command parsing and validation
 * - Permission checking
 * - Rate limiting per player
 * - Command execution routing
 * - Result formatting
 * - Audit logging
 */
@injectable()
class CommandProcessor extends EventEmitter {
  private commandHistory: Map<string, Command[]>;
  private rateLimitMap: Map<string, number[]>; // userId -> timestamps[]
  private readonly RATE_LIMIT_WINDOW = COMMAND_RATE_WINDOW_MS;
  private readonly MAX_COMMANDS_PER_WINDOW = COMMAND_RATE_LIMIT;
  private readonly rateLimitCleanupTimer: ReturnType<typeof setInterval>;

  // Service resolution cache (avoids ~26 DI lookups per command)
  private serviceCache = new Map<string, any>();
  private serviceCacheTime = 0;
  private readonly SERVICE_CACHE_TTL = 60_000; // 1 minute

  // Command categories removed - now handled by modules

  // Modular architecture properties
  private modules: CommandModule[] = [];
  private commandMap: Map<string, CommandModule> = new Map();

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
    @inject(PROGRESS_SERVICE) private progressService: ProgressService,
    @inject(GAME_STATE_MANAGER) private gameStateManager: GameStateManager,
  ) {
    super();
    this.commandHistory = new Map();
    this.rateLimitMap = new Map();

    // Initialize command modules from registry
    this.modules = createAllModules();

    // Build command map from modules
    this.buildCommandMap();

    // Periodic cleanup of stale rateLimitMap entries (every 5 min)
    this.rateLimitCleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [userId, timestamps] of this.rateLimitMap) {
        const recent = timestamps.filter(t => now - t < this.RATE_LIMIT_WINDOW);
        if (recent.length === 0) {
          this.rateLimitMap.delete(userId);
        } else {
          this.rateLimitMap.set(userId, recent);
        }
      }
    }, 5 * 60 * 1000);
    this.rateLimitCleanupTimer.unref();

    this.logger.info("Command Processor initialized");
  }


  private buildCommandMap() {
    for (const module of this.modules) {
      for (const cmd of module.commands) {
        this.commandMap.set(cmd, module);
      }
    }
    this.logger.info(
      { moduleCount: this.modules.length },
      "Initialized command modules",
    );
  }

  /** Resolve a service from DI, returning undefined on failure instead of throwing. */
  private resolveService<T>(token: string): T | undefined {
    try {
      return getService<T>(token);
    } catch {
      this.logger.warn({ token }, "Service not available");
      return undefined;
    }
  }

  /** Resolve a service with TTL-based caching to avoid repeated DI lookups. */
  private getCachedService<T>(token: string): T | undefined {
    if (Date.now() - this.serviceCacheTime > this.SERVICE_CACHE_TTL) {
      this.serviceCache.clear();
      this.serviceCacheTime = Date.now();
    }
    if (!this.serviceCache.has(token)) {
      this.serviceCache.set(token, this.resolveService(token));
    }
    return this.serviceCache.get(token);
  }

  private async buildCommandContext(userId: string, terminalCols?: number): Promise<CommandContext> {
    const fileService = this.getCachedService<FileService>(TOKENS.FILE_SERVICE)!;
    const shopService = this.getCachedService<ShopService>(TOKENS.SHOP_SERVICE)!;
    const missionService = this.getCachedService<MissionService>(
      TOKENS.MISSION_SERVICE,
    )!;
    const missionGenerator = this.getCachedService<MissionGeneratorService>(
      TOKENS.MISSION_GENERATOR_SERVICE,
    )!;
    const serverService = this.getCachedService<ServerService>(
      TOKENS.SERVER_SERVICE,
    )!;
    const memoryService = this.getCachedService<MemoryService>(
      TOKENS.MEMORY_SERVICE,
    )!;
    const processStateService = this.getCachedService<ProcessStateService>(
      TOKENS.PROCESS_STATE_SERVICE,
    )!;
    const hackService = this.getCachedService<HackService>(TOKENS.HACK_SERVICE)!;
    const messageService = this.getCachedService<MessageService>(
      TOKENS.MESSAGE_SERVICE,
    )!;
    const forumService = this.getCachedService<ForumService>(
      TOKENS.FORUM_SERVICE,
    )!;
    const factionService = this.getCachedService<FactionService>(
      TOKENS.FACTION_SERVICE,
    )!;
    const inventoryService = this.getCachedService<InventoryService>(
      TOKENS.INVENTORY_SERVICE,
    )!;
    const playerPresenceService = this.getCachedService<PlayerPresenceService>(
      TOKENS.PLAYER_PRESENCE_SERVICE,
    );
    const backdoorService = this.getCachedService<BackdoorService>(
      TOKENS.BACKDOOR_SERVICE,
    )!;
    const traceService = this.getCachedService<TraceService>(
      TOKENS.TRACE_SERVICE,
    )!;
    const factionKnowledgeService =
      this.getCachedService<FactionKnowledgeService>(
        TOKENS.FACTION_KNOWLEDGE_SERVICE,
      );
    const networkTopologyService = this.getCachedService<NetworkTopologyService>(
      TOKENS.NETWORK_TOPOLOGY_SERVICE,
    );
    const missionIntegrationService =
      this.getCachedService<MissionIntegrationService>(
        TOKENS.MISSION_INTEGRATION_SERVICE,
      );
    const storyMissionService = this.getCachedService<StoryMissionService>(
      TOKENS.STORY_MISSION_SERVICE,
    );
    const leaderboardService = this.getCachedService<
      import("./leaderboardService").LeaderboardService
    >(TOKENS.LEADERBOARD_SERVICE);
    const achievementService = this.getCachedService<
      import("./achievementService").AchievementService
    >(TOKENS.ACHIEVEMENT_SERVICE);
    const keyFragmentService = this.getCachedService<
      import("./keyFragmentService").KeyFragmentService
    >(TOKENS.KEY_FRAGMENT_SERVICE);
    const darknetDungeonService = this.getCachedService<
      import("./darknetDungeonService").DarkNetDungeonService
    >(TOKENS.DARKNET_DUNGEON_SERVICE);
    const darknetDiscoveryService = this.getCachedService<
      import("./darknetDiscoveryService").default
    >("DarkNetDiscoveryService");
    const connectionChallengeService = this.getCachedService<
      import("./connectionChallengeService").ConnectionChallengeService
    >(TOKENS.CONNECTION_CHALLENGE_SERVICE);
    const chatService = this.getCachedService<ChatService>(
      TOKENS.CHAT_SERVICE,
    );
    const messageEncryptionService = this.getCachedService<MessageEncryptionService>(
      TOKENS.MESSAGE_ENCRYPTION_SERVICE,
    );

    // Fetch user role for command-level role gating
    const user = await db.client.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    return {
      userId,
      role: user?.role ?? "player",
      terminalWidth: terminalCols && terminalCols > 40 ? Math.min(terminalCols - 2, 200) : TERM_WIDTH,
      db,
      fileService,
      ...(this.io ? { io: this.io } : {}),
      commandHistory: this.commandHistory,
      gameStateManager: this.gameStateManager,
      modules: this.modules,
      services: {
        shopService,
        missionService,
        missionGenerator,
        ...(playerPresenceService ? { playerPresenceService } : {}),
        serverService,
        memoryService,
        processStateService,
        hackService,
        messageService,
        forumService,
        factionService,
        inventoryService,
        backdoorService,
        traceService,
        ...(factionKnowledgeService ? { factionKnowledgeService } : {}),
        ...(networkTopologyService ? { networkTopologyService } : {}),
        ...(missionIntegrationService ? { missionIntegrationService } : {}),
        ...(storyMissionService ? { storyMissionService } : {}),
        ...(leaderboardService ? { leaderboardService } : {}),
        ...(achievementService ? { achievementService } : {}),
        ...(keyFragmentService ? { keyFragmentService } : {}),
        ...(darknetDungeonService ? { darknetDungeonService } : {}),
        ...(darknetDiscoveryService ? { darknetDiscoveryService } : {}),
        ...(connectionChallengeService ? { connectionChallengeService } : {}),
        ...(chatService ? { chatService } : {}),
        ...(messageEncryptionService ? { messageEncryptionService } : {}),
      },
    };
  }

  // ==================== COMMAND PARSING ====================

  /**
   * Parse raw command input into structured command object
   */
  public parseCommand(
    _userId: string,
    rawInput: string,
    _serverId?: string,
  ): ParsedCommand {
    const trimmed = rawInput.trim();

    if (!trimmed) {
      return {
        command: "",
        args: [],
        rawInput,
        isValid: false,
        error: "Empty command",
      };
    }

    // Validate command for security (injection attacks)
    const commandValidation = validateCommand(trimmed);
    if (!commandValidation.isValid) {
      return {
        command: "",
        args: [],
        rawInput,
        isValid: false,
        error: commandValidation.error || "Invalid command",
      };
    }

    // Split command and arguments
    const parts = trimmed.split(/\s+/);
    const command = parts[0]?.toLowerCase() || "";
    const args = parts.slice(1);

    // Validate command exists
    if (!command) {
      return {
        command: "",
        args: [],
        rawInput,
        isValid: false,
        error: "Invalid command format",
      };
    }

    // Basic validation
    if (command.length > 50) {
      return {
        command,
        args,
        rawInput,
        isValid: false,
        error: "Command name too long",
      };
    }

    if (args.length > 100) {
      return {
        command,
        args,
        rawInput,
        isValid: false,
        error: "Too many arguments",
      };
    }

    // Validate arguments for security
    const argsValidation = validateArgs(args);
    if (!argsValidation.isValid) {
      return {
        command,
        args,
        rawInput,
        isValid: false,
        error: argsValidation.error || "Invalid arguments",
      };
    }

    return {
      command,
      args,
      rawInput,
      isValid: true,
    };
  }

  // ==================== COMMAND VALIDATION ====================

  /**
   * Validate command against user permissions, rate limits, and game state
   */
  public async validateCommand(
    userId: string,
    parsedCommand: ParsedCommand,
    serverId?: string,
  ): Promise<ValidationResult> {
    try {
      // Validate userId format
      if (!validateUserId(userId)) {
        return { valid: false, error: "Invalid user ID format" };
      }

      // Check rate limiting
      const rateLimitCheck = this.checkRateLimit(userId);
      if (!rateLimitCheck.valid) {
        return rateLimitCheck;
      }

      // Check if user exists and is active
      const user = await db.client.user.findUnique({
        where: { id: userId },
        include: { progress: true },
      });

      if (!user) {
        return { valid: false, error: "User not found" };
      }

      if (!user.isActive) {
        return { valid: false, error: "Account is not active" };
      }

      // Check if user is online (has active session)
      const session = this.gameStateManager?.getSession(userId);
      if (!session) {
        return { valid: false, error: "No active session" };
      }

      // Validate command requirements based on category
      const command = parsedCommand.command;

      // Get module for command
      const module = this.commandMap.get(command);

      // Network commands require network context (home server or connected to remote)
      if (module?.category === "network") {
        const hasNetworkContext = !!(session.currentServerId || session.homeServerId);
        if (!hasNetworkContext) {
          return {
            valid: false,
            error: "Network access required. No server context available.",
          };
        }
      }

      // Skill-gated command categories
      const skillGatedCategories = new Set(["hack", "network", "file", "social", "alias"]);
      if (module && skillGatedCategories.has(module.category)) {
        const validation = await this.validateSkillRequirements(
          parsedCommand,
          user.progress,
        );
        if (!validation.valid) {
          return validation;
        }
      }

      // Server-specific commands require being connected
      if (serverId && !session.currentServerId) {
        return {
          valid: false,
          error: "Must be connected to a server to execute this command",
        };
      }

      return { valid: true };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err, context: "Command validation" }, `[Command validation] ${err.message}`);
      return {
        valid: false,
        error: `Validation failed: ${err.message}`,
      };
    }
  }

  /**
   * Check rate limiting for user
   */
  private checkRateLimit(userId: string): ValidationResult {
    const now = Date.now();
    const userTimestamps = this.rateLimitMap.get(userId) || [];

    // Remove old timestamps outside the window
    const recentTimestamps = userTimestamps.filter(
      (ts) => now - ts < this.RATE_LIMIT_WINDOW,
    );

    if (
      recentTimestamps.length >= this.MAX_COMMANDS_PER_WINDOW &&
      recentTimestamps[0]
    ) {
      return {
        valid: false,
        error: `Rate limit exceeded. Max ${this.MAX_COMMANDS_PER_WINDOW} commands per second.`,
        details: {
          remainingTime: this.RATE_LIMIT_WINDOW - (now - recentTimestamps[0]),
        },
      };
    }

    // Add current timestamp
    recentTimestamps.push(now);
    this.rateLimitMap.set(userId, recentTimestamps);

    return { valid: true };
  }

  /**
   * Validate skill requirements for any command across all gated modules.
   *
   * Delegates to the shared SKILL_REQUIREMENTS map in skillRequirements.ts
   * which is also consumed by HelpCommandsModule for progressive discovery.
   */
  private async validateSkillRequirements(
    parsedCommand: ParsedCommand,
    progress: PlayerProgress | null,
  ): Promise<ValidationResult> {
    if (!progress) {
      return { valid: false, error: "Player progress not found" };
    }

    const result = checkSkillRequirement(
      parsedCommand.command,
      parsedCommand.args,
      progress as unknown as Record<string, unknown>,
    );

    if (result) {
      return {
        valid: false,
        error: result.error,
        details: {
          requiredSkill: result.requiredSkill,
          currentSkill: result.currentSkill,
          skillName: result.skillName,
        },
      };
    }

    return { valid: true };
  }

  // ==================== COMMAND EXECUTION ====================

  /**
   * Execute a validated command
   */
  public async executeCommand(
    userId: string,
    parsedCommand: ParsedCommand,
    serverId?: string,
    terminalId?: string,
    terminalCols?: number,
  ): Promise<CommandResult> {
    const startTime = Date.now();

    try {
      // Validate before execution
      const validation = await this.validateCommand(
        userId,
        parsedCommand,
        serverId,
      );
      if (!validation.valid) {
        return {
          success: false,
          output: validation.error || "Command validation failed",
          error: validation.error || "Validation failed",
          timestamp: new Date(),
          executionTime: Date.now() - startTime,
        };
      }

      // Create command record
      const command: Command = {
        id: this.generateCommandId(),
        userId,
        command: parsedCommand.command,
        args: parsedCommand.args,
        timestamp: new Date(),
        rawInput: parsedCommand.rawInput,
        ...(serverId ? { serverId } : {}),
        ...(terminalId ? { terminalId } : {}),
      };

      // Add to history
      this.addToHistory(userId, command);

      // Route to appropriate handler
      let result: CommandResult;

      if (this.commandMap.has(command.command)) {
        const module = this.commandMap.get(command.command)!;
        const context = await this.buildCommandContext(userId, terminalCols);
        result = await module.execute(command, context);
      } else {
        result = {
          success: false,
          output: `Command not found: ${command.command}\nType 'help' for available commands.`,
          error: "Unknown command",
          timestamp: new Date(),
        };
      }

      // Reformat output to fit client terminal width
      result.output = formatCommandOutput(result.output, terminalCols);

      // Add execution time and terminal ID to result
      result.executionTime = Date.now() - startTime;
      if (terminalId !== undefined) {
        result.terminalId = terminalId;
      }

      // Emit event for logging/monitoring
      this.emit("command:executed", { userId, command, result });

      // Increment command counter (fire-and-forget)
      db.client.playerProgress.update({
        where: { userId },
        data: { commandsExecuted: { increment: 1 } },
      }).catch(() => {});

      // Log to database (async, don't wait)
      this.logCommandExecution(userId, command, result).catch((err) =>
        this.logger.error({ err }, "Failed to log command"),
      );

      // Trigger progress save if needed
      if (result.success && this.shouldTriggerSave(command.command)) {
        this.progressService.saveOnEvent(userId, "command_executed");
      }

      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error({ err, context: "Command execution" }, `[Command execution] ${err.message}`);
      return {
        success: false,
        output: "Command execution failed",
        error: err.message,
        timestamp: new Date(),
        executionTime: Date.now() - startTime,
      };
    }
  }

  // ==================== UTILITY METHODS ====================

  private generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private addToHistory(userId: string, command: Command): void {
    const history = this.commandHistory.get(userId) || [];
    history.push(command);

    // Keep last 100 commands per user
    if (history.length > 100) {
      history.shift();
    }

    this.commandHistory.set(userId, history);
  }

  public getHistory(userId: string, limit: number = 50): Command[] {
    const history = this.commandHistory.get(userId) || [];
    return history.slice(-limit);
  }

  private shouldTriggerSave(command: string): boolean {
    // Commands that should trigger immediate progress save
    const saveTriggers = new Set([
      "hack",
      "crack",
      "exploit",
      "mission",
      "upgrade",
      "purchase",
    ]);
    return saveTriggers.has(command);
  }

  private async logCommandExecution(
    userId: string,
    command: Command,
    _result: CommandResult,
  ): Promise<void> {
    await safeExecute({
      fn: () => db.client.auditLog.create({
        data: {
          userId,
          action: `command:${command.command}`,
          resource: command.serverId || "local",
          ipAddress: command.serverId || "local",
          timestamp: new Date(),
        },
      }),
      context: "Log command execution",
      logger: this.logger,
      silent: true,
    })();
  }

  // ==================== ADMIN/DEBUG METHODS ====================

  public getStats(): object {
    return {
      totalCommands: Array.from(this.commandHistory.values()).reduce(
        (sum, hist) => sum + hist.length,
        0,
      ),
      activeUsers: this.commandHistory.size,
      rateLimitEntries: this.rateLimitMap.size,
    };
  }

  public clearHistory(userId?: string): void {
    if (userId) {
      this.commandHistory.delete(userId);
      this.rateLimitMap.delete(userId); // Clean up rate limit entry too
    } else {
      this.commandHistory.clear();
      this.rateLimitMap.clear();
    }
  }

  public clearRateLimit(userId?: string): void {
    if (userId) {
      this.rateLimitMap.delete(userId);
    } else {
      this.rateLimitMap.clear();
    }
  }

  // ==================== PUBLIC QUERY METHODS ====================

  /**
   * Get command history for a user
   * @param userId - User ID
   * @param limit - Maximum number of commands to return (default: 50)
   * @param serverId - Optional: filter by server context
   * @returns Array of historical commands
   */
  public async getCommandHistory(
    userId: string,
    limit: number = 50,
    serverId?: string,
  ): Promise<Command[]> {
    const history = this.commandHistory.get(userId) || [];

    // Filter by serverId if provided
    const filtered = serverId
      ? history.filter((cmd) => cmd.serverId === serverId)
      : history;

    // Return most recent commands up to limit
    return filtered.slice(-limit).reverse();
  }

  /**
   * Get available commands for a user
   * @param userId - User ID
   * @param category - Optional: filter by category (system, network, hack, file, social, game)
   * @returns Array of command information objects
   */
  private getCategoryFromModule(module?: CommandModule): string {
    return module?.category ?? "other";
  }

  /**
   * Get available commands based on user permissions and context
   * @param userId - User ID
   * @param category - Optional category filter
   * @returns Array of available command objects
   */
  public async getAvailableCommands(
    _userId: string,
    category?: string,
  ): Promise<
    Array<{
      command: string;
      category: string;
      description: string;
      usage: string;
      examples?: string[];
    }>
  > {
    const commands: Array<{
      command: string;
      category: string;
      description: string;
      usage: string;
      examples?: string[];
    }> = [];

    for (const module of this.modules) {
      const moduleCategory = this.getCategoryFromModule(module);

      if (category && moduleCategory !== category) {
        continue;
      }

      const moduleCommands = module.getCommandInfo
        ? module.getCommandInfo()
        : [];
      commands.push(...moduleCommands);
    }

    return commands;
  }

  /**
   * Get autocomplete suggestions for partial input
   * @param userId - User ID
   * @param input - Partial command input
   * @param cursorPosition - Optional: cursor position in input
   * @returns Array of matching command suggestions
   */
  public async getAutocompleteSuggestions(
    _userId: string,
    input: string,
    cursorPosition?: number,
  ): Promise<string[]> {
    if (!input || input.trim().length === 0) {
      return [];
    }

    // Get the word being typed (up to cursor if provided)
    const text =
      cursorPosition !== undefined ? input.slice(0, cursorPosition) : input;
    const words = text.trim().split(/\s+/);
    const currentWord = words[words.length - 1]?.toLowerCase() || "";

    // If it's the first word, suggest commands
    if (words.length <= 1 || text.trim() === currentWord) {
      const allCommands = Array.from(this.commandMap.keys());

      return allCommands
        .filter((cmd) => cmd.startsWith(currentWord))
        .sort()
        .slice(0, 10); // Limit to 10 suggestions
    }

    return [];
  }

  /**
   * Get command usage statistics for a user
   * @param userId - User ID
   * @returns Statistics object with command usage data
   */
  public async getCommandStats(userId: string): Promise<{
    totalCommands: number;
    commandsByCategory: Record<string, number>;
    mostUsedCommands: Array<{ command: string; count: number }>;
    recentActivity: Array<{ date: string; count: number }>;
    successRate: number;
  }> {
    const history = this.commandHistory.get(userId) || [];

    // Count total commands
    const totalCommands = history.length;

    // Count by category
    const commandsByCategory: Record<string, number> = {
      system: 0,
      network: 0,
      hack: 0,
      file: 0,
      social: 0,
      game: 0,
      help: 0,
      math: 0,
      process: 0,
      faction: 0,
      other: 0,
    };

    // Count command frequency
    const commandCounts: Record<string, number> = {};

    // Track daily activity (last 7 days)
    const dailyActivity: Record<string, number> = {};

    history.forEach((cmd) => {
      // Count by category
      const module = this.commandMap.get(cmd.command);
      const category = this.getCategoryFromModule(module);

      if (commandsByCategory[category] !== undefined) {
        commandsByCategory[category]!++;
      } else {
        commandsByCategory["other"]!++;
      }

      // Count command frequency
      commandCounts[cmd.command] = (commandCounts[cmd.command] || 0) + 1;

      // Count daily activity
      const dateKey = new Date(cmd.timestamp).toISOString().split("T")[0];
      dailyActivity[dateKey!] = (dailyActivity[dateKey!] || 0) + 1;
    });

    // Get most used commands
    const mostUsedCommands = Object.entries(commandCounts)
      .map(([command, count]) => ({ command, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Get recent activity (last 7 days)
    const recentActivity = Object.entries(dailyActivity)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7);

    // Calculate success rate (assuming we can infer from command execution)
    // For now, return 100% as we don't track failures in history
    const successRate = 100;

    return {
      totalCommands,
      commandsByCategory,
      mostUsedCommands,
      recentActivity,
      successRate,
    };
  }
}

export default CommandProcessor;
