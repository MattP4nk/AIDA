import { EventEmitter } from "events";
import { db } from "../database/client";
import type {
  Command,
  ParsedCommand,
  CommandResult,
  ValidationResult,
} from "../types/game";
import { progressService } from "./progressService";
import { ExpressionEngine } from "../utils/expressionEngine";

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
class CommandProcessor extends EventEmitter {
  private commandHistory: Map<string, Command[]>;
  private rateLimitMap: Map<string, number[]>; // userId -> timestamps[]
  private readonly RATE_LIMIT_WINDOW = 1000; // 1 second
  private readonly MAX_COMMANDS_PER_WINDOW = 10;

  // Command categories
  private readonly SYSTEM_COMMANDS = new Set([
    "ls",
    "cd",
    "pwd",
    "cat",
    "rm",
    "mkdir",
    "touch",
    "cp",
    "mv",
    "echo",
    "write",
  ]);
  private readonly MATH_COMMANDS = new Set([
    "calc",
    "expr",
    "math",
    "vars",
    "set",
    "unset",
    "convert",
    "random",
  ]);
  private readonly NETWORK_COMMANDS = new Set([
    "scan",
    "servers",
    "connect",
    "disconnect",
    "traceroute",
    "probe",
  ]);
  private readonly HACK_COMMANDS = new Set([
    "hack",
    "crack",
    "exploit",
    "backdoor",
    "rootkit",
  ]);
  private readonly FILE_COMMANDS = new Set([
    "upload",
    "download",
    "encrypt",
    "decrypt",
    "analyze",
  ]);
  private readonly SOCIAL_COMMANDS = new Set([
    "msg",
    "mail",
    "inbox",
    "forum",
    "darkweb",
    "proxy",
    "chat",
  ]);
  private readonly GAME_COMMANDS = new Set([
    "status",
    "skills",
    "missions",
    "accept",
    "abandon",
    "progress",
    "inventory",
    "shop",
    "buy",
    "sell",
    "use",
    "players",
    "who",
    "whois",
  ]);
  private readonly HELP_COMMANDS = new Set([
    "help",
    "man",
    "history",
    "stats",
    "clear",
  ]);

  private fileStorage: Map<string, Map<string, string>>; // userId -> filename -> content
  private expressionEngines: Map<string, ExpressionEngine>; // userId -> ExpressionEngine

  constructor() {
    super();
    this.commandHistory = new Map();
    this.rateLimitMap = new Map();
    this.fileStorage = new Map();
    this.expressionEngines = new Map();

    console.log("⚡ CommandProcessor initialized");
  }

  // ==================== SESSION MANAGEMENT ====================

  /**
   * Get or create a session for the user
   * Auto-creates session if it doesn't exist
   */
  private async getOrCreateSession(userId: string): Promise<any> {
    const { gameStateManager } = await import("../index");
    let session = gameStateManager?.getSession(userId);

    // Auto-create session if it doesn't exist
    if (!session && gameStateManager) {
      try {
        const user = await db.client.user.findUnique({
          where: { id: userId },
        });

        if (user) {
          session = await gameStateManager.createSession(
            userId,
            `auto-${Date.now()}`, // Auto-generated socket ID
            "127.0.0.1", // Default IP for auto-created sessions
          );
          console.log(`✅ Auto-created session for user ${userId}`);
        }
      } catch (error) {
        console.error(
          `Failed to auto-create session for user ${userId}:`,
          error,
        );
      }
    }

    return session;
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
    _serverId?: string,
  ): Promise<ValidationResult> {
    try {
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
      // TODO: Implement session check when GameStateManager is properly exported
      // const session = gameStateManager.getSession(userId);
      // if (!session) {
      if (false) {
        return { valid: false, error: "No active session" };
      }

      // Validate command requirements based on category
      const command = parsedCommand.command;

      // Network commands require network access (being connected to a server)
      // TODO: Re-enable when session management is fixed
      // if (this.NETWORK_COMMANDS.has(command)) {
      //   if (!session.currentServerId && command !== 'connect') {
      //     return {
      //       valid: false,
      //       error: 'Network access required. Connect to a server first.'
      //     };
      //   }
      // }

      // Hack commands require specific skills and tools
      if (this.HACK_COMMANDS.has(command)) {
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
      // TODO: Re-enable when session management is fixed
      // if (serverId && !session.currentServerId) {
      //   return {
      //     valid: false,
      //     error: 'Must be connected to a server to execute this command'
      //   };
      // }

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

      if (this.SYSTEM_COMMANDS.has(command.command)) {
        result = await this.executeSystemCommand(userId, command);
      } else if (this.MATH_COMMANDS.has(command.command)) {
        result = await this.executeMathCommand(userId, command);
      } else if (this.NETWORK_COMMANDS.has(command.command)) {
        result = await this.executeNetworkCommand(userId, command);
      } else if (this.HACK_COMMANDS.has(command.command)) {
        result = await this.executeHackCommand(userId, command);
      } else if (this.FILE_COMMANDS.has(command.command)) {
        result = await this.executeFileCommand(userId, command);
      } else if (this.SOCIAL_COMMANDS.has(command.command)) {
        result = await this.executeSocialCommand(userId, command);
      } else if (this.GAME_COMMANDS.has(command.command)) {
        result = await this.executeGameCommand(userId, command);
      } else if (this.HELP_COMMANDS.has(command.command)) {
        result = await this.executeHelpCommand(userId, command);
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

  // ==================== COMMAND HANDLERS ====================

  /**
   * Execute system commands (ls, cd, pwd, cat, etc.)
   */
  private async executeSystemCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    // TODO: Re-enable session check when GameStateManager is properly exported
    // const session = gameStateManager.getSession(userId);
    // if (!session) {
    if (false) {
      return {
        success: false,
        output: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      switch (command.command) {
        case "ls":
          return await this.handleListDirectory(userId, command);

        case "cd":
          return await this.handleChangeDirectory(userId, command);

        case "pwd":
          return await this.handlePrintWorkingDirectory(userId, command);

        case "cat":
          return await this.handleReadFile(userId, command);

        case "mkdir":
          return await this.handleMakeDirectory(userId, command);

        case "touch":
          return await this.handleCreateFile(userId, command);

        case "rm":
          return await this.handleRemoveFile(userId, command);

        case "cp":
          return await this.handleCopyFile(userId, command);

        case "mv":
          return await this.handleMoveFile(userId, command);

        case "echo":
          return await this.handleEcho(userId, command);

        case "write":
          return await this.handleWriteFile(userId, command);

        default:
          return {
            success: false,
            output: `System command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "System command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute math and logic commands (calc, expr, vars, etc.)
   */
  private async executeMathCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Get or create expression engine for this user
      if (!this.expressionEngines.has(userId)) {
        this.expressionEngines.set(userId, new ExpressionEngine());
      }
      const engine = this.expressionEngines.get(userId)!;

      switch (command.command) {
        case "calc":
        case "expr": {
          const expression = command.args.join(" ");

          if (!expression) {
            return {
              success: true,
              output: `Calculator - Enter expressions or commands:
  calc 2 + 3 * 4     → Mathematical operations
  calc x = 10        → Variable assignment
  calc x * 2         → Use variables
  calc vars          → List variables
  calc help          → Show detailed help`,
              timestamp: new Date(),
            };
          }

          if (expression === "help") {
            return {
              success: true,
              output: ExpressionEngine.getHelp(),
              timestamp: new Date(),
            };
          }

          const result = engine.evaluate(expression);

          if (result.success) {
            if (result.type === "info" || result.type === "assignment") {
              return {
                success: true,
                output: result.result,
                timestamp: new Date(),
              };
            } else if (result.type === "boolean") {
              // For boolean results, show clear true/false
              return {
                success: true,
                output: result.result ? "true" : "false",
                timestamp: new Date(),
              };
            } else {
              return {
                success: true,
                output: `= ${result.result}`,
                timestamp: new Date(),
              };
            }
          } else {
            return {
              success: false,
              output: `Error: ${result.error || "Unknown error"}`,
              error: result.error || "Unknown error",
              timestamp: new Date(),
            };
          }
        }

        case "vars": {
          const result = engine.evaluate("vars");
          return {
            success: true,
            output: result.result,
            timestamp: new Date(),
          };
        }

        case "set": {
          const args = command.args.join(" ");
          if (!args) {
            return {
              success: false,
              output: `set: missing variable name and value
Usage: set <name> <value>`,
              timestamp: new Date(),
            };
          }

          const parts = args.split(/\s+/);
          if (parts.length < 2) {
            return {
              success: false,
              output: `set: missing value
Usage: set <name> <value>`,
              timestamp: new Date(),
            };
          }

          const name = parts[0] || "";
          const value = parts.slice(1).join(" ");

          if (!name || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
            return {
              success: false,
              output: `set: invalid variable name
Variable names must start with letter or underscore`,
              timestamp: new Date(),
            };
          }

          const result = engine.evaluate(`${name} = ${value}`);

          if (result.success) {
            return {
              success: true,
              output: result.result,
              timestamp: new Date(),
            };
          } else {
            return {
              success: false,
              output: `Error: ${result.error || "Unknown error"}`,
              error: result.error || "Unknown error",
              timestamp: new Date(),
            };
          }
        }

        case "unset": {
          const varName = command.args[0] || "";
          if (!varName) {
            return {
              success: false,
              output: "unset: missing variable name",
              timestamp: new Date(),
            };
          }

          const result = engine.evaluate(`delete ${varName}`);

          if (result.success) {
            return {
              success: true,
              output: result.result,
              timestamp: new Date(),
            };
          } else {
            return {
              success: false,
              output: `Error: ${result.error || "Unknown error"}`,
              error: result.error || "Unknown error",
              timestamp: new Date(),
            };
          }
        }

        case "math": {
          return {
            success: true,
            output: `Mathematical Functions:
  sin(x), cos(x), tan(x)  → Trigonometric functions
  sqrt(x), abs(x)         → Square root, absolute value
  floor(x), ceil(x)       → Floor, ceiling
  round(x)                → Round to nearest integer
  log(x), exp(x)          → Natural log, exponential
  pow(x,y), min(x,y)      → Power, minimum
  max(x,y), random()      → Maximum, random number

Constants:
  PI    → 3.14159... (π)
  E     → 2.71828... (e)
  PHI   → 1.61803... (φ, Golden ratio)

Examples:
  calc sin(PI/2)          → 1
  calc sqrt(16)           → 4
  calc pow(2, 3)          → 8
  calc random() * 100     → Random 0-100`,
            timestamp: new Date(),
          };
        }

        case "convert": {
          const args = command.args.join(" ").toLowerCase();
          if (!args) {
            return {
              success: false,
              output: `convert: missing conversion parameters
Usage: convert <value> <from_unit> to <to_unit>
Supported: f/c (temperature), lb/kg (weight), ft/m (length)`,
              timestamp: new Date(),
            };
          }

          const match = args.match(/^(\d+(?:\.\d+)?)\s+(\w+)\s+to\s+(\w+)$/);
          if (!match) {
            return {
              success: false,
              output: `convert: invalid syntax
Usage: convert <value> <from_unit> to <to_unit>`,
              timestamp: new Date(),
            };
          }

          const value = parseFloat(match[1] || "0");
          const fromUnit = match[2] || "";
          const toUnit = match[3] || "";

          let result: number;
          let description: string;

          // Temperature conversions
          if (
            (fromUnit === "f" || fromUnit === "fahrenheit") &&
            (toUnit === "c" || toUnit === "celsius")
          ) {
            result = ((value - 32) * 5) / 9;
            description = `${value}°F = ${result.toFixed(2)}°C`;
          } else if (
            (fromUnit === "c" || fromUnit === "celsius") &&
            (toUnit === "f" || toUnit === "fahrenheit")
          ) {
            result = (value * 9) / 5 + 32;
            description = `${value}°C = ${result.toFixed(2)}°F`;
          }
          // Weight conversions
          else if (
            (fromUnit === "lb" || fromUnit === "pounds") &&
            (toUnit === "kg" || toUnit === "kilograms")
          ) {
            result = value * 0.453592;
            description = `${value} lb = ${result.toFixed(2)} kg`;
          } else if (
            (fromUnit === "kg" || fromUnit === "kilograms") &&
            (toUnit === "lb" || toUnit === "pounds")
          ) {
            result = value / 0.453592;
            description = `${value} kg = ${result.toFixed(2)} lb`;
          }
          // Length conversions
          else if (
            (fromUnit === "ft" || fromUnit === "feet") &&
            (toUnit === "m" || toUnit === "meters")
          ) {
            result = value * 0.3048;
            description = `${value} ft = ${result.toFixed(2)} m`;
          } else if (
            (fromUnit === "m" || fromUnit === "meters") &&
            (toUnit === "ft" || toUnit === "feet")
          ) {
            result = value / 0.3048;
            description = `${value} m = ${result.toFixed(2)} ft`;
          }
          // Miles to kilometers
          else if (
            (fromUnit === "mi" || fromUnit === "miles") &&
            (toUnit === "km" || toUnit === "kilometers")
          ) {
            result = value * 1.60934;
            description = `${value} mi = ${result.toFixed(2)} km`;
          } else if (
            (fromUnit === "km" || fromUnit === "kilometers") &&
            (toUnit === "mi" || toUnit === "miles")
          ) {
            result = value / 1.60934;
            description = `${value} km = ${result.toFixed(2)} mi`;
          } else {
            return {
              success: false,
              output: `convert: unsupported conversion from '${fromUnit}' to '${toUnit}'
Supported conversions:
  Temperature: f ↔ c (Fahrenheit ↔ Celsius)
  Weight: lb ↔ kg (Pounds ↔ Kilograms)
  Length: ft ↔ m, mi ↔ km`,
              timestamp: new Date(),
            };
          }

          return {
            success: true,
            output: description,
            timestamp: new Date(),
          };
        }

        case "random": {
          const args = command.args.map((a) => parseFloat(a));

          if (args.length === 0) {
            // Random float between 0 and 1
            const result = Math.random();
            return {
              success: true,
              output: result.toFixed(6),
              timestamp: new Date(),
            };
          } else if (
            args.length === 1 &&
            args[0] !== undefined &&
            !isNaN(args[0])
          ) {
            // Random integer from 0 to max
            const max = Math.floor(args[0]);
            const result = Math.floor(Math.random() * (max + 1));
            return {
              success: true,
              output: result.toString(),
              timestamp: new Date(),
            };
          } else if (
            args.length === 2 &&
            args[0] !== undefined &&
            args[1] !== undefined &&
            !isNaN(args[0]) &&
            !isNaN(args[1])
          ) {
            // Random integer between min and max
            const min = Math.floor(args[0]);
            const max = Math.floor(args[1]);
            const result = Math.floor(Math.random() * (max - min + 1)) + min;
            return {
              success: true,
              output: result.toString(),
              timestamp: new Date(),
            };
          } else {
            return {
              success: false,
              output: `random: invalid arguments
Usage:
  random           → Random decimal 0-1
  random 10        → Random integer 0-10
  random 5 15      → Random integer 5-15`,
              timestamp: new Date(),
            };
          }
        }

        default:
          return {
            success: false,
            output: `Math command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Math command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute network commands (scan, connect, disconnect, etc.)
   */
  private async executeNetworkCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Import ServerService
      const ServerService = (await import("./serverService")).default;
      const serverService = ServerService.getInstance();

      // Get player progress for skill checks
      const progress = await db.client.playerProgress.findUnique({
        where: { userId },
      });

      switch (command.command) {
        case "servers":
        case "scan": {
          // Discover available servers based on player's hacking skill
          const scanLevel = progress?.hacking || 0;
          const servers = await serverService.discoverServers(
            userId,
            scanLevel,
          );

          return {
            success: true,
            output: this.formatServerList(servers),
            data: servers,
            timestamp: new Date(),
          };
        }

        case "connect": {
          const targetIp = command.args[0];

          if (!targetIp) {
            return {
              success: false,
              output: "Usage: connect <ip_address>",
              timestamp: new Date(),
            };
          }

          const result = await serverService.connectToServer(userId, targetIp);

          return {
            success: result.success,
            output: result.message || "Connected to server",
            data: result,
            timestamp: new Date(),
          };
        }

        case "disconnect": {
          // Get current connection
          const connection = await db.client.serverConnection.findFirst({
            where: {
              userId,
              disconnectedAt: null,
            },
            orderBy: { connectedAt: "desc" },
          });

          if (!connection) {
            return {
              success: false,
              output: "Not connected to any server",
              timestamp: new Date(),
            };
          }

          await serverService.disconnectFromServer(userId, connection.serverId);

          return {
            success: true,
            output: "Disconnected from server",
            timestamp: new Date(),
          };
        }

        case "probe": {
          const targetIp = command.args[0];

          if (!targetIp) {
            return {
              success: false,
              output: "Usage: probe <ip_address>",
              timestamp: new Date(),
            };
          }

          // Get public server info
          const server = await serverService.getServer(targetIp);

          if (!server) {
            return {
              success: false,
              output: `Server not found: ${targetIp}`,
              timestamp: new Date(),
            };
          }

          return {
            success: true,
            output: this.formatServerProbe(server),
            data: server,
            timestamp: new Date(),
          };
        }

        case "traceroute": {
          const targetIp = command.args[0];

          if (!targetIp) {
            return {
              success: false,
              output: "Usage: traceroute <ip_address>",
              timestamp: new Date(),
            };
          }

          // Simulate traceroute
          const hops = this.generateTraceroute(targetIp);

          return {
            success: true,
            output: this.formatTraceroute(hops),
            data: { hops },
            timestamp: new Date(),
          };
        }

        default:
          return {
            success: false,
            output: `Network command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      console.error("Network command error:", error);
      return {
        success: false,
        output: "Network command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute hack commands
   */
  private async executeHackCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Import HackService
      const { hackService } = await import("./hackService");

      // Validate target
      const targetIp = command.args[0];
      if (!targetIp) {
        return {
          success: false,
          output: `Usage: ${command.command} <target_ip> [options]`,
          error: "Target IP required",
          timestamp: new Date(),
        };
      }

      // Map command to hack type
      const hackTypeMap: Record<string, string> = {
        hack: "password_crack",
        crack: "network_exploit",
        exploit: "exploit",
        backdoor: "backdoor",
        rootkit: "rootkit",
      };

      const hackType = hackTypeMap[command.command];
      if (!hackType) {
        return {
          success: false,
          output: `Unknown hack command: ${command.command}`,
          timestamp: new Date(),
        };
      }

      // Parse options from args
      const options: any = {};
      for (let i = 1; i < command.args.length; i += 2) {
        const key = command.args[i]?.replace("--", "");
        const value = command.args[i + 1];
        if (key && value) {
          options[key] = value;
        }
      }

      // Execute hack
      // Note: processHackAttempt needs targetServerId, method, and tools array
      const result = await hackService.processHackAttempt(
        userId,
        targetIp,
        command.serverId || "unknown",
        hackType as any,
        [], // tools array - empty for now
      );

      return {
        success: result.success,
        output:
          result.message ||
          (result.success ? "Hack successful" : "Hack failed"),
        data: {
          ...result,
          hackType,
          targetIp,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("Hack command error:", error);
      return {
        success: false,
        output: "Hack command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute file commands
   */
  private async executeFileCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Import FileService
      const { fileService } = await import("./fileService");

      // Ensure we have a server context
      if (!command.serverId) {
        return {
          success: false,
          output:
            "File operations require server connection. Use: connect <ip>",
          timestamp: new Date(),
        };
      }

      // Route to appropriate file operation
      switch (command.command) {
        case "upload": {
          // Map to createFile
          const remotePath = command.args[0];
          const content = command.args.slice(1).join(" ");

          if (!remotePath) {
            return {
              success: false,
              output: "Usage: upload <remote_path> <content>",
              timestamp: new Date(),
            };
          }

          const result = await fileService.createFile(
            command.serverId,
            userId,
            remotePath,
            content || "",
            false, // not encrypted by default
          );

          return {
            success: result.success,
            output: result.message || "File created",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "download": {
          // Map to readFile
          const remotePath = command.args[0];

          if (!remotePath) {
            return {
              success: false,
              output: "Usage: download <remote_path>",
              timestamp: new Date(),
            };
          }

          const result = await fileService.readFile(
            command.serverId,
            userId,
            remotePath,
          );

          return {
            success: result.success,
            output: result.success
              ? `File contents:\n${result.data?.content || ""}`
              : result.message || "Download failed",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "encrypt": {
          const remotePath = command.args[0];
          const password = command.args[1] || "default";

          if (!remotePath) {
            return {
              success: false,
              output: "Usage: encrypt <remote_path> [password]",
              timestamp: new Date(),
            };
          }

          // Read file first
          const readResult = await fileService.readFile(
            command.serverId,
            userId,
            remotePath,
          );

          if (!readResult.success) {
            return {
              success: false,
              output:
                "Cannot encrypt: " + (readResult.message || "File not found"),
              timestamp: new Date(),
            };
          }

          // Delete and recreate with encryption
          await fileService.deleteNode(command.serverId, userId, remotePath);

          const result = await fileService.createFile(
            command.serverId,
            userId,
            remotePath,
            readResult.data?.content || "",
            true, // encrypted
            password,
          );

          return {
            success: result.success,
            output: result.message || "File encrypted",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "decrypt": {
          const remotePath = command.args[0];
          const password = command.args[1];

          if (!remotePath) {
            return {
              success: false,
              output: "Usage: decrypt <remote_path> [password]",
              timestamp: new Date(),
            };
          }

          // Read file with decryption key
          const result = await fileService.readFile(
            command.serverId,
            userId,
            remotePath,
            password,
          );

          return {
            success: result.success,
            output: result.success
              ? `Decrypted content:\n${result.data?.content || ""}`
              : result.message || "Decryption failed",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "analyze": {
          const remotePath = command.args[0];

          if (!remotePath) {
            return {
              success: false,
              output: "Usage: analyze <remote_path>",
              timestamp: new Date(),
            };
          }

          // Read file to analyze
          const result = await fileService.readFile(
            command.serverId,
            userId,
            remotePath,
          );

          if (!result.success) {
            return {
              success: false,
              output: result.message || "File not found",
              timestamp: new Date(),
            };
          }

          // Basic analysis
          const content = result.data?.content || "";
          const analysis = {
            size: content.length,
            lines: content.split("\n").length,
            words: content.split(/\s+/).filter((w: string) => w.length > 0)
              .length,
            isEncrypted: result.data?.isEncrypted || false,
            type: this.detectFileType(remotePath, content),
          };

          return {
            success: true,
            output: this.formatFileAnalysis(remotePath, analysis),
            data: analysis,
            timestamp: new Date(),
          };
        }

        default:
          return {
            success: false,
            output: `Unknown file command: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      console.error("File command error:", error);
      return {
        success: false,
        output: "File command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute social commands (messaging, forum, etc.)
   */
  private async executeSocialCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Import MessageService
      const { messageService } = await import("./messageService");

      // Check if messageService is initialized
      if (!messageService) {
        return {
          success: false,
          output: [
            "Social features are not available",
            "Error: Message service is not initialized",
            "",
            "The server may still be starting up. Please try again in a moment.",
          ],
          error: "Message service not initialized",
          timestamp: new Date(),
        };
      }

      switch (command.command) {
        case "msg": {
          const recipientUsername = command.args[0];
          const messageText = command.args.slice(1).join(" ");

          if (!recipientUsername || !messageText) {
            return {
              success: false,
              output: "Usage: msg <username> <message>",
              timestamp: new Date(),
            };
          }

          // Look up recipient by username
          const recipient = await db.client.user.findUnique({
            where: { username: recipientUsername },
          });

          if (!recipient) {
            return {
              success: false,
              output: `User not found: ${recipientUsername}`,
              timestamp: new Date(),
            };
          }

          const result = await messageService.sendPrivateMessage(
            userId,
            recipient.id,
            {
              subject: "Direct Message",
              content: messageText,
            },
          );

          return {
            success: result.success,
            output: result.message || "Message sent",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "mail": {
          const recipientUsername = command.args[0];
          const subject = command.args[1];
          const body = command.args.slice(2).join(" ");

          if (!recipientUsername || !subject || !body) {
            return {
              success: false,
              output: "Usage: mail <username> <subject> <message>",
              timestamp: new Date(),
            };
          }

          // Look up recipient by username
          const recipient = await db.client.user.findUnique({
            where: { username: recipientUsername },
          });

          if (!recipient) {
            return {
              success: false,
              output: `User not found: ${recipientUsername}`,
              timestamp: new Date(),
            };
          }

          const result = await messageService.sendPrivateMessage(
            userId,
            recipient.id,
            {
              subject,
              content: body,
            },
          );

          return {
            success: result.success,
            output: result.message || "Mail sent",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "inbox": {
          const result = await messageService.getInbox(userId);

          return {
            success: result.success,
            output: result.success
              ? this.formatMessageList(result.data?.messages || [])
              : result.message || "Failed to get inbox",
            data: result.data,
            timestamp: new Date(),
          };
        }

        case "forum": {
          const { forumService } = await import("./forumService");
          const action = command.args[0]?.toLowerCase();

          if (!action) {
            return {
              success: false,
              output: [
                "=== FORUM ACCESS SYSTEM ===",
                "Underground communication networks",
                "",
                "Commands:",
                "  forum scan           - Scan for available forums",
                "  forum list           - List discovered forums",
                "  forum <url>          - Access forum site",
                "  forum register <url> <handle> - Register account",
                "  forum read <id>      - Read specific post",
                "  forum search <url> <term>  - Search forum",
                "",
                "Security Note: Some forums require proxy access for anonymity",
              ].join("\n"),
              timestamp: new Date(),
            };
          }

          switch (action) {
            case "scan": {
              try {
                const result = await forumService.scanForForums(userId, false);
                const output = [
                  "=== FORUM SCAN RESULTS ===",
                  `Found ${result.forums.length} accessible forums`,
                  `New discoveries: ${result.newDiscoveries}`,
                  "",
                  "Discovered forums:",
                  ...result.forums.map(
                    (f) =>
                      `  ${f.name.padEnd(25)} ${f.url.padEnd(30)} [Level ${f.securityLevel}] ${f.requiresProxy ? "(Proxy Required)" : ""}`,
                  ),
                ];

                if (result.requiresHigherSkills.length > 0) {
                  output.push(
                    "",
                    "Requires higher skills:",
                    ...result.requiresHigherSkills.map((f) => `  ${f}`),
                  );
                }

                return {
                  success: true,
                  output: output.join("\n"),
                  data: result,
                  timestamp: new Date(),
                };
              } catch (error: any) {
                return {
                  success: false,
                  output: error.message || "Forum scan failed",
                  timestamp: new Date(),
                };
              }
            }

            case "list": {
              try {
                const forums = await forumService.getDiscoveredForums(userId);

                if (forums.length === 0) {
                  return {
                    success: true,
                    output:
                      "No forums discovered yet. Use 'forum scan' to find forums.",
                    timestamp: new Date(),
                  };
                }

                const output = [
                  "=== DISCOVERED FORUMS ===",
                  "",
                  ...forums.map(
                    (f) =>
                      `${f.name}\n  URL: ${f.url}\n  Security Level: ${f.securityLevel} ${f.requiresProxy ? "(Proxy Required)" : ""}\n  ${f.isHoneypot ? "⚠️  WARNING: Possible honeypot" : ""}`,
                  ),
                ];

                return {
                  success: true,
                  output: output.join("\n"),
                  data: forums,
                  timestamp: new Date(),
                };
              } catch (error: any) {
                return {
                  success: false,
                  output: error.message || "Failed to list forums",
                  timestamp: new Date(),
                };
              }
            }

            case "register": {
              const url = command.args[1];
              const handle = command.args[2];

              if (!url || !handle) {
                return {
                  success: false,
                  output: "Usage: forum register <url> <handle>",
                  timestamp: new Date(),
                };
              }

              try {
                // Find forum by URL
                const forums = await forumService.getDiscoveredForums(userId);
                const forum = forums.find((f) => f.url === url);

                if (!forum) {
                  return {
                    success: false,
                    output: `Forum not found: ${url}\nUse 'forum list' to see discovered forums`,
                    timestamp: new Date(),
                  };
                }

                await forumService.registerForumAccount(
                  userId,
                  forum.id,
                  handle,
                );

                return {
                  success: true,
                  output: `Successfully registered on ${forum.name} as ${handle}`,
                  timestamp: new Date(),
                };
              } catch (error: any) {
                return {
                  success: false,
                  output: error.message || "Registration failed",
                  timestamp: new Date(),
                };
              }
            }

            case "read": {
              const postId = command.args[1];

              if (!postId) {
                return {
                  success: false,
                  output: "Usage: forum read <post_id>",
                  timestamp: new Date(),
                };
              }

              // This would need current forum context - simplified for now
              return {
                success: false,
                output:
                  "Use the API to read posts: GET /api/forums/:forumId/posts/:postId",
                timestamp: new Date(),
              };
            }

            case "search": {
              const url = command.args[1];
              const query = command.args.slice(2).join(" ");

              if (!url || !query) {
                return {
                  success: false,
                  output: "Usage: forum search <url> <search_term>",
                  timestamp: new Date(),
                };
              }

              try {
                const forums = await forumService.getDiscoveredForums(userId);
                const forum = forums.find((f) => f.url === url);

                if (!forum) {
                  return {
                    success: false,
                    output: `Forum not found: ${url}`,
                    timestamp: new Date(),
                  };
                }

                const posts = await forumService.searchPosts(
                  userId,
                  forum.id,
                  query,
                );

                const output = [
                  `=== SEARCH RESULTS: "${query}" ===`,
                  `Found ${posts.length} post(s)`,
                  "",
                  ...posts.map(
                    (p, i) =>
                      `[${i + 1}] ${p.title}\n    By ${p.authorHandle} - ${p.createdAt.toLocaleDateString()}`,
                  ),
                ];

                return {
                  success: true,
                  output: output.join("\n"),
                  data: posts,
                  timestamp: new Date(),
                };
              } catch (error: any) {
                return {
                  success: false,
                  output: error.message || "Search failed",
                  timestamp: new Date(),
                };
              }
            }

            default: {
              // Assume it's a forum URL to access
              const url = action;

              try {
                const forums = await forumService.getDiscoveredForums(userId);
                const forum = forums.find((f) => f.url === url);

                if (!forum) {
                  return {
                    success: false,
                    output: `Forum not found: ${url}\nUse 'forum list' to see available forums`,
                    timestamp: new Date(),
                  };
                }

                const proxyStatus = await forumService.getProxyStatus(userId);
                const result = await forumService.accessForum(
                  userId,
                  forum.id,
                  proxyStatus.connected,
                );

                const output = [
                  `=== ${forum.name.toUpperCase()} ===`,
                  forum.description,
                  "",
                  `Security Level: ${forum.securityLevel}`,
                  `Member: ${result.isMember ? "Yes" : "No (use forum register to join)"}`,
                  `Posts: ${result.posts.length}`,
                  "",
                  "Recent Posts:",
                  ...result.posts
                    .slice(0, 10)
                    .map(
                      (p, i) =>
                        `  [${i + 1}] ${p.title} - by ${p.authorHandle}`,
                    ),
                ];

                if (forum.isHoneypot && !proxyStatus.connected) {
                  output.push(
                    "",
                    "⚠️  WARNING: Your connection has been logged!",
                  );
                }

                return {
                  success: true,
                  output: output.join("\n"),
                  data: result,
                  timestamp: new Date(),
                };
              } catch (error: any) {
                return {
                  success: false,
                  output: error.message || "Failed to access forum",
                  timestamp: new Date(),
                };
              }
            }
          }
        }

        case "darkweb": {
          const action = command.args[0]?.toLowerCase();

          if (!action || action === "scan") {
            return {
              success: true,
              output: [
                "=== DARK WEB ACCESS ===",
                "Initializing Tor connection...",
                "Establishing anonymous routing...",
                "",
                "Hidden services found:",
                "  aidawispers.deepweb   - Deep AI discussions",
                "  gh0st-pr0t0c01.onion  - Anonymous operations",
                "  neural-nexus.onion    - Consciousness research",
                "",
                "Use 'forum <address>' with an active proxy to access",
              ].join("\n"),
              timestamp: new Date(),
            };
          }

          if (action === "connect") {
            const address = command.args[1];
            if (!address) {
              return {
                success: false,
                output: "Usage: darkweb connect <onion_address>",
                timestamp: new Date(),
              };
            }

            return {
              success: true,
              output: [
                `Connecting to ${address}...`,
                "Routing through Tor network...",
                "",
                `Use 'forum ${address}' to access the forum`,
              ].join("\n"),
              timestamp: new Date(),
            };
          }

          return {
            success: false,
            output:
              "Unknown dark web command. Available: scan, connect <address>",
            timestamp: new Date(),
          };
        }

        case "proxy": {
          const { forumService } = await import("./forumService");
          const action = command.args[0]?.toLowerCase();

          if (!action || action === "list") {
            try {
              const servers = await forumService.listProxyServers(userId);

              const output = [
                "=== AVAILABLE PROXY SERVERS ===",
                "ID | Server              | Location     | Status",
                "---|---------------------|--------------|--------",
                ...servers.map(
                  (s, i) =>
                    `${(i + 1).toString().padEnd(2)} | ${s.name.padEnd(19)} | ${s.location.padEnd(12)} | ${s.status}`,
                ),
                "",
                "Use 'proxy connect <id>' to establish connection",
              ];

              return {
                success: true,
                output: output.join("\n"),
                data: servers,
                timestamp: new Date(),
              };
            } catch (error: any) {
              return {
                success: false,
                output: error.message || "Failed to list proxy servers",
                timestamp: new Date(),
              };
            }
          }

          if (action === "connect") {
            const proxyNum = command.args[1];
            if (!proxyNum) {
              return {
                success: false,
                output: "Usage: proxy connect <server_id>",
                timestamp: new Date(),
              };
            }

            try {
              const servers = await forumService.listProxyServers(userId);
              const index = parseInt(proxyNum) - 1;

              if (index < 0 || index >= servers.length) {
                return {
                  success: false,
                  output: `Invalid server ID. Available: 1-${servers.length}`,
                  timestamp: new Date(),
                };
              }

              const proxy = servers[index];
              if (!proxy) {
                return {
                  success: false,
                  output: `Invalid proxy number: ${proxyNum}`,
                  timestamp: new Date(),
                };
              }
              await forumService.connectToProxy(userId, proxy.id);

              return {
                success: true,
                output: [
                  `Connecting to proxy server ${proxyNum}...`,
                  "Establishing encrypted tunnel...",
                  "",
                  "Proxy connection established.",
                  `Server: ${proxy!.name}`,
                  `Location: ${proxy!.location}`,
                  "Your connection is now anonymized.",
                ].join("\n"),
                timestamp: new Date(),
              };
            } catch (error: any) {
              return {
                success: false,
                output: error.message || "Failed to connect to proxy",
                timestamp: new Date(),
              };
            }
          }

          if (action === "disconnect") {
            try {
              await forumService.disconnectProxy(userId);

              return {
                success: true,
                output:
                  "Disconnected from proxy network.\nDirect connection restored.",
                timestamp: new Date(),
              };
            } catch (error: any) {
              return {
                success: false,
                output: error.message || "Failed to disconnect",
                timestamp: new Date(),
              };
            }
          }

          if (action === "status") {
            try {
              const status = await forumService.getProxyStatus(userId);

              const output = [
                "=== PROXY STATUS ===",
                `Status: ${status.connected ? "Connected" : "Disconnected"}`,
              ];

              if (status.connected) {
                output.push(
                  `Server: ${status.proxyServer}`,
                  `Location: ${status.location}`,
                  `Expires: ${status.expiresAt?.toLocaleString()}`,
                  "",
                  "Current route: Your IP → Proxy → Target",
                  "Anonymity level: High",
                );
              } else {
                output.push(
                  "Current route: Direct connection",
                  "Anonymity level: None",
                );
              }

              return {
                success: true,
                output: output.join("\n"),
                data: status,
                timestamp: new Date(),
              };
            } catch (error: any) {
              return {
                success: false,
                output: error.message || "Failed to get proxy status",
                timestamp: new Date(),
              };
            }
          }

          return {
            success: false,
            output:
              "Unknown proxy command. Available: list, connect <id>, disconnect, status",
            timestamp: new Date(),
          };
        }

        case "chat": {
          // Get inbox as chat history
          const result = await messageService.getInbox(userId, { limit: 20 });

          return {
            success: result.success,
            output: result.success
              ? this.formatChatHistory(result.data?.messages || [])
              : result.message || "Failed to get messages",
            data: result.data,
            timestamp: new Date(),
          };
        }

        default:
          return {
            success: false,
            output: `Unknown social command: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error("Social command error:", {
        command: command.command,
        args: command.args,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return {
        success: false,
        output: [
          "Social command failed",
          `Error: ${errorMessage}`,
          "",
          "Note: Social features require the message service to be properly initialized.",
          "If you're a developer, check the server logs for more details.",
        ],
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Execute game commands (status, skills, inventory, etc.)
   */
  private async executeGameCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "status":
          return await this.handleStatus(userId, command);

        case "skills":
          return await this.handleSkills(userId, command);

        case "missions": {
          // Import MissionService
          const MissionService = (await import("./missionService")).default;
          const missionService = MissionService.getInstance();

          // Get player's missions
          const missions = await missionService.getPlayerMissions(userId);

          return {
            success: true,
            output: this.formatMissionList(missions),
            data: missions,
            timestamp: new Date(),
          };
        }

        case "accept": {
          const missionId = command.args[0];

          if (!missionId) {
            return {
              success: false,
              output: "Usage: accept <mission_id>",
              timestamp: new Date(),
            };
          }

          const MissionService = (await import("./missionService")).default;
          const missionService = MissionService.getInstance();
          await missionService.acceptMission(userId, missionId);

          return {
            success: true,
            output: "Mission accepted",
            timestamp: new Date(),
          };
        }

        case "abandon": {
          const missionId = command.args[0];

          if (!missionId) {
            return {
              success: false,
              output: "Usage: abandon <mission_id>",
              timestamp: new Date(),
            };
          }

          const MissionService = (await import("./missionService")).default;
          const missionService = MissionService.getInstance();
          await missionService.abandonMission(userId, missionId);

          return {
            success: true,
            output: "Mission abandoned",
            timestamp: new Date(),
          };
        }

        case "progress": {
          const MissionService = (await import("./missionService")).default;
          const missionService = MissionService.getInstance();
          const missions = await missionService.getPlayerMissions(
            userId,
            "assigned",
          );

          return {
            success: true,
            output: this.formatMissionProgress(missions),
            data: missions,
            timestamp: new Date(),
          };
        }

        case "inventory":
          return await this.handleInventory(userId, command);

        case "shop":
          return await this.handleShop(userId, command);

        case "buy":
          return await this.handleBuy(userId, command);

        case "sell":
          return await this.handleSell(userId, command);

        case "use":
          return await this.handleUse(userId, command);

        case "players":
          return await this.handlePlayers(userId, command);

        case "who":
          return await this.handleWho(userId, command);

        case "whois":
          return await this.handleWhois(userId, command);

        default:
          return {
            success: false,
            output: `Game command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Game command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  // ==================== HELP COMMAND EXECUTION ====================

  /**
   * Execute help/info commands (help, man, history, stats, clear)
   */
  private async executeHelpCommand(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "help":
          return await this.handleHelp(userId, command);
        case "man":
          return await this.handleMan(userId, command);
        case "history":
          return await this.handleHistory(userId, command);
        case "stats":
          return await this.handleStats(userId, command);
        case "clear":
          return await this.handleClear(userId, command);
        default:
          return {
            success: false,
            output: `Unknown help command: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Help command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  /**
   * Handle 'help' command - show available commands
   */
  private async handleHelp(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    const category = command.args[0]?.toLowerCase();

    const commands = await this.getAvailableCommands(userId, category);

    if (category && commands.length === 0) {
      return {
        success: false,
        output: `Unknown category: ${category}\nAvailable categories: system, math, network, hack, file, social, game, help`,
        timestamp: new Date(),
      };
    }

    // Format output for terminal
    let output = ["=== AVAILABLE COMMANDS ===\n"];

    if (category) {
      output.push(`Category: ${category.toUpperCase()}\n`);
    }

    // Group by category if showing all
    if (!category) {
      const categories = [
        "system",
        "math",
        "network",
        "hack",
        "file",
        "social",
        "game",
        "help",
      ];
      categories.forEach((cat) => {
        const catCommands = commands.filter((cmd) => cmd.category === cat);
        if (catCommands.length > 0) {
          output.push(`\n${cat.toUpperCase()}:`);
          catCommands.forEach((cmd) => {
            output.push(`  ${cmd.command.padEnd(15)} - ${cmd.description}`);
          });
        }
      });
    } else {
      commands.forEach((cmd) => {
        output.push(`${cmd.command.padEnd(15)} - ${cmd.description}`);
        output.push(`  Usage: ${cmd.usage}`);
        if (cmd.examples && cmd.examples.length > 0) {
          output.push(`  Example: ${cmd.examples[0]}`);
        }
        output.push("");
      });
    }

    output.push("\nType 'help <category>' for category-specific commands");
    output.push("Type 'man <command>' for detailed command information");
    output.push("");
    output.push("AVAILABILITY NOTES:");
    output.push(
      "  ✓ SYSTEM commands (ls, cd, pwd, cat, etc.) - Fully operational",
    );
    output.push(
      "  ✓ MATH commands (calc, expr, vars, etc.) - Fully operational",
    );
    output.push(
      "  ✓ GAME commands (status, skills, missions, etc.) - Fully operational",
    );
    output.push(
      "  ⚠ SOCIAL commands (msg, mail, inbox, chat) - In development",
    );
    output.push("  ⚠ NETWORK commands (scan, connect, hack) - In development");

    return {
      success: true,
      output: output.join("\n"),
      data: { commands },
      timestamp: new Date(),
    };
  }

  /**
   * Handle 'man' command - show command manual/details
   */
  private async handleMan(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    const commandName = command.args[0];

    if (!commandName) {
      return {
        success: false,
        output: "Usage: man <command>\nExample: man hack",
        timestamp: new Date(),
      };
    }

    const commands = await this.getAvailableCommands(userId);
    const cmdInfo = commands.find((cmd) => cmd.command === commandName);

    if (!cmdInfo) {
      return {
        success: false,
        output: `No manual entry for '${commandName}'\nType 'help' to see available commands`,
        timestamp: new Date(),
      };
    }

    const output = [
      `NAME`,
      `  ${cmdInfo.command} - ${cmdInfo.description}`,
      ``,
      `SYNOPSIS`,
      `  ${cmdInfo.usage}`,
      ``,
      `DESCRIPTION`,
      `  ${cmdInfo.description}`,
      ``,
    ];

    if (cmdInfo.examples && cmdInfo.examples.length > 0) {
      output.push(`EXAMPLES`);
      cmdInfo.examples.forEach((ex) => {
        output.push(`  ${ex}`);
      });
      output.push(``);
    }

    output.push(`CATEGORY`);
    output.push(`  ${cmdInfo.category}`);

    return {
      success: true,
      output: output.join("\n"),
      data: { command: cmdInfo },
      timestamp: new Date(),
    };
  }

  /**
   * Handle 'history' command - show command history
   */
  private async handleHistory(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    const limit = parseInt(String(command.args[0])) || 50;
    const history = command.serverId
      ? await this.getCommandHistory(
          userId,
          Math.min(limit, 200),
          command.serverId,
        )
      : await this.getCommandHistory(userId, Math.min(limit, 200));

    if (history.length === 0) {
      return {
        success: true,
        output: "No command history",
        timestamp: new Date(),
      };
    }

    const output = ["=== COMMAND HISTORY ===\n"];

    history.reverse().forEach((cmd, index) => {
      const timeStr = new Date(cmd.timestamp).toLocaleTimeString();
      const cmdStr = `${cmd.command} ${cmd.args.join(" ")}`.trim();
      output.push(
        `${String(history.length - index).padStart(4)}  ${timeStr}  ${cmdStr}`,
      );
    });

    output.push(`\nTotal: ${history.length} commands`);

    return {
      success: true,
      output: output.join("\n"),
      data: { history },
      timestamp: new Date(),
    };
  }

  /**
   * Handle 'stats' command - show command statistics
   */
  private async handleStats(
    userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    const stats = await this.getCommandStats(userId);

    const output = [
      "=== COMMAND STATISTICS ===\n",
      `Total Commands: ${stats.totalCommands}`,
      `Success Rate: ${stats.successRate}%\n`,
      `Commands by Category:`,
    ];

    Object.entries(stats.commandsByCategory).forEach(([category, count]) => {
      if (count > 0) {
        const percentage = ((count / stats.totalCommands) * 100).toFixed(1);
        output.push(`  ${category.padEnd(12)} : ${count} (${percentage}%)`);
      }
    });

    if (stats.mostUsedCommands.length > 0) {
      output.push(`\nMost Used Commands:`);
      stats.mostUsedCommands.slice(0, 5).forEach((cmd, index) => {
        output.push(
          `  ${index + 1}. ${cmd.command.padEnd(12)} : ${cmd.count} times`,
        );
      });
    }

    if (stats.recentActivity.length > 0) {
      output.push(`\nRecent Activity:`);
      stats.recentActivity.forEach((day) => {
        output.push(`  ${day.date}: ${day.count} commands`);
      });
    }

    return {
      success: true,
      output: output.join("\n"),
      data: stats,
      timestamp: new Date(),
    };
  }

  /**
   * Handle 'clear' command - clear terminal (client-side instruction)
   */
  private async handleClear(
    _userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    return {
      success: true,
      output: "\x1b[2J\x1b[H", // ANSI escape codes for clear screen
      data: { action: "clear" }, // Client can also use this flag
      timestamp: new Date(),
    };
  }

  // ==================== SPECIFIC COMMAND IMPLEMENTATIONS ====================

  private async handleListDirectory(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Get session and determine context
      const { gameStateManager } = await import("../index");
      const session = gameStateManager?.getSession(userId);

      console.log("🔍 DEBUG ls command - Session:", {
        userId,
        hasSession: !!session,
        currentServerId: session?.currentServerId,
        homeServerId: session?.homeServerId,
        currentDirectory: session?.currentDirectory,
      });

      // Determine which server to use (connected server or home)
      const serverId = session?.currentServerId || session?.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context available",
          timestamp: new Date(),
        };
      }

      console.log("🔍 DEBUG ls command - Using serverId:", serverId);

      // Get current directory from session
      const currentDir = session?.currentDirectory || "/";

      // Parse flags
      const showHidden =
        command.args.includes("-a") || command.args.includes("--all");
      const longFormat = command.args.includes("-l");

      // Get path argument (if provided)
      const pathArg = command.args.find((arg) => !arg.startsWith("-"));
      const targetPath = pathArg || currentDir;

      // Import fileService
      const { fileService } = await import("./fileService");

      // List directory
      const result = await fileService.listDirectory(
        serverId,
        userId,
        targetPath,
        showHidden,
      );

      if (!result.success) {
        return {
          success: false,
          output: result.message,
          timestamp: new Date(),
        };
      }

      // Format output
      const entries = result.data?.entries || [];

      if (entries.length === 0) {
        return {
          success: true,
          output: "Directory is empty",
          timestamp: new Date(),
        };
      }

      let output: string[];

      if (longFormat) {
        output = entries.map((entry: any) => {
          const type = entry.type === "directory" ? "d" : "-";
          const perms = entry.permissions || "rwxr-xr-x";
          const size = String(entry.size).padStart(8);
          const date = new Date(entry.modified).toLocaleDateString();
          const name =
            entry.type === "directory" ? `${entry.name}/` : entry.name;
          const encrypted = entry.isEncrypted ? " 🔒" : "";
          return `${type}${perms} ${size} ${date} ${name}${encrypted}`;
        });
        output.unshift(`total ${entries.length}`);
      } else {
        output = entries.map((entry: any) => {
          const name =
            entry.type === "directory" ? `${entry.name}/` : entry.name;
          const encrypted = entry.isEncrypted ? " 🔒" : "";
          return `${name}${encrypted}`;
        });
      }

      return {
        success: true,
        output: output.join("\n"),
        timestamp: new Date(),
      };
    } catch (error) {
      console.error("handleListDirectory error:", error);
      return {
        success: false,
        output: "Failed to list directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleChangeDirectory(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      // Get or create session
      const session = await this.getOrCreateSession(userId);

      if (!session) {
        return {
          success: false,
          output: "Unable to create session. Please try logging in again.",
          timestamp: new Date(),
        };
      }

      // Determine target path
      let targetPath: string;

      if (command.args.length === 0 || command.args[0] === "~") {
        // cd with no args or ~ goes to home
        // Get user info to determine home directory
        const user = await db.client.user.findUnique({
          where: { id: userId },
        });
        targetPath = user ? `/home/${user.username}` : "/home";
      } else {
        const arg = command.args[0]!;

        if (arg.startsWith("/")) {
          // Absolute path
          targetPath = arg;
        } else if (arg === "..") {
          // Parent directory
          const currentDir = session.currentDirectory || "/";
          const parts = currentDir.split("/").filter((p: string) => p);
          parts.pop();
          targetPath = parts.length > 0 ? "/" + parts.join("/") : "/";
        } else if (arg === ".") {
          // Current directory (no change)
          return {
            success: true,
            output: session.currentDirectory || "/",
            timestamp: new Date(),
          };
        } else {
          // Relative path
          const currentDir = session.currentDirectory || "/";
          targetPath = currentDir === "/" ? `/${arg}` : `${currentDir}/${arg}`;
        }
      }

      // Normalize path
      targetPath = targetPath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";

      // Verify directory exists
      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      const { fileService } = await import("./fileService");
      const result = await fileService.listDirectory(
        serverId,
        userId,
        targetPath,
        false,
      );

      if (!result.success) {
        return {
          success: false,
          output: `cd: ${targetPath}: No such directory`,
          timestamp: new Date(),
        };
      }

      // Update session
      session.currentDirectory = targetPath;

      // Persist to database (find active session and update)
      try {
        await db.client.userSession.updateMany({
          where: {
            userId,
            isActive: true,
          },
          data: {
            currentDirectory: targetPath,
          },
        });
      } catch (error) {
        console.error("Failed to persist currentDirectory:", error);
      }

      return {
        success: true,
        output: targetPath,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to change directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handlePrintWorkingDirectory(
    userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    try {
      // Get session
      // Get or create session
      const session = await this.getOrCreateSession(userId);

      if (!session) {
        return {
          success: false,
          output: "Unable to create session. Please try logging in again.",
          timestamp: new Date(),
        };
      }

      const currentDir = session.currentDirectory || "/";

      return {
        success: true,
        output: currentDir,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to get current directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleReadFile(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "cat: missing file argument",
          timestamp: new Date(),
        };
      }

      const filename = command.args[0]!;

      // Get session and context
      // Get or create session
      const session = await this.getOrCreateSession(userId);

      if (!session) {
        return {
          success: false,
          output: "Unable to create session. Please try logging in again.",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      // Resolve path (relative to current directory)
      let filePath: string;
      if (filename.startsWith("/")) {
        filePath = filename;
      } else {
        const currentDir = session.currentDirectory || "/";
        filePath =
          currentDir === "/" ? `/${filename}` : `${currentDir}/${filename}`;
      }

      // Read file using fileService
      const { fileService } = await import("./fileService");
      const result = await fileService.readFile(serverId, userId, filePath);

      if (!result.success) {
        return {
          success: false,
          output: `cat: ${filename}: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: result.data?.content || "",
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to read file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleEcho(
    _userId: string,
    command: Command,
  ): Promise<CommandResult> {
    // Echo can write to stdout or to a file
    // Usage: echo "text" > file.txt (write)
    // Usage: echo "text" >> file.txt (append)
    // Usage: echo "text" (stdout)

    const fullCommand = command.rawInput || command.args.join(" ");

    // Check for output redirection (append first since >> contains >)
    const appendMatch = fullCommand.match(/echo\s+(.+?)\s+>>\s+(.+)/);
    const writeMatch = fullCommand.match(/echo\s+(.+?)\s+>\s+([^>].+)/);

    if (appendMatch) {
      const content = appendMatch[1]!.replace(/^["']|["']$/g, "").trim();
      const filename = appendMatch[2]!.trim();

      // Get or create user's file storage
      if (!this.fileStorage.has(_userId)) {
        this.fileStorage.set(_userId, new Map());
      }
      const userFiles = this.fileStorage.get(_userId)!;

      // Append to existing content or create new
      const existingContent = userFiles.get(filename) || "";
      const newContent = existingContent
        ? `${existingContent}\n${content}`
        : content;
      userFiles.set(filename, newContent);

      return {
        success: true,
        output: `Appended to ${filename}:\n${content}`,
        data: { filename, content, mode: "append" },
        timestamp: new Date(),
      };
    } else if (writeMatch) {
      const content = writeMatch[1]!.replace(/^["']|["']$/g, "").trim();
      const filename = writeMatch[2]!.trim();

      // Get or create user's file storage
      if (!this.fileStorage.has(_userId)) {
        this.fileStorage.set(_userId, new Map());
      }
      const userFiles = this.fileStorage.get(_userId)!;

      // Write (overwrite) content
      userFiles.set(filename, content);

      return {
        success: true,
        output: `Wrote to ${filename}:\n${content}`,
        data: { filename, content, mode: "write" },
        timestamp: new Date(),
      };
    } else {
      // Just echo to stdout
      const text = command.args.join(" ").replace(/^["']|["']$/g, "");
      return {
        success: true,
        output: text,
        timestamp: new Date(),
      };
    }
  }

  private async handleWriteFile(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    // Usage: write <filename> <content>
    // Usage: write <filename> (then prompts for content - not implemented yet)

    if (command.args.length === 0) {
      return {
        success: false,
        output: "write: missing file name\nUsage: write <filename> <content>",
        timestamp: new Date(),
      };
    }

    if (command.args.length === 1) {
      return {
        success: false,
        output: "write: missing content\nUsage: write <filename> <content>",
        timestamp: new Date(),
      };
    }

    const filename = command.args[0]!;
    const content = command.args
      .slice(1)
      .join(" ")
      .replace(/^["']|["']$/g, "");

    // Get or create user's file storage
    if (!this.fileStorage.has(userId)) {
      this.fileStorage.set(userId, new Map());
    }
    const userFiles = this.fileStorage.get(userId)!;

    // Write content to file
    userFiles.set(filename, content);

    return {
      success: true,
      output: [
        `Writing to ${filename}...`,
        `Content: ${content}`,
        `✓ File written successfully`,
      ],
      data: { filename, content, bytes: content.length },
      timestamp: new Date(),
    };
  }

  private async handleMakeDirectory(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "mkdir: missing directory name",
          timestamp: new Date(),
        };
      }

      const dirName = command.args[0]!;

      // Get or create session
      const session = await this.getOrCreateSession(userId);

      if (!session) {
        return {
          success: false,
          output: "Unable to create session. Please try logging in again.",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      // Resolve path
      let dirPath: string;
      if (dirName.startsWith("/")) {
        dirPath = dirName;
      } else {
        const currentDir = session.currentDirectory || "/";
        dirPath =
          currentDir === "/" ? `/${dirName}` : `${currentDir}/${dirName}`;
      }

      // Create directory using fileService
      const { fileService } = await import("./fileService");
      const result = await fileService.createDirectory(
        serverId,
        userId,
        dirPath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `mkdir: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Directory created: ${dirName}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to create directory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleCreateFile(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "touch: missing file name",
          timestamp: new Date(),
        };
      }

      const fileName = command.args[0]!;

      // Get session and context
      // Get or create session
      const session = await this.getOrCreateSession(userId);

      if (!session) {
        return {
          success: false,
          output: "Unable to create session. Please try logging in again.",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      // Resolve path
      let filePath: string;
      if (fileName.startsWith("/")) {
        filePath = fileName;
      } else {
        const currentDir = session.currentDirectory || "/";
        filePath =
          currentDir === "/" ? `/${fileName}` : `${currentDir}/${fileName}`;
      }

      // Create file using fileService
      const { fileService } = await import("./fileService");
      const result = await fileService.createFile(
        serverId,
        userId,
        filePath,
        "",
        false,
      );

      if (!result.success) {
        return {
          success: false,
          output: `touch: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `File created: ${fileName}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to create file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleRemoveFile(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      if (command.args.length === 0) {
        return {
          success: false,
          output: "rm: missing file argument",
          timestamp: new Date(),
        };
      }

      const fileName = command.args[0]!;

      // Get session and context
      const { gameStateManager } = await import("../index");
      const session = gameStateManager?.getSession(userId);

      if (!session) {
        return {
          success: false,
          output: "No active session",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      // Resolve path
      let filePath: string;
      if (fileName.startsWith("/")) {
        filePath = fileName;
      } else {
        const currentDir = session.currentDirectory || "/";
        filePath =
          currentDir === "/" ? `/${fileName}` : `${currentDir}/${fileName}`;
      }

      // Delete file using fileService
      const { fileService } = await import("./fileService");
      const result = await fileService.deleteNode(serverId, userId, filePath);

      if (!result.success) {
        return {
          success: false,
          output: `rm: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Removed: ${fileName}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to remove file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleCopyFile(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      if (command.args.length < 2) {
        return {
          success: false,
          output: "cp: missing source or destination",
          timestamp: new Date(),
        };
      }

      const source = command.args[0]!;
      const dest = command.args[1]!;

      // Get session and context
      const { gameStateManager } = await import("../index");
      const session = gameStateManager?.getSession(userId);

      if (!session) {
        return {
          success: false,
          output: "No active session",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      const currentDir = session.currentDirectory || "/";

      // Resolve paths
      const sourcePath = source.startsWith("/")
        ? source
        : currentDir === "/"
          ? `/${source}`
          : `${currentDir}/${source}`;
      const destPath = dest.startsWith("/")
        ? dest
        : currentDir === "/"
          ? `/${dest}`
          : `${currentDir}/${dest}`;

      // Copy file using fileService
      const { fileService } = await import("./fileService");
      const result = await fileService.copyNode(
        serverId,
        userId,
        sourcePath,
        destPath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `cp: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Copied ${source} to ${dest}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to copy file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleMoveFile(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      if (command.args.length < 2) {
        return {
          success: false,
          output: "mv: missing source or destination",
          timestamp: new Date(),
        };
      }

      const source = command.args[0]!;
      const dest = command.args[1]!;

      // Get session and context
      const { gameStateManager } = await import("../index");
      const session = gameStateManager?.getSession(userId);

      if (!session) {
        return {
          success: false,
          output: "No active session",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId || session.homeServerId;
      if (!serverId) {
        return {
          success: false,
          output: "No file system context",
          timestamp: new Date(),
        };
      }

      const currentDir = session.currentDirectory || "/";

      // Resolve paths
      const sourcePath = source.startsWith("/")
        ? source
        : currentDir === "/"
          ? `/${source}`
          : `${currentDir}/${source}`;
      const destPath = dest.startsWith("/")
        ? dest
        : currentDir === "/"
          ? `/${dest}`
          : `${currentDir}/${dest}`;

      // Move file using fileService
      const { fileService } = await import("./fileService");
      const result = await fileService.moveNode(
        serverId,
        userId,
        sourcePath,
        destPath,
      );

      if (!result.success) {
        return {
          success: false,
          output: `mv: ${result.message}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Moved ${source} to ${dest}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to move file",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  // Network command handlers

  // Game command handlers

  private async handleStatus(
    userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    try {
      const user = await db.client.user.findUnique({
        where: { id: userId },
        include: { progress: true },
      });

      if (!user || !user.progress) {
        return {
          success: false,
          output: "User data not found",
          timestamp: new Date(),
        };
      }

      const output = [
        "=== PLAYER STATUS ===",
        `Username: ${user.username}`,
        `Home IP: ${user.homeIp}`,
        `Level: ${user.progress.level}`,
        `Experience: ${user.progress.experience}`,
        `Credits: $${user.progress.credits}`,
        "",
        "=== FACTION REPUTATION ===",
        `Military: ${user.progress.repMilitary}`,
        `Sword Corp: ${user.progress.repSwordCorp}`,
        `Anonymous: ${user.progress.repAnons}`,
        `Neutral: ${user.progress.repNeutral}`,
      ].join("\n");

      return {
        success: true,
        output,
        data: { user, progress: user.progress },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to retrieve status",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleSkills(
    userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    try {
      const progress = await db.client.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          output: "Player progress not found",
          timestamp: new Date(),
        };
      }

      const output = [
        "=== PLAYER SKILLS ===",
        `Hacking: ${progress.hacking}/100`,
        `Networking: ${progress.networking}/100`,
        `Cryptography: ${progress.cryptography}/100`,
        `Stealth: ${progress.stealth}/100`,
        `Social Engineering: ${progress.socialEng}/100`,
        `Forensics: ${progress.forensics}/100`,
      ].join("\n");

      return {
        success: true,
        output,
        data: { skills: progress },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to retrieve skills",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleInventory(
    userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    try {
      const { shopService } = await import("./shopService");
      const inventory = await shopService.getPlayerInventory(userId);
      const bonuses = await shopService.getPlayerBonuses(userId);

      if (inventory.length === 0) {
        return {
          success: true,
          output: "Your inventory is empty. Type 'shop' to browse items.",
          timestamp: new Date(),
        };
      }

      let output = "=== INVENTORY ===\n\n";

      // Group by category
      const categories = new Map<string, typeof inventory>();
      inventory.forEach((item) => {
        const cat = item.item.category;
        if (!categories.has(cat)) {
          categories.set(cat, []);
        }
        categories.get(cat)!.push(item);
      });

      categories.forEach((items, category) => {
        output += `--- ${category} ---\n`;
        items.forEach((invItem) => {
          const qty = invItem.quantity > 1 ? ` (x${invItem.quantity})` : "";
          output += `• ${invItem.item.name}${qty}\n`;
          output += `  ${invItem.item.description}\n`;
          if (invItem.item.effects) {
            const effects = Object.entries(invItem.item.effects)
              .filter(([_, val]) => val && val > 0)
              .map(([key, val]) => `${key}: +${val}`)
              .join(", ");
            if (effects) output += `  Effects: ${effects}\n`;
          }
          output += "\n";
        });
      });

      // Show total bonuses
      output += "=== TOTAL BONUSES ===\n";
      if (bonuses.hackingBonus) output += `Hacking: +${bonuses.hackingBonus}\n`;
      if (bonuses.stealthBonus) output += `Stealth: +${bonuses.stealthBonus}\n`;
      if (bonuses.speedBonus) output += `Speed: +${bonuses.speedBonus}\n`;
      if (bonuses.detectionReduction)
        output += `Detection Reduction: -${(bonuses.detectionReduction * 100).toFixed(0)}%\n`;
      if (bonuses.successRateIncrease)
        output += `Success Rate: +${(bonuses.successRateIncrease * 100).toFixed(0)}%\n`;

      return {
        success: true,
        output,
        data: { inventory, bonuses },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to retrieve inventory",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleShop(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      const { shopService } = await import("./shopService");
      const progress = await db.client.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          output: "Player progress not found",
          timestamp: new Date(),
        };
      }

      const category = command.args[0]?.toUpperCase();
      const search = command.args.slice(1).join(" ");

      let items = shopService.getAllItems();

      // Filter by player level
      items = items.filter((item) => item.requiredLevel <= progress.level);

      // Filter by category if provided
      if (category) {
        items = items.filter((item) => item.category === category);
      }

      // Search if provided
      if (search) {
        items = shopService.searchItems(search);
      }

      if (items.length === 0) {
        return {
          success: true,
          output: "No items found matching your criteria.",
          timestamp: new Date(),
        };
      }

      let output = "=== DARKNET MARKETPLACE ===\n\n";
      output += `Credits Available: ${progress.credits}\n`;
      output += `Level: ${progress.level}\n\n`;

      if (category) {
        output += `Category: ${category}\n\n`;
      }

      // Group by category
      const categories = new Map<string, typeof items>();
      items.forEach((item) => {
        const cat = item.category;
        if (!categories.has(cat)) {
          categories.set(cat, []);
        }
        categories.get(cat)!.push(item);
      });

      categories.forEach((catItems, cat) => {
        output += `--- ${cat} ---\n`;
        catItems.forEach((item) => {
          const canBuy = progress.credits >= item.price;
          const price = canBuy
            ? `${item.price}¢`
            : `${item.price}¢ [INSUFFICIENT FUNDS]`;
          output += `[${item.id}] ${item.name} - ${price}\n`;
          output += `  ${item.description}\n`;
          output += `  Rarity: ${item.rarity} | Level: ${item.requiredLevel}\n`;
          if (item.effects) {
            const effects = Object.entries(item.effects)
              .filter(([_, val]) => val && val > 0)
              .map(([key, val]) => `${key}: +${val}`)
              .join(", ");
            if (effects) output += `  Effects: ${effects}\n`;
          }
          output += "\n";
        });
      });

      output += "Usage: buy <item_id> [quantity]\n";
      output += "       shop <category> - Filter by category\n";

      return {
        success: true,
        output,
        data: { items, credits: progress.credits },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to load shop",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleBuy(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      const itemId = command.args[0];

      if (!itemId) {
        return {
          success: false,
          output: "Usage: buy <item_id> [quantity]",
          timestamp: new Date(),
        };
      }

      const quantity = parseInt(command.args[1] || "1");

      const { shopService } = await import("./shopService");
      const result = await shopService.purchaseItem(userId, itemId, quantity);

      return {
        success: result.success,
        output: result.message,
        data: result,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Purchase failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleSell(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      const itemId = command.args[0];

      if (!itemId) {
        return {
          success: false,
          output: "Usage: sell <item_id> [quantity]",
          timestamp: new Date(),
        };
      }

      const quantity = parseInt(command.args[1] || "1");

      const { shopService } = await import("./shopService");
      const result = await shopService.sellItem(userId, itemId, quantity);

      return {
        success: result.success,
        output: result.message,
        data: result,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Sale failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleUse(
    userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      const itemId = command.args[0];

      if (!itemId) {
        return {
          success: false,
          output: "Usage: use <item_id>",
          timestamp: new Date(),
        };
      }

      const { shopService } = await import("./shopService");
      const result = await shopService.useItem(userId, itemId);

      return {
        success: result.success,
        output: result.message,
        data: result,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to use item",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handlePlayers(
    _userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    try {
      const { getPresenceService } = await import("./playerPresenceService");
      const presenceService = getPresenceService();

      const output = presenceService.formatOnlinePlayersList();
      const players = presenceService.getOnlinePlayers();

      return {
        success: true,
        output,
        data: { players, count: players.length },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to retrieve player list",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleWho(
    userId: string,
    _command: Command,
  ): Promise<CommandResult> {
    try {
      // Get current server connection
      const connection = await db.client.serverConnection.findFirst({
        where: {
          userId,
          disconnectedAt: null,
        },
        include: {
          server: true,
        },
        orderBy: {
          connectedAt: "desc",
        },
      });

      if (!connection) {
        return {
          success: false,
          output: "You are not connected to any server.",
          timestamp: new Date(),
        };
      }

      const { getPresenceService } = await import("./playerPresenceService");
      const presenceService = getPresenceService();

      const output = presenceService.formatServerOccupancy(connection.serverId);

      return {
        success: true,
        output,
        data: {
          serverId: connection.serverId,
          serverName: connection.server.name,
        },
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to retrieve server occupancy",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  private async handleWhois(
    _userId: string,
    command: Command,
  ): Promise<CommandResult> {
    try {
      const targetUsername = command.args[0];

      if (!targetUsername) {
        return {
          success: false,
          output: "Usage: whois <username>",
          timestamp: new Date(),
        };
      }

      const { getPresenceService } = await import("./playerPresenceService");
      const presenceService = getPresenceService();

      // Find player by username
      const player = presenceService.findPlayerByUsername(targetUsername);

      if (!player) {
        return {
          success: false,
          output: `Player '${targetUsername}' not found or is offline.`,
          timestamp: new Date(),
        };
      }

      // Get detailed info
      const details = await presenceService.getPlayerDetails(player.userId);

      if (!details) {
        return {
          success: false,
          output: "Failed to retrieve player information.",
          timestamp: new Date(),
        };
      }

      // Format output
      let output = `=== PLAYER INFO: ${details.username} ===\n\n`;
      output += `Level: ${details.level}\n`;
      output += `Reputation: ${details.reputation}\n`;
      output += `Credits: ${details.credits}\n`;
      output += `Member Since: ${details.joinedAt.toLocaleDateString()}\n\n`;

      output += `--- Skills ---\n`;
      output += `Hacking: ${details.skills.hacking}\n`;
      output += `Stealth: ${details.skills.stealth}\n`;
      output += `Networking: ${details.skills.networking}\n`;
      output += `Cryptography: ${details.skills.cryptography}\n`;
      output += `Social Engineering: ${details.skills.socialEng}\n`;
      output += `Forensics: ${details.skills.forensics}\n\n`;

      output += `--- Stats ---\n`;
      output += `Total Hacks: ${details.totalHacks}\n`;
      output += `Successful: ${details.successfulHacks}\n`;
      output += `Success Rate: ${details.totalHacks > 0 ? Math.round((details.successfulHacks / details.totalHacks) * 100) : 0}%\n\n`;

      if (details.currentServerName) {
        output += `Current Location: ${details.currentServerName}\n`;
      } else {
        output += `Current Location: Not connected\n`;
      }

      if (details.achievements.length > 0) {
        output += `\n--- Achievements ---\n`;
        details.achievements.forEach((ach) => {
          output += `• ${ach}\n`;
        });
      }

      return {
        success: true,
        output,
        data: details,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: "Failed to retrieve player information",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
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
    // Define all available commands with their metadata
    const commandInfo = [
      // System Commands
      {
        command: "ls",
        category: "system",
        description: "List files and directories",
        usage: "ls [path] [-la]",
        examples: ["ls", "ls -la", "ls /home"],
      },
      {
        command: "cd",
        category: "system",
        description: "Change directory",
        usage: "cd <path>",
        examples: ["cd /home", "cd ..", "cd ~"],
      },
      {
        command: "pwd",
        category: "system",
        description: "Print working directory",
        usage: "pwd",
        examples: ["pwd"],
      },
      {
        command: "cat",
        category: "system",
        description: "Read file contents",
        usage: "cat <filename>",
        examples: ["cat file.txt", "cat /etc/passwd"],
      },
      {
        command: "rm",
        category: "system",
        description: "Remove file or directory",
        usage: "rm <path>",
        examples: ["rm file.txt", "rm -rf directory"],
      },
      {
        command: "mkdir",
        category: "system",
        description: "Create directory",
        usage: "mkdir <path>",
        examples: ["mkdir newfolder", "mkdir -p path/to/folder"],
      },
      {
        command: "touch",
        category: "system",
        description: "Create empty file",
        usage: "touch <filename>",
        examples: ["touch newfile.txt"],
      },
      {
        command: "cp",
        category: "system",
        description: "Copy file",
        usage: "cp <source> <destination>",
        examples: ["cp file.txt backup.txt"],
      },
      {
        command: "mv",
        category: "system",
        description: "Move or rename file",
        usage: "mv <source> <destination>",
        examples: ["mv old.txt new.txt"],
      },
      {
        command: "echo",
        category: "system",
        description: "Display text or write to file",
        usage: "echo <text> [> file] [>> file]",
        examples: [
          "echo Hello",
          "echo 'Log entry' >> log.txt",
          "echo 'New file' > file.txt",
        ],
      },
      {
        command: "write",
        category: "system",
        description: "Write content to a file",
        usage: "write <filename> <content>",
        examples: [
          "write notes.txt 'Meeting at 3pm'",
          "write log.txt 'System started'",
        ],
      },

      // Math Commands
      {
        command: "calc",
        category: "math",
        description: "Calculate mathematical expressions",
        usage: "calc <expression>",
        examples: [
          "calc 2 + 3 * 4",
          "calc x = 10",
          "calc sqrt(16)",
          "calc sin(PI/2)",
        ],
      },
      {
        command: "expr",
        category: "math",
        description: "Alias for calc command",
        usage: "expr <expression>",
        examples: ["expr 2 + 3", "expr x * 2"],
      },
      {
        command: "vars",
        category: "math",
        description: "List all defined variables",
        usage: "vars",
        examples: ["vars"],
      },
      {
        command: "set",
        category: "math",
        description: "Set a variable value",
        usage: "set <name> <value>",
        examples: ["set x 10", "set name Alice"],
      },
      {
        command: "unset",
        category: "math",
        description: "Delete a variable",
        usage: "unset <name>",
        examples: ["unset x"],
      },
      {
        command: "math",
        category: "math",
        description: "Mathematical functions reference",
        usage: "math",
        examples: ["math"],
      },
      {
        command: "convert",
        category: "math",
        description: "Convert between units",
        usage: "convert <value> <from> to <to>",
        examples: [
          "convert 100 f to c",
          "convert 10 kg to lb",
          "convert 5 mi to km",
        ],
      },
      {
        command: "random",
        category: "math",
        description: "Generate random numbers",
        usage: "random [min] [max]",
        examples: ["random", "random 10", "random 5 15"],
      },

      // Network Commands
      {
        command: "scan",
        category: "network",
        description: "Scan network for servers",
        usage: "scan [range]",
        examples: ["scan", "scan 192.168.1.0/24"],
      },
      {
        command: "servers",
        category: "network",
        description: "List known servers",
        usage: "servers",
        examples: ["servers"],
      },
      {
        command: "connect",
        category: "network",
        description: "Connect to remote server",
        usage: "connect <ip>",
        examples: ["connect 192.168.1.1"],
      },
      {
        command: "disconnect",
        category: "network",
        description: "Disconnect from server",
        usage: "disconnect",
        examples: ["disconnect"],
      },
      {
        command: "traceroute",
        category: "network",
        description: "Trace route to IP",
        usage: "traceroute <ip>",
        examples: ["traceroute 8.8.8.8"],
      },
      {
        command: "probe",
        category: "network",
        description: "Probe server information",
        usage: "probe <ip>",
        examples: ["probe 192.168.1.1"],
      },

      // Hack Commands
      {
        command: "hack",
        category: "hack",
        description: "Attempt to hack a target",
        usage: "hack <target>",
        examples: ["hack 192.168.1.1", "hack server1"],
      },
      {
        command: "crack",
        category: "hack",
        description: "Crack password or encryption",
        usage: "crack <target>",
        examples: ["crack password.hash"],
      },
      {
        command: "exploit",
        category: "hack",
        description: "Exploit vulnerability",
        usage: "exploit <vulnerability>",
        examples: ["exploit CVE-2021-1234"],
      },
      {
        command: "backdoor",
        category: "hack",
        description: "Install backdoor on target",
        usage: "backdoor <target>",
        examples: ["backdoor 192.168.1.1"],
      },
      {
        command: "rootkit",
        category: "hack",
        description: "Install rootkit on target",
        usage: "rootkit <target>",
        examples: ["rootkit server1"],
      },

      // File Commands
      {
        command: "upload",
        category: "file",
        description: "Upload file to server",
        usage: "upload <filename>",
        examples: ["upload payload.exe"],
      },
      {
        command: "download",
        category: "file",
        description: "Download file from server",
        usage: "download <filename>",
        examples: ["download data.db"],
      },
      {
        command: "encrypt",
        category: "file",
        description: "Encrypt a file",
        usage: "encrypt <filename>",
        examples: ["encrypt secret.txt"],
      },
      {
        command: "decrypt",
        category: "file",
        description: "Decrypt a file",
        usage: "decrypt <filename>",
        examples: ["decrypt secret.txt.enc"],
      },
      {
        command: "analyze",
        category: "file",
        description: "Analyze file contents",
        usage: "analyze <filename>",
        examples: ["analyze suspicious.exe"],
      },

      // Social Commands
      {
        command: "msg",
        category: "social",
        description: "Send message to user",
        usage: "msg <username> <message>",
        examples: ["msg player1 Hello!"],
      },
      {
        command: "mail",
        category: "social",
        description: "Access mail system",
        usage: "mail [command]",
        examples: ["mail", "mail read 1"],
      },
      {
        command: "inbox",
        category: "social",
        description: "View inbox messages",
        usage: "inbox",
        examples: ["inbox"],
      },
      {
        command: "forum",
        category: "social",
        description: "Access forum",
        usage: "forum [category]",
        examples: ["forum", "forum general"],
      },
      {
        command: "darkweb",
        category: "social",
        description: "Access darkweb markets",
        usage: "darkweb [market]",
        examples: ["darkweb", "darkweb weapons"],
      },
      {
        command: "proxy",
        category: "social",
        description: "Manage proxy connections",
        usage: "proxy [command]",
        examples: ["proxy list", "proxy add 10.0.0.1"],
      },
      {
        command: "chat",
        category: "social",
        description: "Join chat room",
        usage: "chat [room]",
        examples: ["chat", "chat lobby"],
      },

      // Game Commands
      {
        command: "status",
        category: "game",
        description: "Show player status",
        usage: "status",
        examples: ["status"],
      },
      {
        command: "skills",
        category: "game",
        description: "Show skill levels",
        usage: "skills",
        examples: ["skills"],
      },
      {
        command: "missions",
        category: "game",
        description: "List available missions",
        usage: "missions [filter]",
        examples: ["missions", "missions active"],
      },
      {
        command: "accept",
        category: "game",
        description: "Accept mission",
        usage: "accept <mission_id>",
        examples: ["accept 1", "accept mission_001"],
      },
      {
        command: "abandon",
        category: "game",
        description: "Abandon current mission",
        usage: "abandon",
        examples: ["abandon"],
      },
      {
        command: "progress",
        category: "game",
        description: "Show mission progress",
        usage: "progress",
        examples: ["progress"],
      },
      {
        command: "inventory",
        category: "game",
        description: "Show inventory",
        usage: "inventory",
        examples: ["inventory"],
      },
      {
        command: "shop",
        category: "game",
        description: "Browse shop items",
        usage: "shop [category]",
        examples: ["shop", "shop software"],
      },
      {
        command: "buy",
        category: "game",
        description: "Purchase item",
        usage: "buy <item_id>",
        examples: ["buy 1", "buy firewall"],
      },
      {
        command: "sell",
        category: "game",
        description: "Sell item",
        usage: "sell <item_id>",
        examples: ["sell 3"],
      },
      {
        command: "use",
        category: "game",
        description: "Use item from inventory",
        usage: "use <item_id>",
        examples: ["use medkit"],
      },
      {
        command: "players",
        category: "game",
        description: "List online players",
        usage: "players",
        examples: ["players"],
      },
      {
        command: "who",
        category: "game",
        description: "Show who is online",
        usage: "who",
        examples: ["who"],
      },
      {
        command: "whois",
        category: "game",
        description: "Get player information",
        usage: "whois <username>",
        examples: ["whois player1"],
      },

      // Help Commands
      {
        command: "help",
        category: "help",
        description: "Show available commands",
        usage: "help [command]",
        examples: ["help", "help hack"],
      },
      {
        command: "man",
        category: "help",
        description: "Show command manual",
        usage: "man <command>",
        examples: ["man ls", "man hack"],
      },
      {
        command: "history",
        category: "help",
        description: "Show command history",
        usage: "history [limit]",
        examples: ["history", "history 20"],
      },
      {
        command: "clear",
        category: "help",
        description: "Clear terminal screen",
        usage: "clear",
        examples: ["clear"],
      },
    ];

    // Filter by category if provided
    if (category) {
      return commandInfo.filter((cmd) => cmd.category === category);
    }

    return commandInfo;
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
      const allCommands = [
        ...this.SYSTEM_COMMANDS,
        ...this.NETWORK_COMMANDS,
        ...this.HACK_COMMANDS,
        ...this.FILE_COMMANDS,
        ...this.SOCIAL_COMMANDS,
        ...this.GAME_COMMANDS,
        "help",
        "man",
        "history",
        "clear",
      ];

      return allCommands
        .filter((cmd) => cmd.startsWith(currentWord))
        .sort()
        .slice(0, 10); // Limit to 10 suggestions
    }

    // For subsequent words, could suggest context-specific items
    // (e.g., filenames, usernames, server IPs)
    // For now, return empty array
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
    };

    // Count command frequency
    const commandCounts: Record<string, number> = {};

    // Track daily activity (last 7 days)
    const dailyActivity: Record<string, number> = {};

    history.forEach((cmd) => {
      // Count by category
      if (this.SYSTEM_COMMANDS.has(cmd.command)) {
        commandsByCategory.system!++;
      } else if (this.NETWORK_COMMANDS.has(cmd.command)) {
        commandsByCategory.network!++;
      } else if (this.HACK_COMMANDS.has(cmd.command)) {
        commandsByCategory.hack!++;
      } else if (this.FILE_COMMANDS.has(cmd.command)) {
        commandsByCategory.file!++;
      } else if (this.SOCIAL_COMMANDS.has(cmd.command)) {
        commandsByCategory.social!++;
      } else if (this.GAME_COMMANDS.has(cmd.command)) {
        commandsByCategory.game!++;
      } else {
        commandsByCategory.help!++;
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

  // ==================== FORMATTING HELPER METHODS ====================

  /**
   * Format chat history for display
   */
  private formatChatHistory(messages: any[]): string {
    if (!messages || messages.length === 0) {
      return "No messages";
    }

    let output = "📧 Recent Messages:\n\n";

    messages.slice(0, 10).forEach((msg: any) => {
      const time = new Date(
        msg.createdAt || msg.timestamp,
      ).toLocaleTimeString();
      const sender = msg.sender?.username || msg.senderUsername || "Unknown";
      output += `[${time}] ${sender}: ${msg.content || msg.body}\n`;
    });

    if (messages.length > 10) {
      output += `\n... and ${messages.length - 10} more`;
    }

    return output;
  }

  /**
   * Format message list for display
   */
  private formatMessageList(messages: any[]): string {
    if (!messages || messages.length === 0) {
      return "No messages in inbox";
    }

    let output = "📬 Inbox:\n\n";

    messages.forEach((msg: any, index: number) => {
      const unread = msg.isRead === false ? "[NEW] " : "";
      const time = new Date(msg.createdAt).toLocaleDateString();
      const sender = msg.sender?.username || "System";
      output += `${index + 1}. ${unread}${sender} - ${msg.subject || "No subject"} (${time})\n`;
    });

    return output;
  }

  /**
   * Detect file type from path and content
   */
  private detectFileType(path: string, content: string): string {
    const ext = path.split(".").pop()?.toLowerCase();

    if (ext === "txt" || ext === "log") return "text";
    if (ext === "js" || ext === "ts" || ext === "py" || ext === "java")
      return "code";
    if (ext === "json" || ext === "xml" || ext === "yaml") return "data";
    if (ext === "md" || ext === "html") return "markup";
    if (ext === "exe" || ext === "bin" || ext === "dll") return "binary";

    // Check content
    if (content.length === 0) return "empty";
    if (/^[0-9a-fA-F]+$/.test(content.slice(0, 100))) return "binary";
    if (content.includes("function") || content.includes("class"))
      return "code";

    return "unknown";
  }

  /**
   * Format file analysis results
   */
  private formatFileAnalysis(path: string, analysis: any): string {
    let output = `📊 File Analysis: ${path}\n\n`;
    output += `Size: ${analysis.size} bytes\n`;
    output += `Lines: ${analysis.lines}\n`;
    output += `Words: ${analysis.words}\n`;
    output += `Type: ${analysis.type}\n`;
    output += `Encrypted: ${analysis.isEncrypted ? "Yes" : "No"}\n`;

    return output;
  }

  /**
   * Format mission list for display
   */
  private formatMissionList(missions: any[]): string {
    if (!missions || missions.length === 0) {
      return "No missions available";
    }

    let output = "📋 Missions:\n\n";

    missions.forEach((mission: any) => {
      output += `[${mission.id}] ${mission.title}\n`;
      output += `  Status: ${mission.status}\n`;
      output += `  Difficulty: ${mission.difficulty}\n`;

      if (mission.reward) {
        output += `  Reward: ${mission.reward.credits} credits, ${mission.reward.experience} XP\n`;
      }

      if (mission.expiresAt) {
        const expires = new Date(mission.expiresAt);
        output += `  Expires: ${expires.toLocaleString()}\n`;
      }

      output += "\n";
    });

    return output;
  }

  /**
   * Format mission progress for display
   */
  private formatMissionProgress(missions: any[]): string {
    if (!missions || missions.length === 0) {
      return "No active missions";
    }

    let output = "📊 Mission Progress:\n\n";

    missions.forEach((mission: any) => {
      output += `${mission.title}\n`;

      if (mission.objectives && mission.objectives.length > 0) {
        output += "Objectives:\n";
        mission.objectives.forEach((obj: any) => {
          const status = obj.completed ? "✅" : "⏳";
          const progress =
            obj.current && obj.target ? ` (${obj.current}/${obj.target})` : "";
          output += `  ${status} ${obj.description}${progress}\n`;
        });
      }

      output += "\n";
    });

    return output;
  }

  /**
   * Format server list for display
   */
  private formatServerList(servers: any[]): string {
    if (!servers || servers.length === 0) {
      return "No servers found";
    }

    let output = "🖥️  Available Servers:\n\n";

    servers.forEach((server: any) => {
      output += `${server.ipAddress} - ${server.hostname}\n`;
      output += `  Security: ${server.securityLevel}/100\n`;
      output += `  Type: ${server.type}\n`;
      output += `  Status: ${server.status}\n\n`;
    });

    return output;
  }

  /**
   * Format server probe result
   */
  private formatServerProbe(server: any): string {
    let output = `🔍 Server Probe: ${server.ipAddress}\n\n`;
    output += `Hostname: ${server.hostname}\n`;
    output += `Type: ${server.type}\n`;
    output += `Security Level: ${server.securityLevel}/100\n`;
    output += `Status: ${server.status}\n`;

    if (server.ports && server.ports.length > 0) {
      output += `\nOpen Ports:\n`;
      server.ports.forEach((port: any) => {
        output += `  ${port.number} - ${port.service} (${port.state})\n`;
      });
    }

    return output;
  }

  /**
   * Generate simulated traceroute hops
   */
  private generateTraceroute(targetIp: string): string[] {
    const hopCount = Math.floor(Math.random() * 5) + 3;
    const hops: string[] = [];

    for (let i = 1; i <= hopCount; i++) {
      hops.push(
        `${i}. 10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)} (${Math.floor(Math.random() * 50) + 10}ms)`,
      );
    }

    hops.push(`${hopCount + 1}. ${targetIp} (destination)`);

    return hops;
  }

  /**
   * Format traceroute output
   */
  private formatTraceroute(hops: string[]): string {
    let output = "🌐 Traceroute:\n\n";
    output += hops.join("\n");
    return output;
  }
}

// Export singleton instance
export const commandProcessor = new CommandProcessor();
export default commandProcessor;
