import { EventEmitter } from "events";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";
import { db } from "../database/client";
import {
  BACKDOOR_INITIAL_RISK,
  BACKDOOR_DISCOVERY_THRESHOLD,
  getBackdoorDuration,
  getBackdoorDetectionIncrement,
} from "../config/gameBalance";

/**
 * BackdoorService - Manages persistent backdoors on hacked servers
 *
 * Features:
 * - Install/upgrade backdoors with varying types and persistence
 * - Use backdoors to access servers with escalating detection risk
 * - Scan servers for installed backdoors (forensics-based)
 * - Automatic expiration cleanup
 * - Event-driven notifications for installs, discoveries, and expirations
 */
@injectable()
export class BackdoorService extends EventEmitter {
  /** Initial detection risk by backdoor type — from gameBalance */
  private readonly INITIAL_DETECTION_RISK = BACKDOOR_INITIAL_RISK;

  /** Discovery threshold — from gameBalance */
  private readonly DISCOVERY_THRESHOLD = BACKDOOR_DISCOVERY_THRESHOLD;

  constructor(@inject(LOGGER) private logger: Logger) {
    super();
  }

  // ==================== BACKDOOR INSTALLATION ====================

  /**
   * Install or upgrade a backdoor on a target server.
   *
   * - Determines type from the hack method used.
   * - If one already exists for the same installer+server and the new access
   *   level is higher, the existing record is upgraded in-place.
   * - Returns the created/upgraded backdoor and status flags.
   */
  async installBackdoor(
    installerId: string,
    serverId: string,
    accessLevel: number,
    method: string,
    tools: string[],
  ): Promise<{
    success: boolean;
    backdoor?: any;
    upgraded?: boolean;
    error?: string;
  }> {
    try {
      const type = this.resolveBackdoorType(method);
      const stealthSkill = await this.getInstallerStealth(installerId);
      const expiresAt = this.calculateExpiration(type, stealthSkill);
      const detectionRisk = this.INITIAL_DETECTION_RISK[type] ?? 20;

      this.logger.info(
        { installerId, serverId, type, accessLevel, method, tools },
        "Attempting backdoor installation",
      );

      // Check for an existing backdoor from this installer on this server
      const existing = await db.client.backdoor.findUnique({
        where: {
          installerId_serverId: { installerId, serverId },
        },
      });

      if (existing) {
        // Upgrade path — only if the new access level exceeds the current one
        if (accessLevel > existing.accessLevel) {
          const upgraded = await db.client.backdoor.update({
            where: { id: existing.id },
            data: {
              accessLevel,
              type,
              isActive: true,
              detectionRisk, // reset to new type's base risk on upgrade
              expiresAt,
              metadata: {
                method,
                tools,
                upgradedAt: new Date().toISOString(),
                previousAccessLevel: existing.accessLevel,
              },
            },
          });

          this.logger.info(
            {
              backdoorId: upgraded.id,
              installerId,
              serverId,
              oldAccessLevel: existing.accessLevel,
              newAccessLevel: accessLevel,
              type,
            },
            "Backdoor upgraded",
          );

          this.emit("backdoor:installed", { installerId, serverId, type });

          return { success: true, backdoor: upgraded, upgraded: true };
        }

        // Already exists with equal or higher access — no change needed
        this.logger.info(
          { installerId, serverId, existingAccessLevel: existing.accessLevel, requestedAccessLevel: accessLevel },
          "Backdoor already exists with equal or higher access level",
        );

        return { success: true, backdoor: existing, upgraded: false };
      }

      // Fresh install
      const backdoor = await db.client.backdoor.create({
        data: {
          installerId,
          serverId,
          accessLevel,
          type,
          isActive: true,
          detectionRisk,
          expiresAt,
          metadata: {
            method,
            tools,
            installedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.info(
        { backdoorId: backdoor.id, installerId, serverId, type, accessLevel, detectionRisk },
        "Backdoor installed successfully",
      );

      this.emit("backdoor:installed", { installerId, serverId, type });

      return { success: true, backdoor };
    } catch (error) {
      this.logger.error(
        { err: error, installerId, serverId, accessLevel, method },
        "Failed to install backdoor",
      );
      return { success: false, error: "Failed to install backdoor" };
    }
  }

  // ==================== BACKDOOR USAGE ====================

  /**
   * Use an existing active backdoor to access a server.
   *
   * Each use increments detection risk by 5. When the risk exceeds 75 there is
   * a random chance (risk / 100) that the backdoor is discovered and
   * automatically deactivated.
   */
  async useBackdoor(
    userId: string,
    serverId: string,
  ): Promise<{
    success: boolean;
    accessLevel?: number;
    discovered?: boolean;
    error?: string;
  }> {
    try {
      const backdoor = await db.client.backdoor.findUnique({
        where: {
          installerId_serverId: { installerId: userId, serverId },
        },
      });

      if (!backdoor) {
        this.logger.warn({ userId, serverId }, "No backdoor found for this user/server pair");
        return { success: false, error: "No backdoor installed on this server" };
      }

      if (!backdoor.isActive) {
        this.logger.warn({ userId, serverId, backdoorId: backdoor.id }, "Attempted to use inactive backdoor");
        return { success: false, error: "Backdoor is no longer active" };
      }

      // Check expiration
      if (backdoor.expiresAt && backdoor.expiresAt < new Date()) {
        await db.client.backdoor.update({
          where: { id: backdoor.id },
          data: { isActive: false },
        });

        this.logger.info(
          { backdoorId: backdoor.id, serverId },
          "Backdoor expired on use attempt",
        );

        this.emit("backdoor:expired", { backdoorId: backdoor.id, serverId });

        return { success: false, error: "Backdoor has expired" };
      }

      // Increment detection risk
      // Skill-scaled detection increment — higher stealth = smaller increment
      const stealthSkill = await this.getInstallerStealth(backdoor.installerId);
      const increment = getBackdoorDetectionIncrement(stealthSkill);
      const newDetectionRisk = Math.min(100, backdoor.detectionRisk + increment);

      // Discovery check — only triggers when risk exceeds threshold
      let discovered = false;
      if (newDetectionRisk > this.DISCOVERY_THRESHOLD) {
        const discoveryRoll = Math.random();
        if (discoveryRoll < newDetectionRisk / 100) {
          discovered = true;
        }
      }

      // Update the backdoor record
      await db.client.backdoor.update({
        where: { id: backdoor.id },
        data: {
          detectionRisk: newDetectionRisk,
          lastUsed: new Date(),
          isActive: !discovered,
        },
      });

      if (discovered) {
        this.logger.warn(
          { backdoorId: backdoor.id, userId, serverId, detectionRisk: newDetectionRisk },
          "Backdoor discovered during use — deactivated",
        );

        this.emit("backdoor:discovered", {
          backdoorId: backdoor.id,
          serverId,
          discoveredBy: "system",
        });

        return { success: true, accessLevel: backdoor.accessLevel, discovered: true };
      }

      this.logger.info(
        { backdoorId: backdoor.id, userId, serverId, detectionRisk: newDetectionRisk },
        "Backdoor used successfully",
      );

      return { success: true, accessLevel: backdoor.accessLevel, discovered: false };
    } catch (error) {
      this.logger.error(
        { err: error, userId, serverId },
        "Failed to use backdoor",
      );
      return { success: false, error: "Failed to use backdoor" };
    }
  }

  // ==================== LISTING ====================

  /**
   * List all active backdoors belonging to a user, including related server
   * name and IP address.
   */
  async getBackdoors(userId: string): Promise<any[]> {
    try {
      const backdoors = await db.client.backdoor.findMany({
        where: {
          installerId: userId,
          isActive: true,
        },
        include: {
          server: {
            select: {
              name: true,
              ipAddress: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      this.logger.info(
        { userId, count: backdoors.length },
        "Retrieved active backdoors for user",
      );

      return backdoors;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Failed to retrieve backdoors",
      );
      return [];
    }
  }

  // ==================== REMOVAL ====================

  /**
   * Manually remove (deactivate) a backdoor and clean traces.
   */
  async removeBackdoor(
    userId: string,
    serverId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const backdoor = await db.client.backdoor.findUnique({
        where: {
          installerId_serverId: { installerId: userId, serverId },
        },
      });

      if (!backdoor) {
        this.logger.warn({ userId, serverId }, "No backdoor found to remove");
        return { success: false, error: "No backdoor found on this server" };
      }

      await db.client.backdoor.update({
        where: { id: backdoor.id },
        data: { isActive: false },
      });

      this.logger.info(
        { backdoorId: backdoor.id, userId, serverId },
        "Backdoor manually removed",
      );

      return { success: true };
    } catch (error) {
      this.logger.error(
        { err: error, userId, serverId },
        "Failed to remove backdoor",
      );
      return { success: false, error: "Failed to remove backdoor" };
    }
  }

  /**
   * Deactivate all expired backdoors across the system.
   * Intended to be called periodically (e.g. via a cron / scheduler).
   */
  async cleanupExpired(): Promise<number> {
    try {
      const now = new Date();

      // Fetch expired backdoors so we can emit events for each
      const expiredBackdoors = await db.client.backdoor.findMany({
        where: {
          isActive: true,
          expiresAt: { not: null, lte: now },
        },
        select: { id: true, serverId: true },
      });

      if (expiredBackdoors.length === 0) {
        return 0;
      }

      // Bulk deactivate
      const result = await db.client.backdoor.updateMany({
        where: {
          isActive: true,
          expiresAt: { not: null, lte: now },
        },
        data: { isActive: false },
      });

      // Emit individual expiry events
      for (const expired of expiredBackdoors) {
        this.emit("backdoor:expired", {
          backdoorId: expired.id,
          serverId: expired.serverId,
        });
      }

      this.logger.info(
        { deactivated: result.count },
        "Cleaned up expired backdoors",
      );

      return result.count;
    } catch (error) {
      this.logger.error({ err: error }, "Failed to cleanup expired backdoors");
      return 0;
    }
  }

  // ==================== SCANNING ====================

  /**
   * Scan a server for backdoors. The scanner's forensics level determines
   * which backdoors can be found.
   *
   * A backdoor is discovered when:
   *   forensicsLevel * 10 > (100 - backdoor.detectionRisk)
   *
   * Higher detection risk on the backdoor makes it easier to find;
   * higher forensics level on the scanner casts a wider net.
   */
  async scanForBackdoors(
    serverId: string,
    scannerForensicsLevel: number,
  ): Promise<any[]> {
    try {
      const backdoors = await db.client.backdoor.findMany({
        where: {
          serverId,
          isActive: true,
        },
        include: {
          installer: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (backdoors.length === 0) {
        this.logger.info({ serverId, scannerForensicsLevel }, "Scan complete — no active backdoors on server");
        return [];
      }

      const discovered: any[] = [];

      for (const backdoor of backdoors) {
        const threshold = 100 - backdoor.detectionRisk;
        const scanPower = scannerForensicsLevel * 10;

        if (scanPower > threshold) {
          discovered.push(backdoor);

          this.logger.info(
            {
              backdoorId: backdoor.id,
              serverId,
              detectionRisk: backdoor.detectionRisk,
              scannerForensicsLevel,
              scanPower,
              threshold,
            },
            "Backdoor discovered during scan",
          );

          this.emit("backdoor:discovered", {
            backdoorId: backdoor.id,
            serverId,
            discoveredBy: "scan",
          });
        }
      }

      this.logger.info(
        { serverId, scannerForensicsLevel, totalBackdoors: backdoors.length, discoveredCount: discovered.length },
        "Server scan completed",
      );

      return discovered;
    } catch (error) {
      this.logger.error(
        { err: error, serverId, scannerForensicsLevel },
        "Failed to scan for backdoors",
      );
      return [];
    }
  }

  // ==================== DETECTED REMOVAL ====================

  /**
   * Deactivate a specific backdoor after it has been detected (e.g. via scan).
   */
  async removeDetectedBackdoor(
    backdoorId: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const backdoor = await db.client.backdoor.findUnique({
        where: { id: backdoorId },
      });

      if (!backdoor) {
        this.logger.warn({ backdoorId }, "Detected backdoor not found");
        return { success: false, error: "Backdoor not found" };
      }

      if (!backdoor.isActive) {
        this.logger.info({ backdoorId }, "Detected backdoor already inactive");
        return { success: true };
      }

      await db.client.backdoor.update({
        where: { id: backdoorId },
        data: { isActive: false },
      });

      this.logger.info(
        { backdoorId, serverId: backdoor.serverId, installerId: backdoor.installerId },
        "Detected backdoor removed",
      );

      return { success: true };
    } catch (error) {
      this.logger.error(
        { err: error, backdoorId },
        "Failed to remove detected backdoor",
      );
      return { success: false, error: "Failed to remove detected backdoor" };
    }
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Map a hack method string to a backdoor type.
   */
  private resolveBackdoorType(method: string): string {
    const normalized = method.toLowerCase();
    if (normalized === "rootkit") return "rootkit";
    if (normalized === "backdoor") return "persistent";
    return "standard";
  }

  /**
   * Calculate the expiration date based on backdoor type and installer's stealth.
   * Returns null for permanent (rootkit) backdoors.
   * Higher stealth = longer duration.
   */
  private calculateExpiration(type: string, stealthSkill: number = 0): Date | null {
    const hours = getBackdoorDuration(type, stealthSkill);
    if (hours === null) return null;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  /** Helper to fetch the installer's stealth skill for scaling. */
  private async getInstallerStealth(installerId: string): Promise<number> {
    try {
      const progress = await db.client.playerProgress.findUnique({
        where: { userId: installerId },
        select: { stealth: true },
      });
      return progress?.stealth ?? 0;
    } catch {
      return 0;
    }
  }
}

export default BackdoorService;
