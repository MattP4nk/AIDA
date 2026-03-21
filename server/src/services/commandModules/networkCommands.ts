import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { validateIPAddress, validateServerId } from "../../utils/validators";
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
} from "./asciiBox";

export class NetworkCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "scan",
    "servers",
    "connect",
    "disconnect",
    "traceroute",
    "probe",
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
          "[Network 5] Scan current network for undiscovered servers",
        usage: "scan [-l<level>]",
        examples: ["scan", "scan -l5", "scan -l10"],
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
        description: "Connect to a remote server",
        usage: "connect <server_id>",
        examples: ["connect 192.168.1.1", "connect server_001"],
      },
      {
        command: "disconnect",
        category: "network",
        description: "Disconnect from current server",
        usage: "disconnect",
        examples: ["disconnect"],
      },
      {
        command: "probe",
        category: "network",
        description: "[Network 10] Get detailed server information",
        usage: "probe <server_id>",
        examples: ["probe 192.168.1.1"],
      },
      {
        command: "traceroute",
        category: "network",
        description: "[Network 15] Trace network path to a server",
        usage: "traceroute <server_id>",
        examples: ["traceroute 192.168.1.1"],
      },
    ];
  }

  private async handleScan(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];

    // Get player's scan level (from args or default to base level)
    let scanLevel = 1;
    if (args.length > 0 && args[0]?.startsWith("-l")) {
      scanLevel = parseInt(args[0].substring(2) || "1", 10) || 1;
    }

    try {
      // Determine which network we're scanning from.
      // If connected to a remote server, scan that server's subnet.
      // Otherwise scan from the player's home server.
      const session = context.gameStateManager.getSession(context.userId);
      let fromIp: string | undefined;
      let networkLabel = "local network";

      if (session?.currentServerId) {
        const currentServer = await context.services.serverService.getServer(
          session.currentServerId,
        );
        if (currentServer) {
          fromIp = currentServer.ipAddress;
          const subnet = fromIp.split(".").slice(0, 2).join(".");
          networkLabel = `${subnet}.x.x`;
        }
      } else if (session?.homeServerId) {
        const homeServer = await context.services.serverService.getServer(
          session.homeServerId,
        );
        if (homeServer) {
          fromIp = homeServer.ipAddress;
          const subnet = fromIp.split(".").slice(0, 2).join(".");
          networkLabel = `${subnet}.x.x`;
        }
      }

      const servers = await context.services.serverService.discoverServers(
        context.userId,
        scanLevel,
        fromIp,
      );

      if (servers.length === 0) {
        return {
          success: true,
          output: `Scanning ${networkLabel}... No unknown servers found.\nTry 'connect <ip>' to reach a different network, then scan again.`,
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
        server.isOnline ? "[+] ONLINE" : "[-] OFFLINE",
      ]);

      const footer = `Found ${servers.length} new server${servers.length !== 1 ? "s" : ""}. Use 'connect <ip>' to connect.`;

      const titleLine = `Network Scan: ${networkLabel} (Level ${scanLevel})`;
      const lines = [titleLine, ""];
      lines.push(...table(columns, rows, footer));

      return {
        success: true,
        output: render(lines),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Scan failed",
        timestamp: new Date(),
      };
    }
  }

  // ==================== SERVERS (Known Servers) ====================

  private async handleServers(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const session = context.gameStateManager.getSession(context.userId);
      const W = 56;
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
          session?.currentServerId === homeServer.id ? " ◄ CONNECTED" : "";
        lines.push(boxRow(`  ⌂ HOME SERVER${tag}`, W));
        lines.push(
          boxRow(
            `    ${homeServer.ipAddress}  ${(homeServer.name || "Home").substring(0, 30)}`,
            W,
          ),
        );
      } else {
        lines.push(boxRow("  ⌂ HOME SERVER", W));
        lines.push(boxRow("    (not initialized)", W));
      }

      // ── 2. Owned servers (non-home) ──
      const ownedServers = await context.db.client.gameServer.findMany({
        where: {
          ownerId: context.userId,
          isPlayerHome: false,
        },
        orderBy: { name: "asc" },
      });

      if (ownedServers.length > 0) {
        lines.push(boxDivider(W));
        lines.push(boxRow(`  ★ OWNED SERVERS (${ownedServers.length})`, W));
        for (const srv of ownedServers) {
          const tag = session?.currentServerId === srv.id ? " ◄" : "";
          const status = srv.isOnline ? "ON" : "OFF";
          lines.push(
            boxRow(
              `    ${srv.ipAddress}  ${srv.name.substring(0, 22)}  [${status}]${tag}`,
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
            lines.push(boxRow("  ► CONNECTED", W));
            lines.push(
              boxRow(
                `    ${remote.ipAddress}  ${(remote.name || "unknown").substring(0, 22)}  [${remote.type}]`,
                W,
              ),
            );
          }
        }
      }

      // ── 4. Previously visited (connection history, deduplicated) ──
      const history = await context.services.serverService.getConnectionHistory(
        context.userId,
        30,
      );

      // Collect unique server IDs we've already shown
      const shownIds = new Set<string>();
      if (homeServer) shownIds.add(homeServer.id);
      for (const s of ownedServers) shownIds.add(s.id);
      if (session?.currentServerId) shownIds.add(session.currentServerId);

      const visitedConnections = history.filter(
        (c) => !shownIds.has(c.serverId),
      );

      // Deduplicate by serverId, keep most recent
      const visitedMap = new Map<string, (typeof history)[0]>();
      for (const conn of visitedConnections) {
        if (!visitedMap.has(conn.serverId)) {
          visitedMap.set(conn.serverId, conn);
        }
      }
      const visited = Array.from(visitedMap.values());

      if (visited.length > 0) {
        lines.push(boxDivider(W));
        lines.push(boxRow(`  ◇ PREVIOUSLY VISITED (${visited.length})`, W));
        for (const conn of visited.slice(0, 15)) {
          const srv = (conn as any).server;
          if (srv) {
            const status = srv.isOnline ? "ON" : "OFF";
            lines.push(
              boxRow(
                `    ${srv.ipAddress}  ${(srv.name || "???").substring(0, 22)}  [${status}]`,
                W,
              ),
            );
          } else {
            lines.push(
              boxRow(`    ${conn.serverId.substring(0, 16)}  (unknown)`, W),
            );
          }
        }
        if (visited.length > 15) {
          lines.push(boxRow(`    ... and ${visited.length - 15} more`, W));
        }
      }

      lines.push(boxDivider(W));
      lines.push(boxRow(`  Use 'scan' to discover new servers`, W));
      lines.push(boxRow(`  Use 'connect <ip>' to connect`, W));
      lines.push(boxBottom(W));

      return {
        success: true,
        output: render(lines),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error ? error.message : "Failed to list servers",
        timestamp: new Date(),
      };
    }
  }

  private async handleConnect(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: connect <server_id>\nExample: connect 192.168.1.1",
        timestamp: new Date(),
      };
    }

    const serverId = args[0];
    if (!serverId) {
      return {
        success: false,
        output: "Invalid server ID",
        timestamp: new Date(),
      };
    }

    // Validate server ID or IP address format
    const isIP = validateIPAddress(serverId);
    const isValidId = validateServerId(serverId);

    if (!isIP && !isValidId) {
      return {
        success: false,
        output: "Invalid server ID or IP address format",
        timestamp: new Date(),
      };
    }

    try {
      // Connect via ServerService
      const result = await context.services.serverService.connectToServer(
        context.userId,
        serverId,
      );

      if (!result.success) {
        return {
          success: false,
          output: result.message || "Connection failed",
          timestamp: new Date(),
        };
      }

      // Update game state (use the resolved server ID, not the raw IP input)
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

      const lines = statusCard("CONNECTED", [
        { label: "Status:        ", value: result.message || "Connected" },
        { label: "Access Level:  ", value: String(result.accessLevel) },
      ]);

      return {
        success: true,
        output: render(lines),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Connection failed",
        timestamp: new Date(),
      };
    }
  }

  private async handleDisconnect(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      const session = context.gameStateManager.getSession(context.userId);
      if (!session || !session.currentServerId) {
        return {
          success: false,
          output: "Not connected to any server",
          timestamp: new Date(),
        };
      }

      const serverId = session.currentServerId;

      // Disconnect via GameStateManager
      await context.gameStateManager.disconnectPlayerFromServer(context.userId);

      // Update ServerService
      await context.services.serverService.disconnectFromServer(
        context.userId,
        serverId,
      );

      return {
        success: true,
        output: `Disconnected from server ${serverId}`,
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

  private async handleProbe(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: probe <server_id>\nExample: probe 192.168.1.1",
        timestamp: new Date(),
      };
    }

    const serverId = args[0];
    if (!serverId) {
      return {
        success: false,
        output: "Invalid server ID",
        timestamp: new Date(),
      };
    }

    try {
      // Get server information
      const server = await context.services.serverService.getServer(serverId);
      if (!server) {
        return {
          success: false,
          output: `Server not found: ${serverId}`,
          timestamp: new Date(),
        };
      }

      // Check accessibility
      const accessCheck = await context.services.serverService.canAccessServer(
        context.userId,
        serverId,
      );

      const statusStr = server.isOnline ? "ONLINE" : "OFFLINE";
      const accessStr = accessCheck.canAccess
        ? `Granted (Level ${accessCheck.accessLevel})`
        : "Denied";

      const probeRows: Array<{ label: string; value: string }> = [
        { label: "IP Address:    ", value: server.ipAddress },
        { label: "Type:          ", value: server.type },
        { label: "Security:      ", value: `Level ${server.encryptionLevel}` },
        { label: "Status:        ", value: statusStr },
        {
          label: "Connections:   ",
          value: `${server.currentConnections}/${server.maxConnections}`,
        },
        { label: "Access:        ", value: accessStr },
      ];

      if (!accessCheck.canAccess && accessCheck.reason) {
        probeRows.push({ label: "Reason:        ", value: accessCheck.reason });
      }

      const lines = panel(`Probe Results: ${server.name}`, probeRows, 44);

      return {
        success: true,
        output: render(lines),
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output: error instanceof Error ? error.message : "Probe failed",
        timestamp: new Date(),
      };
    }
  }

  private async handleTraceroute(
    command: Command,
    _context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    if (args.length === 0) {
      return {
        success: false,
        output:
          "Usage: traceroute <server_id>\nExample: traceroute 192.168.1.1",
        timestamp: new Date(),
      };
    }

    const target = args[0] || "";

    // Generate a simulated traceroute
    const hops = this.generateTraceroute(target);

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

    const titleLine = `Traceroute to ${target}`;
    const lines = [titleLine, ""];
    lines.push(...table(columns, rows));

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  /**
   * Generate simulated traceroute hops
   */
  private generateTraceroute(target: string): Array<{
    ip: string;
    latency: number;
    timeout: boolean;
  }> {
    const hops: Array<{ ip: string; latency: number; timeout: boolean }> = [];
    const numHops = Math.floor(Math.random() * 8) + 5; // 5-12 hops

    // Generate IPs between local and target
    for (let i = 0; i < numHops; i++) {
      const isTimeout = Math.random() < 0.1; // 10% chance of timeout
      const latency = Math.floor(10 + i * 15 + Math.random() * 20);

      let ip: string;
      if (i === numHops - 1) {
        // Last hop is the target
        ip = target;
      } else {
        // Generate intermediate IP
        const octet1 = Math.floor(Math.random() * 256);
        const octet2 = Math.floor(Math.random() * 256);
        const octet3 = Math.floor(Math.random() * 256);
        const octet4 = Math.floor(Math.random() * 256);
        ip = `${octet1}.${octet2}.${octet3}.${octet4}`;
      }

      hops.push({ ip, latency, timeout: isTimeout });
    }

    return hops;
  }
}
