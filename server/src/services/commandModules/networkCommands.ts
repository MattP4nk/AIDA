import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import logger from "../../logger";
import { spawnBackgroundProcess, successResult, errorResult } from "./helpers";
import { redactSensitiveContent } from "../../utils/contentRedaction";
import {
  validateIPAddress,
  validateServerId,
  validatePartialIP,
  partialIpToPrefix,
} from "../../utils/validators";
import {
  table,
  panel,
  statusCard,
  render,
  Column,
  boxTop,
  boxRow,
  boxCenter,
  boxDivider,
  boxBottom,
  sBoxTop,
  sBoxRow,
  sBoxBottom,
} from "./asciiBox";

export class NetworkCommandsModule implements CommandModule {
  public category = "network";
  public commands: Set<string> = new Set([
    "scan",
    "servers",
    "connect",
    "disconnect",
    "traceroute",
    "probe",
    "netmap",
    "handshake.ack",
    "signal.trace",
    "connect.abort",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "scan":
          return await this.handleScan(command, context);
        case "servers":
          return await this.handleServers(command, context);
        case "connect":
          return await this.handleConnect(command, context);
        case "disconnect":
          return await this.handleDisconnect(command, context);
        case "probe":
          return await this.handleProbe(command, context);
        case "traceroute":
          return await this.handleTraceroute(command, context);
        case "netmap":
          return await this.handleNetmap(command, context);
        case "handshake.ack":
          return await this.handleChallengeSubmit(command, context, "handshake");
        case "signal.trace":
          return await this.handleChallengeSubmit(command, context, "signal_trace");
        case "connect.abort":
          return this.handleConnectAbort(context);
        default:
          return errorResult(`Network command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("Network command failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "scan",
        category: "network",
        description:
          "[Network 5] Scan adjacent servers, or sweep a partial IP range",
        usage: "scan [partial-ip]",
        examples: ["scan", "scan 10.10.10", "scan 192.168.x.x", "scan 10.10"],
      },
      {
        command: "servers",
        category: "network",
        description:
          "List your known servers (home, owned, connected, visited)",
        usage: "servers",
        examples: ["servers"],
      },
      {
        command: "connect",
        category: "network",
        description: "Connect to an adjacent server or your home",
        usage: "connect <ip|id|home>",
        examples: ["connect 192.168.1.1", "connect home"],
      },
      {
        command: "disconnect",
        category: "network",
        description: "Disconnect and return to your home server",
        usage: "disconnect",
        examples: ["disconnect"],
      },
      {
        command: "probe",
        category: "network",
        description: "[Network 10] Get detailed server and network info",
        usage: "probe <ip|id>",
        examples: ["probe 192.168.1.1"],
      },
      {
        command: "traceroute",
        category: "network",
        description: "[Network 15] Trace network path to a server",
        usage: "traceroute <ip|id>",
        examples: ["traceroute 172.16.1.20"],
      },
      {
        command: "netmap",
        category: "network",
        description: "[Network 5] Show discovered network topology map",
        usage: "netmap [-d<depth>]",
        examples: ["netmap", "netmap -d3"],
      },
    ];
  }

  // ==================== SCAN ====================

  private async handleScan(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];

    // ── Partial-IP subnet sweep: scan 10.10.10.x / scan 192.168.x.x ──
    if (args.length > 0) {
      const partialIp = args[0]!;
      const validation = validatePartialIP(partialIp);

      if (!validation.isValid) {
        return errorResult(`Invalid partial IP: ${partialIp}\nUsage: scan 10.10.10  or  scan 10.10.10.x  or  scan 192.168\nProvide at least two octets of a known IP to sweep that subnet.`);
      }

      const ipPrefix = partialIpToPrefix(partialIp)!;
      return await this.handleSubnetSweep(
        partialIp,
        ipPrefix,
        context,
        command.terminalId,
      );
    }

    // ── Default: adjacency scan from current node ──
    const topoService = context.services.networkTopologyService;
    const memoryService = context.services.memoryService;

    const session = context.gameStateManager.getSession(context.userId);
    const currentServerId = session?.currentServerId || session?.homeServerId;

    if (!currentServerId) {
      return errorResult("Not connected to any server. Use 'connect home' first.");
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { networking: true, level: true },
    });
    const scanLevel = progress?.networking ?? 1;

    // ── Resource check: spawn scan as a background process ──
    if (memoryService && topoService) {
      const spawn = await spawnBackgroundProcess({
        context,
        processType: "scan",
        skillKey: "networking",
        label: "network scan",
        targetServerId: currentServerId,
        onComplete: async () => {
          // ── On completion: run the actual scan and push results ──
          try {
            logger.debug({ userId: context.userId }, "Adjacency scan onComplete fired");
            const results = await topoService.discoverNeighbors(
              context.userId,
              currentServerId,
              scanLevel,
            );
            logger.debug({ count: results.length }, "discoverNeighbors returned results");

            // Pre-warm discovered servers via content queue
            try {
              const { getService } = await import("../../di/container");
              const { CONTENT_QUEUE_SERVICE } = await import("../../di/tokens");
              const contentQueue = getService<any>(CONTENT_QUEUE_SERVICE);
              for (const r of results) {
                const sid = (r as any).serverId || (r as any).server?.id || (r as any).id;
                if (sid) {
                  await contentQueue.enqueue(sid, 5 /* NORMAL */);
                }
              }
            } catch { /* non-critical */ }

            const currentServer =
              await context.services.serverService.getServer(currentServerId);
            const output = this.formatScanResults(
              results,
              currentServer?.name || currentServerId,
            );
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true,
                output,
                terminalId: command.terminalId,
                timestamp: new Date(),
              });
            }

            // Notification handled by process:completed event — no duplicate needed
          } catch (err) {
            logger.error({ err }, "Adjacency scan callback error");
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Scan failed unexpectedly.",
                terminalId: command.terminalId,
                timestamp: new Date(),
              });
            }
          }
        },
      });

      if (spawn) return spawn.result;
    }

    // ── Fallback: no resource system — instant scan ──
    if (topoService) {
      const results = await topoService.discoverNeighbors(
        context.userId,
        currentServerId,
        scanLevel,
      );
      if (results.length === 0) {
        return await this.legacyScan(context, currentServerId, scanLevel);
      }
      const currentServer =
        await context.services.serverService.getServer(currentServerId);
      return successResult(this.formatScanResults(
        results,
        currentServer?.name || currentServerId,
      ));
    }

    return await this.legacyScan(context, currentServerId, scanLevel);
  }

  /**
   * Handle a targeted subnet sweep when the player provides a partial IP.
   * Searches for servers matching the IP prefix and reveals gateways / network entrances.
   */
  private async handleSubnetSweep(
    partialIp: string,
    ipPrefix: string,
    context: CommandContext,
    terminalId?: string,
  ): Promise<CommandResult> {
    const memoryService = context.services.memoryService;
    const session = context.gameStateManager.getSession(context.userId);

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { networking: true, level: true },
    });
    const scanLevel = progress?.networking ?? 1;

    // ── Resource check: spawn as a background process if available ──
    if (memoryService) {
      const spawn = await spawnBackgroundProcess({
        context,
        processType: "scan",
        skillKey: "networking",
        label: `subnet sweep ${partialIp}`,
        targetServerId: session?.currentServerId || session?.homeServerId,
        onComplete: async () => {
          try {
            logger.debug({ userId: context.userId }, "Subnet sweep onComplete fired");
            const servers =
              await context.services.serverService.scanByPartialIp(
                context.userId,
                ipPrefix,
                scanLevel,
              );
            logger.debug({ count: servers.length, ipPrefix }, "scanByPartialIp returned results");
            const output = this.formatSubnetSweepResults(servers, partialIp);

            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true,
                output,
                terminalId,
                timestamp: new Date(),
              });
              // Notification handled by process:completed event — no duplicate needed
            }
          } catch (err) {
            logger.error({ err }, "Subnet sweep callback error");
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Subnet sweep failed unexpectedly.",
                timestamp: new Date(),
                terminalId,
              });
            }
          }
        },
      });

      if (spawn) return spawn.result;
    }

    // ── Fallback: instant sweep (no resource system) ──
    const servers = await context.services.serverService.scanByPartialIp(
      context.userId,
      ipPrefix,
      scanLevel,
    );
    return successResult(this.formatSubnetSweepResults(servers, partialIp));
  }

  /** Format subnet sweep results into an ASCII table */
  private formatSubnetSweepResults(servers: any[], partialIp: string): string {
    if (servers.length === 0) {
      return render([
        `Subnet Sweep: ${partialIp}`,
        "",
        "No responding hosts found on this subnet.",
        "The range may be offline, or your scan level is too low.",
        "Increase your Networking skill and try again.",
      ]);
    }

    const columns: Column[] = [
      { header: "IP ADDRESS", width: 16, align: "left" },
      { header: "NAME", width: 22, align: "left" },
      { header: "TYPE", width: 12, align: "left" },
      { header: "SEC", width: 4, align: "right" },
      { header: "STATUS", width: 8, align: "left" },
    ];

    // Sort gateways/routers to the top as "network entrances"
    const roleOrder: Record<string, number> = {
      gateway: 0,
      router: 1,
      firewall: 2,
      dns: 3,
      workstation: 4,
      database: 5,
      email: 6,
    };

    const sorted = [...servers].sort((a, b) => {
      const ra = roleOrder[a.type] ?? 99;
      const rb = roleOrder[b.type] ?? 99;
      return ra - rb || a.encryptionLevel - b.encryptionLevel;
    });

    const rows: string[][] = sorted.map((s) => [
      s.ipAddress,
      (s.name || "unknown").substring(0, 22),
      s.type || "unknown",
      String(s.encryptionLevel),
      s.isOnline ? "[+] ON" : "[-] OFF",
    ]);

    const gatewayCount = sorted.filter(
      (s) => s.type === "gateway" || s.type === "router",
    ).length;

    const footer = `${servers.length} host${servers.length !== 1 ? "s" : ""} found.${gatewayCount > 0 ? ` ${gatewayCount} network entrance${gatewayCount !== 1 ? "s" : ""} detected.` : ""} Use 'connect <ip>' to connect.`;

    const lines = [`Subnet Sweep: ${partialIp}`, ""];
    lines.push(...table(columns, rows, footer));
    return render(lines);
  }

  /** Format scan results into ASCII table (shared by process callback and instant path) */
  private formatScanResults(results: any[], networkLabel: string): string {
    if (results.length === 0) {
      return `Scanning ${networkLabel}... No unknown servers found.\nTry 'connect <ip>' to reach a different network, then scan again.`;
    }

    const columns: Column[] = [
      { header: "IP ADDRESS", width: 16, align: "left" },
      { header: "NAME", width: 20, align: "left" },
      { header: "ROLE", width: 10, align: "left" },
      { header: "SEC", width: 4, align: "right" },
      { header: "ACCESS", width: 9, align: "left" },
      { header: "LINK", width: 7, align: "left" },
      { header: "", width: 2, align: "left" },
    ];

    const accessLabel = (m: string) => {
      switch (m) {
        case "open":
          return "OPEN";
        case "hackable":
          return "LOCKED";
        case "keycard":
          return "KEYCARD";
        case "hack_or_key":
          return "KEY/HACK";
        default:
          return m.substring(0, 9);
      }
    };

    const rows: string[][] = results.map((r: any) => [
      r.server.serverIp,
      r.server.serverName.substring(0, 20),
      r.server.serverRole,
      String(r.server.securityLevel),
      accessLabel(r.server.accessMethod),
      r.server.link.linkType,
      r.isNew ? "*" : "",
    ]);

    const newCount = results.filter((r: any) => r.isNew).length;
    const footer = `${results.length} adjacent server${results.length !== 1 ? "s" : ""}${newCount > 0 ? ` (${newCount} new)` : ""}. Use 'connect <ip>' to traverse.`;

    const lines = [`Topology Scan from: ${networkLabel}`, ""];
    lines.push(...table(columns, rows, footer));
    return render(lines);
  }

  private async legacyScan(
    context: CommandContext,
    currentServerId: string,
    scanLevel: number,
  ): Promise<CommandResult> {
    const currentServer =
      await context.services.serverService.getServer(currentServerId);
    const fromIp = currentServer?.ipAddress;
    const subnet = fromIp
      ? fromIp.split(".").slice(0, 2).join(".") + ".x.x"
      : "local";

    const servers = await context.services.serverService.discoverServers(
      context.userId,
      scanLevel,
      fromIp,
    );

    if (servers.length === 0) {
      return successResult(`Scanning ${subnet}... No unknown servers found.\nTry 'connect <ip>' to reach a different network, then scan again.`);
    }

    const columns: Column[] = [
      { header: "IP ADDRESS", width: 15, align: "left" },
      { header: "NAME", width: 20, align: "left" },
      { header: "TYPE", width: 12, align: "left" },
      { header: "SECURITY", width: 9, align: "left" },
      { header: "STATUS", width: 9, align: "left" },
    ];

    const rows: string[][] = servers.map((server) => [
      server.ipAddress,
      (server.name || "unknown").substring(0, 20),
      server.type || "unknown",
      `Level ${server.encryptionLevel}`,
      server.isOnline ? "[+] ON" : "[-] OFF",
    ]);

    const footer = `Found ${servers.length} server${servers.length !== 1 ? "s" : ""}. Use 'connect <ip>' to connect.`;
    const lines = [`Subnet Scan: ${subnet} (Level ${scanLevel})`, ""];
    lines.push(...table(columns, rows, footer));

    return successResult(redactSensitiveContent(render(lines)));
  }

  // ==================== SERVERS ====================

  private async handleServers(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const session = context.gameStateManager.getSession(context.userId);
      const W = 58;
      const lines: string[] = [
        boxTop(W),
        boxCenter("KNOWN SERVERS", W),
        boxDivider(W),
      ];

      // ── 1. Home server ──
      let homeServer = null;
      if (session?.homeServerId) {
        homeServer = await context.services.serverService.getServer(
          session.homeServerId,
        );
      }
      if (homeServer) {
        const tag =
          session?.currentServerId === homeServer.id ? " << CONNECTED" : "";
        lines.push(boxRow(`  HOME SERVER${tag}`, W));
        lines.push(
          boxRow(
            `    ${homeServer.ipAddress}  ${(homeServer.name || "Home").substring(0, 30)}`,
            W,
          ),
        );
      } else {
        lines.push(boxRow("  HOME SERVER", W));
        lines.push(boxRow("    (not initialized)", W));
      }

      // ── 2. Owned servers (non-home) ──
      const ownedServers = await context.db.client.gameServer.findMany({
        where: { ownerId: context.userId, isPlayerHome: false },
        orderBy: { name: "asc" },
      });

      if (ownedServers.length > 0) {
        lines.push(boxDivider(W));
        lines.push(boxRow(`  OWNED SERVERS (${ownedServers.length})`, W));
        for (const srv of ownedServers) {
          const tag = session?.currentServerId === srv.id ? " <<" : "";
          lines.push(
            boxRow(
              `    ${srv.ipAddress}  ${srv.name.substring(0, 24)}  [${srv.role}]${tag}`,
              W,
            ),
          );
        }
      }

      // ── 3. Currently connected (remote) ──
      if (
        session?.currentServerId &&
        session.currentServerId !== homeServer?.id
      ) {
        const isOwned = ownedServers.some(
          (s) => s.id === session.currentServerId,
        );
        if (!isOwned) {
          const remote = await context.services.serverService.getServer(
            session.currentServerId!,
          );
          if (remote) {
            lines.push(boxDivider(W));
            lines.push(boxRow("  CONNECTED", W));
            lines.push(
              boxRow(
                `    ${remote.ipAddress}  ${(remote.name || "???").substring(0, 22)}  [${(remote as any).role || remote.type}]`,
                W,
              ),
            );
          }
        }
      }

      // ── 4. Previously visited ──
      const history = await context.services.serverService.getConnectionHistory(
        context.userId,
        30,
      );
      const shownIds = new Set<string>();
      if (homeServer) shownIds.add(homeServer.id);
      for (const s of ownedServers) shownIds.add(s.id);
      if (session?.currentServerId) shownIds.add(session.currentServerId);

      const visitedMap = new Map<string, (typeof history)[0]>();
      for (const conn of history.filter((c) => !shownIds.has(c.serverId))) {
        if (!visitedMap.has(conn.serverId)) visitedMap.set(conn.serverId, conn);
      }
      const visited = Array.from(visitedMap.values());

      if (visited.length > 0) {
        lines.push(boxDivider(W));
        lines.push(boxRow(`  PREVIOUSLY VISITED (${visited.length})`, W));
        for (const conn of visited.slice(0, 15)) {
          const srv = (conn as any).server;
          if (srv) {
            lines.push(
              boxRow(
                `    ${srv.ipAddress}  ${(srv.name || "???").substring(0, 24)}  [${srv.role || srv.type}]`,
                W,
              ),
            );
          }
        }
        if (visited.length > 15) {
          lines.push(boxRow(`    ... and ${visited.length - 15} more`, W));
        }
      }

      lines.push(boxDivider(W));
      lines.push(boxRow("  'scan' to discover adjacent servers", W));
      lines.push(boxRow("  'connect <ip>' to traverse a link", W));
      lines.push(boxRow("  'netmap' to see network topology", W));
      lines.push(boxBottom(W));

      return successResult(redactSensitiveContent(render(lines)));
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "Failed to list servers");
    }
  }

  // ==================== CONNECT ====================

  private async handleConnect(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return errorResult("Usage: connect <ip|id|home>\nMust be adjacent server or use 'connect home'.");
    }

    const target = args[0]!;
    const session = context.gameStateManager.getSession(context.userId);
    const topoService = context.services.networkTopologyService;

    // ── "home" shortcut — always allowed ──
    if (target.toLowerCase() === "home") {
      if (session?.homeServerId) {
        await context.gameStateManager.disconnectPlayerFromServer(
          context.userId,
        );
        if (session.currentServerId) {
          await context.services.serverService.disconnectFromServer(
            context.userId,
            session.currentServerId,
          );
        }
        const connected = await context.gameStateManager.connectPlayerToServer(
          context.userId,
          session.homeServerId,
        );
        if (connected) {
          return successResult("Returned to home server.");
        }
      }
      return errorResult("Home server not found.");
    }

    // Validate format
    const isIP = validateIPAddress(target);
    const isValidId = validateServerId(target);
    if (!isIP && !isValidId) {
      return errorResult("Invalid server ID or IP address format.");
    }

    // Resolve target server
    let targetServer = await context.services.serverService.getServer(target);
    if (!targetServer) {
      targetServer = await context.services.serverService.getServerByIp(target);
    }
    if (!targetServer) {
      return errorResult(`Server not found: ${target}`);
    }

    // ── Topology enforcement ──
    const currentServerId = session?.currentServerId || session?.homeServerId;

    if (topoService && currentServerId && currentServerId !== targetServer.id) {
      // Check backdoor bypass first
      const hasBackdoor = await topoService.resolveBackdoorBypass(
        context.userId,
        targetServer.id,
      );

      if (!hasBackdoor) {
        // Check adjacency
        const traversal = await topoService.canTraverse(
          context.userId,
          currentServerId,
          targetServer.id,
        );

        if (!traversal.allowed) {
          const W = context.terminalWidth;
          const lines: string[] = [];
          lines.push(sBoxTop(W));
          lines.push(sBoxRow(" [!] CONNECTION BLOCKED", W));
          lines.push(sBoxRow("", W));
          lines.push(sBoxRow(` ${traversal.reason}`, W));
          lines.push(sBoxRow("", W));
          lines.push(sBoxRow(" No direct link from your current server.", W));
          lines.push(sBoxRow(" Use 'scan' to discover adjacent servers.", W));
          lines.push(sBoxRow(" Use 'traceroute <ip>' to find a path.", W));
          lines.push(sBoxBottom(W));
          return errorResult(render(lines));
        }
      }
    }

    // ── Access method enforcement ──
    if (topoService) {
      const access = await topoService.checkServerAccess(
        context.userId,
        targetServer.id,
      );
      if (!access.allowed) {
        const W = context.terminalWidth;
        const lines: string[] = [];
        lines.push(sBoxTop(W));
        lines.push(sBoxRow(" [!] ACCESS DENIED", W));
        lines.push(sBoxRow("", W));
        lines.push(sBoxRow(` ${access.reason}`, W));
        if (access.requiresKey) {
          lines.push(sBoxRow("", W));
          lines.push(sBoxRow(" Look for access keys in server files:", W));
          lines.push(sBoxRow("   .ssh/config, credentials, .env files", W));
        }
        if (access.requiresHack) {
          lines.push(sBoxRow("", W));
          lines.push(sBoxRow(` Try: hack ${target}`, W));
        }
        lines.push(sBoxBottom(W));
        return {
          success: false,
          output: render(lines),
          ...(access.requiresHack ? { suggestedCommand: `hack ${target}` } : {}),
          timestamp: new Date(),
        };
      }
    }

    // ── Connection challenge check ──
    const challengeService = context.services.connectionChallengeService;
    if (challengeService) {
      // Check if player already has an active challenge
      const existing = challengeService.getActiveSession(context.userId);
      if (existing && existing.status === "active") {
        const cmd = existing.challenge.type === "handshake" ? "handshake.ack" : "signal.trace";
        return errorResult(`Active connection challenge in progress.\nSubmit: ${cmd} <answer>\nOr: connect.abort to cancel.`);
      }

      // Check if this is a first visit
      const previousConn = await context.db.client.serverConnection.findFirst({
        where: { userId: context.userId, serverId: targetServer.id },
      });
      const isFirstVisit = !previousConn;

      // Check for active backdoor on this server (bypasses challenge on revisit)
      let hasBackdoorOnServer = false;
      if (topoService && !isFirstVisit) {
        hasBackdoorOnServer = await topoService.resolveBackdoorBypass(
          context.userId,
          targetServer.id,
        );
      }

      const check = challengeService.shouldChallenge(context.userId, targetServer, isFirstVisit, hasBackdoorOnServer);

      if (check.needed) {
        // Get player networking skill
        const prog = await context.db.client.playerProgress.findUnique({
          where: { userId: context.userId },
          select: { networking: true },
        });

        // Get network zone for challenge type selection
        let networkZone: string | null = null;
        if (targetServer.networkId) {
          const net = await context.db.client.network.findUnique({
            where: { id: targetServer.networkId },
            select: { zone: true },
          });
          networkZone = net?.zone ?? null;
        }

        const { challenge } = challengeService.initiateChallenge(
          context.userId,
          targetServer,
          networkZone,
          prog?.networking ?? 0,
          isFirstVisit,
        );

        // Fire content provisioning early so it runs during the challenge
        // Queue content generation during challenge (urgent — player is connecting)
        if (isFirstVisit && !targetServer.isPlayerHome) {
          try {
            const { getService } = await import("../../di/container");
            const { CONTENT_QUEUE_SERVICE } = await import("../../di/tokens");
            const contentQueue = getService<any>(CONTENT_QUEUE_SERVICE);
            await contentQueue.enqueue(targetServer.id, 1 /* URGENT */, {}, context.userId);
          } catch { /* non-critical */ }
        }

        const submitCmd = challenge.type === "handshake" ? "handshake.ack" : "signal.trace";
        return {
          success: true,
          output: challenge.displayText,
          data: {
            connectionSessionId: challenge.type,
            targetIp: targetServer.ipAddress,
            connectionChallenge: challenge,
          },
          suggestedCommand: submitCmd,
          soundEvent: "alert" as const,
          timestamp: new Date(),
        };
      }
    }

    // ── Ensure content is ready before connecting ──
    if (!targetServer.isPlayerHome && targetServer.type !== "player_home") {
      try {
        const { getService } = await import("../../di/container");
        const { CONTENT_QUEUE_SERVICE } = await import("../../di/tokens");
        const contentQueue = getService<any>(CONTENT_QUEUE_SERVICE);
        await contentQueue.ensureReady(targetServer.id, context.userId);
      } catch { /* non-critical — connect anyway */ }
    }

    return await this.completeConnection(context, target, targetServer);
  }

  /**
   * Complete a server connection — shared by direct connect and challenge success.
   */
  private async completeConnection(
    context: CommandContext,
    target: string,
    targetServer: any,
  ): Promise<CommandResult> {
    try {
      const result = await context.services.serverService.connectToServer(
        context.userId,
        target,
      );

      if (!result.success) {
        return errorResult(result.message || "Connection failed");
      }

      const connected = await context.gameStateManager.connectPlayerToServer(
        context.userId,
        result.serverId,
      );
      if (!connected) {
        return errorResult("Failed to update connection state");
      }

      const serverRole = (targetServer as any).role || "general";
      const network = targetServer.networkId
        ? await context.db.client.network.findUnique({
            where: { id: targetServer.networkId },
            select: { name: true },
          })
        : null;

      const infoRows: Array<{ label: string; value: string }> = [
        { label: "Server:   ", value: targetServer.name },
        { label: "IP:       ", value: targetServer.ipAddress },
        { label: "Role:     ", value: serverRole },
        { label: "Security: ", value: `Level ${targetServer.securityLevel}` },
        { label: "Access:   ", value: `Level ${result.accessLevel}` },
      ];
      if (network) {
        infoRows.push({ label: "Network:  ", value: network.name });
      }

      const lines = statusCard("CONNECTED", infoRows);
      return {
        success: true,
        output: render(lines),
        data: {
          connectionResolved: true,
          server: { name: targetServer.name, ip: targetServer.ipAddress },
          directory: { path: "/" },
        },
        soundEvent: "connected" as const,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Connection failed",
        data: { connectionResolved: true },
        timestamp: new Date(),
      };
    }
  }

  // ==================== DISCONNECT ====================

  private async handleDisconnect(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const session = context.gameStateManager.getSession(context.userId);
      if (!session || !session.currentServerId) {
        return errorResult("Not connected to any server.");
      }

      const serverId = session.currentServerId;
      await context.gameStateManager.disconnectPlayerFromServer(context.userId);
      await context.services.serverService.disconnectFromServer(
        context.userId,
        serverId,
      );

      // Get home info for client context update
      const user = await context.db.client.user.findUnique({
        where: { id: context.userId },
        select: { homeIp: true },
      });

      return {
        success: true,
        output: "Disconnected. Returned to home server.",
        data: {
          server: { name: user?.homeIp || "local" },
          directory: { path: "~" },
        },
        timestamp: new Date(),
      };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "Disconnect failed");
    }
  }

  // ==================== PROBE ====================

  private async handleProbe(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return errorResult("Usage: probe <ip|id>\nExample: probe 192.168.1.1");
    }

    const target = args[0]!;

    // ── Resource check: spawn probe as a background process ──
    const memoryService = context.services.memoryService;
    if (memoryService) {
      const spawn = await spawnBackgroundProcess({
        context,
        processType: "probe",
        skillKey: "networking",
        label: `probe ${target}`,
        onComplete: async () => {
          try {
            let server = await context.services.serverService.getServer(target);
            if (!server) {
              server = await context.services.serverService.getServerByIp(target);
            }
            if (!server) {
              if (context.io) {
                context.io.to(`player:${context.userId}`).emit("command:result", {
                  success: false,
                  output: `Server not found: ${target}`,
                  terminalId: command.terminalId,
                  timestamp: new Date(),
                });
              }
              return;
            }

            const accessCheck = await context.services.serverService.canAccessServer(
              context.userId,
              server.id,
            );
            const topoService = context.services.networkTopologyService;

            const probeRows: Array<{ label: string; value: string }> = [
              { label: "IP Address:  ", value: server.ipAddress },
              { label: "Name:        ", value: server.name },
              { label: "Type:        ", value: server.type },
              { label: "Role:        ", value: (server as any).role || "general" },
              { label: "Security:    ", value: `Level ${server.securityLevel}` },
              { label: "Firewall:    ", value: `Level ${server.firewallLevel}` },
              { label: "Encryption:  ", value: `Level ${server.encryptionLevel}` },
              {
                label: "Status:      ",
                value: server.isOnline ? "ONLINE" : "OFFLINE",
              },
              {
                label: "Connections: ",
                value: `${server.currentConnections}/${server.maxConnections}`,
              },
              {
                label: "Access:      ",
                value: accessCheck.canAccess
                  ? `Granted (Level ${accessCheck.accessLevel})`
                  : "Denied",
              },
            ];

            if (!accessCheck.canAccess && accessCheck.reason) {
              probeRows.push({ label: "Reason:      ", value: accessCheck.reason });
            }

            // Network info
            if (server.networkId) {
              const network = await context.db.client.network.findUnique({
                where: { id: server.networkId },
                select: { name: true, zone: true },
              });
              if (network) {
                probeRows.push({ label: "Network:     ", value: network.name });
                probeRows.push({ label: "Zone:        ", value: network.zone });
              }
            }

            // Topology info — show linked servers if adjacent and skilled
            if (topoService) {
              const adjacent = await topoService.getAdjacentServers(server.id);
              probeRows.push({
                label: "Links:       ",
                value: `${adjacent.length} connections`,
              });

              const progress = await context.db.client.playerProgress.findUnique({
                where: { userId: context.userId },
                select: { networking: true },
              });

              // Show linked server names if networking >= 30
              if ((progress?.networking ?? 0) >= 30 && adjacent.length > 0) {
                probeRows.push({ label: "", value: "─── Linked Servers ───" });
                for (const adj of adjacent.slice(0, 6)) {
                  probeRows.push({
                    label: `  ${adj.link.linkType}: `,
                    value: `${adj.serverIp} (${adj.serverRole})`,
                  });
                }
                if (adjacent.length > 6) {
                  probeRows.push({
                    label: "",
                    value: `  ... +${adjacent.length - 6} more`,
                  });
                }
              }
            }

            const lines = panel(`Probe: ${server.name}`, probeRows, context.terminalWidth);
            const outputString = redactSensitiveContent(render(lines));
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true,
                output: outputString,
                terminalId: command.terminalId,
                timestamp: new Date(),
              });
            }
          } catch (err) {
            logger.error({ err }, "Probe background process error");
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: false,
                output: "Probe failed",
                terminalId: command.terminalId,
                timestamp: new Date(),
              });
            }
          }
        },
      });

      if (spawn) return spawn.result;
    }

    // ── Fallback: no resource system — instant probe ──
    try {
      let server = await context.services.serverService.getServer(target);
      if (!server) {
        server = await context.services.serverService.getServerByIp(target);
      }
      if (!server) {
        return errorResult(`Server not found: ${target}`);
      }

      const accessCheck = await context.services.serverService.canAccessServer(
        context.userId,
        server.id,
      );
      const topoService = context.services.networkTopologyService;

      const probeRows: Array<{ label: string; value: string }> = [
        { label: "IP Address:  ", value: server.ipAddress },
        { label: "Name:        ", value: server.name },
        { label: "Type:        ", value: server.type },
        { label: "Role:        ", value: (server as any).role || "general" },
        { label: "Security:    ", value: `Level ${server.securityLevel}` },
        { label: "Firewall:    ", value: `Level ${server.firewallLevel}` },
        { label: "Encryption:  ", value: `Level ${server.encryptionLevel}` },
        {
          label: "Status:      ",
          value: server.isOnline ? "ONLINE" : "OFFLINE",
        },
        {
          label: "Connections: ",
          value: `${server.currentConnections}/${server.maxConnections}`,
        },
        {
          label: "Access:      ",
          value: accessCheck.canAccess
            ? `Granted (Level ${accessCheck.accessLevel})`
            : "Denied",
        },
      ];

      if (!accessCheck.canAccess && accessCheck.reason) {
        probeRows.push({ label: "Reason:      ", value: accessCheck.reason });
      }

      // Network info
      if (server.networkId) {
        const network = await context.db.client.network.findUnique({
          where: { id: server.networkId },
          select: { name: true, zone: true },
        });
        if (network) {
          probeRows.push({ label: "Network:     ", value: network.name });
          probeRows.push({ label: "Zone:        ", value: network.zone });
        }
      }

      // Topology info — show linked servers if adjacent and skilled
      if (topoService) {
        const adjacent = await topoService.getAdjacentServers(server.id);
        probeRows.push({
          label: "Links:       ",
          value: `${adjacent.length} connections`,
        });

        const progress = await context.db.client.playerProgress.findUnique({
          where: { userId: context.userId },
          select: { networking: true },
        });

        // Show linked server names if networking >= 30
        if ((progress?.networking ?? 0) >= 30 && adjacent.length > 0) {
          probeRows.push({ label: "", value: "─── Linked Servers ───" });
          for (const adj of adjacent.slice(0, 6)) {
            probeRows.push({
              label: `  ${adj.link.linkType}: `,
              value: `${adj.serverIp} (${adj.serverRole})`,
            });
          }
          if (adjacent.length > 6) {
            probeRows.push({
              label: "",
              value: `  ... +${adjacent.length - 6} more`,
            });
          }
        }
      }

      const lines = panel(`Probe: ${server.name}`, probeRows, context.terminalWidth);
      return successResult(redactSensitiveContent(render(lines)));
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "Probe failed");
    }
  }

  // ==================== TRACEROUTE ====================

  private async handleTraceroute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return errorResult("Usage: traceroute <ip|id>");
    }

    const target = args[0]!;
    const topoService = context.services.networkTopologyService;
    const session = context.gameStateManager.getSession(context.userId);
    const currentServerId = session?.currentServerId || session?.homeServerId;

    if (!currentServerId) {
      return errorResult("Not connected to any server.");
    }

    // Resolve target server
    let targetServer = await context.services.serverService.getServer(target);
    if (!targetServer) {
      targetServer = await context.services.serverService.getServerByIp(target);
    }
    if (!targetServer) {
      return errorResult(`Server not found: ${target}`);
    }

    // ── Spawn as background process ──
    const memoryService = context.services.memoryService;
    if (memoryService && topoService) {
      const progress = await context.db.client.playerProgress.findUnique({
        where: { userId: context.userId },
        select: { networking: true, level: true },
      });
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "traceroute");
      if (!check.allowed) {
        return errorResult(`Insufficient resources: ${check.reason}`);
      }

      const userId = context.userId;
      const curServerId = currentServerId;
      const targetSrv = targetServer;
      const proc = memoryService.spawnGameProcess(
        userId,
        session!.socketId,
        "traceroute",
        progress?.networking ?? 1,
        targetSrv.ipAddress,
        targetSrv.id,
        async () => {
          const output = await this.executeTraceroute(
            context,
            topoService,
            curServerId,
            targetSrv,
            userId,
          );
          if (context.io) {
            context.io.to(`player:${userId}`).emit("command:result", {
              success: true,
              output,
              terminalId: command.terminalId,
              timestamp: new Date(),
            });
          }
        },
      );

      if (!proc)
        return errorResult("Failed to start traceroute.");

      const etaSec = Math.ceil(proc.duration / 1000);
      return successResult(`Tracing route to ${targetServer.ipAddress}... ETA ${etaSec}s [PID ${proc.pid}]`);
    }

    // Use real topology path if available (no process system — direct execution)
    if (topoService) {
      const output = await this.executeTraceroute(
        context,
        topoService,
        currentServerId,
        targetServer,
        context.userId,
      );
      return successResult(output);
    }

    // Fallback: simulated traceroute
    return this.simulatedTraceroute(target);
  }

  private async executeTraceroute(
    context: CommandContext,
    topoService: any,
    currentServerId: string,
    targetServer: { id: string; name: string; ipAddress: string },
    userId: string,
  ): Promise<string> {
    const path = await topoService.findPath(currentServerId, targetServer.id);

    if (!path || path.length === 0) {
      return `Traceroute to ${targetServer.ipAddress}\n\n  * * * Destination unreachable — no known route. * * *`;
    }

    await topoService.discoverPath(userId, path);

    const discoveredLinks = await context.db.client.discoveredLink.findMany({
      where: { userId },
      select: { linkId: true },
    });
    const discoveredLinkIds = new Set(
      discoveredLinks.map((d: any) => d.linkId),
    );

    const knownServerIds = new Set<string>();
    knownServerIds.add(currentServerId);
    knownServerIds.add(targetServer.id);
    const allLinks = await context.db.client.serverLink.findMany({
      where: { id: { in: [...discoveredLinkIds] } },
      select: { sourceId: true, targetId: true },
    });
    for (const l of allLinks) {
      knownServerIds.add(l.sourceId);
      knownServerIds.add(l.targetId);
    }

    const columns: Column[] = [
      { header: "HOP", width: 4, align: "right" },
      { header: "IP ADDRESS", width: 16, align: "left" },
      { header: "SERVER", width: 22, align: "left" },
      { header: "ROLE", width: 10, align: "left" },
      { header: "LINK", width: 8, align: "left" },
      { header: "LATENCY", width: 7, align: "right" },
    ];

    let totalLatency = 0;
    const rows: string[][] = path.map((hop: any, i: number) => {
      totalLatency += hop.latency;
      const isKnown = knownServerIds.has(hop.serverId);
      return [
        String(i + 1),
        isKnown ? hop.serverIp : "?.?.?.?",
        isKnown ? hop.serverName.substring(0, 22) : "* * *",
        isKnown ? hop.serverRole : "???",
        hop.linkType,
        `${hop.latency}ms`,
      ];
    });

    const footer = `${path.length} hops, total latency: ${totalLatency}ms`;
    const lines = [
      `Traceroute to ${targetServer.name} (${targetServer.ipAddress})`,
      "",
    ];
    lines.push(...table(columns, rows, footer));
    return render(lines);
  }

  private simulatedTraceroute(target: string): CommandResult {
    const hops: Array<{ ip: string; latency: number; timeout: boolean }> = [];
    const numHops = Math.floor(Math.random() * 8) + 5;

    for (let i = 0; i < numHops; i++) {
      const isTimeout = Math.random() < 0.1;
      const latency = Math.floor(10 + i * 15 + Math.random() * 20);
      const ip =
        i === numHops - 1
          ? target
          : `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
      hops.push({ ip, latency, timeout: isTimeout });
    }

    const columns: Column[] = [
      { header: "HOP", width: 4, align: "right" },
      { header: "IP ADDRESS", width: 17, align: "left" },
      { header: "LATENCY", width: 9, align: "right" },
      { header: "STATUS", width: 6, align: "left" },
    ];

    const rows: string[][] = hops.map((hop, i) => [
      String(i + 1),
      hop.ip,
      `${hop.latency}ms`,
      hop.timeout ? "* * *" : "OK",
    ]);

    const lines = [`Traceroute to ${target}`, ""];
    lines.push(...table(columns, rows));

    return successResult(redactSensitiveContent(render(lines)));
  }

  // ==================== NETMAP ====================

  private async handleNetmap(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const topoService = context.services.networkTopologyService;
    if (!topoService) {
      return errorResult("Network topology service unavailable.");
    }

    const session = context.gameStateManager.getSession(context.userId);
    const currentServerId = session?.currentServerId || session?.homeServerId;
    if (!currentServerId) {
      return errorResult("Not connected to any server.");
    }

    // Parse depth flag
    const args = command.args || [];
    let depth = 2;
    for (const arg of args) {
      if (arg.startsWith("-d")) {
        depth = Math.min(5, Math.max(1, parseInt(arg.substring(2) || "2", 10)));
      }
    }

    const topology = await topoService.getPlayerTopology(
      context.userId,
      currentServerId,
      depth,
    );

    if (topology.nodes.length === 0) {
      return successResult("No discovered network topology. Use 'scan' to discover adjacent servers.");
    }

    const W = 62;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter(`NETWORK MAP (depth: ${depth})`, W));
    lines.push(boxDivider(W));

    // Build adjacency for display
    const adjMap = new Map<string, string[]>();
    for (const edge of topology.edges) {
      if (!adjMap.has(edge.fromId)) adjMap.set(edge.fromId, []);
      if (!adjMap.has(edge.toId)) adjMap.set(edge.toId, []);
      adjMap.get(edge.fromId)!.push(edge.toId);
      adjMap.get(edge.toId)!.push(edge.fromId);
    }

    // Render tree-style from current server
    const rendered = new Set<string>();
    const renderNode = (
      nodeId: string,
      prefix: string,
      isLast: boolean,
      depthLeft: number,
    ) => {
      const node = topology.nodes.find((n) => n.serverId === nodeId);
      if (!node || rendered.has(nodeId)) return;
      rendered.add(nodeId);

      const marker = node.isCurrentServer ? " << YOU" : "";
      const connector = prefix === "" ? "" : isLast ? "└── " : "├── ";
      const roleTag = `[${node.serverRole}]`;
      const secTag = `sec:${node.securityLevel}`;
      const netTag = node.networkName ? ` (${node.networkName})` : "";

      const line = `${prefix}${connector}${roleTag} ${node.serverName}`;
      const detail = `${prefix}${prefix === "" ? "" : isLast ? "    " : "│   "}  ${node.serverIp} ${secTag}${netTag}${marker}`;

      lines.push(boxRow(` ${line}`, W));
      lines.push(boxRow(` ${detail}`, W));

      if (depthLeft <= 0) return;

      // Get children (neighbors not yet rendered)
      const neighbors = (adjMap.get(nodeId) || []).filter(
        (n) => !rendered.has(n),
      );
      const childPrefix =
        prefix + (prefix === "" ? "" : isLast ? "    " : "│   ");
      neighbors.forEach((childId, i) => {
        renderNode(
          childId,
          childPrefix,
          i === neighbors.length - 1,
          depthLeft - 1,
        );
      });
    };

    renderNode(currentServerId, "", false, depth);

    // Show any disconnected nodes the player has discovered
    const unrendered = topology.nodes.filter((n) => !rendered.has(n.serverId));
    if (unrendered.length > 0) {
      lines.push(boxDivider(W));
      lines.push(boxRow(" Other discovered servers:", W));
      for (const node of unrendered.slice(0, 5)) {
        lines.push(
          boxRow(
            `   [${node.serverRole}] ${node.serverIp}  ${node.serverName}`,
            W,
          ),
        );
      }
      if (unrendered.length > 5) {
        lines.push(boxRow(`   ... +${unrendered.length - 5} more`, W));
      }
    }

    lines.push(boxDivider(W));
    lines.push(
      boxRow(
        ` ${topology.nodes.length} servers, ${topology.edges.length} links discovered`,
        W,
      ),
    );
    lines.push(boxBottom(W));

    return successResult(redactSensitiveContent(render(lines)));
  }

  // ==================== CONNECTION CHALLENGE HANDLERS ====================

  /**
   * Handle handshake.ack and signal.trace submissions.
   */
  private async handleChallengeSubmit(
    command: Command,
    context: CommandContext,
    expectedType: "handshake" | "signal_trace",
  ): Promise<CommandResult> {
    const answer = command.args?.join(" ");
    if (!answer) {
      const cmd = expectedType === "handshake" ? "handshake.ack" : "signal.trace";
      return errorResult(`Usage: ${cmd} <answer>`);
    }

    const service = context.services.connectionChallengeService;
    if (!service) {
      return errorResult("Connection challenge service unavailable.");
    }

    const session = service.getActiveSession(context.userId);
    if (!session || session.status !== "active") {
      return errorResult("No active connection challenge. Use 'connect <ip>' first.");
    }

    if (session.challenge.type !== expectedType) {
      const correctCmd = session.challenge.type === "handshake" ? "handshake.ack" : "signal.trace";
      return errorResult(`Wrong command. This challenge requires: ${correctCmd}`);
    }

    try {
      const result = service.submitAnswer(context.userId, answer);

      if (result.correct) {
        // Challenge passed — complete the connection
        const targetServer = await context.db.client.gameServer.findUnique({
          where: { id: session.targetServerId },
        });
        if (!targetServer) {
          return { success: false, output: "Target server no longer exists.", data: { connectionResolved: true }, timestamp: new Date() };
        }

        // Ensure content is ready after challenge (may have been queued during challenge)
        if (!targetServer.isPlayerHome && targetServer.type !== "player_home") {
          try {
            const { getService } = await import("../../di/container");
            const { CONTENT_QUEUE_SERVICE } = await import("../../di/tokens");
            const contentQueue = getService<any>(CONTENT_QUEUE_SERVICE);
            await contentQueue.ensureReady(targetServer.id, context.userId);
          } catch { /* non-critical */ }
        }

        const connectResult = await this.completeConnection(context, targetServer.ipAddress, targetServer);
        const outputParts = Array.isArray(connectResult.output) ? [...connectResult.output] : [connectResult.output];

        // Suggest backdoor for high-security servers
        const { BACKDOOR_CHALLENGE_SUGGESTION_THRESHOLD } = await import("../../config/gameBalance");
        if (targetServer.securityLevel > BACKDOOR_CHALLENGE_SUGGESTION_THRESHOLD) {
          outputParts.push("");
          outputParts.push("  [TIP] Use 'backdoor install' to skip this challenge next time.");
        }

        return {
          success: true,
          output: [`  [+] ${result.feedback}`, "", ...outputParts],
          data: {
            ...connectResult.data,
            connectionResolved: true,
          },
          soundEvent: "connected" as const,
          timestamp: new Date(),
        };
      }

      // Wrong answer
      if (result.session.status === "failed") {
        return {
          success: false,
          output: `  [-] ${result.feedback}\n  Connection rejected. Maximum attempts reached.\n  Try 'connect ${session.targetIp}' again for a new challenge.`,
          data: { connectionResolved: true },
          timestamp: new Date(),
        };
      }

      const remaining = result.session.challenge.maxAttempts - result.session.attempts;
      const timeLeft = Math.max(0, Math.ceil((result.session.expiresAt - Date.now()) / 1000));
      return errorResult(`  [-] ${result.feedback}\n  Attempts remaining: ${remaining} | Time: ${timeLeft}s`);
    } catch (err) {
      return {
        success: false,
        output: err instanceof Error ? err.message : "Challenge error.",
        data: { connectionResolved: true },
        timestamp: new Date(),
      };
    }
  }

  /**
   * Abort an active connection challenge.
   */
  private handleConnectAbort(context: CommandContext): CommandResult {
    const service = context.services.connectionChallengeService;
    if (!service) {
      return errorResult("No active connection challenge.");
    }

    const session = service.getActiveSession(context.userId);
    if (!session || session.status !== "active") {
      return errorResult("No active connection challenge to abort.");
    }

    service.abortSession(context.userId);
    return successResult("Connection challenge aborted.", { connectionResolved: true });
  }
}
