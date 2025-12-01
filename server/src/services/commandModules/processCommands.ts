import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";

export class ProcessCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "ps",
    "top",
    "kill",
    "free",
    "uptime",
    "pkill",
    "pgrep",
    "nice",
    "renice",
  ]);

  /**
   * Helper to safely get memoryService
   */
  private getMemoryService(context: CommandContext) {
    const memService = context.services.memoryService;
    if (!memService) {
      throw new Error("Memory service not available");
    }
    return memService;
  }

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const session = context.gameStateManager.getSession(context.userId);
    if (!session) {
      return {
        success: false,
        output: "No active session",
        timestamp: new Date(),
      };
    }

    try {
      switch (command.command) {
        case "ps":
          return await this.handlePs(command, context, session.id);

        case "top":
          return await this.handleTop(command, context, session.id);

        case "kill":
          return await this.handleKill(command, context, session.id);

        case "free":
          return await this.handleFree(command, context, session.id);

        case "uptime":
          return await this.handleUptime(command, context, session.id);

        case "pkill":
          return await this.handlePkill(command, context, session.id);

        case "pgrep":
          return await this.handlePgrep(command, context, session.id);

        case "nice":
          return await this.handleNice(command, context, session.id);

        case "renice":
          return await this.handleRenice(command, context, session.id);

        default:
          return {
            success: false,
            output: `Process command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Process command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
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
        description: "Display system resource usage and top processes",
        usage: "top",
        examples: ["top"],
      },
      {
        command: "kill",
        category: "process",
        description: "Terminate a process by PID",
        usage: "kill [-SIGNAL] <pid>",
        examples: ["kill 1234", "kill -KILL 5678", "kill -TERM 9999"],
      },
      {
        command: "free",
        category: "process",
        description: "Display memory usage statistics",
        usage: "free",
        examples: ["free"],
      },
      {
        command: "uptime",
        category: "process",
        description: "Show system uptime and load average",
        usage: "uptime",
        examples: ["uptime"],
      },
      {
        command: "pkill",
        category: "process",
        description: "Kill processes by name",
        usage: "pkill <process_name>",
        examples: ["pkill apache", "pkill mysql"],
      },
      {
        command: "pgrep",
        category: "process",
        description: "Find process IDs by name",
        usage: "pgrep <process_name>",
        examples: ["pgrep sshd", "pgrep firewall"],
      },
      {
        command: "nice",
        category: "process",
        description: "Run a command with modified priority",
        usage: "nice [-n priority] <command>",
        examples: ["nice -n 10 backup.sh"],
      },
      {
        command: "renice",
        category: "process",
        description: "Change priority of running process",
        usage: "renice <priority> <pid>",
        examples: ["renice 5 1234", "renice -10 5678"],
      },
    ];
  }

  private async handlePs(
    _command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    if (!context.services.memoryService) {
      return {
        success: false,
        output: "Memory service not available",
        timestamp: new Date(),
      };
    }

    const memoryService = this.getMemoryService(context);
    const processes = memoryService.getProcesses(sessionId);

    if (processes.length === 0) {
      return {
        success: true,
        output: "No processes running",
        timestamp: new Date(),
      };
    }

    let output = "📋 Process List\n\n";
    output +=
      "PID    NAME              USER      CPU%   MEM(KB) STATUS    TIME     PROGRESS\n";
    output += "─".repeat(80) + "\n";

    for (const proc of processes) {
      const runtime = Math.floor((Date.now() - proc.startTime) / 1000);
      const hours = Math.floor(runtime / 3600);
      const minutes = Math.floor((runtime % 3600) / 60);
      const seconds = runtime % 60;
      const time = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

      output += `${proc.pid.toString().padEnd(6)} `;
      output += `${proc.name.substring(0, 16).padEnd(17)} `;
      output += `${proc.user.substring(0, 9).padEnd(10)} `;
      output += `${proc.cpu.toFixed(1).padStart(5)}  `;
      output += `${proc.memory.toString().padStart(7)} `;
      output += `${proc.status.padEnd(9)} `;
      output += `${time}  `;

      // Show progress for command processes
      if (proc.isCommand && proc.commandMetadata) {
        const progress = proc.commandMetadata.progress || 0;
        const progressBar = this.renderProgressBar(progress, 10);
        output += `${progressBar} ${progress.toFixed(0)}%`;

        if (proc.commandMetadata.targetInfo) {
          output += ` → ${proc.commandMetadata.targetInfo}`;
        }
      }

      output += "\n";
    }

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  /**
   * Render a simple ASCII progress bar
   */
  private renderProgressBar(progress: number, width: number): string {
    const filled = Math.floor((progress / 100) * width);
    const empty = width - filled;
    return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
  }

  private async handleTop(
    _command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const memoryService = this.getMemoryService(context);
    const processes = memoryService.getProcesses(sessionId);
    const memInfo = memoryService.getMemoryInfo(sessionId);
    const loadAvg = memoryService.getLoadAverage(sessionId);

    const cpuTotal = processes.reduce(
      (sum: number, p: { cpu: number }) => sum + p.cpu,
      0,
    );
    const runningCount = processes.filter(
      (p: { status: string }) => p.status === "running",
    ).length;

    let output = "🖥️  System Monitor (top)\n\n";
    output += `Load Average: ${loadAvg.one.toFixed(2)}, ${loadAvg.five.toFixed(2)}, ${loadAvg.fifteen.toFixed(2)}\n`;
    output += `Processes: ${processes.length} total, ${runningCount} running\n`;
    output += `CPU: ${cpuTotal.toFixed(1)}% total\n`;
    output += `Memory: ${memInfo.used}/${memInfo.total} KB (${((memInfo.used / memInfo.total) * 100).toFixed(1)}%)\n`;
    output += `Swap: ${memInfo.swapUsed}/${memInfo.swapTotal} KB\n\n`;

    output += "PID    NAME              CPU%   MEM(KB) STATUS\n";
    output += "─".repeat(50) + "\n";

    // Sort by CPU usage
    const sorted = [...processes].sort((a, b) => b.cpu - a.cpu).slice(0, 10);

    for (const proc of sorted) {
      output += `${proc.pid.toString().padEnd(6)} `;
      output += `${proc.name.substring(0, 16).padEnd(17)} `;
      output += `${proc.cpu.toFixed(1).padStart(5)}  `;
      output += `${proc.memory.toString().padStart(7)} `;
      output += `${proc.status}\n`;
    }

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleKill(
    command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: kill [-SIGNAL] <pid>\nSignals: TERM, KILL, STOP, CONT",
        timestamp: new Date(),
      };
    }

    let signal = "TERM";
    let pidArg = args[0];

    // Check if first arg is a signal
    if (args[0]?.startsWith("-")) {
      signal = args[0].substring(1).toUpperCase();
      if (!args[1]) {
        return {
          success: false,
          output: "Usage: kill [-SIGNAL] <pid>",
          timestamp: new Date(),
        };
      }
      pidArg = args[1];
    }

    const pid = parseInt(pidArg || "", 10);
    if (isNaN(pid)) {
      return {
        success: false,
        output: `Invalid PID: ${pidArg}`,
        timestamp: new Date(),
      };
    }

    try {
      const memoryService = this.getMemoryService(context);
      const killed = await memoryService.killProcess(sessionId, pid, signal);

      if (!killed) {
        return {
          success: false,
          output: `Process not found: ${pid}`,
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `Sent signal ${signal} to process ${pid}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error ? error.message : "Failed to kill process",
        timestamp: new Date(),
      };
    }
  }

  private async handleFree(
    _command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const memoryService = this.getMemoryService(context);
    const memInfo = memoryService.getMemoryInfo(sessionId);

    let output = "💾 Memory Usage\n\n";
    output += "              TOTAL      USED      FREE   BUFFERS    CACHED\n";
    output += "─".repeat(65) + "\n";

    output += "Mem:     ";
    output += `${memInfo.total.toString().padStart(9)} `;
    output += `${memInfo.used.toString().padStart(9)} `;
    output += `${memInfo.free.toString().padStart(9)} `;
    output += `${memInfo.buffers.toString().padStart(9)} `;
    output += `${memInfo.cached.toString().padStart(9)}\n`;

    output += "Swap:    ";
    output += `${memInfo.swapTotal.toString().padStart(9)} `;
    output += `${memInfo.swapUsed.toString().padStart(9)} `;
    output += `${memInfo.swapFree.toString().padStart(9)}\n\n`;

    const usagePercent = ((memInfo.used / memInfo.total) * 100).toFixed(1);
    output += `Available: ${memInfo.available} KB (${(100 - parseFloat(usagePercent)).toFixed(1)}% free)`;

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleUptime(
    _command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const memoryService = this.getMemoryService(context);
    const loadAvg = memoryService.getLoadAverage(sessionId);
    const processes = memoryService.getProcesses(sessionId);

    // Find the init process to get session start time
    const initProc = processes.find((p: { pid: number }) => p.pid === 1);
    if (!initProc) {
      return {
        success: false,
        output: "System not initialized",
        timestamp: new Date(),
      };
    }

    const uptime = Math.floor((Date.now() - initProc.startTime) / 1000);
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    const userCount = new Set(processes.map((p: { user: string }) => p.user))
      .size;

    let output = "⏱️  System Uptime\n\n";
    if (days > 0) {
      output += `Up ${days} day${days !== 1 ? "s" : ""}, ${hours}:${minutes.toString().padStart(2, "0")}\n`;
    } else {
      output += `Up ${hours}:${minutes.toString().padStart(2, "0")}\n`;
    }
    output += `Users: ${userCount}\n`;
    output += `Load average: ${loadAvg.one.toFixed(2)}, ${loadAvg.five.toFixed(2)}, ${loadAvg.fifteen.toFixed(2)}`;

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handlePkill(
    command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: pkill <process_name>",
        timestamp: new Date(),
      };
    }

    const processName = args[0];
    const memoryService = this.getMemoryService(context);
    const processes = memoryService.getProcesses(sessionId);
    const matches = processes.filter((p: { name: string }) =>
      p.name.includes(processName || ""),
    );

    if (matches.length === 0) {
      return {
        success: false,
        output: `No processes matching '${processName}'`,
        timestamp: new Date(),
      };
    }

    let killed = 0;
    const errors: string[] = [];

    for (const proc of matches) {
      try {
        if (proc.pid > 3) {
          // Don't kill critical system processes
          await memoryService.killProcess(sessionId, proc.pid, "TERM");
          killed++;
        }
      } catch (error) {
        errors.push(
          `PID ${proc.pid}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    let output = `Killed ${killed} process${killed !== 1 ? "es" : ""} matching '${processName}'`;
    if (errors.length > 0) {
      output += `\n\nErrors:\n${errors.join("\n")}`;
    }

    return {
      success: killed > 0,
      output,
      timestamp: new Date(),
    };
  }

  private async handlePgrep(
    command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: pgrep <process_name>",
        timestamp: new Date(),
      };
    }

    const processName = args[0];
    const memoryService = this.getMemoryService(context);
    const processes = memoryService.getProcesses(sessionId);
    const matches = processes.filter((p: { name: string }) =>
      p.name.includes(processName || ""),
    );

    if (matches.length === 0) {
      return {
        success: false,
        output: `No processes matching '${processName}'`,
        timestamp: new Date(),
      };
    }

    let output = `🔍 Found ${matches.length} process${matches.length !== 1 ? "es" : ""} matching '${processName}':\n\n`;
    output += "PID    NAME              USER\n";
    output += "─".repeat(40) + "\n";

    for (const proc of matches) {
      output += `${proc.pid.toString().padEnd(6)} `;
      output += `${proc.name.substring(0, 16).padEnd(17)} `;
      output += `${proc.user}\n`;
    }

    return {
      success: true,
      output,
      timestamp: new Date(),
    };
  }

  private async handleNice(
    command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length < 2) {
      return {
        success: false,
        output: "Usage: nice -n <priority> <command>",
        timestamp: new Date(),
      };
    }

    // Parse priority
    let priority = 0;
    let commandToRun: string | undefined = args[0];

    if (args[0] === "-n" && args.length >= 3) {
      priority = parseInt(args[1] || "", 10);
      commandToRun = args[2];

      if (isNaN(priority)) {
        return {
          success: false,
          output: `Invalid priority: ${args[1]}`,
          timestamp: new Date(),
        };
      }
    }

    if (!commandToRun) {
      return {
        success: false,
        output: "Usage: nice -n <priority> <command>",
        timestamp: new Date(),
      };
    }

    priority = Math.max(-20, Math.min(19, priority));

    // Spawn process with specific priority
    try {
      const memoryService = this.getMemoryService(context);
      const pid = await memoryService.spawnProcess(
        sessionId,
        commandToRun,
        args.slice(args[0] === "-n" ? 3 : 1).join(" "),
        context.userId,
      );

      await memoryService.setProcessPriority(sessionId, pid, priority);

      return {
        success: true,
        output: `Started process ${commandToRun} (PID: ${pid}) with priority ${priority}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error ? error.message : "Failed to start process",
        timestamp: new Date(),
      };
    }
  }

  private async handleRenice(
    command: Command,
    context: CommandContext,
    sessionId: string,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length < 2) {
      return {
        success: false,
        output: "Usage: renice <priority> <pid>",
        timestamp: new Date(),
      };
    }

    const priority = parseInt(args[0] || "", 10);
    const pid = parseInt(args[1] || "", 10);

    if (isNaN(priority)) {
      return {
        success: false,
        output: `Invalid priority: ${args[0]}`,
        timestamp: new Date(),
      };
    }

    if (isNaN(pid)) {
      return {
        success: false,
        output: `Invalid PID: ${args[1]}`,
        timestamp: new Date(),
      };
    }

    try {
      const memoryService = this.getMemoryService(context);
      const success = await memoryService.setProcessPriority(
        sessionId,
        pid,
        priority,
      );

      if (!success) {
        return {
          success: false,
          output: `Process not found: ${pid}`,
          timestamp: new Date(),
        };
      }

      const normalizedPriority = Math.max(-20, Math.min(19, priority));

      return {
        success: true,
        output: `Set priority of process ${pid} to ${normalizedPriority}`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error ? error.message : "Failed to set priority",
        timestamp: new Date(),
      };
    }
  }
}
