import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import {
  table,
  panel,
  render,
  renderSections,
  progressBar,
  Column,
} from "./asciiBox";

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
          return await this.handlePs(command, context, session.socketId);

        case "top":
          return await this.handleTop(command, context, session.socketId);

        case "kill":
          return await this.handleKill(command, context, session.socketId);

        case "free":
          return await this.handleFree(command, context, session.socketId);

        case "uptime":
          return await this.handleUptime(command, context, session.socketId);

        case "pkill":
          return await this.handlePkill(command, context, session.socketId);

        case "pgrep":
          return await this.handlePgrep(command, context, session.socketId);

        case "nice":
          return await this.handleNice(command, context, session.socketId);

        case "renice":
          return await this.handleRenice(command, context, session.socketId);

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

    const columns: Column[] = [
      { header: "PID", width: 6, align: "left" },
      { header: "NAME", width: 16, align: "left" },
      { header: "USER", width: 9, align: "left" },
      { header: "CPU%", width: 5, align: "right" },
      { header: "MEM(KB)", width: 7, align: "right" },
      { header: "STATUS", width: 9, align: "left" },
      { header: "TIME", width: 8, align: "left" },
      { header: "PROGRESS", width: 22, align: "left" },
    ];

    const rows: string[][] = processes.map((proc: any) => {
      const runtime = Math.floor((Date.now() - proc.startTime) / 1000);
      const hours = Math.floor(runtime / 3600);
      const minutes = Math.floor((runtime % 3600) / 60);
      const seconds = runtime % 60;
      const time = `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

      let progressCol = "";
      if (proc.isCommand && proc.commandMetadata) {
        const progress = proc.commandMetadata.progress || 0;
        progressCol = progressBar(progress / 100, 10);
        if (proc.commandMetadata.targetInfo) {
          progressCol += ` > ${proc.commandMetadata.targetInfo}`;
        }
      }

      return [
        proc.pid.toString(),
        proc.name.substring(0, 16),
        proc.user.substring(0, 9),
        proc.cpu.toFixed(1),
        proc.memory.toString(),
        proc.status,
        time,
        progressCol,
      ];
    });

    const lines = table(
      columns,
      rows,
      `PROCESS LIST -- ${processes.length} process(es)`,
    );

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
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

    const statsPanel = panel(
      "SYSTEM MONITOR (top)",
      [
        {
          label: "Load Average:  ",
          value: `${loadAvg.one.toFixed(2)}, ${loadAvg.five.toFixed(2)}, ${loadAvg.fifteen.toFixed(2)}`,
        },
        {
          label: "Processes:     ",
          value: `${processes.length} total, ${runningCount} running`,
        },
        { label: "CPU:           ", value: `${cpuTotal.toFixed(1)}% total` },
        {
          label: "Memory:        ",
          value: `${memInfo.used}/${memInfo.total} KB (${((memInfo.used / memInfo.total) * 100).toFixed(1)}%)`,
        },
        {
          label: "Swap:          ",
          value: `${memInfo.swapUsed}/${memInfo.swapTotal} KB`,
        },
      ],
      52,
    );

    const procColumns: Column[] = [
      { header: "PID", width: 6, align: "left" },
      { header: "NAME", width: 16, align: "left" },
      { header: "CPU%", width: 5, align: "right" },
      { header: "MEM(KB)", width: 7, align: "right" },
      { header: "STATUS", width: 9, align: "left" },
    ];

    // Sort by CPU usage
    const sorted = [...processes].sort((a, b) => b.cpu - a.cpu).slice(0, 10);

    const procRows: string[][] = sorted.map((proc: any) => [
      proc.pid.toString(),
      proc.name.substring(0, 16),
      proc.cpu.toFixed(1),
      proc.memory.toString(),
      proc.status,
    ]);

    const procTable = table(procColumns, procRows);

    return {
      success: true,
      output: renderSections(statsPanel, procTable),
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

    const memColumns: Column[] = [
      { header: "", width: 8, align: "left" },
      { header: "TOTAL", width: 9, align: "right" },
      { header: "USED", width: 9, align: "right" },
      { header: "FREE", width: 9, align: "right" },
      { header: "BUFFERS", width: 9, align: "right" },
      { header: "CACHED", width: 9, align: "right" },
    ];

    const memRows: string[][] = [
      [
        "Mem:",
        memInfo.total.toString(),
        memInfo.used.toString(),
        memInfo.free.toString(),
        memInfo.buffers.toString(),
        memInfo.cached.toString(),
      ],
      [
        "Swap:",
        memInfo.swapTotal.toString(),
        memInfo.swapUsed.toString(),
        memInfo.swapFree.toString(),
        "",
        "",
      ],
    ];

    const usagePercent = ((memInfo.used / memInfo.total) * 100).toFixed(1);
    const lines = table(
      memColumns,
      memRows,
      `MEMORY USAGE -- Available: ${memInfo.available} KB (${(100 - parseFloat(usagePercent)).toFixed(1)}% free)`,
    );

    return {
      success: true,
      output: render(lines),
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

    const uptimeStr =
      days > 0
        ? `${days} day${days !== 1 ? "s" : ""}, ${hours}:${minutes.toString().padStart(2, "0")}`
        : `${hours}:${minutes.toString().padStart(2, "0")}`;

    const lines = panel(
      "SYSTEM UPTIME",
      [
        { label: "Up:            ", value: uptimeStr },
        { label: "Users:         ", value: `${userCount}` },
        {
          label: "Load average:  ",
          value: `${loadAvg.one.toFixed(2)}, ${loadAvg.five.toFixed(2)}, ${loadAvg.fifteen.toFixed(2)}`,
        },
      ],
      44,
    );

    return {
      success: true,
      output: render(lines),
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

    const pgrepColumns: Column[] = [
      { header: "PID", width: 6, align: "left" },
      { header: "NAME", width: 16, align: "left" },
      { header: "USER", width: 10, align: "left" },
    ];

    const pgrepRows: string[][] = matches.map((proc: any) => [
      proc.pid.toString(),
      proc.name.substring(0, 16),
      proc.user,
    ]);

    const lines = table(
      pgrepColumns,
      pgrepRows,
      `Found ${matches.length} process${matches.length !== 1 ? "es" : ""} matching '${processName}'`,
    );

    return {
      success: true,
      output: render(lines),
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
