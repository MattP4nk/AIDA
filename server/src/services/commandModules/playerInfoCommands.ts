import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { successResult, errorResult } from "./helpers";
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
    "report",
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
        case "report":
          return await this.handleReport(command, context);
        default:
          return errorResult(`Player info command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("Player info command failed", error instanceof Error ? error.message : "Unknown error");
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
      {
        command: "report",
        category: "player",
        description: "Submit intel to a faction (server, file, or mission findings)",
        usage: "report [server|file <name>|mission] [to <faction>]",
        examples: [
          "report",
          "report server",
          "report server to The Garrison",
          "report file secrets.txt",
          "report file config.dat to dotHackers",
          "report mission",
        ],
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
      return errorResult("User data not found");
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

    // Query story/fragment progress — HIDDEN until player reaches discoveryLevel >= 3
    // Players must discover the existence of fragments through gameplay, not the status screen
    const storyProgress = await context.db.client.storyProgress.findUnique({
      where: { userId: context.userId },
      select: { discoveryLevel: true },
    });
    const discoveryLevel = storyProgress?.discoveryLevel ?? 0;

    let storyRows: { label: string; value: string }[];
    if (discoveryLevel >= 3) {
      // Player has discovered AIDA fragments — show full progress
      const fragSvc = context.services.keyFragmentService;
      const fragmentProgress = fragSvc
        ? await fragSvc.getPlayerFragments(context.userId)
        : null;

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
          { label: pad("Discovery:", 20), value: `Level ${discoveryLevel}` },
          { label: pad("Fragments Held:", 20), value: `${fragmentProgress.totalHeld}/9` },
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
        storyRows = [{ label: pad("Discovery:", 20), value: `Level ${discoveryLevel}` }];
      }
    } else if (discoveryLevel >= 1) {
      // Player has some awareness — show vague hints only
      storyRows = [
        { label: pad("Discovery:", 20), value: `Level ${discoveryLevel}` },
        { label: "", value: "Whispers of something ancient echo in the net..." },
      ];
    } else {
      // No discovery yet — generic message
      storyRows = [
        { label: "", value: "Explore the network. The truth is out there." },
      ];
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
      return errorResult("Player progress not found");
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
      return errorResult("Presence service unavailable.");
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
      panel(`PLAYERS ONLINE (${players.length})`, rows, context.terminalWidth),
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
      return errorResult("You are not connected to any server.");
    }

    const presenceService = context.services.playerPresenceService;
    if (!presenceService) {
      return errorResult("Presence service unavailable.");
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
      return errorResult("Usage: whois <username>");
    }

    const presenceService = context.services.playerPresenceService;
    if (!presenceService) {
      return errorResult("Presence service unavailable.");
    }

    // Find player by username
    const player = presenceService.findPlayerByUsername(targetUsername);

    if (!player) {
      return errorResult(`Player '${targetUsername}' not found or is offline.`);
    }

    // Get detailed info
    const details = await presenceService.getPlayerDetails(player.userId);

    const playerGlyph = getInlineGlyph("player");

    if (!details) {
      return errorResult("Failed to retrieve player information.");
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
      return errorResult("Intel sharing system unavailable.");
    }

    const assetType = command.args?.[0] as "server" | "file" | "player";
    const assetId = command.args?.[1];

    if (!assetType || !assetId) {
      const W = context.terminalWidth;
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
      return successResult(render(lines));
    }

    if (!["server", "file", "player"].includes(assetType)) {
      return errorResult(`Invalid intel type: ${assetType}. Use: server, file, or player`);
    }

    // Check faction membership
    const factionId = await fkService.getPlayerFactionId(context.userId);
    if (!factionId) {
      return errorResult("You must be in a faction to share intel.");
    }

    // Check faction rank — must be at least operative
    const member = await context.db.client.factionMember.findFirst({
      where: { userId: context.userId, factionId },
    });
    const allowedRanks = ["operative", "elite", "council_member"];
    if (!member || !allowedRanks.includes(member.rank)) {
      const currentRank = member?.rank?.toUpperCase() ?? "UNKNOWN";
      return errorResult(`Insufficient faction rank. You must be at least OPERATIVE rank to share intel. Current rank: ${currentRank}`);
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
        return errorResult(`Server not found: ${assetId}`);
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
        return errorResult(`File not found: ${assetId}`);
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
        return errorResult(`Player not found: ${assetId}`);
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

    const W = context.terminalWidth;
    const lines: string[] = [];
    lines.push(sBoxTop(W));
    lines.push(sBoxRow(" [+] Intel shared with your faction", W));
    lines.push(sBoxRow(`     Type: ${assetType}`, W));
    lines.push(sBoxRow(`     ID:   ${assetId.substring(0, 20)}...`, W));
    lines.push(sBoxRow("     Confidence: HIGH (player report)", W));
    lines.push(sBoxBottom(W));

    return successResult(render(lines));
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
      return successResult("No active bounties. The network is quiet... for now.");
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

    return successResult(render(lines));
  }

  private async handleBounty(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const action = command.args?.[0];
    const bountyId = command.args?.[1];

    if (!action || !bountyId) {
      return errorResult("Usage: bounty <claim|complete> <bounty_id>\n'bounties' to see active bounties.");
    }

    const bounty = await context.db.client.bounty.findUnique({
      where: { id: bountyId },
    });

    if (!bounty) {
      return errorResult(`Bounty not found: ${bountyId}`);
    }

    if (action === "claim") {
      // Claim a bounty — assign it to this player
      if (bounty.status !== "active") {
        return errorResult(`Bounty is ${bounty.status}, cannot claim.`);
      }
      if (bounty.claimedByUserId) {
        return errorResult("Bounty already claimed by another player.");
      }
      if (bounty.targetUserId === context.userId) {
        return errorResult("You can't claim a bounty on yourself.");
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

      const W = context.terminalWidth;
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

      return successResult(render(lines));
    }

    if (action === "complete") {
      // Complete a bounty — verify the player has hacked the target's home
      if (bounty.status !== "claimed") {
        return errorResult("Bounty must be claimed first. Use 'bounty claim <id>'.");
      }
      if (bounty.claimedByUserId !== context.userId) {
        return errorResult("This bounty was claimed by someone else.");
      }

      // Verify: player must have a ServerConnection with accessLevel > 0 on target's home server
      const targetUser = await context.db.client.user.findUnique({
        where: { id: bounty.targetUserId },
        select: { homeServerId: true, homeIp: true },
      });

      if (!targetUser?.homeServerId) {
        return errorResult("Target has no home server.");
      }

      const hasAccess = await context.db.client.serverConnection.findFirst({
        where: {
          userId: context.userId,
          serverId: targetUser.homeServerId,
          accessLevel: { gt: 0 },
        },
      });

      if (!hasAccess) {
        return errorResult(`You haven't hacked ${bounty.targetUsername}'s home server yet. Hack ${targetUser.homeIp} first.`);
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

      const W = context.terminalWidth;
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

      return successResult(render(lines));
    }

    return errorResult("Usage: bounty <claim|complete> <bounty_id>");
  }

  // ==================== LEADERBOARD ====================

  private async handleLeaderboard(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const service = context.services.leaderboardService;
    if (!service) {
      return errorResult("Leaderboard service unavailable.");
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
      return successResult(`Usage: leaderboard [${validCategories.join("|")}]\n\nCategories:\n  level        - Highest level players\n  credits      - Wealthiest players\n  hacking      - Top hackers\n  networking   - Network specialists\n  cryptography - Cipher masters\n  stealth      - Ghost operatives\n  reputation   - Faction heroes\n  achievements - Most achievements\n  missions     - Most missions completed`);
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
    return successResult(render(lines));
  }

  // ==================== ACHIEVEMENTS ====================

  private async handleAchievements(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const service = context.services.achievementService;
    if (!service) {
      return errorResult("Achievement service unavailable.");
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
    return successResult(render(lines));
  }

  // ==================== REPORT COMMAND ====================

  /**
   * Report intel to faction, complete recon objectives, or submit findings.
   *
   * Usage:
   *   report                    — Show current server intel summary
   *   report server             — Report current server to faction knowledge
   *   report file <filename>    — Report a specific file as intel
   *   report mission            — Report findings for active mission objectives
   */
  /**
   * Parse `to <faction>` from args. Returns remaining args + target faction info.
   */
  private async resolveReportTarget(
    args: string[],
    userId: string,
    db: any,
  ): Promise<{ targetFactionId: string; targetFactionName: string; cleanArgs: string[] } | { error: string }> {
    // Check for "to <faction>" at the end of args
    const toIdx = args.findIndex((a) => a.toLowerCase() === "to");
    let cleanArgs = [...args];
    let targetFactionName: string | null = null;

    if (toIdx >= 0 && toIdx < args.length - 1) {
      targetFactionName = args.slice(toIdx + 1).join(" ");
      cleanArgs = args.slice(0, toIdx);
    }

    if (targetFactionName) {
      // Explicit target faction
      const faction = await db.client.faction.findFirst({
        where: { name: { equals: targetFactionName, mode: "insensitive" } },
        select: { id: true, name: true },
      });
      if (!faction) {
        return { error: `Faction not found: "${targetFactionName}". Use 'faction list' to see factions.` };
      }
      return { targetFactionId: faction.id, targetFactionName: faction.name, cleanArgs };
    }

    // Default to player's own faction
    const membership = await db.client.factionMember.findFirst({
      where: { userId },
      include: { faction: { select: { id: true, name: true } } },
    });

    if (!membership) {
      return { error: "No faction specified. Use: report ... to <faction>\nOr join a faction with 'faction join <name>'." };
    }

    return { targetFactionId: membership.factionId, targetFactionName: membership.faction.name, cleanArgs };
  }

  private async handleReport(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const { userId, db } = context;
    const subCommand = command.args?.[0]?.toLowerCase();
    const session = context.gameStateManager?.getSession(userId);
    const serverId = session?.currentServerId || session?.homeServerId;

    if (!serverId) {
      return errorResult("No active server connection.");
    }

    const W = context.terminalWidth;

    // ── report (no args) — show current server intel summary ──
    if (!subCommand) {
      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
        select: { name: true, ipAddress: true, role: true, securityLevel: true, factionId: true, faction: { select: { name: true } } },
      });

      if (!server) {
        return errorResult("Server not found.");
      }

      const fileCount = await db.client.fileSystemNode.count({
        where: { serverId, type: "file" },
      });
      const dirCount = await db.client.fileSystemNode.count({
        where: { serverId, type: "directory" },
      });

      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("INTEL REPORT", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(`  Server: ${server.name}`, W));
      lines.push(boxRow(`  IP: ${server.ipAddress}`, W));
      lines.push(boxRow(`  Role: ${server.role}`, W));
      lines.push(boxRow(`  Security: Level ${server.securityLevel}`, W));
      lines.push(boxRow(`  Files: ${fileCount} | Dirs: ${dirCount}`, W));
      lines.push(boxRow(`  Faction: ${(server as any).faction?.name || "Unaffiliated"}`, W));
      lines.push(boxDivider(W));
      lines.push(boxRow("  Commands:", W));
      lines.push(boxRow("    report server [to <faction>]", W));
      lines.push(boxRow("    report file <name> [to <faction>]", W));
      lines.push(boxRow("    report mission", W));
      lines.push(boxBottom(W));

      return successResult(render(lines));
    }

    // ── report server [to <faction>] — add current server to faction knowledge ──
    if (subCommand === "server") {
      const targetResult = await this.resolveReportTarget(command.args?.slice(1) || [], userId, db);
      if ("error" in targetResult) {
        return errorResult(targetResult.error);
      }

      const server = await db.client.gameServer.findUnique({
        where: { id: serverId },
        select: { id: true, name: true, ipAddress: true, role: true, type: true, securityLevel: true },
      });

      if (!server) {
        return errorResult("Server not found.");
      }

      // Add to faction knowledge
      const fkService = context.services.factionKnowledgeService;
      if (fkService) {
        await fkService.addEntry(targetResult.targetFactionId, {
          assetType: "server",
          assetId: server.id,
          assetMeta: {
            name: server.name,
            ip: server.ipAddress,
            serverType: server.type,
            role: server.role,
            securityLevel: server.securityLevel,
          },
          source: "player_report",
          confidence: 1.0,
          discoveredBy: userId,
        });
      }

      // Trigger mission integration
      const missionIntegration = context.services.missionIntegrationService;
      if (missionIntegration) {
        try {
          await (missionIntegration as any).onServerConnect(userId, server.id);
          await (missionIntegration as any).onReportSubmitted(userId, "server");
        } catch { /* non-critical */ }
      }

      return {
        success: true,
        output: `Intel submitted to ${targetResult.targetFactionName}: Server "${server.name}" (${server.ipAddress}) reported.`,
        soundEvent: "success" as const,
        timestamp: new Date(),
      };
    }

    // ── report file <filename> [to <faction>] — report a specific file as intel ──
    if (subCommand === "file") {
      const restArgs = command.args?.slice(1) || [];
      const targetResult = await this.resolveReportTarget(restArgs, userId, db);
      if ("error" in targetResult) {
        return errorResult(targetResult.error);
      }

      const filename = targetResult.cleanArgs.join(" ");
      if (!filename) {
        return errorResult("Usage: report file <filename> [to <faction>]");
      }

      const currentDir = session?.currentDirectory || "/";
      const { resolvePath } = await import("./helpers");
      const filePath = resolvePath(filename, currentDir);
      const pathParts = filePath.split("/").filter(Boolean);
      const targetName = pathParts.pop() || filename;

      // Walk the directory tree for accurate lookup (handles duplicate names)
      let parentId: string | null = null;
      if (pathParts.length > 0) {
        let current = await db.client.fileSystemNode.findFirst({
          where: { serverId, parentId: null, type: "directory" },
          select: { id: true },
        });
        for (const part of pathParts) {
          if (!current) break;
          current = await db.client.fileSystemNode.findFirst({
            where: { serverId, parentId: current.id, name: part },
            select: { id: true },
          });
        }
        parentId = current?.id || null;
      }

      const file = await db.client.fileSystemNode.findFirst({
        where: { serverId, name: targetName, type: "file", ...(parentId ? { parentId } : {}) },
        select: { id: true, name: true, content: true, isEncrypted: true },
      });

      if (!file) {
        return errorResult(`File not found: ${filename}`);
      }

      // Add file to faction knowledge
      const fkService = context.services.factionKnowledgeService;
      if (fkService) {
        await fkService.addEntry(targetResult.targetFactionId, {
          assetType: "file",
          assetId: file.id,
          assetMeta: {
            name: file.name,
            fileName: file.name,
            serverId,
            isEncrypted: file.isEncrypted,
            contentPreview: file.content?.substring(0, 100) || "",
          },
          source: "player_report",
          confidence: 1.0,
          discoveredBy: userId,
        });
      }

      // Trigger mission integration
      const missionIntegration = context.services.missionIntegrationService;
      if (missionIntegration) {
        try {
          await (missionIntegration as any).onFileOperation(userId, "read", file.id, serverId);
          await (missionIntegration as any).onReportSubmitted(userId, "file");
        } catch { /* non-critical */ }
      }

      return {
        success: true,
        output: `Intel submitted to ${targetResult.targetFactionName}: File "${file.name}" reported${file.isEncrypted ? " (encrypted)" : ""}.`,
        soundEvent: "success" as const,
        timestamp: new Date(),
      };
    }

    // ── report mission — check active missions and submit relevant intel ──
    if (subCommand === "mission") {
      const missionService = context.services.missionService;
      if (!missionService) {
        return errorResult("Mission system unavailable.");
      }

      const missions = await missionService.getPlayerMissions(userId);
      const active = missions.filter((m: any) => m.status === "active");

      if (active.length === 0) {
        return errorResult("No active missions. Accept a mission first with 'missions' → 'accept <id>'.");
      }

      // Trigger mission checks for current server context
      const missionIntegration = context.services.missionIntegrationService;
      if (missionIntegration) {
        try {
          await (missionIntegration as any).onServerConnect(userId, serverId);
          await (missionIntegration as any).onReportSubmitted(userId, "mission");
        } catch { /* non-critical */ }
      }

      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("MISSION REPORT SUBMITTED", W));
      lines.push(boxDivider(W));
      for (const m of active.slice(0, 5)) {
        const objectives = ((m as any).objectives as any[] || []);
        const completed = objectives.filter((o: any) => o.completed).length;
        lines.push(boxRow(`  ${(m as any).title || "Mission"}`, W));
        lines.push(boxRow(`    Objectives: ${completed}/${objectives.length}`, W));
      }
      lines.push(boxDivider(W));
      lines.push(boxRow("  Findings from current server submitted.", W));
      lines.push(boxRow("  Check 'progress' for objective status.", W));
      lines.push(boxBottom(W));

      return {
        success: true,
        output: render(lines),
        soundEvent: "success" as const,
        suggestedCommand: "progress",
        timestamp: new Date(),
      };
    }

    return errorResult("Usage: report [server|file <name>|mission] [to <faction>]");
  }
}
