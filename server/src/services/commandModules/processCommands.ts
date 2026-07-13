import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { getSession } from "./helpers";
import {
  boxTop,
  boxBottom,
  boxRow,
  boxCenter,
  boxDivider,
  sBoxTop,
  sBoxRow,
  sBoxBottom,
  progressBar,
  formatDuration,
  render,
} from "./asciiBox";

export class ProcessCommandsModule implements CommandModule {
  public category = "process";
  public commands: Set<string> = new Set([
    "ps",
    "top",
    "kill",
    "pkill",
    "nice",
    "renice",
    "free",
    "uptime",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const session = getSession(context);
    if (!session) {
      return { success: false, output: "No active session", timestamp: new Date() };
    }

    try {
      switch (command.command) {
        case "ps":
          return this.handlePs(context);
        case "top":
          return this.handleTop(context);
        case "kill":
          return this.handleKill(command, context);
        case "pkill":
          return this.handlePkill(command, context);
        case "nice":
          return this.handleNice(command, context);
        case "renice":
          return this.handleRenice(command, context);
        case "free":
          return this.handleFree(context);
        case "uptime":
          return this.handleUptime(context);
        default:
          return { success: false, output: `Unknown process command: ${command.command}`, timestamp: new Date() };
      }
    } catch (error) {
      return { success: false, output: error instanceof Error ? error.message : "Process command failed", timestamp: new Date() };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      { command: "ps", category: "process", description: "List running processes and resource usage", usage: "ps", examples: ["ps"] },
      { command: "top", category: "process", description: "System resource dashboard (CPU, RAM, Bandwidth)", usage: "top", examples: ["top"] },
      { command: "kill", category: "process", description: "Kill a running process to free resources", usage: "kill <pid>", examples: ["kill 101"] },
      { command: "pkill", category: "process", description: "Kill all processes of a type", usage: "pkill <type>", examples: ["pkill scan", "pkill hack_prep"] },
      { command: "nice", category: "process", description: "Run a command at a specific priority (-10=fast/expensive, 10=slow/cheap)", usage: "nice <priority> <command> [args]", examples: ["nice -5 hack 172.16.1.1", "nice 5 scan"] },
      { command: "renice", category: "process", description: "Change priority of a running process", usage: "renice <priority> <pid>", examples: ["renice -10 101", "renice 5 102"] },
      { command: "free", category: "process", description: "Show memory usage breakdown", usage: "free", examples: ["free"] },
      { command: "uptime", category: "process", description: "Show system uptime and resource summary", usage: "uptime", examples: ["uptime"] },
    ];
  }

  // ==================== PS ====================

  private handlePs(context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const breakdown = memoryService.getResourceBreakdown(context.userId);
    const processes = breakdown.processes;
    const consumers = breakdown.passiveConsumers;

    const W = 62;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("PROCESSES", W));
    lines.push(boxDivider(W));

    if (processes.length === 0 && consumers.length === 0) {
      lines.push(boxRow("  No active processes.", W));
      lines.push(boxRow("  System idle. OS overhead: CPU 10, RAM 24MB", W));
    }

    // Active game processes (with progress bars)
    if (processes.length > 0) {
      lines.push(boxRow(" PID  PROCESS              CPU  RAM    ETA      PROGRESS", W));
      lines.push(boxDivider(W));
      for (const p of processes) {
        const elapsed = Date.now() - p.startedAt;
        const remaining = Math.max(0, p.duration - elapsed);
        const etaStr = remaining > 0 ? formatDuration(remaining) : "done";
        const bar = progressBar(p.progress / 100, 10);
        const typeLabel = p.type.replace(/_/g, " ");
        const target = p.targetLabel.length > 12 ? p.targetLabel.substring(0, 12) : p.targetLabel;

        lines.push(boxRow(
          ` ${String(p.pid).padEnd(4)} ${(typeLabel + " " + target).padEnd(20)} ${String(p.cpuCost).padStart(3)}  ${String(p.ramCost).padStart(4)}MB  ${etaStr.padStart(7)}  ${bar}`,
          W,
        ));
      }
    }

    // Passive consumers
    if (consumers.length > 0) {
      if (processes.length > 0) lines.push(boxDivider(W));
      lines.push(boxRow(" PASSIVE CONSUMERS", W));
      lines.push(boxDivider(W));
      for (const c of consumers) {
        const costs: string[] = [];
        if (c.cpuCost > 0) costs.push(`CPU ${c.cpuCost}`);
        if (c.ramCost > 0) costs.push(`RAM ${c.ramCost}MB`);
        if (c.bwCost > 0) costs.push(`BW ${c.bwCost}`);
        const typeLabel = c.type === "active_trace" ? "trace" : c.type;
        lines.push(boxRow(` [${typeLabel}] ${c.label.substring(0, 24).padEnd(24)} ${costs.join("  ")}`, W));
      }
    }

    // OS overhead
    lines.push(boxDivider(W));
    lines.push(boxRow(" [system] OS overhead                     CPU 10  RAM 24MB", W));

    lines.push(boxDivider(W));
    const { spec } = breakdown;
    lines.push(boxRow(` Total: CPU ${spec.cpuUsed}/${spec.cpuTotal}  RAM ${spec.ramUsed}/${spec.ramTotal}MB  BW ${spec.bwUsed}/${spec.bwTotal}Mbps`, W));
    lines.push(boxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== TOP ====================

  private handleTop(context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const breakdown = memoryService.getResourceBreakdown(context.userId);
    const { spec } = breakdown;

    const cpuPct = spec.cpuTotal > 0 ? Math.round((spec.cpuUsed / spec.cpuTotal) * 100) : 0;
    const ramPct = spec.ramTotal > 0 ? Math.round((spec.ramUsed / spec.ramTotal) * 100) : 0;
    const bwPct = spec.bwTotal > 0 ? Math.round((spec.bwUsed / spec.bwTotal) * 100) : 0;

    const W = 56;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("SYSTEM RESOURCES", W));
    lines.push(boxDivider(W));
    lines.push(boxRow(` CPU: ${progressBar(cpuPct / 100, 20)}  ${spec.cpuUsed}/${spec.cpuTotal} (${cpuPct}%)`, W));
    lines.push(boxRow(` RAM: ${progressBar(ramPct / 100, 20)}  ${spec.ramUsed}/${spec.ramTotal}MB (${ramPct}%)`, W));
    lines.push(boxRow(` BW:  ${progressBar(bwPct / 100, 20)}  ${spec.bwUsed}/${spec.bwTotal}Mbps (${bwPct}%)`, W));

    if (breakdown.processes.length > 0) {
      lines.push(boxDivider(W));
      lines.push(boxRow(" PID  PROCESS            CPU  RAM   BW  PROGRESS", W));
      lines.push(boxDivider(W));
      for (const p of breakdown.processes) {
        const bar = progressBar(p.progress / 100, 8);
        const label = `${p.type.replace(/_/g, " ")} ${p.targetLabel}`.substring(0, 18);
        lines.push(boxRow(
          ` ${String(p.pid).padEnd(4)} ${label.padEnd(18)} ${String(p.cpuCost).padStart(3)}  ${String(p.ramCost).padStart(4)}  ${String(p.bwCost).padStart(3)}  ${bar} ${p.progress}%`,
          W,
        ));
      }
    }

    if (breakdown.passiveConsumers.length > 0) {
      lines.push(boxDivider(W));
      lines.push(boxRow(` Passive: ${breakdown.passiveConsumers.length} consumers (${breakdown.passiveConsumers.map(c => c.type).filter((v, i, a) => a.indexOf(v) === i).join(", ")})`, W));
    }

    lines.push(boxBottom(W));
    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== KILL ====================

  private handleKill(command: Command, context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const pidStr = command.args?.[0];
    if (!pidStr) {
      return { success: false, output: "Usage: kill <pid>\nUse 'ps' to see running process PIDs.", timestamp: new Date() };
    }

    const pid = parseInt(pidStr, 10);
    if (isNaN(pid)) {
      return { success: false, output: `Invalid PID: ${pidStr}`, timestamp: new Date() };
    }

    const process = memoryService.getGameProcess(context.userId, pid);
    if (!process) {
      return { success: false, output: `No running process with PID ${pid}.`, timestamp: new Date() };
    }

    const cancelled = memoryService.cancelGameProcess(context.userId, pid);
    if (!cancelled) {
      return { success: false, output: `Failed to kill process ${pid}.`, timestamp: new Date() };
    }

    const W = 44;
    const lines: string[] = [];
    lines.push(sBoxTop(W));
    lines.push(sBoxRow(` Process ${pid} terminated.`, W));
    lines.push(sBoxRow(` Freed: CPU ${process.cpuCost}  RAM ${process.ramCost}MB  BW ${process.bwCost}Mbps`, W));
    lines.push(sBoxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== FREE ====================

  private handleFree(context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const spec = memoryService.getComputerSpec(context.userId);
    const ramFree = spec.ramTotal - spec.ramUsed;

    const W = 48;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("MEMORY USAGE", W));
    lines.push(boxDivider(W));
    lines.push(boxRow(` Total:     ${String(spec.ramTotal).padStart(6)} MB`, W));
    lines.push(boxRow(` Used:      ${String(spec.ramUsed).padStart(6)} MB`, W));
    lines.push(boxRow(` Free:      ${String(ramFree).padStart(6)} MB`, W));
    lines.push(boxDivider(W));
    lines.push(boxRow(` ${progressBar(spec.ramUsed / spec.ramTotal, 30)}  ${Math.round((spec.ramUsed / spec.ramTotal) * 100)}%`, W));
    lines.push(boxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== UPTIME ====================

  private handleUptime(context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const spec = memoryService.getComputerSpec(context.userId);
    const processes = memoryService.getGameProcesses(context.userId);
    const consumers = memoryService.getPassiveConsumers(context.userId);
    const load = memoryService.getLoadAverage(context.userId);

    const session = getSession(context);
    const uptime = session ? Date.now() - session.connectedAt.getTime() : 0;

    const lines: string[] = [
      `up ${formatDuration(uptime)}, ${processes.length} processes, ${consumers.length} passive`,
      `load average: ${load.one}, ${load.five}, ${load.fifteen}`,
      `resources: CPU ${spec.cpuUsed}/${spec.cpuTotal}  RAM ${spec.ramUsed}/${spec.ramTotal}MB  BW ${spec.bwUsed}/${spec.bwTotal}Mbps`,
    ];

    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  // ==================== PKILL ====================

  private handlePkill(command: Command, context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const typeName = command.args?.[0];
    if (!typeName) {
      return { success: false, output: "Usage: pkill <type>\nTypes: hack_prep, scan, decrypt, download, backdoor_install, traceroute, trace_evade", timestamp: new Date() };
    }

    const processes = memoryService.getGameProcesses(context.userId);
    const matching = processes.filter((p) => p.type === typeName || p.type.replace(/_/g, " ") === typeName);

    if (matching.length === 0) {
      return { success: false, output: `No running processes of type: ${typeName}`, timestamp: new Date() };
    }

    let killed = 0;
    let freedCpu = 0, freedRam = 0, freedBw = 0;
    for (const p of matching) {
      if (memoryService.cancelGameProcess(context.userId, p.pid)) {
        killed++;
        freedCpu += p.cpuCost;
        freedRam += p.ramCost;
        freedBw += p.bwCost;
      }
    }

    return {
      success: true,
      output: `Killed ${killed} process${killed !== 1 ? "es" : ""}. Freed: CPU ${freedCpu}, RAM ${freedRam}MB, BW ${freedBw}Mbps`,
      timestamp: new Date(),
    };
  }

  // ==================== NICE ====================

  private handleNice(command: Command, context: CommandContext): CommandResult {
    // nice <priority> <command> [args...]
    // This doesn't execute the command directly — it tells the player what priority to use.
    // The actual priority is passed when the command spawns its process.
    // For now, nice stores the priority preference in the session.
    const args = command.args || [];
    if (args.length < 2) {
      return {
        success: false,
        output: "Usage: nice <priority> <command> [args...]\nPriority: -10 (fast/expensive) to 10 (slow/cheap). Default: 0.\n\nExample: nice -5 hack 172.16.1.1  (hack 30% faster, uses 20% more CPU)",
        timestamp: new Date(),
      };
    }

    const priority = parseInt(args[0]!, 10);
    if (isNaN(priority) || priority < -10 || priority > 10) {
      return { success: false, output: "Priority must be between -10 (highest) and 10 (lowest).", timestamp: new Date() };
    }

    // Store the priority preference — the next process spawn will pick it up
    const session = getSession(context);
    if (session) {
      (session as any)._nextProcessPriority = priority;
    }

    const cpuEffect = priority < 0 ? `+${Math.abs(priority) * 4}% CPU` : `-${priority * 4}% CPU`;
    const speedEffect = priority < 0 ? `${Math.abs(priority) * 5}% faster` : `${priority * 5}% slower`;
    const detEffect = priority < 0 ? `+${Math.abs(priority) * 3}% detection risk` : `-${Math.min(priority * 2, 20)}% detection risk`;

    const W = 48;
    const lines: string[] = [];
    lines.push(sBoxTop(W));
    lines.push(sBoxRow(` Priority set to ${priority} for next process.`, W));
    lines.push(sBoxRow(`   Speed:     ${speedEffect}`, W));
    lines.push(sBoxRow(`   CPU cost:  ${cpuEffect}`, W));
    lines.push(sBoxRow(`   Detection: ${detEffect}`, W));
    lines.push(sBoxRow("", W));
    lines.push(sBoxRow(" Now run your command.", W));
    lines.push(sBoxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== RENICE ====================

  private handleRenice(command: Command, context: CommandContext): CommandResult {
    const memoryService = context.services.memoryService;
    if (!memoryService) {
      return { success: false, output: "Resource system unavailable.", timestamp: new Date() };
    }

    const args = command.args || [];
    if (args.length < 2) {
      return {
        success: false,
        output: "Usage: renice <priority> <pid>\nPriority: -10 (fast/expensive) to 10 (slow/cheap).\n\nExample: renice -10 101  (max speed, high CPU cost)",
        timestamp: new Date(),
      };
    }

    const priority = parseInt(args[0]!, 10);
    const pid = parseInt(args[1]!, 10);

    if (isNaN(priority) || priority < -10 || priority > 10) {
      return { success: false, output: "Priority must be between -10 and 10.", timestamp: new Date() };
    }
    if (isNaN(pid)) {
      return { success: false, output: `Invalid PID: ${args[1]}`, timestamp: new Date() };
    }

    const result = memoryService.reniceProcess(context.userId, pid, priority);
    if (!result.success) {
      return { success: false, output: result.reason || "Failed to renice.", timestamp: new Date() };
    }

    const process = memoryService.getGameProcess(context.userId, pid);
    const remaining = process ? Math.max(0, process.duration - (Date.now() - process.startedAt)) : 0;

    const W = 48;
    const lines: string[] = [];
    lines.push(sBoxTop(W));
    lines.push(sBoxRow(` Process ${pid} priority → ${priority}`, W));
    if (result.cpuDelta && result.cpuDelta > 0) {
      lines.push(sBoxRow(` CPU: +${result.cpuDelta} (higher priority)`, W));
    } else if (result.cpuDelta && result.cpuDelta < 0) {
      lines.push(sBoxRow(` CPU: ${result.cpuDelta} (lower priority, freed)`, W));
    }
    if (process) {
      lines.push(sBoxRow(` New ETA: ${formatDuration(remaining)}`, W));
      lines.push(sBoxRow(` CPU cost: ${process.cpuCost} (was ${process.baseCpuCost})`, W));
    }
    lines.push(sBoxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }
}
