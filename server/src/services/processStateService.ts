import { EventEmitter } from "events";
import { CommandResult } from "../../../shared/types";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";

/**
 * ProcessStateService - Manages command execution state and process lifecycle
 *
 * Tracks active command processes, handles cancellation, and reports progress.
 * Integrates with memoryService to create visible processes for long-running commands.
 */

export interface CommandProcess {
  pid: number;
  sessionId: string;
  userId: string;
  command: string;
  args: string[];
  targetInfo?: string | undefined; // e.g., "192.168.1.1" for hack commands
  startTime: number;
  estimatedDuration: number; // in milliseconds
  progress: number; // 0-100
  status: "running" | "paused" | "completed" | "cancelled" | "failed";
  cancellable: boolean;
  onCancel?: (() => Promise<void>) | undefined;
  onComplete?: ((result: CommandResult) => void) | undefined;
  onProgress?: ((progress: number) => void) | undefined;
  metadata?: Record<string, any> | undefined;
}

export interface ProcessProgressUpdate {
  pid: number;
  progress: number;
  message?: string;
  estimatedTimeRemaining?: number;
}

export interface ProcessRegistrationOptions {
  command: string;
  args: string[];
  estimatedDuration: number;
  targetInfo?: string;
  cancellable?: boolean;
  onCancel?: () => Promise<void>;
  onProgress?: (progress: number) => void;
  metadata?: Record<string, any>;
}

@injectable()
class ProcessStateService extends EventEmitter {
  private processes: Map<number, CommandProcess> = new Map();
  private pendingCleanups: Map<number, NodeJS.Timeout> = new Map();

  constructor(@inject(LOGGER) private logger: Logger) {
    super();
    this.logger.info("Process State Service initialized");
  }

  /**
   * Register a new command process
   */
  registerProcess(
    pid: number,
    sessionId: string,
    userId: string,
    options: ProcessRegistrationOptions,
  ): void {
    const process: CommandProcess = {
      pid,
      sessionId,
      userId,
      command: options.command,
      args: options.args,
      targetInfo: options.targetInfo,
      startTime: Date.now(),
      estimatedDuration: options.estimatedDuration,
      progress: 0,
      status: "running",
      cancellable: options.cancellable ?? true,
      onCancel: options.onCancel,
      onProgress: options.onProgress,
      metadata: options.metadata,
    };

    this.processes.set(pid, process);
    this.emit("process:registered", { pid, sessionId, command: options.command });
  }

  /**
   * Update process progress
   */
  updateProgress(
    pid: number,
    progress: number,
    message?: string,
  ): boolean {
    const process = this.processes.get(pid);
    if (!process) return false;

    process.progress = Math.max(0, Math.min(100, progress));

    // Call progress callback if registered
    if (process.onProgress) {
      process.onProgress(process.progress);
    }

    const estimatedTimeRemaining =
      process.estimatedDuration * ((100 - progress) / 100);

    this.emit("process:progress", {
      pid,
      progress: process.progress,
      message,
      estimatedTimeRemaining,
    } as ProcessProgressUpdate);

    return true;
  }

  /**
   * Cancel a process
   */
  async cancelProcess(pid: number): Promise<boolean> {
    const process = this.processes.get(pid);
    if (!process) return false;

    if (!process.cancellable) {
      throw new Error("Process is not cancellable");
    }

    if (process.status !== "running") {
      return false;
    }

    process.status = "cancelled";

    // Call cancel handler if registered
    if (process.onCancel) {
      await safeExecute({
        fn: () => process.onCancel!(),
        context: "Process cancel handler",
        logger: this.logger,
      })();
    }

    this.emit("process:cancelled", { pid, sessionId: process.sessionId });
    return true;
  }

  /**
   * Mark process as completed
   */
  completeProcess(pid: number, result: CommandResult): void {
    const process = this.processes.get(pid);
    if (!process) return;

    process.status = "completed";
    process.progress = 100;

    if (process.onComplete) {
      process.onComplete(result);
    }

    this.emit("process:completed", {
      pid,
      sessionId: process.sessionId,
      success: result.success,
    });

    // Clean up after a delay to allow status to be read
    const timer = setTimeout(() => {
      this.processes.delete(pid);
      this.pendingCleanups.delete(pid);
    }, 5000);
    this.pendingCleanups.set(pid, timer);
  }

  /**
   * Mark process as failed
   */
  failProcess(pid: number, error: string): void {
    const process = this.processes.get(pid);
    if (!process) return;

    process.status = "failed";

    this.emit("process:failed", {
      pid,
      sessionId: process.sessionId,
      error,
    });

    // Clean up after a delay
    const timer = setTimeout(() => {
      this.processes.delete(pid);
      this.pendingCleanups.delete(pid);
    }, 5000);
    this.pendingCleanups.set(pid, timer);
  }

  /**
   * Get process by PID
   */
  getProcess(pid: number): CommandProcess | undefined {
    return this.processes.get(pid);
  }

  /**
   * Get all processes for a session
   */
  getSessionProcesses(sessionId: string): CommandProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.sessionId === sessionId,
    );
  }

  /**
   * Get all processes for a user
   */
  getUserProcesses(userId: string): CommandProcess[] {
    return Array.from(this.processes.values()).filter(
      (p) => p.userId === userId,
    );
  }

  /**
   * Check if a PID is tracked
   */
  isTracked(pid: number): boolean {
    return this.processes.has(pid);
  }

  /**
   * Clean up processes for a session
   */
  cleanupSession(sessionId: string): void {
    const sessionProcesses = this.getSessionProcesses(sessionId);

    for (const process of sessionProcesses) {
      // Cancel any pending delayed cleanup timer
      const pendingTimer = this.pendingCleanups.get(process.pid);
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        this.pendingCleanups.delete(process.pid);
      }
      if (process.cancellable) {
        this.cancelProcess(process.pid).catch((err) => {
          this.logger.error({ err, pid: process.pid }, "Error cancelling process");
        });
      }
      this.processes.delete(process.pid);
    }

    this.emit("session:cleaned", { sessionId });
  }

  /**
   * Get process statistics
   */
  getStats(): {
    total: number;
    running: number;
    completed: number;
    cancelled: number;
    failed: number;
  } {
    const processes = Array.from(this.processes.values());

    return {
      total: processes.length,
      running: processes.filter((p) => p.status === "running").length,
      completed: processes.filter((p) => p.status === "completed").length,
      cancelled: processes.filter((p) => p.status === "cancelled").length,
      failed: processes.filter((p) => p.status === "failed").length,
    };
  }

  /**
   * Format estimated time remaining
   */
  static formatTimeRemaining(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

export default ProcessStateService;
