import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
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
  public commands: Set<string> = new Set([
    "scan",
    "servers",
    "connect",
    "disconnect",
    "traceroute",
    "probe",
    "netmap",
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
        default:
          return {
            success: false,
            output: `Network command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Network command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
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
        return {
          success: false,
          output: `Invalid partial IP: ${partialIp}\nUsage: scan 10.10.10  or  scan 10.10.10.x  or  scan 192.168\nProvide at least two octets of a known IP to sweep that subnet.`,
          timestamp: new Date(),
        };
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
      return {
        success: false,
        output: "Not connected to any server. Use 'connect home' first.",
        timestamp: new Date(),
      };
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { networking: true, level: true },
    });
    const scanLevel = progress?.networking ?? 1;

    // ── Resource check: spawn scan as a background process ──
    if (memoryService && topoService) {
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "scan");
      if (!check.allowed) {
        return {
          success: false,
          output: `Scan failed: ${check.reason}`,
          timestamp: new Date(),
        };
      }

      const proc = memoryService.spawnGameProcess(
        context.userId,
        session!.socketId || context.userId,
        "scan",
        scanLevel,
        "network scan",
        currentServerId,
        async () => {
          // ── On completion: run the actual scan and push results ──
          try {
            console.log(
              "[SCAN] Adjacency scan onComplete fired for",
              context.userId,
            );
            const results = await topoService.discoverNeighbors(
              context.userId,
              currentServerId,
              scanLevel,
            );
            console.log(
              "[SCAN] discoverNeighbors returned",
              results.length,
              "results",
            );
            const currentServer =
              await context.services.serverService.getServer(currentServerId);
            const output = this.formatScanResults(
              results,
              currentServer?.name || currentServerId,
            );

            console.log(
              "[SCAN] Emitting command:result, io available:",
              !!context.io,
            );
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true,
                output,
                terminalId: command.terminalId,
                timestamp: new Date(),
              });
            }

            // Also emit as notification for guaranteed delivery
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("notification", {
                title: "Network Scan Complete",
                message:
                  results.length > 0
                    ? `Discovered ${results.length} adjacent server(s). Check terminal for details.`
                    : `No new servers found nearby.`,
                severity: "info",
              });
            }
          } catch (err) {
            console.error("[SCAN] Adjacency scan callback error:", err);
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
      );

      if (!proc) {
        return {
          success: false,
          output: "Failed to start scan process.",
          timestamp: new Date(),
        };
      }

      const etaSec = Math.ceil(proc.duration / 1000);
      return {
        success: true,
        output: `Scanning network... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor progress.`,
        timestamp: new Date(),
      };
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
      return {
        success: true,
        output: this.formatScanResults(
          results,
          currentServer?.name || currentServerId,
        ),
        timestamp: new Date(),
      };
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
      memoryService.initComputerSpec(context.userId, progress?.level ?? 1);

      const check = memoryService.canSpawnProcess(context.userId, "scan");
      if (!check.allowed) {
        return {
          success: false,
          output: `Scan failed: ${check.reason}`,
          timestamp: new Date(),
        };
      }

      const proc = memoryService.spawnGameProcess(
        context.userId,
        session?.socketId || context.userId,
        "scan",
        scanLevel,
        `subnet sweep ${partialIp}`,
        session?.currentServerId || session?.homeServerId || context.userId,
        async () => {
          try {
            console.log(
              "[SCAN] Subnet sweep onComplete fired for",
              context.userId,
            );
            const servers =
              await context.services.serverService.scanByPartialIp(
                context.userId,
                ipPrefix,
                scanLevel,
              );
            console.log(
              "[SCAN] scanByPartialIp returned",
              servers.length,
              "servers for prefix",
              ipPrefix,
            );
            const output = this.formatSubnetSweepResults(servers, partialIp);

            console.log(
              "[SCAN] Emitting command:result, io available:",
              !!context.io,
            );
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("command:result", {
                success: true,
                output,
                terminalId,
                timestamp: new Date(),
              });
            }

            // Also emit as notification for guaranteed delivery
            if (context.io) {
              context.io.to(`player:${context.userId}`).emit("notification", {
                title: "Subnet Sweep Complete",
                message:
                  servers.length > 0
                    ? `Found ${servers.length} server(s) on ${partialIp}. Check terminal for details.`
                    : `No servers found on ${partialIp}.`,
                severity: "info",
              });
            }
          } catch (err) {
            console.error("[SCAN] Subnet sweep callback error:", err);
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
      );

      if (!proc) {
        return {
          success: false,
          output: "Failed to start subnet sweep.",
          timestamp: new Date(),
        };
      }

      const etaSec = Math.ceil(proc.duration / 1000);
      return {
        success: true,
        output: `Sweeping subnet ${partialIp}... ETA ${etaSec}s [PID ${proc.pid}]\nUse 'ps' to monitor progress.`,
        timestamp: new Date(),
      };
    }

    // ── Fallback: instant sweep (no resource system) ──
    const servers = await context.services.serverService.scanByPartialIp(
      context.userId,
      ipPrefix,
      scanLevel,
    );
    return {
      success: true,
      output: this.formatSubnetSweepResults(servers, partialIp),
      timestamp: new Date(),
    };
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
      return {
        success: true,
        output: `Scanning ${subnet}... No unknown servers found.\nTry 'connect <ip>' to reach a different network, then scan again.`,
        timestamp: new Date(),
      };
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

    return { success: true, output: render(lines), timestamp: new Date() };
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

      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error ? error.message : "Failed to list servers",
        timestamp: new Date(),
      };
    }
  }

  // ==================== CONNECT ====================

  private async handleConnect(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output:
          "Usage: connect <ip|id|home>\nMust be adjacent server or use 'connect home'.",
        timestamp: new Date(),
      };
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
          return {
            success: true,
            output: "Returned to home server.",
            timestamp: new Date(),
          };
        }
      }
      return {
        success: false,
        output: "Home server not found.",
        timestamp: new Date(),
      };
    }

    // Validate format
    const isIP = validateIPAddress(target);
    const isValidId = validateServerId(target);
    if (!isIP && !isValidId) {
      return {
        success: false,
        output: "Invalid server ID or IP address format.",
        timestamp: new Date(),
      };
    }

    // Resolve target server
    let targetServer = await context.services.serverService.getServer(target);
    if (!targetServer) {
      targetServer = await context.services.serverService.getServerByIp(target);
    }
    if (!targetServer) {
      return {
        success: false,
        output: `Server not found: ${target}`,
        timestamp: new Date(),
      };
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
          const W = 52;
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
          return {
            success: false,
            output: render(lines),
            timestamp: new Date(),
          };
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
        const W = 52;
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
        return { success: false, output: render(lines), timestamp: new Date() };
      }
    }

    // ── Proceed with connection ──
    try {
      const result = await context.services.serverService.connectToServer(
        context.userId,
        target,
      );

      if (!result.success) {
        return {
          success: false,
          output: result.message || "Connection failed",
          timestamp: new Date(),
        };
      }

      const connected = await context.gameStateManager.connectPlayerToServer(
        context.userId,
        result.serverId,
      );
      if (!connected) {
        return {
          success: false,
          output: "Failed to update connection state",
          timestamp: new Date(),
        };
      }

      // Show connection info with role and network
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
      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Connection failed",
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
        return {
          success: false,
          output: "Not connected to any server.",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId;
      await context.gameStateManager.disconnectPlayerFromServer(context.userId);
      await context.services.serverService.disconnectFromServer(
        context.userId,
        serverId,
      );

      return {
        success: true,
        output: "Disconnected. Returned to home server.",
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Disconnect failed",
        timestamp: new Date(),
      };
    }
  }

  // ==================== PROBE ====================

  private async handleProbe(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: probe <ip|id>\nExample: probe 192.168.1.1",
        timestamp: new Date(),
      };
    }

    const target = args[0]!;

    try {
      let server = await context.services.serverService.getServer(target);
      if (!server) {
        server = await context.services.serverService.getServerByIp(target);
      }
      if (!server) {
        return {
          success: false,
          output: `Server not found: ${target}`,
          timestamp: new Date(),
        };
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

      const lines = panel(`Probe: ${server.name}`, probeRows, 50);
      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Probe failed",
        timestamp: new Date(),
      };
    }
  }

  // ==================== TRACEROUTE ====================

  private async handleTraceroute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: traceroute <ip|id>",
        timestamp: new Date(),
      };
    }

    const target = args[0]!;
    const topoService = context.services.networkTopologyService;
    const session = context.gameStateManager.getSession(context.userId);
    const currentServerId = session?.currentServerId || session?.homeServerId;

    if (!currentServerId) {
      return {
        success: false,
        output: "Not connected to any server.",
        timestamp: new Date(),
      };
    }

    // Resolve target server
    let targetServer = await context.services.serverService.getServer(target);
    if (!targetServer) {
      targetServer = await context.services.serverService.getServerByIp(target);
    }
    if (!targetServer) {
      return {
        success: false,
        output: `Server not found: ${target}`,
        timestamp: new Date(),
      };
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
        return {
          success: false,
          output: `Insufficient resources: ${check.reason}`,
          timestamp: new Date(),
        };
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
        return {
          success: false,
          output: "Failed to start traceroute.",
          timestamp: new Date(),
        };

      const etaSec = Math.ceil(proc.duration / 1000);
      return {
        success: true,
        output: `Tracing route to ${targetServer.ipAddress}... ETA ${etaSec}s [PID ${proc.pid}]`,
        timestamp: new Date(),
      };
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
      return { success: true, output, timestamp: new Date() };
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

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== NETMAP ====================

  private async handleNetmap(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const topoService = context.services.networkTopologyService;
    if (!topoService) {
      return {
        success: false,
        output: "Network topology service unavailable.",
        timestamp: new Date(),
      };
    }

    const session = context.gameStateManager.getSession(context.userId);
    const currentServerId = session?.currentServerId || session?.homeServerId;
    if (!currentServerId) {
      return {
        success: false,
        output: "Not connected to any server.",
        timestamp: new Date(),
      };
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
      return {
        success: true,
        output:
          "No discovered network topology. Use 'scan' to discover adjacent servers.",
        timestamp: new Date(),
      };
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

    return { success: true, output: render(lines), timestamp: new Date() };
  }
}
