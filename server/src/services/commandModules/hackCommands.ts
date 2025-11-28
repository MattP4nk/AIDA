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
        output: "Usage: hack <target_ip> [options]",
        timestamp: new Date(),
      };
    }
    // Delegate to HackService – same as legacy implementation
    const { hackService } = await import("../hackService");
    const result = await hackService.processHackAttempt(
      context.userId,
      "unknown", // targetId placeholder – resolved inside service
      targetIp,
      HackMethod.BRUTEFORCE, // method identifier
      [], // tools – not parsed here
    );
    return {
      success: result.success,
      output: result.message || (result.success ? "Hack successful" : "Hack failed"),
      data: { ...result, targetIp },
      timestamp: new Date(),
    };
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
    const { messageService } = await import("../messageService");
    const result = await messageService.crackEncryption(messageId, context.userId);
    return {
      success: result.success,
      output: result.message,
      data: result,
      timestamp: new Date(),
    };
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

    const { hackService } = await import("../hackService");
    const result = await hackService.processHackAttempt(
      context.userId,
      "unknown",
      targetIp,
      HackMethod.EXPLOIT,
      [exploitName], // Pass exploit name as a tool
    );

    return {
      success: result.success,
      output: result.message,
      data: { ...result, targetIp, exploitName },
      timestamp: new Date(),
    };
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

    const { hackService } = await import("../hackService");
    const result = await hackService.processHackAttempt(
      context.userId,
      "unknown",
      targetIp,
      HackMethod.BACKDOOR,
      ["backdoor_tool"],
    );

    return {
      success: result.success,
      output: result.message,
      data: { ...result, targetIp },
      timestamp: new Date(),
    };
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

    const { hackService } = await import("../hackService");
    const result = await hackService.processHackAttempt(
      context.userId,
      "unknown",
      targetIp,
      HackMethod.ROOTKIT,
      ["rootkit_installer"],
    );

    return {
      success: result.success,
      output: result.message,
      data: { ...result, targetIp },
      timestamp: new Date(),
    };
  }
}
