/**
 * FileAccessCommandsModule — Commands for finding hidden files.
 *
 * Commands:
 *   sweep           — Scan current directory for hidden files (forensics minigame)
 *   sweep.reveal    — Submit answer to sweep challenge
 */

import type { Command, CommandResult, MinigameChallenge } from "../../../../shared/types";
import type { CommandContext, CommandInfo, CommandModule } from "./interface";
import { successResult, errorResult, spawnBackgroundProcess } from "./helpers";
import {
  generateAnomalyScanChallenge,
  generateDiskSectorChallenge,
  validateSweepAnswer,
} from "../fileAccessMinigameGenerator";

import logger from "../../logger";

// ═══════════════════════════════════════════════════════════════════
// Session Management
// ═══════════════════════════════════════════════════════════════════

interface SweepSession {
  sessionId: string;
  challenge: MinigameChallenge;
  serverId: string;
  directoryPath: string;
  hiddenFileIds: string[];
  expiresAt: number;
  attemptsLeft: number;
}

const activeSweepSessions = new Map<string, SweepSession>();

// Cleanup expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of activeSweepSessions) {
    if (now > session.expiresAt) {
      activeSweepSessions.delete(userId);
    }
  }
}, 30_000);

// ═══════════════════════════════════════════════════════════════════
// Module
// ═══════════════════════════════════════════════════════════════════

export class FileAccessCommandsModule implements CommandModule {
  public category = "file_access";
  public commands = new Set([
    "sweep",
    "sweep.reveal",
  ]);

  async execute(command: Command, context: CommandContext): Promise<CommandResult> {
    switch (command.command) {
      case "sweep":
        return this.handleSweep(command, context);
      case "sweep.reveal":
        return this.handleSweepReveal(command, context);
      default:
        return errorResult(`Unknown command: ${command.command}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SWEEP — Detect hidden files
  // ═══════════════════════════════════════════════════════════════

  private async handleSweep(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const session = context.gameStateManager.getSession(context.userId);
    if (!session?.currentServerId) {
      return errorResult("Not connected to any server.");
    }

    const serverId = session.currentServerId;
    const currentDir = session.terminals?.[0]?.currentDirectory || "/";

    // Check if already in a sweep session
    if (activeSweepSessions.has(context.userId)) {
      return errorResult("Sweep session already active. Use 'sweep.reveal <names>' to submit or wait for it to expire.");
    }

    // Get player skills
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { forensics: true },
    });
    const forensics = progress?.forensics ?? 0;

    // Spawn background process
    const memoryService = context.services.memoryService;
    if (memoryService) {
      const spawn = await spawnBackgroundProcess({
        context,
        processType: "sweep",
        skillKey: "forensics",
        label: "filesystem sweep",
        targetServerId: serverId,
        onComplete: async () => {
          try {
            await this.executeSweep(context, serverId, currentDir, forensics);
          } catch (err) {
            logger.error({ err }, "Sweep onComplete error");
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Sweep failed unexpectedly.",
                timestamp: new Date(),
              });
            }
          }
        },
      });
      if (spawn) return spawn.result;
    }

    // Fallback: instant sweep (no resource system)
    await this.executeSweep(context, serverId, currentDir, forensics);
    if (activeSweepSessions.has(context.userId)) {
      return successResult("Sweep initiated. Analyze the panel above.");
    }
    return successResult("Sweep complete. No hidden anomalies detected in this directory.");
  }

  private async executeSweep(
    context: CommandContext,
    serverId: string,
    directoryPath: string,
    forensics: number,
  ): Promise<void> {
    // Resolve directory to get its node ID
    const dirResult = await context.fileService.resolvePath(serverId, directoryPath);
    if (!dirResult.exists || !dirResult.nodeId) {
      this.emitResult(context, false, `Directory not found: ${directoryPath}`);
      return;
    }

    // Query hidden files in this directory
    const hiddenNodes = await context.db.client.fileSystemNode.findMany({
      where: {
        serverId,
        parentId: dirResult.nodeId,
        isHidden: true,
      },
      select: { id: true, name: true, type: true, size: true, createdAt: true },
    });

    if (hiddenNodes.length === 0) {
      this.emitResult(context, true, "Sweep complete. No hidden anomalies detected in this directory.");
      return;
    }

    // Get visible files too (for anomaly scan context)
    const visibleNodes = await context.db.client.fileSystemNode.findMany({
      where: {
        serverId,
        parentId: dirResult.nodeId,
        isHidden: false,
      },
      select: { name: true, type: true, size: true, createdAt: true },
    });

    // Get server security level
    const server = await context.db.client.gameServer.findUnique({
      where: { id: serverId },
      select: { securityLevel: true },
    });
    const securityLevel = server?.securityLevel ?? 3;

    // Generate challenge based on security level
    const skills = { forensics };
    const hiddenFiles = hiddenNodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type as "file" | "directory",
      size: n.size,
      createdAt: n.createdAt,
    }));
    const visibleFiles = visibleNodes.map(n => ({
      name: n.name,
      type: n.type as "file" | "directory",
      size: n.size,
      createdAt: n.createdAt,
    }));

    const challenge = securityLevel <= 5
      ? generateAnomalyScanChallenge(securityLevel, hiddenFiles, visibleFiles, skills)
      : generateDiskSectorChallenge(securityLevel, hiddenFiles, skills);

    // Store session
    const sessionId = `sweep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    activeSweepSessions.set(context.userId, {
      sessionId,
      challenge,
      serverId,
      directoryPath,
      hiddenFileIds: hiddenFiles.map(f => f.id),
      expiresAt: Date.now() + challenge.timeLimit * 1000 + 5000, // +5s grace
      attemptsLeft: challenge.maxAttempts,
    });

    // Emit challenge to client
    if (context.io) {
      const output = challenge.displayText.join("\n") +
        (challenge.hints.length > 0
          ? "\n\n" + challenge.hints.map(h => `hint: ${h}`).join("\n")
          : "");

      context.io.to(`player:${context.userId}`).emit("command:result", {
        success: true,
        output,
        data: {
          fileAccessSessionId: sessionId,
          fileAccessType: "sweep",
          challenge,
          targetDir: directoryPath,
        },
        timestamp: new Date(),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SWEEP.REVEAL — Submit sweep answer
  // ═══════════════════════════════════════════════════════════════

  private async handleSweepReveal(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const sweepSession = activeSweepSessions.get(context.userId);
    if (!sweepSession) {
      return errorResult("No active sweep session. Run 'sweep' first.");
    }

    // Check expiry
    if (Date.now() > sweepSession.expiresAt) {
      activeSweepSessions.delete(context.userId);
      return {
        success: false,
        output: "Sweep session expired. Run 'sweep' again.",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    const answer = command.args.join(" ").trim();
    if (!answer) {
      return errorResult("Usage: sweep.reveal <name1> <name2> ...");
    }

    // Validate answer
    const correct = validateSweepAnswer(sweepSession.challenge, answer);

    if (correct) {
      // Store revealed file IDs in the player's session
      const session = context.gameStateManager.getSession(context.userId);
      if (session) {
        const existing = (session as any).revealedFileIds as string[] || [];
        const updated = [...new Set([...existing, ...sweepSession.hiddenFileIds])];
        (session as any).revealedFileIds = updated;
      }

      // Award forensics XP
      try {
        await context.db.client.playerProgress.update({
          where: { userId: context.userId },
          data: { forensics: { increment: 5 + sweepSession.challenge.difficulty } },
        });
      } catch { /* non-critical */ }

      activeSweepSessions.delete(context.userId);
      return {
        success: true,
        output: `Sweep successful! ${sweepSession.hiddenFileIds.length} hidden entries revealed.\n` +
          "Use 'ls -a' to see them.",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    // Wrong answer
    sweepSession.attemptsLeft--;
    if (sweepSession.attemptsLeft <= 0) {
      activeSweepSessions.delete(context.userId);
      return {
        success: false,
        output: "All attempts exhausted. Sweep session ended. Run 'sweep' to try again.",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    return errorResult(`Incorrect. ${sweepSession.attemptsLeft} attempt(s) remaining.`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════

  private emitResult(context: CommandContext, success: boolean, output: string): void {
    if (context.io) {
      context.io.to(`player:${context.userId}`).emit("command:result", {
        success,
        output,
        timestamp: new Date(),
      });
    }
  }

  getCommandInfo(): CommandInfo[] {
    return [
      {
        command: "sweep",
        category: "file_access",
        description: "Scan current directory for hidden files using forensic analysis",
        usage: "sweep",
        examples: ["sweep"],
      },
      {
        command: "sweep.reveal",
        category: "file_access",
        description: "Submit hidden file names discovered during a sweep",
        usage: "sweep.reveal <name1> <name2> ...",
        examples: ["sweep.reveal .secret.key .backdoor_cfg"],
      },
    ];
  }
}
