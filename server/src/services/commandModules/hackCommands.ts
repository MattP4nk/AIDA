import { Command, CommandResult, HackMethod } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import {
  boxTop,
  boxBottom,
  boxRow,
  boxDivider,
  boxCenter,
  pad,
  padRight,
  formatDuration,
  progressBar,
} from "./asciiBox";
import logger from "../../logger";

/**
 * HackCommandsModule
 * Handles hacking related commands such as:
 *   - hack: attempt to hack a target server
 *   - crack: crack encryption on a message
 *   - exploit: use an exploit tool against a server
 *   - backdoor: install a backdoor on a compromised server
 *   - rootkit: install a rootkit for persistent access
 *   - scan: (delegated to NetworkCommandsModule) placeholder here
 */
export class HackCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "hack",
    "crack",
    "exploit",
    "backdoor",
    "rootkit",
    "crack.submit",
    "firewall.knock",
    "memory.extract",
    "hack.hint",
    "hack.status",
    "hack.abort",
    "backdoor.list",
    "backdoor.use",
    "backdoor.remove",
    "security.scan",
    "trace.status",
    "trace.evade",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "hack":
          return await this.handleHack(command, context);
        case "crack":
          return await this.handleCrack(command, context);
        case "exploit":
          return await this.handleExploit(command, context);
        case "backdoor":
          return await this.handleBackdoor(command, context);
        case "rootkit":
          return await this.handleRootkit(command, context);
        case "crack.submit":
          return await this.handleCrackSubmit(command, context);
        case "firewall.knock":
          return await this.handleFirewallKnock(command, context);
        case "memory.extract":
          return await this.handleMemoryExtract(command, context);
        case "hack.hint":
          return await this.handleHackHint(command, context);
        case "hack.status":
          return await this.handleHackStatus(command, context);
        case "hack.abort":
          return await this.handleHackAbort(command, context);
        case "backdoor.list":
          return await this.handleBackdoorList(command, context);
        case "backdoor.use":
          return await this.handleBackdoorUse(command, context);
        case "backdoor.remove":
          return await this.handleBackdoorRemove(command, context);
        case "security.scan":
          return await this.handleSecurityScan(command, context);
        case "trace.status":
          return await this.handleTraceStatus(command, context);
        case "trace.evade":
          return await this.handleTraceEvade(command, context);
        default:
          return {
            success: false,
            output: `Hack command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Hack command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "hack",
        category: "hack",
        description: "[Hacking 20] Attempt to hack a target server",
        usage: "hack <target_ip> [--method <method>] [--tools <tool1,tool2>]",
        examples: ["hack 192.168.1.1", "hack 10.0.0.5 --method exploit"],
      },
      {
        command: "crack",
        category: "hack",
        description: "[Hacking 30] Crack encryption on a message",
        usage: "crack <message_id>",
        examples: ["crack msg_12345"],
      },
      {
        command: "exploit",
        category: "hack",
        description: "[Hacking 40] Use an exploit against a server",
        usage: "exploit <target_ip> <exploit_name>",
        examples: ["exploit 192.168.1.1 buffer_overflow"],
      },
      {
        command: "backdoor",
        category: "hack",
        description: "[Hacking 50] Install a backdoor on compromised server",
        usage: "backdoor <target_ip>",
        examples: ["backdoor 192.168.1.1"],
      },
      {
        command: "rootkit",
        category: "hack",
        description: "[Hacking 60] Install rootkit for persistent access",
        usage: "rootkit <target_ip>",
        examples: ["rootkit 192.168.1.1"],
      },
      {
        command: "crack.submit",
        category: "hack",
        description:
          "[Crypto 5] Submit decrypted plaintext for cipher challenge",
        usage: "crack.submit <decrypted plaintext>",
        examples: ["crack.submit HELLO WORLD ACCESS GRANTED"],
      },
      {
        command: "firewall.knock",
        category: "hack",
        description:
          "[Network 5] Submit port knock sequence for firewall challenge",
        usage: "firewall.knock <port1> <port2> ...",
        examples: ["firewall.knock 22 1337 4444 9090"],
      },
      {
        command: "memory.extract",
        category: "hack",
        description: "[Forensics 5] Extract access token from memory dump",
        usage: "memory.extract <address> <hex_token>",
        examples: ["memory.extract 0x7F0120 BEEFCAFE"],
      },
      {
        command: "hack.hint",
        category: "hack",
        description:
          "Request a hint for current hack layer (costs +10% detection)",
        usage: "hack.hint",
      },
      {
        command: "hack.status",
        category: "hack",
        description: "Show current hack session status",
        usage: "hack.status",
      },
      {
        command: "hack.abort",
        category: "hack",
        description: "Abort current hack session (partial detection applied)",
        usage: "hack.abort",
      },
      {
        command: "backdoor.list",
        category: "hack",
        description:
          "[Hacking 15] List your installed backdoors on remote servers",
        usage: "backdoor.list",
      },
      {
        command: "backdoor.use",
        category: "hack",
        description:
          "[Stealth 20] Use an installed backdoor to access a server",
        usage: "backdoor.use <target_ip>",
        examples: ["backdoor.use 192.168.1.1"],
      },
      {
        command: "backdoor.remove",
        category: "hack",
        description:
          "[Stealth 15] Remove an installed backdoor (clean your traces)",
        usage: "backdoor.remove <target_ip>",
        examples: ["backdoor.remove 192.168.1.1"],
      },
      {
        command: "security.scan",
        category: "hack",
        description:
          "[Forensics 15] Scan one of your servers for installed backdoors",
        usage: "security.scan <server_ip>",
        examples: ["security.scan 10.0.0.1"],
      },
      {
        command: "trace.status",
        category: "hack",
        description: "View active traces targeting you or initiated by you",
        usage: "trace.status",
      },
      {
        command: "trace.evade",
        category: "hack",
        description:
          "[Stealth 25] Attempt to evade an active trace (costs stealth XP)",
        usage: "trace.evade <trace_id>",
        examples: ["trace.evade clxyz12345"],
      },
    ];
  }

  // ---------------------------------------------------------------------
  // Individual command handlers (simplified placeholders – real logic lives
  // in HackService and related services). They return a CommandResult that
  // mirrors the existing legacy implementation.
  // ---------------------------------------------------------------------

  private async handleHack(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return {
        success: false,
        output:
          "Usage: hack <target_ip> [--method <method>] [--tools <tool1,tool2,...>]",
        timestamp: new Date(),
      };
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) {
      return {
        success: false,
        output: "No active session",
        timestamp: new Date(),
      };
    }

    // Resolve target server and owner from IP address
    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return {
        success: false,
        output: targetResolution.error || "Failed to resolve target",
        timestamp: new Date(),
      };
    }

    const { serverId, ownerId } = targetResolution;

    // Parse hack method from command arguments
    const method = this.parseHackMethod(command.args);

    // Parse tools from command arguments
    const tools = this.parseTools(command.args);

    const hackService = context.services.hackService;

    // Initiate interactive hack session (minigame)
    const result = await hackService.initiateHackSession(
      context.userId,
      ownerId!,
      serverId!,
      method,
      tools,
    );

    if (!result.success) {
      return {
        success: false,
        output: result.error || "Failed to initiate hack session",
        timestamp: new Date(),
      };
    }

    // Register process for tracking
    const memoryService = context.services.memoryService;
    const processStateService = context.services.processStateService;

    if (memoryService && processStateService) {
      try {
        const pid = await memoryService.spawnProcess(
          session.socketId,
          "hack",
          `hack ${targetIp}`,
          context.userId,
        );

        processStateService.registerProcess(
          pid,
          session.socketId,
          context.userId,
          {
            command: "hack",
            args: command.args || [],
            targetInfo: targetIp,
            estimatedDuration:
              result.session!.expiresAt - result.session!.startedAt,
            cancellable: true,
            onCancel: async () => {
              await hackService.abortSession(context.userId);
            },
          },
        );

        const process = memoryService.getProcess(session.socketId, pid);
        if (process) {
          process.cpu = 35;
          process.memory = 8192 + Math.floor(Math.random() * 4096);
          process.isCommand = true;
          process.commandMetadata = {
            originalCommand: "hack",
            args: command.args || [],
            targetInfo: targetIp,
            progress: 0,
            estimatedDuration:
              result.session!.expiresAt - result.session!.startedAt,
          };
        }
      } catch (error) {
        // Non-critical: process tracking failure shouldn't block the hack
        logger.error({ err: error }, "Process tracking setup failed");
      }
    }

    return {
      success: true,
      output: result.output || ["Hack session initiated."],
      data: { sessionId: result.session!.id, targetIp },
      timestamp: new Date(),
    };
  }

  // ==================== MINIGAME COMMAND HANDLERS ====================

  private async handleCrackSubmit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const answer = command.args?.join(" ");
    if (!answer) {
      return {
        success: false,
        output: "Usage: crack.submit <decrypted plaintext>",
        timestamp: new Date(),
      };
    }

    const hackService = context.services.hackService;
    const session = hackService.getActiveSession(context.userId);
    if (!session || session.layers[session.currentLayer]?.type !== "cipher") {
      return {
        success: false,
        output:
          "No active cipher challenge. Use crack.submit during the encryption layer.",
        timestamp: new Date(),
      };
    }

    const result = await hackService.submitLayerAnswer(context.userId, answer);
    return {
      success: result.success,
      output: result.output || [
        result.feedback || result.error || "Unknown error",
      ],
      data: result.finalResult ? { ...result.finalResult } : undefined,
      timestamp: new Date(),
    };
  }

  private async handleFirewallKnock(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const ports = command.args?.join(" ");
    if (!ports) {
      return {
        success: false,
        output: "Usage: firewall.knock <port1> <port2> ...",
        timestamp: new Date(),
      };
    }

    const hackService = context.services.hackService;
    const session = hackService.getActiveSession(context.userId);
    if (
      !session ||
      session.layers[session.currentLayer]?.type !== "port_sequence"
    ) {
      return {
        success: false,
        output:
          "No active firewall challenge. Use firewall.knock during the port knock layer.",
        timestamp: new Date(),
      };
    }

    const result = await hackService.submitLayerAnswer(context.userId, ports);
    return {
      success: result.success,
      output: result.output || [
        result.feedback || result.error || "Unknown error",
      ],
      data: result.finalResult ? { ...result.finalResult } : undefined,
      timestamp: new Date(),
    };
  }

  private async handleMemoryExtract(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const answer = command.args?.join(" ");
    if (!answer) {
      return {
        success: false,
        output: "Usage: memory.extract <address> <hex_token>",
        timestamp: new Date(),
      };
    }

    const hackService = context.services.hackService;
    const session = hackService.getActiveSession(context.userId);
    if (
      !session ||
      session.layers[session.currentLayer]?.type !== "memory_trace"
    ) {
      return {
        success: false,
        output:
          "No active memory trace challenge. Use memory.extract during the IDS layer.",
        timestamp: new Date(),
      };
    }

    const result = await hackService.submitLayerAnswer(context.userId, answer);
    return {
      success: result.success,
      output: result.output || [
        result.feedback || result.error || "Unknown error",
      ],
      data: result.finalResult ? { ...result.finalResult } : undefined,
      timestamp: new Date(),
    };
  }

  private async handleHackHint(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const hackService = context.services.hackService;
    const result = hackService.getHint(context.userId);
    return {
      success: result.success,
      output: result.output || [result.error || "No hints available."],
      timestamp: new Date(),
    };
  }

  private async handleHackStatus(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const hackService = context.services.hackService;
    const result = hackService.getSessionStatus(context.userId);
    return {
      success: result.success,
      output: result.output || [result.error || "No active session."],
      timestamp: new Date(),
    };
  }

  private async handleHackAbort(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const hackService = context.services.hackService;
    const result = await hackService.abortSession(context.userId);
    return {
      success: result.success,
      output: result.output || ["Hack session aborted."],
      data: result.result,
      timestamp: new Date(),
    };
  }

  /**
   * Resolve target server and owner from IP address or server name
   */
  private async resolveHackTarget(
    targetIdentifier: string,
    context: CommandContext,
  ): Promise<{
    success: boolean;
    serverId?: string;
    ownerId?: string;
    error?: string;
  }> {
    try {
      const { db } = context;

      // Try to find server by IP address or name
      const server = await db.client.gameServer.findFirst({
        where: {
          OR: [{ ipAddress: targetIdentifier }, { name: targetIdentifier }],
        },
        select: {
          id: true,
          ownerId: true,
          name: true,
          ipAddress: true,
        },
      });

      if (!server) {
        return {
          success: false,
          error: `Target server not found: ${targetIdentifier}`,
        };
      }

      if (server.ownerId === context.userId) {
        return {
          success: false,
          error: "Cannot hack your own server",
        };
      }

      if (!server.ownerId) {
        return {
          success: false,
          error: "Target server has no owner",
        };
      }

      return {
        success: true,
        serverId: server.id,
        ownerId: server.ownerId,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to resolve target: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Parse hack method from command arguments
   */
  private parseHackMethod(args?: string[]): HackMethod {
    if (!args) return HackMethod.BRUTEFORCE;

    const methodIndex = args.findIndex(
      (arg) => arg === "--method" || arg === "-m",
    );
    if (methodIndex === -1 || methodIndex >= args.length - 1) {
      return HackMethod.BRUTEFORCE;
    }

    const methodValue = args[methodIndex + 1];
    if (!methodValue) return HackMethod.BRUTEFORCE;

    const methodArg = methodValue.toUpperCase();

    // Map string to HackMethod enum
    const methodMap: Record<string, HackMethod> = {
      BRUTEFORCE: HackMethod.BRUTEFORCE,
      BRUTE: HackMethod.BRUTEFORCE,
      EXPLOIT: HackMethod.EXPLOIT,
      SOCIAL: HackMethod.SOCIAL,
      BACKDOOR: HackMethod.BACKDOOR,
      SQL_INJECTION: HackMethod.SQL_INJECTION,
      SQL: HackMethod.SQL_INJECTION,
      PHISHING: HackMethod.PHISHING,
      ROOTKIT: HackMethod.ROOTKIT,
    };

    return methodMap[methodArg] || HackMethod.BRUTEFORCE;
  }

  /**
   * Parse tools from command arguments
   */
  private parseTools(args?: string[]): string[] {
    if (!args) return [];

    const toolsIndex = args.findIndex(
      (arg) => arg === "--tools" || arg === "-t",
    );
    if (toolsIndex === -1 || toolsIndex >= args.length - 1) {
      return [];
    }

    const toolsArg = args[toolsIndex + 1];
    if (!toolsArg) return [];

    return toolsArg
      .split(",")
      .map((tool) => tool.trim().toLowerCase())
      .filter(Boolean);
  }

  /**
   * Execute hack operation with process tracking
   * Generic wrapper for all hack-related commands
   */
  private async executeWithProcessTracking(
    command: Command,
    context: CommandContext,
    options: {
      commandName: string;
      targetInfo: string;
      estimatedDuration?: number;
      execute: () => Promise<any>;
      successMessage?: string;
      failureMessage?: string;
    },
  ): Promise<CommandResult> {
    const session = context.gameStateManager.getSession(context.userId);
    if (!session) {
      return {
        success: false,
        output: "No active session",
        timestamp: new Date(),
      };
    }

    const memoryService = context.services.memoryService;
    const processStateService = context.services.processStateService;

    if (!memoryService || !processStateService) {
      // Fallback to direct execution
      const result = await options.execute();
      return {
        success: result.success,
        output:
          result.message || result.success
            ? options.successMessage || "Operation successful"
            : options.failureMessage || "Operation failed",
        data: result,
        timestamp: new Date(),
      };
    }

    try {
      // Spawn process
      const pid = await memoryService.spawnProcess(
        session.socketId,
        options.commandName,
        `${options.commandName} ${options.targetInfo}`,
        context.userId,
      );

      const estimatedDuration =
        options.estimatedDuration || 5000 + Math.random() * 10000;
      let operationAborted = false;

      // Register process
      processStateService.registerProcess(
        pid,
        session.socketId,
        context.userId,
        {
          command: options.commandName,
          args: command.args || [],
          targetInfo: options.targetInfo,
          estimatedDuration,
          cancellable: true,
          onCancel: async () => {
            operationAborted = true;
            logger.info(
              { command: options.commandName, target: options.targetInfo },
              "Operation aborted by user",
            );
          },
          onProgress: (progress) => {
            const process = memoryService.getProcess(session.socketId, pid);
            if (process) {
              process.cpu = 30 + (progress / 100) * 40;
            }
          },
        },
      );

      // Set initial process stats
      const process = memoryService.getProcess(session.socketId, pid);
      if (process) {
        process.cpu = 35;
        process.memory = 8192 + Math.floor(Math.random() * 4096);
        process.isCommand = true;
        process.commandMetadata = {
          originalCommand: options.commandName,
          args: command.args || [],
          targetInfo: options.targetInfo,
          progress: 0,
          estimatedDuration,
        };
      }

      try {
        // Progress simulation
        const progressInterval = setInterval(() => {
          if (operationAborted) {
            clearInterval(progressInterval);
            return;
          }

          const proc = memoryService.getProcess(session.socketId, pid);
          if (proc && proc.commandMetadata) {
            const elapsed = Date.now() - proc.startTime;
            const progress = Math.min(95, (elapsed / estimatedDuration) * 100);
            proc.commandMetadata.progress = progress;
            processStateService.updateProgress(pid, progress);
          }
        }, 500);

        // Execute operation
        const result = await options.execute();

        clearInterval(progressInterval);

        // Check if aborted
        if (operationAborted) {
          processStateService.cancelProcess(pid);
          await memoryService.killProcess(session.socketId, pid, "TERM");

          return {
            success: false,
            output: [
              `${options.commandName} aborted.`,
              "⚠️  Warning: Partial traces may have been left on target system.",
            ],
            timestamp: new Date(),
          };
        }

        // Mark completed
        processStateService.completeProcess(pid, {
          success: result.success,
          output: result.message || "",
          timestamp: new Date(),
        });

        // Clean up after delay
        setTimeout(async () => {
          await memoryService.killProcess(session.socketId, pid, "TERM");
        }, 2000);

        return {
          success: result.success,
          output:
            result.message || result.success
              ? options.successMessage || "Operation successful"
              : options.failureMessage || "Operation failed",
          data: result,
          timestamp: new Date(),
        };
      } catch (error) {
        processStateService.failProcess(
          pid,
          error instanceof Error ? error.message : "Unknown error",
        );

        await memoryService.killProcess(session.socketId, pid, "KILL");

        throw error;
      }
    } catch (error) {
      return {
        success: false,
        output: `${options.commandName} failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date(),
      };
    }
  }

  private async handleCrack(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const messageId = command.args?.[0];
    if (!messageId) {
      return {
        success: false,
        output: "Usage: crack <message_id>",
        timestamp: new Date(),
      };
    }

    return await this.executeWithProcessTracking(command, context, {
      commandName: "crack",
      targetInfo: messageId,
      estimatedDuration: 8000 + Math.random() * 7000,
      execute: async () => {
        const messageService = context.services.messageService;
        return await messageService.crackEncryption(messageId, context.userId);
      },
      successMessage: "Encryption cracked successfully",
      failureMessage: "Failed to crack encryption",
    });
  }

  private async handleExploit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    const exploitName = command.args?.[1];

    if (!targetIp || !exploitName) {
      return {
        success: false,
        output: "Usage: exploit <target_ip> <exploit_name>",
        timestamp: new Date(),
      };
    }

    // Resolve target
    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return {
        success: false,
        output: targetResolution.error || "Failed to resolve target",
        timestamp: new Date(),
      };
    }

    const { serverId, ownerId } = targetResolution;

    return await this.executeWithProcessTracking(command, context, {
      commandName: "exploit",
      targetInfo: `${targetIp} (${exploitName})`,
      estimatedDuration: 10000 + Math.random() * 15000,
      execute: async () => {
        const hackService = context.services.hackService;
        return await hackService.processHackAttempt(
          context.userId,
          ownerId!,
          serverId!,
          HackMethod.EXPLOIT,
          [exploitName],
        );
      },
      successMessage: `Exploit ${exploitName} executed successfully`,
      failureMessage: `Exploit ${exploitName} failed`,
    });
  }

  private async handleBackdoor(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];

    if (!targetIp) {
      return {
        success: false,
        output: "Usage: backdoor <target_ip>",
        timestamp: new Date(),
      };
    }

    // Resolve target
    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return {
        success: false,
        output: targetResolution.error || "Failed to resolve target",
        timestamp: new Date(),
      };
    }

    const { serverId, ownerId } = targetResolution;

    return await this.executeWithProcessTracking(command, context, {
      commandName: "backdoor",
      targetInfo: targetIp,
      estimatedDuration: 15000 + Math.random() * 20000,
      execute: async () => {
        const hackService = context.services.hackService;
        return await hackService.processHackAttempt(
          context.userId,
          ownerId!,
          serverId!,
          HackMethod.BACKDOOR,
          ["backdoor_tool"],
        );
      },
      successMessage: "Backdoor installed successfully",
      failureMessage: "Failed to install backdoor",
    });
  }

  private async handleRootkit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];

    if (!targetIp) {
      return {
        success: false,
        output: "Usage: rootkit <target_ip>",
        timestamp: new Date(),
      };
    }

    // Resolve target
    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return {
        success: false,
        output: targetResolution.error || "Failed to resolve target",
        timestamp: new Date(),
      };
    }

    const { serverId, ownerId } = targetResolution;

    return await this.executeWithProcessTracking(command, context, {
      commandName: "rootkit",
      targetInfo: targetIp,
      estimatedDuration: 20000 + Math.random() * 25000,
      execute: async () => {
        const hackService = context.services.hackService;
        return await hackService.processHackAttempt(
          context.userId,
          ownerId!,
          serverId!,
          HackMethod.ROOTKIT,
          ["rootkit_installer"],
        );
      },
      successMessage: "Rootkit installed successfully",
      failureMessage: "Failed to install rootkit",
    });
  }

  // ==================== BACKDOOR COMMANDS ====================

  private async handleBackdoorList(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return {
        success: false,
        output: "Backdoor service unavailable",
        timestamp: new Date(),
      };
    }

    const backdoors = await backdoorService.getBackdoors(context.userId);

    if (!backdoors || backdoors.length === 0) {
      const W = 52;
      const lines = [
        boxTop(W),
        boxCenter("INSTALLED BACKDOORS", W),
        boxDivider(W),
        boxRow("  No active backdoors found.", W),
        boxRow("  Use  hack <ip> --method backdoor  to install one.", W),
        boxBottom(W),
      ];
      return { success: true, output: lines, timestamp: new Date() };
    }

    const W = 62;
    const lines: string[] = [
      boxTop(W),
      boxCenter("INSTALLED BACKDOORS", W),
      boxDivider(W),
    ];

    for (const bd of backdoors) {
      const serverName = bd.server?.name ?? "Unknown";
      const serverIp = bd.server?.ipAddress ?? "?.?.?.?";
      const age = formatDuration(Date.now() - new Date(bd.createdAt).getTime());
      const risk = bd.detectionRisk;
      const riskLabel = risk < 30 ? "LOW" : risk < 60 ? "MED" : "HIGH";
      const expiry = bd.expiresAt
        ? formatDuration(new Date(bd.expiresAt).getTime() - Date.now())
        : "PERMANENT";

      lines.push(
        boxRow(
          `  ${pad(serverName, 22)} ${pad(serverIp, 16)} Lv${bd.accessLevel}`,
          W,
        ),
        boxRow(
          `    Type: ${pad(bd.type, 12)} Risk: ${pad(riskLabel + " (" + risk + "%)", 12)} TTL: ${expiry}  Age: ${age}`,
          W,
        ),
        boxDivider(W),
      );
    }

    // Replace last divider with bottom
    lines[lines.length - 1] = boxBottom(W);

    return { success: true, output: lines, timestamp: new Date() };
  }

  private async handleBackdoorUse(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return {
        success: false,
        output: "Usage: backdoor.use <target_ip>",
        timestamp: new Date(),
      };
    }

    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return {
        success: false,
        output: "Backdoor service unavailable",
        timestamp: new Date(),
      };
    }

    // Resolve IP to server ID
    const server = await context.db.client.gameServer.findUnique({
      where: { ipAddress: targetIp },
      select: { id: true, name: true },
    });
    if (!server) {
      return {
        success: false,
        output: `No server found at ${targetIp}`,
        timestamp: new Date(),
      };
    }

    const result = await backdoorService.useBackdoor(context.userId, server.id);

    if (!result.success) {
      return {
        success: false,
        output: result.error || "Failed to use backdoor",
        timestamp: new Date(),
      };
    }

    const W = 52;
    const lines: string[] = [
      boxTop(W),
      boxCenter("BACKDOOR ACCESS", W),
      boxDivider(W),
    ];

    if (result.discovered) {
      lines.push(
        boxRow("  ⚠ BACKDOOR DISCOVERED AND DEACTIVATED!", W),
        boxRow("  The server owner has been alerted.", W),
        boxRow("  Your access has been revoked.", W),
      );
    } else {
      lines.push(
        boxRow(`  Connected to ${server.name} via backdoor`, W),
        boxRow(`  Access Level: ${result.accessLevel}/10`, W),
        boxRow(`  Status: Active — detection risk increased`, W),
      );
    }

    lines.push(boxBottom(W));
    return {
      success: !result.discovered,
      output: lines,
      timestamp: new Date(),
    };
  }

  private async handleBackdoorRemove(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return {
        success: false,
        output: "Usage: backdoor.remove <target_ip>",
        timestamp: new Date(),
      };
    }

    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return {
        success: false,
        output: "Backdoor service unavailable",
        timestamp: new Date(),
      };
    }

    const server = await context.db.client.gameServer.findUnique({
      where: { ipAddress: targetIp },
      select: { id: true, name: true },
    });
    if (!server) {
      return {
        success: false,
        output: `No server found at ${targetIp}`,
        timestamp: new Date(),
      };
    }

    const result = await backdoorService.removeBackdoor(
      context.userId,
      server.id,
    );

    if (!result.success) {
      return {
        success: false,
        output: result.error || "No backdoor found on that server",
        timestamp: new Date(),
      };
    }

    const W = 52;
    const lines = [
      boxTop(W),
      boxCenter("BACKDOOR REMOVED", W),
      boxDivider(W),
      boxRow(`  Server: ${server.name} (${targetIp})`, W),
      boxRow(`  Backdoor deactivated and traces cleaned.`, W),
      boxBottom(W),
    ];
    return { success: true, output: lines, timestamp: new Date() };
  }

  // ==================== SECURITY SCAN COMMAND ====================

  private async handleSecurityScan(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const serverIp = command.args?.[0];
    if (!serverIp) {
      return {
        success: false,
        output: "Usage: security.scan <your_server_ip>",
        timestamp: new Date(),
      };
    }

    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return {
        success: false,
        output: "Backdoor service unavailable",
        timestamp: new Date(),
      };
    }

    // Verify the player owns the server
    const server = await context.db.client.gameServer.findUnique({
      where: { ipAddress: serverIp },
      select: { id: true, name: true, ownerId: true },
    });
    if (!server) {
      return {
        success: false,
        output: `No server found at ${serverIp}`,
        timestamp: new Date(),
      };
    }
    if (server.ownerId !== context.userId) {
      return {
        success: false,
        output: "You can only scan servers you own",
        timestamp: new Date(),
      };
    }

    // Get player forensics skill
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { forensics: true },
    });
    const forensics = progress?.forensics ?? 5;

    const discovered = await backdoorService.scanForBackdoors(
      server.id,
      forensics,
    );

    const W = 58;
    const lines: string[] = [
      boxTop(W),
      boxCenter("SECURITY SCAN RESULTS", W),
      boxDivider(W),
      boxRow(`  Server: ${server.name} (${serverIp})`, W),
      boxRow(`  Forensics Level: ${forensics}/100`, W),
      boxDivider(W),
    ];

    if (!discovered || discovered.length === 0) {
      lines.push(
        boxRow("  ✓ No backdoors detected.", W),
        boxRow("  (Higher forensics skill reveals harder-to-find threats)", W),
      );
    } else {
      lines.push(
        boxRow(`  ⚠ ${discovered.length} BACKDOOR(S) DETECTED!`, W),
        boxDivider(W),
      );

      for (const bd of discovered) {
        const installerName = bd.installer?.username ?? "Unknown";
        const bdType = bd.type ?? "standard";
        const risk = bd.detectionRisk ?? 0;
        lines.push(
          boxRow(`  ID: ${bd.id.slice(0, 12)}...`, W),
          boxRow(
            `    Installer: ${installerName}  Type: ${bdType}  Risk: ${risk}%`,
            W,
          ),
          boxRow(
            `    Access Lv: ${bd.accessLevel}  — Use  security.remove ${bd.id}  to purge`,
            W,
          ),
          boxDivider(W),
        );
      }
      // Replace last divider
      lines[lines.length - 1] = boxRow("", W);

      // Auto-remove discovered backdoors
      for (const bd of discovered) {
        await backdoorService.removeDetectedBackdoor(bd.id);
      }
      lines.push(boxRow(`  ✓ All detected backdoors have been purged.`, W));
    }

    lines.push(boxBottom(W));
    return { success: true, output: lines, timestamp: new Date() };
  }

  // ==================== TRACE COMMANDS ====================

  private async handleTraceStatus(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const traceService = context.services.traceService;
    if (!traceService) {
      return {
        success: false,
        output: "Trace service unavailable",
        timestamp: new Date(),
      };
    }

    const tracesAgainst = await traceService.getTracesAgainst(context.userId);
    const tracesInitiated = await traceService.getTracesInitiated(
      context.userId,
    );

    const W = 60;
    const lines: string[] = [
      boxTop(W),
      boxCenter("TRACE STATUS", W),
      boxDivider(W),
    ];

    // Traces targeting the player (incoming threats)
    lines.push(boxCenter("— INCOMING TRACES (targeting you) —", W));
    if (!tracesAgainst || tracesAgainst.length === 0) {
      lines.push(boxRow("  ✓ No active traces against you.", W));
    } else {
      for (const tr of tracesAgainst) {
        const serverName = tr.server?.name ?? "Unknown";
        const pct = tr.progress ?? 0;
        const bar = progressBar(pct / 100, 12);
        const statusLabel =
          tr.status === "active" ? "ACTIVE" : tr.status.toUpperCase();
        lines.push(
          boxRow(
            `  ${pad(tr.id.slice(0, 12) + "...", 16)} ${pad(serverName, 18)} ${statusLabel}`,
            W,
          ),
          boxRow(
            `    Progress: ${bar} ${padRight(String(pct) + "%", 4)}  Evidence: ${tr.evidenceLevel}%`,
            W,
          ),
        );
      }
      lines.push(
        boxRow("", W),
        boxRow("  Use  trace.evade <trace_id>  to attempt evasion", W),
      );
    }

    lines.push(boxDivider(W));

    // Traces the player initiated (defense)
    lines.push(boxCenter("— OUTGOING TRACES (you initiated) —", W));
    if (!tracesInitiated || tracesInitiated.length === 0) {
      lines.push(boxRow("  No traces initiated by you.", W));
    } else {
      for (const tr of tracesInitiated) {
        const targetName = tr.target?.username ?? "Unknown";
        const pct = tr.progress ?? 0;
        const bar = progressBar(pct / 100, 12);
        const statusLabel =
          tr.status === "active" ? "TRACKING" : tr.status.toUpperCase();
        lines.push(
          boxRow(`  Target: ${pad(targetName, 16)} ${statusLabel}`, W),
          boxRow(
            `    Progress: ${bar} ${padRight(String(pct) + "%", 4)}  Evidence: ${tr.evidenceLevel}%`,
            W,
          ),
        );
      }
    }

    lines.push(boxBottom(W));
    return { success: true, output: lines, timestamp: new Date() };
  }

  private async handleTraceEvade(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const traceId = command.args?.[0];
    if (!traceId) {
      return {
        success: false,
        output: "Usage: trace.evade <trace_id>",
        timestamp: new Date(),
      };
    }

    const traceService = context.services.traceService;
    if (!traceService) {
      return {
        success: false,
        output: "Trace service unavailable",
        timestamp: new Date(),
      };
    }

    const result = await traceService.evadeTrace(context.userId, traceId);

    const W = 52;
    const lines: string[] = [
      boxTop(W),
      boxCenter("TRACE EVASION ATTEMPT", W),
      boxDivider(W),
    ];

    if (result.evaded) {
      lines.push(
        boxRow("  ✓ EVASION SUCCESSFUL", W),
        boxRow("", W),
        boxRow("  " + (result.message ?? "Trace evaded."), W),
        boxRow("  (-2 Stealth XP consumed)", W),
      );
    } else {
      lines.push(
        boxRow("  ✗ EVASION FAILED", W),
        boxRow("", W),
        boxRow("  " + (result.message ?? "The trace is still active."), W),
        boxRow("  (-2 Stealth XP consumed)", W),
      );
    }

    lines.push(boxBottom(W));
    return { success: result.success, output: lines, timestamp: new Date() };
  }
}
