import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

export class AliasCommandsModule implements CommandModule {
  public commands: Set<string> = new Set(["alias"]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      return this.handleHelp();
    }

    try {
      switch (subcommand) {
        case "create":
          return await this.handleCreate(context, args.slice(1));
        case "destroy":
          return await this.handleDestroy(context);
        case "info":
          return await this.handleInfo(context);
        case "reveal":
          return await this.handleReveal(context, args.slice(1));
        case "help":
          return this.handleHelp();
        default:
          return {
            success: false,
            output: `Unknown alias command: ${subcommand}\nType 'alias help' for usage.`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo() {
    return [
      {
        command: "alias",
        category: "gameplay",
        description: "Manage your identity alias",
        usage: "alias <subcommand> [args]",
        examples: [
          "alias create <name>",
          "alias destroy",
          "alias info",
          "alias reveal <player>",
        ],
      },
    ];
  }

  private handleHelp(): CommandResult {
    let output = "ALIAS IDENTITY SYSTEM\n\n";
    output += "Create a false identity to hide your true name.\n";
    output += "Requires visiting the Forger NPC.\n\n";
    output += "Commands:\n";
    output +=
      "  alias create <name>     - [Social 15] Create an alias (10,000 credits)\n";
    output += "  alias destroy           - Destroy your alias\n";
    output += "  alias info              - View your alias information\n";
    output +=
      "  alias reveal <player>   - [Social 20] Attempt to reveal a player's true identity\n";

    return { success: true, output, timestamp: new Date() };
  }

  private async handleCreate(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const aliasName = args.join(" ").trim();
    if (!aliasName || aliasName.length < 2 || aliasName.length > 30) {
      return {
        success: false,
        output: "Usage: alias create <name> (2-30 characters)",
        timestamp: new Date(),
      };
    }

    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const result = await aliasService.createAlias(context.userId, aliasName);

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleDestroy(context: CommandContext): Promise<CommandResult> {
    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const result = await aliasService.destroyAlias(context.userId);

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleInfo(context: CommandContext): Promise<CommandResult> {
    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const alias = await aliasService.getAlias(context.userId);

    if (!alias) {
      return {
        success: true,
        output:
          "You don't have an active alias. Use 'alias create <name>' to create one.",
        timestamp: new Date(),
      };
    }

    let output = "🎭 YOUR ALIAS\n\n";
    output += `  Name: ${alias.aliasName}\n`;
    output += `  Status: ${alias.isActive ? "Active" : "Inactive"}\n`;
    if (alias.apparentFactionId) {
      output += `  Apparent Faction: ${alias.apparentFactionId}\n`;
    }

    return { success: true, output, timestamp: new Date() };
  }

  private async handleReveal(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const targetName = args.join(" ").trim();
    if (!targetName) {
      return {
        success: false,
        output: "Usage: alias reveal <player_name>",
        timestamp: new Date(),
      };
    }

    // Find target user by username
    const targetUser = await context.db.client.user.findFirst({
      where: { username: { equals: targetName, mode: "insensitive" } },
    });

    if (!targetUser) {
      return {
        success: false,
        output: `Player "${targetName}" not found.`,
        timestamp: new Date(),
      };
    }

    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const result = await aliasService.attemptReveal(
      context.userId,
      targetUser.id,
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }
}
