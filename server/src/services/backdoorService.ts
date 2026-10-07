import { EventEmitter } from "events";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, MEMORY_SERVICE } from "../di/tokens";
import { db } from "../database/client";
import { safeExecute } from "../utils/safeExecute";
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
    return await safeExecute({
      fn: async () => {
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

            try {
              const { getService } = await import("../di/container");
              const memory = getService<import("./memoryService").default>(MEMORY_SERVICE);
              const srv = await db.client.gameServer.findUnique({
                where: { id: serverId },
                select: { name: true },
              });
              memory.registerBackdoor(installerId, serverId, srv?.name ?? serverId);
            } catch (err) {
              this.logger.warn({ err, installerId, serverId }, "Could not register backdoor drain");
            }
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

        // Passive drain. `registerBackdoor` had ZERO callers, so a backdoor —
        // the most explicitly "persistent footprint" thing in the game — cost
        // its owner nothing to keep. Registered on BOTH the fresh-install and
        // upgrade paths because `addPassiveConsumer` is keyed by server and so
        // idempotent, and the in-memory consumer map is rebuilt empty on every
        // boot: an upgrade is the cheapest chance to re-register a backdoor
        // that predates the last restart.
        //
        // KNOWN GAP: backdoors that are never upgraded stay unregistered until
        // their next install. Restoring drains from the Backdoor table at boot
        // is the real fix and is a separate change.
        try {
          const { getService } = await import("../di/container");
          const memory = getService<import("./memoryService").default>(MEMORY_SERVICE);
          const srv = await db.client.gameServer.findUnique({
            where: { id: serverId },
            select: { name: true },
          });
          memory.registerBackdoor(installerId, serverId, srv?.name ?? serverId);
        } catch (err) {
          this.logger.warn({ err, installerId, serverId }, "Could not register backdoor drain");
        }
        this.emit("backdoor:installed", { installerId, serverId, type });

        return { success: true, backdoor };
      },
      context: "Install backdoor",
      logger: this.logger,
    })() ?? { success: false, error: "Failed to install backdoor" };
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
    return await safeExecute({
      fn: async () => {
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

          this.emit("backdoor:expired", {
            backdoorId: backdoor.id,
            serverId,
            installerId: userId,
          });
          await this.releaseBackdoorDrain(userId, serverId);

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
            installerId: userId,
            discoveredBy: "system",
          });

          // Deactivated above by `isActive: !discovered`, which is why this
          // site is easy to miss: it does not contain the literal
          // `isActive: false` that every other deactivation does. The drain
          // is unreachable afterwards — `getBackdoors` filters on
          // `isActive: true`, so the player cannot even see the backdoor to
          // remove it, and its cost follows them until the process restarts.
          await this.releaseBackdoorDrain(userId, serverId);

          return { success: true, accessLevel: backdoor.accessLevel, discovered: true };
        }

        this.logger.info(
          { backdoorId: backdoor.id, userId, serverId, detectionRisk: newDetectionRisk },
          "Backdoor used successfully",
        );

        return { success: true, accessLevel: backdoor.accessLevel, discovered: false };
      },
      context: "Use backdoor",
      logger: this.logger,
      fallback: { success: false, error: "Failed to use backdoor" } as { success: boolean; accessLevel?: number; discovered?: boolean; error?: string },
    })() as { success: boolean; accessLevel?: number; discovered?: boolean; error?: string };
  }

  // ==================== LISTING ====================

  /**
   * List all active backdoors belonging to a user, including related server
   * name and IP address.
   */
  async getBackdoors(userId: string): Promise<any[]> {
    return await safeExecute({
      fn: async () => {
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
      },
      context: "Retrieve backdoors",
      logger: this.logger,
      fallback: [] as any[],
    })() as any[];
  }

  // ==================== REMOVAL ====================

  /**
   * Manually remove (deactivate) a backdoor and clean traces.
   */
  async removeBackdoor(
    userId: string,
    serverId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return await safeExecute({
      fn: async () => {
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

        await this.releaseBackdoorDrain(userId, serverId);

        return { success: true };
      },
      context: "Remove backdoor",
      logger: this.logger,
      fallback: { success: false, error: "Failed to remove backdoor" } as { success: boolean; error?: string },
    })() as { success: boolean; error?: string };
  }

  /**
   * Deactivate all expired backdoors across the system.
   * Intended to be called periodically (e.g. via a cron / scheduler).
   */
  async cleanupExpired(): Promise<number> {
    return await safeExecute({
      fn: async () => {
        const now = new Date();

        // Fetch expired backdoors so we can emit events for each
        const expiredBackdoors = await db.client.backdoor.findMany({
          where: {
            isActive: true,
            expiresAt: { not: null, lte: now },
          },
          // `installerId` is selected so the drain can be released below —
          // without it this path cannot even identify whose resources to free.
          select: { id: true, serverId: true, installerId: true },
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

        // Emit individual expiry events and release each owner's drain.
        for (const expired of expiredBackdoors) {
          this.emit("backdoor:expired", {
            backdoorId: expired.id,
            serverId: expired.serverId,
            installerId: expired.installerId,
          });
          await this.releaseBackdoorDrain(expired.installerId, expired.serverId);
        }

        this.logger.info(
          { deactivated: result.count },
          "Cleaned up expired backdoors",
        );

        return result.count;
      },
      context: "Cleanup expired backdoors",
      logger: this.logger,
      fallback: 0,
    })() as number;
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
    return await safeExecute({
      fn: async () => {
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
              installerId: backdoor.installerId,
              discoveredBy: "scan",
            });
          }
        }

        this.logger.info(
          { serverId, scannerForensicsLevel, totalBackdoors: backdoors.length, discoveredCount: discovered.length },
          "Server scan completed",
        );

        return discovered;
      },
      context: "Scan for backdoors",
      logger: this.logger,
      fallback: [] as any[],
    })() as any[];
  }

  // ==================== DETECTED REMOVAL ====================

  /**
   * Deactivate a specific backdoor after it has been detected (e.g. via scan).
   */
  async removeDetectedBackdoor(
    backdoorId: string,
  ): Promise<{ success: boolean; error?: string }> {
    return await safeExecute({
      fn: async () => {
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

        await this.releaseBackdoorDrain(backdoor.installerId, backdoor.serverId);

        return { success: true };
      },
      context: "Remove detected backdoor",
      logger: this.logger,
      fallback: { success: false, error: "Failed to remove detected backdoor" } as { success: boolean; error?: string },
    })() as { success: boolean; error?: string };
  }

  // ==================== PRIVATE HELPERS ====================

  /**
   * Release a backdoor's passive resource drain.
   *
   * EVERY path that deactivates a backdoor must call this, not just the ones a
   * player triggers. The drain used to be reclaimed incidentally — session
   * teardown wiped a player's whole consumer map, backdoors included — and
   * once that was correctly narrowed to session-scoped consumers, the expiry
   * paths were the ones left holding a drain nothing would ever release. A
   * player who let backdoors expire paid their CPU/RAM/BW until the process
   * restarted, with no process in `ps` to kill.
   */
  private async releaseBackdoorDrain(installerId: string, serverId: string): Promise<void> {
    try {
      const { getService } = await import("../di/container");
      const memory = getService<import("./memoryService").default>(MEMORY_SERVICE);
      memory.unregisterBackdoor(installerId, serverId);
    } catch (err) {
      this.logger.warn({ err, installerId, serverId }, "Could not release backdoor drain");
    }
  }

  /**
   * Release the drains for every backdoor on these servers.
   *
   * CALL THIS BEFORE DELETING THE SERVERS. `Backdoor.server` is
   * `onDelete: Cascade`, so the rows vanish with the server and nothing can
   * afterwards say who was paying for them — the passive consumer is then
   * unreachable by every release path, including `removeBackdoor`, which
   * reports "No backdoor installed on this server" because the row is gone.
   *
   * The player-visible symptom is a permanent, unexplained resource cost after
   * a darknet dungeon regenerates: they hacked a box, installed a backdoor,
   * and the whole network was replaced on its TTL.
   */
  async releaseDrainsForServers(serverIds: string[]): Promise<void> {
    if (serverIds.length === 0) return;
    await safeExecute({
      fn: async () => {
        const doomed = await db.client.backdoor.findMany({
          where: { serverId: { in: serverIds } },
          select: { installerId: true, serverId: true },
        });
        for (const b of doomed) {
          await this.releaseBackdoorDrain(b.installerId, b.serverId);
        }
        if (doomed.length > 0) {
          this.logger.info(
            { servers: serverIds.length, drains: doomed.length },
            "Released backdoor drains ahead of server deletion",
          );
        }
      },
      context: "Release backdoor drains for deleted servers",
      logger: this.logger,
    })();
  }

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
    return await safeExecute({
      fn: async () => {
        const progress = await db.client.playerProgress.findUnique({
          where: { userId: installerId },
          select: { stealth: true },
        });
        return progress?.stealth ?? 0;
      },
      context: "Get installer stealth",
      logger: this.logger,
      silent: true,
      fallback: 0,
    })() as number;
  }
}

export default BackdoorService;
