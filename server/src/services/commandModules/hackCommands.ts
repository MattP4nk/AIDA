import { Command, CommandResult, HackMethod } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

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
    // "scan" is handled by NetworkCommandsModule, kept for legacy compatibility
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
        description: "Attempt to hack a target server",
        usage: "hack <target_ip> [options]",
        examples: ["hack 192.168.1.1", "hack corporate_server"],
      },
      {
        command: "crack",
        category: "hack",
        description: "Crack encryption on a message",
        usage: "crack <message_id>",
        examples: ["crack msg_12345"],
      },
      {
        command: "exploit",
        category: "hack",
        description: "Use an exploit against a server (placeholder)",
        usage: "exploit <target> <exploit_name>",
        examples: ["exploit 192.168.1.1 buffer_overflow"],
      },
      {
        command: "backdoor",
        category: "hack",
        description: "Install a backdoor on compromised server (placeholder)",
        usage: "backdoor <server_id>",
        examples: ["backdoor 192.168.1.1"],
      },
      {
        command: "rootkit",
        category: "hack",
        description: "Install rootkit for persistent access (placeholder)",
        usage: "rootkit <server_id>",
        examples: ["rootkit 192.168.1.1"],
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

    const memoryService = context.services.memoryService;
    const processStateService = context.services.processStateService;

    if (!memoryService || !processStateService) {
      // Fallback to non-tracked execution if services not available
      return await this.executeHackWithoutTracking(command, context, targetIp);
    }

    try {
      // Spawn process for this hack attempt
      const pid = await memoryService.spawnProcess(
        session.id,
        "hack",
        `hack ${targetIp}`,
        context.userId,
      );

      // Estimate duration based on target (simplified for now)
      const estimatedDuration = 5000 + Math.random() * 10000; // 5-15 seconds

      let hackAborted = false;

      // Register with process state service
      processStateService.registerProcess(pid, session.id, context.userId, {
        command: "hack",
        args: command.args || [],
        targetInfo: targetIp,
        estimatedDuration,
        cancellable: true,
        onCancel: async () => {
          hackAborted = true;
          // Mark as aborted - hackService will need to handle this
          console.log(`Hack attempt on ${targetIp} aborted by user`);
        },
        onProgress: (progress) => {
          // Update process CPU usage based on progress
          const process = memoryService.getProcess(session.id, pid);
          if (process) {
            // Simulate varying CPU usage during hack
            process.cpu = 30 + (progress / 100) * 40; // 30-70% CPU
          }
        },
      });

      // Update initial CPU/memory for hack process
      const process = memoryService.getProcess(session.id, pid);
      if (process) {
        process.cpu = 35;
        process.memory = 8192 + Math.floor(Math.random() * 4096); // 8-12 MB
        process.isCommand = true;
        process.commandMetadata = {
          originalCommand: "hack",
          args: command.args || [],
          targetInfo: targetIp,
          progress: 0,
          estimatedDuration,
        };
      }

      try {
        // Simulate progress updates during hack
        const progressInterval = setInterval(() => {
          if (hackAborted) {
            clearInterval(progressInterval);
            return;
          }

          const proc = memoryService.getProcess(session.id, pid);
          if (proc && proc.commandMetadata) {
            const elapsed = Date.now() - proc.startTime;
            const progress = Math.min(95, (elapsed / estimatedDuration) * 100);
            proc.commandMetadata.progress = progress;
            processStateService.updateProgress(pid, progress);
          }
        }, 500);

        // Execute the actual hack
        const { hackService } = await import("../hackService");
        const result = await hackService.processHackAttempt(
          context.userId,
          ownerId!,
          serverId!,
          method,
          tools,
        );

        clearInterval(progressInterval);

        // Check if aborted
        if (hackAborted) {
          processStateService.cancelProcess(pid);
          await memoryService.killProcess(session.id, pid, "TERM");

          return {
            success: false,
            output: [
              "Hack attempt aborted.",
              "⚠️  Warning: Partial traces may have been left on target system.",
            ],
            timestamp: new Date(),
          };
        }

        // Mark as completed
        processStateService.completeProcess(pid, {
          success: result.success,
          output: result.message || "",
          timestamp: new Date(),
        });

        // Clean up process after a delay
        setTimeout(async () => {
          await memoryService.killProcess(session.id, pid, "TERM");
        }, 2000);

        return {
          success: result.success,
          output:
            result.message ||
            (result.success ? "Hack successful" : "Hack failed"),
          data: { ...result, targetIp },
          timestamp: new Date(),
        };
      } catch (error) {
        // Mark as failed
        processStateService.failProcess(
          pid,
          error instanceof Error ? error.message : "Unknown error",
        );

        await memoryService.killProcess(session.id, pid, "KILL");

        throw error;
      }
    } catch (error) {
      return {
        success: false,
        output: `Hack failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Fallback execution without process tracking
   */
  private async executeHackWithoutTracking(
    command: Command,
    context: CommandContext,
    targetIp: string,
  ): Promise<CommandResult> {
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

    // Parse hack method and tools
    const method = this.parseHackMethod(command.args);
    const tools = this.parseTools(command.args);

    const { hackService } = await import("../hackService");
    const result = await hackService.processHackAttempt(
      context.userId,
      ownerId!,
      serverId!,
      method,
      tools,
    );

    return {
      success: result.success,
      output:
        result.message || (result.success ? "Hack successful" : "Hack failed"),
      data: { ...result, targetIp },
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
      const { db } = await import("../../database/client");

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
        session.id,
        options.commandName,
        `${options.commandName} ${options.targetInfo}`,
        context.userId,
      );

      const estimatedDuration =
        options.estimatedDuration || 5000 + Math.random() * 10000;
      let operationAborted = false;

      // Register process
      processStateService.registerProcess(pid, session.id, context.userId, {
        command: options.commandName,
        args: command.args || [],
        targetInfo: options.targetInfo,
        estimatedDuration,
        cancellable: true,
        onCancel: async () => {
          operationAborted = true;
          console.log(
            `${options.commandName} on ${options.targetInfo} aborted by user`,
          );
        },
        onProgress: (progress) => {
          const process = memoryService.getProcess(session.id, pid);
          if (process) {
            process.cpu = 30 + (progress / 100) * 40;
          }
        },
      });

      // Set initial process stats
      const process = memoryService.getProcess(session.id, pid);
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

          const proc = memoryService.getProcess(session.id, pid);
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
          await memoryService.killProcess(session.id, pid, "TERM");

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
          await memoryService.killProcess(session.id, pid, "TERM");
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

        await memoryService.killProcess(session.id, pid, "KILL");

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
        const { messageService } = await import("../messageService");
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
        const { hackService } = await import("../hackService");
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
        const { hackService } = await import("../hackService");
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
        const { hackService } = await import("../hackService");
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
}
