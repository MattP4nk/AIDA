import { db } from "../database/client";
import { config } from "../config/environment";
import type { SaveTrigger, ProgressBackup } from "../types/game";
import { SavePriority } from "../types/game";
import { injectable, inject } from "tsyringe";
import { LOGGER } from "../di/tokens";
import type { Logger } from "pino";

@injectable()
class ProgressService {
  private saveQueue: Map<string, SaveTrigger>;
  private saveInterval: NodeJS.Timeout | null;
  private isSaving: boolean;
  private savesCompleted: number;
  private savesAttempted: number;
  private lastSaveTime: Date | null;

  constructor(@inject(LOGGER) private logger: Logger) {
    this.saveQueue = new Map();
    this.saveInterval = null;
    this.isSaving = false;
    this.savesCompleted = 0;
    this.savesAttempted = 0;
    this.lastSaveTime = null;

    this.logger.info("ProgressService initialized");
  }

  // ==================== INITIALIZATION ====================

  public start(): void {
    if (this.saveInterval) {
      this.logger.warn("ProgressService already running");
      return;
    }

    const intervalMs = (config.AUTO_SAVE_INTERVAL_SECONDS || 180) * 1000;

    this.saveInterval = setInterval(() => {
      this.processAutoSave();
    }, intervalMs);

    this.logger.info(
      { intervalSeconds: intervalMs / 1000 },
      "Progress auto-save started",
    );
  }

  public stop(): void {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
      this.saveInterval = null;
    }

    this.logger.info("Progress auto-save stopped");
  }

  // ==================== AUTO-SAVE ====================

  private async processAutoSave(): Promise<void> {
    if (this.isSaving) {
      this.logger.info("Save already in progress, skipping");
      return;
    }

    try {
      this.isSaving = true;

      const usersToSave = Array.from(this.saveQueue.keys());

      if (usersToSave.length === 0) {
        // Check for online users who haven't been queued
        const onlineUsers = await this.getOnlineUsers();
        if (onlineUsers.length > 0) {
          this.logger.info(
            { count: onlineUsers.length },
            "Queuing online users for auto-save",
          );
          onlineUsers.forEach((userId) => {
            this.queueSave(userId, "periodic");
          });
          return; // Will save on next interval
        }
        return;
      }

      this.logger.info({ count: usersToSave.length }, "Auto-saving progress for users");

      let successCount = 0;
      let errorCount = 0;

      for (const userId of usersToSave) {
        this.savesAttempted++;
        try {
          const trigger = this.saveQueue.get(userId);
          await this.savePlayerProgress(userId, trigger?.reason || "periodic");
          this.saveQueue.delete(userId);
          successCount++;
          this.savesCompleted++;
        } catch (error) {
          this.logger.error({ err: error, userId }, "Error saving progress for user");
          errorCount++;
        }
      }

      this.lastSaveTime = new Date();

      this.logger.info(
        { successCount, errorCount },
        "Auto-save complete",
      );
    } finally {
      this.isSaving = false;
    }
  }

  public queueSave(
    userId: string,
    reason: string = "manual",
    priority: SavePriority = SavePriority.NORMAL,
  ): void {
    const existingTrigger = this.saveQueue.get(userId);

    // If higher priority save is already queued, keep it
    if (
      existingTrigger &&
      this.getPriorityValue(existingTrigger.priority) >
        this.getPriorityValue(priority)
    ) {
      return;
    }

    this.saveQueue.set(userId, {
      userId,
      reason,
      timestamp: new Date(),
      priority,
    });

    this.logger.info(
      { userId, reason, priority },
      "Queued save for user",
    );

    // Immediate save for critical priority
    if (priority === SavePriority.IMMEDIATE) {
      this.savePlayerProgress(userId, reason).catch((error) => {
        this.logger.error({ err: error, userId }, "Immediate save failed for user");
      });
    }
  }

  private getPriorityValue(priority: SavePriority): number {
    const values = {
      [SavePriority.LOW]: 1,
      [SavePriority.NORMAL]: 2,
      [SavePriority.HIGH]: 3,
      [SavePriority.IMMEDIATE]: 4,
    };
    return values[priority] || 2;
  }

  // ==================== SAVE OPERATIONS ====================

  public async savePlayerProgress(
    userId: string,
    reason: string = "manual",
  ): Promise<boolean> {
    try {
      // Ensure player progress record exists
      const user = await db.client.user.findUnique({
        where: { id: userId },
        include: { progress: true },
      });

      if (!user) {
        this.logger.error({ userId }, "User not found");
        return false;
      }

      if (!user.progress) {
        await db.client.playerProgress.create({
          data: { userId },
        });
      }

      // Persist session directory to the latest UserSession so it survives
      // reconnects. The active session's currentDirectory is stored here.
      const activeSession = await db.client.userSession.findFirst({
        where: { userId, isActive: true },
        orderBy: { createdAt: "desc" },
      });

      if (activeSession) {
        await db.client.userSession.update({
          where: { id: activeSession.id },
          data: {
            lastServerId: activeSession.lastServerId,
          },
        });
      }

      this.logger.debug({ userId, reason }, "Progress checkpoint saved");
      return true;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error saving progress for user");
      return false;
    }
  }

  public async saveOnEvent(userId: string, eventType: string): Promise<void> {
    // Critical events that need immediate save
    const criticalEvents = [
      "mission_complete",
      "mission_failed",
      "level_up",
      "skill_upgrade",
      "hack_success",
      "server_purchase",
      "credits_change_large", // > 1000 credits
      "server_ownership_change",
      "faction_reputation_major", // > 10 rep change
    ];

    // High priority events
    const highPriorityEvents = [
      "hack_attempt",
      "file_created",
      "server_discovered",
      "message_sent",
      "item_purchased",
    ];

    if (criticalEvents.includes(eventType)) {
      // Immediate save for critical events
      this.queueSave(userId, eventType, SavePriority.IMMEDIATE);
    } else if (highPriorityEvents.includes(eventType)) {
      // High priority queue for important events
      this.queueSave(userId, eventType, SavePriority.HIGH);
    } else {
      // Normal priority for other events
      this.queueSave(userId, eventType, SavePriority.NORMAL);
    }
  }

  // ==================== BACKUP OPERATIONS ====================

  public async createBackup(
    userId: string,
    reason: string = "manual",
  ): Promise<ProgressBackup | null> {
    try {
      const user = await db.client.user.findUnique({
        where: { id: userId },
        include: {
          progress: true,
          ownedServers: {
            select: {
              id: true,
              name: true,
              ipAddress: true,
              type: true,
            },
          },
        },
      });

      if (!user) {
        this.logger.error({ userId }, "User not found for backup");
        return null;
      }

      const backupData = {
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          homeIp: user.homeIp,
          lastLogin: user.lastLogin,
        },
        progress: user.progress,
        servers: user.ownedServers,
        timestamp: new Date(),
        version: "1.0",
      };

      // Calculate checksum for data integrity
      const checksum = this.calculateChecksum(JSON.stringify(backupData));

      const backup: ProgressBackup = {
        id: `backup_${userId}_${Date.now()}`,
        userId,
        data: backupData,
        createdAt: new Date(),
        reason,
        checksum,
      };

      // Store backup in database
      await db.client.progressBackup.create({
        data: {
          userId,
          data: backupData,
          reason,
          checksum,
        },
      });

      // Clean up old backups to maintain retention policy
      await this.deleteOldBackups(userId, 5);

      this.logger.info({ userId, reason }, "Created backup for user");
      return backup;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error creating backup for user");
      return null;
    }
  }

  public async restoreBackup(
    userId: string,
    backupId: string,
  ): Promise<boolean> {
    try {
      // Fetch backup from database
      const backup = await db.client.progressBackup.findUnique({
        where: { id: backupId },
      });

      if (!backup) {
        this.logger.error({ backupId }, "Backup not found");
        return false;
      }

      if (backup.userId !== userId) {
        this.logger.error(
          { backupId, userId },
          "Backup does not belong to user",
        );
        return false;
      }

      // Verify checksum
      const currentChecksum = this.calculateChecksum(
        JSON.stringify(backup.data),
      );
      if (backup.checksum && currentChecksum !== backup.checksum) {
        this.logger.error(
          { backupId },
          "Checksum mismatch for backup - data may be corrupted",
        );
        return false;
      }

      const backupData = backup.data as any;

      // Restore progress data
      if (backupData.progress) {
        await db.client.playerProgress.update({
          where: { userId },
          data: {
            ...backupData.progress,
            userId, // Ensure userId is preserved
            updatedAt: new Date(),
          },
        });
      }

      this.logger.info(
        { backupId, userId },
        "Successfully restored backup for user",
      );
      return true;
    } catch (error) {
      this.logger.error({ err: error, backupId }, "Error restoring backup");
      return false;
    }
  }

  /**
   * Get all backups for a user
   */
  public async getBackups(
    userId: string,
    limit: number = 10,
  ): Promise<ProgressBackup[]> {
    try {
      const backups = await db.client.progressBackup.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      return backups as ProgressBackup[];
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error fetching backups for user");
      return [];
    }
  }

  /**
   * Delete old backups to maintain retention policy
   */
  public async deleteOldBackups(
    userId: string,
    keepCount: number = 5,
  ): Promise<number> {
    try {
      // Get all backups for user
      const backups = await db.client.progressBackup.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      });

      // If we have more than keepCount, delete the oldest ones
      if (backups.length <= keepCount) {
        return 0;
      }

      const backupsToDelete = backups.slice(keepCount);
      const idsToDelete = backupsToDelete.map((b) => b.id);

      const result = await db.client.progressBackup.deleteMany({
        where: {
          id: { in: idsToDelete },
        },
      });

      this.logger.info(
        { count: result.count, userId },
        "Deleted old backups for user",
      );
      return result.count;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Error deleting old backups for user",
      );
      return 0;
    }
  }

  private calculateChecksum(data: string): string {
    // Simple checksum calculation (in production, use crypto.createHash)
    let hash = 0;
    for (let i = 0; i < data.length; i++) {
      const char = data.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
  }

  // ==================== BATCH OPERATIONS ====================

  public async saveAll(reason: string = "shutdown"): Promise<void> {
    this.logger.info("Saving all player progress");

    try {
      const onlineUsers = await this.getOnlineUsers();

      this.logger.info({ count: onlineUsers.length }, "Found online users to save");

      let successCount = 0;
      let errorCount = 0;

      for (const userId of onlineUsers) {
        try {
          await this.savePlayerProgress(userId, reason);
          successCount++;
        } catch (error) {
          this.logger.error({ err: error, userId }, "Error saving user");
          errorCount++;
        }
      }

      this.logger.info(
        { successCount, errorCount },
        "Saved progress for users",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Error in saveAll");
    }
  }

  public async createBackupForAll(): Promise<number> {
    this.logger.info("Creating backups for all online users");

    try {
      const onlineUsers = await this.getOnlineUsers();

      let successCount = 0;

      for (const userId of onlineUsers) {
        const backup = await this.createBackup(userId, "batch_backup");
        if (backup) {
          successCount++;
        }
      }

      this.logger.info({ count: successCount }, "Created backups");
      return successCount;
    } catch (error) {
      this.logger.error({ err: error }, "Error creating backups");
      return 0;
    }
  }

  // ==================== UTILITY METHODS ====================

  private async getOnlineUsers(): Promise<string[]> {
    try {
      const users = await db.client.user.findMany({
        where: { isOnline: true },
        select: { id: true },
      });

      return users.map((user) => user.id);
    } catch (error) {
      this.logger.error({ err: error }, "Error getting online users");
      return [];
    }
  }

  public getQueueSize(): number {
    return this.saveQueue.size;
  }

  public isRunning(): boolean {
    return this.saveInterval !== null;
  }

  public getStats() {
    return {
      queueSize: this.saveQueue.size,
      isRunning: this.isRunning(),
      isSaving: this.isSaving,
      savesCompleted: this.savesCompleted,
      savesAttempted: this.savesAttempted,
      successRate:
        this.savesAttempted > 0
          ? ((this.savesCompleted / this.savesAttempted) * 100).toFixed(2) + "%"
          : "N/A",
      lastSaveTime: this.lastSaveTime,
    };
  }

  public logStats(): void {
    const stats = this.getStats();
    this.logger.info({
      queueSize: stats.queueSize,
      isRunning: stats.isRunning,
      savesCompleted: stats.savesCompleted,
      successRate: stats.successRate,
    }, "ProgressService Stats");
  }

  // ==================== MAINTENANCE ====================

  public clearQueue(): void {
    const size = this.saveQueue.size;
    this.saveQueue.clear();
    this.logger.info({ itemsRemoved: size }, "Cleared save queue");
  }

  public async forceSaveUser(userId: string): Promise<boolean> {
    this.logger.info({ userId }, "Force saving user");
    return await this.savePlayerProgress(userId, "force_save");
  }

  public async validateUserProgress(userId: string): Promise<boolean> {
    try {
      const user = await db.client.user.findUnique({
        where: { id: userId },
        include: {
          progress: true,
        },
      });

      if (!user) {
        this.logger.error({ userId }, "User not found");
        return false;
      }

      if (!user.progress) {
        this.logger.error({ userId }, "No progress found for user");
        return false;
      }

      // Validate progress data
      const progress = user.progress;

      const isValid =
        progress.level >= 1 &&
        progress.experience >= 0 &&
        progress.credits >= 0 &&
        progress.hacking >= 0 &&
        progress.hacking <= 100 &&
        progress.networking >= 0 &&
        progress.networking <= 100 &&
        progress.cryptography >= 0 &&
        progress.cryptography <= 100 &&
        progress.stealth >= 0 &&
        progress.stealth <= 100 &&
        progress.socialEng >= 0 &&
        progress.socialEng <= 100 &&
        progress.forensics >= 0 &&
        progress.forensics <= 100;

      if (!isValid) {
        this.logger.error({ userId }, "Invalid progress data for user");
      }

      return isValid;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error validating progress for user");
      return false;
    }
  }

  public resetStats(): void {
    this.savesCompleted = 0;
    this.savesAttempted = 0;
    this.lastSaveTime = null;
    this.logger.info("ProgressService stats reset");
  }

  // ==================== CLEANUP ====================

  public async cleanup(): Promise<void> {
    this.logger.info("Cleaning up ProgressService");

    // Stop the interval
    this.stop();

    // Save all remaining queued users
    if (this.saveQueue.size > 0) {
      this.logger.info(
        { queueSize: this.saveQueue.size },
        "Saving queued users before cleanup",
      );
      await this.processAutoSave();
    }

    // Clear the queue
    this.clearQueue();

    this.logger.info("ProgressService cleanup complete");
  }
}

export default ProgressService;
