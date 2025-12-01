import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { validateIPAddress, validateServerId } from "../../utils/validators";

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
        case "servers":
          return await this.handleScan(command, context);

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
        description: "Scan network for available servers",
        usage: "scan [-l<level>]",
        examples: ["scan", "scan -l5", "scan -l10"],
      },
      {
        command: "servers",
        category: "network",
        description: "Alias for scan - list available servers",
        usage: "servers [-l<level>]",
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
        description: "Get detailed server information",
        usage: "probe <server_id>",
        examples: ["probe 192.168.1.1"],
      },
      {
        command: "traceroute",
        category: "network",
        description: "Trace network path to a server",
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
      const servers = await context.services.serverService.discoverServers(
        context.userId,
        scanLevel,
      );

      if (servers.length === 0) {
        return {
          success: true,
          output:
            "No servers found. Try increasing your scan level with 'scan -l<level>'.",
          timestamp: new Date(),
        };
      }

      let output = `🔍 Network Scan Results (Level ${scanLevel})\n\n`;
      output +=
        "ID                IP ADDRESS      TYPE         SECURITY  STATUS\n";
      output += "─".repeat(70) + "\n";

      for (const server of servers) {
        const id = server.id.substring(0, 16).padEnd(18);
        const ip = server.ipAddress.padEnd(16);
        const type = (server.type || "unknown").padEnd(13);
        const security = `Level ${server.encryptionLevel}`.padEnd(10);
        const status = server.isOnline ? "🟢 Online" : "🔴 Offline";

        output += `${id}${ip}${type}${security}${status}\n`;
      }

      output += `\nFound ${servers.length} server${servers.length !== 1 ? "s" : ""}. Use 'connect <server_id>' to connect.`;

      return {
        success: true,
        output,
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

      // Update game state
      const connected = await context.gameStateManager.connectPlayerToServer(
        context.userId,
        serverId,
      );

      if (!connected) {
        return {
          success: false,
          output: "Failed to update connection state",
          timestamp: new Date(),
        };
      }

      return {
        success: true,
        output: `✅ ${result.message}\nAccess Level: ${result.accessLevel}`,
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

      let output = `🔎 Probe Results for ${server.name}\n\n`;
      output += `IP Address: ${server.ipAddress}\n`;
      output += `Type: ${server.type}\n`;
      output += `Security Level: ${server.encryptionLevel}\n`;
      output += `Status: ${server.isOnline ? "🟢 Online" : "🔴 Offline"}\n`;
      output += `Connections: ${server.currentConnections}/${server.maxConnections}\n`;
      output += `\nAccess: ${accessCheck.canAccess ? `✅ Granted (Level ${accessCheck.accessLevel})` : "❌ Denied"}\n`;

      if (!accessCheck.canAccess && accessCheck.reason) {
        output += `Reason: ${accessCheck.reason}`;
      }

      return {
        success: true,
        output,
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

    let output = `🌐 Traceroute to ${target}\n\n`;
    output += "HOP  IP ADDRESS        LATENCY   STATUS\n";
    output += "─".repeat(50) + "\n";

    for (let i = 0; i < hops.length; i++) {
      const hop = hops[i];
      if (!hop) continue;

      const hopNum = (i + 1).toString().padEnd(5);
      const ip = hop.ip.padEnd(18);
      const latency = `${hop.latency}ms`.padEnd(10);
      const status = hop.timeout ? "* * *" : "✓";

      output += `${hopNum}${ip}${latency}${status}\n`;
    }

    return {
      success: true,
      output,
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
