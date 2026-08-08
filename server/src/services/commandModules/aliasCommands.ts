import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { successResult, errorResult } from "./helpers";

export class AliasCommandsModule implements CommandModule {
  public category = "alias";
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
          return errorResult(`Unknown alias command: ${subcommand}\nType 'alias help' for usage.`);
      }
    } catch (error) {
      return errorResult(`Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  public getCommandInfo() {
    return [
      {
        command: "alias",
        category: "alias",
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

    return successResult(output);
  }

  private async handleCreate(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const aliasName = args.join(" ").trim();
    if (!aliasName || aliasName.length < 2 || aliasName.length > 30) {
      return errorResult("Usage: alias create <name> (2-30 characters)");
    }

    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const result = await aliasService.createAlias(context.userId, aliasName);

    return result.success
      ? successResult(result.message)
      : errorResult(result.message);
  }

  private async handleDestroy(context: CommandContext): Promise<CommandResult> {
    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const result = await aliasService.destroyAlias(context.userId);

    return result.success
      ? successResult(result.message)
      : errorResult(result.message);
  }

  private async handleInfo(context: CommandContext): Promise<CommandResult> {
    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const alias = await aliasService.getAlias(context.userId);

    if (!alias) {
      return successResult("You don't have an active alias. Use 'alias create <name>' to create one.");
    }

    let output = "🎭 YOUR ALIAS\n\n";
    output += `  Name: ${alias.aliasName}\n`;
    output += `  Status: ${alias.isActive ? "Active" : "Inactive"}\n`;
    if (alias.apparentFactionId) {
      output += `  Apparent Faction: ${alias.apparentFactionId}\n`;
    }

    return successResult(output);
  }

  private async handleReveal(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const targetName = args.join(" ").trim();
    if (!targetName) {
      return errorResult("Usage: alias reveal <player_name>");
    }

    // Find target user by username
    const targetUser = await context.db.client.user.findFirst({
      where: { username: { equals: targetName, mode: "insensitive" } },
    });

    if (!targetUser) {
      return errorResult(`Player "${targetName}" not found.`);
    }

    const { getService } = await import("../../di/container");
    const aliasService =
      getService<import("../aliasService").default>("AliasService");
    const result = await aliasService.attemptReveal(
      context.userId,
      targetUser.id,
    );

    return result.success
      ? successResult(result.message)
      : errorResult(result.message);
  }
}
