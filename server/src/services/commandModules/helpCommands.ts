import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import {
  helpPanel,
  multiPanel,
  numberedLog,
  render,
  HelpEntry,
} from "./asciiBox";
import {
  SKILL_REQUIREMENTS,
  resolveSkillKey,
  meetsSkillRequirement,
} from "./skillRequirements";

export class HelpCommandsModule implements CommandModule {
  public category = "help";
  public commands: Set<string> = new Set(["help", "man", "history", "stats"]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "help":
          return await this.handleHelp(command, context);
        case "man":
          return await this.handleMan(command, context);
        case "history":
          return await this.handleHistory(command, context);
        case "stats":
          return await this.handleStats(command, context);
        default:
          return {
            success: false,
            output: `Help command not implemented: ${command.command}`,
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

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "help",
        category: "help",
        description: "Show available commands",
        usage: "help [category]",
        examples: ["help", "help network", "help system"],
      },
      {
        command: "man",
        category: "help",
        description: "Show detailed command manual",
        usage: "man <command>",
        examples: ["man scan", "man hack", "man ls"],
      },
      {
        command: "history",
        category: "help",
        description: "Show command history",
        usage: "history [limit]",
        examples: ["history", "history 20", "history 100"],
      },
      {
        command: "stats",
        category: "help",
        description: "Show command usage statistics",
        usage: "stats",
        examples: ["stats"],
      },
    ];
  }

  private async handleHelp(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const category = command.args?.[0]?.toLowerCase();

    // Fetch player progress for skill-based filtering
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });
    const skills: Record<string, unknown> = progress
      ? (progress as unknown as Record<string, unknown>)
      : {};

    const commands = await this.getAvailableCommands(
      context,
      undefined,
      skills,
    );

    // If no category specified, show only categories
    if (!category) {
      return this.showCategories(commands);
    }

    // Show commands for the specific category
    return this.showCategoryCommands(commands, category);
  }

  /**
   * Show available command categories (no commands listed)
   */
  private showCategories(
    commands: Array<{
      command: string;
      category: string;
      description: string;
      locked?: boolean;
    }>,
  ): CommandResult {
    const categories = [
      { name: "system", desc: "File operations and navigation" },
      { name: "file", desc: "Advanced file operations" },
      { name: "process", desc: "Process and resource management" },
      { name: "math", desc: "Mathematics and calculations" },
      { name: "network", desc: "Network operations and scanning" },
      { name: "social", desc: "Communication and social features" },
      { name: "game", desc: "Game commands and player info" },
      { name: "hack", desc: "Hacking and exploitation tools" },
      { name: "help", desc: "Help and documentation" },
    ];

    // Count unlocked commands per category
    const categoryCounts: Record<string, number> = {};
    const lockedCounts: Record<string, number> = {};
    commands.forEach((cmd) => {
      if (cmd.locked) {
        lockedCounts[cmd.category] = (lockedCounts[cmd.category] || 0) + 1;
      } else {
        categoryCounts[cmd.category] = (categoryCounts[cmd.category] || 0) + 1;
      }
    });

    const entries: HelpEntry[] = [];
    categories.forEach(({ name, desc }) => {
      const unlocked = categoryCounts[name] || 0;
      const locked = lockedCounts[name] || 0;
      const total = unlocked + locked;
      if (total > 0) {
        const suffix =
          locked > 0 ? ` (${unlocked}/${total})` : ` (${unlocked})`;
        entries.push({
          command: `help ${name}`,
          description: `${desc}${suffix}`,
        });
      }
    });

    const lines = helpPanel("COMMAND CATEGORIES", entries, 50);
    lines.push("");
    lines.push(" Type 'help <category>' to see commands.");
    lines.push(" Raise skills to unlock hidden commands.");

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  /**
   * Show commands for a specific category
   */
  private showCategoryCommands(
    commands: Array<{
      command: string;
      category: string;
      description: string;
      usage: string;
      examples: string[];
      locked?: boolean;
    }>,
    category: string,
  ): CommandResult {
    const categoryCommands = commands.filter(
      (cmd) => cmd.category === category,
    );

    if (categoryCommands.length === 0) {
      const validCategories = [
        "system",
        "file",
        "process",
        "math",
        "network",
        "social",
        "game",
        "hack",
        "help",
      ];
      return {
        success: false,
        output:
          `Unknown category: ${category}\n\n` +
          `Available categories: ${validCategories.join(", ")}\n\n` +
          "Type 'help' to see all categories.",
        timestamp: new Date(),
      };
    }

    const unlocked = categoryCommands.filter((cmd) => !cmd.locked);
    const lockedCount = categoryCommands.length - unlocked.length;

    const entries: HelpEntry[] = unlocked.map((cmd) => ({
      command: cmd.command,
      description: cmd.description,
    }));

    const lines = helpPanel(`${category.toUpperCase()} COMMANDS`, entries, 50);
    if (lockedCount > 0) {
      lines.push("");
      lines.push(
        ` + ${lockedCount} locked command${lockedCount > 1 ? "s" : ""} (raise skills to unlock)`,
      );
    }
    lines.push("");
    lines.push(" Type 'help' to see all categories.");
    lines.push(" Type 'man <command>' for detailed info.");

    return {
      success: true,
      output: render(lines),
      data: { commands: unlocked },
      timestamp: new Date(),
    };
  }

  private async handleMan(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const commandName = command.args?.[0];
    if (!commandName) {
      return {
        success: false,
        output: "Usage: man <command>\nExample: man scan",
        timestamp: new Date(),
      };
    }

    // Fetch player progress for skill-based filtering
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });
    const skills: Record<string, unknown> = progress
      ? (progress as unknown as Record<string, unknown>)
      : {};

    const commands = await this.getAvailableCommands(
      context,
      undefined,
      skills,
    );
    const cmdInfo = commands.find((cmd) => cmd.command === commandName);
    if (!cmdInfo) {
      // Check if the command exists but is locked
      const allCommands = await this.getAvailableCommands(context);
      const lockedCmd = allCommands.find((cmd) => cmd.command === commandName);
      if (lockedCmd) {
        const key = resolveSkillKey(commandName);
        const req = SKILL_REQUIREMENTS[key];
        const skillInfo = req ? ` Requires ${req.label} ${req.level}.` : "";
        return {
          success: false,
          output: `Command '${commandName}' is locked.${skillInfo}\nRaise your skills to unlock it.`,
          timestamp: new Date(),
        };
      }
      return {
        success: false,
        output: `No manual entry for '${commandName}'\nType 'help' to see available commands`,
        timestamp: new Date(),
      };
    }
    const sections: Array<{
      heading?: string;
      rows: Array<{ label: string; value: string }>;
    }> = [
      {
        heading: "NAME",
        rows: [
          { label: "", value: `${cmdInfo.command} - ${cmdInfo.description}` },
        ],
      },
      {
        heading: "SYNOPSIS",
        rows: [{ label: "", value: cmdInfo.usage }],
      },
      {
        heading: "DESCRIPTION",
        rows: [{ label: "", value: cmdInfo.description }],
      },
    ];
    if (cmdInfo.examples && cmdInfo.examples.length > 0) {
      sections.push({
        heading: "EXAMPLES",
        rows: cmdInfo.examples.map((ex) => ({ label: "", value: ex })),
      });
    }
    sections.push({
      heading: "CATEGORY",
      rows: [{ label: "", value: cmdInfo.category }],
    });

    const lines = multiPanel(
      `MANUAL: ${cmdInfo.command.toUpperCase()}`,
      sections,
      50,
    );
    return {
      success: true,
      output: render(lines),
      data: { command: cmdInfo },
      timestamp: new Date(),
    };
  }

  private async handleHistory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const limit = parseInt(String(command.args?.[0])) || 50;

    // Use in-memory history from context
    const userHistory = context.commandHistory.get(context.userId) || [];

    // Filter by server if needed (though legacy implementation might not have strictly filtered by server for history command)
    // For now, we'll return global history for the user as per legacy behavior

    const history = userHistory
      .slice() // Create a copy
      .reverse() // Newest first
      .slice(0, Math.min(limit, 200));

    if (history.length === 0) {
      return {
        success: true,
        output: "No command history",
        timestamp: new Date(),
      };
    }

    const entries = history.map((cmd: Command, index: number) => {
      const timeStr = new Date(cmd.timestamp).toLocaleTimeString();
      const args = cmd.args as string[];
      const cmdStr = `${cmd.command} ${args.join(" ")}`.trim();
      return { index: index + 1, time: timeStr, text: cmdStr };
    });

    const footer = `${history.length} command${history.length !== 1 ? "s" : ""} | Use 'history <n>' to limit (max 200)`;
    const lines = numberedLog("COMMAND HISTORY", entries, 50, footer);

    return {
      success: true,
      output: render(lines),
      data: { history },
      timestamp: new Date(),
    };
  }

  private async handleStats(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const history = context.commandHistory.get(context.userId) || [];
    const availableCommands = await this.getAvailableCommands(context);

    // Create a map of command -> category
    const commandCategories = new Map<string, string>();
    availableCommands.forEach((cmd) => {
      commandCategories.set(cmd.command, cmd.category);
    });

    // Count total commands
    const totalCommands = history.length;

    // Count by category (dynamically built from available commands)
    const commandsByCategory: Record<string, number> = {};
    availableCommands.forEach((cmd) => {
      if (!commandsByCategory[cmd.category]) {
        commandsByCategory[cmd.category] = 0;
      }
    });

    // Count command frequency
    const commandCounts: Record<string, number> = {};

    // Track daily activity (last 7 days)
    const dailyActivity: Record<string, number> = {};

    history.forEach((cmd) => {
      // Count by category
      const category = commandCategories.get(cmd.command) || "other";
      commandsByCategory[category] = (commandsByCategory[category] || 0) + 1;

      // Count command frequency
      commandCounts[cmd.command] = (commandCounts[cmd.command] || 0) + 1;

      // Count daily activity
      const dateKey = new Date(cmd.timestamp).toISOString().split("T")[0];
      if (dateKey) {
        dailyActivity[dateKey] = (dailyActivity[dateKey] || 0) + 1;
      }
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

    const sections: Array<{
      heading?: string;
      rows: Array<{ label: string; value: string }>;
    }> = [];

    // Overview section
    sections.push({
      rows: [
        { label: "Total Commands:  ", value: String(totalCommands) },
        {
          label: "Success Rate:    ",
          value: "100% (Tracking not implemented)",
        },
      ],
    });

    // Commands by category section
    const categoryRows: Array<{ label: string; value: string }> = [];
    Object.entries(commandsByCategory).forEach(([category, count]) => {
      if (count > 0) {
        const percentage =
          totalCommands > 0
            ? ((count / totalCommands) * 100).toFixed(1)
            : "0.0";
        categoryRows.push({
          label: `${category.padEnd(12)} `,
          value: `${count} (${percentage}%)`,
        });
      }
    });
    if (categoryRows.length > 0) {
      sections.push({ heading: "Commands by Category", rows: categoryRows });
    }

    // Most used commands section
    if (mostUsedCommands.length > 0) {
      const usedRows = mostUsedCommands.slice(0, 5).map((cmd, index) => ({
        label: `${index + 1}. ${cmd.command.padEnd(12)} `,
        value: `${cmd.count} times`,
      }));
      sections.push({ heading: "Most Used Commands", rows: usedRows });
    }

    // Recent activity section
    if (recentActivity.length > 0) {
      const activityRows = recentActivity.map((day) => ({
        label: `${day.date}  `,
        value: `${day.count} commands`,
      }));
      sections.push({ heading: "Recent Activity", rows: activityRows });
    }

    const lines = multiPanel("COMMAND STATISTICS", sections, 50);

    return {
      success: true,
      output: render(lines),
      data: {
        totalCommands,
        commandsByCategory,
        mostUsedCommands,
        recentActivity,
        successRate: 100,
      },
      timestamp: new Date(),
    };
  }

  /**
   * Dynamically discover commands from all registered modules via getCommandInfo().
   * Falls back to listing command names if a module doesn't implement getCommandInfo().
   *
   * When `playerSkills` is provided, commands whose skill requirements the player
   * hasn't met are tagged with `locked: true` and excluded from the default result.
   * Pass no skills to get the unfiltered list (used by handleStats, etc.).
   */
  private async getAvailableCommands(
    context: CommandContext,
    category?: string,
    playerSkills?: Record<string, unknown>,
  ): Promise<
    Array<{
      command: string;
      category: string;
      description: string;
      usage: string;
      examples: string[];
      locked?: boolean;
    }>
  > {
    const allCommands: Array<{
      command: string;
      category: string;
      description: string;
      usage: string;
      examples: string[];
      locked?: boolean;
    }> = [];

    for (const mod of context.modules) {
      if (mod.getCommandInfo) {
        const infos = mod.getCommandInfo();
        for (const info of infos) {
          let locked = false;
          if (playerSkills) {
            locked = !meetsSkillRequirement(
              info.command,
              undefined,
              playerSkills,
            );
          }
          allCommands.push({
            command: info.command,
            category: info.category,
            description: info.description,
            usage: info.usage,
            examples: info.examples || [],
            locked,
          });
        }
      } else {
        // Fallback: list command names with minimal info
        for (const cmd of mod.commands) {
          let locked = false;
          if (playerSkills) {
            locked = !meetsSkillRequirement(cmd, undefined, playerSkills);
          }
          allCommands.push({
            command: cmd,
            category: "other",
            description: `${cmd} command`,
            usage: cmd,
            examples: [],
            locked,
          });
        }
      }
    }

    // Deduplicate by command name
    const seen = new Set<string>();
    const deduplicated = allCommands.filter((cmd) => {
      if (seen.has(cmd.command)) return false;
      seen.add(cmd.command);
      return true;
    });

    let filtered = deduplicated;
    if (category) {
      filtered = filtered.filter((cmd) => cmd.category === category);
    }

    // When skills are provided, only return unlocked commands
    // but keep locked ones tagged so callers like showCategoryCommands
    // can count them
    return filtered;
  }
}
