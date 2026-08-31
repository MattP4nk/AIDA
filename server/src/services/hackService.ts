import { EventEmitter } from "events";
import { db } from "../database/client";
import type {
  HackAttempt,
  HackResult,
  HackCalculation,
  HackSessionInfo,
  MinigameChallenge,
  PlayerSkills,
} from "../types/game";
import { HackMethod } from "../types/game";
import { injectable, inject } from "tsyringe";
import { safeExecute } from "../utils/safeExecute";
import { Logger } from "pino";
import {
  LOGGER,
  MISSION_INTEGRATION_SERVICE,
  PROGRESS_SERVICE,
} from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";
import type ProgressService from "./progressService";
import {
  generateLayersForServer,
  generateCipherChallenge,
  generatePortSequenceChallenge,
  generateMemoryTraceChallenge,
  validateAnswer,
} from "./hackMinigameGenerator";
import type { LayerResult } from "../types/game";
import {
  HACK_COOLDOWN_BASE_S,
  MAX_TOOL_SUCCESS_BONUS,
  MAX_TOOL_STEALTH_BONUS,
  SKILL_PENALTY,
  SKILL_SOFT_BAND,
} from "../config/gameBalance";

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
@injectable()
class HackService extends EventEmitter {
  private cooldowns: Map<string, Date>;
  private activeHacks: Map<string, HackSessionInfo>;
  private sessionTimers: Map<string, NodeJS.Timeout>;
  private readonly COOLDOWN_SECONDS = HACK_COOLDOWN_BASE_S; // From gameBalance — use getHackCooldown(skill) for skill-scaled value
  private readonly BASE_DETECTION_RATE = 0.3;
  private readonly BASE_SUCCESS_RATE = 0.5;
  private missionIntegration: MissionIntegrationService | null = null;

  // Hack method difficulty multipliers
  private readonly METHOD_DIFFICULTY: Record<HackMethod, number> = {
    [HackMethod.BRUTEFORCE]: 1.0,
    [HackMethod.EXPLOIT]: 1.5,
    [HackMethod.SOCIAL]: 1.2,
    [HackMethod.BACKDOOR]: 2.0,
    [HackMethod.SQL_INJECTION]: 1.3,
    [HackMethod.PHISHING]: 1.1,
    [HackMethod.ROOTKIT]: 2.5,
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

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
    @inject(PROGRESS_SERVICE) private progressService?: ProgressService,
  ) {
    super();
    this.cooldowns = new Map();
    this.activeHacks = new Map();
    this.sessionTimers = new Map();
    this.missionIntegration = missionIntegrationService || null;

    // Restore persisted sessions from DB on startup (non-blocking)
    this.restoreSessionsFromDB().catch((err) =>
      this.logger.error({ err }, "Failed to restore hack sessions from DB"),
    );
  }

  // ==================== CACHED SERVICE GETTERS ====================

  private _serverService?: unknown;
  private async getServerService() {
    if (!this._serverService) {
      const { getService } = await import("../di/container");
      const { SERVER_SERVICE } = await import("../di/tokens");
      this._serverService = getService(SERVER_SERVICE);
    }
    return this._serverService as { triggerSecurityAlert: (...args: unknown[]) => void };
  }

  private _reputationEngine?: unknown;
  private async getReputationEngine() {
    if (!this._reputationEngine) {
      const { getService } = await import("../di/container");
      const { REPUTATION_ENGINE } = await import("../di/tokens");
      this._reputationEngine = getService(REPUTATION_ENGINE);
    }
    return this._reputationEngine as { onServerHacked: (...args: unknown[]) => Promise<void> };
  }

  /** Clear all session timers (called during shutdown) */
  public cleanup(): void {
    for (const [, timer] of this.sessionTimers) {
      clearTimeout(timer);
    }
    this.sessionTimers.clear();
    this.logger.info("Hack session timers cleared");
  }

  // ==================== SESSION PERSISTENCE ====================

  /**
   * Persist a hack session to the database for crash recovery.
   */
  private async persistSession(session: HackSessionInfo): Promise<void> {
    await safeExecute({
      fn: () => db.client.hackSession.upsert({
        where: { id: session.id },
        create: {
          id: session.id,
          attackerId: session.attackerId,
          targetOwnerId: session.targetOwnerId,
          targetServerId: session.targetServerId,
          targetIp: session.targetIp,
          method: session.method,
          tools: session.tools,
          currentLayer: session.currentLayer,
          totalLayers: session.totalLayers,
          status: session.status,
          layersData: JSON.parse(JSON.stringify(session.layers)),
          layerResults: JSON.parse(JSON.stringify(session.layerResults)),
          detectionAccumulator: session.detectionAccumulator,
          startedAt: BigInt(session.startedAt),
          expiresAt: BigInt(session.expiresAt),
          layerStartedAt: BigInt(session.layerStartedAt),
        },
        update: {
          currentLayer: session.currentLayer,
          status: session.status,
          layerResults: JSON.parse(JSON.stringify(session.layerResults)),
          detectionAccumulator: session.detectionAccumulator,
          layerStartedAt: BigInt(session.layerStartedAt),
        },
      }),
      context: "Persist hack session",
      logger: this.logger,
    })();
  }

  /**
   * Remove a persisted session from the database (after resolution).
   */
  private async removePersistedSession(sessionId: string): Promise<void> {
    await safeExecute({
      fn: () => db.client.hackSession.deleteMany({ where: { id: sessionId } }),
      context: "Remove persisted hack session",
      logger: this.logger,
    })();
  }

  /**
   * Restore active hack sessions from the database after a server restart.
   * Expired sessions are resolved; active sessions are rehydrated with fresh timers.
   */
  private async restoreSessionsFromDB(): Promise<void> {
    const rows = await db.client.hackSession.findMany({
      where: { status: "active" },
    });

    if (rows.length === 0) return;

    this.logger.info({ count: rows.length }, "Restoring hack sessions from DB");

    const now = Date.now();

    for (const row of rows) {
      const expiresAt = Number(row.expiresAt);
      const startedAt = Number(row.startedAt);
      const layerStartedAt = Number(row.layerStartedAt);

      const session: HackSessionInfo = {
        id: row.id,
        targetIp: row.targetIp,
        targetServerId: row.targetServerId,
        targetOwnerId: row.targetOwnerId,
        attackerId: row.attackerId,
        method: row.method as HackMethod,
        tools: row.tools,
        currentLayer: row.currentLayer,
        totalLayers: row.totalLayers,
        status: row.status as HackSessionInfo["status"],
        layers: row.layersData as unknown as MinigameChallenge[],
        layerResults: row.layerResults as unknown as LayerResult[],
        detectionAccumulator: row.detectionAccumulator,
        startedAt,
        expiresAt,
        layerStartedAt,
      };

      if (now >= expiresAt) {
        // Session has expired while server was down — resolve it
        this.activeHacks.set(row.attackerId, session);
        this.logger.info(
          { sessionId: row.id },
          "Expiring restored session (past deadline)",
        );
        await this.expireSession(row.attackerId);
      } else {
        // Session still valid — rehydrate with a fresh timeout
        this.activeHacks.set(row.attackerId, session);
        const remainingMs = expiresAt - now;
        const timer = setTimeout(() => {
          this.expireSession(row.attackerId);
        }, remainingMs);
        this.sessionTimers.set(row.attackerId, timer);

        this.logger.info(
          { sessionId: row.id, remainingMs },
          "Restored active hack session",
        );
      }
    }
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

    return await safeExecute({
      fn: async (): Promise<HackResult> => {
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

      // 2b. Apply cooldown immediately to prevent concurrent hack bypass
      this.applyCooldown(attackerId);

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
          attackerId,
        );
        traceInitiated = evidenceLeft > 70;
      }

      // 10. Build result
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

      // 11. Run post-hack pipeline (logging, stats, events, XP, cross-service)
      await this.runPostHackPipeline({
        attackerId,
        targetServerId,
        targetId,
        result,
        method,
        difficulty: server.securityLevel,
        detected,
        evidence: evidenceLeft,
        targetIp: server.ipAddress,
        serverName: server.name,
        tools,
        successRate: calculation.successRate,
      });

      const executionTime = Date.now() - startTime;
      this.logger.info(
        { executionTime, attackerId, targetId, success },
        "Hack attempt completed",
      );

      return result;
      },
      context: "Process hack attempt",
      logger: this.logger,
      fallback: {
        success: false,
        detected: true,
        accessLevel: 0,
        discoveredFiles: [],
        evidenceLeft: 100,
        counterMeasures: ["system_error"],
        message: "Hack failed due to system error",
        traceInitiated: false,
      } as HackResult,
    })() as unknown as Promise<HackResult>;
  }

  // ==================== MINIGAME SESSION MANAGEMENT ====================

  /**
   * Initiate a hack session with interactive minigame layers.
   * Returns the first layer challenge for the player to solve.
   */
  public async initiateHackSession(
    attackerId: string,
    targetId: string,
    targetServerId: string,
    method: HackMethod,
    tools: string[],
    detectionModifier: number = 0,
    /**
     * Skill shortfall severity (0..1) when the player is attempting this below
     * the command's baseline skill. Computed by the command layer, which is the
     * only place that knows WHICH command was typed (hack/crack/exploit/… each
     * have a different baseline).
     */
    skillPenaltySeverity: number = 0,
  ): Promise<{
    success: boolean;
    session?: HackSessionInfo;
    challenge?: MinigameChallenge;
    output?: string[];
    error?: string;
  }> {
    // Check for existing active session
    if (this.activeHacks.has(attackerId)) {
      return {
        success: false,
        error:
          "You already have an active hack session. Use hack.status, hack.abort, or complete the current hack.",
      };
    }

    // Validate
    const validation = await this.validateHackAttempt(
      attackerId,
      targetId,
      targetServerId,
    );
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error || "Hack attempt invalid",
      };
    }

    // Cooldown
    if (this.isOnCooldown(attackerId)) {
      const remainingTime = this.getRemainingCooldown(attackerId);
      return {
        success: false,
        error: `Cooldown active. Wait ${remainingTime}s before next attempt.`,
      };
    }

    this.applyCooldown(attackerId);

    // Fetch data
    const attacker = await db.client.user.findUnique({
      where: { id: attackerId },
      include: { progress: true },
    });
    const server = await db.client.gameServer.findUnique({
      where: { id: targetServerId },
    });

    if (!attacker?.progress || !server) {
      return { success: false, error: "Invalid attacker or server" };
    }

    const skills: Partial<PlayerSkills> = {
      hacking: attacker.progress.hacking,
      networking: attacker.progress.networking,
      cryptography: attacker.progress.cryptography,
      stealth: attacker.progress.stealth,
      forensics: attacker.progress.forensics,
      socialEng: attacker.progress.socialEng,
    };

    // Generate layers
    const serverProfile = {
      securityLevel: server.securityLevel,
      firewallLevel: server.firewallLevel,
      encryptionLevel: server.encryptionLevel,
    };
    const layers = generateLayersForServer(serverProfile, skills, method);

    // ── Home server defense layers ──
    // If target is a player home, add extra minigame layers based on owner's defenses
    if (server.isPlayerHome && server.ownerId) {
      const ownerProgress = await db.client.playerProgress.findUnique({
        where: { userId: server.ownerId },
        select: { homeFirewall: true, homeVault: true, homeIds: true, homeHoneypot: true },
      });

      if (ownerProgress) {
        // Firewall defense: adds port_sequence challenges
        if (ownerProgress.homeFirewall >= 1) {
          const fwDifficulty = 3 + ownerProgress.homeFirewall * 2; // L1→5, L2→7, L3→9
          layers.unshift(generatePortSequenceChallenge(fwDifficulty, skills));
        }
        if (ownerProgress.homeFirewall >= 3) {
          // L3 adds a cipher layer on top
          layers.unshift(generateCipherChallenge(7, skills));
        }

        // Vault defense: adds minigame layers to protect vault contents
        // These layers are appended (attacker hits them AFTER base server layers)
        if (ownerProgress.homeVault >= 1) {
          // L1: cipher challenge
          layers.push(generateCipherChallenge(5 + ownerProgress.homeVault, skills));
        }
        if (ownerProgress.homeVault >= 2) {
          // L2: adds memory_trace on top of cipher
          layers.push(generateMemoryTraceChallenge(6 + ownerProgress.homeVault, skills));
        }
        if (ownerProgress.homeVault >= 3) {
          // L3: adds port_sequence — all 3 minigame types to crack vault
          layers.push(generatePortSequenceChallenge(9, skills));
        }

        // IDS Level 2+: alert the owner when hack STARTS
        if (ownerProgress.homeIds >= 2) {
          const alertMsg = ownerProgress.homeIds >= 3
            ? `INTRUSION ALERT: Someone (${attacker.homeIp || "unknown IP"}) is hacking your home server!`
            : `INTRUSION ALERT: Someone is attempting to hack your home server!`;
          this.emit("ids_alert", {
            targetUserId: server.ownerId,
            message: alertMsg,
            severity: "high",
          });
          this.sendSecurityAlert(server.ownerId, targetServerId, 0, "high").catch(() => {});
        }
      }
    }

    // Calculate total time limit (sum of layer limits + 30s buffer)
    const totalTimeLimit = layers.reduce((sum, l) => sum + l.timeLimit, 0) + 30;
    const now = Date.now();

    const sessionId = `hack_${attackerId}_${now}`;
    const session: HackSessionInfo = {
      id: sessionId,
      targetIp: server.ipAddress,
      targetServerId,
      targetOwnerId: targetId,
      attackerId,
      method,
      tools,
      currentLayer: 0,
      totalLayers: layers.length,
      status: "active",
      layers,
      layerResults: [],
      detectionAccumulator: detectionModifier * 100, // Priority modifier: aggressive (+) increases detection, stealth (-) reduces it
      startedAt: now,
      expiresAt: now + totalTimeLimit * 1000,
      layerStartedAt: now,
      skillPenaltySeverity,
    };

    this.activeHacks.set(attackerId, session);

    // Persist to DB for crash recovery
    await this.persistSession(session);

    // Set session timeout
    const timer = setTimeout(() => {
      this.expireSession(attackerId);
    }, totalTimeLimit * 1000);
    this.sessionTimers.set(attackerId, timer);

    const firstChallenge = layers[0]!;
    const headerOutput = [
      ``,
      `[HACK SESSION INITIATED — ${server.ipAddress}]`,
      `${"═".repeat(55)}`,
      `  Target: ${server.name} (${server.ipAddress})`,
      `  Security Level: ${server.securityLevel}/10`,
      `  Layers: ${layers.length}`,
      `  Method: ${method}`,
      ``,
      `[LAYER 1/${layers.length}] ${this.getLayerTitle(firstChallenge.type)}`,
      ...firstChallenge.displayText,
    ];

    return {
      success: true,
      session,
      challenge: firstChallenge as MinigameChallenge,
      output: headerOutput,
    };
  }

  /**
   * Submit an answer for the current minigame layer.
   */
  public async submitLayerAnswer(
    userId: string,
    answer: string,
  ): Promise<{
    success: boolean;
    correct?: boolean;
    feedback?: string;
    nextChallenge?: MinigameChallenge;
    output?: string[];
    finalResult?: HackResult;
    error?: string;
  }> {
    const session = this.activeHacks.get(userId);
    if (!session || session.status !== "active") {
      return { success: false, error: "No active hack session." };
    }

    const currentChallenge = session.layers[session.currentLayer];
    if (!currentChallenge) {
      return { success: false, error: "Invalid layer state." };
    }

    // Check layer time limit
    const layerElapsed = (Date.now() - session.layerStartedAt) / 1000;
    if (layerElapsed > currentChallenge.timeLimit) {
      // Layer timed out
      return this.handleLayerTimeout(userId, session);
    }

    // Count attempts for this layer
    const currentLayerResult = session.layerResults[session.currentLayer];
    const attemptsSoFar = currentLayerResult ? currentLayerResult.attempts : 0;

    // Validate answer
    const validation = validateAnswer(currentChallenge, answer);

    if (validation.correct) {
      // Layer solved
      session.layerResults[session.currentLayer] = {
        type: currentChallenge.type,
        solved: true,
        attempts: attemptsSoFar + 1,
        timeUsed: layerElapsed,
      };

      // Persist updated session state
      this.persistSession(session).catch((err) =>
        this.logger.error(
          { err },
          "Failed to persist session after correct answer",
        ),
      );

      return this.advanceToNextLayer(userId, session, validation.feedback);
    } else {
      // Wrong answer
      const newAttempts = attemptsSoFar + 1;
      session.layerResults[session.currentLayer] = {
        type: currentChallenge.type,
        solved: false,
        attempts: newAttempts,
        timeUsed: layerElapsed,
      };

      // Increase detection
      session.detectionAccumulator += 15;

      // Persist updated session state
      this.persistSession(session).catch((err) =>
        this.logger.error(
          { err },
          "Failed to persist session after wrong answer",
        ),
      );

      if (newAttempts >= currentChallenge.maxAttempts) {
        // Out of attempts — layer failed, advance
        const output = [
          `  ✗ ${validation.feedback}`,
          `  ✗ Out of attempts! Layer failed.`,
          `  [Detection +15%]`,
        ];
        return this.advanceToNextLayer(
          userId,
          session,
          "Layer failed — out of attempts.",
          output,
        );
      }

      const remainingAttempts = currentChallenge.maxAttempts - newAttempts;
      const remainingTime = Math.max(
        0,
        Math.ceil(currentChallenge.timeLimit - layerElapsed),
      );

      return {
        success: true,
        correct: false,
        feedback: validation.feedback,
        output: [
          `  ✗ ${validation.feedback}`,
          `  Attempts remaining: ${remainingAttempts} | Time: ${remainingTime}s`,
          `  [Detection +15%]`,
        ],
      };
    }
  }

  /**
   * Get a skill-based hint for the current layer. Costs +10 detection.
   */
  public getHint(userId: string): {
    success: boolean;
    hint?: string;
    output?: string[];
    error?: string;
  } {
    const session = this.activeHacks.get(userId);
    if (!session || session.status !== "active") {
      return { success: false, error: "No active hack session." };
    }

    const challenge = session.layers[session.currentLayer];
    if (!challenge || challenge.hints.length === 0) {
      return { success: false, error: "No hints available." };
    }

    session.detectionAccumulator += 10;

    // Return the most relevant unused hint
    const hintIdx = Math.min(
      session.layerResults.filter((r) => r).length,
      challenge.hints.length - 1,
    );

    const hint =
      challenge.hints[hintIdx] ?? challenge.hints[0] ?? "No hint available";
    return {
      success: true,
      hint,
      output: [`  HINT: ${hint}`, `  [Detection +10%]`],
    };
  }

  /**
   * Get current hack session status.
   */
  public getSessionStatus(userId: string): {
    success: boolean;
    output?: string[];
    error?: string;
  } {
    const session = this.activeHacks.get(userId);
    if (!session) {
      return { success: false, error: "No active hack session." };
    }

    const layersSolved = session.layerResults.filter((r) => r?.solved).length;
    const elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    const remaining = Math.max(
      0,
      Math.floor((session.expiresAt - Date.now()) / 1000),
    );
    const currentChallenge = session.layers[session.currentLayer];
    const layerTimeLeft = currentChallenge
      ? Math.max(
          0,
          Math.ceil(
            currentChallenge.timeLimit -
              (Date.now() - session.layerStartedAt) / 1000,
          ),
        )
      : 0;

    return {
      success: true,
      output: [
        `[HACK SESSION STATUS]`,
        `${"═".repeat(40)}`,
        `  Target: ${session.targetIp}`,
        `  Status: ${session.status}`,
        `  Layer: ${session.currentLayer + 1}/${session.totalLayers}`,
        `  Layers solved: ${layersSolved}/${session.totalLayers}`,
        `  Current layer type: ${currentChallenge?.type ?? "N/A"}`,
        `  Layer time remaining: ${layerTimeLeft}s`,
        `  Session time: ${elapsed}s elapsed, ${remaining}s remaining`,
        `  Detection accumulator: ${session.detectionAccumulator}%`,
      ],
    };
  }

  /**
   * Abort the current hack session. Partial detection is applied.
   */
  public async abortSession(
    userId: string,
  ): Promise<{ success: boolean; output?: string[]; result?: HackResult }> {
    const session = this.activeHacks.get(userId);
    if (!session || session.status !== "active") {
      return { success: false, output: ["No active hack session to abort."] };
    }

    session.status = "aborted";
    session.detectionAccumulator += 10; // penalty for aborting

    const resolution = await this.resolveHackSession(userId);
    return {
      success: true,
      output: [
        `  Hack session aborted.`,
        `  Partial traces left on target system.`,
        ...(resolution.output ?? []),
      ],
      ...(resolution.hackResult ? { result: resolution.hackResult } : {}),
    };
  }

  // ==================== SESSION INTERNALS ====================

  private getLayerTitle(type: string): string {
    switch (type) {
      case "cipher":
        return "ENCRYPTION BARRIER";
      case "port_sequence":
        return "FIREWALL — Port Knock Required";
      case "memory_trace":
        return "IDS — Memory Extraction";
      default:
        return "UNKNOWN LAYER";
    }
  }

  private async handleLayerTimeout(
    userId: string,
    session: HackSessionInfo,
  ): Promise<{
    success: boolean;
    correct: boolean;
    feedback: string;
    nextChallenge?: MinigameChallenge;
    output?: string[];
    finalResult?: HackResult;
  }> {
    const challenge = session.layers[session.currentLayer]!;
    session.layerResults[session.currentLayer] = {
      type: challenge.type,
      solved: false,
      attempts: session.layerResults[session.currentLayer]?.attempts ?? 0,
      timeUsed: challenge.timeLimit,
    };
    session.detectionAccumulator += 25;

    const advanceResult = await this.advanceToNextLayer(
      userId,
      session,
      "Layer timed out!",
      [`  ✗ TIME'S UP! Layer failed.`, `  [Detection +25%]`],
    );

    return { ...advanceResult, correct: false, feedback: "Layer timed out!" };
  }

  private async advanceToNextLayer(
    userId: string,
    session: HackSessionInfo,
    feedback: string,
    prefixOutput: string[] = [],
  ): Promise<{
    success: boolean;
    correct?: boolean;
    feedback: string;
    nextChallenge?: MinigameChallenge;
    output?: string[];
    finalResult?: HackResult;
  }> {
    session.currentLayer++;

    if (session.currentLayer >= session.totalLayers) {
      // All layers done — resolve
      session.status = "completed";
      const resolution = await this.resolveHackSession(userId);
      return {
        success: true,
        correct: true,
        feedback,
        output: [
          ...prefixOutput,
          `  ${feedback}`,
          ``,
          ...(resolution.output ?? []),
        ],
        ...(resolution.hackResult
          ? { finalResult: resolution.hackResult }
          : {}),
      };
    }

    // Show next layer
    session.layerStartedAt = Date.now();
    const nextChallenge = session.layers[session.currentLayer]!;
    const layerNum = session.currentLayer + 1;

    return {
      success: true,
      correct: prefixOutput.length === 0, // no prefix = solved correctly
      feedback,
      ...(nextChallenge ? { nextChallenge } : {}),
      output: [
        ...prefixOutput,
        ...(prefixOutput.length === 0 ? [`  ✓ ${feedback}`] : []),
        ``,
        `[LAYER ${layerNum}/${session.totalLayers}] ${this.getLayerTitle(nextChallenge.type)}`,
        ...nextChallenge.displayText,
      ],
    };
  }

  private async expireSession(userId: string): Promise<void> {
    const session = this.activeHacks.get(userId);
    if (!session || session.status !== "active") return;

    // Fail all remaining layers
    for (let i = session.currentLayer; i < session.totalLayers; i++) {
      const layer = session.layers[i]!;
      if (!session.layerResults[i]) {
        session.layerResults[i] = {
          type: layer.type,
          solved: false,
          attempts: 0,
          timeUsed: layer.timeLimit,
        };
      }
      session.detectionAccumulator += 25;
    }

    session.status = "expired";
    await this.resolveHackSession(userId);
  }

  /**
   * Resolve a hack session after all layers are done (or aborted/expired).
   * Runs the full post-hack pipeline (logging, stats, XP, events, reputation).
   */
  public async resolveHackSession(
    userId: string,
  ): Promise<{ success: boolean; hackResult?: HackResult; output?: string[] }> {
    const session = this.activeHacks.get(userId);
    if (!session) {
      return { success: false, output: ["No session to resolve."] };
    }

    // Clean up timer
    const timer = this.sessionTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.sessionTimers.delete(userId);
    }

    const layersSolved = session.layerResults.filter((r) => r?.solved).length;
    const totalLayers = session.totalLayers;

    // Determine outcome
    let successLevel: "full" | "partial" | "minimal" | "failure";
    let xpMultiplier: number;
    let accessLevelFactor: number;

    if (layersSolved === totalLayers) {
      successLevel = "full";
      xpMultiplier = 1.5;
      accessLevelFactor = 1.0;
    } else if (layersSolved >= totalLayers - 1) {
      successLevel = "partial";
      xpMultiplier = 1.0;
      accessLevelFactor = 0.5;
    } else if (layersSolved >= 1) {
      successLevel = "minimal";
      xpMultiplier = 0.5;
      accessLevelFactor = 0.1;
    } else {
      successLevel = "failure";
      xpMultiplier = 0.25;
      accessLevelFactor = 0;
    }

    const overallSuccess = layersSolved > 0;

    // Fetch server + attacker + target for existing pipeline
    const attacker = await db.client.user.findUnique({
      where: { id: session.attackerId },
      include: { progress: true },
    });
    const target = await db.client.user.findUnique({
      where: { id: session.targetOwnerId },
      include: { progress: true },
    });
    const server = await db.client.gameServer.findUnique({
      where: { id: session.targetServerId },
    });

    if (!attacker?.progress || !target?.progress || !server) {
      this.activeHacks.delete(userId);
      return {
        success: false,
        output: ["Session resolution failed: missing data."],
      };
    }

    // Calculate hack parameters for access level / evidence
    const calculation = await this.calculateHackParameters(
      attacker.progress,
      target.progress,
      server,
      session.method,
      session.tools,
      session.skillPenaltySeverity ?? 0,
    );

    // Adjust access level by layers solved
    const accessLevel = Math.max(
      0,
      Math.floor(calculation.accessLevel * accessLevelFactor),
    );

    // Detection: base + accumulator contribution
    const baseDetection = calculation.detectionRate;
    const detectionRate = Math.min(
      0.95,
      baseDetection + (session.detectionAccumulator / 100) * 0.4,
    );

    // Speed bonus: all layers under 50% time → -15% detection
    const allFast = session.layerResults.every(
      (r, i) => r && r.timeUsed < (session.layers[i]?.timeLimit ?? 30) * 0.5,
    );
    const finalDetectionRate = allFast
      ? Math.max(0.05, detectionRate - 0.15)
      : Math.max(0.05, detectionRate); // Floor: even max stealth can't go below 5%
    const detected = Math.random() < finalDetectionRate;

    const evidenceLeft = this.calculateEvidence(
      calculation,
      overallSuccess,
      detected,
      session.tools,
    );

    // File discovery
    let discoveredFiles: string[] = [];
    if (accessLevel > 0) {
      discoveredFiles = await this.discoverFiles(
        session.targetServerId,
        accessLevel,
      );
    }

    // Countermeasures
    let counterMeasures: string[] = [];
    let traceInitiated = false;
    if (detected) {
      counterMeasures = await this.triggerCounterMeasures(
        session.targetServerId,
        evidenceLeft,
        session.targetOwnerId,
        userId,
      );
      traceInitiated = evidenceLeft > 70;
    }

    // ── IDS alerts: notify owner when hack completes ──
    if (server.isPlayerHome && server.ownerId && overallSuccess) {
      const ownerDefenses = await db.client.playerProgress.findUnique({
        where: { userId: server.ownerId },
        select: { homeIds: true },
      });
      if (ownerDefenses && ownerDefenses.homeIds >= 1) {
        // L1 = alert on completion, L2+ already alerted on start (in initiateHackSession)
        if (ownerDefenses.homeIds === 1) {
          this.emit("ids_alert", {
            targetUserId: server.ownerId,
            message: `INTRUSION DETECTED: Your home server was breached! Access level: ${accessLevel}`,
            severity: "critical",
          });
        }
        // L3 = also tell them who did it
        if (ownerDefenses.homeIds >= 3) {
          this.emit("ids_alert", {
            targetUserId: server.ownerId,
            message: `INTRUSION REPORT: Attacker ${attacker.username} (${attacker.homeIp || "unknown"}) gained access level ${accessLevel}. Evidence: ${evidenceLeft}%`,
            severity: "critical",
          });
        }
        await this.sendSecurityAlert(server.ownerId, session.targetServerId, evidenceLeft, "critical").catch(() => {});
      }
    }

    // Build result
    const result: HackResult = {
      success: overallSuccess,
      detected,
      accessLevel,
      discoveredFiles,
      evidenceLeft,
      counterMeasures,
      message: this.generateMinigameResultMessage(
        successLevel,
        detected,
        accessLevel,
        layersSolved,
        totalLayers,
        traceInitiated,
      ),
      traceInitiated,
    };

    // Run post-hack pipeline (logging, stats, events, XP, cross-service)
    await this.runPostHackPipeline({
      attackerId: session.attackerId,
      targetServerId: session.targetServerId,
      targetId: session.targetOwnerId,
      result,
      method: session.method,
      difficulty: server.securityLevel,
      detected,
      evidence: evidenceLeft,
      xpMultiplier,
      notifyPersona: true,
      targetIp: server.ipAddress,
      serverName: server.name,
      tools: session.tools,
      successRate: calculation.successRate,
      factionId: server.factionId,
      layersSolved,
      totalLayers,
    });

    // Clean up session (in-memory + DB)
    this.activeHacks.delete(userId);
    this.removePersistedSession(session.id).catch((err) =>
      this.logger.error(
        { err },
        "Failed to remove persisted session after resolution",
      ),
    );

    this.logger.info(
      {
        attackerId: session.attackerId,
        targetOwnerId: session.targetOwnerId,
        layersSolved,
        totalLayers,
        overallSuccess,
      },
      "Hack session resolved",
    );

    // Build output summary
    const output = [
      ``,
      `[HACK SESSION COMPLETE]`,
      `${"═".repeat(50)}`,
      `  Layers solved: ${layersSolved}/${totalLayers}`,
      `  Result: ${successLevel.toUpperCase()}`,
      `  Access level: ${accessLevel}/10`,
      `  Detected: ${detected ? "YES" : "NO"}`,
      ...(traceInitiated ? ["  TRACE INITIATED!"] : []),
      ...(discoveredFiles.length > 0
        ? [`  Files discovered: ${discoveredFiles.length}`]
        : []),
      `  ${result.message}`,
    ];

    // ==================== BACKDOOR INSTALLATION ====================
    // If the hack used backdoor/rootkit method and succeeded, install a persistent backdoor
    if (
      result.success &&
      (session.method === HackMethod.BACKDOOR ||
        session.method === HackMethod.ROOTKIT)
    ) {
      await safeExecute({
        fn: async () => {
          const { getService } = await import("../di/container");
          const { BACKDOOR_SERVICE } = await import("../di/tokens");
          const backdoorService = getService<any>(BACKDOOR_SERVICE);
          const bdResult = await backdoorService.installBackdoor(
            session.attackerId,
            session.targetServerId,
            accessLevel,
            session.method,
            session.tools,
          );
          if (bdResult.success) {
            const verb = bdResult.upgraded ? "Upgraded" : "Installed";
            output.push(
              `  🔓 ${verb} ${bdResult.backdoor?.type ?? "standard"} backdoor (access level ${accessLevel})`,
            );
          }
        },
        context: "Install backdoor after hack",
        logger: this.logger,
        silent: true,
      })();
    }

    // ==================== TRACE INITIATION ====================
    // If trace was initiated, create a persistent trace in the database
    if (traceInitiated) {
      await safeExecute({
        fn: async () => {
          const { getService } = await import("../di/container");
          const { TRACE_SERVICE } = await import("../di/tokens");
          const traceService = getService<any>(TRACE_SERVICE);
          const trResult = await traceService.initiateTrace(
            session.attackerId,
            session.targetOwnerId,
            session.targetServerId,
            evidenceLeft,
          );
          if (trResult.success) {
            output.push(`  ⚠ ACTIVE TRACE LOCKED ON — evade with trace.evade`);
          }
        },
        context: "Initiate trace after hack",
        logger: this.logger,
        silent: true,
      })();
    }

    return { success: true, hackResult: result, output };
  }

  // ==================== POST-HACK PIPELINE ====================

  /**
   * Consolidated post-hack pipeline shared by processHackAttempt and resolveHackSession.
   * Handles logging, stats, events, XP, security alerts, reputation, persona notification,
   * and mission integration.
   */
  private async runPostHackPipeline(params: {
    attackerId: string;
    targetServerId: string;
    targetId?: string;
    result: HackResult;
    method: string;
    difficulty: number;
    detected: boolean;
    evidence: number;
    xpMultiplier?: number;
    notifyPersona?: boolean;
    /** Extra fields needed by the pipeline internals */
    targetIp: string;
    serverName: string;
    tools: string[];
    successRate: number;
    factionId?: string | null;
    layersSolved?: number;
    totalLayers?: number;
  }): Promise<void> {
    const {
      attackerId,
      targetServerId,
      targetId,
      result,
      method,
      difficulty,
      detected,
      evidence,
      xpMultiplier,
      notifyPersona,
      targetIp,
      serverName,
      tools,
      successRate,
      factionId,
      layersSolved,
      totalLayers,
    } = params;

    // 1. Log to database
    const hackAttempt: HackAttempt = {
      attackerId,
      targetId: targetId ?? attackerId,
      targetServerId,
      targetIp,
      method: method as HackMethod,
      tools,
      stealthLevel: this.calculateStealthLevel(tools),
      timestamp: new Date(),
    };
    this.logHackAttempt(hackAttempt, result).catch((err) =>
      this.logger.error({ err }, "Failed to log hack"),
    );

    // 2. Update statistics
    await this.updateHackStatistics(
      attackerId,
      targetId ?? attackerId,
      result.success,
    );

    // 3. Emit hack:attempt event
    this.emit("hack:attempt", {
      attackerId,
      targetId: targetId ?? attackerId,
      targetServerId,
      serverName,
      difficulty,
      result,
      ...(layersSolved !== undefined ? { layersSolved } : {}),
      ...(totalLayers !== undefined ? { totalLayers } : {}),
    });

    // 4. Emit hack:detected event (if detected)
    if (detected) {
      this.emit("hack:detected", {
        attackerId,
        targetId: targetId ?? attackerId,
        evidenceLeft: evidence,
        traceInitiated: result.traceInitiated,
      });
    }

    // 5. Progress saves
    this.progressService?.saveOnEvent(attackerId, "hack_attempt");
    if (result.success) {
      this.progressService?.saveOnEvent(attackerId, "hack_success");
    }

    // 6. Award experience
    await this.awardExperience(
      attackerId,
      successRate,
      result.success,
      xpMultiplier ?? 1,
    );

    // 7. Security alert via ServerService (if detected)
    if (detected) {
      await safeExecute({
        fn: async () => {
          const serverService = await this.getServerService();
          await serverService.triggerSecurityAlert(
            targetServerId,
            attackerId,
            result.success ? "hack_successful" : "hack_detected",
          );
        },
        context: "Trigger security alert on hack",
        logger: this.logger,
        silent: true,
      })();
    }

    // 8. Reputation engine
    await safeExecute({
      fn: async () => {
        const reputationEngine = await this.getReputationEngine();
        await reputationEngine.onServerHacked(
          attackerId,
          targetServerId,
          result.detected,
        );
      },
      context: "Apply reputation change on hack",
      logger: this.logger,
      silent: true,
    })();

    // 9. Optional persona notification (resolveHackSession only)
    if (notifyPersona && result.success && factionId) {
      await safeExecute({
        fn: async () => {
          const { getService } = await import("../di/container");
          const { PERSONA_SERVICE } = await import("../di/tokens");
          const personaService =
            getService<import("./personaService").PersonaService>(
              PERSONA_SERVICE,
            );
          await personaService.onFactionServerHacked(
            targetServerId,
            factionId!,
            attackerId,
            detected,
          );
        },
        context: "Notify AI of faction server hack",
        logger: this.logger,
        silent: true,
      })();
    }

    // 10. Mission integration
    if (this.missionIntegration && result.success) {
      await this.missionIntegration.onHackComplete(
        attackerId,
        targetId ?? attackerId,
        result.success,
        result.detected,
        result.accessLevel,
        method as HackMethod,
      );
    }
  }

  private generateMinigameResultMessage(
    level: string,
    detected: boolean,
    accessLevel: number,
    layersSolved: number,
    totalLayers: number,
    traceInitiated: boolean,
  ): string {
    const detectedSuffix = detected
      ? ` You were detected!${traceInitiated ? " TRACE INITIATED!" : ""}`
      : " No traces detected.";

    switch (level) {
      case "full":
        return `Full breach! ${layersSolved}/${totalLayers} layers cracked. Access level ${accessLevel}/10.${detectedSuffix}`;
      case "partial":
        return `Partial breach. ${layersSolved}/${totalLayers} layers cracked. Access level ${accessLevel}/10.${detectedSuffix}`;
      case "minimal":
        return `Minimal breach. ${layersSolved}/${totalLayers} layers cracked. Access level ${accessLevel}/10.${detectedSuffix}`;
      default:
        return `Hack failed. 0/${totalLayers} layers cracked.${detectedSuffix}`;
    }
  }

  /**
   * Check if a user has an active hack session.
   */
  public hasActiveSession(userId: string): boolean {
    const session = this.activeHacks.get(userId);
    return session != null && session.status === "active";
  }

  /**
   * Get the active session for a user (for command routing).
   */
  public getActiveSession(userId: string): HackSessionInfo | undefined {
    return this.activeHacks.get(userId);
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
    return await safeExecute({
      fn: async () => {
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

        // Absolute floor, as defence-in-depth for callers that bypass the
        // command layer. The COMMAND layer owns skill policy now (soft gates),
        // and the lowest baseline it permits is `hack`'s 20 minus
        // SKILL_SOFT_BAND — so anything below that is a bug, not a choice.
        // This used to read `< 10`, which silently contradicted the soft band by
        // refusing the Hacking 5-9 attempts the gate had just allowed.
        const absoluteFloor = 20 - SKILL_SOFT_BAND;
        if (attacker.progress.hacking < absoluteFloor) {
          return {
            valid: false,
            error: `Insufficient hacking skill (minimum: ${absoluteFloor})`,
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
      },
      context: "Validate hack attempt",
      logger: this.logger,
      fallback: { valid: false, error: "Validation failed" },
    })() as unknown as Promise<{ valid: boolean; error?: string }>;
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
    /**
     * Skill shortfall severity (0..1) for an under-skilled attempt. See the Soft
     * Skill Gates section of gameBalance.ts: requirements are a baseline, and
     * falling short costs success rate and stealth rather than blocking outright.
     */
    skillPenaltySeverity: number = 0,
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

    // 4. Apply server security level (clamp to 0-1 range)
    const serverSecurity = Math.max(
      0,
      Math.min(1, targetServer.securityLevel / 10),
    );
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

    // 7b. Apply the soft-gate penalty for attempting this under-skilled.
    // Multiplicative on success (a shortfall scales down whatever edge you had,
    // rather than subtracting a flat amount that could invert a strong build)
    // and additive on detection (fumbling is loud in absolute terms).
    const severity = Math.max(0, Math.min(1, skillPenaltySeverity));
    if (severity > 0) {
      successRate *= 1 - severity * SKILL_PENALTY.maxSuccessPenalty;
      detectionRate += severity * SKILL_PENALTY.maxDetectionPenalty;
    }

    // 8. Calculate access level (how deep into system)
    // Clamp successRate to 0-1 before combining with hackingSkill (also 0-1)
    const clampedSuccess = Math.max(0, Math.min(1, successRate));
    let accessLevel = Math.floor((clampedSuccess + hackingSkill) * 5); // 0-10 scale
    accessLevel = Math.max(1, Math.min(10, accessLevel));

    // 9. Calculate base time (for future time-based mechanics)
    const baseTime = 10 + methodDifficulty * 5; // seconds

    // 10. Calculate evidence amount (base, before modifiers)
    // Clamp detectionRate to 0-1 before combining with stealthSkill (also 0-1)
    const clampedDetection = Math.max(0, Math.min(1, detectionRate));
    const evidenceAmount = Math.floor(
      (clampedDetection + (1 - stealthSkill)) * 50,
    );

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

    // De-duplicate here too. The command layer already does, but this method is
    // the one that actually accumulates, and it must not depend on its callers
    // behaving.
    const uniqueTools = [...new Set(tools.map((t) => t.toLowerCase()))];

    for (const tool of uniqueTools) {
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

    // Ceiling on the aggregate. Ownership filtering (gameBalance.HACK_TOOL_ITEMS)
    // is the primary control, but a player who legitimately owns every tool
    // should not be able to pin successRate to its 0.95 clamp on tool bonuses
    // alone — skill has to keep mattering.
    return {
      successBonus: Math.min(successBonus, MAX_TOOL_SUCCESS_BONUS),
      stealthBonus: Math.min(stealthBonus, MAX_TOOL_STEALTH_BONUS),
    };
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
    return await safeExecute({
      fn: async () => {
        // Get files from server
        const MAX_FILE_DISCOVERY = 30;
        const files = await db.client.fileSystemNode.findMany({
          where: {
            serverId,
            type: "file",
          },
          take: Math.min(accessLevel * 3, MAX_FILE_DISCOVERY),
        });

        // Filter by protection level vs access level
        const discoveredFiles = files
          .filter((file: any) => {
            if (file.isProtected && accessLevel < 7) return false;
            if (file.isHidden && accessLevel < 5) return false;
            return true;
          })
          .map((file: any) => file.name);

        return discoveredFiles.slice(0, Math.min(10, accessLevel * 2));
      },
      context: "Discover files on hack",
      logger: this.logger,
      fallback: [] as string[],
    })() as unknown as Promise<string[]>;
  }

  // ==================== COUNTERMEASURES ====================

  /**
   * Trigger countermeasures based on evidence and detection
   */
  private async triggerCounterMeasures(
    serverId: string,
    evidenceLevel: number,
    targetUserId: string,
    attackerId?: string,
  ): Promise<string[]> {
    const counterMeasures: string[] = [];

    try {
      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, factionId: true, firewallLevel: true, securityLevel: true, ipAddress: true },
      });
      if (!server) return ["error_no_server"];

      // ── Low evidence (0-30): Silent logging only ──
      if (evidenceLevel <= 30) {
        counterMeasures.push("silent_log");
        // Just logged to HackLog — no active response
      }

      // ── Medium evidence (31-60): Active monitoring + firewall bump ──
      if (evidenceLevel > 30 && evidenceLevel <= 60) {
        counterMeasures.push("active_monitor", "firewall_bump");

        // Temporarily increase firewall level (+1 for 30 min)
        await db.client.gameServer.update({
          where: { id: serverId },
          data: { firewallLevel: Math.min(10, server.firewallLevel + 1) },
        });
        // Schedule firewall reset after 30 min
        setTimeout(async () => {
          try {
            await db.client.gameServer.update({
              where: { id: serverId },
              data: { firewallLevel: server.firewallLevel },
            });
          } catch { /* server may have been deleted */ }
        }, 30 * 60 * 1000).unref?.();

        // Notify server owner if online
        await this.notifyServerOwner(targetUserId, server.name, evidenceLevel, "warning");
      }

      // ── High evidence (61-80): Defensive measures + faction alert + rep penalty ──
      if (evidenceLevel > 60 && evidenceLevel <= 80) {
        counterMeasures.push("firewall_strengthen", "faction_alert", "reputation_penalty");

        // Increase firewall by +2 for 1 hour
        await db.client.gameServer.update({
          where: { id: serverId },
          data: {
            firewallLevel: Math.min(10, server.firewallLevel + 2),
            securityLevel: Math.min(10, server.securityLevel + 1),
          },
        });
        setTimeout(async () => {
          try {
            await db.client.gameServer.update({
              where: { id: serverId },
              data: { firewallLevel: server.firewallLevel, securityLevel: server.securityLevel },
            });
          } catch { /* ignore */ }
        }, 60 * 60 * 1000).unref?.();

        // Notify owner
        await this.notifyServerOwner(targetUserId, server.name, evidenceLevel, "high");

        // Alert faction AI if server belongs to a faction
        if (server.factionId && attackerId) {
          await this.alertFactionAI(server.factionId, serverId, server.name, attackerId, evidenceLevel);
        }

        // Reputation penalty for attacker with the server's faction
        if (server.factionId && attackerId) {
          await this.applyDetectionReputationPenalty(attackerId, server.factionId, evidenceLevel);
        }

        // The owner notices and says so. Not gated on factionId: neutral and
        // training infrastructure has a sysadmin with a voice too, and that is
        // the first feedback a new player gets about being noisy.
        if (attackerId) {
          const reacted = await this.triggerNpcReaction(serverId, server.name, attackerId, evidenceLevel);
          if (reacted) counterMeasures.push("owner_contacted");
        }
      }

      // ── Critical evidence (81-100): Lockdown + trace + access revocation ──
      if (evidenceLevel > 80) {
        counterMeasures.push("server_lockdown", "trace_initiated", "faction_alert", "access_revoked");

        // Increase security to max for 2 hours
        await db.client.gameServer.update({
          where: { id: serverId },
          data: {
            firewallLevel: 10,
            securityLevel: Math.min(10, server.securityLevel + 2),
          },
        });
        setTimeout(async () => {
          try {
            await db.client.gameServer.update({
              where: { id: serverId },
              data: { firewallLevel: server.firewallLevel, securityLevel: server.securityLevel },
            });
          } catch { /* ignore */ }
        }, 2 * 60 * 60 * 1000).unref?.();

        // Notify owner — critical
        await this.notifyServerOwner(targetUserId, server.name, evidenceLevel, "critical");

        // Alert faction AI
        if (server.factionId && attackerId) {
          await this.alertFactionAI(server.factionId, serverId, server.name, attackerId, evidenceLevel);
        }

        // Heavy reputation penalty
        if (server.factionId && attackerId) {
          await this.applyDetectionReputationPenalty(attackerId, server.factionId, evidenceLevel);
        }

        // Owner reaction, escalated tone at this evidence level.
        if (attackerId) {
          const reacted = await this.triggerNpcReaction(serverId, server.name, attackerId, evidenceLevel);
          if (reacted) counterMeasures.push("owner_contacted");
        }

        // Revoke attacker's access key for this server (if they had one)
        if (attackerId) {
          await db.client.serverAccessKey.deleteMany({
            where: { userId: attackerId, serverId },
          });
          counterMeasures.push("access_key_revoked");
        }

        // Post a bounty on the attacker
        if (attackerId && server.factionId) {
          await this.postBounty(attackerId, server.factionId, server.name, serverId, evidenceLevel);
          counterMeasures.push("bounty_posted");
        }

        // Initiate trace via TraceService
        if (attackerId) {
          try {
            const { getService } = await import("../di/container");
            const { TRACE_SERVICE } = await import("../di/tokens");
            const traceService = getService<any>(TRACE_SERVICE);
            await traceService.initiateTrace(attackerId, serverId, evidenceLevel);
            counterMeasures.push("trace_active");

            // Register trace as passive resource drain on attacker
            const { MEMORY_SERVICE } = await import("../di/tokens");
            const memoryService = getService<any>(MEMORY_SERVICE);
            memoryService.registerActiveTrace(attackerId, serverId, `Trace from ${server.name}`);
          } catch (err) {
            this.logger.error({ err }, "Failed to initiate trace");
          }
        }
      }

      // Create audit log entry for all detection levels
      await this.sendSecurityAlert(targetUserId, serverId, evidenceLevel,
        evidenceLevel > 80 ? "critical" : evidenceLevel > 60 ? "high" : "warning");

      return counterMeasures;
    } catch (error) {
      this.logger.error({ err: error }, "Countermeasures error");
      return ["error_response"];
    }
  }

  /**
   * Notify server owner via Socket.IO if they're online.
   */
  private async notifyServerOwner(
    ownerId: string,
    serverName: string,
    evidenceLevel: number,
    severity: "warning" | "high" | "critical",
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const { getService } = await import("../di/container");
        const { SOCKET_IO } = await import("../di/tokens");
        const io = getService<any>(SOCKET_IO);

        const messages: Record<string, string> = {
          warning: `[SECURITY] Suspicious activity detected on ${serverName}. Evidence: ${evidenceLevel}%`,
          high: `[ALERT] Intrusion detected on ${serverName}! Firewall strengthened. Evidence: ${evidenceLevel}%`,
          critical: `[CRITICAL] ${serverName} under attack! Server locked down. Trace initiated. Evidence: ${evidenceLevel}%`,
        };

        io.to(`player:${ownerId}`).emit("notification", {
          type: "security_alert",
          severity,
          message: messages[severity],
          timestamp: new Date(),
        });
      },
      context: "Notify server owner of security alert",
      logger: this.logger,
      silent: true,
    })();
  }

  /**
   * Alert the faction AI leader about a detected intrusion on their server.
   * The AI can then generate counter-missions or post warnings.
   */
  /**
   * Let an NPC server owner respond to being breached, in character.
   *
   * Resolved lazily through the container so hackService keeps no hard
   * dependency on the reaction service, and returns false rather than throwing:
   * NPC flavour must never be able to break the hack pipeline.
   */
  private async triggerNpcReaction(
    serverId: string,
    serverName: string,
    attackerId: string,
    evidenceLevel: number,
  ): Promise<boolean> {
    try {
      const { getService } = await import("../di/container");
      const { NPC_REACTION_SERVICE } = await import("../di/tokens");
      const reactionService =
        getService<import("./npcReactionService").NpcReactionService>(
          NPC_REACTION_SERVICE,
        );
      return await reactionService.onIntrusionDetected({
        serverId,
        serverName,
        attackerId,
        evidenceLevel,
      });
    } catch (err) {
      this.logger.debug({ err, serverId }, "NPC reaction service unavailable");
      return false;
    }
  }

  private async alertFactionAI(
    factionId: string,
    serverId: string,
    serverName: string,
    attackerId: string,
    evidenceLevel: number,
  ): Promise<void> {
    try {
      const { getService } = await import("../di/container");
      const { PERSONA_SERVICE } = await import("../di/tokens");
      // Typed, NOT `getService<any>`. The `any` here is what let the arity bug
      // below survive: this call passed a single object to a 4-positional
      // method, so `serverFactionId`/`attackerUserId`/`detected` were all
      // undefined and the lookup threw — meaning the faction AI never actually
      // learned about a high-evidence intrusion.
      const personaService =
        getService<import("./personaService").PersonaService>(PERSONA_SERVICE);

      // Feed knowledge to faction — they now know about the attacker
      const { FACTION_KNOWLEDGE_SERVICE } = await import("../di/tokens");
      const fkService = getService<any>(FACTION_KNOWLEDGE_SERVICE);
      await fkService.addEntry(factionId, {
        assetType: "player",
        assetId: attackerId,
        assetMeta: {
          threat: true,
          evidenceLevel,
          targetServer: serverName,
          targetServerId: serverId,
          detectedAt: new Date().toISOString(),
        },
        source: "server_discovery",
        confidence: Math.min(1.0, evidenceLevel / 100),
        discoveredBy: "security_system",
      });

      // Notify the faction's AI leader — this can trigger a reactive mission
      await personaService.onFactionServerHacked(
        serverId,
        factionId,
        attackerId,
        true,
      );

      this.logger.info({ factionId, serverId, attackerId, evidenceLevel }, "Faction AI alerted about intrusion");
    } catch (err) {
      this.logger.error({ err }, "Failed to alert faction AI");
    }
  }

  /**
   * Post a bounty on a detected attacker. The bounty appears as a claimable task
   * for any player in good standing with the issuing faction.
   * Completion: hack the target's home server and read a proof file.
   */
  private async postBounty(
    targetUserId: string,
    factionId: string,
    serverName: string,
    serverId: string,
    evidenceLevel: number,
  ): Promise<void> {
    try {
      // Get target username for display
      const target = await db.client.user.findUnique({
        where: { id: targetUserId },
        select: { username: true },
      });
      if (!target) return;

      // Check if there's already an active bounty on this player from this faction
      const existing = await db.client.bounty.findFirst({
        where: {
          targetUserId,
          issuedByFactionId: factionId,
          status: "active",
        },
      });
      if (existing) {
        this.logger.debug({ targetUserId, factionId }, "Active bounty already exists, skipping");
        return;
      }

      // Reward scales with evidence: 81% → 2000c/10rep, 100% → 5000c/25rep
      const rewardCredits = Math.floor(1000 + (evidenceLevel - 80) * 200);
      const rewardReputation = Math.floor(5 + (evidenceLevel - 80));

      // Find files the target downloaded from the breached server (stored on their home)
      const stolenFiles = await db.client.fileSystemNode.findMany({
        where: {
          server: { isPlayerHome: true, ownerId: targetUserId },
          type: "file",
          metadata: { path: ["sourceServerId"], equals: serverId },
        },
        select: { id: true, name: true },
      });
      const stolenFileIds = stolenFiles.map((f) => f.id);

      await db.client.bounty.create({
        data: {
          targetUserId,
          targetUsername: target.username,
          issuedByFactionId: factionId,
          reason: `Critical intrusion detected on ${serverName}. Evidence level: ${evidenceLevel}%`,
          rewardCredits,
          rewardReputation,
          status: "active",
          serverId,
          evidenceLevel,
          ...(stolenFileIds.length > 0 ? { stolenFileIds } : {}),
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // 48 hours
        },
      });

      // Emit event for DynamicContentService (wanted notices on faction servers)
      this.emit("bounty:posted", {
        targetUsername: target.username,
        factionId,
        reason: `Critical intrusion detected on ${serverName}. Evidence level: ${evidenceLevel}%`,
        rewardCredits,
        rewardReputation,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      });

      // Notify faction members via Socket.IO
      try {
        const { getService } = await import("../di/container");
        const { SOCKET_IO } = await import("../di/tokens");
        const io = getService<any>(SOCKET_IO);

        // Get all faction members to notify
        const members = await db.client.factionMember.findMany({
          where: { factionId },
          select: { userId: true },
        });

        for (const member of members) {
          if (member.userId !== targetUserId) {
            io.to(`player:${member.userId}`).emit("notification", {
              type: "bounty_posted",
              message: `BOUNTY: ${target.username} is wanted for hacking ${serverName}. Reward: ${rewardCredits}c + ${rewardReputation} rep. Use 'bounties' to view.`,
              timestamp: new Date(),
            });
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Failed to send bounty notification to faction members");
      }

      // Post on faction forum via AI leader
      try {
        const { getService } = await import("../di/container");

        const faction = await db.client.faction.findUnique({
          where: { id: factionId },
          select: { aiPersonaId: true, name: true },
        });

        if (faction?.aiPersonaId) {
          const { FORUM_SERVICE } = await import("../di/tokens");
          const forumService = getService<any>(FORUM_SERVICE);

          // Find faction forum
          const forum = await db.client.forum.findFirst({
            where: { factionId },
            select: { id: true },
          });

          if (forum) {
            await forumService.createAIPost(
              forum.id,
              faction.aiPersonaId,
              `WANTED: ${target.username}`,
              `Security breach on ${serverName}. Intruder left ${evidenceLevel}% evidence. Bounty: ${rewardCredits} credits + ${rewardReputation} reputation. Hack their home server to claim. Use 'bounties' for details.`,
            );
          }
        }
      } catch (err) {
        this.logger.warn({ err }, "Failed to post bounty notice to faction forum");
      }

      this.logger.info(
        { targetUserId, targetUsername: target.username, factionId, rewardCredits, evidenceLevel },
        "Bounty posted on detected attacker",
      );
    } catch (error) {
      this.logger.error({ err: error }, "Failed to post bounty");
    }
  }

  /**
   * Apply reputation penalty to an attacker caught hacking a faction's server.
   */
  private async applyDetectionReputationPenalty(
    attackerId: string,
    factionId: string,
    evidenceLevel: number,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const { getService } = await import("../di/container");
        const { FACTION_SERVICE } = await import("../di/tokens");
        const factionService = getService<any>(FACTION_SERVICE);

        // Penalty scales with evidence: 61-80% → -5 rep, 81-100% → -15 rep
        const penalty = evidenceLevel > 80 ? -15 : -5;
        await factionService.addReputation(attackerId, factionId, penalty);

        this.logger.info({ attackerId, factionId, penalty, evidenceLevel }, "Detection reputation penalty applied");
      },
      context: "Apply detection reputation penalty",
      logger: this.logger,
    })();
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
    await safeExecute({
      fn: () => db.client.gameEvent.create({
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
      }),
      context: "Send security alert",
      logger: this.logger,
    })();
  }

  // ==================== LOGGING & STATISTICS ====================

  /**
   * Log hack attempt to database
   */
  private async logHackAttempt(
    attempt: HackAttempt,
    result: HackResult,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
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

        this.logger.info(
          { attackerId: attempt.attackerId, targetId: attempt.targetId },
          "Logged hack attempt",
        );
      },
      context: "Log hack attempt",
      logger: this.logger,
    })();
  }

  /**
   * Update player statistics
   */
  private async updateHackStatistics(
    attackerId: string,
    targetId: string,
    success: boolean,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
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
              successfulHacks: { increment: success ? 1 : 0 },
              failedHacks: { increment: success ? 0 : 1 },
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
      },
      context: "Update hack statistics",
      logger: this.logger,
    })();
  }

  /**
   * Award experience and skill gains.
   * Unified method — multiplier defaults to 1 for simple hack attempts,
   * and is passed explicitly for minigame sessions (e.g. 0.25–1.5).
   */
  private async awardExperience(
    attackerId: string,
    difficulty: number,
    success: boolean,
    multiplier = 1,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const progress = await db.client.playerProgress.findUnique({
          where: { userId: attackerId },
        });

        if (!progress) return;

        const baseHackGain = success ? Math.ceil(difficulty * 2) : 1;
        const baseStealthGain = Math.ceil(difficulty * 1.5);
        const hackingGain = Math.ceil(baseHackGain * multiplier);
        const stealthGain = Math.ceil(baseStealthGain * multiplier);

        await db.client.playerProgress.update({
          where: { userId: attackerId },
          data: {
            hacking: { increment: Math.min(hackingGain, 100 - progress.hacking) },
            stealth: { increment: Math.min(stealthGain, 100 - progress.stealth) },
            experience: {
              increment: Math.ceil((success ? 50 : 10) * multiplier),
            },
          },
        });
      },
      context: "Award experience",
      logger: this.logger,
    })();
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
  applyCooldown(userId: string, durationSeconds?: number): void {
    const seconds = durationSeconds ?? this.COOLDOWN_SECONDS;
    const cooldownEnd = new Date(Date.now() + seconds * 1000);
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
    return await safeExecute({
      fn: async () => {
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
      },
      context: "Get hack history",
      logger: this.logger,
      fallback: { success: false as boolean, data: [] as any[], pagination: {} as any },
    })();
  }

  /**
   * Get security alerts for user's servers
   */
  public async getSecurityAlerts(userId: string): Promise<any> {
    return await safeExecute({
      fn: async () => {
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
      },
      context: "Get security alerts",
      logger: this.logger,
      fallback: { success: false as boolean, data: [] as any[] },
    })();
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
      this.logger.info({ cleaned }, "Cleaned up expired cooldowns");
    }
  }
}

export default HackService;
