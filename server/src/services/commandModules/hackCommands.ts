import { Command, CommandResult, HackMethod, MinigameChallenge } from "../../../../shared/types";
import {
  generateBruteForceChallenge,
  generateCipherStormChallenge,
  generateEntropyOverloadChallenge,
  validateCrackStrategy,
  validateStormAnswer,
} from "../fileAccessMinigameGenerator";
import { CommandModule, CommandContext } from "./interface";
import {
  boxTop,
  boxBottom,
  boxRow,
  boxDivider,
  boxCenter,
  sBoxTop,
  sBoxRow,
  sBoxBottom,
  pad,
  padRight,
  formatDuration,
  progressBar,
  render,
} from "./asciiBox";
import { successResult, errorResult } from "./helpers";
import logger from "../../logger";

/**
 * HackCommandsModule
 * Handles hacking related commands such as:
 *   - hack: attempt to hack a target server
 *   - crack: crack encryption on a message
 *   - exploit: use an exploit tool against a server
 *   - backdoor: install a backdoor on a compromised server
 *   - rootkit: install a rootkit for persistent access
 *   - scan: (delegated to NetworkCommandsModule) placeholder here
 */
// ── File crack session management ──────────────────────────────────
interface FileCrackSession {
  sessionId: string;
  challenge: MinigameChallenge;
  serverId: string;
  fileId: string;
  filePath: string;
  expiresAt: number;
  attemptsLeft: number;
}

const activeFileCrackSessions = new Map<string, FileCrackSession>();
const activeStormSessions = new Map<string, FileCrackSession>();

// Cleanup expired sessions
setInterval(() => {
  const now = Date.now();
  for (const [uid, s] of activeFileCrackSessions) {
    if (now > s.expiresAt) activeFileCrackSessions.delete(uid);
  }
  for (const [uid, s] of activeStormSessions) {
    if (now > s.expiresAt) activeStormSessions.delete(uid);
  }
}, 30_000);

export class HackCommandsModule implements CommandModule {
  public category = "hack";
  public commands: Set<string> = new Set([
    "hack",
    "crack",
    "exploit",
    "backdoor",
    "rootkit",
    "crack.submit",
    "firewall.knock",
    "memory.extract",
    "hack.hint",
    "hack.status",
    "hack.abort",
    "backdoor.list",
    "backdoor.use",
    "backdoor.remove",
    "security.scan",
    "trace.status",
    "trace.evade",
    // File encryption cracking
    "crack.dict",
    "crack.mask",
    "crack.pattern",
    "crack.protected",
    "crack.storm",
    "crack.storm.submit",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "hack":
          return await this.handleHack(command, context);
        case "crack":
          return await this.handleCrack(command, context);
        case "exploit":
          return await this.handleExploit(command, context);
        case "backdoor":
          return await this.handleBackdoor(command, context);
        case "rootkit":
          return await this.handleRootkit(command, context);
        case "crack.submit":
          return await this.handleCrackSubmit(command, context);
        case "firewall.knock":
          return await this.handleFirewallKnock(command, context);
        case "memory.extract":
          return await this.handleMemoryExtract(command, context);
        case "hack.hint":
          return await this.handleHackHint(command, context);
        case "hack.status":
          return await this.handleHackStatus(command, context);
        case "hack.abort":
          return await this.handleHackAbort(command, context);
        case "backdoor.list":
          return await this.handleBackdoorList(command, context);
        case "backdoor.use":
          return await this.handleBackdoorUse(command, context);
        case "backdoor.remove":
          return await this.handleBackdoorRemove(command, context);
        case "security.scan":
          return await this.handleSecurityScan(command, context);
        case "trace.status":
          return await this.handleTraceStatus(command, context);
        case "trace.evade":
          return await this.handleTraceEvade(command, context);
        case "crack.dict":
        case "crack.mask":
        case "crack.pattern":
          return await this.handleCrackStrategy(command, context);
        case "crack.protected":
          return await this.handleCrackProtected(command, context);
        case "crack.storm":
          return await this.handleCrackStorm(command, context);
        case "crack.storm.submit":
          return await this.handleCrackStormSubmit(command, context);
        default:
          return errorResult(`Hack command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("Hack command failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "hack",
        category: "hack",
        description: "[Hacking 20] Attempt to hack a target server",
        usage: "hack <target_ip> [--method <method>] [--tools <tool1,tool2>]",
        examples: ["hack 192.168.1.1", "hack 10.0.0.5 --method exploit"],
      },
      {
        command: "crack",
        category: "hack",
        description: "[Hacking 30] Crack encryption on a file or message",
        usage: "crack <filename|message_id>",
        examples: ["crack secrets.db", "crack msg_12345"],
      },
      {
        command: "exploit",
        category: "hack",
        description: "[Hacking 40] Use an exploit against a server",
        usage: "exploit <target_ip> <exploit_name>",
        examples: ["exploit 192.168.1.1 buffer_overflow"],
      },
      {
        command: "backdoor",
        category: "hack",
        description: "[Hacking 50] Install a backdoor on compromised server",
        usage: "backdoor <target_ip>",
        examples: ["backdoor 192.168.1.1"],
      },
      {
        command: "rootkit",
        category: "hack",
        description: "[Hacking 60] Install rootkit for persistent access",
        usage: "rootkit <target_ip>",
        examples: ["rootkit 192.168.1.1"],
      },
      {
        command: "crack.submit",
        category: "hack",
        description:
          "[Crypto 5] Submit decrypted plaintext for cipher challenge",
        usage: "crack.submit <decrypted plaintext>",
        examples: ["crack.submit HELLO WORLD ACCESS GRANTED"],
      },
      {
        command: "firewall.knock",
        category: "hack",
        description:
          "[Network 5] Submit port knock sequence for firewall challenge",
        usage: "firewall.knock <port1> <port2> ...",
        examples: ["firewall.knock 22 1337 4444 9090"],
      },
      {
        command: "memory.extract",
        category: "hack",
        description: "[Forensics 5] Extract access token from memory dump",
        usage: "memory.extract <address> <hex_token>",
        examples: ["memory.extract 0x7F0120 BEEFCAFE"],
      },
      {
        command: "hack.hint",
        category: "hack",
        description:
          "Request a hint for current hack layer (costs +10% detection)",
        usage: "hack.hint",
      },
      {
        command: "hack.status",
        category: "hack",
        description: "Show current hack session status",
        usage: "hack.status",
      },
      {
        command: "hack.abort",
        category: "hack",
        description: "Abort current hack session (partial detection applied)",
        usage: "hack.abort",
      },
      {
        command: "backdoor.list",
        category: "hack",
        description:
          "[Hacking 15] List your installed backdoors on remote servers",
        usage: "backdoor.list",
      },
      {
        command: "backdoor.use",
        category: "hack",
        description:
          "[Stealth 20] Use an installed backdoor to access a server",
        usage: "backdoor.use <target_ip>",
        examples: ["backdoor.use 192.168.1.1"],
      },
      {
        command: "backdoor.remove",
        category: "hack",
        description:
          "[Stealth 15] Remove an installed backdoor (clean your traces)",
        usage: "backdoor.remove <target_ip>",
        examples: ["backdoor.remove 192.168.1.1"],
      },
      {
        command: "security.scan",
        category: "hack",
        description:
          "[Forensics 15] Scan one of your servers for installed backdoors",
        usage: "security.scan <server_ip>",
        examples: ["security.scan 10.0.0.1"],
      },
      {
        command: "trace.status",
        category: "hack",
        description: "View active traces targeting you or initiated by you",
        usage: "trace.status",
      },
      {
        command: "trace.evade",
        category: "hack",
        description:
          "[Stealth 25] Attempt to evade an active trace (costs stealth XP)",
        usage: "trace.evade <trace_id>",
        examples: ["trace.evade clxyz12345"],
      },
      // ── File encryption cracking ──
      {
        command: "crack.dict",
        category: "hack",
        description: "[Crypto 20] Dictionary attack on encrypted file (use after 'crack <file>')",
        usage: "crack.dict",
      },
      {
        command: "crack.mask",
        category: "hack",
        description: "[Crypto 25] Brute force with charset constraint (use after 'crack <file>')",
        usage: "crack.mask <charset>",
        examples: ["crack.mask a-z", "crack.mask a-z0-9"],
      },
      {
        command: "crack.pattern",
        category: "hack",
        description: "[Crypto 20] Pattern-based attack on encrypted file (use after 'crack <file>')",
        usage: "crack.pattern",
      },
      {
        command: "crack.protected",
        category: "hack",
        description: "[Crypto 40] Bypass file protection using a Quantum Charge item",
        usage: "crack.protected <filename>",
        examples: ["crack.protected vault.db"],
      },
      {
        command: "crack.storm",
        category: "hack",
        description: "[Crypto 50] Near-impossible minigame to crack protected files without items",
        usage: "crack.storm <filename>",
        examples: ["crack.storm classified.enc"],
      },
      {
        command: "crack.storm.submit",
        category: "hack",
        description: "Submit answer for an active storm challenge",
        usage: "crack.storm.submit <answer>",
        examples: ["crack.storm.submit ALPHA BRAVO DELTA", "crack.storm.submit 5 3"],
      },
    ];
  }

  // ---------------------------------------------------------------------
  // Individual command handlers (simplified placeholders – real logic lives
  // in HackService and related services). They return a CommandResult that
  // mirrors the existing legacy implementation.
  // ---------------------------------------------------------------------

  private async handleHack(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return errorResult("Usage: hack <target_ip> [--method <method>] [--tools <tool1,tool2,...>]");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) {
      return errorResult("No active session");
    }

    // Resolve target server and owner from IP address
    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return errorResult(targetResolution.error || "Failed to resolve target");
    }

    const { serverId, ownerId } = targetResolution;
    const method = this.parseHackMethod(command.args);
    const tools = this.parseTools(command.args);
    const hackService = context.services.hackService;
    const memoryService = context.services.memoryService;

    // ── Resource check: can we afford the hack prep process? ──
    if (memoryService) {
      // Get player's hacking skill for duration scaling
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { hacking: true, level: true },
      });
      const hackingSkill = progress?.hacking ?? 1;

      // Ensure computer spec is initialized
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "hack_prep");
      if (!check.allowed) {
        const spec = memoryService.getComputerSpec(context.userId);
        const W = context.terminalWidth;
        const lines: string[] = [];
        lines.push(sBoxTop(W));
        lines.push(sBoxRow(" [!] INSUFFICIENT RESOURCES", W));
        lines.push(sBoxRow("", W));
        lines.push(sBoxRow(` ${check.reason}`, W));
        lines.push(sBoxRow("", W));
        lines.push(sBoxRow(` CPU: ${spec.cpuUsed}/${spec.cpuTotal}  RAM: ${spec.ramUsed}/${spec.ramTotal}MB`, W));
        lines.push(sBoxRow(` BW:  ${spec.bwUsed}/${spec.bwTotal}Mbps`, W));
        lines.push(sBoxRow("", W));
        lines.push(sBoxRow(" Use 'ps' to see running processes.", W));
        lines.push(sBoxRow(" Use 'kill <pid>' to free resources.", W));
        lines.push(sBoxBottom(W));
        return errorResult(render(lines));
      }

      // Check if player set a priority via 'nice' command
      const sessionPriority = (session as any)._nextProcessPriority ?? 0;
      delete (session as any)._nextProcessPriority;

      // Spawn hack prep process — minigame starts when it completes
      const proc = memoryService.spawnGameProcess(
        context.userId,
        session.socketId,
        "hack_prep",
        hackingSkill,
        targetIp,
        serverId,
        async () => {
          // ── On completion: start the actual hack minigame ──
          // Pass detection modifier from process priority
          const detMod = proc!.detectionModifier;
          try {
            const result = await hackService.initiateHackSession(
              context.userId,
              ownerId!,
              serverId!,
              method,
              tools,
              detMod,
            );

            // Push minigame start to player via Socket.IO
            if (context.io) {
              if (result.success) {
                const cbSubmitCmds: Record<string, string> = {
                  cipher: "crack.submit", port_sequence: "firewall.knock", memory_trace: "memory.extract",
                };
                const cbChallengeType = result.challenge?.type || "cipher";
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: true,
                  output: result.output || ["Exploit ready. Security challenge initiated."],
                  data: {
                    sessionId: result.session?.id,
                    targetIp,
                    challenge: result.challenge,
                    totalLayers: result.session?.totalLayers,
                  },
                  suggestedCommand: cbSubmitCmds[cbChallengeType] || "crack.submit",
                  soundEvent: "alert",
                  timestamp: new Date(),
                });
              } else {
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: false,
                  output: result.error || "Exploit failed to deploy.",
                  timestamp: new Date(),
                });
              }
            }
          } catch (err) {
            logger.error({ err, targetIp }, "Hack prep completion failed");
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Exploit preparation failed unexpectedly.",
                timestamp: new Date(),
              });
            }
          }
        },
        {
          method, tools, serverId, ownerId,
          onCancel: async () => {
            // Partial detection: 20% chance the target logs a suspicious probe
            const detected = Math.random() < 0.2;
            if (detected && serverId) {
              const { db } = await import("../../database/client");
              await db.client.hackLog.create({
                data: {
                  attackerId: context.userId,
                  targetId: ownerId!,
                  targetServerId: serverId!,
                  method: method || "bruteforce",
                  tools: tools,
                  stealthLevel: 0,
                  success: false,
                  detected: true,
                  evidenceLeft: 10,
                  accessLevel: 0,
                  timestamp: new Date(),
                },
              }).catch(() => {});
            }
            // Apply half cooldown (15s instead of 30s) to prevent rapid retries
            hackService.applyCooldown(context.userId, 15);
          },
        },
        sessionPriority,
      );

      if (!proc) {
        return errorResult("Failed to start hack process. Insufficient resources.");
      }

      // Return immediately — hack runs in background
      const etaSec = Math.ceil(proc.duration / 1000);
      const spec = memoryService.getComputerSpec(context.userId);
      const W = context.terminalWidth;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("EXPLOIT PREPARATION", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(` Target:  ${targetIp}`, W));
      lines.push(boxRow(` Method:  ${method}`, W));
      lines.push(boxRow(` ETA:     ${etaSec}s`, W));
      lines.push(boxRow(` PID:     ${proc.pid}`, W));
      lines.push(boxDivider(W));
      lines.push(boxRow(` CPU: ${spec.cpuUsed}/${spec.cpuTotal}  RAM: ${spec.ramUsed}/${spec.ramTotal}MB  BW: ${spec.bwUsed}/${spec.bwTotal}`, W));
      lines.push(boxDivider(W));
      lines.push(boxRow(" Process running in background.", W));
      lines.push(boxRow(" Use 'ps' to monitor, 'kill " + proc.pid + "' to abort.", W));
      lines.push(boxBottom(W));

      return successResult(render(lines));
    }

    // ── Fallback: no resource system — direct hack (legacy) ──
    const result = await hackService.initiateHackSession(
      context.userId,
      ownerId!,
      serverId!,
      method,
      tools,
    );

    if (!result.success) {
      return errorResult(result.error || "Failed to initiate hack session");
    }

    // Determine the submit command for this challenge type
    const challengeSubmitCmds: Record<string, string> = {
      cipher: "crack.submit",
      port_sequence: "firewall.knock",
      memory_trace: "memory.extract",
    };
    const challengeType = result.challenge?.type || "cipher";
    const submitCmd = challengeSubmitCmds[challengeType] || "crack.submit";

    return {
      success: true,
      output: result.output || ["Hack session initiated."],
      data: {
        sessionId: result.session!.id,
        targetIp,
        challenge: result.challenge,
        totalLayers: result.session?.totalLayers,
      },
      suggestedCommand: submitCmd,
      soundEvent: "alert" as const,
      timestamp: new Date(),
    };
  }

  // ==================== MINIGAME COMMAND HANDLERS ====================

  private async handleCrackSubmit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const answer = command.args?.join(" ");
    if (!answer) {
      return errorResult("Usage: crack.submit <decrypted plaintext>");
    }

    const hackService = context.services.hackService;
    const session = hackService.getActiveSession(context.userId);
    if (!session || session.layers[session.currentLayer]?.type !== "cipher") {
      return errorResult("No active cipher challenge. Use crack.submit during the encryption layer.");
    }

    const result = await hackService.submitLayerAnswer(context.userId, answer);
    return {
      success: result.success,
      output: result.output || [
        result.feedback || result.error || "Unknown error",
      ],
      data: {
        ...(result.nextChallenge ? { nextChallenge: result.nextChallenge } : {}),
        ...(result.finalResult ? { ...result.finalResult, hackResolved: true } : {}),
      },
      timestamp: new Date(),
    };
  }

  private async handleFirewallKnock(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const ports = command.args?.join(" ");
    if (!ports) {
      return errorResult("Usage: firewall.knock <port1> <port2> ...");
    }

    const hackService = context.services.hackService;
    const session = hackService.getActiveSession(context.userId);
    if (
      !session ||
      session.layers[session.currentLayer]?.type !== "port_sequence"
    ) {
      return errorResult("No active firewall challenge. Use firewall.knock during the port knock layer.");
    }

    const result = await hackService.submitLayerAnswer(context.userId, ports);
    return {
      success: result.success,
      output: result.output || [
        result.feedback || result.error || "Unknown error",
      ],
      data: {
        ...(result.nextChallenge ? { nextChallenge: result.nextChallenge } : {}),
        ...(result.finalResult ? { ...result.finalResult, hackResolved: true } : {}),
      },
      timestamp: new Date(),
    };
  }

  private async handleMemoryExtract(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const answer = command.args?.join(" ");
    if (!answer) {
      return errorResult("Usage: memory.extract <address> <hex_token>");
    }

    const hackService = context.services.hackService;
    const session = hackService.getActiveSession(context.userId);
    if (
      !session ||
      session.layers[session.currentLayer]?.type !== "memory_trace"
    ) {
      return errorResult("No active memory trace challenge. Use memory.extract during the IDS layer.");
    }

    const result = await hackService.submitLayerAnswer(context.userId, answer);
    return {
      success: result.success,
      output: result.output || [
        result.feedback || result.error || "Unknown error",
      ],
      data: {
        ...(result.nextChallenge ? { nextChallenge: result.nextChallenge } : {}),
        ...(result.finalResult ? { ...result.finalResult, hackResolved: true } : {}),
      },
      timestamp: new Date(),
    };
  }

  private async handleHackHint(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const hackService = context.services.hackService;
    const result = hackService.getHint(context.userId);
    return {
      success: result.success,
      output: result.output || [result.error || "No hints available."],
      timestamp: new Date(),
    };
  }

  private async handleHackStatus(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const hackService = context.services.hackService;
    const result = hackService.getSessionStatus(context.userId);
    return {
      success: result.success,
      output: result.output || [result.error || "No active session."],
      timestamp: new Date(),
    };
  }

  private async handleHackAbort(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const hackService = context.services.hackService;
    const result = await hackService.abortSession(context.userId);
    return {
      success: result.success,
      output: result.output || ["Hack session aborted."],
      data: result.result,
      timestamp: new Date(),
    };
  }

  /**
   * Resolve target server and owner from IP address or server name
   */
  private async resolveHackTarget(
    targetIdentifier: string,
    context: CommandContext,
  ): Promise<{
    success: boolean;
    serverId?: string;
    ownerId?: string;
    error?: string;
  }> {
    try {
      const { db } = context;

      // Try to find server by IP address or name
      const server = await db.client.gameServer.findFirst({
        where: {
          OR: [{ ipAddress: targetIdentifier }, { name: targetIdentifier }],
        },
        select: {
          id: true,
          ownerId: true,
          name: true,
          ipAddress: true,
        },
      });

      if (!server) {
        return {
          success: false,
          error: `Target server not found: ${targetIdentifier}`,
        };
      }

      if (server.ownerId === context.userId) {
        return {
          success: false,
          error: "Cannot hack your own server",
        };
      }

      if (!server.ownerId) {
        return {
          success: false,
          error: "Target server has no owner",
        };
      }

      return {
        success: true,
        serverId: server.id,
        ownerId: server.ownerId,
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to resolve target: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Parse hack method from command arguments
   */
  private parseHackMethod(args?: string[]): HackMethod {
    if (!args) return HackMethod.BRUTEFORCE;

    const methodIndex = args.findIndex(
      (arg) => arg === "--method" || arg === "-m",
    );
    if (methodIndex === -1 || methodIndex >= args.length - 1) {
      return HackMethod.BRUTEFORCE;
    }

    const methodValue = args[methodIndex + 1];
    if (!methodValue) return HackMethod.BRUTEFORCE;

    const methodArg = methodValue.toUpperCase();

    // Map string to HackMethod enum
    const methodMap: Record<string, HackMethod> = {
      BRUTEFORCE: HackMethod.BRUTEFORCE,
      BRUTE: HackMethod.BRUTEFORCE,
      EXPLOIT: HackMethod.EXPLOIT,
      SOCIAL: HackMethod.SOCIAL,
      BACKDOOR: HackMethod.BACKDOOR,
      SQL_INJECTION: HackMethod.SQL_INJECTION,
      SQL: HackMethod.SQL_INJECTION,
      PHISHING: HackMethod.PHISHING,
      ROOTKIT: HackMethod.ROOTKIT,
    };

    return methodMap[methodArg] || HackMethod.BRUTEFORCE;
  }

  /**
   * Parse tools from command arguments
   */
  private parseTools(args?: string[]): string[] {
    if (!args) return [];

    const toolsIndex = args.findIndex(
      (arg) => arg === "--tools" || arg === "-t",
    );
    if (toolsIndex === -1 || toolsIndex >= args.length - 1) {
      return [];
    }

    const toolsArg = args[toolsIndex + 1];
    if (!toolsArg) return [];

    return toolsArg
      .split(",")
      .map((tool) => tool.trim().toLowerCase())
      .filter(Boolean);
  }

  private async handleCrack(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args?.[0];
    if (!target) {
      return errorResult("Usage: crack <filename> or crack <message_id>");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) return errorResult("No active session");

    // Try resolving as a file first (file crack flow)
    if (session.currentServerId) {
      const currentDir = session.terminals?.[0]?.currentDirectory || "/";
      const filePath = target.startsWith("/") ? target : `${currentDir === "/" ? "" : currentDir}/${target}`;
      const fileResult = await context.fileService.readFile(session.currentServerId, context.userId, filePath);

      if (fileResult.success || fileResult.error === "ENCRYPTED") {
        return this.handleCrackFile(command, context, session.currentServerId, filePath, target);
      }
    }

    // Fall back to message crack flow
    return this.handleCrackMessage(target, context, session);
  }

  /** Crack an encrypted file — shows brute force analysis panel. */
  private async handleCrackFile(
    _command: Command,
    context: CommandContext,
    serverId: string,
    filePath: string,
    fileName: string,
  ): Promise<CommandResult> {
    // Find the file node
    const resolution = await context.fileService.resolvePath(serverId, filePath);
    if (!resolution.exists || !resolution.node) {
      return errorResult(`File not found: ${fileName}`);
    }

    const fileNode = resolution.node as any;
    if (!fileNode.isEncrypted) {
      return successResult(`${fileName} is not encrypted.`);
    }
    if (fileNode.isProtected) {
      return errorResult(`${fileName} is PROTECTED. Use 'crack.storm ${fileName}', 'crack.protected ${fileName}' (requires Quantum Charge), or 'fragment.crack ${fileName}'.`);
    }

    // Check if already in a crack session
    if (activeFileCrackSessions.has(context.userId)) {
      return errorResult("File crack session already active. Choose a strategy (crack.dict, crack.mask, crack.pattern) or wait for it to expire.");
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { cryptography: true },
    });
    const cryptography = progress?.cryptography ?? 0;

    // Determine encryption metadata
    const metadata = (fileNode.metadata as any) || {};
    const encryptionKey = fileNode.encryptionKey || metadata.encryptionKey || null;

    const challenge = generateBruteForceChallenge(
      fileNode.encryptionLevel || Math.min(10, Math.max(1, Math.floor((fileNode.size || 500) / 500))),
      { id: fileNode.id, name: fileName, encryptionKey, metadata },
      { cryptography },
    );

    const sessionId = `crack_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    activeFileCrackSessions.set(context.userId, {
      sessionId,
      challenge,
      serverId,
      fileId: fileNode.id,
      filePath,
      expiresAt: Date.now() + challenge.timeLimit * 1000 + 5000,
      attemptsLeft: challenge.maxAttempts,
    });

    const output = challenge.displayText.join("\n") +
      (challenge.hints.length > 0 ? "\n\n" + challenge.hints.map(h => `hint: ${h}`).join("\n") : "");

    if (context.io) {
      context.io.to(`player:${context.userId}`).emit("command:result", {
        success: true,
        output,
        data: {
          fileAccessSessionId: sessionId,
          fileAccessType: "crack",
          challenge,
          targetFile: fileName,
        },
        timestamp: new Date(),
      });
    }

    return successResult("Encryption analysis loaded. Choose your attack strategy from the panel above.");
  }

  /** Original message crack flow. */
  private async handleCrackMessage(
    messageId: string,
    context: CommandContext,
    session: any,
  ): Promise<CommandResult> {
    const memoryService = context.services.memoryService;
    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { cryptography: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "decrypt");
      if (!check.allowed) {
        return errorResult(`Insufficient resources: ${check.reason}\nUse 'ps' to see running processes, 'kill <pid>' to free resources.`);
      }

      const userId = context.userId;
      const proc = memoryService.spawnGameProcess(
        userId, session.socketId, "decrypt", progress?.cryptography ?? 1, messageId, undefined,
        async () => {
          const result = await context.services.messageEncryptionService!.crackEncryption(messageId, userId);
          if (context.io) {
            context.io.to(`player:${userId}`).emit("command:result", {
              success: result.success,
              output: result.success ? `Encryption cracked on message ${messageId}` : `Failed to crack encryption: ${result.message || "unknown error"}`,
              timestamp: new Date(),
            });
          }
        },
      );

      if (!proc) return errorResult("Failed to start crack process.");
      const etaSec = Math.ceil(proc.duration / 1000);
      return successResult(`Cracking encryption... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor progress.`);
    }

    const result = await context.services.messageEncryptionService!.crackEncryption(messageId, context.userId);
    return result.success ? successResult("Encryption cracked successfully") : errorResult("Failed to crack encryption");
  }

  // ═══════════════════════════════════════════════════════════════
  // CRACK STRATEGY — dict/mask/pattern
  // ═══════════════════════════════════════════════════════════════

  private async handleCrackStrategy(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const crackSession = activeFileCrackSessions.get(context.userId);
    if (!crackSession) {
      return errorResult("No active file crack session. Run 'crack <filename>' first.");
    }
    if (Date.now() > crackSession.expiresAt) {
      activeFileCrackSessions.delete(context.userId);
      return {
        success: false,
        output: "Crack session expired. Run 'crack <filename>' again.",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    const strategyMap: Record<string, "dict" | "mask" | "pattern"> = {
      "crack.dict": "dict",
      "crack.mask": "mask",
      "crack.pattern": "pattern",
    };
    const strategy = strategyMap[command.command];
    if (!strategy) return errorResult("Unknown strategy.");

    const { isCorrect, successMultiplier } = validateCrackStrategy(crackSession.challenge, strategy);

    // Get crypto skill for success calculation
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { cryptography: true },
    });
    const cryptography = progress?.cryptography ?? 0;

    // Success chance: base 50% + skill modifier, scaled by strategy correctness
    const baseChance = 0.5 + (cryptography / 200); // 50-100% at skill 0-100
    const finalChance = Math.min(0.95, Math.max(0.1, baseChance * successMultiplier));
    const success = Math.random() < finalChance;

    if (success) {
      // Decrypt the file
      await context.db.client.fileSystemNode.update({
        where: { id: crackSession.fileId },
        data: { isEncrypted: false, encryptionKey: null },
      });

      // Award XP
      const xpGain = 5 + (crackSession.challenge.difficulty * 2) + (isCorrect ? 5 : 0);
      try {
        await context.db.client.playerProgress.update({
          where: { userId: context.userId },
          data: { cryptography: { increment: xpGain } },
        });
      } catch { /* non-critical */ }

      activeFileCrackSessions.delete(context.userId);

      const strategyLabel = isCorrect ? "Optimal strategy!" : "Suboptimal strategy, but it worked.";
      return {
        success: true,
        output: `Encryption cracked! ${strategyLabel}\n` +
          `File '${crackSession.challenge.metadata?.fileName}' is now readable.\n` +
          `+${xpGain} cryptography XP`,
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    // Failure
    crackSession.attemptsLeft--;
    if (crackSession.attemptsLeft <= 0) {
      activeFileCrackSessions.delete(context.userId);
      return {
        success: false,
        output: `Decryption failed. ${isCorrect ? "Bad luck." : "Wrong approach."}\n` +
          "All attempts exhausted. Run 'crack <filename>' to try again.",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    activeFileCrackSessions.delete(context.userId); // allow re-analysis
    return {
      success: false,
      output: `Decryption attempt failed. ${isCorrect ? "Almost had it." : "Try a different strategy."}\n` +
        "Run 'crack <filename>' to analyze again.",
      data: { fileAccessResolved: true },
      timestamp: new Date(),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // CRACK.PROTECTED — Quantum Charge item
  // ═══════════════════════════════════════════════════════════════

  private async handleCrackProtected(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const fileName = command.args?.[0];
    if (!fileName) return errorResult("Usage: crack.protected <filename>");

    const session = context.gameStateManager.getSession(context.userId);
    if (!session?.currentServerId) return errorResult("Not connected to any server.");

    const currentDir = session.terminals?.[0]?.currentDirectory || "/";
    const filePath = fileName.startsWith("/") ? fileName : `${currentDir === "/" ? "" : currentDir}/${fileName}`;

    const resolution = await context.fileService.resolvePath(session.currentServerId, filePath);
    if (!resolution.exists || !resolution.node) return errorResult(`File not found: ${fileName}`);

    const fileNode = resolution.node as any;
    if (!fileNode.isProtected) return errorResult(`${fileName} is not protected.`);

    // Check for quantum_charge in inventory
    const inventory = await context.db.client.inventoryItem.findMany({
      where: { userId: context.userId },
      include: { shopItem: true },
    });
    const charge = inventory.find((i: any) => i.shopItem.name?.toLowerCase().includes("quantum charge") && i.quantity > 0);
    if (!charge) {
      return errorResult(
        "Requires a Quantum Decryptor Charge.\n" +
        "Buy one from the shop, or try 'crack.storm' (near-impossible minigame) or 'fragment.crack' (risky).",
      );
    }

    // Consume the charge
    if (charge.quantity <= 1) {
      await context.db.client.inventoryItem.delete({ where: { id: charge.id } });
    } else {
      await context.db.client.inventoryItem.update({
        where: { id: charge.id },
        data: { quantity: { decrement: 1 } },
      });
    }

    // Remove protection
    await context.db.client.fileSystemNode.update({
      where: { id: fileNode.id },
      data: { isProtected: false },
    });

    return successResult(
      `Quantum Decryptor activated. Protection layer dissolved.\n` +
      `File '${fileName}' is now accessible.`,
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // CRACK.STORM — Near-impossible minigame for protected files
  // ═══════════════════════════════════════════════════════════════

  private async handleCrackStorm(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const fileName = command.args?.[0];
    if (!fileName) return errorResult("Usage: crack.storm <filename>");

    const session = context.gameStateManager.getSession(context.userId);
    if (!session?.currentServerId) return errorResult("Not connected to any server.");

    if (activeStormSessions.has(context.userId)) {
      return errorResult("Storm session already active. Submit your answer with 'crack.storm.submit'.");
    }

    const currentDir = session.terminals?.[0]?.currentDirectory || "/";
    const filePath = fileName.startsWith("/") ? fileName : `${currentDir === "/" ? "" : currentDir}/${fileName}`;

    const resolution = await context.fileService.resolvePath(session.currentServerId, filePath);
    if (!resolution.exists || !resolution.node) return errorResult(`File not found: ${fileName}`);

    const fileNode = resolution.node as any;
    if (!fileNode.isProtected) return errorResult(`${fileName} is not protected. Use 'crack' instead.`);

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { cryptography: true, hacking: true },
    });
    const skills = { cryptography: progress?.cryptography ?? 0, hacking: progress?.hacking ?? 0 };

    // Randomly pick cipher storm or entropy overload
    const challenge = Math.random() < 0.5
      ? generateCipherStormChallenge(10, fileNode.id, skills)
      : generateEntropyOverloadChallenge(10, fileNode.id, skills);

    const sessionId = `storm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    activeStormSessions.set(context.userId, {
      sessionId,
      challenge,
      serverId: session.currentServerId,
      fileId: fileNode.id,
      filePath,
      expiresAt: Date.now() + challenge.timeLimit * 1000 + 5000,
      attemptsLeft: 1,
    });

    const output = challenge.displayText.join("\n") +
      (challenge.hints.length > 0 ? "\n\n" + challenge.hints.map(h => `hint: ${h}`).join("\n") : "");

    if (context.io) {
      context.io.to(`player:${context.userId}`).emit("command:result", {
        success: true,
        output,
        data: {
          fileAccessSessionId: sessionId,
          fileAccessType: "storm",
          challenge,
          targetFile: fileName,
        },
        timestamp: new Date(),
      });
    }

    return successResult("STORM challenge loaded. Solve it in the panel above. Clock is ticking.");
  }

  private async handleCrackStormSubmit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const stormSession = activeStormSessions.get(context.userId);
    if (!stormSession) return errorResult("No active storm session. Run 'crack.storm <filename>' first.");

    if (Date.now() > stormSession.expiresAt) {
      activeStormSessions.delete(context.userId);
      return {
        success: false,
        output: "Storm session expired. Time's up.",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    const answer = command.args.join(" ").trim();
    if (!answer) {
      return errorResult("Usage: crack.storm.submit <answer>");
    }

    const correct = validateStormAnswer(stormSession.challenge, answer);
    activeStormSessions.delete(context.userId);

    if (correct) {
      // Remove protection
      await context.db.client.fileSystemNode.update({
        where: { id: stormSession.fileId },
        data: { isProtected: false },
      });

      // Award big XP
      try {
        await context.db.client.playerProgress.update({
          where: { userId: context.userId },
          data: { cryptography: { increment: 25 }, hacking: { increment: 15 } },
        });
      } catch { /* non-critical */ }

      return {
        success: true,
        output: "PROTECTION BREACHED.\n" +
          `File '${stormSession.filePath.split("/").pop()}' is now accessible.\n` +
          "+25 cryptography XP, +15 hacking XP",
        data: { fileAccessResolved: true },
        timestamp: new Date(),
      };
    }

    return {
      success: false,
      output: "Incorrect. The protection holds. Session ended.",
      data: { fileAccessResolved: true },
      timestamp: new Date(),
    };
  }

  private async handleExploit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    const exploitName = command.args?.[1];
    if (!targetIp || !exploitName) {
      return errorResult("Usage: exploit <target_ip> <exploit_name>");
    }

    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return errorResult(targetResolution.error || "Failed to resolve target");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) return errorResult("No active session");

    const { serverId, ownerId } = targetResolution;
    const memoryService = context.services.memoryService;

    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { hacking: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "hack_prep");
      if (!check.allowed) {
        return errorResult(`Insufficient resources: ${check.reason}\nUse 'ps' to see running processes, 'kill <pid>' to free resources.`);
      }

      const userId = context.userId;
      const proc = memoryService.spawnGameProcess(
        userId, session.socketId, "hack_prep", progress?.hacking ?? 1, `${targetIp} (${exploitName})`, serverId,
        async () => {
          const result = await context.services.hackService.processHackAttempt(userId, ownerId!, serverId!, HackMethod.EXPLOIT, [exploitName]);
          if (context.io) {
            context.io.to(`player:${userId}`).emit("command:result", {
              success: result.success,
              output: result.success ? `Exploit ${exploitName} executed on ${targetIp}. Access level: ${result.accessLevel}` : `Exploit ${exploitName} failed on ${targetIp}`,
              timestamp: new Date(),
            });
          }
        },
      );

      if (!proc) return errorResult("Failed to start exploit process.");

      const etaSec = Math.ceil(proc.duration / 1000);
      return successResult(`Deploying exploit '${exploitName}' against ${targetIp}... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor progress.`);
    }

    // Fallback
    const result = await context.services.hackService.processHackAttempt(context.userId, ownerId!, serverId!, HackMethod.EXPLOIT, [exploitName]);
    if (result.success) {
      return successResult(`Exploit ${exploitName} executed successfully`);
    }
    return errorResult(`Exploit ${exploitName} failed`);
  }

  private async handleBackdoor(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return errorResult("Usage: backdoor <target_ip>");
    }

    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return errorResult(targetResolution.error || "Failed to resolve target");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) return errorResult("No active session");

    const { serverId, ownerId } = targetResolution;
    const memoryService = context.services.memoryService;

    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { stealth: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "backdoor_install");
      if (!check.allowed) {
        return errorResult(`Insufficient resources: ${check.reason}\nBackdoor installation is resource-intensive. Use 'kill <pid>' to free resources.`);
      }

      const userId = context.userId;
      const proc = memoryService.spawnGameProcess(
        userId, session.socketId, "backdoor_install", progress?.stealth ?? 1, targetIp, serverId,
        async () => {
          const result = await context.services.hackService.processHackAttempt(userId, ownerId!, serverId!, HackMethod.BACKDOOR, ["backdoor_tool"]);
          if (context.io) {
            context.io.to(`player:${userId}`).emit("command:result", {
              success: result.success,
              output: result.success ? `Backdoor installed on ${targetIp}. Access level: ${result.accessLevel}` : `Backdoor installation failed on ${targetIp}`,
              timestamp: new Date(),
            });
          }
        },
      );

      if (!proc) return errorResult("Failed to start backdoor install process.");

      const etaSec = Math.ceil(proc.duration / 1000);
      return successResult(`Installing backdoor on ${targetIp}... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor. This is a stealthy operation.`);
    }

    // Fallback
    const result = await context.services.hackService.processHackAttempt(context.userId, ownerId!, serverId!, HackMethod.BACKDOOR, ["backdoor_tool"]);
    if (result.success) {
      return successResult("Backdoor installed successfully");
    }
    return errorResult("Failed to install backdoor");
  }

  private async handleRootkit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return errorResult("Usage: rootkit <target_ip>");
    }

    const targetResolution = await this.resolveHackTarget(targetIp, context);
    if (!targetResolution.success) {
      return errorResult(targetResolution.error || "Failed to resolve target");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) return errorResult("No active session");

    const { serverId, ownerId } = targetResolution;
    const memoryService = context.services.memoryService;

    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { stealth: true, hacking: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      // Rootkit uses backdoor_install costs but takes longer (uses lower skill of stealth/hacking)
      const check = memoryService.canSpawnProcess(context.userId, "backdoor_install");
      if (!check.allowed) {
        return errorResult(`Insufficient resources: ${check.reason}\nRootkit deployment requires significant resources. Use 'kill <pid>' to free resources.`);
      }

      const userId = context.userId;
      const effectiveSkill = Math.min(progress?.stealth ?? 1, progress?.hacking ?? 1); // harder — uses lower skill
      const proc = memoryService.spawnGameProcess(
        userId, session.socketId, "backdoor_install", effectiveSkill, targetIp, serverId,
        async () => {
          const result = await context.services.hackService.processHackAttempt(userId, ownerId!, serverId!, HackMethod.ROOTKIT, ["rootkit_installer"]);
          if (context.io) {
            context.io.to(`player:${userId}`).emit("command:result", {
              success: result.success,
              output: result.success ? `Rootkit deployed on ${targetIp}. Persistent access established.` : `Rootkit deployment failed on ${targetIp}`,
              timestamp: new Date(),
            });
          }
        },
      );

      if (!proc) return errorResult("Failed to start rootkit deployment.");

      const etaSec = Math.ceil(proc.duration / 1000);
      return successResult(`Deploying rootkit on ${targetIp}... ETA ${etaSec}s [PID ${proc.pid}]\nThis is a deep-access operation. Use 'ps' to monitor.`);
    }

    // Fallback
    const result = await context.services.hackService.processHackAttempt(context.userId, ownerId!, serverId!, HackMethod.ROOTKIT, ["rootkit_installer"]);
    if (result.success) {
      return successResult("Rootkit installed successfully");
    }
    return errorResult("Failed to install rootkit");
  }

  // ==================== BACKDOOR COMMANDS ====================

  private async handleBackdoorList(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return errorResult("Backdoor service unavailable");
    }

    const backdoors = await backdoorService.getBackdoors(context.userId);

    if (!backdoors || backdoors.length === 0) {
      const W = context.terminalWidth;
      const lines = [
        boxTop(W),
        boxCenter("INSTALLED BACKDOORS", W),
        boxDivider(W),
        boxRow("  No active backdoors found.", W),
        boxRow("  Use  hack <ip> --method backdoor  to install one.", W),
        boxBottom(W),
      ];
      return successResult(lines);
    }

    const W = 62;
    const lines: string[] = [
      boxTop(W),
      boxCenter("INSTALLED BACKDOORS", W),
      boxDivider(W),
    ];

    for (const bd of backdoors) {
      const serverName = bd.server?.name ?? "Unknown";
      const serverIp = bd.server?.ipAddress ?? "?.?.?.?";
      const age = formatDuration(Date.now() - new Date(bd.createdAt).getTime());
      const risk = bd.detectionRisk;
      const riskLabel = risk < 30 ? "LOW" : risk < 60 ? "MED" : "HIGH";
      const expiry = bd.expiresAt
        ? formatDuration(new Date(bd.expiresAt).getTime() - Date.now())
        : "PERMANENT";

      lines.push(
        boxRow(
          `  ${pad(serverName, 22)} ${pad(serverIp, 16)} Lv${bd.accessLevel}`,
          W,
        ),
        boxRow(
          `    Type: ${pad(bd.type, 12)} Risk: ${pad(riskLabel + " (" + risk + "%)", 12)} TTL: ${expiry}  Age: ${age}`,
          W,
        ),
        boxDivider(W),
      );
    }

    // Replace last divider with bottom
    lines[lines.length - 1] = boxBottom(W);

    return successResult(lines);
  }

  private async handleBackdoorUse(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return errorResult("Usage: backdoor.use <target_ip>");
    }

    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return errorResult("Backdoor service unavailable");
    }

    // Resolve IP to server ID
    const server = await context.db.client.gameServer.findUnique({
      where: { ipAddress: targetIp },
      select: { id: true, name: true },
    });
    if (!server) {
      return errorResult(`No server found at ${targetIp}`);
    }

    const result = await backdoorService.useBackdoor(context.userId, server.id);

    if (!result.success) {
      return errorResult(result.error || "Failed to use backdoor");
    }

    const W = context.terminalWidth;
    const lines: string[] = [
      boxTop(W),
      boxCenter("BACKDOOR ACCESS", W),
      boxDivider(W),
    ];

    if (result.discovered) {
      lines.push(
        boxRow("  ⚠ BACKDOOR DISCOVERED AND DEACTIVATED!", W),
        boxRow("  The server owner has been alerted.", W),
        boxRow("  Your access has been revoked.", W),
      );
    } else {
      lines.push(
        boxRow(`  Connected to ${server.name} via backdoor`, W),
        boxRow(`  Access Level: ${result.accessLevel}/10`, W),
        boxRow(`  Status: Active — detection risk increased`, W),
      );
    }

    lines.push(boxBottom(W));
    return {
      success: !result.discovered,
      output: lines,
      timestamp: new Date(),
    };
  }

  private async handleBackdoorRemove(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetIp = command.args?.[0];
    if (!targetIp) {
      return errorResult("Usage: backdoor.remove <target_ip>");
    }

    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return errorResult("Backdoor service unavailable");
    }

    const server = await context.db.client.gameServer.findUnique({
      where: { ipAddress: targetIp },
      select: { id: true, name: true },
    });
    if (!server) {
      return errorResult(`No server found at ${targetIp}`);
    }

    const result = await backdoorService.removeBackdoor(
      context.userId,
      server.id,
    );

    if (!result.success) {
      return errorResult(result.error || "No backdoor found on that server");
    }

    const W = context.terminalWidth;
    const lines = [
      boxTop(W),
      boxCenter("BACKDOOR REMOVED", W),
      boxDivider(W),
      boxRow(`  Server: ${server.name} (${targetIp})`, W),
      boxRow(`  Backdoor deactivated and traces cleaned.`, W),
      boxBottom(W),
    ];
    return successResult(lines);
  }

  // ==================== SECURITY SCAN COMMAND ====================

  private async handleSecurityScan(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const serverIp = command.args?.[0];
    if (!serverIp) {
      return errorResult("Usage: security.scan <your_server_ip>");
    }

    const backdoorService = context.services.backdoorService;
    if (!backdoorService) {
      return errorResult("Backdoor service unavailable");
    }

    // Verify the player owns the server
    const server = await context.db.client.gameServer.findUnique({
      where: { ipAddress: serverIp },
      select: { id: true, name: true, ownerId: true },
    });
    if (!server) {
      return errorResult(`No server found at ${serverIp}`);
    }
    if (server.ownerId !== context.userId) {
      return errorResult("You can only scan servers you own");
    }

    // Get player forensics skill
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { forensics: true },
    });
    const forensics = progress?.forensics ?? 5;

    const discovered = await backdoorService.scanForBackdoors(
      server.id,
      forensics,
    );

    const W = 58;
    const lines: string[] = [
      boxTop(W),
      boxCenter("SECURITY SCAN RESULTS", W),
      boxDivider(W),
      boxRow(`  Server: ${server.name} (${serverIp})`, W),
      boxRow(`  Forensics Level: ${forensics}/100`, W),
      boxDivider(W),
    ];

    if (!discovered || discovered.length === 0) {
      lines.push(
        boxRow("  ✓ No backdoors detected.", W),
        boxRow("  (Higher forensics skill reveals harder-to-find threats)", W),
      );
    } else {
      lines.push(
        boxRow(`  ⚠ ${discovered.length} BACKDOOR(S) DETECTED!`, W),
        boxDivider(W),
      );

      for (const bd of discovered) {
        const installerName = bd.installer?.username ?? "Unknown";
        const bdType = bd.type ?? "standard";
        const risk = bd.detectionRisk ?? 0;
        lines.push(
          boxRow(`  ID: ${bd.id.slice(0, 12)}...`, W),
          boxRow(
            `    Installer: ${installerName}  Type: ${bdType}  Risk: ${risk}%`,
            W,
          ),
          boxRow(
            `    Access Lv: ${bd.accessLevel}  — Use  security.remove ${bd.id}  to purge`,
            W,
          ),
          boxDivider(W),
        );
      }
      // Replace last divider
      lines[lines.length - 1] = boxRow("", W);

      // Auto-remove discovered backdoors
      for (const bd of discovered) {
        await backdoorService.removeDetectedBackdoor(bd.id);
      }
      lines.push(boxRow(`  ✓ All detected backdoors have been purged.`, W));
    }

    lines.push(boxBottom(W));
    return successResult(lines);
  }

  // ==================== TRACE COMMANDS ====================

  private async handleTraceStatus(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const traceService = context.services.traceService;
    if (!traceService) {
      return errorResult("Trace service unavailable");
    }

    const tracesAgainst = await traceService.getTracesAgainst(context.userId);
    const tracesInitiated = await traceService.getTracesInitiated(
      context.userId,
    );

    const W = 60;
    const lines: string[] = [
      boxTop(W),
      boxCenter("TRACE STATUS", W),
      boxDivider(W),
    ];

    // Traces targeting the player (incoming threats)
    lines.push(boxCenter("— INCOMING TRACES (targeting you) —", W));
    if (!tracesAgainst || tracesAgainst.length === 0) {
      lines.push(boxRow("  ✓ No active traces against you.", W));
    } else {
      for (const tr of tracesAgainst) {
        const serverName = tr.server?.name ?? "Unknown";
        const pct = tr.progress ?? 0;
        const bar = progressBar(pct / 100, 12);
        const statusLabel =
          tr.status === "active" ? "ACTIVE" : tr.status.toUpperCase();
        lines.push(
          boxRow(
            `  ${pad(tr.id.slice(0, 12) + "...", 16)} ${pad(serverName, 18)} ${statusLabel}`,
            W,
          ),
          boxRow(
            `    Progress: ${bar} ${padRight(String(pct) + "%", 4)}  Evidence: ${tr.evidenceLevel}%`,
            W,
          ),
        );
      }
      lines.push(
        boxRow("", W),
        boxRow("  Use  trace.evade <trace_id>  to attempt evasion", W),
      );
    }

    lines.push(boxDivider(W));

    // Traces the player initiated (defense)
    lines.push(boxCenter("— OUTGOING TRACES (you initiated) —", W));
    if (!tracesInitiated || tracesInitiated.length === 0) {
      lines.push(boxRow("  No traces initiated by you.", W));
    } else {
      for (const tr of tracesInitiated) {
        const targetName = tr.target?.username ?? "Unknown";
        const pct = tr.progress ?? 0;
        const bar = progressBar(pct / 100, 12);
        const statusLabel =
          tr.status === "active" ? "TRACKING" : tr.status.toUpperCase();
        lines.push(
          boxRow(`  Target: ${pad(targetName, 16)} ${statusLabel}`, W),
          boxRow(
            `    Progress: ${bar} ${padRight(String(pct) + "%", 4)}  Evidence: ${tr.evidenceLevel}%`,
            W,
          ),
        );
      }
    }

    lines.push(boxBottom(W));
    return successResult(lines);
  }

  private async handleTraceEvade(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const traceId = command.args?.[0];
    if (!traceId) {
      return errorResult("Usage: trace.evade <trace_id>");
    }

    const traceService = context.services.traceService;
    if (!traceService) {
      return errorResult("Trace service unavailable");
    }

    const session = context.gameStateManager.getSession(context.userId);
    if (!session) return errorResult("No active session");

    const memoryService = context.services.memoryService;

    if (memoryService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { stealth: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "trace_evade");
      if (!check.allowed) {
        return errorResult(`Insufficient resources: ${check.reason}\nTrace evasion is CPU-intensive. Free resources with 'kill <pid>'.`);
      }

      const userId = context.userId;
      const proc = memoryService.spawnGameProcess(
        userId, session.socketId, "trace_evade", progress?.stealth ?? 1, `trace:${traceId}`, traceId,
        async () => {
          const result = await traceService.evadeTrace(userId, traceId);
          // Fire mission hook on successful evasion
          if (result.evaded && context.services.missionIntegrationService) {
            context.services.missionIntegrationService.onTraceEvaded(userId).catch(() => {});
          }
          if (context.io) {
            const W = context.terminalWidth;
            const lines: string[] = [boxTop(W), boxCenter("TRACE EVASION RESULT", W), boxDivider(W)];
            if (result.evaded) {
              lines.push(boxRow("  EVASION SUCCESSFUL", W), boxRow("", W), boxRow("  " + (result.message ?? "Trace evaded."), W));
            } else {
              lines.push(boxRow("  EVASION FAILED", W), boxRow("", W), boxRow("  " + (result.message ?? "Trace still active."), W));
            }
            lines.push(boxBottom(W));
            context.io.to(`player:${userId}`).emit("command:result", {
              success: result.success,
              output: render(lines),
              timestamp: new Date(),
            });
          }
        },
      );

      if (!proc) return errorResult("Failed to start trace evasion.");

      const etaSec = Math.ceil(proc.duration / 1000);
      return successResult(`Initiating trace evasion... ETA ${etaSec}s [PID ${proc.pid}]\nYour system is running counter-trace protocols. Use 'ps' to monitor.`);
    }

    // Fallback: direct execution
    const result = await traceService.evadeTrace(context.userId, traceId);
    if (result.evaded && context.services.missionIntegrationService) {
      context.services.missionIntegrationService.onTraceEvaded(context.userId).catch(() => {});
    }
    const W = context.terminalWidth;
    const lines: string[] = [boxTop(W), boxCenter("TRACE EVASION ATTEMPT", W), boxDivider(W)];
    if (result.evaded) {
      lines.push(boxRow("  EVASION SUCCESSFUL", W), boxRow("", W), boxRow("  " + (result.message ?? "Trace evaded."), W));
    } else {
      lines.push(boxRow("  EVASION FAILED", W), boxRow("", W), boxRow("  " + (result.message ?? "Trace still active."), W));
    }
    lines.push(boxBottom(W));
    return { success: result.success, output: render(lines), timestamp: new Date() };
  }
}
