import { EventEmitter } from "events";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { Server as SocketIOServer } from "socket.io";
import { LOGGER, SOCKET_IO } from "../di/tokens";

/**
 * MemoryService — Player Computer Resource Management
 *
 * Manages the player's virtual computer with limited CPU, RAM, and Bandwidth.
 * Every significant game action (hacking, scanning, decrypting) becomes a process
 * that consumes resources and takes real time. Passive consumers (open terminals,
 * server connections, active backdoors) create ongoing resource drain.
 *
 * Players must manage their rig: close unused tabs, disconnect from servers,
 * kill processes to free resources, and upgrade equipment for more capacity.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export type GameProcessType =
  | "hack_prep"
  | "scan"
  | "decrypt"
  | "download"
  | "backdoor_install"
  | "traceroute"
  | "trace_evade";

export interface GameProcess {
  pid: number;
  userId: string;
  sessionId: string;
  type: GameProcessType;
  targetId?: string | undefined;
  targetLabel: string;
  cpuCost: number;        // actual CPU cost (base * priority multiplier)
  baseCpuCost: number;    // original CPU cost before priority
  ramCost: number;
  bwCost: number;
  priority: number;       // -10 to 10. Negative = high priority (faster, more CPU). Positive = low priority (slower, less CPU). 0 = normal.
  detectionModifier: number; // -0.20 to +0.30. Added to hack detection rate. Aggressive = easier to detect. Stealth = harder.
  startedAt: number;
  duration: number;       // total ms (adjusted by priority)
  baseDuration: number;   // original duration before priority
  progress: number;       // 0-100
  status: "running" | "completed" | "failed" | "cancelled";
  onComplete?: (() => Promise<void>) | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/** Passive resource consumers — ongoing costs that don't have a process timer */
export interface PassiveConsumer {
  id: string;
  type: "terminal" | "connection" | "backdoor" | "active_trace";
  label: string;
  cpuCost: number;
  ramCost: number;
  bwCost: number;
}

export interface ComputerSpec {
  cpuTotal: number;
  cpuUsed: number;      // sum of active processes + passive consumers
  ramTotal: number;
  ramUsed: number;
  bwTotal: number;
  bwUsed: number;
}

export interface ResourceBreakdown {
  spec: ComputerSpec;
  processes: GameProcess[];
  passiveConsumers: PassiveConsumer[];
}

// ═══════════════════════════════════════════════════════════════════════════
// Process Cost Table
// ═══════════════════════════════════════════════════════════════════════════

export interface ProcessCostConfig {
  cpuCost: number;
  ramCost: number;
  bwCost: number;
  baseDuration: number;     // ms
  minDuration: number;      // ms (floor — even max-skill players wait a bit)
  skillName: string;
  skillScaleFactor: number; // ms saved per skill level
}

export const PROCESS_COSTS: Record<GameProcessType, ProcessCostConfig> = {
  hack_prep:        { cpuCost: 80,  ramCost: 128, bwCost: 50, baseDuration: 60000,  minDuration: 12000, skillName: "hacking",      skillScaleFactor: 1000 },
  scan:             { cpuCost: 40,  ramCost: 32,  bwCost: 80, baseDuration: 15000,  minDuration: 3000,  skillName: "networking",    skillScaleFactor: 500  },
  decrypt:          { cpuCost: 100, ramCost: 64,  bwCost: 0,  baseDuration: 45000,  minDuration: 9000,  skillName: "cryptography",  skillScaleFactor: 1500 },
  download:         { cpuCost: 10,  ramCost: 64,  bwCost: 60, baseDuration: 10000,  minDuration: 2000,  skillName: "networking",    skillScaleFactor: 300  },
  backdoor_install: { cpuCost: 60,  ramCost: 96,  bwCost: 40, baseDuration: 90000,  minDuration: 18000, skillName: "stealth",       skillScaleFactor: 1500 },
  traceroute:       { cpuCost: 20,  ramCost: 16,  bwCost: 40, baseDuration: 8000,   minDuration: 2000,  skillName: "networking",    skillScaleFactor: 200  },
  trace_evade:      { cpuCost: 70,  ramCost: 64,  bwCost: 30, baseDuration: 30000,  minDuration: 6000,  skillName: "stealth",       skillScaleFactor: 800  },
};

/** Passive consumer costs */
const PASSIVE_COSTS = {
  terminal:     { cpu: 5,  ram: 16, bw: 0  },
  connection:   { cpu: 0,  ram: 8,  bw: 15 },
  backdoor:     { cpu: 5,  ram: 8,  bw: 10 },
  active_trace: { cpu: 15, ram: 16, bw: 5  },
};

/** OS overhead — small baseline always reserved */
const OS_OVERHEAD = { cpu: 10, ram: 24, bw: 0 };

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function calculateProcessDuration(type: GameProcessType, skillLevel: number): number {
  const cost = PROCESS_COSTS[type];
  const reduced = cost.baseDuration - (skillLevel * cost.skillScaleFactor);
  return Math.max(cost.minDuration, reduced);
}

/**
 * Priority affects CPU cost, duration, and detection risk:
 *   priority -10 (aggressive): ~1.4x CPU, ~0.5x duration, +30% detection
 *   priority   0 (normal):     1.0x CPU, 1.0x duration, +0% detection
 *   priority +10 (stealth):    ~0.6x CPU, ~1.5x duration, -20% detection
 */
function applyPriority(baseCpu: number, baseDuration: number, priority: number): { cpuCost: number; duration: number; detectionModifier: number } {
  const p = Math.max(-10, Math.min(10, priority));
  const cpuMult = 1.0 + (p * -0.04);      // -10→1.4, 0→1.0, 10→0.6
  const durMult = 1.0 + (p * 0.05);        // -10→0.5, 0→1.0, 10→1.5
  const detMod = p * -0.03;                // -10→+0.30, 0→0, 10→-0.30 (capped at -0.20)
  return {
    cpuCost: Math.max(1, Math.round(baseCpu * cpuMult)),
    duration: Math.max(1000, Math.round(baseDuration * durMult)),
    detectionModifier: Math.max(-0.20, Math.min(0.30, detMod)),
  };
}

/**
 * Get the detection modifier for a given priority level.
 * Exported so HackService can use it when calculating detection rates.
 */
export function getDetectionModifierForPriority(priority: number): number {
  const p = Math.max(-10, Math.min(10, priority));
  const detMod = p * -0.03;
  return Math.max(-0.20, Math.min(0.30, detMod));
}

/** Hardware item name → resource bonus mapping */
const HARDWARE_BONUSES: Record<string, { cpu?: number; ram?: number; bw?: number }> = {
  "RAM Module Mk1":      { ram: 64 },
  "RAM Module Mk2":      { ram: 128 },
  "Quantum RAM":         { ram: 256 },
  "CPU Fan Upgrade":     { cpu: 50 },
  "CPU Overclock Kit":   { cpu: 100 },
  "Neural Coprocessor":  { cpu: 200 },
  "Network Card Mk1":    { bw: 25 },
  "Fiber Uplink":        { bw: 100 },
  "Darknet Relay":       { bw: 200 },
};

function calculateBaseSpec(playerLevel: number, equipmentBonuses?: { cpu?: number; ram?: number; bw?: number }): { cpuTotal: number; ramTotal: number; bwTotal: number } {
  return {
    cpuTotal: 200 + Math.floor(playerLevel / 10) * 100 + (equipmentBonuses?.cpu || 0),
    ramTotal: 256 + Math.floor(playerLevel / 10) * 128 + (equipmentBonuses?.ram || 0),
    bwTotal:  100 + Math.floor(playerLevel / 10) * 50  + (equipmentBonuses?.bw  || 0),
  };
}

/** Sum hardware bonuses from a list of equipped item names */
function sumHardwareBonuses(equippedItemNames: string[]): { cpu: number; ram: number; bw: number } {
  let cpu = 0, ram = 0, bw = 0;
  for (const name of equippedItemNames) {
    const bonus = HARDWARE_BONUSES[name];
    if (bonus) {
      cpu += bonus.cpu || 0;
      ram += bonus.ram || 0;
      bw += bonus.bw || 0;
    }
  }
  return { cpu, ram, bw };
}

// ═══════════════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════════════

@injectable()
class MemoryService extends EventEmitter {
  private gameProcesses: Map<string, Map<number, GameProcess>> = new Map(); // userId → pid → GameProcess
  private passiveConsumers: Map<string, Map<string, PassiveConsumer>> = new Map(); // userId → consumerId → PassiveConsumer
  private baseSpecs: Map<string, { cpuTotal: number; ramTotal: number; bwTotal: number }> = new Map(); // userId → base totals
  private nextPid: Map<string, number> = new Map(); // userId → next PID
  private ticker: NodeJS.Timeout | null = null;
  private io: SocketIOServer | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) io?: SocketIOServer,
  ) {
    super();
    this.io = io || null;
    this.startTicker();
    this.logger.info("MemoryService initialized (resource management)");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Computer Spec
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialize or update a player's computer spec from their level + equipment.
   * Pass equipped item names to apply hardware bonuses.
   */
  initComputerSpec(userId: string, playerLevel: number, equippedItemNames?: string[]): void {
    const equipmentBonuses = equippedItemNames ? sumHardwareBonuses(equippedItemNames) : undefined;
    this.baseSpecs.set(userId, calculateBaseSpec(playerLevel, equipmentBonuses));
    if (!this.gameProcesses.has(userId)) this.gameProcesses.set(userId, new Map());
    if (!this.passiveConsumers.has(userId)) this.passiveConsumers.set(userId, new Map());
    if (!this.nextPid.has(userId)) this.nextPid.set(userId, 100);
  }

  /**
   * Get a player's current computer spec with real-time usage from all sources.
   */
  getComputerSpec(userId: string): ComputerSpec {
    const base = this.baseSpecs.get(userId) || calculateBaseSpec(1);

    // Sum all resource usage: OS overhead + passive consumers + active processes
    let cpuUsed = OS_OVERHEAD.cpu;
    let ramUsed = OS_OVERHEAD.ram;
    let bwUsed = OS_OVERHEAD.bw;

    // Passive consumers
    const consumers = this.passiveConsumers.get(userId);
    if (consumers) {
      for (const c of consumers.values()) {
        cpuUsed += c.cpuCost;
        ramUsed += c.ramCost;
        bwUsed += c.bwCost;
      }
    }

    // Active game processes
    const processes = this.gameProcesses.get(userId);
    if (processes) {
      for (const p of processes.values()) {
        if (p.status === "running") {
          cpuUsed += p.cpuCost;
          ramUsed += p.ramCost;
          bwUsed += p.bwCost;
        }
      }
    }

    return {
      cpuTotal: base.cpuTotal,
      cpuUsed,
      ramTotal: base.ramTotal,
      ramUsed,
      bwTotal: base.bwTotal,
      bwUsed,
    };
  }

  /**
   * Get full resource breakdown (spec + all processes + all passive consumers).
   */
  getResourceBreakdown(userId: string): ResourceBreakdown {
    return {
      spec: this.getComputerSpec(userId),
      processes: this.getGameProcesses(userId),
      passiveConsumers: this.getPassiveConsumers(userId),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Passive Consumers (terminals, connections, backdoors, traces)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Register a passive resource consumer (terminal tab, server connection, etc.)
   */
  addPassiveConsumer(userId: string, type: PassiveConsumer["type"], id: string, label: string): void {
    if (!this.passiveConsumers.has(userId)) this.passiveConsumers.set(userId, new Map());
    const consumers = this.passiveConsumers.get(userId)!;

    const cost = PASSIVE_COSTS[type];
    consumers.set(id, {
      id,
      type,
      label,
      cpuCost: cost.cpu,
      ramCost: cost.ram,
      bwCost: cost.bw,
    });
  }

  /**
   * Remove a passive resource consumer (tab closed, disconnected, backdoor expired).
   */
  removePassiveConsumer(userId: string, id: string): void {
    this.passiveConsumers.get(userId)?.delete(id);
  }

  /**
   * Get all passive consumers for a user.
   */
  getPassiveConsumers(userId: string): PassiveConsumer[] {
    const consumers = this.passiveConsumers.get(userId);
    if (!consumers) return [];
    return [...consumers.values()];
  }

  /**
   * Convenience: register a terminal tab as passive consumer.
   */
  registerTerminal(userId: string, terminalId: string, label: string): void {
    this.addPassiveConsumer(userId, "terminal", `term:${terminalId}`, label);
  }

  /**
   * Convenience: unregister a terminal tab.
   */
  unregisterTerminal(userId: string, terminalId: string): void {
    this.removePassiveConsumer(userId, `term:${terminalId}`);
  }

  /**
   * Convenience: register a server connection as passive consumer.
   */
  registerConnection(userId: string, serverId: string, serverName: string): void {
    this.addPassiveConsumer(userId, "connection", `conn:${serverId}`, serverName);
  }

  /**
   * Convenience: unregister a server connection.
   */
  unregisterConnection(userId: string, serverId: string): void {
    this.removePassiveConsumer(userId, `conn:${serverId}`);
  }

  /**
   * Convenience: register an active backdoor as passive consumer.
   */
  registerBackdoor(userId: string, serverId: string, serverName: string): void {
    this.addPassiveConsumer(userId, "backdoor", `bdoor:${serverId}`, serverName);
  }

  /**
   * Convenience: unregister a backdoor.
   */
  unregisterBackdoor(userId: string, serverId: string): void {
    this.removePassiveConsumer(userId, `bdoor:${serverId}`);
  }

  /**
   * Convenience: register an active trace against this player.
   */
  registerActiveTrace(userId: string, traceId: string, label: string): void {
    this.addPassiveConsumer(userId, "active_trace", `trace:${traceId}`, label);
  }

  /**
   * Convenience: unregister a trace.
   */
  unregisterActiveTrace(userId: string, traceId: string): void {
    this.removePassiveConsumer(userId, `trace:${traceId}`);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Game Processes (hack, scan, decrypt, etc.)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Check if a player has enough free resources to spawn a process.
   */
  canSpawnProcess(userId: string, type: GameProcessType): { allowed: boolean; reason?: string } {
    const spec = this.getComputerSpec(userId);
    const cost = PROCESS_COSTS[type];

    const cpuFree = spec.cpuTotal - spec.cpuUsed;
    const ramFree = spec.ramTotal - spec.ramUsed;
    const bwFree = spec.bwTotal - spec.bwUsed;

    if (cost.cpuCost > cpuFree) {
      return { allowed: false, reason: `Insufficient CPU: need ${cost.cpuCost}, have ${cpuFree} free. Use 'kill <pid>' or close tabs.` };
    }
    if (cost.ramCost > ramFree) {
      return { allowed: false, reason: `Insufficient RAM: need ${cost.ramCost}MB, have ${ramFree}MB free.` };
    }
    if (cost.bwCost > bwFree) {
      return { allowed: false, reason: `Insufficient Bandwidth: need ${cost.bwCost}Mbps, have ${bwFree}Mbps free.` };
    }

    return { allowed: true };
  }

  /**
   * Spawn a game process. Returns the process, or null if insufficient resources.
   */
  spawnGameProcess(
    userId: string,
    sessionId: string,
    type: GameProcessType,
    skillLevel: number,
    targetLabel: string,
    targetId?: string,
    onComplete?: () => Promise<void>,
    metadata?: Record<string, unknown>,
    priority: number = 0,
  ): GameProcess | null {
    const cost = PROCESS_COSTS[type];
    const baseDuration = calculateProcessDuration(type, skillLevel);
    const adjusted = applyPriority(cost.cpuCost, baseDuration, priority);

    // Check with adjusted CPU cost
    const spec = this.getComputerSpec(userId);
    const cpuFree = spec.cpuTotal - spec.cpuUsed;
    const ramFree = spec.ramTotal - spec.ramUsed;
    const bwFree = spec.bwTotal - spec.bwUsed;

    if (adjusted.cpuCost > cpuFree || cost.ramCost > ramFree || cost.bwCost > bwFree) {
      return null;
    }

    // Generate PID
    if (!this.gameProcesses.has(userId)) this.gameProcesses.set(userId, new Map());
    const userProcesses = this.gameProcesses.get(userId)!;
    let pid = this.nextPid.get(userId) || 100;
    while (userProcesses.has(pid)) pid++;
    this.nextPid.set(userId, pid + 1);

    const process: GameProcess = {
      pid,
      userId,
      sessionId,
      type,
      targetId,
      targetLabel,
      baseCpuCost: cost.cpuCost,
      cpuCost: adjusted.cpuCost,
      ramCost: cost.ramCost,
      bwCost: cost.bwCost,
      priority,
      detectionModifier: adjusted.detectionModifier,
      startedAt: Date.now(),
      baseDuration: baseDuration,
      duration: adjusted.duration,
      progress: 0,
      status: "running",
      onComplete,
      metadata,
    };

    userProcesses.set(pid, process);

    // Push Socket.IO event
    if (this.io) {
      // Build contextual description for the ProcessBar
      const descriptions: Record<string, string> = {
        hack_prep: `Preparing hack on ${targetLabel || "target"}`,
        scan: `Scanning ${targetLabel || "network"}`,
        download: `Downloading ${targetLabel || "file"}`,
        decrypt: `Decrypting ${targetLabel || "file"}`,
        backdoor_install: `Installing backdoor on ${targetLabel || "server"}`,
        traceroute: `Tracing route to ${targetLabel || "target"}`,
        trace_evade: `Evading active trace`,
      };

      this.io.to(`player:${userId}`).emit("process:started", {
        pid,
        type,
        targetLabel,
        description: descriptions[type] || `Running ${type}`,
        eta: Math.ceil(adjusted.duration / 1000),
        cpuCost: adjusted.cpuCost,
        ramCost: cost.ramCost,
        bwCost: cost.bwCost,
        priority,
      });
    }

    this.logger.info({ userId, pid, type, targetLabel, durationSec: Math.ceil(adjusted.duration / 1000), priority }, "Game process spawned");
    return process;
  }

  /**
   * Cancel a running game process. Frees resources immediately.
   */
  cancelGameProcess(userId: string, pid: number): boolean {
    const process = this.gameProcesses.get(userId)?.get(pid);
    if (!process || process.status !== "running") return false;

    process.status = "cancelled";
    this.gameProcesses.get(userId)!.delete(pid);

    // Fire onCancel for consequence handling (partial detection, cooldowns)
    if (process.metadata?.onCancel && typeof process.metadata.onCancel === "function") {
      (process.metadata.onCancel as () => Promise<void>)().catch((err) =>
        this.logger.error({ err, pid, type: process.type }, "Process onCancel error"),
      );
    }

    if (this.io) {
      this.io.to(`player:${userId}`).emit("process:cancelled", { pid });
    }

    this.logger.info({ userId, pid, type: process.type }, "Game process cancelled");
    return true;
  }

  /**
   * Change the priority of a running process.
   * Adjusts CPU cost and remaining duration proportionally.
   * Returns the new CPU cost delta (positive = needs more CPU, negative = freed CPU).
   */
  reniceProcess(userId: string, pid: number, newPriority: number): { success: boolean; reason?: string; cpuDelta?: number } {
    const process = this.gameProcesses.get(userId)?.get(pid);
    if (!process || process.status !== "running") {
      return { success: false, reason: `No running process with PID ${pid}.` };
    }

    const oldPriority = process.priority;
    if (oldPriority === newPriority) {
      return { success: false, reason: `Process ${pid} is already at priority ${newPriority}.` };
    }

    // Calculate new costs
    const newAdj = applyPriority(process.baseCpuCost, process.baseDuration, newPriority);
    const oldCpuCost = process.cpuCost;

    // Check if we have enough CPU for the increase
    if (newAdj.cpuCost > oldCpuCost) {
      const spec = this.getComputerSpec(userId);
      const cpuFree = spec.cpuTotal - spec.cpuUsed;
      const cpuNeeded = newAdj.cpuCost - oldCpuCost;
      if (cpuNeeded > cpuFree) {
        return { success: false, reason: `Insufficient CPU for higher priority: need ${cpuNeeded} more, have ${cpuFree} free.` };
      }
    }

    // Apply new priority — scale remaining duration proportionally
    const elapsed = Date.now() - process.startedAt;
    const oldRemaining = Math.max(0, process.duration - elapsed);
    const ratio = process.baseDuration > 0 ? newAdj.duration / process.baseDuration : 1;
    const oldRatio = process.baseDuration > 0 ? process.duration / process.baseDuration : 1;
    const newRemaining = oldRemaining * (ratio / oldRatio);

    process.priority = newPriority;
    process.cpuCost = newAdj.cpuCost;
    process.duration = elapsed + newRemaining;

    const cpuDelta = newAdj.cpuCost - oldCpuCost;

    this.logger.info({ userId, pid, oldPriority, newPriority, cpuDelta }, "Process renice");
    return { success: true, cpuDelta };
  }

  /**
   * Get all running game processes for a user.
   */
  getGameProcesses(userId: string): GameProcess[] {
    const procs = this.gameProcesses.get(userId);
    if (!procs) return [];
    return [...procs.values()].filter((p) => p.status === "running");
  }

  /**
   * Get a specific game process.
   */
  getGameProcess(userId: string, pid: number): GameProcess | null {
    return this.gameProcesses.get(userId)?.get(pid) || null;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Tick Loop
  // ═══════════════════════════════════════════════════════════════════════

  private startTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), 1000);
    this.ticker.unref?.();
  }

  private tick(): void {
    const now = Date.now();

    for (const [userId, userProcesses] of this.gameProcesses) {
      for (const [pid, process] of userProcesses) {
        if (process.status !== "running") continue;

        const elapsed = now - process.startedAt;
        process.progress = Math.min(100, Math.floor((elapsed / process.duration) * 100));

        // Push progress every 5 seconds
        if (this.io && elapsed > 0 && Math.floor(elapsed / 5000) !== Math.floor((elapsed - 1000) / 5000)) {
          this.io.to(`player:${userId}`).emit("process:progress", {
            pid,
            progress: process.progress,
            eta: Math.max(0, Math.ceil((process.duration - elapsed) / 1000)),
          });
        }

        // Check completion
        if (elapsed >= process.duration) {
          process.status = "completed";
          process.progress = 100;
          userProcesses.delete(pid);

          // Fire callback
          if (process.onComplete) {
            process.onComplete().catch((err) =>
              this.logger.error({ err, pid, type: process.type }, "Process completion callback failed"),
            );
          }

          // Push event
          if (this.io) {
            this.io.to(`player:${userId}`).emit("process:completed", {
              pid,
              type: process.type,
              targetLabel: process.targetLabel,
            });
          }

          this.logger.info({ userId, pid, type: process.type, targetLabel: process.targetLabel }, "Game process completed");
        }
      }
    }

    // Push resource updates only to players with running processes (every 5 ticks)
    if (this.io && now % 5000 < 1000) {
      for (const [userId, userProcesses] of this.gameProcesses) {
        // Only broadcast if the player has running processes
        if (userProcesses.size === 0) continue;
        const spec = this.getComputerSpec(userId);
        this.io.to(`player:${userId}`).emit("resources:update", {
          cpuUsed: spec.cpuUsed,
          cpuTotal: spec.cpuTotal,
          ramUsed: spec.ramUsed,
          ramTotal: spec.ramTotal,
          bwUsed: spec.bwUsed,
          bwTotal: spec.bwTotal,
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Session Lifecycle
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Initialize a session — sets up computer spec and registers first terminal.
   */
  async initializeSession(sessionId: string, userId: string, playerLevel: number = 1): Promise<void> {
    this.initComputerSpec(userId, playerLevel);
    this.registerTerminal(userId, "default", "Terminal 1");
    this.logger.debug({ userId, sessionId }, "Session initialized with resource tracking");
  }

  /**
   * Clean up everything for a user on disconnect.
   */
  async cleanupSession(sessionId: string): Promise<void> {
    // Find userId from any process in this session
    for (const [userId, procs] of this.gameProcesses) {
      for (const p of procs.values()) {
        if (p.sessionId === sessionId) {
          // Cancel all running processes
          for (const [_pid, proc] of procs) {
            if (proc.status === "running") {
              proc.status = "cancelled";
            }
          }
          procs.clear();
          this.passiveConsumers.delete(userId);
          this.baseSpecs.delete(userId);
          this.nextPid.delete(userId);
          return;
        }
      }
    }
  }

  /**
   * Clean up all game processes for a user (without removing spec/consumers).
   */
  cleanupGameProcesses(userId: string): void {
    const procs = this.gameProcesses.get(userId);
    if (procs) {
      for (const p of procs.values()) {
        if (p.status === "running") p.status = "cancelled";
      }
      procs.clear();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Legacy API compatibility (used by processCommands.ts)
  // ═══════════════════════════════════════════════════════════════════════

  /** Get memory info formatted for the `free` command (values in KB) */
  getMemoryInfo(userId: string): { total: number; used: number; free: number; available: number; buffers: number; cached: number; swapTotal: number; swapUsed: number; swapFree: number } {
    const spec = this.getComputerSpec(userId);
    const totalKB = spec.ramTotal * 1024;
    const usedKB = spec.ramUsed * 1024;
    const freeKB = (spec.ramTotal - spec.ramUsed) * 1024;
    return {
      total: totalKB,
      used: usedKB,
      free: freeKB,
      available: freeKB,
      buffers: 0,
      cached: 0,
      swapTotal: 0,
      swapUsed: 0,
      swapFree: 0,
    };
  }

  /** Get total CPU usage as percentage */
  getTotalCpuUsage(userId: string): number {
    const spec = this.getComputerSpec(userId);
    return spec.cpuTotal > 0 ? (spec.cpuUsed / spec.cpuTotal) * 100 : 0;
  }

  /** Get uptime based on when spec was initialized */
  getUptime(_userId: string): number {
    return Date.now();
  }

  /** Get load average */
  getLoadAverage(userId: string): { one: number; five: number; fifteen: number } {
    const spec = this.getComputerSpec(userId);
    const load = spec.cpuTotal > 0 ? (spec.cpuUsed / spec.cpuTotal) * 2 : 0;
    return { one: +load.toFixed(2), five: +(load * 0.9).toFixed(2), fifteen: +(load * 0.8).toFixed(2) };
  }

  // ── Legacy API shims for hackCommands.ts ──
  // These bridge the old MemoryService API to the new system.
  // hackCommands registers hack sessions as "processes" for ps visibility.

  async spawnProcess(
    sessionId: string,
    _name: string,
    _command: string,
    _memory?: number | string,
    _cpu?: number,
    _user?: string,
  ): Promise<number> {
    // Find userId from sessionId (best effort)
    let userId = sessionId;
    for (const [uid, procs] of this.gameProcesses) {
      for (const p of procs.values()) {
        if (p.sessionId === sessionId) { userId = uid; break; }
      }
    }
    // Return a fake PID — hack sessions manage their own lifecycle
    const pid = this.nextPid.get(userId) || 100;
    this.nextPid.set(userId, pid + 1);
    return pid;
  }

  getProcess(_sessionId: string, _pid: number): any {
    return null; // Hack commands check for null and handle gracefully
  }

  async killProcess(_sessionId: string, _pid: number, _signal?: string): Promise<boolean> {
    return true; // No-op — hack session cleanup is handled by hackService
  }

  /** Get processes list (legacy — returns empty, game processes shown via getGameProcesses) */
  getProcesses(_sessionId: string): any[] {
    return [];
  }

  /** Set process priority (legacy no-op) */
  async setProcessPriority(_sessionId: string, _pid: number, _priority: number): Promise<boolean> {
    return true;
  }

  destroy(): void {
    if (this.ticker) {
      clearInterval(this.ticker);
      this.ticker = null;
    }
  }
}

export default MemoryService;
