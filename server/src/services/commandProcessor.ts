import { EventEmitter } from "events";
import { Server as SocketIOServer } from "socket.io";
import { db } from "../database/client";
import type {
  Command,
  ParsedCommand,
  CommandResult,
  ValidationResult,
} from "../types/game";
import { progressService } from "./progressService";
import { SystemCommandsModule } from "./commandModules/systemCommands";
import { NetworkCommandsModule } from "./commandModules/networkCommands";
import { HackCommandsModule } from "./commandModules/hackCommands";
import { FileCommandsModule } from "./commandModules/fileCommands";
import { SocialCommandsModule } from "./commandModules/socialCommands";
import { GameCommandsModule } from "./commandModules/gameCommands";
import { HelpCommandsModule } from "./commandModules/helpCommands";
import { ProcessCommandsModule } from "./commandModules/processCommands";
import { MathCommandsModule } from "./commandModules/mathCommands";
import { CommandModule, CommandContext } from "./commandModules/interface";
import { memoryService } from "./memoryService";
import { processStateService } from "./processStateService";
import { injectable, inject } from "tsyringe";
import { SOCKET_IO } from "../di/tokens";
import { validateCommand, validateArgs, validateUserId } from "../utils/validators";

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
  private readonly RATE_LIMIT_WINDOW = 1000; // 1 second
  private readonly MAX_COMMANDS_PER_WINDOW = 10;

  // Command categories removed - now handled by modules

  // Modular architecture properties
  private modules: CommandModule[] = [];
  private commandMap: Map<string, CommandModule> = new Map();

  constructor(@inject(SOCKET_IO) private io: SocketIOServer) {
    super();
    this.commandHistory = new Map();
    this.rateLimitMap = new Map();

    // Initialize command modules
    this.modules = [
      new SystemCommandsModule(),
      new NetworkCommandsModule(),
      new HackCommandsModule(),
      new FileCommandsModule(),
      new SocialCommandsModule(),
      new GameCommandsModule(),
      new HelpCommandsModule(),
      new ProcessCommandsModule(),
      new MathCommandsModule(),
    ];

    // Build command map from modules
    this.buildCommandMap();
    console.log("⚙️ Command Processor initialized");
  }

  /**
   * Initialize with Socket.IO (kept for backward compatibility)
   */
  public initialize(_io: SocketIOServer): void {
    // Now handled by DI injection
  }

  private buildCommandMap() {
    for (const module of this.modules) {
      for (const cmd of module.commands) {
        this.commandMap.set(cmd, module);
      }
    }
    console.log(`🧩 Initialized ${this.modules.length} command modules`);
  }

  private async buildCommandContext(userId: string): Promise<CommandContext> {
    const { gameStateManager } = await import("../index");
    const { fileService } = await import("./fileService");
    const { shopService } = await import("./shopService");
    const { missionService } = await import("./missionService");
    const { serverService } = await import("./serverService");
    const { getPresenceService } = await import("./playerPresenceService");

    // Safely get presence service
    let playerPresenceService;
    try {
      playerPresenceService = getPresenceService();
    } catch (e) {
      // Service might not be initialized yet
      console.warn("PlayerPresenceService not initialized for command context");
    }

    return {
      userId,
      db,
      fileService,
      ...(this.io ? { io: this.io } : {}),
      commandHistory: this.commandHistory,
      gameStateManager,
      modules: this.modules,
      services: {
        shopService,
        missionService,
        playerPresenceService,
        serverService,
        memoryService,
        processStateService,
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
      const { gameStateManager } = await import("../index");
      const session = gameStateManager?.getSession(userId);
      if (!session) {
        return { valid: false, error: "No active session" };
      }

      // Validate command requirements based on category
      const command = parsedCommand.command;

      // Get module for command
      const module = this.commandMap.get(command);

      // Network commands require network access (being connected to a server)
      if (module instanceof NetworkCommandsModule) {
        if (!session.currentServerId && command !== 'connect') {
          return {
            valid: false,
            error: 'Network access required. Connect to a server first.'
          };
        }
      }

      // Hack commands require specific skills and tools
      if (module instanceof HackCommandsModule) {
        const validation = await this.validateHackCommand(
          userId,
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
          error: 'Must be connected to a server to execute this command'
        };
      }

      return { valid: true };
    } catch (error) {
      console.error("Command validation error:", error);
      return {
        valid: false,
        error:
          "Validation failed: " +
          (error instanceof Error ? error.message : "Unknown error"),
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
   * Validate hack-specific commands
   */
  private async validateHackCommand(
    _userId: string,
    parsedCommand: ParsedCommand,
    progress: any,
  ): Promise<ValidationResult> {
    if (!progress) {
      return { valid: false, error: "Player progress not found" };
    }

    const requiredSkills: Record<string, number> = {
      hack: 20,
      crack: 30,
      exploit: 40,
      backdoor: 50,
      rootkit: 60,
    };

    const required = requiredSkills[parsedCommand.command] || 0;

    if (progress.hacking < required) {
      return {
        valid: false,
        error: `Insufficient hacking skill. Required: ${required}, Current: ${progress.hacking}`,
        details: { requiredSkill: required, currentSkill: progress.hacking },
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
      };

      // Add to history
      this.addToHistory(userId, command);

      // Route to appropriate handler
      let result: CommandResult;

      if (this.commandMap.has(command.command)) {
        const module = this.commandMap.get(command.command)!;
        const context = await this.buildCommandContext(userId);
        result = await module.execute(command, context);
      } else {
        result = {
          success: false,
          output: `Command not found: ${command.command}\nType 'help' for available commands.`,
          error: "Unknown command",
          timestamp: new Date(),
        };
      }

      // Add execution time
      result.executionTime = Date.now() - startTime;

      // Emit event for logging/monitoring
      this.emit("command:executed", { userId, command, result });

      // Log to database (async, don't wait)
      this.logCommandExecution(userId, command, result).catch((err) =>
        console.error("Failed to log command:", err),
      );

      // Trigger progress save if needed
      if (result.success && this.shouldTriggerSave(command.command)) {
        progressService.saveOnEvent(userId, "command_executed");
      }

      return result;
    } catch (error) {
      console.error("Command execution error:", error);
      return {
        success: false,
        output: "Command execution failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
        executionTime: Date.now() - startTime,
      };
    }
  }

  // ==================== UTILITY METHODS ====================

  private generateCommandId(): string {
    return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    try {
      await db.client.auditLog.create({
        data: {
          userId,
          action: `command:${command.command}`,
          resource: command.serverId || "local",
          ipAddress: command.serverId || "local",
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error("Failed to log command execution:", error);
    }
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
    } else {
      this.commandHistory.clear();
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
    let filtered = serverId
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
    if (!module) return "other";
    if (module instanceof SystemCommandsModule) return "system";
    if (module instanceof NetworkCommandsModule) return "network";
    if (module instanceof HackCommandsModule) return "hack";
    if (module instanceof FileCommandsModule) return "file";
    if (module instanceof SocialCommandsModule) return "social";
    if (module instanceof GameCommandsModule) return "game";
    if (module instanceof HelpCommandsModule) return "help";
    if (module instanceof ProcessCommandsModule) return "process";
    if (module instanceof MathCommandsModule) return "math";
    return "other";
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

      const moduleCommands = module.getCommandInfo ? module.getCommandInfo() : [];
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

// Backward compatibility
import { container } from "../di/container";
import { COMMAND_PROCESSOR } from "../di/tokens";
export const commandProcessor = new Proxy({} as CommandProcessor, {
  get(_target, prop) {
    const instance = container.resolve(COMMAND_PROCESSOR as any);
    return (instance as any)[prop];
  }
});
