import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext, CommandInfo } from "./interface";
import type { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

const ROLE_HIERARCHY: Record<string, number> = {
  player: 0,
  moderator: 1,
  admin: 2,
};

function roleLevel(role: string): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function pad(str: string, len: number): string {
  return str.length >= len
    ? str.slice(0, len)
    : str + " ".repeat(len - str.length);
}

function boxLine(label: string, value: string, width = 44): string {
  const content = `  ${label}${value}`;
  return `║ ${pad(content, width)} ║`;
}

export class AdminCommandsModule implements CommandModule {
  commands = new Set(["admin"]);

  async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const userRole = context.role;

    if (roleLevel(userRole) < roleLevel("moderator")) {
      return {
        success: false,
        output:
          "ACCESS DENIED: Insufficient privileges.\nThis incident has been logged.",
        timestamp: new Date(),
      };
    }

    const sub = command.args[0]?.toLowerCase();
    if (!sub) {
      return this.showHelp(userRole);
    }

    // Admin-only subcommands
    const ADMIN_ONLY = new Set([
      "ban",
      "unban",
      "setrole",
      "broadcast",
      "cleanup",
      "resetpw",
      "config",
    ]);
    if (ADMIN_ONLY.has(sub) && roleLevel(userRole) < roleLevel("admin")) {
      return {
        success: false,
        output: "ACCESS DENIED: Admin clearance required.",
        timestamp: new Date(),
      };
    }

    switch (sub) {
      case "status":
        return this.handleStatus(context);
      case "players":
        return this.handlePlayers(context);
      case "whois":
        return this.handleWhois(command, context);
      case "audit":
        return this.handleAudit(command, context);
      case "kick":
        return this.handleKick(command, context);
      case "mute":
        return this.handleMute(command, context);
      case "unmute":
        return this.handleUnmute(command, context);
      case "ban":
        return this.handleBan(command, context);
      case "unban":
        return this.handleUnban(command, context);
      case "setrole":
        return this.handleSetRole(command, context);
      case "broadcast":
        return this.handleBroadcast(command, context);
      case "cleanup":
        return this.handleCleanup(context);
      case "servers":
        return this.handleServers(context);
      case "resetpw":
        return this.handleResetPassword(command, context);
      case "help":
        return this.showHelp(userRole);
      default:
        return {
          success: false,
          output: `Unknown admin subcommand: ${sub}\nType 'admin help' for available commands.`,
          timestamp: new Date(),
        };
    }
  }

  // ==================== MODERATOR COMMANDS ====================

  private async handleStatus(context: CommandContext): Promise<CommandResult> {
    const gsm = context.gameStateManager;
    const stats = gsm.getStats();
    const uptime = formatDuration(process.uptime() * 1000);
    const mem = process.memoryUsage();
    const rss = Math.round(mem.rss / 1024 / 1024);
    const heap = Math.round(mem.heapUsed / 1024 / 1024);

    const userCount = await context.db.client.user.count();
    const activeUsers = await context.db.client.user.count({
      where: { isActive: true },
    });

    const w = 44;
    const lines = [
      `╔${"═".repeat(w + 2)}╗`,
      `║ ${pad("AIDA SYSTEM STATUS", w)} ║`,
      `╠${"═".repeat(w + 2)}╣`,
      boxLine("Uptime:           ", uptime, w),
      boxLine("Online Players:   ", `${stats.activePlayers}`, w),
      boxLine("Active Sessions:  ", `${stats.activeConnections}`, w),
      boxLine("Idle Sessions:    ", `${stats.idleSessions}`, w),
      boxLine("Active Servers:   ", `${stats.activeServers}`, w),
      `╠${"═".repeat(w + 2)}╣`,
      boxLine("Total Users:      ", `${userCount}`, w),
      boxLine("Active Accounts:  ", `${activeUsers}`, w),
      boxLine("Memory (RSS):     ", `${rss} MB`, w),
      boxLine("Heap Used:        ", `${heap} MB`, w),
      `╠${"═".repeat(w + 2)}╣`,
      boxLine("Node.js:          ", process.version, w),
      boxLine("Max Sessions:     ", `${stats.maxSessions}`, w),
      `╚${"═".repeat(w + 2)}╝`,
    ];

    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  private async handlePlayers(context: CommandContext): Promise<CommandResult> {
    const gsm = context.gameStateManager;
    const stats = gsm.getStats();
    const now = Date.now();

    if (stats.sessions.length === 0) {
      return {
        success: true,
        output: "No players currently online.",
        timestamp: new Date(),
      };
    }

    // Fetch usernames and roles for all online users
    const userIds = stats.sessions.map((s) => s.userId);
    const users = await context.db.client.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, role: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Fetch levels
    const progress = await context.db.client.playerProgress.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, level: true },
    });
    const levelMap = new Map(progress.map((p) => [p.userId, p.level]));

    const header = `┌${"─".repeat(16)}┬${"─".repeat(7)}┬${"─".repeat(18)}┬${"─".repeat(8)}┬${"─".repeat(10)}┐`;
    const divider = `├${"─".repeat(16)}┼${"─".repeat(7)}┼${"─".repeat(18)}┼${"─".repeat(8)}┼${"─".repeat(10)}┤`;
    const footer = `└${"─".repeat(16)}┴${"─".repeat(7)}┴${"─".repeat(18)}┴${"─".repeat(8)}┴${"─".repeat(10)}┘`;
    const headerRow = `│ ${pad("USERNAME", 14)} │ ${pad("LEVEL", 5)} │ ${pad("SERVER", 16)} │ ${pad("IDLE", 6)} │ ${pad("ROLE", 8)} │`;

    const rows = stats.sessions.map((s) => {
      const user = userMap.get(s.userId);
      const name = user?.username ?? "unknown";
      const role = user?.role ?? "player";
      const level = levelMap.get(s.userId) ?? 1;
      const idle = formatDuration(now - new Date(s.lastActivity).getTime());
      const server = s.currentServerId
        ? s.currentServerId.slice(0, 16)
        : "(home)";
      return `│ ${pad(name, 14)} │ ${pad(String(level), 5)} │ ${pad(server, 16)} │ ${pad(idle, 6)} │ ${pad(role, 8)} │`;
    });

    const lines = [
      header,
      headerRow,
      divider,
      ...rows,
      footer,
      ` ${stats.sessions.length} player(s) online`,
    ];
    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  private async handleWhois(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin whois <username>",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: {
        id: true,
        username: true,
        email: true,
        homeIp: true,
        role: true,
        isActive: true,
        isOnline: true,
        createdAt: true,
        lastLogin: true,
        mutedUntil: true,
      },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: user.id },
      select: {
        level: true,
        experience: true,
        credits: true,
        hacking: true,
        networking: true,
        cryptography: true,
        stealth: true,
        socialEng: true,
        forensics: true,
      },
    });

    const faction = await context.db.client.factionMember.findFirst({
      where: { userId: user.id },
      include: { faction: { select: { name: true } } },
    });

    const w = 44;
    const lines = [
      `╔${"═".repeat(w + 2)}╗`,
      `║ ${pad(`WHOIS: ${user.username}`, w)} ║`,
      `╠${"═".repeat(w + 2)}╣`,
      boxLine("ID:               ", user.id.slice(0, 16) + "...", w),
      boxLine("Email:            ", user.email, w),
      boxLine("Home IP:          ", user.homeIp, w),
      boxLine("Role:             ", user.role, w),
      boxLine("Active:           ", user.isActive ? "YES" : "NO (BANNED)", w),
      boxLine("Online:           ", user.isOnline ? "YES" : "NO", w),
      boxLine(
        "Muted:            ",
        user.mutedUntil && user.mutedUntil > new Date()
          ? `Until ${user.mutedUntil.toISOString().slice(0, 16)}`
          : "No",
        w,
      ),
      boxLine(
        "Created:          ",
        user.createdAt.toISOString().slice(0, 10),
        w,
      ),
      boxLine(
        "Last Login:       ",
        user.lastLogin.toISOString().slice(0, 16),
        w,
      ),
    ];

    if (progress) {
      lines.push(`╠${"═".repeat(w + 2)}╣`);
      lines.push(
        boxLine(
          "Level:            ",
          `${progress.level} (${progress.experience} XP)`,
          w,
        ),
      );
      lines.push(boxLine("Credits:          ", `${progress.credits}`, w));
      lines.push(boxLine("Hacking:          ", `${progress.hacking}`, w));
      lines.push(boxLine("Networking:       ", `${progress.networking}`, w));
      lines.push(boxLine("Cryptography:     ", `${progress.cryptography}`, w));
      lines.push(boxLine("Stealth:          ", `${progress.stealth}`, w));
      lines.push(boxLine("Social Eng:       ", `${progress.socialEng}`, w));
      lines.push(boxLine("Forensics:        ", `${progress.forensics}`, w));
    }

    if (faction) {
      lines.push(`╠${"═".repeat(w + 2)}╣`);
      lines.push(boxLine("Faction:          ", faction.faction.name, w));
      lines.push(boxLine("Rank:             ", faction.rank, w));
    }

    lines.push(`╚${"═".repeat(w + 2)}╝`);

    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  private async handleAudit(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin audit <username> [limit]",
        timestamp: new Date(),
      };
    }

    const limit = Math.min(parseInt(command.args[2] ?? "10") || 10, 50);

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    const logs = await context.db.client.auditLog.findMany({
      where: { userId: user.id },
      orderBy: { timestamp: "desc" },
      take: limit,
      select: {
        action: true,
        resource: true,
        timestamp: true,
        ipAddress: true,
      },
    });

    if (logs.length === 0) {
      return {
        success: true,
        output: `No audit log entries for '${target}'.`,
        timestamp: new Date(),
      };
    }

    const lines = [`Audit log for ${target} (last ${logs.length}):\n`];
    for (const log of logs) {
      const time = log.timestamp.toISOString().slice(0, 16).replace("T", " ");
      lines.push(
        `  [${time}] ${log.action} on ${log.resource}${log.ipAddress ? ` from ${log.ipAddress}` : ""}`,
      );
    }

    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  private async handleKick(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin kick <username> [reason]",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true, role: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    // Can't kick someone of equal or higher role
    if (roleLevel(user.role) >= roleLevel(context.role)) {
      return {
        success: false,
        output: "Cannot kick a user of equal or higher rank.",
        timestamp: new Date(),
      };
    }

    const reason = command.args.slice(2).join(" ") || "Kicked by administrator";

    // Destroy their session
    await context.gameStateManager.destroySession(user.id);

    // Emit force disconnect via socket
    if (context.io) {
      context.io.emit("force:disconnect", { userId: user.id, reason });
    }

    // Audit log
    await this.auditAction(context, "admin_kick", "user", user.id, {
      target,
      reason,
    });

    return {
      success: true,
      output: `Kicked '${target}': ${reason}`,
      timestamp: new Date(),
    };
  }

  private async handleMute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    const minutes = parseInt(command.args[2] ?? "");

    if (!target || !minutes || minutes < 1) {
      return {
        success: false,
        output: "Usage: admin mute <username> <minutes>",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true, role: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    if (roleLevel(user.role) >= roleLevel(context.role)) {
      return {
        success: false,
        output: "Cannot mute a user of equal or higher rank.",
        timestamp: new Date(),
      };
    }

    const mutedUntil = new Date(Date.now() + minutes * 60 * 1000);
    await context.db.client.user.update({
      where: { id: user.id },
      data: { mutedUntil },
    });

    await this.auditAction(context, "admin_mute", "user", user.id, {
      target,
      minutes,
    });

    return {
      success: true,
      output: `Muted '${target}' for ${minutes} minute(s). Expires: ${mutedUntil.toISOString().slice(0, 16)}`,
      timestamp: new Date(),
    };
  }

  private async handleUnmute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin unmute <username>",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    await context.db.client.user.update({
      where: { id: user.id },
      data: { mutedUntil: null },
    });

    await this.auditAction(context, "admin_unmute", "user", user.id, {
      target,
    });

    return {
      success: true,
      output: `Unmuted '${target}'.`,
      timestamp: new Date(),
    };
  }

  // ==================== ADMIN-ONLY COMMANDS ====================

  private async handleBan(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin ban <username> [reason]",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true, role: true, isActive: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    if (roleLevel(user.role) >= roleLevel(context.role)) {
      return {
        success: false,
        output: "Cannot ban a user of equal or higher rank.",
        timestamp: new Date(),
      };
    }

    if (!user.isActive) {
      return {
        success: false,
        output: `'${target}' is already banned.`,
        timestamp: new Date(),
      };
    }

    const reason = command.args.slice(2).join(" ") || "Banned by administrator";

    // Deactivate account
    await context.db.client.user.update({
      where: { id: user.id },
      data: { isActive: false, isOnline: false },
    });

    // Kill session and force disconnect
    await context.gameStateManager.destroySession(user.id);
    if (context.io) {
      context.io.emit("force:disconnect", {
        userId: user.id,
        reason: `Account banned: ${reason}`,
      });
    }

    // Deactivate all sessions
    await context.db.client.userSession.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false },
    });

    await this.auditAction(context, "admin_ban", "user", user.id, {
      target,
      reason,
    });

    return {
      success: true,
      output: `Banned '${target}': ${reason}`,
      timestamp: new Date(),
    };
  }

  private async handleUnban(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin unban <username>",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true, isActive: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    if (user.isActive) {
      return {
        success: false,
        output: `'${target}' is not banned.`,
        timestamp: new Date(),
      };
    }

    await context.db.client.user.update({
      where: { id: user.id },
      data: { isActive: true },
    });

    await this.auditAction(context, "admin_unban", "user", user.id, { target });

    return {
      success: true,
      output: `Unbanned '${target}'. They can now log in again.`,
      timestamp: new Date(),
    };
  }

  private async handleSetRole(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    const newRole = command.args[2]?.toLowerCase();

    if (!target || !newRole) {
      return {
        success: false,
        output: "Usage: admin setrole <username> <player|moderator|admin>",
        timestamp: new Date(),
      };
    }

    if (!["player", "moderator", "admin"].includes(newRole)) {
      return {
        success: false,
        output: "Invalid role. Must be: player, moderator, or admin",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true, role: true, username: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    // Prevent self-demotion
    if (user.id === context.userId) {
      return {
        success: false,
        output: "Cannot change your own role.",
        timestamp: new Date(),
      };
    }

    // Can't modify someone of equal or higher role
    if (roleLevel(user.role) >= roleLevel(context.role)) {
      return {
        success: false,
        output: "Cannot change role of a user with equal or higher rank.",
        timestamp: new Date(),
      };
    }

    // Can't promote above own level
    if (roleLevel(newRole) >= roleLevel(context.role)) {
      return {
        success: false,
        output: "Cannot set a role equal to or above your own.",
        timestamp: new Date(),
      };
    }

    await context.db.client.user.update({
      where: { id: user.id },
      data: { role: newRole },
    });

    await this.auditAction(context, "admin_setrole", "user", user.id, {
      target,
      oldRole: user.role,
      newRole,
    });

    return {
      success: true,
      output: `Changed '${target}' role: ${user.role} → ${newRole}`,
      timestamp: new Date(),
    };
  }

  private async handleBroadcast(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const message = command.args.slice(1).join(" ");
    if (!message) {
      return {
        success: false,
        output: "Usage: admin broadcast <message>",
        timestamp: new Date(),
      };
    }

    if (context.io) {
      context.io.emit("system:broadcast", {
        message,
        from: "SYSTEM",
        timestamp: new Date().toISOString(),
      });
    }

    await this.auditAction(context, "admin_broadcast", "system", null, {
      message,
    });

    return {
      success: true,
      output: `Broadcast sent: ${message}`,
      timestamp: new Date(),
    };
  }

  private async handleCleanup(context: CommandContext): Promise<CommandResult> {
    const count = await context.gameStateManager.cleanupIdleSessions();
    await this.auditAction(context, "admin_cleanup", "system", null, {
      sessionsRemoved: count,
    });
    return {
      success: true,
      output: `Cleaned up ${count} idle session(s).`,
      timestamp: new Date(),
    };
  }

  private async handleServers(context: CommandContext): Promise<CommandResult> {
    const servers = await context.db.client.gameServer.findMany({
      select: {
        id: true,
        name: true,
        ipAddress: true,
        type: true,
        isOnline: true,
        currentConnections: true,
        maxConnections: true,
        resourceType: true,
      },
      orderBy: { name: "asc" },
      take: 50,
    });

    if (servers.length === 0) {
      return {
        success: true,
        output: "No game servers found.",
        timestamp: new Date(),
      };
    }

    const header = `┌${"─".repeat(22)}┬${"─".repeat(17)}┬${"─".repeat(12)}┬${"─".repeat(8)}┬${"─".repeat(10)}┐`;
    const divider = `├${"─".repeat(22)}┼${"─".repeat(17)}┼${"─".repeat(12)}┼${"─".repeat(8)}┼${"─".repeat(10)}┤`;
    const footer = `└${"─".repeat(22)}┴${"─".repeat(17)}┴${"─".repeat(12)}┴${"─".repeat(8)}┴${"─".repeat(10)}┘`;
    const headerRow = `│ ${pad("NAME", 20)} │ ${pad("IP", 15)} │ ${pad("TYPE", 10)} │ ${pad("CONN", 6)} │ ${pad("STATUS", 8)} │`;

    const rows = servers.map((s) => {
      const conn = `${s.currentConnections}/${s.maxConnections}`;
      const status = s.isOnline ? "ONLINE" : "OFFLINE";
      return `│ ${pad(s.name.slice(0, 20), 20)} │ ${pad(s.ipAddress, 15)} │ ${pad(s.type.slice(0, 10), 10)} │ ${pad(conn, 6)} │ ${pad(status, 8)} │`;
    });

    const lines = [
      header,
      headerRow,
      divider,
      ...rows,
      footer,
      ` ${servers.length} server(s)`,
    ];
    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  private async handleResetPassword(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const target = command.args[1];
    if (!target) {
      return {
        success: false,
        output: "Usage: admin resetpw <username>",
        timestamp: new Date(),
      };
    }

    const user = await context.db.client.user.findUnique({
      where: { username: target },
      select: { id: true, role: true },
    });

    if (!user) {
      return {
        success: false,
        output: `User '${target}' not found.`,
        timestamp: new Date(),
      };
    }

    if (roleLevel(user.role) >= roleLevel(context.role)) {
      return {
        success: false,
        output: "Cannot reset password of a user with equal or higher rank.",
        timestamp: new Date(),
      };
    }

    // Generate temp password
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let tempPw = "";
    for (let i = 0; i < 12; i++) {
      tempPw += chars[Math.floor(Math.random() * chars.length)];
    }

    const hashed = await bcrypt.hash(tempPw, 10);
    await context.db.client.user.update({
      where: { id: user.id },
      data: { password: hashed },
    });

    // Invalidate all sessions
    await context.db.client.userSession.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false },
    });

    await this.auditAction(context, "admin_resetpw", "user", user.id, {
      target,
    });

    return {
      success: true,
      output: `Password reset for '${target}'.\nTemporary password: ${tempPw}\nAll sessions invalidated.`,
      timestamp: new Date(),
    };
  }

  // ==================== HELP ====================

  private showHelp(userRole: string): CommandResult {
    const lines = [
      "╔══════════════════════════════════════════════╗",
      "║          ADMIN COMMAND REFERENCE              ║",
      "╠══════════════════════════════════════════════╣",
      "║  MODERATOR COMMANDS                           ║",
      "║  admin status          System dashboard       ║",
      "║  admin players         Online player list     ║",
      "║  admin whois <user>    Player profile         ║",
      "║  admin audit <user>    Audit log entries      ║",
      "║  admin kick <user>     Disconnect player      ║",
      "║  admin mute <user> <m> Mute for m minutes     ║",
      "║  admin unmute <user>   Remove mute            ║",
    ];

    if (roleLevel(userRole) >= roleLevel("admin")) {
      lines.push(
        "╠══════════════════════════════════════════════╣",
        "║  ADMIN COMMANDS                               ║",
        "║  admin ban <user>      Ban user account       ║",
        "║  admin unban <user>    Unban user account     ║",
        "║  admin setrole <u> <r> Set user role          ║",
        "║  admin broadcast <msg> System-wide message    ║",
        "║  admin cleanup         Purge idle sessions    ║",
        "║  admin servers         List game servers      ║",
        "║  admin resetpw <user>  Reset user password    ║",
      );
    }

    lines.push("╚══════════════════════════════════════════════╝");

    return { success: true, output: lines.join("\n"), timestamp: new Date() };
  }

  // ==================== HELPERS ====================

  private async auditAction(
    context: CommandContext,
    action: string,
    resource: string,
    resourceId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await context.db.client.auditLog.create({
        data: {
          userId: context.userId,
          action,
          resource,
          resourceId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Don't fail the command if audit logging fails
    }
  }

  getCommandInfo(): CommandInfo[] {
    return [
      {
        command: "admin",
        category: "Administration",
        description: "Admin and moderator management commands",
        usage: "admin <subcommand> [args...]",
        examples: [
          "admin status",
          "admin whois shadowbyte",
          "admin kick baduser Spamming",
        ],
      },
    ];
  }
}
