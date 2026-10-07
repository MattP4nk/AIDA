import { EventEmitter } from "events";
import { db } from "../database/client";
import type { HackAttempt, HackResult, HackSessionInfo, MinigameChallenge, PlayerSkills } from "../types/game";
import { HackMethod } from "../types/game";
import { injectable, inject } from "tsyringe";
import { safeExecute } from "../utils/safeExecute";
import { Logger } from "pino";
import { BACKDOOR_SERVICE, LOGGER, MISSION_INTEGRATION_SERVICE, PERSONA_SERVICE, PLAYER_PROGRESS_REPOSITORY, PROGRESS_SERVICE, REPUTATION_ENGINE, SERVER_SERVICE, TRACE_SERVICE, WARFARE_SERVICE, HACK_COUNTERMEASURE_SERVICE } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";
import type ProgressService from "./progressService";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";
import { generateLayersForServer, generateCipherChallenge, generatePortSequenceChallenge, generateMemoryTraceChallenge, validateAnswer } from "./hackMinigameGenerator";

import type BackdoorService from "./backdoorService";

import type TraceService from "./traceService";

import { DETECTION_FLOOR, HACK_COOLDOWN_BASE_S, SKILL_SOFT_BAND, getHackCooldown } from "../config/gameBalance";

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
import { HackSessionStore } from "./hackSessionStore";
import type { HackCountermeasureService } from "./hackCountermeasureService";
import { calculateHackParameters, calculateEvidence, calculateStealthLevel, generateResultMessage, generateMinigameResultMessage } from "./hackScoring";

@injectable()
class HackService extends EventEmitter {
  private cooldowns: Map<string, Date>;
  // A8: the session maps live in HackSessionStore; these getters keep every
  // existing `this.activeHacks` / `this.sessionTimers` use unchanged.
  private readonly sessions: HackSessionStore;
  private get activeHacks() { return this.sessions.activeHacks; }
  private get sessionTimers() { return this.sessions.sessionTimers; }
  private readonly COOLDOWN_SECONDS = HACK_COOLDOWN_BASE_S; // From gameBalance — use getHackCooldown(skill) for skill-scaled value
  private missionIntegration: MissionIntegrationService | null = null;



  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(PLAYER_PROGRESS_REPOSITORY)
    private playerProgress: PlayerProgressRepository,
    // A8: countermeasures are their own singleton; `bounty:posted` is emitted
    // there, so listen on hackService.countermeasures.
    @inject(HACK_COUNTERMEASURE_SERVICE) public readonly countermeasures: HackCountermeasureService,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
    @inject(PROGRESS_SERVICE) private progressService?: ProgressService,
  ) {
    super();
    this.cooldowns = new Map();
    this.sessions = new HackSessionStore(this.logger);
    this.missionIntegration = missionIntegrationService || null;

    // Restore persisted sessions from DB on startup (non-blocking)
    this.sessions.restoreSessionsFromDB((id) => this.expireSession(id)).catch((err) =>
      this.logger.error({ err }, "Failed to restore hack sessions from DB"),
    );
  }

  // ==================== CACHED SERVICE GETTERS ====================

  private _serverService?: unknown;
  private async getServerService() {
    if (!this._serverService) {
      const { getService } = await import("../di/container");
      this._serverService = getService(SERVER_SERVICE);
    }
    return this._serverService as { triggerSecurityAlert: (...args: unknown[]) => void };
  }

  private _reputationEngine?: unknown;
  private async getReputationEngine() {
    if (!this._reputationEngine) {
      const { getService } = await import("../di/container");
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
   * Process a complete hack attempt
   */
  public async processHackAttempt(
    attackerId: string,
    targetId: string,
    targetServerId: string,
    method: HackMethod,
    tools: string[],
    /**
     * Skill shortfall severity (0..1) for an under-skilled attempt.
     *
     * REQUIRED for correctness, not optional polish: `exploit`, `backdoor` and
     * `rootkit` are all declared `mode: "soft"` in skillRequirements.ts and all
     * route through here. Without this parameter they were attemptable a full
     * SKILL_SOFT_BAND below their requirement at ZERO cost — a straight
     * difficulty cut, and a direct violation of that module's own rule that a
     * requirement only becomes soft once a penalty is wired at the call site.
     */
    skillPenaltySeverity: number = 0,
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
      await this.applyCooldown(attackerId);

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
      const calculation = await calculateHackParameters(
        attacker.progress!,
        target.progress!,
        server,
        method,
        tools,
        skillPenaltySeverity,
      );

      // 5. Determine success
      const success = Math.random() < calculation.successRate;

      // 6. Determine detection
      const detected = Math.random() < calculation.detectionRate;

      // 7. Calculate evidence left
      const evidenceLeft = calculateEvidence(
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
        counterMeasures = await this.countermeasures.triggerCounterMeasures(
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
        message: generateResultMessage(
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

    await this.applyCooldown(attackerId);

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
          this.countermeasures.sendSecurityAlert(server.ownerId, targetServerId, 0, "high").catch(() => {});
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
    await this.sessions.persistSession(session);

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
      this.sessions.persistSession(session).catch((err) =>
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
      this.sessions.persistSession(session).catch((err) =>
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
    const calculation = await calculateHackParameters(
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
      ? Math.max(DETECTION_FLOOR, detectionRate - 0.15)
      : Math.max(DETECTION_FLOOR, detectionRate); // Floor: even max stealth can't go below 5%
    const detected = Math.random() < finalDetectionRate;

    const evidenceLeft = calculateEvidence(
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
      counterMeasures = await this.countermeasures.triggerCounterMeasures(
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
        await this.countermeasures.sendSecurityAlert(server.ownerId, session.targetServerId, evidenceLeft, "critical").catch(() => {});
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
      message: generateMinigameResultMessage(
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
    this.sessions.removePersistedSession(session.id).catch((err) =>
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
          const backdoorService = getService<BackdoorService>(BACKDOOR_SERVICE);
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
          const traceService = getService<TraceService>(TRACE_SERVICE);
          const trResult = await traceService.initiateTrace(
            session.attackerId,
            session.targetOwnerId,
            session.targetServerId,
            evidenceLeft,
          );
          // R5 REVIEW FIX: at evidence > 80 `triggerCounterMeasures` has
          // ALREADY created this exact trace (same target + server), so the
          // duplicate guard rejects this call and `success` is false. Before
          // R5 that first call was broken, so this one succeeded and printed
          // the prompt — fixing the arity silently removed the warning from
          // precisely the hacks that most need it. Evasion chance decays with
          // trace progress, so a player who is not told cannot evade in time.
          if (
            trResult.success ||
            (await traceService.hasActiveTrace(
              session.attackerId,
              session.targetServerId,
            ))
          ) {
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
      stealthLevel: calculateStealthLevel(tools),
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

    // 2b. Score the hack toward an active faction war.
    //
    // `updateWarScore` had no producer at all, so every declared war sat 0-0
    // and its monitor resolved on elapsed time rather than on anything either
    // side did. Non-blocking and silent: the overwhelmingly common case is a
    // hack that has nothing to do with a war, and a scoring failure must not
    // fail the hack.
    if (result.success) {
      void (async () => {
        try {
          const { getService } = await import("../di/container");
          const warfare = getService<import("./warfareService").default>(WARFARE_SERVICE);
          await warfare.recordHackForWar(attackerId, targetServerId);
        } catch (err) {
          this.logger.warn({ err, attackerId, targetServerId }, "War scoring failed");
        }
      })();
    }

    // 3. Emit hack:attempt event
    this.emit("hack:attempt", {
      attackerId,
      targetId: targetId ?? attackerId,
      targetServerId,
      serverName,
      difficulty,
      result,
      // The story ledger has always recorded `method` from this event and it
      // was never sent — `data.method` was undefined on every entry. It is a
      // parameter of this very function, so the producer had it all along.
      method,
      // Carried so the victim-alert bridge can respect stealth. Without it the
      // bridge would have to notify on every attempt, which makes the
      // detection roll — and every point of stealth skill — worthless from the
      // defender's side.
      detected,
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
    //
    // M11 FIX: this passed `targetId ?? attackerId` — the target **USER's** id —
    // into a parameter that `missionIntegration` compares against
    // `objective.metadata.serverId`. `GameServer.id === User.id` is never true,
    // so `hack_target` was unwinnable in EVERY case, across 7 mission templates.
    // `targetServerId` was in scope the whole time and simply unused.
    //
    // Note this makes `install_backdoor` and `breach_server` STRICTER: they were
    // only ever completing because an unbound `matchesEntity` returns true, i.e.
    // they credited hacking *any* server. Bound objectives now require the right
    // one, which is the intended behaviour.
    if (this.missionIntegration && result.success) {
      await this.missionIntegration.onHackComplete(
        attackerId,
        targetServerId,
        result.success,
        result.detected,
        result.accessLevel,
        method as HackMethod,
      );
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
        // Update attacker stats. The `findUnique`-then-`update` guard is gone:
        // the repository's `updateMany` matches nothing when the row is absent,
        // which is the same outcome without the extra round trip or the race
        // between the two statements.
        await this.playerProgress.incrementCounters(attackerId, {
          successfulHacks: success ? 1 : 0,
          failedHacks: success ? 0 : 1,
        });

        // R12: the XP award that used to live here is GONE.
        //
        // `resolveHackSession` calls this method AND `awardExperience` on the
        // same hack, and both granted `success ? 50 : 10` — so every hack paid
        // out twice, once unmultiplied here and once multiplied there, and a
        // level-up could emit `player:levelup` twice for one action.
        // `awardExperience` is the one that applies the multiplier and is
        // named for the job; a method called `updateHackStatistics` has no
        // business granting experience.

        // Update target's security awareness (increase forensics slightly).
        // D8: was `Math.min(1, 100 - targetProgress.forensics)` from a separate
        // read — the same JS-computed headroom as `awardExperience`.
        if (success) {
          await this.playerProgress.addSkill(targetId, "forensics", 1);
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
        const baseHackGain = success ? Math.ceil(difficulty * 2) : 1;
        const baseStealthGain = Math.ceil(difficulty * 1.5);
        const hackingGain = Math.ceil(baseHackGain * multiplier);
        const stealthGain = Math.ceil(baseStealthGain * multiplier);

        // ── D8: the cap is the database's job ──────────────────────────────
        // This was `increment: Math.min(gain, 100 - progress.hacking)` with
        // `progress` read a few lines above, outside the write. Two completions
        // at 99 both computed `min(gain, 1)` and produced 101 — reproduced in
        // `verify-phase3-progress-repo.ts`'s negative control, which still
        // lands on exactly 101 with the old code. `addSkill` clamps inside the
        // UPDATE, so the read the clamp uses is the row version it writes.
        // The `findUnique` this used to need is gone with it.
        await this.playerProgress.addSkills(attackerId, {
          hacking: hackingGain,
          stealth: stealthGain,
        });

        // D5 — experience through the repository so `level` is recomputed.
        // It previously was not: `level` was raised by exactly one code path
        // (`missionService.grantRewards`), so hack XP accumulated without ever
        // levelling anyone up.
        const xp = await this.playerProgress.addExperience(
          attackerId,
          Math.ceil((success ? 50 : 10) * multiplier),
        );
        if (xp.leveledUp) {
          this.emit("player:levelup", {
            userId: attackerId,
            newLevel: xp.level,
            experience: xp.experience,
          });
        }
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
  async applyCooldown(userId: string, durationSeconds?: number): Promise<void> {
    // ORPHAN AUDIT 2026-09-24: hacking skill now actually reduces the cooldown.
    //
    // `getHackCooldown(skill)` existed in gameBalance with ZERO callers, and
    // the comment on `COOLDOWN_SECONDS` said "use getHackCooldown(skill) for
    // skill-scaled value" — an instruction to a future reader that nobody
    // followed. A flat 30s ran for everyone, so investing in hacking bought
    // nothing here.
    //
    // The lookup lives INSIDE this method rather than in its parameters: all
    // three callers had no skill value in scope, and a parameter every caller
    // must remember to pass is how this became dead in the first place.
    let seconds: number;
    if (durationSeconds !== undefined) {
      seconds = durationSeconds;
    } else {
      const progress = await db.client.playerProgress.findUnique({
        where: { userId },
        select: { hacking: true },
      });
      seconds = getHackCooldown(progress?.hacking ?? 0);
    }
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
