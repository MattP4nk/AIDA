import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import {
  helpPanel,
  table,
  panel,
  render,
  progressBar,
  repBar,
  Column,
  HelpEntry,
} from "./asciiBox";

export class FactionCommandsModule implements CommandModule {
  public category = "faction";
  public commands: Set<string> = new Set(["faction"]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const args = command.args || [];
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      return this.handleHelp();
    }

    try {
      switch (subcommand) {
        case "list":
          return await this.handleList(context);
        case "join":
          return await this.handleJoin(context, args.slice(1));
        case "leave":
          return await this.handleLeave(context);
        case "status":
          return await this.handleStatus(context);
        case "missions":
          return await this.handleMissions(context);
        case "rank":
          return await this.handleRank(context);
        case "promote":
          return await this.handlePromote(context);
        case "standings":
          return await this.handleStandings(context);
        case "resources":
          return await this.handleResources(context);
        case "servers":
          return await this.handleServers(context);
        case "contest":
          return await this.handleContest(context, args.slice(1));
        case "wars":
        case "war":
          return await this.handleWar(context, args.slice(1));
        case "help":
          return this.handleHelp();
        default:
          return {
            success: false,
            output: `Unknown faction command: ${subcommand}\nType 'faction help' for usage.`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: `Error executing faction command: ${error instanceof Error ? error.message : "Unknown error"}`,
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo() {
    return [
      {
        command: "faction",
        category: "gameplay",
        description: "Manage faction membership and view status",
        usage: "faction <subcommand> [args]",
        examples: [
          "faction list",
          "faction join <faction_name>",
          "faction status",
          "faction missions",
          "faction rank",
          "faction promote",
          "faction standings",
          "faction resources",
          "faction servers",
          "faction contest <server_ip>",
          "faction contest status",
          "faction contest join <id> <attack|defend>",
        ],
      },
    ];
  }

  private handleHelp(): CommandResult {
    const entries: HelpEntry[] = [
      { command: "faction list", description: "List all available factions" },
      { command: "faction join <name>", description: "Join a faction" },
      { command: "faction leave", description: "Leave your current faction" },
      { command: "faction status", description: "View your faction standing" },
      {
        command: "faction missions",
        description: "View available faction missions",
      },
      {
        command: "faction rank",
        description: "View rank and promotion requirements",
      },
      {
        command: "faction promote",
        description: "Attempt promotion to next rank",
      },
      {
        command: "faction standings",
        description: "View reputation with all factions",
      },
      {
        command: "faction resources",
        description: "View faction resource levels",
      },
      {
        command: "faction servers",
        description: "View controlled servers & output",
      },
      {
        command: "faction contest <ip>",
        description: "Declare contest on a server",
      },
      {
        command: "faction contest status",
        description: "View active contests",
      },
      {
        command: "faction contest join <id>",
        description: "Join an active contest",
      },
      { command: "faction wars", description: "View active and recent wars" },
      {
        command: "faction war status",
        description: "View your faction's war status",
      },
    ];

    const lines = helpPanel("FACTION MANAGEMENT SYSTEM", entries, 50);

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  private async handleList(context: CommandContext): Promise<CommandResult> {
    const factionService = context.services.factionService;
    const factions = await factionService.getAllFactions(false, context.userId);

    if (factions.length === 0) {
      return {
        success: true,
        output: "No factions currently active.",
        timestamp: new Date(),
      };
    }

    const columns: Column[] = [
      { header: "NAME", width: 20 },
      { header: "MEMBERS", width: 7, align: "right" },
      { header: "IDEOLOGY", width: 20 },
    ];

    const rows = factions.map((faction) => [
      (faction.fullName || faction.name).substring(0, 20),
      faction.activeMembers.toString(),
      (faction.ideology || "Unknown").substring(0, 20),
    ]);

    const lines = table(
      columns,
      rows,
      "Use 'faction join <name>' to join a faction.",
    );

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  private async handleJoin(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    if (args.length === 0) {
      return {
        success: false,
        output: "Usage: faction join <faction_name>",
        timestamp: new Date(),
      };
    }

    const factionName = args.join(" ");
    const faction =
      await context.services.factionService.getFactionByName(factionName);

    if (!faction) {
      return {
        success: false,
        output: `Faction not found: ${factionName}`,
        timestamp: new Date(),
      };
    }

    const result = await context.services.factionService.joinFaction(
      context.userId,
      faction.id,
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleLeave(context: CommandContext): Promise<CommandResult> {
    const result = await context.services.factionService.leaveFaction(
      context.userId,
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleStatus(context: CommandContext): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: true,
        output:
          "You are not a member of any faction.\nUse 'faction list' to see available factions.",
        timestamp: new Date(),
      };
    }

    const faction = membership.faction;
    const reputation =
      await context.services.factionService.getFactionReputation(
        context.userId,
        faction.id,
      );

    const rows: Array<{ label: string; value: string }> = [
      { label: "Rank:         ", value: membership.rank.toUpperCase() },
      { label: "Reputation:   ", value: `${reputation}` },
      { label: "Total Earned: ", value: `${membership.totalReputationEarned}` },
      {
        label: "Joined:       ",
        value: membership.joinedAt.toLocaleDateString(),
      },
      { label: "Description:  ", value: faction.description },
    ];

    if (faction.objective) {
      rows.push({ label: "Objective:    ", value: faction.objective });
    }

    const lines = panel(
      `FACTION STATUS: ${faction.fullName || faction.name}`,
      rows,
      46,
    );

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  private async handleMissions(
    context: CommandContext,
  ): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to view faction missions.",
        timestamp: new Date(),
      };
    }

    const missions = await context.services.factionService.getFactionMissions(
      membership.factionId,
    );

    if (missions.length === 0) {
      return {
        success: true,
        output: `No active missions for ${membership.faction.name} at this time.`,
        timestamp: new Date(),
      };
    }

    const columns: Column[] = [
      { header: "ID", width: 6 },
      { header: "TITLE", width: 24 },
      { header: "DIFFICULTY", width: 10 },
      { header: "REWARD", width: 12 },
    ];

    const rows = missions.map((mission) => {
      const displayId = mission.id.substring(mission.id.length - 4);
      const reward =
        (mission.reward as { credits?: number } | null)?.credits || 0;
      return [
        displayId,
        mission.title.substring(0, 24),
        mission.difficulty.toString(),
        `${reward} credits`,
      ];
    });

    const lines = table(
      columns,
      rows,
      "Use 'mission accept <id>' to start a mission.",
    );

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  private async handleRank(context: CommandContext): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to view rank information.",
        timestamp: new Date(),
      };
    }

    const check = await context.services.factionService.checkRankRequirements(
      context.userId,
      membership.factionId,
    );

    const rows: Array<{ label: string; value: string }> = [
      { label: "Current Rank:     ", value: check.currentRank.toUpperCase() },
      { label: "Total Rep Earned: ", value: `${check.progress.reputation}` },
      { label: "Missions Done:    ", value: `${check.progress.missions}` },
    ];

    if (check.nextRank && check.requirements) {
      rows.push({ label: "", value: "" });
      rows.push({
        label: "Next Rank:        ",
        value: check.nextRank.toUpperCase(),
      });

      const repOk =
        check.progress.reputation >= check.requirements.reputation
          ? " [OK]"
          : "";
      rows.push({
        label: "Reputation:       ",
        value: `${check.progress.reputation}/${check.requirements.reputation}${repOk}`,
      });

      if (check.requirements.missions) {
        const missOk =
          check.progress.missions >= check.requirements.missions ? " [OK]" : "";
        rows.push({
          label: "Missions:         ",
          value: `${check.progress.missions}/${check.requirements.missions}${missOk}`,
        });
      }

      if (check.eligible) {
        rows.push({ label: "", value: "" });
        rows.push({
          label: ">> ELIGIBLE ",
          value: "Use 'faction promote' to rank up",
        });
      }
    } else {
      rows.push({ label: "", value: "" });
      rows.push({
        label: "Status:           ",
        value: "HIGHEST RANK ACHIEVED",
      });
    }

    const lines = panel(`RANK STATUS: ${membership.faction.name}`, rows, 48);

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  private async handlePromote(context: CommandContext): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to request promotion.",
        timestamp: new Date(),
      };
    }

    const result = await context.services.factionService.promoteUser(
      context.userId,
      membership.factionId,
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleStandings(
    context: CommandContext,
  ): Promise<CommandResult> {
    const standings = await context.services.factionService.getAllStandings(
      context.userId,
    );

    if (standings.length === 0) {
      return {
        success: true,
        output: "No faction standings recorded yet.",
        timestamp: new Date(),
      };
    }

    const columns: Column[] = [
      { header: "FACTION", width: 18 },
      { header: "REP", width: 5, align: "right" },
      { header: "BAR", width: 14 },
      { header: "STATUS", width: 8 },
    ];

    const rows = standings.map((s) => {
      const status = s.isAllied
        ? "ALLIED"
        : s.isHostile
          ? "HOSTILE"
          : "NEUTRAL";
      const bar = repBar(s.reputation);
      return [
        s.factionName.substring(0, 18),
        s.reputation.toString(),
        bar,
        status,
      ];
    });

    const lines = table(columns, rows);

    return {
      success: true,
      output: render(lines),
      timestamp: new Date(),
    };
  }

  private async handleResources(
    context: CommandContext,
  ): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to view resources.",
        timestamp: new Date(),
      };
    }

    const { getService } = await import("../../di/container");
    const resourceService =
      getService<import("../resourceService").default>("ResourceService");
    const resources = await resourceService.getFactionResources(
      membership.factionId,
    );

    const rows: Array<{ label: string; value: string }> = [
      { label: "Credits:  ", value: `${resources.credits}` },
      { label: "Intel:    ", value: `${resources.intel}` },
      { label: "Compute:  ", value: `${resources.compute}` },
    ];

    // Show recent ticks
    const history = await resourceService.getResourceHistory(
      membership.factionId,
      3,
    );
    if (history.length > 0) {
      rows.push({ label: "", value: "" });
      rows.push({ label: "Recent Income (per tick):", value: "" });
      for (const tick of history) {
        const parts = [];
        if (tick.credits > 0) parts.push(`+${tick.credits} credits`);
        if (tick.intel > 0) parts.push(`+${tick.intel} intel`);
        if (tick.compute > 0) parts.push(`+${tick.compute} compute`);
        if (parts.length > 0) {
          rows.push({ label: "  ", value: parts.join(", ") });
        }
      }
    }

    const lines = panel(`${membership.faction.name} RESOURCES`, rows, 46);

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleServers(context: CommandContext): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to view servers.",
        timestamp: new Date(),
      };
    }

    const servers = await context.services.factionService.getFactionServers(
      membership.factionId,
    );

    if (servers.length === 0) {
      return {
        success: true,
        output: `${membership.faction.name} does not control any servers.`,
        timestamp: new Date(),
      };
    }

    const columns: Column[] = [
      { header: "NAME", width: 18 },
      { header: "IP", width: 15 },
      { header: "RESOURCE", width: 10 },
      { header: "OUTPUT", width: 6, align: "right" },
      { header: "STATUS", width: 9 },
    ];

    const rows = servers.map((server) => {
      const resType = server.resourceType || "none";
      const status = server.isContested
        ? "CONTESTED"
        : server.isOnline
          ? "online"
          : "offline";
      return [
        server.name.substring(0, 18),
        server.ipAddress,
        resType,
        server.resourceOutput.toString(),
        status,
      ];
    });

    const lines = table(columns, rows);

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleContest(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const sub = args[0]?.toLowerCase();

    if (!sub || sub === "status") {
      return this.handleContestStatus(context);
    }

    if (sub === "join") {
      return this.handleContestJoin(context, args.slice(1));
    }

    if (sub === "contribute") {
      return this.handleContestContribute(context, args.slice(1));
    }

    // Otherwise, treat as server IP to contest
    return this.handleContestDeclare(context, sub);
  }

  private async handleContestStatus(
    context: CommandContext,
  ): Promise<CommandResult> {
    const { getService } = await import("../../di/container");
    const contestService =
      getService<import("../contestService").default>("ContestService");

    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );
    const contests = await contestService.getActiveContests(
      membership?.factionId || undefined,
    );

    if (contests.length === 0) {
      return {
        success: true,
        output: "No active territory contests.",
        timestamp: new Date(),
      };
    }

    const columns: Column[] = [
      { header: "ID", width: 6 },
      { header: "SERVER", width: 16 },
      { header: "ATTACKER", width: 12 },
      { header: "DEFENDER", width: 12 },
      { header: "PROGRESS", width: 16 },
      { header: "PLR", width: 3, align: "right" },
    ];

    const rows = contests.map((c) => {
      const shortId = c.id.slice(-6);
      const bar = progressBar(c.decryptionProgress);
      return [
        shortId,
        c.serverName.substring(0, 16),
        (c.attackingFactionName || "?").substring(0, 12),
        (c.defendingFactionName || "?").substring(0, 12),
        bar,
        `${c.participantCount}`,
      ];
    });

    const footer =
      "Use 'faction contest join <id> <attack|defend>' to participate.\n Use 'faction contest contribute <id>' to contribute to the contest.";
    const lines = table(columns, rows, footer);

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleContestJoin(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    if (args.length < 1) {
      return {
        success: false,
        output:
          "Usage: faction contest join <contest_id> [attack|defend|neutral]",
        timestamp: new Date(),
      };
    }

    const { getService } = await import("../../di/container");
    const contestService =
      getService<import("../contestService").default>("ContestService");

    const shortId = args[0]!;
    const side = (args[1]?.toLowerCase() || "neutral") as
      | "attack"
      | "defend"
      | "neutral";

    if (!["attack", "defend", "neutral"].includes(side)) {
      return {
        success: false,
        output: "Side must be: attack, defend, or neutral.",
        timestamp: new Date(),
      };
    }

    const contestId = await contestService.findContestByShortId(shortId);
    if (!contestId) {
      return {
        success: false,
        output: `Contest '${shortId}' not found.`,
        timestamp: new Date(),
      };
    }

    const result = await contestService.joinContest(
      contestId,
      context.userId,
      side,
    );
    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleContestContribute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    if (args.length < 1) {
      return {
        success: false,
        output: "Usage: faction contest contribute <contest_id>",
        timestamp: new Date(),
      };
    }

    const { getService } = await import("../../di/container");
    const contestService =
      getService<import("../contestService").default>("ContestService");

    const shortId = args[0]!;
    const contestId = await contestService.findContestByShortId(shortId);
    if (!contestId) {
      return {
        success: false,
        output: `Contest '${shortId}' not found.`,
        timestamp: new Date(),
      };
    }

    // Calculate contribution based on player skills
    const progress = await context.db.client.playerProgress.findUnique({
      where: { userId: context.userId },
    });

    if (!progress) {
      return {
        success: false,
        output: "Could not load player skills.",
        timestamp: new Date(),
      };
    }

    // Contribution = (hacking + cryptography) / 2000 → roughly 0.01-0.05 per action
    const rawContrib = (progress.hacking + progress.cryptography) / 2000;
    const contribution = Math.max(0.005, Math.min(0.1, rawContrib));

    const result = await contestService.contribute(
      contestId,
      context.userId,
      contribution,
    );
    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleContestDeclare(
    context: CommandContext,
    serverIp: string,
  ): Promise<CommandResult> {
    const membership = await context.services.factionService.getUserFaction(
      context.userId,
    );

    if (!membership) {
      return {
        success: false,
        output: "You must be in a faction to declare a contest.",
        timestamp: new Date(),
      };
    }

    // Find server by IP
    const server = await context.db.client.gameServer.findFirst({
      where: { ipAddress: serverIp },
    });

    if (!server) {
      return {
        success: false,
        output: `No server found at ${serverIp}.`,
        timestamp: new Date(),
      };
    }

    const { getService } = await import("../../di/container");
    const contestService =
      getService<import("../contestService").default>("ContestService");

    const result = await contestService.declareContest(
      context.userId,
      server.id,
      membership.factionId,
    );

    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleWar(
    context: CommandContext,
    args: string[],
  ): Promise<CommandResult> {
    const { getService } = await import("../../di/container");
    const warfareService =
      getService<import("../warfareService").default>("WarfareService");

    const sub = args[0]?.toLowerCase();

    if (sub === "status") {
      // Show current war for user's faction
      const membership = await context.services.factionService.getUserFaction(
        context.userId,
      );
      if (!membership) {
        return {
          success: false,
          output: "You are not in a faction.",
          timestamp: new Date(),
        };
      }

      const war = await warfareService.getActiveWar(membership.factionId);
      if (!war) {
        return {
          success: true,
          output: "Your faction is not currently at war.",
          timestamp: new Date(),
        };
      }

      const daysLeft = Math.max(
        0,
        14 -
          Math.floor(
            (Date.now() - new Date(war.startedAt).getTime()) /
              (24 * 60 * 60 * 1000),
          ),
      );

      const rows: Array<{ label: string; value: string }> = [
        { label: "Attacker:     ", value: war.attackerName },
        { label: "Defender:     ", value: war.defenderName },
        {
          label: "Score:        ",
          value: `${war.attackerScore} - ${war.defenderScore}`,
        },
        { label: "Rep Multi:    ", value: `${war.reputationMultiplier}x` },
        {
          label: "Started:      ",
          value: war.startedAt.toISOString().split("T")[0]!,
        },
        { label: "Ceasefire in: ", value: `${daysLeft} days` },
      ];

      const lines = panel("ACTIVE WAR", rows, 44);

      return { success: true, output: render(lines), timestamp: new Date() };
    }

    // Default: list all wars
    const wars = await warfareService.getWars(5);
    if (wars.length === 0) {
      return {
        success: true,
        output: "No wars have been declared.",
        timestamp: new Date(),
      };
    }

    const columns: Column[] = [
      { header: "STATUS", width: 10 },
      { header: "ATTACKER", width: 12 },
      { header: "DEFENDER", width: 12 },
      { header: "SCORE", width: 7 },
      { header: "STARTED", width: 10 },
    ];

    const rows = wars.map((war) => {
      const status =
        war.status === "active"
          ? "[!] ACTIVE"
          : war.status === "ceasefire"
            ? "[~] CEASE"
            : "[-] ENDED";
      const score = `${war.attackerScore}-${war.defenderScore}`;
      let started = war.startedAt.toISOString().split("T")[0]!;
      if (war.endedAt) {
        started = war.endedAt.toISOString().split("T")[0]!;
      }
      return [
        status,
        war.attackerName.substring(0, 12),
        war.defenderName.substring(0, 12),
        score,
        started,
      ];
    });

    const lines = table(columns, rows);

    return { success: true, output: render(lines), timestamp: new Date() };
  }
}
