import { EventEmitter } from "events";
import { db } from "../database/client";
import type { HackAttempt, HackResult, HackCalculation } from "../types/game";
import { HackMethod } from "../types/game";
import { progressService } from "./progressService";

/**
 * Enhanced HackService - Complete PvP hacking mechanics
 *
 * Features:
 * - Skill-based success calculations
 * - Stealth mechanics and detection probability
 * - Evidence generation and traces
 * - Countermeasures and defense systems
 * - Alert and notification system
 * - Cooldown management
 * - Real-time event broadcasting
 */
class HackService extends EventEmitter {
  private cooldowns: Map<string, Date>;
  private activeHacks: Map<string, HackAttempt>;
  private readonly COOLDOWN_SECONDS = 30;
  private readonly BASE_DETECTION_RATE = 0.3;
  private readonly BASE_SUCCESS_RATE = 0.5;

  // Hack method difficulty multipliers
  private readonly METHOD_DIFFICULTY: Record<HackMethod, number> = {
    [HackMethod.BRUTEFORCE]: 1.0,
    [HackMethod.EXPLOIT]: 1.5,
    [HackMethod.SOCIAL]: 1.2,
    [HackMethod.BACKDOOR]: 2.0,
    [HackMethod.SQL_INJECTION]: 1.3,
    [HackMethod.PHISHING]: 1.1,
  };

  // Tool effectiveness ratings
  private readonly TOOL_EFFECTIVENESS: Record<string, number> = {
    // Basic tools
    scanner: 0.1,
    portscanner: 0.15,
    passwordcracker: 0.2,
    keylogger: 0.25,

    // Intermediate tools
    exploitkit: 0.35,
    rootkit: 0.4,
    proxychains: 0.3,
    vpn: 0.25,

    // Advanced tools
    zero_day: 0.5,
    custom_backdoor: 0.45,
    advanced_stealth: 0.4,
    encryption_breaker: 0.35,

    // Stealth tools
    anonymizer: 0.2,
    trace_remover: 0.3,
    log_cleaner: 0.25,
  };

  constructor() {
    super();
    this.cooldowns = new Map();
    this.activeHacks = new Map();

    console.log("🔓 Enhanced HackService initialized");
  }

  // ==================== MAIN HACK PROCESSING ====================

  /**
   * Process a complete hack attempt
   */
  public async processHackAttempt(
    attackerId: string,
    targetId: string,
    targetServerId: string,
    method: HackMethod,
    tools: string[],
  ): Promise<HackResult> {
    const startTime = Date.now();

    try {
      // 1. Validate the hack attempt
      const validation = await this.validateHackAttempt(
        attackerId,
        targetId,
        targetServerId,
      );
      if (!validation.valid) {
        return {
          success: false,
          detected: false,
          accessLevel: 0,
          discoveredFiles: [],
          evidenceLeft: 0,
          counterMeasures: [],
          message: validation.error || "Hack attempt invalid",
          traceInitiated: false,
        };
      }

      // 2. Check cooldown
      if (this.isOnCooldown(attackerId)) {
        const remainingTime = this.getRemainingCooldown(attackerId);
        return {
          success: false,
          detected: false,
          accessLevel: 0,
          discoveredFiles: [],
          evidenceLeft: 0,
          counterMeasures: [],
          message: `Cooldown active. Wait ${remainingTime}s before next attempt.`,
          traceInitiated: false,
        };
      }

      // 3. Get attacker and target data
      const attacker = await db.client.user.findUnique({
        where: { id: attackerId },
        include: { progress: true },
      });

      const target = await db.client.user.findUnique({
        where: { id: targetId },
        include: { progress: true },
      });

      const server = await db.client.gameServer.findUnique({
        where: { id: targetServerId },
      });

      if (!attacker || !target || !server) {
        return {
          success: false,
          detected: false,
          accessLevel: 0,
          discoveredFiles: [],
          evidenceLeft: 0,
          counterMeasures: [],
          message: "Invalid attacker, target, or server",
          traceInitiated: false,
        };
      }

      // 4. Calculate hack parameters
      const calculation = await this.calculateHackParameters(
        attacker.progress!,
        target.progress!,
        server,
        method,
        tools,
      );

      // 5. Determine success
      const success = Math.random() < calculation.successRate;

      // 6. Determine detection
      const detected = Math.random() < calculation.detectionRate;

      // 7. Calculate evidence left
      const evidenceLeft = this.calculateEvidence(
        calculation,
        success,
        detected,
        tools,
      );

      // 8. Get access level and discovered files
      let accessLevel = 0;
      let discoveredFiles: string[] = [];
      if (success) {
        accessLevel = calculation.accessLevel;
        discoveredFiles = await this.discoverFiles(targetServerId, accessLevel);
      }

      // 9. Trigger countermeasures if detected
      let counterMeasures: string[] = [];
      let traceInitiated = false;
      if (detected) {
        counterMeasures = await this.triggerCounterMeasures(
          targetServerId,
          evidenceLeft,
          target.id,
        );
        traceInitiated = evidenceLeft > 70;
      }

      // 10. Create hack attempt record
      const hackAttempt: HackAttempt = {
        attackerId,
        targetId,
        targetServerId,
        targetIp: server.ipAddress,
        method,
        tools,
        stealthLevel: this.calculateStealthLevel(tools),
        timestamp: new Date(),
      };

      // 11. Build result
      const result: HackResult = {
        success,
        detected,
        accessLevel,
        discoveredFiles,
        evidenceLeft,
        counterMeasures,
        message: this.generateResultMessage(
          success,
          detected,
          accessLevel,
          traceInitiated,
        ),
        traceInitiated,
      };

      // 12. Log to database (async)
      this.logHackAttempt(hackAttempt, result).catch((err) =>
        console.error("Failed to log hack:", err),
      );

      // 13. Update statistics
      await this.updateHackStatistics(attackerId, targetId, success);

      // 14. Apply cooldown
      this.applyCooldown(attackerId);

      // 15. Emit events
      this.emit("hack:attempt", { attackerId, targetId, result });
      if (detected) {
        this.emit("hack:detected", {
          attackerId,
          targetId,
          evidenceLeft,
          traceInitiated,
        });
      }

      // 16. Trigger progress saves
      progressService.saveOnEvent(attackerId, "hack_attempt");
      if (success) {
        progressService.saveOnEvent(attackerId, "hack_success");
      }

      // 17. Award experience and skill gains
      await this.awardExperience(attackerId, success, calculation.successRate);

      const executionTime = Date.now() - startTime;
      console.log(
        `🔓 Hack attempt completed in ${executionTime}ms: ${attackerId} -> ${targetId} (${success ? "SUCCESS" : "FAILED"})`,
      );

      // ==================== CROSS-SERVICE INTEGRATION ====================

      // 1. Trigger security alert on target server (HackService → ServerService)
      if (detected) {
        try {
          const ServerService = (await import("./serverService")).default;
          const serverService = ServerService.getInstance();
          await serverService.triggerSecurityAlert(
            targetServerId,
            attackerId,
            success ? "hack_successful" : "hack_detected",
          );
        } catch (error) {
          console.error("Failed to trigger security alert:", error);
        }
      }

      // 2. Log hack event for mission tracking (future integration)
      // Note: Mission objective updates require active mission lookup
      // This would be implemented when mission-hack tracking is needed
      console.log(
        `Hack event logged for potential mission tracking: ${attackerId} -> ${targetServerId} (${success ? "success" : "failed"})`,
      );

      return result;
    } catch (error) {
      console.error("Hack processing error:", error);
      return {
        success: false,
        detected: true,
        accessLevel: 0,
        discoveredFiles: [],
        evidenceLeft: 100,
        counterMeasures: ["system_error"],
        message: "Hack failed due to system error",
        traceInitiated: false,
      };
    }
  }

  // ==================== VALIDATION ====================

  /**
   * Validate hack attempt prerequisites
   */
  private async validateHackAttempt(
    attackerId: string,
    targetId: string,
    targetServerId: string,
  ): Promise<{ valid: boolean; error?: string }> {
    try {
      // Cannot hack yourself
      if (attackerId === targetId) {
        return { valid: false, error: "Cannot hack your own servers" };
      }

      // Check if attacker exists and has skills
      const attacker = await db.client.user.findUnique({
        where: { id: attackerId },
        include: { progress: true },
      });

      if (!attacker || !attacker.progress) {
        return { valid: false, error: "Attacker not found" };
      }

      // Check minimum skill requirement
      if (attacker.progress.hacking < 10) {
        return {
          valid: false,
          error: "Insufficient hacking skill (minimum: 10)",
        };
      }

      // Check if target exists
      const target = await db.client.user.findUnique({
        where: { id: targetId },
      });

      if (!target) {
        return { valid: false, error: "Target not found" };
      }

      // Check if server exists and belongs to target
      const server = await db.client.gameServer.findUnique({
        where: { id: targetServerId },
      });

      if (!server) {
        return { valid: false, error: "Target server not found" };
      }

      if (server.ownerId !== targetId) {
        return {
          valid: false,
          error: "Server does not belong to target user",
        };
      }

      return { valid: true };
    } catch (error) {
      console.error("Validation error:", error);
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Validation failed",
      };
    }
  }

  // ==================== CALCULATIONS ====================

  /**
   * Calculate all hack parameters (success rate, detection rate, etc.)
   */
  private async calculateHackParameters(
    attackerProgress: any,
    targetProgress: any,
    targetServer: any,
    method: HackMethod,
    tools: string[],
  ): Promise<HackCalculation> {
    // 1. Get base rates
    let successRate = this.BASE_SUCCESS_RATE;
    let detectionRate = this.BASE_DETECTION_RATE;

    // 2. Apply attacker skill bonuses
    const hackingSkill = attackerProgress.hacking / 100; // 0-1
    const stealthSkill = attackerProgress.stealth / 100;

    successRate += hackingSkill * 0.3; // Up to +30%
    detectionRate -= stealthSkill * 0.2; // Up to -20%

    // 3. Apply target defense
    const targetSecurity = targetProgress.forensics / 100;
    successRate -= targetSecurity * 0.2; // Up to -20%
    detectionRate += targetSecurity * 0.15; // Up to +15%

    // 4. Apply server security level
    const serverSecurity = targetServer.securityLevel / 10; // Normalize
    successRate -= serverSecurity * 0.15;
    detectionRate += serverSecurity * 0.1;

    // 5. Apply method difficulty
    const methodDifficulty = this.METHOD_DIFFICULTY[method] || 1.0;
    successRate /= methodDifficulty;

    // 6. Apply tool bonuses
    const toolBonus = this.calculateToolBonus(tools);
    successRate += toolBonus.successBonus;
    detectionRate -= toolBonus.stealthBonus;

    // 7. Apply encryption factor
    const encryptionLevel = targetServer.encryptionLevel || 0;
    successRate -= encryptionLevel * 0.05;

    // 8. Calculate access level (how deep into system)
    let accessLevel = Math.floor((successRate + hackingSkill) * 5); // 0-10 scale
    accessLevel = Math.max(1, Math.min(10, accessLevel));

    // 9. Calculate base time (for future time-based mechanics)
    const baseTime = 10 + methodDifficulty * 5; // seconds

    // 10. Calculate evidence amount (base, before modifiers)
    const evidenceAmount = Math.floor((detectionRate + 1 - stealthSkill) * 50);

    // 11. Clamp values to valid ranges
    successRate = Math.max(0.05, Math.min(0.95, successRate));
    detectionRate = Math.max(0.05, Math.min(0.95, detectionRate));

    return {
      successRate,
      detectionRate,
      evidenceAmount,
      accessLevel,
      baseTime,
    };
  }

  /**
   * Calculate tool effectiveness bonus
   */
  private calculateToolBonus(tools: string[]): {
    successBonus: number;
    stealthBonus: number;
  } {
    let successBonus = 0;
    let stealthBonus = 0;

    for (const tool of tools) {
      const effectiveness = this.TOOL_EFFECTIVENESS[tool.toLowerCase()] || 0;
      successBonus += effectiveness * 0.5; // Tools help success

      // Stealth tools specifically help detection
      if (
        tool.toLowerCase().includes("stealth") ||
        tool.toLowerCase().includes("anon") ||
        tool.toLowerCase().includes("proxy") ||
        tool.toLowerCase().includes("vpn")
      ) {
        stealthBonus += effectiveness;
      }
    }

    return { successBonus, stealthBonus };
  }

  /**
   * Calculate evidence left behind
   */
  private calculateEvidence(
    calculation: HackCalculation,
    success: boolean,
    detected: boolean,
    tools: string[],
  ): number {
    let evidence = calculation.evidenceAmount;

    // Successful hacks leave less evidence (cleaner)
    if (success) {
      evidence *= 0.7;
    }

    // Failed hacks leave more traces (sloppy)
    if (!success) {
      evidence *= 1.3;
    }

    // Detection means more evidence was found
    if (detected) {
      evidence *= 1.5;
    }

    // Stealth tools reduce evidence
    const stealthTools = tools.filter(
      (t) =>
        t.toLowerCase().includes("stealth") ||
        t.toLowerCase().includes("clean") ||
        t.toLowerCase().includes("trace"),
    );
    evidence *= Math.max(0.3, 1 - stealthTools.length * 0.2);

    // Clamp to 0-100 range
    return Math.floor(Math.max(0, Math.min(100, evidence)));
  }

  /**
   * Calculate stealth level from tools
   */
  private calculateStealthLevel(tools: string[]): number {
    let stealthLevel = 50; // Base stealth

    for (const tool of tools) {
      if (
        tool.toLowerCase().includes("stealth") ||
        tool.toLowerCase().includes("anon")
      ) {
        stealthLevel += 10;
      }
      if (
        tool.toLowerCase().includes("proxy") ||
        tool.toLowerCase().includes("vpn")
      ) {
        stealthLevel += 5;
      }
    }

    return Math.min(100, stealthLevel);
  }

  // ==================== FILE DISCOVERY ====================

  /**
   * Discover files based on access level
   */
  private async discoverFiles(
    serverId: string,
    accessLevel: number,
  ): Promise<string[]> {
    try {
      // Get files from server
      const files = await db.client.fileSystemNode.findMany({
        where: {
          serverId,
          type: "file",
        },
        take: accessLevel * 3, // More access = more files
      });

      // Filter by protection level vs access level
      const discoveredFiles = files
        .filter((file) => {
          if (file.isProtected && accessLevel < 7) return false;
          if (file.isHidden && accessLevel < 5) return false;
          return true;
        })
        .map((file) => file.name);

      return discoveredFiles.slice(0, Math.min(10, accessLevel * 2));
    } catch (error) {
      console.error("File discovery error:", error);
      return [];
    }
  }

  // ==================== COUNTERMEASURES ====================

  /**
   * Trigger countermeasures based on evidence and detection
   */
  private async triggerCounterMeasures(
    serverId: string,
    evidenceLevel: number,
    targetUserId: string,
  ): Promise<string[]> {
    const counterMeasures: string[] = [];

    try {
      // Low evidence (0-30): Silent logging only
      if (evidenceLevel <= 30) {
        counterMeasures.push("silent_log");
      }

      // Medium evidence (31-60): Active monitoring
      if (evidenceLevel > 30 && evidenceLevel <= 60) {
        counterMeasures.push("active_monitor", "security_scan");
      }

      // High evidence (61-80): Defensive measures
      if (evidenceLevel > 60 && evidenceLevel <= 80) {
        counterMeasures.push(
          "firewall_strengthen",
          "access_restriction",
          "user_notification",
        );

        // Send notification to target
        await this.sendSecurityAlert(
          targetUserId,
          serverId,
          evidenceLevel,
          "high",
        );
      }

      // Critical evidence (81-100): Full lockdown
      if (evidenceLevel > 80) {
        counterMeasures.push(
          "server_lockdown",
          "trace_initiated",
          "faction_alert",
          "bounty_posted",
        );

        // Send critical notification
        await this.sendSecurityAlert(
          targetUserId,
          serverId,
          evidenceLevel,
          "critical",
        );
      }

      return counterMeasures;
    } catch (error) {
      console.error("Countermeasures error:", error);
      return ["error_response"];
    }
  }

  /**
   * Send security alert to target
   */
  private async sendSecurityAlert(
    userId: string,
    serverId: string,
    evidenceLevel: number,
    severity: string,
  ): Promise<void> {
    try {
      // Create game event
      await db.client.gameEvent.create({
        data: {
          type: "hack_detected",
          title: "Security Breach Detected",
          description: `Intrusion attempt detected on your server. Evidence level: ${evidenceLevel}%`,
          timestamp: new Date(),
          affectedUsers: [userId],
          metadata: { serverId, evidenceLevel },
          isGlobal: false,
          severity,
        },
      });

      console.log(`🚨 Security alert sent to user ${userId}`);
    } catch (error) {
      console.error("Security alert error:", error);
    }
  }

  // ==================== LOGGING & STATISTICS ====================

  /**
   * Log hack attempt to database
   */
  private async logHackAttempt(
    attempt: HackAttempt,
    result: HackResult,
  ): Promise<void> {
    try {
      await db.client.hackLog.create({
        data: {
          attackerId: attempt.attackerId,
          targetId: attempt.targetId,
          targetServerId: attempt.targetServerId,
          method: attempt.method,
          tools: attempt.tools,
          stealthLevel: attempt.stealthLevel,
          success: result.success,
          detected: result.detected,
          accessLevel: result.accessLevel,
          evidenceLeft: result.evidenceLeft,
          counterMeasures: result.counterMeasures,
          timestamp: new Date(),
          metadata: {
            discoveredFiles: result.discoveredFiles.length,
            traceInitiated: result.traceInitiated,
          },
        },
      });

      console.log(
        `📝 Logged hack attempt: ${attempt.attackerId} -> ${attempt.targetId}`,
      );
    } catch (error) {
      console.error("Hack logging error:", error);
    }
  }

  /**
   * Update player statistics
   */
  private async updateHackStatistics(
    attackerId: string,
    targetId: string,
    success: boolean,
  ): Promise<void> {
    try {
      // Update attacker stats
      const attackerProgress = await db.client.playerProgress.findUnique({
        where: { userId: attackerId },
      });

      if (attackerProgress) {
        await db.client.playerProgress.update({
          where: { userId: attackerId },
          data: {
            experience: {
              increment: success ? 50 : 10,
            },
          },
        });
      }

      // Update target's security awareness (increase forensics slightly)
      const targetProgress = await db.client.playerProgress.findUnique({
        where: { userId: targetId },
      });

      if (targetProgress && success) {
        await db.client.playerProgress.update({
          where: { userId: targetId },
          data: {
            forensics: {
              increment: Math.min(1, 100 - targetProgress.forensics),
            },
          },
        });
      }
    } catch (error) {
      console.error("Statistics update error:", error);
    }
  }

  /**
   * Award experience and skill gains
   */
  private async awardExperience(
    attackerId: string,
    success: boolean,
    difficulty: number,
  ): Promise<void> {
    try {
      const progress = await db.client.playerProgress.findUnique({
        where: { userId: attackerId },
      });

      if (!progress) return;

      // Calculate skill gain (harder hacks = more skill gain)
      const hackingGain = success ? Math.ceil(difficulty * 2) : 1;
      const stealthGain = Math.ceil(difficulty * 1.5);

      await db.client.playerProgress.update({
        where: { userId: attackerId },
        data: {
          hacking: {
            increment: Math.min(hackingGain, 100 - progress.hacking),
          },
          stealth: {
            increment: Math.min(stealthGain, 100 - progress.stealth),
          },
        },
      });
    } catch (error) {
      console.error("Experience award error:", error);
    }
  }

  // ==================== COOLDOWN MANAGEMENT ====================

  /**
   * Check if user is on cooldown
   */
  public isOnCooldown(userId: string): boolean {
    const cooldownEnd = this.cooldowns.get(userId);
    if (!cooldownEnd) return false;

    const now = new Date();
    if (now >= cooldownEnd) {
      this.cooldowns.delete(userId);
      return false;
    }

    return true;
  }

  /**
   * Get remaining cooldown time in seconds
   */
  public getRemainingCooldown(userId: string): number {
    const cooldownEnd = this.cooldowns.get(userId);
    if (!cooldownEnd) return 0;

    const now = new Date();
    const remaining = Math.ceil((cooldownEnd.getTime() - now.getTime()) / 1000);
    return Math.max(0, remaining);
  }

  /**
   * Apply cooldown to user
   */
  private applyCooldown(userId: string): void {
    const cooldownEnd = new Date(Date.now() + this.COOLDOWN_SECONDS * 1000);
    this.cooldowns.set(userId, cooldownEnd);
  }

  /**
   * Clear cooldown for user (admin/testing)
   */
  public clearCooldown(userId: string): void {
    this.cooldowns.delete(userId);
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Generate result message based on outcome
   */
  private generateResultMessage(
    success: boolean,
    detected: boolean,
    accessLevel: number,
    traceInitiated: boolean,
  ): string {
    if (success && !detected) {
      return `Hack successful! Gained ${accessLevel}/10 access. No traces detected.`;
    }

    if (success && detected) {
      return `Hack successful with ${accessLevel}/10 access, but you were detected!${traceInitiated ? " TRACE INITIATED!" : ""}`;
    }

    if (!success && detected) {
      return `Hack failed and you were detected!${traceInitiated ? " TRACE INITIATED!" : ""}`;
    }

    return "Hack failed. Try different tools or methods.";
  }

  /**
   * Get hack history for user
   */
  public async getHackHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ): Promise<any> {
    try {
      const skip = (page - 1) * limit;

      const hacks = await db.client.hackLog.findMany({
        where: {
          OR: [{ attackerId: userId }, { targetId: userId }],
        },
        include: {
          attacker: { select: { username: true } },
          target: { select: { username: true } },
          server: { select: { name: true, ipAddress: true } },
        },
        orderBy: { timestamp: "desc" },
        skip,
        take: limit,
      });

      const total = await db.client.hackLog.count({
        where: {
          OR: [{ attackerId: userId }, { targetId: userId }],
        },
      });

      return {
        success: true,
        data: hacks,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      console.error("Get hack history error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get security alerts for user's servers
   */
  public async getSecurityAlerts(userId: string): Promise<any> {
    try {
      const alerts = await db.client.gameEvent.findMany({
        where: {
          affectedUsers: { has: userId },
          type: "hack_detected",
        },
        orderBy: { timestamp: "desc" },
        take: 50,
      });

      return {
        success: true,
        data: alerts,
      };
    } catch (error) {
      console.error("Get security alerts error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get service statistics
   */
  public getStats(): object {
    return {
      activeCooldowns: this.cooldowns.size,
      activeHacks: this.activeHacks.size,
      cooldownDuration: this.COOLDOWN_SECONDS,
    };
  }

  /**
   * Cleanup expired cooldowns (maintenance)
   */
  public cleanupCooldowns(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [userId, cooldownEnd] of this.cooldowns.entries()) {
      if (now >= cooldownEnd) {
        this.cooldowns.delete(userId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`🧹 Cleaned up ${cleaned} expired cooldowns`);
    }
  }
}

// Export singleton instance
export const hackService = new HackService();
export default hackService;
