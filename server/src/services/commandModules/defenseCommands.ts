import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext, CommandInfo } from "./interface";
import { getSession, successResult, errorResult } from "./helpers";
import {
  boxTop,
  boxBottom,
  boxRow,
  boxDivider,
  boxCenter,
  render,
} from "./asciiBox";

/**
 * DefenseCommandsModule — Player home server defense management.
 *
 * Commands:
 *   defenses      — View current home defense status
 *   protect       — Toggle folder protection on a directory
 *   safevault     — Manage encrypted vault (move files in/out)
 *   honeypot      — Toggle honeypot decoy directory
 *   upgrade       — Purchase defense upgrades
 */
export class DefenseCommandsModule implements CommandModule {
  public category = "defense";
  public commands: Set<string> = new Set([
    "defenses",
    "protect",
    "safevault",
    "honeypot",
    "upgrade",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    switch (command.command) {
      case "defenses":
        return await this.handleDefenses(context);
      case "protect":
        return await this.handleProtect(command, context);
      case "safevault":
        return await this.handleSafeVault(command, context);
      case "honeypot":
        return await this.handleHoneypot(command, context);
      case "upgrade":
        return await this.handleUpgrade(command, context);
      default:
        return errorResult(`Unknown command: ${command.command}`);
    }
  }

  // ── defenses — show current defense status ──
  private async handleDefenses(context: CommandContext): Promise<CommandResult> {
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });

    if (!progress) {
      return errorResult("No player data found.");
    }

    const W = 54;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("HOME SERVER DEFENSES", W));
    lines.push(boxDivider(W));

    // Firewall
    const fwLevel = progress.homeFirewall;
    const fwLabel = fwLevel === 0 ? "NONE" : `Level ${fwLevel}`;
    const fwDesc = fwLevel === 0 ? "No firewall — attackers connect freely"
      : fwLevel === 1 ? "Basic — adds port_sequence challenge"
      : fwLevel === 2 ? "Advanced — adds harder port_sequence"
      : "Military — adds port_sequence + cipher challenge";
    lines.push(boxRow(` Firewall: ${fwLabel}`, W));
    lines.push(boxRow(`   ${fwDesc}`, W));
    lines.push(boxDivider(W));

    // Vault
    const vaultLevel = progress.homeVault;
    const vaultLabel = vaultLevel === 0 ? "NONE" : `Level ${vaultLevel}`;
    const vaultDesc = vaultLevel === 0 ? "No vault — files in ~/downloads/ exposed"
      : vaultLevel === 1 ? "Basic — cipher challenge to access"
      : vaultLevel === 2 ? "Encrypted — cipher + memory_trace"
      : "Quantum — all 3 minigame layers to crack";
    lines.push(boxRow(` Safe Vault: ${vaultLabel}`, W));
    lines.push(boxRow(`   ${vaultDesc}`, W));
    lines.push(boxDivider(W));

    // IDS
    const idsLevel = progress.homeIds;
    const idsLabel = idsLevel === 0 ? "NONE" : `Level ${idsLevel}`;
    const idsDesc = idsLevel === 0 ? "No alerts — you won't know you're hacked"
      : idsLevel === 1 ? "Basic — alert when hack completes"
      : idsLevel === 2 ? "Advanced — alert when hack starts"
      : "Elite — alert on hack start + attacker IP revealed";
    lines.push(boxRow(` IDS: ${idsLabel}`, W));
    lines.push(boxRow(`   ${idsDesc}`, W));
    lines.push(boxDivider(W));

    // Honeypot
    const hpEnabled = progress.homeHoneypot;
    lines.push(boxRow(` Honeypot: ${hpEnabled ? "ACTIVE" : "INACTIVE"}`, W));
    lines.push(boxRow(`   ${hpEnabled ? "Decoy ~/downloads/ folder deployed" : "No decoys — attackers find real files"}`, W));
    lines.push(boxDivider(W));

    // Protected folders
    const session = getSession(context);
    if (session?.homeServerId) {
      const protectedDirs = await context.db.client.fileSystemNode.count({
        where: {
          serverId: session.homeServerId,
          type: "directory",
          isProtected: true,
        },
      });
      lines.push(boxRow(` Protected Folders: ${protectedDirs}`, W));
    }

    lines.push(boxDivider(W));
    lines.push(boxRow(" 'upgrade <defense> <level>' to purchase", W));
    lines.push(boxRow(" 'protect <dir>' to toggle folder protection", W));
    lines.push(boxRow(" 'safevault move <file>' to secure a file", W));
    lines.push(boxBottom(W));

    return successResult(render(lines));
  }

  // ── protect — toggle protection on a directory ──
  private async handleProtect(command: Command, context: CommandContext): Promise<CommandResult> {
    const session = getSession(context);
    if (!session?.homeServerId) {
      return errorResult("No home server.");
    }

    // Must be on home server
    const currentServerId = session.currentServerId || session.homeServerId;
    if (currentServerId !== session.homeServerId) {
      return errorResult("You can only protect directories on your home server.");
    }

    if (command.args.length === 0) {
      return errorResult("Usage: protect <directory>\nToggles protection on a directory. Protected dirs require memory_trace minigame to access.");
    }

    const dirName = command.args[0]!;
    const path = this.resolvePath(dirName, context);

    // Find the directory
    const dir = await this.findNode(context, session.homeServerId, path, "directory");
    if (!dir) {
      return errorResult(`Directory not found: ${path}`);
    }

    // Toggle protection
    const newProtected = !dir.isProtected;
    await context.db.client.fileSystemNode.update({
      where: { id: dir.id },
      data: { isProtected: newProtected },
    });

    if (newProtected) {
      return successResult(`Directory '${path}' is now PROTECTED.\nFiles inside cannot be deleted, moved, or modified by attackers.\nProtected files are hidden from low-access intruders.\nUse 'protect ${dirName}' again to remove protection.`);
    } else {
      return successResult(`Protection removed from '${path}'.`);
    }
  }

  // ── safevault — manage encrypted vault ──
  private async handleSafeVault(command: Command, context: CommandContext): Promise<CommandResult> {
    const session = getSession(context);
    if (!session?.homeServerId) {
      return errorResult("No home server.");
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { homeVault: true },
    });

    if (!progress || progress.homeVault === 0) {
      return errorResult("You don't have a vault installed. Use 'upgrade vault 1' to purchase one.");
    }

    const action = command.args[0];

    if (!action || action === "status") {
      // Show vault contents
      const user = await context.db.client.user.findUnique({
        where: { id: context.userId },
        select: { username: true },
      });
      const vaultPath = `/home/${user?.username || "user"}/.vault`;

      const vaultDir = await this.findNode(context, session.homeServerId, vaultPath, "directory");
      if (!vaultDir) {
        return successResult(`Vault (Level ${progress.homeVault}) — Empty.\nUse 'safevault move <file>' to secure files.`);
      }

      const files = await context.db.client.fileSystemNode.findMany({
        where: { parentId: vaultDir.id, type: "file" },
        select: { name: true, size: true },
      });

      if (files.length === 0) {
        return successResult(`Vault (Level ${progress.homeVault}) — Empty.\nUse 'safevault move <file>' to secure files.`);
      }

      const W = 48;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter(`SAFE VAULT (Level ${progress.homeVault})`, W));
      lines.push(boxDivider(W));
      for (const f of files) {
        lines.push(boxRow(` ${f.name} (${f.size}B)`, W));
      }
      lines.push(boxDivider(W));
      lines.push(boxRow(` ${files.length} file(s) secured`, W));
      lines.push(boxBottom(W));
      return successResult(render(lines));
    }

    if (action === "move") {
      const filename = command.args[1];
      if (!filename) {
        return errorResult("Usage: safevault move <file>\nMoves a file from ~/downloads/ into the vault.");
      }

      const user = await context.db.client.user.findUnique({
        where: { id: context.userId },
        select: { username: true },
      });
      const username = user?.username || "user";
      const downloadsPath = `/home/${username}/downloads`;
      const vaultPath = `/home/${username}/.vault`;

      // Find the file in downloads
      const downloadsDir = await this.findNode(context, session.homeServerId, downloadsPath, "directory");
      if (!downloadsDir) {
        return errorResult("No downloads directory found.");
      }

      const file = await context.db.client.fileSystemNode.findFirst({
        where: { parentId: downloadsDir.id, name: filename, type: "file" },
      });
      if (!file) {
        return errorResult(`File '${filename}' not found in ~/downloads/.`);
      }

      // Ensure vault directory exists
      let vaultDir = await this.findNode(context, session.homeServerId, vaultPath, "directory");
      if (!vaultDir) {
        await context.fileService.createDirectory(session.homeServerId, context.userId, vaultPath);
        vaultDir = await this.findNode(context, session.homeServerId, vaultPath, "directory");
      }

      if (!vaultDir) {
        return errorResult("Failed to create vault directory.");
      }

      // Move file: update parentId + mark as protected and hidden
      await context.db.client.fileSystemNode.update({
        where: { id: file.id },
        data: {
          parentId: vaultDir.id,
          isProtected: true,
          isHidden: true,
        },
      });

      return successResult(`Moved '${filename}' to vault.\nFile is now encrypted and hidden. Attackers must crack Level ${progress.homeVault} vault to access it.`);
    }

    if (action === "retrieve") {
      const filename = command.args[1];
      if (!filename) {
        return errorResult("Usage: safevault retrieve <file>\nMoves a file from vault back to ~/downloads/.");
      }

      const user = await context.db.client.user.findUnique({
        where: { id: context.userId },
        select: { username: true },
      });
      const username = user?.username || "user";
      const downloadsPath = `/home/${username}/downloads`;
      const vaultPath = `/home/${username}/.vault`;

      const vaultDir = await this.findNode(context, session.homeServerId, vaultPath, "directory");
      if (!vaultDir) {
        return errorResult("Vault is empty.");
      }

      const file = await context.db.client.fileSystemNode.findFirst({
        where: { parentId: vaultDir.id, name: filename, type: "file" },
      });
      if (!file) {
        return errorResult(`File '${filename}' not found in vault.`);
      }

      // Ensure downloads dir exists
      let dlDir = await this.findNode(context, session.homeServerId, downloadsPath, "directory");
      if (!dlDir) {
        await context.fileService.createDirectory(session.homeServerId, context.userId, downloadsPath);
        dlDir = await this.findNode(context, session.homeServerId, downloadsPath, "directory");
      }

      if (!dlDir) {
        return errorResult("Failed to access downloads directory.");
      }

      await context.db.client.fileSystemNode.update({
        where: { id: file.id },
        data: {
          parentId: dlDir.id,
          isProtected: false,
          isHidden: false,
        },
      });

      return successResult(`Retrieved '${filename}' from vault → ~/downloads/.\nFile is no longer protected by vault encryption.`);
    }

    return errorResult("Usage: safevault [status|move <file>|retrieve <file>]");
  }

  // ── honeypot — toggle decoy directory ──
  private async handleHoneypot(command: Command, context: CommandContext): Promise<CommandResult> {
    const session = getSession(context);
    if (!session?.homeServerId) {
      return errorResult("No home server.");
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
      select: { homeHoneypot: true },
    });

    if (!progress) {
      return errorResult("No player data found.");
    }

    if (!progress.homeHoneypot) {
      return errorResult("Honeypot not installed. Use 'upgrade honeypot' to purchase.");
    }

    const action = command.args[0] || "status";

    if (action === "status") {
      const user = await context.db.client.user.findUnique({
        where: { id: context.userId },
        select: { username: true },
      });
      const decoyPath = `/home/${user?.username || "user"}/downloads`;

      // Check if decoy directory exists with decoy files
      const decoyDir = await this.findNode(context, session.homeServerId, decoyPath, "directory");
      const decoyFiles = decoyDir ? await context.db.client.fileSystemNode.count({
        where: {
          parentId: decoyDir.id,
          type: "file",
          metadata: { path: ["isDecoy"], equals: true },
        },
      }) : 0;

      return successResult(`Honeypot Status: ACTIVE\nDecoy files deployed: ${decoyFiles}\nAttackers who delete decoy files waste time and trigger additional alerts.`);
    }

    if (action === "refresh") {
      // Generate fresh decoy files
      await this.generateDecoyFiles(context, session.homeServerId);
      return successResult("Honeypot decoy files refreshed. New fake downloads deployed.");
    }

    return errorResult("Usage: honeypot [status|refresh]");
  }

  // ── upgrade — purchase defense upgrades ──
  private async handleUpgrade(command: Command, context: CommandContext): Promise<CommandResult> {
    const defense = command.args[0]?.toLowerCase();
    const levelStr = command.args[1];

    if (!defense) {
      const W = context.terminalWidth;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("DEFENSE UPGRADES", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(" upgrade firewall <1|2|3>", W));
      lines.push(boxRow("   L1: 2000c  L2: 5000c  L3: 12000c", W));
      lines.push(boxRow("   Adds port_sequence challenges for attackers", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(" upgrade vault <1|2|3>", W));
      lines.push(boxRow("   L1: 3000c  L2: 8000c  L3: 20000c", W));
      lines.push(boxRow("   Encrypted directory with multi-layer lock", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(" upgrade ids <1|2|3>", W));
      lines.push(boxRow("   L1: 1500c  L2: 4000c  L3: 10000c", W));
      lines.push(boxRow("   Intrusion alerts when home is hacked", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(" upgrade honeypot", W));
      lines.push(boxRow("   5000c — decoy files to waste attackers", W));
      lines.push(boxBottom(W));
      return successResult(render(lines));
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });
    if (!progress) {
      return errorResult("No player data found.");
    }

    // Price tables
    const FIREWALL_PRICES: Record<number, number> = { 1: 2000, 2: 5000, 3: 12000 };
    const VAULT_PRICES: Record<number, number> = { 1: 3000, 2: 8000, 3: 20000 };
    const IDS_PRICES: Record<number, number> = { 1: 1500, 2: 4000, 3: 10000 };
    const HONEYPOT_PRICE = 5000;

    if (defense === "firewall") {
      const level = parseInt(levelStr || "0");
      if (level < 1 || level > 3) {
        return errorResult("Usage: upgrade firewall <1|2|3>");
      }
      if (progress.homeFirewall >= level) {
        return errorResult(`Already at firewall level ${progress.homeFirewall}.`);
      }
      const price = FIREWALL_PRICES[level]!;
      if (progress.credits < price) {
        return errorResult(`Not enough credits. Need ${price}c, have ${progress.credits}c.`);
      }
      await context.db.client.playerProgress.update({
        where: { userId: context.userId },
        data: { credits: { decrement: price }, homeFirewall: level },
      });
      // NOTE: We don't update GameServer.firewallLevel here — the defense layers are added
      // dynamically in hackService.initiateHackSession() based on homeFirewall level.
      // Changing the server's base firewallLevel would double-apply the defense.
      if (context.services.missionIntegrationService) {
        context.services.missionIntegrationService.onDefenseEvent(context.userId, "firewall", level).catch(() => {});
      }
      return successResult(`Firewall upgraded to Level ${level}! (-${price}c)\nAttackers now face additional port_sequence challenges.`);
    }

    if (defense === "vault") {
      const level = parseInt(levelStr || "0");
      if (level < 1 || level > 3) {
        return errorResult("Usage: upgrade vault <1|2|3>");
      }
      if (progress.homeVault >= level) {
        return errorResult(`Already at vault level ${progress.homeVault}.`);
      }
      const price = VAULT_PRICES[level]!;
      if (progress.credits < price) {
        return errorResult(`Not enough credits. Need ${price}c, have ${progress.credits}c.`);
      }
      await context.db.client.playerProgress.update({
        where: { userId: context.userId },
        data: { credits: { decrement: price }, homeVault: level },
      });
      // Create vault directory on home server
      const session = getSession(context);
      if (session?.homeServerId) {
        const user = await context.db.client.user.findUnique({
          where: { id: context.userId },
          select: { username: true },
        });
        const vaultPath = `/home/${user?.username || "user"}/.vault`;
        await context.fileService.createDirectory(session.homeServerId, context.userId, vaultPath).catch(() => {});
        // Mark vault dir as hidden + protected
        const vaultDir = await this.findNode(context, session.homeServerId, vaultPath, "directory");
        if (vaultDir) {
          await context.db.client.fileSystemNode.update({
            where: { id: vaultDir.id },
            data: { isHidden: true, isProtected: true },
          });
        }
      }
      const layerDesc = level === 1 ? "cipher" : level === 2 ? "cipher + memory_trace" : "cipher + port_sequence + memory_trace";
      if (context.services.missionIntegrationService) {
        context.services.missionIntegrationService.onDefenseEvent(context.userId, "vault", level).catch(() => {});
      }
      return successResult(`Vault upgraded to Level ${level}! (-${price}c)\nVault directory created at ~/.vault/\nAttackers must solve: ${layerDesc}`);
    }

    if (defense === "ids") {
      const level = parseInt(levelStr || "0");
      if (level < 1 || level > 3) {
        return errorResult("Usage: upgrade ids <1|2|3>");
      }
      if (progress.homeIds >= level) {
        return errorResult(`Already at IDS level ${progress.homeIds}.`);
      }
      const price = IDS_PRICES[level]!;
      if (progress.credits < price) {
        return errorResult(`Not enough credits. Need ${price}c, have ${progress.credits}c.`);
      }
      await context.db.client.playerProgress.update({
        where: { userId: context.userId },
        data: { credits: { decrement: price }, homeIds: level },
      });
      const desc = level === 1 ? "Alert when hack completes" : level === 2 ? "Alert when hack starts" : "Alert on start + attacker IP";
      if (context.services.missionIntegrationService) {
        context.services.missionIntegrationService.onDefenseEvent(context.userId, "ids", level).catch(() => {});
      }
      return successResult(`IDS upgraded to Level ${level}! (-${price}c)\n${desc}`);
    }

    if (defense === "honeypot") {
      if (progress.homeHoneypot) {
        return errorResult("Honeypot already installed.");
      }
      if (progress.credits < HONEYPOT_PRICE) {
        return errorResult(`Not enough credits. Need ${HONEYPOT_PRICE}c, have ${progress.credits}c.`);
      }
      await context.db.client.playerProgress.update({
        where: { userId: context.userId },
        data: { credits: { decrement: HONEYPOT_PRICE }, homeHoneypot: true },
      });
      // Generate initial decoy files
      const session = getSession(context);
      if (session?.homeServerId) {
        await this.generateDecoyFiles(context, session.homeServerId);
      }
      if (context.services.missionIntegrationService) {
        context.services.missionIntegrationService.onDefenseEvent(context.userId, "honeypot", 1).catch(() => {});
      }
      return successResult(`Honeypot installed! (-${HONEYPOT_PRICE}c)\nDecoy files deployed in ~/downloads/.\nAttackers who target decoys waste time and trigger alerts.`);
    }

    return errorResult(`Unknown defense: ${defense}. Options: firewall, vault, ids, honeypot`);
  }

  // ── Helper: generate decoy files ──
  private async generateDecoyFiles(context: CommandContext, homeServerId: string): Promise<void> {
    const user = await context.db.client.user.findUnique({
      where: { id: context.userId },
      select: { username: true },
    });
    const downloadsPath = `/home/${user?.username || "user"}/downloads`;

    // Ensure downloads dir exists
    await context.fileService.createDirectory(homeServerId, context.userId, downloadsPath).catch(() => {});

    const dlDir = await this.findNode(context, homeServerId, downloadsPath, "directory");
    if (!dlDir) return;

    // Remove old decoys
    await context.db.client.fileSystemNode.deleteMany({
      where: {
        parentId: dlDir.id,
        type: "file",
        metadata: { path: ["isDecoy"], equals: true },
      },
    });

    // Generate 3-5 fake downloaded files with realistic names
    const decoyNames = [
      "credentials_backup.txt",
      "server_access_keys.enc",
      "financial_report_Q4.pdf",
      "admin_passwords.db",
      "classified_intel.dat",
      "network_map_internal.svg",
      "employee_database.csv",
    ];
    const shuffled = decoyNames.sort(() => Math.random() - 0.5);
    const count = 3 + Math.floor(Math.random() * 3);

    for (let i = 0; i < count && i < shuffled.length; i++) {
      const name = shuffled[i]!;
      const fakeContent = `[DECOY FILE — This file contains no real data]\n[Generated by honeypot defense system]\n${"0".repeat(50 + Math.floor(Math.random() * 200))}`;

      await context.db.client.fileSystemNode.create({
        data: {
          serverId: homeServerId,
          parentId: dlDir.id,
          name,
          type: "file",
          content: fakeContent,
          size: fakeContent.length,
          createdBy: context.userId,
          metadata: {
            isDecoy: true,
            sourceServerId: "decoy",
            sourcePath: "/fake/path",
            downloadedAt: new Date(Date.now() - Math.floor(Math.random() * 86400000)).toISOString(),
            isDownloaded: true,
          },
        },
      });
    }
  }

  // ── Helper: resolve path ──
  private resolvePath(input: string, context: CommandContext): string {
    if (input.startsWith("/")) return input;
    const session = getSession(context);
    const cwd = session?.currentDirectory || "/";
    return cwd === "/" ? `/${input}` : `${cwd}/${input}`;
  }

  // ── Helper: find filesystem node by path ──
  private async findNode(
    context: CommandContext,
    serverId: string,
    path: string,
    type: "file" | "directory",
  ): Promise<{ id: string; name: string; isProtected: boolean; isHidden: boolean } | null> {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    // Walk path from root
    let parentId: string | null = null;

    // Find root
    const root = await context.db.client.fileSystemNode.findFirst({
      where: { serverId, name: "/", parentId: null },
      select: { id: true, name: true, isProtected: true, isHidden: true },
    });
    if (!root) return null;
    parentId = root.id;

    // Walk to target
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const node: { id: string; name: string; isProtected: boolean; isHidden: boolean } | null = await context.db.client.fileSystemNode.findFirst({
        where: {
          serverId,
          parentId,
          name: parts[i]!,
          type: isLast ? type : "directory",
        },
        select: { id: true, name: true, isProtected: true, isHidden: true },
      });
      if (!node) return null;
      if (isLast) return node;
      parentId = node.id;
    }

    return null;
  }

  public getCommandInfo(): CommandInfo[] {
    return [
      { command: "defenses", category: "defense", description: "View home server defense status", usage: "defenses", examples: ["defenses"] },
      { command: "protect", category: "defense", description: "Toggle protection on a directory", usage: "protect <directory>", examples: ["protect downloads", "protect .vault"] },
      { command: "safevault", category: "defense", description: "Manage encrypted vault", usage: "safevault [status|move <file>|retrieve <file>]", examples: ["safevault status", "safevault move secret.txt", "safevault retrieve secret.txt"] },
      { command: "honeypot", category: "defense", description: "Manage honeypot decoy system", usage: "honeypot [status|refresh]", examples: ["honeypot status", "honeypot refresh"] },
      { command: "upgrade", category: "defense", description: "Purchase defense upgrades", usage: "upgrade <firewall|vault|ids|honeypot> [level]", examples: ["upgrade firewall 1", "upgrade vault 2", "upgrade ids 3", "upgrade honeypot"] },
    ];
  }
}
