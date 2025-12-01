import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { ServiceRegistry } from "../../di/serviceRegistry";

export class FactionCommandsModule implements CommandModule {
  public commands: Set<string> = new Set(["faction"]);

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
        case "list":
          return await this.handleList(context);
        case "join":
          return await this.handleJoin(context, args.slice(1));
        case "leave":
          return await this.handleLeave(context);
        case "status":
          return await this.handleStatus(context);
        case "missions":
          return await this.handleMissions(context);
        case "help":
          return this.handleHelp();
        default:
          return {
            success: false,
            output: `Unknown faction command: ${subcommand}\nType 'faction help' for usage.`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: `Error executing faction command: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo() {
    return [
      {
        command: "faction",
        category: "gameplay",
        description: "Manage faction membership and view status",
        usage: "faction <subcommand> [args]",
        examples: [
          "faction list",
          "faction join <faction_name>",
          "faction status",
          "faction missions",
        ],
      },
    ];
  }

  private handleHelp(): CommandResult {
    let output = "🏴 Faction Management System\n\n";
    output += "Available Commands:\n";
    output += "  faction list              - List all available factions\n";
    output += "  faction join <name>       - Join a faction\n";
    output += "  faction leave             - Leave your current faction\n";
    output += "  faction status            - View your faction standing\n";
    output += "  faction missions          - View available faction missions\n";
    
    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleList(_context: CommandContext): Promise<CommandResult> {
    const factions = await ServiceRegistry.factionService.getAllFactions();
    
    if (factions.length === 0) {
      return {
        success: true,
        output: "No factions currently active.",
        timestamp: new Date(),
      };
    }

    let output = "🌐 Active Factions\n\n";
    output += "NAME             MEMBERS   IDEOLOGY\n";
    output += "────────────────────────────────────────\n";

    for (const faction of factions) {
      output += `${faction.name.padEnd(16)} `;
      output += `${faction.activeMembers.toString().padEnd(9)} `;
      output += `${(faction.ideology || "Unknown").substring(0, 15)}\n`;
    }

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleJoin(context: CommandContext, args: string[]): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: faction join <faction_name>",
        timestamp: new Date(),
      };
    }

    const factionName = args.join(" ");
    const faction = await ServiceRegistry.factionService.getFactionByName(factionName);

    if (!faction) {
      return {
        success: false,
        output: `Faction not found: ${factionName}`,
        timestamp: new Date(),
      };
    }

    const result = await ServiceRegistry.factionService.joinFaction(context.userId, faction.id);

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleLeave(context: CommandContext): Promise<CommandResult> {
    const result = await ServiceRegistry.factionService.leaveFaction(context.userId);

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleStatus(context: CommandContext): Promise<CommandResult> {
    const membership = await ServiceRegistry.factionService.getUserFaction(context.userId);

    if (!membership) {
      return {
        success: true,
        output: "You are not a member of any faction.\nUse 'faction list' to see available factions.",
        timestamp: new Date(),
      };
    }

    const faction = membership.faction;
    const reputation = await ServiceRegistry.factionService.getFactionReputation(context.userId, faction.id);

    let output = `🏴 Faction Status: ${faction.name}\n\n`;
    output += `Rank:        ${membership.rank.toUpperCase()}\n`;
    output += `Reputation:  ${reputation}\n`;
    output += `Joined:      ${membership.joinedAt.toLocaleDateString()}\n`;
    output += `Description: ${faction.description}\n`;
    
    if (faction.objective) {
      output += `\nCurrent Objective:\n${faction.objective}\n`;
    }

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleMissions(context: CommandContext): Promise<CommandResult> {
    const membership = await ServiceRegistry.factionService.getUserFaction(context.userId);

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to view faction missions.",
        timestamp: new Date(),
      };
    }

    const missions = await ServiceRegistry.factionService.getFactionMissions(membership.factionId);

    if (missions.length === 0) {
      return {
        success: true,
        output: `No active missions for ${membership.faction.name} at this time.`,
        timestamp: new Date(),
      };
    }

    let output = `📜 ${membership.faction.name} Missions\n\n`;
    output += "ID      TITLE                     DIFFICULTY   REWARD\n";
    output += "─────────────────────────────────────────────────────\n";

    for (const mission of missions) {
      // Simple ID for display (last 4 chars)
      const displayId = mission.id.substring(mission.id.length - 4);
      const reward = (mission.reward as any)?.credits || 0;
      
      output += `${displayId.padEnd(7)} `;
      output += `${mission.title.substring(0, 25).padEnd(26)} `;
      output += `${mission.difficulty.toString().padEnd(12)} `;
      output += `${reward} credits\n`;
    }

    output += "\nUse 'mission accept <id>' to start a mission.";

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }
}
