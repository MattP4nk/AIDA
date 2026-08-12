/**
 * Connection Challenge Service
 *
 * Manages connection challenge sessions: determines when a challenge is needed,
 * initiates challenges, validates answers, and tracks session state with timeouts.
 */

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";
import { prisma } from "../database/client";
import type { ConnectionChallenge, ConnectionSessionInfo } from "../../../shared/types";
import {
  CONNECTION_CHALLENGE_SKIP_THRESHOLD,
  getConnectionDifficulty,
} from "../config/gameBalance";
import {
  selectChallengeType,
  generateHandshakeChallenge,
  generateSignalTraceChallenge,
  validateConnectionAnswer,
} from "./connectionChallengeGenerator";

// ═══════════════════════════════════════════════════════════════════
// Architect Briefing Mail — sent once per player on first challenge
// ═══════════════════════════════════════════════════════════════════

const CONNECTION_BRIEFING_SUBJECT = "Network Security Protocols";
const CONNECTION_BRIEFING_CONTENT = `Operative,

When you connect to a server for the first time, its security systems will challenge you. You'll encounter two types of authentication protocols depending on the network:

--- TCP HANDSHAKE (Structured Networks) ---
Corporate and government servers use TCP handshake verification.
You'll see a table of incoming SYN packets with sequence numbers, ports, flags, and window sizes.

Your task:
  1. Identify VALID packets (flags = "SYN", window > 0)
  2. Ignore DECOY packets (flags contain "RST", or window = 0)
  3. Calculate ACK = SEQ + 1 for each valid packet
  4. Submit in ascending PORT order

  Command: handshake.ack <ack1> <ack2> ...

--- SIGNAL TRACE (Underground Networks) ---
Darknet and underground relays use signal tracing.
You'll see a hex grid. A signal starts at a marked cell and follows a pattern — each hop increments by a fixed hex value.

Your task:
  1. Find the origin cell (given in the hints)
  2. Follow the hex increment pattern through adjacent cells
  3. Identify the endpoint cell

  Command: signal.trace <cell>  (e.g. signal.trace C4)

--- GENERAL ---
  - Higher networking skill reduces difficulty
  - Revisiting low-security servers (1-2) skips the challenge
  - Install a backdoor ('backdoor install') to bypass challenges on revisits
  - Use 'connect.abort' to cancel an active challenge
  - Hints are shown below the puzzle

Your networking skill is your greatest asset here. Train it well.

— The Architect`;

@injectable()
export class ConnectionChallengeService {
  private activeSessions = new Map<string, ConnectionSessionInfo>();
  private sessionTimers = new Map<string, NodeJS.Timeout>();
  /** Track which players have received the briefing mail (in-memory, resets on restart — acceptable). */
  private briefedPlayers = new Set<string>();

  constructor(@inject(LOGGER) private logger: Logger) {}

  /**
   * Check if a connection challenge is needed for this server.
   */
  shouldChallenge(
    userId: string,
    server: { isPlayerHome: boolean; ownerId: string | null; securityLevel: number },
    isFirstVisit: boolean,
    hasBackdoor: boolean = false,
  ): { needed: boolean; difficulty: number } {
    // Home server: never challenge
    if (server.isPlayerHome && server.ownerId === userId) {
      return { needed: false, difficulty: 0 };
    }

    // First visit: always challenge (even with backdoor — you haven't been there yet)
    if (isFirstVisit) {
      return { needed: true, difficulty: server.securityLevel };
    }

    // Revisit with active backdoor: skip challenge
    if (hasBackdoor) {
      return { needed: false, difficulty: 0 };
    }

    // Revisit: skip for low-security servers
    if (server.securityLevel <= CONNECTION_CHALLENGE_SKIP_THRESHOLD) {
      return { needed: false, difficulty: 0 };
    }

    return { needed: true, difficulty: server.securityLevel };
  }

  /**
   * Initiate a connection challenge session.
   */
  initiateChallenge(
    userId: string,
    server: {
      id: string;
      name: string;
      ipAddress: string;
      securityLevel: number;
      factionId: string | null;
      isPlayerHome: boolean;
      ownerId: string | null;
    },
    networkZone: string | null,
    networkingSkill: number,
    isFirstVisit: boolean,
  ): { session: ConnectionSessionInfo; challenge: ConnectionChallenge } {
    // Abort any existing session
    if (this.activeSessions.has(userId)) {
      this.abortSession(userId);
    }

    const challengeType = selectChallengeType(server.factionId, networkZone);
    const difficulty = getConnectionDifficulty(
      server.securityLevel,
      isFirstVisit,
      networkingSkill,
    );

    const challenge = challengeType === "handshake"
      ? generateHandshakeChallenge(difficulty, networkingSkill)
      : generateSignalTraceChallenge(difficulty, networkingSkill);

    const now = Date.now();
    const session: ConnectionSessionInfo = {
      id: `conn_${userId}_${now}`,
      userId,
      targetServerId: server.id,
      targetIp: server.ipAddress,
      targetName: server.name,
      isFirstVisit,
      status: "active",
      challenge,
      attempts: 0,
      startedAt: now,
      expiresAt: now + challenge.timeLimit * 1000,
    };

    this.activeSessions.set(userId, session);

    // Expiry timer
    const timer = setTimeout(() => this.expireSession(userId), challenge.timeLimit * 1000);
    (timer as NodeJS.Timeout & { unref?: () => void }).unref?.();
    this.sessionTimers.set(userId, timer);

    this.logger.info(
      { userId, targetIp: server.ipAddress, type: challengeType, difficulty },
      "Connection challenge initiated",
    );

    // Send Architect briefing mail on first challenge (fire-and-forget)
    if (!this.briefedPlayers.has(userId)) {
      this.briefedPlayers.add(userId);
      this.sendBriefingMail(userId).catch((err) => {
        this.logger.warn({ err, userId }, "Failed to send connection briefing mail");
      });
    }

    return { session, challenge };
  }

  /**
   * Send a one-time briefing mail from The Architect explaining connection challenges.
   */
  private async sendBriefingMail(userId: string): Promise<void> {
    try {
      // Find The Architect persona
      const architect = await prisma.aIPersona.findFirst({
        where: { type: "game_master" },
        select: { id: true },
      });
      if (!architect) return;

      // Check if briefing was already sent (survives restart)
      const existing = await prisma.message.findFirst({
        where: {
          recipientId: userId,
          senderId: architect.id,
          subject: CONNECTION_BRIEFING_SUBJECT,
        },
      });
      if (existing) return;

      // Import messageService dynamically to avoid circular DI
      const { getService } = await import("../di/container");
      const { MESSAGE_SERVICE } = await import("../di/tokens");
      const messageService = getService<any>(MESSAGE_SERVICE);

      await messageService.sendAIMessage(
        architect.id,
        userId,
        CONNECTION_BRIEFING_SUBJECT,
        CONNECTION_BRIEFING_CONTENT,
      );

      this.logger.info({ userId }, "Connection challenge briefing mail sent");
    } catch (err) {
      this.logger.warn({ err, userId }, "Could not send connection briefing mail");
    }
  }

  /**
   * Submit an answer for an active connection challenge.
   */
  submitAnswer(
    userId: string,
    answer: string,
  ): { correct: boolean; feedback: string; session: ConnectionSessionInfo } {
    const session = this.activeSessions.get(userId);
    if (!session || session.status !== "active") {
      throw new Error("No active connection challenge.");
    }

    // Check time limit
    if (Date.now() > session.expiresAt) {
      this.expireSession(userId);
      throw new Error("Connection challenge timed out.");
    }

    session.attempts++;
    const result = validateConnectionAnswer(session.challenge, answer);

    if (result.correct) {
      session.status = "completed";
      this.cleanup(userId);
      this.logger.info(
        { userId, targetIp: session.targetIp, attempts: session.attempts },
        "Connection challenge completed",
      );
    } else if (session.attempts >= session.challenge.maxAttempts) {
      session.status = "failed";
      this.cleanup(userId);
      this.logger.info(
        { userId, targetIp: session.targetIp, attempts: session.attempts },
        "Connection challenge failed (max attempts)",
      );
    }

    return { correct: result.correct, feedback: result.feedback, session };
  }

  getActiveSession(userId: string): ConnectionSessionInfo | undefined {
    return this.activeSessions.get(userId);
  }

  abortSession(userId: string): void {
    const session = this.activeSessions.get(userId);
    if (session && session.status === "active") {
      session.status = "aborted";
      this.cleanup(userId);
      this.logger.debug({ userId }, "Connection challenge aborted");
    }
  }

  private expireSession(userId: string): void {
    const session = this.activeSessions.get(userId);
    if (session && session.status === "active") {
      session.status = "expired";
      this.cleanup(userId);
      this.logger.debug({ userId }, "Connection challenge expired");
    }
  }

  private cleanup(userId: string): void {
    const timer = this.sessionTimers.get(userId);
    if (timer) clearTimeout(timer);
    this.sessionTimers.delete(userId);
    // Keep session briefly for result reporting, then remove
    setTimeout(() => this.activeSessions.delete(userId), 5000);
  }
}
