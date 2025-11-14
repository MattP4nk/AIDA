/**
 * Memory Manager - Virtual memory and process management system
 * Simulates realistic memory allocation, process tracking, and resource management
 */

export interface Process {
  pid: number;
  name: string;
  command: string;
  memory: number; // Memory in KB
  cpu: number; // CPU percentage
  status: 'running' | 'sleeping' | 'stopped' | 'zombie';
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
  size: number;
  type: 'heap' | 'stack' | 'data' | 'code';
  address: number;
  allocated: boolean;
}

export class MemoryManager {
  private static totalMemory = 512 * 1024; // 512 MB in KB
  private static totalSwap = 1024 * 1024; // 1 GB swap in KB
  private static processes: Map<number, Process> = new Map();
  private static nextPid = 1000;
  private static allocations: MemoryAllocation[] = [];
  private static systemProcesses: Process[] = [];
  private static memoryFragmentation = 0;
  private static lastUpdate = Date.now();

  // Initialize system processes
  static initialize(): void {
    this.createSystemProcesses();
    this.startMemorySimulation();
  }

  /**
   * Create essential system processes
   */
  private static createSystemProcesses(): void {
    const systemProcs = [
      { name: 'init', command: '/sbin/init', memory: 2048, cpu: 0.1, user: 'root' },
      { name: 'kthreadd', command: '[kthreadd]', memory: 0, cpu: 0.0, user: 'root' },
      { name: 'kernel', command: '[kernel]', memory: 8192, cpu: 0.5, user: 'root' },
      { name: 'neuro-daemon', command: '/usr/bin/neuro-daemon', memory: 16384, cpu: 2.1, user: 'root' },
      { name: 'neural-net', command: '/opt/neural/neural-net', memory: 32768, cpu: 5.3, user: 'neural' },
      { name: 'memory-guard', command: '/sys/memory-guard', memory: 4096, cpu: 0.8, user: 'system' },
      { name: 'terminal', command: '/usr/bin/aida-terminal', memory: 24576, cpu: 3.2, user: 'user' },
      { name: 'ssh-agent', command: '/usr/bin/ssh-agent', memory: 1024, cpu: 0.0, user: 'user' },
    ];

    systemProcs.forEach((proc, index) => {
      const process: Process = {
        pid: index + 1,
        name: proc.name,
        command: proc.command,
        memory: proc.memory,
        cpu: proc.cpu,
        status: 'running',
        startTime: Date.now() - Math.random() * 3600000, // Started within last hour
        priority: proc.name === 'init' ? -10 : 0,
        user: proc.user,
        children: [],
      };

      if (index > 0) {
        process.parent = 1; // Most processes are children of init
        this.processes.get(1)?.children.push(process.pid);
      }

      this.processes.set(process.pid, process);
      this.allocateMemory(process.pid, process.memory, 'heap');
    });

    this.nextPid = systemProcs.length + 1;
  }

  /**
   * Start background memory simulation
   */
  private static startMemorySimulation(): void {
    setInterval(() => {
      this.updateProcessStats();
      this.simulateMemoryActivity();
    }, 5000); // Update every 5 seconds
  }

  /**
   * Update process statistics realistically
   */
  private static updateProcessStats(): void {
    for (const process of this.processes.values()) {
      // Simulate CPU fluctuations
      const baseCpu = this.getBaseCpuUsage(process.name);
      process.cpu = Math.max(0, baseCpu + (Math.random() - 0.5) * 2);

      // Simulate memory changes
      if (process.name === 'neural-net' || process.name === 'terminal') {
        const memoryChange = Math.floor((Math.random() - 0.5) * 2048);
        process.memory = Math.max(1024, process.memory + memoryChange);
        this.reallocateMemory(process.pid, process.memory);
      }

      // Occasionally change process status
      if (Math.random() < 0.05) {
        if (process.status === 'running' && process.name !== 'init') {
          process.status = Math.random() < 0.7 ? 'sleeping' : 'running';
        }
      }
    }
  }

  /**
   * Get base CPU usage for different process types
   */
  private static getBaseCpuUsage(processName: string): number {
    switch (processName) {
      case 'init': return 0.1;
      case 'kernel': return 0.5;
      case 'neural-net': return 5.0;
      case 'neuro-daemon': return 2.0;
      case 'terminal': return 3.0;
      case 'memory-guard': return 0.8;
      default: return 0.1;
    }
  }

  /**
   * Simulate memory activity and fragmentation
   */
  private static simulateMemoryActivity(): void {
    // Increase fragmentation over time
    this.memoryFragmentation += Math.random() * 0.5;
    this.memoryFragmentation = Math.min(this.memoryFragmentation, 15); // Max 15% fragmentation

    // Occasionally defragment
    if (Math.random() < 0.1) {
      this.memoryFragmentation *= 0.8;
    }
  }

  /**
   * Spawn a new process
   */
  static spawnProcess(name: string, command: string, user: string, parentPid?: number): number {
    const estimatedMemory = this.estimateMemoryNeeds(name, command);

    if (!this.canAllocateMemory(estimatedMemory)) {
      throw new Error('Insufficient memory to spawn process');
    }

    const process: Process = {
      pid: this.nextPid++,
      name,
      command,
      memory: estimatedMemory,
      cpu: 0.1,
      status: 'running',
      startTime: Date.now(),
      priority: 0,
      user,
      parent: parentPid,
      children: [],
    };

    this.processes.set(process.pid, process);
    this.allocateMemory(process.pid, estimatedMemory, 'heap');

    // Add to parent's children list
    if (parentPid && this.processes.has(parentPid)) {
      this.processes.get(parentPid)!.children.push(process.pid);
    }

    return process.pid;
  }

  /**
   * Estimate memory needs based on process type
   */
  private static estimateMemoryNeeds(name: string, command: string): number {
    if (command.includes('neural') || command.includes('ai')) {
      return 16384 + Math.floor(Math.random() * 32768); // 16-48 MB
    } else if (command.includes('daemon') || command.includes('service')) {
      return 4096 + Math.floor(Math.random() * 8192); // 4-12 MB
    } else if (command.includes('shell') || command.includes('terminal')) {
      return 8192 + Math.floor(Math.random() * 16384); // 8-24 MB
    } else {
      return 1024 + Math.floor(Math.random() * 4096); // 1-5 MB
    }
  }

  /**
   * Kill a process and free its memory
   */
  static killProcess(pid: number, signal: string = 'TERM'): boolean {
    const process = this.processes.get(pid);
    if (!process) {
      return false;
    }

    // Cannot kill init or kernel processes
    if (pid <= 3) {
      throw new Error('Cannot kill system critical processes');
    }

    switch (signal) {
      case 'TERM':
      case 'INT':
        process.status = 'stopped';
        setTimeout(() => this.removeProcess(pid), 1000);
        break;
      case 'KILL':
        this.removeProcess(pid);
        break;
      case 'STOP':
        process.status = 'stopped';
        break;
      case 'CONT':
        process.status = 'running';
        break;
      default:
        throw new Error(`Unknown signal: ${signal}`);
    }

    return true;
  }

  /**
   * Remove a process completely
   */
  private static removeProcess(pid: number): void {
    const process = this.processes.get(pid);
    if (!process) return;

    // Kill all child processes first
    process.children.forEach(childPid => {
      this.killProcess(childPid, 'TERM');
    });

    // Remove from parent's children list
    if (process.parent) {
      const parent = this.processes.get(process.parent);
      if (parent) {
        parent.children = parent.children.filter(childPid => childPid !== pid);
      }
    }

    // Free memory allocations
    this.deallocateMemory(pid);

    // Remove from processes map
    this.processes.delete(pid);
  }

  /**
   * Allocate memory for a process
   */
  static allocateMemory(processId: number, size: number, type: 'heap' | 'stack' | 'data' | 'code'): boolean {
    if (!this.canAllocateMemory(size)) {
      return false;
    }

    const allocation: MemoryAllocation = {
      processId,
      size,
      type,
      address: this.findFreeAddress(size),
      allocated: true,
    };

    this.allocations.push(allocation);
    return true;
  }

  /**
   * Reallocate memory for a process
   */
  private static reallocateMemory(processId: number, newSize: number): void {
    this.deallocateMemory(processId);
    this.allocateMemory(processId, newSize, 'heap');
  }

  /**
   * Deallocate memory for a process
   */
  static deallocateMemory(processId: number): void {
    this.allocations = this.allocations.filter(alloc => {
      if (alloc.processId === processId) {
        alloc.allocated = false;
        return false;
      }
      return true;
    });
  }

  /**
   * Find a free memory address (simulated)
   */
  private static findFreeAddress(size: number): number {
    // Simplified address allocation - in reality this would be much more complex
    return Math.floor(Math.random() * 0xFFFFFFFF);
  }

  /**
   * Check if we can allocate the requested memory
   */
  static canAllocateMemory(size: number): boolean {
    const memInfo = this.getMemoryInfo();
    const availableMemory = memInfo.free + memInfo.swapFree * 0.5; // Swap is slower
    return availableMemory >= size;
  }

  /**
   * Get current memory information
   */
  static getMemoryInfo(): MemoryInfo {
    const usedMemory = this.allocations
      .filter(alloc => alloc.allocated)
      .reduce((total, alloc) => total + alloc.size, 0);

    const bufferCache = Math.floor(this.totalMemory * 0.15); // 15% for buffers/cache
    const actualUsed = usedMemory + bufferCache;
    const free = this.totalMemory - actualUsed;
    const fragmented = Math.floor(free * (this.memoryFragmentation / 100));
    const available = free - fragmented;

    // Simulate swap usage
    const swapUsed = Math.max(0, usedMemory - this.totalMemory * 0.8);
    const swapFree = this.totalSwap - swapUsed;

    return {
      total: this.totalMemory,
      used: actualUsed,
      free,
      available: Math.max(0, available),
      buffers: Math.floor(bufferCache * 0.3),
      cached: Math.floor(bufferCache * 0.7),
      swapTotal: this.totalSwap,
      swapUsed,
      swapFree,
    };
  }

  /**
   * Get all processes
   */
  static getProcesses(): Process[] {
    return Array.from(this.processes.values());
  }

  /**
   * Get process by PID
   */
  static getProcess(pid: number): Process | undefined {
    return this.processes.get(pid);
  }

  /**
   * Get processes by user
   */
  static getProcessesByUser(user: string): Process[] {
    return Array.from(this.processes.values()).filter(p => p.user === user);
  }

  /**
   * Set process priority (nice value)
   */
  static setProcessPriority(pid: number, priority: number): boolean {
    const process = this.processes.get(pid);
    if (!process) return false;

    // Limit priority range
    priority = Math.max(-20, Math.min(19, priority));
    process.priority = priority;

    // Adjust CPU usage based on priority
    const baseCpu = this.getBaseCpuUsage(process.name);
    const priorityFactor = (20 - priority) / 20; // Higher priority = more CPU
    process.cpu = baseCpu * priorityFactor;

    return true;
  }

  /**
   * Get memory usage by process
   */
  static getProcessMemoryUsage(pid: number): number {
    return this.allocations
      .filter(alloc => alloc.processId === pid && alloc.allocated)
      .reduce((total, alloc) => total + alloc.size, 0);
  }

  /**
   * Get system load average (simulated)
   */
  static getLoadAverage(): { one: number; five: number; fifteen: number } {
    const runningProcesses = Array.from(this.processes.values())
      .filter(p => p.status === 'running').length;

    const baseLoad = runningProcesses / 4; // Assume 4 cores

    return {
      one: Math.max(0, baseLoad + (Math.random() - 0.5) * 0.5),
      five: Math.max(0, baseLoad + (Math.random() - 0.5) * 0.3),
      fifteen: Math.max(0, baseLoad + (Math.random() - 0.5) * 0.2),
    };
  }

  /**
   * Get CPU usage by all processes
   */
  static getTotalCpuUsage(): number {
    return Array.from(this.processes.values())
      .reduce((total, process) => total + process.cpu, 0);
  }

  /**
   * Cleanup zombie processes
   */
  static cleanupZombies(): number {
    let cleaned = 0;
    for (const [pid, process] of this.processes) {
      if (process.status === 'zombie') {
        this.removeProcess(pid);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get memory fragmentation percentage
   */
  static getFragmentation(): number {
    return this.memoryFragmentation;
  }

  /**
   * Force garbage collection (defragmentation)
   */
  static defragmentMemory(): number {
    const oldFragmentation = this.memoryFragmentation;
    this.memoryFragmentation *= 0.1; // Reduce fragmentation to 10%

    // Simulate defrag time
    const freedMemory = Math.floor((oldFragmentation - this.memoryFragmentation) * this.totalMemory / 100);
    return freedMemory;
  }

  /**
   * Get detailed process information
   */
  static getProcessDetails(pid: number): any {
    const process = this.processes.get(pid);
    if (!process) return null;

    const memoryUsage = this.getProcessMemoryUsage(pid);
    const uptime = Date.now() - process.startTime;
    const allocations = this.allocations.filter(a => a.processId === pid && a.allocated);

    return {
      ...process,
      memoryUsage,
      uptime,
      allocations: allocations.length,
      memoryBreakdown: {
        heap: allocations.filter(a => a.type === 'heap').reduce((s, a) => s + a.size, 0),
        stack: allocations.filter(a => a.type === 'stack').reduce((s, a) => s + a.size, 0),
        data: allocations.filter(a => a.type === 'data').reduce((s, a) => s + a.size, 0),
        code: allocations.filter(a => a.type === 'code').reduce((s, a) => s + a.size, 0),
      }
    };
  }

  /**
   * Simulate out-of-memory condition
   */
  static triggerOOM(): void {
    // Find the process using the most memory (excluding critical system processes)
    const processes = Array.from(this.processes.values())
      .filter(p => p.pid > 3 && p.status === 'running')
      .sort((a, b) => b.memory - a.memory);

    if (processes.length > 0) {
      const victim = processes[0];
      this.killProcess(victim.pid, 'KILL');
    }
  }

  /**
   * Get system uptime
   */
  static getUptime(): number {
    const initProcess = this.processes.get(1);
    return initProcess ? Date.now() - initProcess.startTime : 0;
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
      return `${days}:${String(hours % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    } else if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    } else {
      return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
  }
}
