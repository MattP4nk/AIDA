import { EventEmitter } from "events";

/**
 * Memory Management Service - Backend process and memory tracking
 *
 * Tracks real process information per user session including:
 * - Process spawning and lifecycle
 * - Memory allocation and usage
 * - CPU usage tracking
 * - System resource monitoring
 * - Process hierarchy management
 */

export interface Process {
  pid: number;
  sessionId: string;
  userId: string;
  name: string;
  command: string;
  memory: number; // Memory in KB
  cpu: number; // CPU percentage
  status: "running" | "sleeping" | "stopped" | "zombie";
  startTime: number;
  priority: number; // Nice value (-20 to 19)
  user: string;
  parent?: number; // Parent PID
  children: number[]; // Child PIDs
}

export interface MemoryInfo {
  total: number; // Total memory in KB
  used: number; // Used memory in KB
  free: number; // Free memory in KB
  available: number; // Available memory in KB
  buffers: number; // Buffer memory in KB
  cached: number; // Cache memory in KB
  swapTotal: number; // Total swap in KB
  swapUsed: number; // Used swap in KB
  swapFree: number; // Free swap in KB
}

export interface MemoryAllocation {
  processId: number;
  sessionId: string;
  size: number;
  type: "heap" | "stack" | "data" | "code";
  address: number;
  allocated: boolean;
  timestamp: number;
}

export interface SessionMemoryStats {
  sessionId: string;
  userId: string;
  totalMemory: number;
  processCount: number;
  cpuUsage: number;
  startTime: number;
  lastActivity: number;
}

class MemoryService extends EventEmitter {
  private processes: Map<string, Map<number, Process>> = new Map(); // sessionId -> pid -> Process
  private allocations: Map<string, MemoryAllocation[]> = new Map(); // sessionId -> allocations
  private sessionStats: Map<string, SessionMemoryStats> = new Map();
  private nextPid: Map<string, number> = new Map(); // sessionId -> next PID
  private memoryFragmentation: Map<string, number> = new Map(); // sessionId -> fragmentation %

  // Memory limits per session
  private readonly SESSION_MEMORY_LIMIT = 128 * 1024; // 128 MB per session
  private readonly SWAP_MEMORY = 4 * 1024 * 1024; // 4 GB swap

  constructor() {
    super();
    this.startBackgroundTasks();
  }

  /**
   * Initialize a new session with system processes
   */
  async initializeSession(sessionId: string, userId: string): Promise<void> {
    if (this.processes.has(sessionId)) {
      return; // Already initialized
    }

    const sessionProcesses = new Map<number, Process>();
    this.processes.set(sessionId, sessionProcesses);
    this.allocations.set(sessionId, []);
    this.nextPid.set(sessionId, 1000);
    this.memoryFragmentation.set(sessionId, 0);

    // Create system processes for this session
    const systemProcs = [
      {
        name: "init",
        command: "/sbin/init",
        memory: 2048,
        cpu: 0.1,
        user: "root",
      },
      {
        name: "kthreadd",
        command: "[kthreadd]",
        memory: 0,
        cpu: 0.0,
        user: "root",
      },
      {
        name: "kernel",
        command: "[kernel]",
        memory: 4096,
        cpu: 0.3,
        user: "root",
      },
      {
        name: "neuro-daemon",
        command: "/usr/bin/neuro-daemon",
        memory: 8192,
        cpu: 1.5,
        user: "root",
      },
      {
        name: "neural-net",
        command: "/opt/neural/neural-net",
        memory: 16384,
        cpu: 3.2,
        user: "neural",
      },
      {
        name: "terminal",
        command: "/usr/bin/aida-terminal",
        memory: 12288,
        cpu: 2.1,
        user: userId,
      },
    ];

    systemProcs.forEach((proc, index) => {
      const process: Process = {
        pid: index + 1,
        sessionId,
        userId,
        name: proc.name,
        command: proc.command,
        memory: proc.memory,
        cpu: proc.cpu,
        status: "running",
        startTime: Date.now(),
        priority: proc.name === "init" ? -10 : 0,
        user: proc.user,
        children: [],
      };

      if (index > 0) {
        process.parent = 1;
        sessionProcesses.get(1)?.children.push(process.pid);
      }

      sessionProcesses.set(process.pid, process);
      this.allocateMemory(sessionId, process.pid, process.memory, "heap");
    });

    this.nextPid.set(sessionId, systemProcs.length + 1);

    // Initialize session stats
    this.sessionStats.set(sessionId, {
      sessionId,
      userId,
      totalMemory: systemProcs.reduce((sum, p) => sum + p.memory, 0),
      processCount: systemProcs.length,
      cpuUsage: systemProcs.reduce((sum, p) => sum + p.cpu, 0),
      startTime: Date.now(),
      lastActivity: Date.now(),
    });

    this.emit("session:initialized", { sessionId, userId });
  }

  /**
   * Cleanup session and all its processes
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const sessionProcesses = this.processes.get(sessionId);
    if (!sessionProcesses) return;

    // Kill all processes
    for (const pid of sessionProcesses.keys()) {
      if (pid > 3) {
        // Don't try to kill critical system processes
        await this.killProcess(sessionId, pid, "KILL");
      }
    }

    // Remove session data
    this.processes.delete(sessionId);
    this.allocations.delete(sessionId);
    this.sessionStats.delete(sessionId);
    this.nextPid.delete(sessionId);
    this.memoryFragmentation.delete(sessionId);

    this.emit("session:cleaned", { sessionId });
  }

  /**
   * Spawn a new process
   */
  async spawnProcess(
    sessionId: string,
    name: string,
    command: string,
    user: string,
    parentPid?: number,
  ): Promise<number> {
    const sessionProcesses = this.processes.get(sessionId);
    if (!sessionProcesses) {
      throw new Error("Session not initialized");
    }

    const estimatedMemory = this.estimateMemoryNeeds(name, command);

    if (!this.canAllocateMemory(sessionId, estimatedMemory)) {
      throw new Error("Insufficient memory to spawn process");
    }

    const currentPid = this.nextPid.get(sessionId) || 1000;
    this.nextPid.set(sessionId, currentPid + 1);

    const process: Process = {
      pid: currentPid,
      sessionId,
      userId: user,
      name,
      command,
      memory: estimatedMemory,
      cpu: 0.1,
      status: "running",
      startTime: Date.now(),
      priority: 0,
      user,
      ...(parentPid !== undefined ? { parent: parentPid } : {}),
      children: [],
    };

    sessionProcesses.set(process.pid, process);
    this.allocateMemory(sessionId, process.pid, estimatedMemory, "heap");

    // Add to parent's children
    if (parentPid && sessionProcesses.has(parentPid)) {
      sessionProcesses.get(parentPid)!.children.push(process.pid);
    }

    // Update session stats
    this.updateSessionStats(sessionId);

    this.emit("process:spawned", {
      sessionId,
      pid: process.pid,
      name,
      command,
    });

    return process.pid;
  }

  /**
   * Kill a process
   */
  async killProcess(
    sessionId: string,
    pid: number,
    signal: string = "TERM",
  ): Promise<boolean> {
    const sessionProcesses = this.processes.get(sessionId);
    if (!sessionProcesses) return false;

    const process = sessionProcesses.get(pid);
    if (!process) return false;

    // Cannot kill critical system processes
    if (pid <= 3) {
      throw new Error("Cannot kill system critical processes");
    }

    switch (signal) {
      case "TERM":
      case "INT":
        process.status = "stopped";
        setTimeout(() => this.removeProcess(sessionId, pid), 1000);
        break;
      case "KILL":
        this.removeProcess(sessionId, pid);
        break;
      case "STOP":
        process.status = "stopped";
        break;
      case "CONT":
        process.status = "running";
        break;
      default:
        throw new Error(`Unknown signal: ${signal}`);
    }

    this.emit("process:killed", { sessionId, pid, signal });
    return true;
  }

  /**
   * Remove a process completely
   */
  private removeProcess(sessionId: string, pid: number): void {
    const sessionProcesses = this.processes.get(sessionId);
    if (!sessionProcesses) return;

    const process = sessionProcesses.get(pid);
    if (!process) return;

    // Kill all children first
    process.children.forEach((childPid) => {
      this.killProcess(sessionId, childPid, "TERM");
    });

    // Remove from parent's children list
    if (process.parent) {
      const parent = sessionProcesses.get(process.parent);
      if (parent) {
        parent.children = parent.children.filter(
          (childPid) => childPid !== pid,
        );
      }
    }

    // Free memory
    this.deallocateMemory(sessionId, pid);

    // Remove process
    sessionProcesses.delete(pid);

    // Update session stats
    this.updateSessionStats(sessionId);

    this.emit("process:removed", { sessionId, pid });
  }

  /**
   * Allocate memory for a process
   */
  private allocateMemory(
    sessionId: string,
    processId: number,
    size: number,
    type: "heap" | "stack" | "data" | "code",
  ): boolean {
    if (!this.canAllocateMemory(sessionId, size)) {
      return false;
    }

    const allocations = this.allocations.get(sessionId) || [];

    const allocation: MemoryAllocation = {
      processId,
      sessionId,
      size,
      type,
      address: this.findFreeAddress(),
      allocated: true,
      timestamp: Date.now(),
    };

    allocations.push(allocation);
    this.allocations.set(sessionId, allocations);

    return true;
  }

  /**
   * Deallocate memory for a process
   */
  private deallocateMemory(sessionId: string, processId: number): void {
    const allocations = this.allocations.get(sessionId) || [];

    const remaining = allocations.filter((alloc) => {
      if (alloc.processId === processId) {
        alloc.allocated = false;
        return false;
      }
      return true;
    });

    this.allocations.set(sessionId, remaining);
  }

  /**
   * Check if memory can be allocated
   */
  private canAllocateMemory(sessionId: string, size: number): boolean {
    const memInfo = this.getMemoryInfo(sessionId);
    const availableMemory = memInfo.available;
    return availableMemory >= size;
  }

  /**
   * Find a free memory address (simulated)
   */
  private findFreeAddress(): number {
    return Math.floor(Math.random() * 0xffffffff);
  }

  /**
   * Estimate memory needs based on process type
   */
  private estimateMemoryNeeds(_name: string, command: string): number {
    if (command.includes("neural") || command.includes("ai")) {
      return 8192 + Math.floor(Math.random() * 16384); // 8-24 MB
    } else if (command.includes("daemon") || command.includes("service")) {
      return 2048 + Math.floor(Math.random() * 4096); // 2-6 MB
    } else if (command.includes("shell") || command.includes("terminal")) {
      return 4096 + Math.floor(Math.random() * 8192); // 4-12 MB
    } else {
      return 1024 + Math.floor(Math.random() * 2048); // 1-3 MB
    }
  }

  /**
   * Get memory information for a session
   */
  getMemoryInfo(sessionId: string): MemoryInfo {
    const allocations = this.allocations.get(sessionId) || [];
    const usedMemory = allocations
      .filter((alloc) => alloc.allocated)
      .reduce((total, alloc) => total + alloc.size, 0);

    const totalMemory = this.SESSION_MEMORY_LIMIT;
    const bufferCache = Math.floor(totalMemory * 0.1); // 10% for buffers/cache
    const actualUsed = usedMemory + bufferCache;
    const free = totalMemory - actualUsed;
    const fragmentation = this.memoryFragmentation.get(sessionId) || 0;
    const fragmented = Math.floor(free * (fragmentation / 100));
    const available = Math.max(0, free - fragmented);

    // Simulate swap usage
    const swapUsed = Math.max(0, usedMemory - totalMemory * 0.8);
    const swapFree = this.SWAP_MEMORY - swapUsed;

    return {
      total: totalMemory,
      used: actualUsed,
      free,
      available,
      buffers: Math.floor(bufferCache * 0.3),
      cached: Math.floor(bufferCache * 0.7),
      swapTotal: this.SWAP_MEMORY,
      swapUsed,
      swapFree,
    };
  }

  /**
   * Get all processes for a session
   */
  getProcesses(sessionId: string): Process[] {
    const sessionProcesses = this.processes.get(sessionId);
    if (!sessionProcesses) return [];
    return Array.from(sessionProcesses.values());
  }

  /**
   * Get a specific process
   */
  getProcess(sessionId: string, pid: number): Process | undefined {
    const sessionProcesses = this.processes.get(sessionId);
    return sessionProcesses?.get(pid);
  }

  /**
   * Get processes by user
   */
  getProcessesByUser(sessionId: string, user: string): Process[] {
    return this.getProcesses(sessionId).filter((p) => p.user === user);
  }

  /**
   * Set process priority
   */
  async setProcessPriority(
    sessionId: string,
    pid: number,
    priority: number,
  ): Promise<boolean> {
    const process = this.getProcess(sessionId, pid);
    if (!process) return false;

    priority = Math.max(-20, Math.min(19, priority));
    process.priority = priority;

    const baseCpu = this.getBaseCpuUsage(process.name);
    const priorityFactor = (20 - priority) / 20;
    process.cpu = baseCpu * priorityFactor;

    this.emit("process:priority_changed", { sessionId, pid, priority });
    return true;
  }

  /**
   * Get base CPU usage for process types
   */
  private getBaseCpuUsage(processName: string): number {
    switch (processName) {
      case "init":
        return 0.1;
      case "kernel":
        return 0.3;
      case "neural-net":
        return 3.0;
      case "neuro-daemon":
        return 1.5;
      case "terminal":
        return 2.0;
      default:
        return 0.1;
    }
  }

  /**
   * Get memory usage for a specific process
   */
  getProcessMemoryUsage(sessionId: string, pid: number): number {
    const allocations = this.allocations.get(sessionId) || [];
    return allocations
      .filter((alloc) => alloc.processId === pid && alloc.allocated)
      .reduce((total, alloc) => total + alloc.size, 0);
  }

  /**
   * Get system load average for a session
   */
  getLoadAverage(sessionId: string): {
    one: number;
    five: number;
    fifteen: number;
  } {
    const runningProcesses = this.getProcesses(sessionId).filter(
      (p) => p.status === "running",
    ).length;

    const baseLoad = runningProcesses / 4;

    return {
      one: Math.max(0, baseLoad + (Math.random() - 0.5) * 0.3),
      five: Math.max(0, baseLoad + (Math.random() - 0.5) * 0.2),
      fifteen: Math.max(0, baseLoad + (Math.random() - 0.5) * 0.1),
    };
  }

  /**
   * Get total CPU usage for a session
   */
  getTotalCpuUsage(sessionId: string): number {
    return this.getProcesses(sessionId).reduce(
      (total, process) => total + process.cpu,
      0,
    );
  }

  /**
   * Get session statistics
   */
  getSessionStats(sessionId: string): SessionMemoryStats | undefined {
    return this.sessionStats.get(sessionId);
  }

  /**
   * Get all active sessions
   */
  getAllSessions(): SessionMemoryStats[] {
    return Array.from(this.sessionStats.values());
  }

  /**
   * Update session statistics
   */
  private updateSessionStats(sessionId: string): void {
    const stats = this.sessionStats.get(sessionId);
    if (!stats) return;

    const processes = this.getProcesses(sessionId);
    const memInfo = this.getMemoryInfo(sessionId);

    stats.totalMemory = memInfo.used;
    stats.processCount = processes.length;
    stats.cpuUsage = this.getTotalCpuUsage(sessionId);
    stats.lastActivity = Date.now();

    this.sessionStats.set(sessionId, stats);
  }

  /**
   * Start background tasks for process simulation
   */
  private startBackgroundTasks(): void {
    // Update process stats every 5 seconds
    setInterval(() => {
      for (const sessionId of this.processes.keys()) {
        this.updateProcessStats(sessionId);
        this.simulateMemoryActivity(sessionId);
      }
    }, 5000);

    // Cleanup inactive sessions every minute
    setInterval(() => {
      this.cleanupInactiveSessions();
    }, 60000);
  }

  /**
   * Update process statistics for realism
   */
  private updateProcessStats(sessionId: string): void {
    const sessionProcesses = this.processes.get(sessionId);
    if (!sessionProcesses) return;

    for (const process of sessionProcesses.values()) {
      // Simulate CPU fluctuations
      const baseCpu = this.getBaseCpuUsage(process.name);
      process.cpu = Math.max(0, baseCpu + (Math.random() - 0.5) * 1.5);

      // Simulate memory changes for active processes
      if (process.name === "neural-net" || process.name === "terminal") {
        const memoryChange = Math.floor((Math.random() - 0.5) * 1024);
        process.memory = Math.max(1024, process.memory + memoryChange);
      }

      // Occasionally change status
      if (Math.random() < 0.03 && process.name !== "init") {
        process.status = process.status === "running" ? "sleeping" : "running";
      }
    }

    this.updateSessionStats(sessionId);
  }

  /**
   * Simulate memory activity and fragmentation
   */
  private simulateMemoryActivity(sessionId: string): void {
    const currentFragmentation = this.memoryFragmentation.get(sessionId) || 0;

    // Increase fragmentation over time
    let newFragmentation = currentFragmentation + Math.random() * 0.3;
    newFragmentation = Math.min(newFragmentation, 12); // Max 12% fragmentation

    // Occasionally defragment
    if (Math.random() < 0.15) {
      newFragmentation *= 0.7;
    }

    this.memoryFragmentation.set(sessionId, newFragmentation);
  }

  /**
   * Cleanup sessions that have been inactive for too long
   */
  private async cleanupInactiveSessions(): Promise<void> {
    const now = Date.now();
    const INACTIVE_THRESHOLD = 30 * 60 * 1000; // 30 minutes

    for (const [sessionId, stats] of this.sessionStats.entries()) {
      if (now - stats.lastActivity > INACTIVE_THRESHOLD) {
        await this.cleanupSession(sessionId);
        this.emit("session:timeout", { sessionId, userId: stats.userId });
      }
    }
  }

  /**
   * Format memory size for display
   */
  static formatMemorySize(sizeInKB: number): string {
    if (sizeInKB < 1024) {
      return `${sizeInKB.toFixed(1)}K`;
    } else if (sizeInKB < 1024 * 1024) {
      return `${(sizeInKB / 1024).toFixed(1)}M`;
    } else {
      return `${(sizeInKB / (1024 * 1024)).toFixed(1)}G`;
    }
  }

  /**
   * Format time duration
   */
  static formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Get detailed process information
   */
  getProcessDetails(sessionId: string, pid: number): any {
    const process = this.getProcess(sessionId, pid);
    if (!process) return null;

    const allocations = this.allocations.get(sessionId) || [];
    const processAllocations = allocations.filter(
      (a) => a.processId === pid && a.allocated,
    );
    const memoryUsage = this.getProcessMemoryUsage(sessionId, pid);
    const uptime = Date.now() - process.startTime;

    return {
      ...process,
      memoryUsage,
      uptime,
      allocations: processAllocations.length,
      memoryBreakdown: {
        heap: processAllocations
          .filter((a) => a.type === "heap")
          .reduce((s, a) => s + a.size, 0),
        stack: processAllocations
          .filter((a) => a.type === "stack")
          .reduce((s, a) => s + a.size, 0),
        data: processAllocations
          .filter((a) => a.type === "data")
          .reduce((s, a) => s + a.size, 0),
        code: processAllocations
          .filter((a) => a.type === "code")
          .reduce((s, a) => s + a.size, 0),
      },
    };
  }
}

export const memoryService = new MemoryService();
export { MemoryService };
