import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import {
  boxTop,
  boxBottom,
  boxDivider,
  boxRow,
  boxCenter,
  sBoxTop,
  sBoxBottom,
  sBoxRow,
  panel,
  multiPanel,
  pad,
  padRight,
  progressBar,
  formatDuration,
  render,
} from "./asciiBox";
import { getInlineGlyph } from "../../utils/asciiAvatars";

export class PlayerInfoCommandsModule implements CommandModule {
  public category = "player";
  public commands: Set<string> = new Set([
    "status",
    "skills",
    "players",
    "who",
    "whois",
    "share_intel",
    "bounties",
    "bounty",
    "leaderboard",
    "achievements",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
        case "status":
          return await this.handleStatus(command, context);
        case "skills":
          return await this.handleSkills(command, context);
        case "players":
          return await this.handlePlayers(command, context);
        case "who":
          return await this.handleWho(command, context);
        case "whois":
          return await this.handleWhois(command, context);
        case "share_intel":
          return await this.handleShareIntel(command, context);
        case "bounties":
          return await this.handleBounties(command, context);
        case "bounty":
          return await this.handleBounty(command, context);
        case "leaderboard":
          return await this.handleLeaderboard(command, context);
        case "achievements":
          return await this.handleAchievements(command, context);
        default:
          return {
            success: false,
            output: `Player info command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Player info command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "status",
        category: "player",
        description: "Display player status and progress",
        usage: "status",
        examples: ["status"],
      },
      {
        command: "skills",
        category: "player",
        description: "Show player skills and levels",
        usage: "skills",
        examples: ["skills"],
      },
      {
        command: "players",
        category: "player",
        description: "List all online players",
        usage: "players",
        examples: ["players"],
      },
      {
        command: "who",
        category: "player",
        description: "Show players on current server",
        usage: "who",
        examples: ["who"],
      },
      {
        command: "whois",
        category: "player",
        description: "Get detailed player information",
        usage: "whois <username>",
        examples: ["whois h4x0r", "whois admin"],
      },
      {
        command: "share_intel",
        category: "player",
        description:
          "Share discovered intel with your faction (requires Operative+ rank)",
        usage: "share_intel <server|file|player> <id>",
        examples: [
          "share_intel server srv_abc123",
          "share_intel file file_xyz789",
          "share_intel player user_456",
        ],
      },
      {
        command: "bounties",
        category: "player",
        description: "View active bounties posted by factions",
        usage: "bounties",
        examples: ["bounties"],
      },
      {
        command: "bounty",
        category: "player",
        description: "Claim or complete a bounty",
        usage: "bounty <claim|complete> <bounty_id>",
        examples: ["bounty claim abc123", "bounty complete abc123"],
      },
      {
        command: "leaderboard",
        category: "player",
        description: "View top players by category",
        usage:
          "leaderboard [level|credits|hacking|networking|cryptography|stealth|reputation|achievements|missions]",
        examples: [
          "leaderboard",
          "leaderboard hacking",
          "leaderboard reputation",
        ],
      },
      {
        command: "achievements",
        category: "player",
        description: "View your achievements and progress",
        usage: "achievements",
        examples: ["achievements"],
      },
    ];
  }

  private async handleStatus(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const user = await context.db.client.user.findUnique({
      where: { id: context.userId },
      include: { progress: true },
    });

    if (!user || !user.progress) {
      return {
        success: false,
        output: "User data not found",
        timestamp: new Date(),
      };
    }

    // Build dynamic faction standings
    const standings = await context.services.factionService.getAllStandings(
      context.userId,
    );
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    const factionId = membership?.faction?.id ?? undefined;
    const playerGlyph = getInlineGlyph("player", factionId);

    const factionRows =
      standings.length > 0
        ? standings.map((s) => ({
            label: pad(s.factionName + ":", 20),
            value: `${s.reputation}${s.isAllied ? " (Allied)" : s.isHostile ? " (Hostile)" : ""}`,
          }))
        : [{ label: "", value: "No faction standings yet." }];

    // Query fragment progress via keyFragmentService for the STORY PROGRESS section
    const fragSvc = context.services.keyFragmentService;
    const fragmentProgress = fragSvc
      ? await fragSvc.getPlayerFragments(context.userId)
      : null;

    let storyRows: { label: string; value: string }[];
    if (fragmentProgress) {
      const swordHeld = fragmentProgress.sword.fragments.filter(
        (f: any) => f.isHeldByPlayer,
      ).length;
      const keyHeld = fragmentProgress.key.fragments.filter(
        (f: any) => f.isHeldByPlayer,
      ).length;
      const collarHeld = fragmentProgress.collar.fragments.filter(
        (f: any) => f.isHeldByPlayer,
      ).length;
      storyRows = [
        {
          label: pad("Fragments Held:", 20),
          value: `${fragmentProgress.totalHeld}/9`,
        },
        { label: pad("  Sword:", 20), value: `${swordHeld}/3` },
        { label: pad("  Key:", 20), value: `${keyHeld}/3` },
        { label: pad("  Collar:", 20), value: `${collarHeld}/3` },
        {
          label: pad("Endgame:", 20),
          value: fragmentProgress.gameCompleted
            ? `COMPLETED (${fragmentProgress.endgameChoice})`
            : fragmentProgress.endgameUnlocked
              ? "UNLOCKED"
              : "LOCKED",
        },
      ];
    } else {
      storyRows = [{ label: "", value: "No story progress yet." }];
    }

    const output = render(
      multiPanel(
        `${playerGlyph} PLAYER STATUS`,
        [
          {
            rows: [
              { label: pad("Username:", 20), value: user.username },
              { label: pad("Home IP:", 20), value: user.homeIp },
              { label: pad("Level:", 20), value: `${user.progress.level}` },
              {
                label: pad("Experience:", 20),
                value: `${user.progress.experience}`,
              },
              {
                label: pad("Credits:", 20),
                value: `$${user.progress.credits}`,
              },
              {
                label: pad("Faction:", 20),
                value: membership
                  ? `${membership.faction.name} [${membership.rank.toUpperCase()}]`
                  : "None",
              },
            ],
          },
          {
            heading: "FACTION STANDINGS",
            rows: factionRows,
          },
          {
            heading: "STORY PROGRESS",
            rows: storyRows,
          },
        ],
        44,
      ),
    );

    return {
      success: true,
      output,
      data: { user, progress: user.progress },
      timestamp: new Date(),
    };
  }

  private async handleSkills(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });

    if (!progress) {
      return {
        success: false,
        output: "Player progress not found",
        timestamp: new Date(),
      };
    }

    const output = render(
      panel(
        "PLAYER SKILLS",
        [
          {
            label: pad("Hacking:", 20),
            value: `${progressBar(progress.hacking / 100)} ${padRight(String(progress.hacking), 3)}/100`,
          },
          {
            label: pad("Networking:", 20),
            value: `${progressBar(progress.networking / 100)} ${padRight(String(progress.networking), 3)}/100`,
          },
          {
            label: pad("Cryptography:", 20),
            value: `${progressBar(progress.cryptography / 100)} ${padRight(String(progress.cryptography), 3)}/100`,
          },
          {
            label: pad("Stealth:", 20),
            value: `${progressBar(progress.stealth / 100)} ${padRight(String(progress.stealth), 3)}/100`,
          },
          {
            label: pad("Social Eng:", 20),
            value: `${progressBar(progress.socialEng / 100)} ${padRight(String(progress.socialEng), 3)}/100`,
          },
          {
            label: pad("Forensics:", 20),
            value: `${progressBar(progress.forensics / 100)} ${padRight(String(progress.forensics), 3)}/100`,
          },
        ],
        44,
      ),
    );

    return {
      success: true,
      output,
      data: { skills: progress },
      timestamp: new Date(),
    };
  }

  private async handlePlayers(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const presenceService = context.services.playerPresenceService;
    if (!presenceService) {
      return {
        success: false,
        output: "Presence service unavailable.",
        timestamp: new Date(),
      };
    }

    const players = presenceService.getOnlinePlayers();

    if (players.length === 0) {
      return {
        success: true,
        output: render(
          panel(
            "PLAYERS ONLINE (0)",
            [{ label: "", value: "No players currently online." }],
            48,
          ),
        ),
        data: { players: [], count: 0 },
        timestamp: new Date(),
      };
    }

    const rows = players.map((p: any) => {
      const glyph = getInlineGlyph("player");
      const name = (p.username || "Unknown").padEnd(18);
      const level = `Lv.${String(p.level || "??").padEnd(4)}`;
      return { label: `${glyph} ${name}`, value: `${level}  ON` };
    });

    const output = render(
      panel(`PLAYERS ONLINE (${players.length})`, rows, 48),
    );

    return {
      success: true,
      output,
      data: { players, count: players.length },
      timestamp: new Date(),
    };
  }

  private async handleWho(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Get current server connection
    const connection = await context.db.client.serverConnection.findFirst({
      where: {
        userId: context.userId,
        disconnectedAt: null,
      },
      include: {
        server: true,
      },
      orderBy: {
        connectedAt: "desc",
      },
    });

    if (!connection) {
      return {
        success: false,
        output: "You are not connected to any server.",
        timestamp: new Date(),
      };
    }

    const presenceService = context.services.playerPresenceService;
    if (!presenceService) {
      return {
        success: false,
        output: "Presence service unavailable.",
        timestamp: new Date(),
      };
    }
    const output = presenceService.formatServerOccupancy(connection.serverId);

    return {
      success: true,
      output,
      data: {
        serverId: connection.serverId,
        serverName: connection.server.name,
      },
      timestamp: new Date(),
    };
  }

  private async handleWhois(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const targetUsername = command.args?.[0];

    if (!targetUsername) {
      return {
        success: false,
        output: "Usage: whois <username>",
        timestamp: new Date(),
      };
    }

    const presenceService = context.services.playerPresenceService;
    if (!presenceService) {
      return {
        success: false,
        output: "Presence service unavailable.",
        timestamp: new Date(),
      };
    }

    // Find player by username
    const player = presenceService.findPlayerByUsername(targetUsername);

    if (!player) {
      return {
        success: false,
        output: `Player '${targetUsername}' not found or is offline.`,
        timestamp: new Date(),
      };
    }

    // Get detailed info
    const details = await presenceService.getPlayerDetails(player.userId);

    const playerGlyph = getInlineGlyph("player");

    if (!details) {
      return {
        success: false,
        output: "Failed to retrieve player information.",
        timestamp: new Date(),
      };
    }

    // Format output
    const successRate =
      details.totalHacks > 0
        ? Math.round((details.successfulHacks / details.totalHacks) * 100)
        : 0;

    const sections: Array<{
      heading?: string;
      rows: Array<{ label: string; value: string }>;
    }> = [
      {
        rows: [
          { label: pad("Level:", 20), value: `${details.level}` },
          { label: pad("Reputation:", 20), value: `${details.reputation}` },
          { label: pad("Credits:", 20), value: `${details.credits}` },
          {
            label: pad("Member Since:", 20),
            value: details.joinedAt.toLocaleDateString(),
          },
          {
            label: pad("Location:", 20),
            value: details.currentServerName || "Not connected",
          },
        ],
      },
      {
        heading: "SKILLS",
        rows: [
          { label: pad("Hacking:", 20), value: `${details.skills.hacking}` },
          { label: pad("Stealth:", 20), value: `${details.skills.stealth}` },
          {
            label: pad("Networking:", 20),
            value: `${details.skills.networking}`,
          },
          {
            label: pad("Cryptography:", 20),
            value: `${details.skills.cryptography}`,
          },
          {
            label: pad("Social Eng:", 20),
            value: `${details.skills.socialEng}`,
          },
          {
            label: pad("Forensics:", 20),
            value: `${details.skills.forensics}`,
          },
        ],
      },
      {
        heading: "STATS",
        rows: [
          { label: pad("Total Hacks:", 20), value: `${details.totalHacks}` },
          {
            label: pad("Successful:", 20),
            value: `${details.successfulHacks}`,
          },
          { label: pad("Success Rate:", 20), value: `${successRate}%` },
        ],
      },
    ];

    if (details.achievements.length > 0) {
      sections.push({
        heading: "ACHIEVEMENTS",
        rows: details.achievements.map((ach: string) => ({
          label: "",
          value: `• ${ach}`,
        })),
      });
    }

    const output = render(
      multiPanel(
        `${playerGlyph} PLAYER INFO: ${details.username}`,
        sections,
        44,
      ),
    );

    return {
      success: true,
      output,
      data: details,
      timestamp: new Date(),
    };
  }

  // ==================== SHARE INTEL ====================

  private async handleShareIntel(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const fkService = context.services.factionKnowledgeService;
    if (!fkService) {
      return {
        success: false,
        output: "Intel sharing system unavailable.",
        timestamp: new Date(),
      };
    }

    const assetType = command.args?.[0] as "server" | "file" | "player";
    const assetId = command.args?.[1];

    if (!assetType || !assetId) {
      const W = 52;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("SHARE INTEL", W));
      lines.push(boxDivider(W));
      lines.push(boxRow("Usage: share_intel <type> <id>", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("Types:", W));
      lines.push(boxRow("  server  - Share a discovered server", W));
      lines.push(boxRow("  file    - Share a discovered file", W));
      lines.push(boxRow("  player  - Share info about a player", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("Example: share_intel server srv_abc123", W));
      lines.push(boxBottom(W));
      return { success: true, output: render(lines), timestamp: new Date() };
    }

    if (!["server", "file", "player"].includes(assetType)) {
      return {
        success: false,
        output: `Invalid intel type: ${assetType}. Use: server, file, or player`,
        timestamp: new Date(),
      };
    }

    // Check faction membership
    const factionId = await fkService.getPlayerFactionId(context.userId);
    if (!factionId) {
      return {
        success: false,
        output: "You must be in a faction to share intel.",
        timestamp: new Date(),
      };
    }

    // Check faction rank — must be at least operative
    const member = await context.db.client.factionMember.findFirst({
      where: { userId: context.userId, factionId },
    });
    const allowedRanks = ["operative", "elite", "council_member"];
    if (!member || !allowedRanks.includes(member.rank)) {
      const currentRank = member?.rank?.toUpperCase() ?? "UNKNOWN";
      return {
        success: false,
        output: `Insufficient faction rank. You must be at least OPERATIVE rank to share intel. Current rank: ${currentRank}`,
        timestamp: new Date(),
      };
    }

    // Verify the asset exists
    let assetMeta: Record<string, unknown> = {};
    if (assetType === "server") {
      const server = await context.db.client.gameServer.findUnique({
        where: { id: assetId },
        select: {
          id: true,
          name: true,
          ipAddress: true,
          type: true,
          securityLevel: true,
          ownerId: true,
        },
      });
      if (!server) {
        return {
          success: false,
          output: `Server not found: ${assetId}`,
          timestamp: new Date(),
        };
      }
      assetMeta = {
        name: server.name,
        ip: server.ipAddress,
        serverType: server.type,
        securityLevel: server.securityLevel,
        ownerId: server.ownerId,
      };
    } else if (assetType === "file") {
      const file = await context.db.client.fileSystemNode.findUnique({
        where: { id: assetId },
        select: {
          id: true,
          name: true,
          serverId: true,
          type: true,
          isHidden: true,
          isEncrypted: true,
        },
      });
      if (!file) {
        return {
          success: false,
          output: `File not found: ${assetId}`,
          timestamp: new Date(),
        };
      }
      assetMeta = {
        name: file.name,
        serverId: file.serverId,
        isHidden: file.isHidden,
        isEncrypted: file.isEncrypted,
      };
    } else if (assetType === "player") {
      const player = await context.db.client.user.findUnique({
        where: { id: assetId },
        select: { id: true, username: true },
      });
      if (!player) {
        return {
          success: false,
          output: `Player not found: ${assetId}`,
          timestamp: new Date(),
        };
      }
      assetMeta = { username: player.username };
    }

    await fkService.addEntry(factionId, {
      assetType,
      assetId,
      assetMeta,
      source: "player_report",
      confidence: 0.9,
      discoveredBy: context.userId,
    });

    const W = 52;
    const lines: string[] = [];
    lines.push(sBoxTop(W));
    lines.push(sBoxRow(" [+] Intel shared with your faction", W));
    lines.push(sBoxRow(`     Type: ${assetType}`, W));
    lines.push(sBoxRow(`     ID:   ${assetId.substring(0, 20)}...`, W));
    lines.push(sBoxRow("     Confidence: HIGH (player report)", W));
    lines.push(sBoxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== BOUNTIES ====================

  private async handleBounties(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    // Show active bounties — all public, plus highlight ones from player's faction
    const bounties = await context.db.client.bounty.findMany({
      where: {
        status: "active",
        expiresAt: { gt: new Date() },
      },
      orderBy: { rewardCredits: "desc" },
      take: 20,
    });

    if (bounties.length === 0) {
      return {
        success: true,
        output: "No active bounties. The network is quiet... for now.",
        timestamp: new Date(),
      };
    }

    // Get player's faction for highlighting
    const membership = await context.db.client.factionMember.findFirst({
      where: { userId: context.userId },
      select: { factionId: true },
    });

    // Get faction names
    const factionIds = [...new Set(bounties.map((b) => b.issuedByFactionId))];
    const factions = await context.db.client.faction.findMany({
      where: { id: { in: factionIds } },
      select: { id: true, name: true, shortName: true },
    });
    const factionMap = new Map(
      factions.map((f) => [f.id, f.shortName || f.name]),
    );

    const W = 58;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("ACTIVE BOUNTIES", W));
    lines.push(boxDivider(W));

    for (const b of bounties) {
      const fName = factionMap.get(b.issuedByFactionId) || "unknown";
      const remaining = b.expiresAt.getTime() - Date.now();
      const isMine = membership?.factionId === b.issuedByFactionId;
      const tag = isMine ? " [YOUR FACTION]" : "";
      const claimed = b.claimedByUserId ? " [CLAIMED]" : "";

      lines.push(boxRow(` TARGET: ${b.targetUsername}${tag}${claimed}`, W));
      lines.push(
        boxRow(`   ID: ${b.id.substring(0, 16)}  Faction: ${fName}`, W),
      );
      lines.push(
        boxRow(`   Reward: ${b.rewardCredits}c + ${b.rewardReputation} rep`, W),
      );
      lines.push(boxRow(`   Expires: ${formatDuration(remaining)}`, W));
      lines.push(boxRow(`   Reason: ${b.reason.substring(0, W - 12)}`, W));
      lines.push(boxRow("", W));
    }

    lines.push(boxDivider(W));
    lines.push(boxRow("  'bounty claim <id>' to accept a bounty", W));
    lines.push(boxRow("  Hack the target's home server to complete", W));
    lines.push(boxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleBounty(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const action = command.args?.[0];
    const bountyId = command.args?.[1];

    if (!action || !bountyId) {
      return {
        success: false,
        output:
          "Usage: bounty <claim|complete> <bounty_id>\n'bounties' to see active bounties.",
        timestamp: new Date(),
      };
    }

    const bounty = await context.db.client.bounty.findUnique({
      where: { id: bountyId },
    });

    if (!bounty) {
      return {
        success: false,
        output: `Bounty not found: ${bountyId}`,
        timestamp: new Date(),
      };
    }

    if (action === "claim") {
      // Claim a bounty — assign it to this player
      if (bounty.status !== "active") {
        return {
          success: false,
          output: `Bounty is ${bounty.status}, cannot claim.`,
          timestamp: new Date(),
        };
      }
      if (bounty.claimedByUserId) {
        return {
          success: false,
          output: "Bounty already claimed by another player.",
          timestamp: new Date(),
        };
      }
      if (bounty.targetUserId === context.userId) {
        return {
          success: false,
          output: "You can't claim a bounty on yourself.",
          timestamp: new Date(),
        };
      }

      await context.db.client.bounty.update({
        where: { id: bountyId },
        data: { claimedByUserId: context.userId, status: "claimed" },
      });

      // Get target's home IP for the player
      const target = await context.db.client.user.findUnique({
        where: { id: bounty.targetUserId },
        select: { homeIp: true, username: true },
      });

      const W = 52;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("BOUNTY CLAIMED", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(` Target: ${bounty.targetUsername}`, W));
      lines.push(
        boxRow(
          ` Reward: ${bounty.rewardCredits}c + ${bounty.rewardReputation} rep`,
          W,
        ),
      );
      lines.push(boxDivider(W));
      lines.push(boxRow(" OBJECTIVE:", W));
      lines.push(boxRow(` Hack ${bounty.targetUsername}'s home server`, W));
      if (target?.homeIp) {
        lines.push(boxRow(` Home IP: ${target.homeIp}`, W));
      }
      lines.push(boxRow(" Read /home/*/proof.log to verify access", W));
      lines.push(
        boxRow(" Then run: bounty complete " + bountyId.substring(0, 16), W),
      );
      lines.push(boxBottom(W));

      return { success: true, output: render(lines), timestamp: new Date() };
    }

    if (action === "complete") {
      // Complete a bounty — verify the player has hacked the target's home
      if (bounty.status !== "claimed") {
        return {
          success: false,
          output: "Bounty must be claimed first. Use 'bounty claim <id>'.",
          timestamp: new Date(),
        };
      }
      if (bounty.claimedByUserId !== context.userId) {
        return {
          success: false,
          output: "This bounty was claimed by someone else.",
          timestamp: new Date(),
        };
      }

      // Verify: player must have a ServerConnection with accessLevel > 0 on target's home server
      const targetUser = await context.db.client.user.findUnique({
        where: { id: bounty.targetUserId },
        select: { homeServerId: true, homeIp: true },
      });

      if (!targetUser?.homeServerId) {
        return {
          success: false,
          output: "Target has no home server.",
          timestamp: new Date(),
        };
      }

      const hasAccess = await context.db.client.serverConnection.findFirst({
        where: {
          userId: context.userId,
          serverId: targetUser.homeServerId,
          accessLevel: { gt: 0 },
        },
      });

      if (!hasAccess) {
        return {
          success: false,
          output: `You haven't hacked ${bounty.targetUsername}'s home server yet. Hack ${targetUser.homeIp} first.`,
          timestamp: new Date(),
        };
      }

      // ── Delete stolen files from target's home server ──
      let filesDeleted = 0;
      let keysRevoked = 0;
      let decoysHit = 0;
      const stolenFileIds = (bounty as any).stolenFileIds as string[] | null;

      if (
        stolenFileIds &&
        stolenFileIds.length > 0 &&
        targetUser.homeServerId
      ) {
        // Find the stolen files and their content (for key revocation)
        const stolenFiles = await context.db.client.fileSystemNode.findMany({
          where: {
            id: { in: stolenFileIds },
            serverId: targetUser.homeServerId,
          },
          select: { id: true, name: true, content: true, metadata: true },
        });

        for (const file of stolenFiles) {
          const meta = file.metadata as any;

          // Track honeypot decoy hits
          if (meta?.isDecoy === true) {
            decoysHit++;
            await context.db.client.fileSystemNode
              .delete({ where: { id: file.id } })
              .catch(() => {});
            filesDeleted++;
            continue; // Decoy files have no access keys to revoke
          }

          // Revoke access keys that came from this file's content
          if (meta?.sourceServerId) {
            const revoked = await context.db.client.serverAccessKey.deleteMany({
              where: {
                userId: bounty.targetUserId,
                sourceFileId: file.id,
              },
            });
            keysRevoked += revoked.count;
          }

          // Delete the stolen file
          await context.db.client.fileSystemNode
            .delete({ where: { id: file.id } })
            .catch(() => {});
          filesDeleted++;
        }
      }

      // Complete the bounty — grant rewards
      await context.db.client.bounty.update({
        where: { id: bountyId },
        data: { status: "completed", completedAt: new Date() },
      });

      // Grant credits
      await context.db.client.playerProgress.update({
        where: { userId: context.userId },
        data: { credits: { increment: bounty.rewardCredits } },
      });

      // Grant reputation with issuing faction
      try {
        await context.services.factionService.addReputation(
          context.userId,
          bounty.issuedByFactionId,
          bounty.rewardReputation,
        );
      } catch {
        // Rep grant failure non-fatal
      }

      // Notify the target that their files were deleted
      if (context.io && filesDeleted > 0) {
        context.io.to(`player:${bounty.targetUserId}`).emit("command:result", {
          success: false,
          output: `⚠ SECURITY BREACH: ${filesDeleted} file(s) deleted from your home server by a bounty hunter.${keysRevoked > 0 ? ` ${keysRevoked} access key(s) revoked.` : ""}`,
          timestamp: new Date(),
        });
      }

      const W = 52;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("BOUNTY COMPLETED", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(` Target: ${bounty.targetUsername}`, W));
      lines.push(boxDivider(W));
      if (filesDeleted > 0) {
        lines.push(boxRow(` Stolen files purged: ${filesDeleted}`, W));
      }
      if (decoysHit > 0) {
        lines.push(boxRow(` Honeypot decoys found: ${decoysHit}`, W));
      }
      if (keysRevoked > 0) {
        lines.push(boxRow(` Access keys revoked: ${keysRevoked}`, W));
      }
      lines.push(boxDivider(W));
      lines.push(boxRow(` + ${bounty.rewardCredits} credits`, W));
      lines.push(boxRow(` + ${bounty.rewardReputation} faction reputation`, W));
      if (decoysHit > 0 && decoysHit === filesDeleted) {
        lines.push(boxDivider(W));
        lines.push(boxRow(" Target used honeypot. All files were decoys.", W));
        lines.push(boxRow(" No real intel was destroyed.", W));
      }
      lines.push(boxDivider(W));
      lines.push(boxRow(" Well done, hunter.", W));
      lines.push(boxBottom(W));

      // Fire mission integration hook
      if (context.services.missionIntegrationService) {
        context.services.missionIntegrationService
          .onBountyCompleted(context.userId, bounty.issuedByFactionId)
          .catch(() => {});
      }

      return { success: true, output: render(lines), timestamp: new Date() };
    }

    return {
      success: false,
      output: "Usage: bounty <claim|complete> <bounty_id>",
      timestamp: new Date(),
    };
  }

  // ==================== LEADERBOARD ====================

  private async handleLeaderboard(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const service = context.services.leaderboardService;
    if (!service) {
      return {
        success: false,
        output: "Leaderboard service unavailable.",
        timestamp: new Date(),
      };
    }

    const category = (command.args[0]?.toLowerCase() || "level") as any;
    const validCategories = [
      "level",
      "credits",
      "hacking",
      "networking",
      "cryptography",
      "stealth",
      "reputation",
      "achievements",
      "missions",
    ];
    if (!validCategories.includes(category)) {
      return {
        success: true,
        output: `Usage: leaderboard [${validCategories.join("|")}]\n\nCategories:\n  level        - Highest level players\n  credits      - Wealthiest players\n  hacking      - Top hackers\n  networking   - Network specialists\n  cryptography - Cipher masters\n  stealth      - Ghost operatives\n  reputation   - Faction heroes\n  achievements - Most achievements\n  missions     - Most missions completed`,
        timestamp: new Date(),
      };
    }

    const W = 60;
    const entries = await service.getLeaderboard(category, 15);
    const lines: string[] = [];

    lines.push(boxTop(W));
    lines.push(boxRow(` LEADERBOARD: ${category.toUpperCase()}`, W));
    lines.push(boxRow("", W));

    if (entries.length === 0) {
      lines.push(boxRow("  No entries yet.", W));
    } else {
      lines.push(
        boxRow(
          ` ${"#".padEnd(4)}${"PLAYER".padEnd(22)}${"SCORE".padStart(10)}${"".padStart(10)}`,
          W,
        ),
      );
      lines.push(boxRow(` ${"─".repeat(W - 4)}`, W));

      for (const e of entries) {
        const medal =
          e.rank === 1
            ? "[1st]"
            : e.rank === 2
              ? "[2nd]"
              : e.rank === 3
                ? "[3rd]"
                : `#${e.rank}`;
        const detail = e.detail ? ` (${e.detail})` : "";
        const isMe = e.userId === context.userId;
        const marker = isMe ? " <-YOU" : "";
        lines.push(
          boxRow(
            ` ${medal.padEnd(6)}${e.username.padEnd(20)}${String(e.value).padStart(10)}${detail}${marker}`,
            W,
          ),
        );
      }
    }

    // Show player's own rank if not in top
    const myRank = await service.getPlayerRank(context.userId, category);
    const inTop = entries.some((e) => e.userId === context.userId);
    if (myRank && !inTop) {
      lines.push(boxRow(` ${"─".repeat(W - 4)}`, W));
      lines.push(boxRow(` Your rank: #${myRank}`, W));
    }

    lines.push(boxBottom(W));
    return { success: true, output: render(lines), timestamp: new Date() };
  }

  // ==================== ACHIEVEMENTS ====================

  private async handleAchievements(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const service = context.services.achievementService;
    if (!service) {
      return {
        success: false,
        output: "Achievement service unavailable.",
        timestamp: new Date(),
      };
    }

    // Check for new achievements first
    const newlyAwarded = await service.checkAndAward(context.userId);

    const all = await service.getPlayerAchievements(context.userId);
    const unlocked = all.filter((a) => a.unlocked);
    const locked = all.filter((a) => !a.unlocked);

    const W = 65;
    const lines: string[] = [];

    lines.push(boxTop(W));
    lines.push(boxRow(` ACHIEVEMENTS  [${unlocked.length}/${all.length}]`, W));

    if (newlyAwarded.length > 0) {
      lines.push(boxRow("", W));
      for (const id of newlyAwarded) {
        const def = all.find((a) => a.def.id === id);
        if (def) {
          lines.push(
            boxRow(` *** NEW: ${def.def.name} — ${def.def.description} ***`, W),
          );
        }
      }
    }

    lines.push(boxRow("", W));
    lines.push(boxRow(` UNLOCKED:`, W));
    lines.push(boxRow(` ${"─".repeat(W - 4)}`, W));
    if (unlocked.length === 0) {
      lines.push(boxRow("  None yet. Keep playing!", W));
    } else {
      for (const a of unlocked) {
        lines.push(
          boxRow(` [+] ${a.def.name.padEnd(24)} ${a.def.description}`, W),
        );
      }
    }

    lines.push(boxRow("", W));
    lines.push(boxRow(` LOCKED:`, W));
    lines.push(boxRow(` ${"─".repeat(W - 4)}`, W));
    const shownLocked = locked.slice(0, 10);
    for (const a of shownLocked) {
      lines.push(
        boxRow(` [ ] ${a.def.name.padEnd(24)} ${a.def.description}`, W),
      );
    }
    if (locked.length > 10) {
      lines.push(boxRow(`     ...and ${locked.length - 10} more`, W));
    }

    lines.push(boxBottom(W));
    return { success: true, output: render(lines), timestamp: new Date() };
  }
}
