import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

export class HelpCommandsModule implements CommandModule {
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
    const commands = await this.getAvailableCommands(context);

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
    commands: Array<{ command: string; category: string; description: string }>,
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

    // Count commands per category
    const categoryCounts: Record<string, number> = {};
    commands.forEach((cmd) => {
      categoryCounts[cmd.category] = (categoryCounts[cmd.category] || 0) + 1;
    });

    let output = "=== COMMAND CATEGORIES ===\\n\\n";
    output += "Usage: help <category>\\n\\n";

    categories.forEach(({ name, desc }) => {
      const count = categoryCounts[name] || 0;
      if (count > 0) {
        output += `📁 ${name.toUpperCase()}\\n`;
        output += `   ${desc}\\n`;
        output += `   ${count} command${count !== 1 ? "s" : ""}\\n\\n`;
      }
    });

    output += "\\nType 'help <category>' to see commands in that category.\\n";
    output += "Example: help system\\n";

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  /**
   * Show commands for a specific category
   */
  private showCategoryCommands(
    commands: Array<{ command: string; category: string; description: string; usage: string; examples: string[] }>,
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
          `Unknown category: ${category}\\n\\n` +
          `Available categories: ${validCategories.join(", ")}\\n\\n` +
          "Type 'help' to see all categories.",
        timestamp: new Date(),
      };
    }

    let output = `=== ${category.toUpperCase()} COMMANDS ===\\n\\n`;

    categoryCommands.forEach((cmd) => {
      output += `${cmd.command.padEnd(15)} - ${cmd.description}\\n`;
      output += `  Usage: ${cmd.usage}\\n`;
      if (cmd.examples && cmd.examples.length > 0) {
        output += `  Example: ${cmd.examples[0]}\\n`;
      }
      output += "\\n";
    });

    output += "Type 'help' to see all categories.\\n";
    output += "Type 'man <command>' for detailed command information.\\n";

    return {
      success: true,
      output,
      data: { commands: categoryCommands },
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
        output: "Usage: man <command>\\nExample: man scan",
        timestamp: new Date(),
      };
    }
    const commands = await this.getAvailableCommands(context);
    const cmdInfo = commands.find((cmd) => cmd.command === commandName);
    if (!cmdInfo) {
      return {
        success: false,
        output: `No manual entry for '${commandName}'\\nType 'help' to see available commands`,
        timestamp: new Date(),
      };
    }
    const output = [
      `📖 MANUAL: ${cmdInfo.command.toUpperCase()}`,
      "",
      "NAME",
      `  ${cmdInfo.command} - ${cmdInfo.description}`,
      "",
      "SYNOPSIS",
      `  ${cmdInfo.usage}`,
      "",
      "DESCRIPTION",
      `  ${cmdInfo.description}`,
      "",
    ];
    if (cmdInfo.examples && cmdInfo.examples.length > 0) {
      output.push(`EXAMPLES`);
      cmdInfo.examples.forEach((ex) => {
        output.push(`  ${ex}`);
      });
      output.push("");
    }
    output.push(`CATEGORY`);
    output.push(`  ${cmdInfo.category}`);
    return {
      success: true,
      output: output.join("\\n"),
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
    const output = ["📜 COMMAND HISTORY\\n"];
    history.forEach((cmd: Command, index: number) => {
      const timeStr = new Date(cmd.timestamp).toLocaleTimeString();
      const args = cmd.args as string[];
      const cmdStr = `${cmd.command} ${args.join(" ")}`.trim();
      output.push(`${String(index + 1).padStart(4)}  ${timeStr}  ${cmdStr}`);
    });
    output.push(`\\nTotal: ${history.length} command${history.length !== 1 ? "s" : ""}`);
    output.push(`Use 'history <n>' to limit results (max 200)`);
    return {
      success: true,
      output: output.join("\n"),
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
    availableCommands.forEach(cmd => {
      commandCategories.set(cmd.command, cmd.category);
    });

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
      process: 0,
      math: 0
    };

    // Count command frequency
    const commandCounts: Record<string, number> = {};

    // Track daily activity (last 7 days)
    const dailyActivity: Record<string, number> = {};

    history.forEach((cmd) => {
      // Count by category
      const category = commandCategories.get(cmd.command) || 'unknown';
      if (commandsByCategory[category] !== undefined) {
        commandsByCategory[category]++;
      }

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

    const output = [
      "=== COMMAND STATISTICS ===\n",
      `Total Commands: ${totalCommands}`,
      `Success Rate: 100% (Tracking not implemented)\n`,
      `Commands by Category:`,
    ];

    Object.entries(commandsByCategory).forEach(([category, count]) => {
      if (count > 0) {
        const percentage = totalCommands > 0 ? ((count / totalCommands) * 100).toFixed(1) : "0.0";
        output.push(`  ${category.padEnd(12)} : ${count} (${percentage}%)`);
      }
    });

    if (mostUsedCommands.length > 0) {
      output.push(`\nMost Used Commands:`);
      mostUsedCommands.slice(0, 5).forEach((cmd, index) => {
        output.push(
          `  ${index + 1}. ${cmd.command.padEnd(12)} : ${cmd.count} times`,
        );
      });
    }

    if (recentActivity.length > 0) {
      output.push(`\nRecent Activity:`);
      recentActivity.forEach((day) => {
        output.push(`  ${day.date}: ${day.count} commands`);
      });
    }

    return {
      success: true,
      output: output.join("\n"),
      data: {
        totalCommands,
        commandsByCategory,
        mostUsedCommands,
        recentActivity,
        successRate: 100
      },
      timestamp: new Date(),
    };
  }

  private async getAvailableCommands(
    _context: CommandContext,
    category?: string,
  ): Promise<
    Array<{
      command: string;
      category: string;
      description: string;
      usage: string;
      examples: string[];
    }>
  > {
    const allCommands = [
      // System Commands
      {
        command: "ls",
        category: "system",
        description: "List files and directories",
        usage: "ls [directory]",
        examples: ["ls", "ls /home", "ls .."],
      },
      {
        command: "cd",
        category: "system",
        description: "Change current directory",
        usage: "cd <directory>",
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
        description: "Display file contents",
        usage: "cat <file>",
        examples: ["cat file.txt", "cat /etc/config"],
      },
      {
        command: "mkdir",
        category: "system",
        description: "Create a new directory",
        usage: "mkdir <directory>",
        examples: ["mkdir newfolder", "mkdir /home/data"],
      },
      {
        command: "rm",
        category: "system",
        description: "Remove files or directories",
        usage: "rm <file>",
        examples: ["rm file.txt", "rm -r folder"],
      },
      // File Commands
      {
        command: "upload",
        category: "file",
        description: "Upload a file to current server",
        usage: "upload <filename> <content>",
        examples: ["upload script.sh 'echo hello'"],
      },
      {
        command: "download",
        category: "file",
        description: "Download a file from current server",
        usage: "download <filename>",
        examples: ["download data.txt"],
      },
      {
        command: "encrypt",
        category: "file",
        description: "Encrypt a file",
        usage: "encrypt <filename>",
        examples: ["encrypt secrets.txt"],
      },
      {
        command: "decrypt",
        category: "file",
        description: "Decrypt a file",
        usage: "decrypt <filename>",
        examples: ["decrypt secrets.txt.enc"],
      },
      {
        command: "analyze",
        category: "file",
        description: "Analyze file for vulnerabilities",
        usage: "analyze <filename>",
        examples: ["analyze system.log"],
      },
      // Process Commands
      {
        command: "ps",
        category: "process",
        description: "List running processes",
        usage: "ps",
        examples: ["ps"],
      },
      {
        command: "top",
        category: "process",
        description: "Display system resource usage",
        usage: "top",
        examples: ["top"],
      },
      {
        command: "kill",
        category: "process",
        description: "Terminate a process",
        usage: "kill [-SIGNAL] <pid>",
        examples: ["kill 1234", "kill -KILL 5678"],
      },
      {
        command: "free",
        category: "process",
        description: "Display memory usage",
        usage: "free",
        examples: ["free"],
      },
      {
        command: "uptime",
        category: "process",
        description: "Show system uptime and load",
        usage: "uptime",
        examples: ["uptime"],
      },
      // Math Commands
      {
        command: "calc",
        category: "math",
        description: "Evaluate mathematical expressions",
        usage: "calc <expression>",
        examples: ["calc 2 + 3 * 4", "calc sqrt(16)", "calc x = 10"],
      },
      {
        command: "vars",
        category: "math",
        description: "List defined variables",
        usage: "vars",
        examples: ["vars"],
      },
      {
        command: "convert",
        category: "math",
        description: "Convert units",
        usage: "convert <value> <from> <to>",
        examples: ["convert 10 km mi", "convert 32 f c"],
      },
      {
        command: "random",
        category: "math",
        description: "Generate random numbers",
        usage: "random [max] or random <min> <max>",
        examples: ["random", "random 100", "random 1 10"],
      },
      // Network Commands
      {
        command: "scan",
        category: "network",
        description: "Scan for available servers",
        usage: "scan [-l<level>]",
        examples: ["scan", "scan -l5"],
      },
      {
        command: "connect",
        category: "network",
        description: "Connect to a server",
        usage: "connect <server_id>",
        examples: ["connect 192.168.1.1"],
      },
      {
        command: "disconnect",
        category: "network",
        description: "Disconnect from current server",
        usage: "disconnect",
        examples: ["disconnect"],
      },
      {
        command: "probe",
        category: "network",
        description: "Get server information",
        usage: "probe <server_id>",
        examples: ["probe 192.168.1.1"],
      },
      {
        command: "traceroute",
        category: "network",
        description: "Trace network path to server",
        usage: "traceroute <server_id>",
        examples: ["traceroute 192.168.1.1"],
      },
      // Help Commands
      {
        command: "help",
        category: "help",
        description: "Show available commands",
        usage: "help [category]",
        examples: ["help", "help network"],
      },
      {
        command: "man",
        category: "help",
        description: "Show command manual",
        usage: "man <command>",
        examples: ["man scan"],
      },
      {
        command: "history",
        category: "help",
        description: "Show command history",
        usage: "history [limit]",
        examples: ["history", "history 20"],
      },
    ];
    if (category) {
      return allCommands.filter((cmd) => cmd.category === category);
    }
    return allCommands;
  }
}
