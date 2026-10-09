/**
 * FileAccessCommandsModule — Commands for finding hidden files.
 *
 * Commands:
 *   sweep           — Scan current directory for hidden files (forensics minigame)
 *   sweep.reveal    — Submit answer to sweep challenge
 *   breach          — Open a protected directory on another player's home (memory_trace)
 *   breach.extract  — Submit the breach answer
 */

import type { Command, CommandResult, MinigameChallenge } from "../../../../shared/types";
import type { CommandContext, CommandInfo, CommandModule } from "./interface";
import { errorResult, getSession, resolvePath, spawnBackgroundProcess, successResult } from "./helpers";
import {
  generateAnomalyScanChallenge,
  generateDiskSectorChallenge,
  validateSweepAnswer,
} from "../fileAccessMinigameGenerator";
import { generateMemoryTraceChallenge, validateAnswer } from "../hackMinigameGenerator";

import logger from "../../logger";
import { publicChallenge } from "../../utils/publicChallenge";
import { servers } from "./deps";

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

interface BreachSession {
  challenge: MinigameChallenge;
  serverId: string;
  dirId: string;
  path: string;
  expiresAt: number;
  attemptsLeft: number;
}

const activeBreachSessions = new Map<string, BreachSession>();

// Cleanup expired sessions periodically
// O9: unref'd. This prunes an in-memory Map only — it touches no
// database and has no service to own a stop() — so keeping the
// process alive is the only harm it could do.
setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of activeSweepSessions) {
    if (now > session.expiresAt) {
      activeSweepSessions.delete(userId);
    }
  }
  for (const [userId, session] of activeBreachSessions) {
    if (now > session.expiresAt) activeBreachSessions.delete(userId);
  }
}, 30_000).unref?.();

// ═══════════════════════════════════════════════════════════════════
// Module
// ═══════════════════════════════════════════════════════════════════

export class FileAccessCommandsModule implements CommandModule {
  public category = "file_access";
  public commands = new Set([
    "sweep",
    "sweep.reveal",
    "breach",
    "breach.extract",
  ]);

  async execute(command: Command, context: CommandContext): Promise<CommandResult> {
    switch (command.command) {
      case "sweep":
        return this.handleSweep(command, context);
      case "sweep.reveal":
        return this.handleSweepReveal(command, context);
      case "breach":
        return this.handleBreach(command, context);
      case "breach.extract":
        return this.handleBreachExtract(command, context);
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
    const currentDir = session.currentDirectory || "/"; // not terminals[0]: `cd` never updates it (helpers.ts getSessionContext)

    // Check if already in a sweep session
    if (activeSweepSessions.has(context.userId)) {
      return errorResult("Sweep session already active. Use 'sweep.reveal <names>' to submit or wait for it to expire.");
    }

    // Get player skills
    const progress = await context.playerProgress.get(context.userId);
    const forensics = progress?.forensics ?? 0;

    // Spawn background process
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
    return spawn.result;
  }

  private async executeSweep(
    context: CommandContext,
    serverId: string,
    directoryPath: string,
    forensics: number,
  ): Promise<void> {
    const lock = await context.fileService.lockOnPath(context.userId, serverId, directoryPath);
    if (lock) {
      this.emitResult(context, false, `${lock.path} is PROTECTED. Breach it first: 'breach ${lock.path}'`);
      return;
    }
    // Resolve directory to get its node ID
    const dirResult = await context.fileService.resolvePath(serverId, directoryPath);
    if (!dirResult.exists || !dirResult.nodeId) {
      this.emitResult(context, false, `Directory not found: ${directoryPath}`);
      return;
    }

    // Query hidden files in this directory
    const { hidden: hiddenNodes, visible: visibleNodes } =
      await context.fileService.listChildrenByVisibility(dirResult.nodeId);

    if (hiddenNodes.length === 0) {
      this.emitResult(context, true, "Sweep complete. No hidden anomalies detected in this directory.");
      return;
    }


    // Get server security level
    const server = await servers().findById(serverId);
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
          challenge: publicChallenge(challenge),
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
        // D8 — previously uncapped.
        await context.playerProgress.addSkill(
          context.userId,
          "forensics",
          5 + sweepSession.challenge.difficulty,
        );
      } catch (err) { logger.warn({ err }, "fileAccessCommands.handleSweepReveal: non-critical step failed"); }

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
  // BREACH — open a protected directory (maintainer decision Q9, 2026-10-09)
  //
  // `protect` promised that protected directories "require memory_trace
  // minigame to access"; nothing implemented it, and intruders could ls, cd
  // and cat inside freely. fileService.lockedProtection is the gate; this is
  // the way through it. A win opens the directory until the player leaves
  // the server.
  // ═══════════════════════════════════════════════════════════════

  private async handleBreach(command: Command, context: CommandContext): Promise<CommandResult> {
    const session = getSession(context);
    if (!session?.currentServerId) return errorResult("Not connected to any server.");
    const target = command.args[0];
    if (!target) return errorResult("Usage: breach <directory>");
    if (activeBreachSessions.has(context.userId)) {
      return errorResult("Breach already in progress. Submit with 'breach.extract <address> <hex_token>'.");
    }

    const serverId = session.currentServerId;
    const path = resolvePath(target, session.currentDirectory || "/");
    // The lock first: inside an unbreached directory, say so whether or not
    // the path exists (lockOnPath).
    const lock = await context.fileService.lockOnPath(context.userId, serverId, path);
    const resolution = await context.fileService.resolvePath(serverId, path);
    const isTarget = !!lock && resolution.exists && resolution.nodeId === lock.id;
    if (lock && !isTarget) {
      return errorResult(`${path} is inside ${lock.path}, which is protected. Breach that first: 'breach ${lock.path}'`);
    }
    if (!resolution.exists || !resolution.nodeId || !resolution.isDirectory) {
      return errorResult(`Directory not found: ${path}`);
    }
    if (!lock) return successResult(`${path} is open to you — nothing to breach.`);

    // The defender's vault makes the dump harder; the attacker's skills add hints.
    const server = await servers().findById(serverId);
    const ownerVault = server?.ownerId ? (await context.playerProgress.get(server.ownerId))?.homeVault ?? 0 : 0;
    const progress = await context.playerProgress.get(context.userId);
    const raw = generateMemoryTraceChallenge(4 + ownerVault, {
      hacking: progress?.hacking ?? 0,
      forensics: progress?.forensics ?? 0,
    });
    // The generator is shared with hack sessions, whose submit command differs.
    const challenge: MinigameChallenge = {
      ...raw,
      displayText: raw.displayText.map((l) =>
        l.startsWith("Submit with:") ? "Submit with: breach.extract <address> <hex_token>" : l),
    };

    activeBreachSessions.set(context.userId, {
      challenge,
      serverId,
      dirId: lock.id,
      path: lock.path,
      expiresAt: Date.now() + challenge.timeLimit * 1000 + 5000, // +5s grace
      attemptsLeft: challenge.maxAttempts,
    });

    return {
      success: true,
      output: challenge.displayText.join("\n"),
      data: {
        fileAccessSessionId: `breach_${Date.now().toString(36)}`,
        fileAccessType: "breach",
        challenge: publicChallenge(challenge),
        targetDir: lock.path,
      },
      timestamp: new Date(),
    };
  }

  private async handleBreachExtract(command: Command, context: CommandContext): Promise<CommandResult> {
    const breach = activeBreachSessions.get(context.userId);
    if (!breach) return errorResult("No breach in progress. Run 'breach <directory>' first.");

    const resolved = (output: string, success: boolean): CommandResult =>
      ({ success, output, data: { fileAccessResolved: true }, timestamp: new Date() });

    if (Date.now() > breach.expiresAt) {
      activeBreachSessions.delete(context.userId);
      return resolved("The trace window closed. Run 'breach' again.", false);
    }
    // The breach is held against the server it was started on.
    if (getSession(context)?.currentServerId !== breach.serverId) {
      activeBreachSessions.delete(context.userId);
      return resolved("You left the server. Breach aborted.", false);
    }

    const answer = command.args.join(" ").trim();
    if (!answer) return errorResult("Usage: breach.extract <address> <hex_token>");

    const { correct, feedback } = validateAnswer(breach.challenge, answer);
    if (correct) {
      activeBreachSessions.delete(context.userId);
      if (!(await context.fileService.grantBreach(context.userId, breach.serverId, breach.dirId))) {
        return resolved("You are no longer connected to that server. Breach lost.", false);
      }
      try {
        await context.playerProgress.addSkill(context.userId, "hacking", 5 + breach.challenge.difficulty);
      } catch (err) { logger.warn({ err }, "fileAccessCommands.handleBreachExtract: non-critical step failed"); }
      return resolved(`${feedback}\n${breach.path} is open until you leave this server.`, true);
    }

    breach.attemptsLeft--;
    if (breach.attemptsLeft <= 0) {
      activeBreachSessions.delete(context.userId);
      return resolved(`${feedback}\nAll attempts exhausted. Breach failed.`, false);
    }
    return errorResult(`${feedback} ${breach.attemptsLeft} attempt(s) remaining.`);
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
      {
        command: "breach",
        category: "file_access",
        description: "Break into a protected directory on another player's home (memory trace)",
        usage: "breach <directory>",
        examples: ["breach /home/target/vault"],
      },
      {
        command: "breach.extract",
        category: "file_access",
        description: "Submit the address and token found in a breach memory dump",
        usage: "breach.extract <address> <hex_token>",
        examples: ["breach.extract 0x7F0120 BEEFCAFE"],
      },
    ];
  }
}
