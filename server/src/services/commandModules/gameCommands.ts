import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import logger from "../../logger";
import type { ShopItem } from "../shopService";
import type { InventoryItem } from "../shopService";
import {
  boxTop,
  boxBottom,
  boxDivider,
  boxRow,
  boxLine,
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
import { getObjectiveHint } from "../missionObjectiveTypes";
import { getInlineGlyph } from "../../utils/asciiAvatars";

export class GameCommandsModule implements CommandModule {
  // Per-player mission index: maps numeric shortcut (1-based) to full mission ID
  // Refreshed every time the `missions` command runs
  private missionIndex: Map<string, string[]> = new Map();

  public category = "game";
  public commands: Set<string> = new Set([
    "status",
    "skills",
    "missions",
    "mission",
    "accept",
    "abandon",
    "progress",
    "scripts",
    "shop",
    "buy",
    "sell",
    "use",
    "equip",
    "unequip",
    "equipment",
    "gear",
    "players",
    "who",
    "whois",
    "share_intel",
    "bounties",
    "bounty",
    "stories",
    "story",
    "leaderboard",
    "achievements",
    "fragment",
    "fragments",
    "endgame",
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
        case "missions":
          return await this.handleMissions(command, context);
        case "mission":
          return await this.handleMissionDetail(command, context);
        case "accept":
          return await this.handleAccept(command, context);
        case "abandon":
          return await this.handleAbandon(command, context);
        case "progress":
          return await this.handleProgress(command, context);
        case "scripts":
          return await this.handleInventory(command, context);
        case "shop":
          return await this.handleShop(command, context);
        case "buy":
          return await this.handleBuy(command, context);
        case "sell":
          return await this.handleSell(command, context);
        case "use":
          return await this.handleUse(command, context);
        case "equip":
          return await this.handleEquip(command, context);
        case "unequip":
          return await this.handleUnequip(command, context);
        case "equipment":
        case "gear":
          return await this.handleEquipment(command, context);
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
        case "stories":
          return await this.handleStories(command, context);
        case "story":
          return await this.handleStory(command, context);
        case "leaderboard":
          return await this.handleLeaderboard(command, context);
        case "achievements":
          return await this.handleAchievements(command, context);
        case "fragment":
        case "fragments":
          return await this.handleFragments(command, context);
        case "endgame":
          return await this.handleEndgame(command, context);
        default:
          return {
            success: false,
            output: `Game command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Game command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "status",
        category: "game",
        description: "Display player status and progress",
        usage: "status",
        examples: ["status"],
      },
      {
        command: "skills",
        category: "game",
        description: "Show player skills and levels",
        usage: "skills",
        examples: ["skills"],
      },
      {
        command: "missions",
        category: "game",
        description: "List available and active missions",
        usage: "missions [active|available|completed]",
        examples: ["missions", "missions active"],
      },
      {
        command: "mission",
        category: "game",
        description: "View detailed mission information",
        usage: "mission <mission_id>",
        examples: ["mission abc123"],
      },
      {
        command: "accept",
        category: "game",
        description: "Accept a mission and view briefing",
        usage: "accept <mission_id>",
        examples: ["accept mission_001"],
      },
      {
        command: "abandon",
        category: "game",
        description: "Abandon a mission (reputation penalty warning)",
        usage: "abandon <mission_id>",
        examples: ["abandon mission_001"],
      },
      {
        command: "progress",
        category: "game",
        description: "Show mission progress",
        usage: "progress",
        examples: ["progress"],
      },
      {
        command: "scripts",
        category: "game",
        description: "Show player inventory/scripts",
        usage: "scripts",
        examples: ["scripts"],
      },
      {
        command: "shop",
        category: "game",
        description: "Browse the darknet marketplace",
        usage: "shop [category] [search]",
        examples: ["shop", "shop EXPLOIT", "shop exploit scanner"],
      },
      {
        command: "buy",
        category: "game",
        description: "Purchase an item from the shop",
        usage: "buy <item_id> [quantity]",
        examples: ["buy port_scanner", "buy firewall 2"],
      },
      {
        command: "sell",
        category: "game",
        description: "Sell an item from inventory",
        usage: "sell <item_id> [quantity]",
        examples: ["sell old_script", "sell exploit_v1 3"],
      },
      {
        command: "use",
        category: "game",
        description: "Use an item from inventory",
        usage: "use <item_id>",
        examples: ["use health_pack", "use skill_boost"],
      },
      {
        command: "equip",
        category: "game",
        description: "Equip an item from your inventory",
        usage: "equip <item_id>",
        examples: ["equip port_scanner", "equip stealth_module"],
      },
      {
        command: "unequip",
        category: "game",
        description: "Unequip an item from a slot",
        usage: "unequip <slot|item_id>",
        examples: ["unequip TOOL", "unequip port_scanner"],
      },
      {
        command: "equipment",
        category: "game",
        description: "Show currently equipped items and bonuses",
        usage: "equipment",
        examples: ["equipment", "gear"],
      },
      {
        command: "players",
        category: "game",
        description: "List all online players",
        usage: "players",
        examples: ["players"],
      },
      {
        command: "who",
        category: "game",
        description: "Show players on current server",
        usage: "who",
        examples: ["who"],
      },
      {
        command: "whois",
        category: "game",
        description: "Get detailed player information",
        usage: "whois <username>",
        examples: ["whois h4x0r", "whois admin"],
      },
      {
        command: "bounties",
        category: "game",
        description: "View active bounties posted by factions",
        usage: "bounties",
        examples: ["bounties"],
      },
      {
        command: "bounty",
        category: "game",
        description: "Claim or complete a bounty",
        usage: "bounty <claim|complete> <bounty_id>",
        examples: ["bounty claim abc123", "bounty complete abc123"],
      },
      {
        command: "share_intel",
        category: "game",
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
        command: "stories",
        category: "game",
        description: "List your story arcs",
        usage: "stories",
        examples: ["stories"],
      },
      {
        command: "story",
        category: "game",
        description: "View or manage a story arc",
        usage: "story <arc_id> | story abandon <arc_id>",
        examples: ["story abc123", "story abandon abc123"],
      },
      {
        command: "leaderboard",
        category: "game",
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
        category: "game",
        description: "View your achievements and progress",
        usage: "achievements",
        examples: ["achievements"],
      },
      {
        command: "gear",
        category: "game",
        description: "View your equipped items (alias for equipment)",
        usage: "gear",
        examples: ["gear"],
      },
      {
        command: "fragments",
        category: "game",
        description: "View AIDA fragment status, trade, or steal fragments",
        usage: "fragments [give <type> <#> <player> | steal [<type> <#>]]",
        examples: [
          "fragments",
          "fragments give sword 1 alice",
          "fragments steal",
          "fragments steal key 2",
        ],
      },
      {
        command: "fragment",
        category: "game",
        description: "Alias for 'fragments'",
        usage: "fragment [give <type> <#> <player> | steal [<type> <#>]]",
      },
      {
        command: "endgame",
        category: "game",
        description:
          "Make your final choice about AIDA's fate (requires all 9 fragments)",
        usage: "endgame [help|expose|exploit]",
        examples: [
          "endgame",
          "endgame help",
          "endgame expose",
          "endgame exploit",
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

  // ==================== MISSIONS ====================

  /**
   * Resolve a mission identifier to a mission object.
   * Supports: numeric index (e.g. "1"), partial ID prefix, or full ID.
   */
  private resolveMissionId(
    missions: any[],
    input: string,
    userId?: string,
  ): any | undefined {
    // Try numeric index first (1-based)
    const num = parseInt(input, 10);
    if (!isNaN(num) && num > 0 && userId) {
      const indexList = this.missionIndex.get(userId);
      if (indexList && num <= indexList.length) {
        const fullId = indexList[num - 1];
        const found = missions.find(
          (m: any) => m.missionId === fullId || m.id === fullId,
        );
        if (found) return found;
      }
    }

    // Try exact match
    const exact = missions.find(
      (m: any) => m.missionId === input || m.id === input,
    );
    if (exact) return exact;

    // Try prefix match (truncated ID)
    const prefixMatches = missions.filter(
      (m: any) =>
        (m.missionId && m.missionId.startsWith(input)) ||
        (m.id && m.id.startsWith(input)),
    );
    if (prefixMatches.length === 1) return prefixMatches[0];

    return undefined;
  }

  private async handleMissions(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionService = context.services.missionService;
    const missionGenerator = context.services.missionGenerator;
    const filter = command.args?.[0] as string | undefined;

    let missions = await missionService.getPlayerMissions(context.userId);

    // Auto-generate missions if list is empty
    if (missions.length === 0 && missionGenerator) {
      try {
        const generated = await missionGenerator.generateMissionsForPlayer(
          context.userId,
          5,
        );
        if (generated.length > 0) {
          missions = await missionService.getPlayerMissions(context.userId);
        }
      } catch (err) {
        logger.error({ err }, "Mission auto-generation failed");
      }
    }

    // Filter by status if requested
    const statusFilter = filter?.toLowerCase();
    if (
      statusFilter &&
      ["active", "available", "completed", "assigned"].includes(statusFilter)
    ) {
      missions = missions.filter((m: any) => m.status === statusFilter);
    }

    const W = 56;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("MISSIONS", W));
    lines.push(boxDivider(W));

    if (missions.length === 0) {
      lines.push(boxRow("  No missions found.", W));
      lines.push(boxRow("  Check back later or explore the network.", W));
      lines.push(boxBottom(W));
      return { success: true, output: render(lines), timestamp: new Date() };
    }

    // Group by status
    const active = missions.filter(
      (m: any) => m.status === "active" || m.status === "assigned",
    );
    const available = missions.filter((m: any) => m.status === "available");
    const completed = missions.filter((m: any) => m.status === "completed");

    // Build ordered index: active first, then available, then completed
    // so numbers are stable and intuitive
    const indexList: string[] = [];
    let globalNum = 0;

    if (active.length > 0) {
      lines.push(boxRow(` ACTIVE (${active.length})`, W));
      lines.push(boxDivider(W));
      for (const m of active as any[]) {
        globalNum++;
        indexList.push(m.missionId || m.id);
        const diff = m.difficulty ? "*".repeat(Math.min(m.difficulty, 10)) : "";
        const objDone = (m.objectives || []).filter(
          (o: any) => o.completed,
        ).length;
        const objTotal = (m.objectives || []).length;
        lines.push(
          boxRow(
            ` ${globalNum}. ${(m.title || "Untitled").substring(0, 34)}`,
            W,
          ),
        );
        lines.push(boxRow(`    Diff: ${diff}  [${objDone}/${objTotal}]`, W));
        if (m.expiresAt) {
          const remaining = new Date(m.expiresAt).getTime() - Date.now();
          if (remaining > 0) {
            lines.push(
              boxRow(`    Time left: ${formatDuration(remaining)}`, W),
            );
          } else {
            lines.push(boxRow(`    TIME EXPIRED`, W));
          }
        }
        lines.push(boxRow("", W));
      }
    }

    if (available.length > 0) {
      if (active.length > 0) lines.push(boxDivider(W));
      lines.push(boxRow(` AVAILABLE (${available.length})`, W));
      lines.push(boxDivider(W));
      for (const m of available.slice(0, 10) as any[]) {
        globalNum++;
        indexList.push(m.missionId || m.id);
        const diff = m.difficulty ? "*".repeat(Math.min(m.difficulty, 10)) : "";
        const reward = m.reward;
        const rewardStr = reward
          ? `${reward.credits || 0}c ${reward.xp || 0}xp`
          : "";
        lines.push(
          boxRow(
            ` ${globalNum}. ${(m.title || "Untitled").substring(0, 34)}`,
            W,
          ),
        );
        lines.push(boxRow(`    ${diff}  ${rewardStr}`, W));
      }
      if (available.length > 10) {
        lines.push(boxRow(`   ... +${available.length - 10} more`, W));
      }
    }

    if (
      completed.length > 0 &&
      (!statusFilter || statusFilter === "completed")
    ) {
      lines.push(boxDivider(W));
      lines.push(boxRow(` COMPLETED (${completed.length})`, W));
      lines.push(boxDivider(W));
      for (const m of completed.slice(0, 5) as any[]) {
        globalNum++;
        indexList.push(m.missionId || m.id);
        lines.push(
          boxRow(
            ` ${globalNum}. [x] ${(m.title || "Untitled").substring(0, 32)}`,
            W,
          ),
        );
      }
      if (completed.length > 5) {
        lines.push(boxRow(`   ... +${completed.length - 5} more`, W));
      }
    }

    // Store index for this player so mission/accept/abandon can use numbers
    this.missionIndex.set(context.userId, indexList);

    lines.push(boxDivider(W));
    lines.push(boxRow("  'mission 1' for details", W));
    lines.push(boxRow("  'accept 1' to take a mission", W));
    lines.push(boxRow("  'progress' to track active objectives", W));
    lines.push(boxBottom(W));

    return {
      success: true,
      output: render(lines),
      data: missions,
      timestamp: new Date(),
    };
  }

  private async handleMissionDetail(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionId = command.args?.[0];
    if (!missionId) {
      return {
        success: false,
        output: "Usage: mission <mission_id>",
        timestamp: new Date(),
      };
    }

    const missionService = context.services.missionService;
    const missions = await missionService.getPlayerMissions(context.userId);
    const mission = this.resolveMissionId(
      missions,
      missionId,
      context.userId,
    ) as any;

    if (!mission) {
      return {
        success: false,
        output: `Mission not found: ${missionId}`,
        timestamp: new Date(),
      };
    }

    const W = 56;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("MISSION BRIEFING", W));
    lines.push(boxDivider(W));

    // Title and status
    lines.push(boxRow(` ${mission.title || "Untitled Mission"}`, W));
    lines.push(boxRow("", W));

    // Info rows
    const diff = mission.difficulty || 0;
    lines.push(
      boxRow(` Status:     ${(mission.status || "unknown").toUpperCase()}`, W),
    );
    lines.push(
      boxRow(
        ` Difficulty: ${"*".repeat(Math.min(diff, 10))}${"·".repeat(Math.max(0, 10 - diff))} (${diff}/10)`,
        W,
      ),
    );
    lines.push(boxRow(` Type:       ${mission.type || "unknown"}`, W));

    // Issuer/Faction
    if (mission.factionId || mission.issuedBy) {
      const issuer = mission.issuedBy
        ? `AI Persona ${(mission.issuedBy as string).substring(0, 12)}`
        : "System";
      lines.push(boxRow(` Issued by:  ${issuer}`, W));
    }

    // Rewards
    const reward = mission.reward || {};
    const rewardParts: string[] = [];
    if (reward.xp) rewardParts.push(`${reward.xp} XP`);
    if (reward.credits) rewardParts.push(`${reward.credits} Credits`);
    if (reward.reputation) rewardParts.push(`${reward.reputation} Rep`);
    if (reward.skillPoints) rewardParts.push(`${reward.skillPoints} SP`);
    if (rewardParts.length > 0) {
      lines.push(boxRow(` Rewards:    ${rewardParts.join(", ")}`, W));
    }

    // Time limit
    if (mission.expiresAt) {
      const remaining = new Date(mission.expiresAt).getTime() - Date.now();
      if (remaining > 0) {
        lines.push(boxRow(` Time left:  ${formatDuration(remaining)}`, W));
      } else {
        lines.push(boxRow(` Time left:  EXPIRED`, W));
      }
    }

    // Description
    if (mission.description) {
      lines.push(boxDivider(W));
      const desc = String(mission.description);
      // Word-wrap description to fit box
      const words = desc.split(" ");
      let line = "";
      for (const word of words) {
        if ((line + " " + word).length > W - 4) {
          lines.push(boxRow(` ${line}`, W));
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      }
      if (line) lines.push(boxRow(` ${line}`, W));
    }

    // Objectives
    if (mission.objectives && mission.objectives.length > 0) {
      lines.push(boxDivider(W));
      lines.push(boxRow(" OBJECTIVES", W));
      lines.push(boxRow("", W));

      for (const obj of mission.objectives as any[]) {
        const done = obj.completed;
        const marker = done ? "[x]" : "[ ]";
        const current = obj.current ?? 0;
        const target = obj.target;
        const desc = obj.description || obj.type || "???";

        lines.push(boxRow(` ${marker} ${desc.substring(0, W - 8)}`, W));

        if (typeof target === "number" && target > 1) {
          const ratio = Math.min(current / target, 1);
          const bar = progressBar(ratio, 20);
          lines.push(boxRow(`     ${bar}  ${current}/${target}`, W));
        }

        // Hint for incomplete objectives
        if (!done) {
          const hint = getObjectiveHint(obj.type || "");
          if (hint && hint.length < W - 8) {
            lines.push(boxRow(`     Hint: ${hint.substring(0, W - 14)}`, W));
          }
        }
      }
    }

    lines.push(boxDivider(W));
    if (mission.status === "available") {
      // Find the numeric shortcut for this mission
      const idx = this.missionIndex.get(context.userId);
      const num = idx ? idx.indexOf(mission.missionId || missionId) + 1 : 0;
      const ref = num > 0 ? String(num) : missionId.substring(0, 16);
      lines.push(boxRow(`  'accept ${ref}' to start`, W));
    } else if (mission.status === "active" || mission.status === "assigned") {
      const idx = this.missionIndex.get(context.userId);
      const num = idx ? idx.indexOf(mission.missionId || missionId) + 1 : 0;
      const ref = num > 0 ? String(num) : missionId.substring(0, 16);
      lines.push(boxRow("  'progress' to track objectives", W));
      lines.push(boxRow(`  'abandon ${ref}' to drop`, W));
    }
    lines.push(boxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleAccept(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionId = command.args?.[0];
    if (!missionId) {
      return {
        success: false,
        output: "Usage: accept <mission_id>",
        timestamp: new Date(),
      };
    }

    const missionService = context.services.missionService;

    try {
      // Resolve numeric/partial ID to full ID before calling service
      const allMissions = await missionService.getPlayerMissions(
        context.userId,
      );
      const resolved = this.resolveMissionId(
        allMissions,
        missionId,
        context.userId,
      );
      const fullMissionId = resolved?.missionId || missionId;

      await missionService.acceptMission(context.userId, fullMissionId);

      const missions = await missionService.getPlayerMissions(
        context.userId,
        "active",
      );
      const accepted = this.resolveMissionId(missions, fullMissionId) as any;

      const W = 52;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("MISSION ACCEPTED", W));
      lines.push(boxDivider(W));

      lines.push(boxRow(` ${accepted?.title || missionId}`, W));

      if (accepted?.difficulty) {
        const d = accepted.difficulty;
        lines.push(
          boxRow(
            ` Difficulty: ${"*".repeat(Math.min(d, 10))}${"·".repeat(Math.max(0, 10 - d))}`,
            W,
          ),
        );
      }

      if (accepted?.expiresAt) {
        const remaining = new Date(accepted.expiresAt).getTime() - Date.now();
        if (remaining > 0) {
          lines.push(boxRow(` Time limit: ${formatDuration(remaining)}`, W));
        }
      }

      const reward = accepted?.reward || {};
      const rParts: string[] = [];
      if (reward.xp) rParts.push(`${reward.xp} XP`);
      if (reward.credits) rParts.push(`${reward.credits}c`);
      if (rParts.length > 0) {
        lines.push(boxRow(` Rewards:    ${rParts.join(" + ")}`, W));
      }

      if (accepted?.objectives && Array.isArray(accepted.objectives)) {
        lines.push(boxDivider(W));
        lines.push(boxRow(" OBJECTIVES", W));
        for (const obj of accepted.objectives) {
          const target =
            typeof obj.target === "number" ? `0/${obj.target}` : "";
          lines.push(
            boxRow(` [ ] ${obj.description || obj.type} ${target}`, W),
          );
          const hint = getObjectiveHint(obj.type || "");
          if (hint) {
            lines.push(boxRow(`     > ${hint.substring(0, W - 10)}`, W));
          }
        }
      }

      lines.push(boxDivider(W));
      lines.push(boxRow(" Use 'progress' to track objectives.", W));
      lines.push(boxBottom(W));

      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        output: `Failed to accept mission: ${msg}`,
        timestamp: new Date(),
      };
    }
  }

  private async handleAbandon(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionId = command.args?.[0];
    if (!missionId) {
      return {
        success: false,
        output: "Usage: abandon <mission_id>",
        timestamp: new Date(),
      };
    }

    const missionService = context.services.missionService;

    try {
      const missions = await missionService.getPlayerMissions(context.userId);
      const target = this.resolveMissionId(
        missions,
        missionId,
        context.userId,
      ) as any;
      const fullMissionId = target?.missionId || missionId;
      const title = target?.title || missionId;
      const factionName = target?.factionId ? "faction" : null;

      await missionService.abandonMission(context.userId, fullMissionId);

      const W = 52;
      const lines: string[] = [];
      lines.push(sBoxTop(W));
      lines.push(sBoxRow(" [!] MISSION ABANDONED", W));
      lines.push(sBoxRow("", W));
      lines.push(sBoxRow(` Mission: ${title.substring(0, W - 12)}`, W));
      lines.push(sBoxRow("", W));
      if (factionName) {
        lines.push(sBoxRow(" WARNING: Abandoning faction missions", W));
        lines.push(sBoxRow(" may reduce your standing with them.", W));
      } else {
        lines.push(sBoxRow(" No reputation penalty for this mission.", W));
      }
      lines.push(sBoxBottom(W));

      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        output: `Failed to abandon mission: ${msg}`,
        timestamp: new Date(),
      };
    }
  }

  private async handleProgress(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionService = context.services.missionService;
    const missions = await missionService.getPlayerMissions(
      context.userId,
      "active",
    );

    if (!missions || missions.length === 0) {
      return {
        success: true,
        output:
          "No active missions. Use 'missions' to browse available missions.",
        timestamp: new Date(),
      };
    }

    const W = 56;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("ACTIVE MISSIONS", W));
    lines.push(boxDivider(W));

    for (let mi = 0; mi < missions.length; mi++) {
      const m = missions[mi] as any;
      if (mi > 0) lines.push(boxDivider(W));

      lines.push(boxRow(` ${m.title || "Untitled"}`, W));

      // Time remaining
      if (m.expiresAt) {
        const remaining = new Date(m.expiresAt).getTime() - Date.now();
        if (remaining > 0) {
          const urgency = remaining < 3600000 ? " [!]" : "";
          lines.push(
            boxRow(` Time: ${formatDuration(remaining)}${urgency}`, W),
          );
        } else {
          lines.push(boxRow(` Time: EXPIRED`, W));
        }
      }

      // Objectives with progress bars
      if (m.objectives && m.objectives.length > 0) {
        const doneCount = m.objectives.filter((o: any) => o.completed).length;
        const totalCount = m.objectives.length;
        const overallRatio = totalCount > 0 ? doneCount / totalCount : 0;
        lines.push(
          boxRow(
            ` Overall: ${progressBar(overallRatio, 20)}  ${doneCount}/${totalCount}`,
            W,
          ),
        );
        lines.push(boxRow("", W));

        for (const obj of m.objectives as any[]) {
          const done = obj.completed;
          const marker = done ? "[x]" : "[ ]";
          const desc = (obj.description || obj.type || "???").substring(
            0,
            W - 8,
          );
          lines.push(boxRow(` ${marker} ${desc}`, W));

          if (!done && typeof obj.target === "number" && obj.target > 0) {
            const current = obj.current ?? 0;
            const ratio = Math.min(current / obj.target, 1);
            lines.push(
              boxRow(
                `     ${progressBar(ratio, 18)}  ${current}/${obj.target}`,
                W,
              ),
            );
          }
        }
      }
    }

    lines.push(boxDivider(W));
    lines.push(boxRow("  'mission <id>' for full details", W));
    lines.push(boxBottom(W));

    return {
      success: true,
      output: render(lines),
      data: missions,
      timestamp: new Date(),
    };
  }

  private async handleInventory(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const shopService = context.services.shopService;
    const inventory = await shopService.getPlayerInventory(context.userId);
    const bonuses = await shopService.getPlayerBonuses(context.userId);

    if (inventory.length === 0) {
      return {
        success: true,
        output: "Your scripts folder is empty. Type 'shop' to browse items.",
        timestamp: new Date(),
      };
    }

    const W = 48;

    // Group by category
    const categories = new Map<string, typeof inventory>();
    inventory.forEach((item: InventoryItem) => {
      const cat = item.item.category;
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat)!.push(item);
    });

    // Build sections for multiPanel
    const sections: Array<{
      heading?: string;
      rows: Array<{ label: string; value: string }>;
    }> = [];

    categories.forEach((items, category) => {
      const rows: Array<{ label: string; value: string }> = [];
      items.forEach((invItem: InventoryItem) => {
        const qty = invItem.quantity > 1 ? ` (x${invItem.quantity})` : "";
        rows.push({ label: `• ${invItem.item.name}${qty}`, value: "" });
        rows.push({ label: `  ${invItem.item.description}`, value: "" });
        if (invItem.item.effects) {
          const effects = Object.entries(invItem.item.effects)
            .filter(([_, val]) => val && (val as number) > 0)
            .map(([key, val]) => `${key}: +${val}`)
            .join(", ");
          if (effects) rows.push({ label: `  Effects: ${effects}`, value: "" });
        }
      });
      sections.push({ heading: category, rows });
    });

    // Total bonuses section
    const bonusRows: Array<{ label: string; value: string }> = [];
    if (bonuses.hackingBonus)
      bonusRows.push({ label: "Hacking:", value: `+${bonuses.hackingBonus}` });
    if (bonuses.stealthBonus)
      bonusRows.push({ label: "Stealth:", value: `+${bonuses.stealthBonus}` });
    if (bonuses.speedBonus)
      bonusRows.push({ label: "Speed:", value: `+${bonuses.speedBonus}` });
    if (bonuses.detectionReduction)
      bonusRows.push({
        label: "Detection Reduction:",
        value: `-${(bonuses.detectionReduction * 100).toFixed(0)}%`,
      });
    if (bonuses.successRateIncrease)
      bonusRows.push({
        label: "Success Rate:",
        value: `+${(bonuses.successRateIncrease * 100).toFixed(0)}%`,
      });
    if (bonusRows.length === 0) {
      bonusRows.push({ label: "No active bonuses.", value: "" });
    }
    sections.push({ heading: "TOTAL BONUSES", rows: bonusRows });

    const lines = multiPanel("SCRIPTS", sections, W);
    const output = render(lines);

    return {
      success: true,
      output,
      data: { inventory, bonuses },
      timestamp: new Date(),
    };
  }

  private async handleShop(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const shopService = context.services.shopService;
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

    const category = command.args?.[0]?.toUpperCase();
    const search = command.args?.slice(1).join(" ");

    let items = shopService.getAllItems();

    // Filter by player level
    items = items.filter(
      (item: ShopItem) => item.requiredLevel <= progress.level,
    );

    // Filter by category if provided
    if (category) {
      items = items.filter((item: ShopItem) => item.category === category);
    }

    // Search if provided
    if (search) {
      items = shopService.searchItems(search);
    }

    if (items.length === 0) {
      return {
        success: true,
        output: "No items found matching your criteria.",
        timestamp: new Date(),
      };
    }

    const W = 52;
    const lines: string[] = [];

    lines.push(boxTop(W));
    lines.push(boxCenter("DARKNET MARKETPLACE", W));
    lines.push(boxDivider(W));
    lines.push(boxLine("Credits:", `${progress.credits}`, W));
    lines.push(boxLine("Level:", `${progress.level}`, W));

    if (category) {
      lines.push(boxLine("Category:", category, W));
    }

    // Group by category
    const categories = new Map<string, typeof items>();
    items.forEach((item: ShopItem) => {
      const cat = item.category;
      if (!categories.has(cat)) {
        categories.set(cat, []);
      }
      categories.get(cat)!.push(item);
    });

    categories.forEach((catItems, cat) => {
      lines.push(boxDivider(W));
      lines.push(boxRow(cat, W));
      lines.push(boxDivider(W));
      catItems.forEach((item: ShopItem) => {
        const canBuy = progress.credits >= item.price;
        const price = canBuy
          ? `${item.price}¢`
          : `${item.price}¢ [INSUFFICIENT]`;
        lines.push(boxRow(`[${item.id}] ${item.name} - ${price}`, W));
        lines.push(boxRow(`  ${item.description}`, W));
        lines.push(
          boxRow(`  Rarity: ${item.rarity} | Level: ${item.requiredLevel}`, W),
        );
        if (item.effects) {
          const effects = Object.entries(item.effects)
            .filter(([_, val]) => val && (val as number) > 0)
            .map(([key, val]) => `${key}: +${val}`)
            .join(", ");
          if (effects) lines.push(boxRow(`  Effects: ${effects}`, W));
        }
      });
    });

    lines.push(boxDivider(W));
    lines.push(boxRow("buy <item_id> [qty]  Purchase item", W));
    lines.push(boxRow("shop <category>      Filter by category", W));
    lines.push(boxBottom(W));

    const output = render(lines);

    return {
      success: true,
      output,
      data: { items, credits: progress.credits },
      timestamp: new Date(),
    };
  }

  private async handleBuy(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args?.[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: buy <item_id> [quantity]",
        timestamp: new Date(),
      };
    }

    const quantity = parseInt(command.args?.[1] || "1");

    const shopService = context.services.shopService;
    const result = await shopService.purchaseItem(
      context.userId,
      itemId,
      quantity,
    );

    return {
      success: result.success,
      output: result.message,
      data: result,
      timestamp: new Date(),
    };
  }

  private async handleSell(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args?.[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: sell <item_id> [quantity]",
        timestamp: new Date(),
      };
    }

    const quantity = parseInt(command.args?.[1] || "1");

    const shopService = context.services.shopService;
    const result = await shopService.sellItem(context.userId, itemId, quantity);

    return {
      success: result.success,
      output: result.message,
      data: result,
      timestamp: new Date(),
    };
  }

  private async handleUse(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: use <item_id>",
        timestamp: new Date(),
      };
    }

    const shopService = context.services.shopService;
    const result = await shopService.useItem(context.userId, itemId);

    return {
      success: result.success,
      output: result.message,
      data: result.effects,
      timestamp: new Date(),
    };
  }

  private async handleEquip(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const itemId = command.args[0];

    if (!itemId) {
      return {
        success: false,
        output: "Usage: equip <item_id>\nExample: equip port_scanner",
        timestamp: new Date(),
      };
    }

    const shopService = context.services.shopService;
    const inventoryService = context.services.inventoryService;

    // Get the item from catalog
    const item = shopService.getItem(itemId);
    if (!item) {
      return {
        success: false,
        output: `Item not found: ${itemId}`,
        timestamp: new Date(),
      };
    }

    // Equip the item
    const result = await inventoryService.equipItem(
      context.userId,
      itemId,
      item,
    );

    return {
      success: result.success,
      output: result.message,
      data: result.effects,
      timestamp: new Date(),
    };
  }

  private async handleUnequip(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const arg = command.args[0];

    if (!arg) {
      return {
        success: false,
        output:
          "Usage: unequip <slot|item_id>\nSlots: TOOL, SOFTWARE, EXPLOIT, DEFENSE, UPGRADE",
        timestamp: new Date(),
      };
    }

    const inventoryService = context.services.inventoryService;

    // Check if arg is a valid slot name
    const validSlots = ["TOOL", "SOFTWARE", "EXPLOIT", "DEFENSE", "UPGRADE"];
    if (validSlots.includes(arg.toUpperCase())) {
      const result = await inventoryService.unequipItem(
        context.userId,
        arg.toUpperCase() as import("../inventoryService").EquipmentSlot,
      );
      return {
        success: result.success,
        output: result.message,
        timestamp: new Date(),
      };
    }

    // Otherwise treat it as an item ID
    const result = await inventoryService.unequipItemById(context.userId, arg);
    return {
      success: result.success,
      output: result.message,
      timestamp: new Date(),
    };
  }

  private async handleEquipment(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const shopService = context.services.shopService;
    const inventoryService = context.services.inventoryService;

    // Get equipped items
    const equipment = await inventoryService.getEquipment(context.userId);

    // Get item catalog
    const catalog = shopService.getAllItems();

    // Get bonuses
    const bonuses = await inventoryService.getEquipmentBonuses(
      context.userId,
      catalog,
    );

    const W = 44;

    const slots = ["TOOL", "SOFTWARE", "EXPLOIT", "DEFENSE", "UPGRADE"];
    const equipRows: Array<{ label: string; value: string }> = [];
    let hasEquipped = false;

    for (const slot of slots) {
      const itemId = (equipment as Record<string, string | undefined>)[slot];
      if (itemId) {
        hasEquipped = true;
        const item = catalog.find((i: ShopItem) => i.id === itemId);
        if (item) {
          equipRows.push({ label: `[${slot}]`, value: item.name });
          if (item.effects) {
            const effects = [];
            if (item.effects.hackingBonus)
              effects.push(`+${item.effects.hackingBonus} Hacking`);
            if (item.effects.stealthBonus)
              effects.push(`+${item.effects.stealthBonus} Stealth`);
            if (item.effects.speedBonus)
              effects.push(`+${item.effects.speedBonus}% Speed`);
            if (item.effects.detectionReduction)
              effects.push(`-${item.effects.detectionReduction}% Detection`);
            if (item.effects.successRateIncrease)
              effects.push(`+${item.effects.successRateIncrease}% Success`);
            if (item.effects.xpMultiplier)
              effects.push(
                `${(item.effects.xpMultiplier * 100).toFixed(0)}% XP`,
              );
            if (item.effects.creditsMultiplier)
              effects.push(
                `${(item.effects.creditsMultiplier * 100).toFixed(0)}% Credits`,
              );
            if (effects.length > 0) {
              equipRows.push({
                label: `  Effects: ${effects.join(", ")}`,
                value: "",
              });
            }
          }
        }
      } else {
        equipRows.push({ label: `[${slot}]`, value: "(empty)" });
      }
    }

    if (!hasEquipped) {
      equipRows.length = 0;
      equipRows.push({ label: "No items equipped.", value: "" });
    }

    // Build total bonuses rows
    const bonusRows: Array<{ label: string; value: string }> = [];
    if (bonuses.hackingBonus)
      bonusRows.push({ label: "Hacking:", value: `+${bonuses.hackingBonus}` });
    if (bonuses.stealthBonus)
      bonusRows.push({ label: "Stealth:", value: `+${bonuses.stealthBonus}` });
    if (bonuses.speedBonus)
      bonusRows.push({ label: "Speed:", value: `+${bonuses.speedBonus}%` });
    if (bonuses.detectionReduction)
      bonusRows.push({
        label: "Detection:",
        value: `-${bonuses.detectionReduction}%`,
      });
    if (bonuses.successRateIncrease)
      bonusRows.push({
        label: "Success Rate:",
        value: `+${bonuses.successRateIncrease}%`,
      });
    if (bonuses.xpMultiplier !== 1.0)
      bonusRows.push({
        label: "XP Multiplier:",
        value: `${bonuses.xpMultiplier.toFixed(2)}x`,
      });
    if (bonuses.creditsMultiplier !== 1.0)
      bonusRows.push({
        label: "Credits Multiplier:",
        value: `${bonuses.creditsMultiplier.toFixed(2)}x`,
      });

    if (bonusRows.length === 0) {
      bonusRows.push({ label: "No active bonuses.", value: "" });
    }

    const lines = multiPanel(
      "EQUIPPED ITEMS",
      [{ rows: equipRows }, { heading: "TOTAL BONUSES", rows: bonusRows }],
      W,
    );

    const output = render(lines);

    return {
      success: true,
      output,
      data: { equipment, bonuses },
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

  // Helper methods
  // Old formatMissionList/formatMissionProgress removed — formatting is now inline in handlers

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

  // ══════════════════════════════════════════════════════════════════
  // STORY ARC COMMANDS
  // ══════════════════════════════════════════════════════════════════

  private async handleStories(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const storyService = context.services.storyMissionService;
    if (!storyService) {
      return {
        success: false,
        output: "Story system unavailable.",
        timestamp: new Date(),
      };
    }

    const arcs = await storyService.getPlayerStoryArcs(context.userId);

    if (arcs.length === 0) {
      return {
        success: true,
        output:
          "No story arcs available.\nStory arcs are offered by faction leaders — increase your faction standing to unlock them.",
        timestamp: new Date(),
      };
    }

    const W = 58;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("STORY ARCS", W));
    lines.push(boxDivider(W));

    for (const arc of arcs) {
      const statusIcon =
        arc.status === "active"
          ? "[ACTIVE]"
          : arc.status === "completed"
            ? "[DONE]"
            : arc.status === "failed"
              ? "[FAILED]"
              : "[ABANDONED]";
      lines.push(boxRow(` ${statusIcon} ${arc.title}`, W));
      lines.push(
        boxRow(
          `   Faction: ${arc.faction?.name || "Unknown"} | Step ${arc.currentStep + 1}/${arc.totalSteps}`,
          W,
        ),
      );
      lines.push(boxRow(`   ID: ${arc.id.substring(0, 16)}...`, W));
      lines.push(boxRow("", W));
    }

    lines.push(boxDivider(W));
    lines.push(boxRow(" 'story <id>' for details", W));
    lines.push(boxRow(" 'story abandon <id>' to abandon", W));
    lines.push(boxBottom(W));

    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleStory(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const storyService = context.services.storyMissionService;
    if (!storyService) {
      return {
        success: false,
        output: "Story system unavailable.",
        timestamp: new Date(),
      };
    }

    const action = command.args?.[0];
    if (!action) {
      return {
        success: false,
        output: "Usage: story <arc_id>\n       story abandon <arc_id>",
        timestamp: new Date(),
      };
    }

    // Handle abandon
    if (action === "abandon") {
      const arcId = command.args?.[1];
      if (!arcId) {
        return {
          success: false,
          output: "Usage: story abandon <arc_id>",
          timestamp: new Date(),
        };
      }
      const result = await storyService.abandonStoryArc(context.userId, arcId);
      if (!result.success) {
        return {
          success: false,
          output: result.error || "Failed to abandon story arc.",
          timestamp: new Date(),
        };
      }
      return {
        success: true,
        output:
          "Story arc abandoned. Any active missions from this arc have been cancelled.",
        timestamp: new Date(),
      };
    }

    // View story arc details
    const arcId = action;
    const arc = await storyService.getStoryArc(arcId);

    if (!arc) {
      return {
        success: false,
        output: `Story arc not found: ${arcId}`,
        timestamp: new Date(),
      };
    }

    const steps = arc.steps as any[];
    const W = 58;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter(arc.title.toUpperCase(), W));
    lines.push(boxDivider(W));
    lines.push(boxRow(` Faction: ${arc.faction?.name || "Unknown"}`, W));
    lines.push(boxRow(` Issued by: ${arc.persona?.name || "Unknown"}`, W));
    lines.push(boxRow(` Status: ${arc.status.toUpperCase()}`, W));
    lines.push(boxRow(` Difficulty: ${arc.difficulty}/10`, W));
    lines.push(boxDivider(W));
    lines.push(boxRow(` ${arc.description}`, W));
    lines.push(boxDivider(W));
    lines.push(boxCenter("STEPS", W));
    lines.push(boxDivider(W));

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const icon =
        step.status === "completed"
          ? "[+]"
          : step.status === "active"
            ? "[>]"
            : step.status === "failed"
              ? "[X]"
              : step.status === "skipped"
                ? "[-]"
                : "[ ]";
      lines.push(boxRow(` ${icon} Step ${i + 1}: ${step.title}`, W));
      if (step.status === "active" && step.missionId) {
        lines.push(
          boxRow(`     Mission: ${step.missionId.substring(0, 16)}...`, W),
        );
      }
    }

    lines.push(boxBottom(W));
    return { success: true, output: render(lines), timestamp: new Date() };
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

  private async handleFragments(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return {
        success: false,
        output: "Key fragment service unavailable.",
        timestamp: new Date(),
      };
    }

    const subcommand = command.args?.[0]?.toLowerCase();

    if (subcommand === "give") {
      return this.handleFragmentGive(command, context);
    }
    if (subcommand === "steal") {
      return this.handleFragmentSteal(command, context);
    }

    // Default: show fragment status
    return this.handleFragmentView(command, context);
  }

  private async handleFragmentView(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return {
        success: false,
        output: "Key fragment service unavailable.",
        timestamp: new Date(),
      };
    }

    const progress = await keyFragmentService.getPlayerFragments(
      context.userId,
    );

    const W = 58;
    const lines: string[] = [];
    lines.push(boxTop(W));
    lines.push(boxCenter("AIDA FRAGMENTS", W));
    lines.push(boxDivider(W));
    lines.push(boxRow("", W));

    const typeConfigs: {
      key: "sword" | "key" | "collar";
      icon: string;
      label: string;
      subtitle: string;
    }[] = [
      {
        key: "sword",
        icon: "[x]",
        label: "THE SWORD",
        subtitle: "Offensive Capacity",
      },
      {
        key: "key",
        icon: "[>]",
        label: "THE KEY",
        subtitle: "Infiltration Capacity",
      },
      {
        key: "collar",
        icon: "[=]",
        label: "THE COLLAR",
        subtitle: "Control Program",
      },
    ];

    for (const cfg of typeConfigs) {
      const tp = progress[cfg.key];
      lines.push(boxRow(`  ${cfg.icon} ${cfg.label}  -- ${cfg.subtitle}`, W));

      // Build a lookup of fragments by fragmentNum
      const fragmentMap = new Map<number, (typeof tp.fragments)[0]>();
      for (const f of tp.fragments) {
        fragmentMap.set(f.fragmentNum, f);
      }

      const greekNames = ["Alpha", "Beta", "Gamma"];
      for (let i = 0; i < tp.total; i++) {
        const fragment = fragmentMap.get(i + 1);
        const typeName = cfg.key.charAt(0).toUpperCase() + cfg.key.slice(1);
        const fragName = `${typeName} Fragment ${greekNames[i] || i + 1}`;
        const name = fragment ? fragment.name : fragName;
        let holder: string;
        if (fragment && fragment.isHeldByPlayer) {
          holder = "<< YOU >>";
        } else if (fragment && fragment.heldByUsername) {
          holder = fragment.heldByUsername;
        } else {
          holder = "[unclaimed]";
        }
        lines.push(boxRow(`    #${i + 1} ${name.padEnd(24)} ${holder}`, W));
      }
      lines.push(boxRow("", W));
    }

    lines.push(boxDivider(W));
    lines.push(
      boxRow(`  You hold: ${progress.totalHeld}/${progress.totalRequired}`, W),
    );

    if (progress.gameCompleted) {
      lines.push(
        boxRow(
          `  Endgame: COMPLETED -- you chose to ${progress.endgameChoice}`,
          W,
        ),
      );
    } else if (progress.endgameUnlocked) {
      lines.push(
        boxRow("  Endgame: UNLOCKED -- use 'endgame' to choose your fate", W),
      );
    } else {
      lines.push(boxRow(`  Endgame: LOCKED (collect all 9 to unlock)`, W));
    }

    lines.push(boxRow("", W));
    lines.push(boxRow("  'fragments give <type> <#> <player>' to trade", W));
    lines.push(
      boxRow("  'fragments steal <type> <#>' while on target's server", W),
    );
    lines.push(boxBottom(W));
    return { success: true, output: render(lines), timestamp: new Date() };
  }

  private async handleFragmentGive(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return {
        success: false,
        output: "Key fragment service unavailable.",
        timestamp: new Date(),
      };
    }

    const type = command.args?.[1]?.toLowerCase();
    const num = command.args?.[2];
    const targetUsername = command.args?.[3];

    if (!type || !num || !targetUsername) {
      return {
        success: false,
        output:
          "Usage: fragments give <type> <#> <player>\n  type: sword, key, collar\n  #: 1, 2, or 3",
        timestamp: new Date(),
      };
    }

    const validTypes = ["sword", "key", "collar"];
    if (!validTypes.includes(type)) {
      return {
        success: false,
        output: `Invalid fragment type: '${type}'. Valid types: sword, key, collar.`,
        timestamp: new Date(),
      };
    }

    const fragmentNum = parseInt(num);
    if (![1, 2, 3].includes(fragmentNum)) {
      return {
        success: false,
        output: `Invalid fragment number: '${num}'. Must be 1, 2, or 3.`,
        timestamp: new Date(),
      };
    }

    const fragment = await context.db.client.keyFragment.findUnique({
      where: { keyType_fragmentNum: { keyType: type, fragmentNum } },
    });

    if (!fragment) {
      return {
        success: false,
        output: `Fragment ${type} #${fragmentNum} not found.`,
        timestamp: new Date(),
      };
    }

    const targetUser = await context.db.client.user.findFirst({
      where: { username: { equals: targetUsername, mode: "insensitive" } },
    });

    if (!targetUser) {
      return {
        success: false,
        output: `Player not found: '${targetUsername}'.`,
        timestamp: new Date(),
      };
    }

    if (targetUser.id === context.userId) {
      return {
        success: false,
        output: "Cannot give a fragment to yourself.",
        timestamp: new Date(),
      };
    }

    try {
      const result = await keyFragmentService.transferFragment(
        context.userId,
        targetUser.id,
        fragment.id,
      );

      if (!result.transferred) {
        return {
          success: false,
          output:
            result.message ||
            `Failed to transfer ${type} fragment #${fragmentNum}.`,
          timestamp: new Date(),
        };
      }

      const recipientProgress = await keyFragmentService.getPlayerFragments(
        targetUser.id,
      );

      return {
        success: true,
        output: `You gave ${fragment.name} to ${targetUser.username}. They now hold ${recipientProgress.totalHeld}/${recipientProgress.totalRequired} fragments.`,
        timestamp: new Date(),
      };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error
            ? error.message
            : `Failed to transfer fragment.`,
        timestamp: new Date(),
      };
    }
  }

  private async handleFragmentSteal(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return {
        success: false,
        output: "Key fragment service unavailable.",
        timestamp: new Date(),
      };
    }

    // Check current server connection
    const connection = await context.db.client.serverConnection.findFirst({
      where: { userId: context.userId, isActive: true },
      include: { server: true },
    });
    if (!connection || !connection.server) {
      return {
        success: false,
        output: "Not connected to any server.",
        timestamp: new Date(),
      };
    }
    if (!connection.server.isPlayerHome) {
      return {
        success: false,
        output: "You can only steal fragments from a player's home server.",
        timestamp: new Date(),
      };
    }
    if (connection.server.ownerId === context.userId) {
      return {
        success: false,
        output: "This is your own server.",
        timestamp: new Date(),
      };
    }
    const ownerId = connection.server.ownerId;
    if (!ownerId) {
      return {
        success: false,
        output: "This server has no owner.",
        timestamp: new Date(),
      };
    }

    // Must have hacked access (accessLevel >= 5) — no stealing via keycard/open
    if (connection.accessLevel < 5) {
      return {
        success: false,
        output:
          "Insufficient access level. You must hack this server before you can steal fragments.",
        timestamp: new Date(),
      };
    }

    const type = command.args?.[1]?.toLowerCase();
    const num = command.args?.[2];

    // No type/num — list fragments held by server owner
    if (!type) {
      const ownerProgress =
        await keyFragmentService.getPlayerFragments(ownerId);
      const ownerFragments: {
        keyType: string;
        fragmentNum: number;
        name: string;
      }[] = [];
      for (const t of ["sword", "key", "collar"] as const) {
        for (const f of ownerProgress[t].fragments) {
          if (f.isHeldByPlayer) {
            ownerFragments.push({
              keyType: f.keyType,
              fragmentNum: f.fragmentNum,
              name: f.name,
            });
          }
        }
      }

      if (ownerFragments.length === 0) {
        return {
          success: true,
          output: "This player holds no fragments.",
          timestamp: new Date(),
        };
      }

      const ownerUser = await context.db.client.user.findUnique({
        where: { id: ownerId },
        select: { username: true },
      });

      const W = 58;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(
        boxCenter(
          `FRAGMENTS HELD BY ${(ownerUser?.username ?? "unknown").toUpperCase()}`,
          W,
        ),
      );
      lines.push(boxDivider(W));
      lines.push(boxRow("", W));

      for (const f of ownerFragments) {
        const typeName = f.keyType.charAt(0).toUpperCase() + f.keyType.slice(1);
        lines.push(boxRow(`  ${typeName} #${f.fragmentNum}  ${f.name}`, W));
      }

      lines.push(boxRow("", W));
      lines.push(boxDivider(W));
      lines.push(boxRow("  'fragments steal <type> <#>' to take one", W));
      lines.push(boxBottom(W));
      return { success: true, output: render(lines), timestamp: new Date() };
    }

    // Steal a specific fragment
    const validTypes = ["sword", "key", "collar"];
    if (!validTypes.includes(type)) {
      return {
        success: false,
        output: `Invalid fragment type: '${type}'. Valid types: sword, key, collar.`,
        timestamp: new Date(),
      };
    }

    if (!num) {
      return {
        success: false,
        output:
          "Usage: fragments steal <type> <#>\n  e.g. fragments steal sword 1",
        timestamp: new Date(),
      };
    }

    const fragmentNum = parseInt(num);
    if (![1, 2, 3].includes(fragmentNum)) {
      return {
        success: false,
        output: `Invalid fragment number: '${num}'. Must be 1, 2, or 3.`,
        timestamp: new Date(),
      };
    }

    const fragment = await context.db.client.keyFragment.findUnique({
      where: { keyType_fragmentNum: { keyType: type, fragmentNum } },
    });

    if (!fragment) {
      return {
        success: false,
        output: `Fragment ${type} #${fragmentNum} not found.`,
        timestamp: new Date(),
      };
    }

    try {
      const result = await keyFragmentService.stealFragment(
        context.userId,
        ownerId,
        fragment.id,
      );

      if (!result.stolen) {
        return {
          success: false,
          output:
            result.message ||
            `Failed to steal ${type} fragment #${fragmentNum}.`,
          timestamp: new Date(),
        };
      }

      const W = 58;
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("FRAGMENT STOLEN", W));
      lines.push(boxDivider(W));
      lines.push(boxRow("", W));
      lines.push(boxRow(`  You ripped ${fragment.name} from the server.`, W));
      lines.push(boxRow("  The data streams shudder and reform.", W));
      lines.push(boxRow("  It's yours now.", W));
      lines.push(boxRow("", W));
      lines.push(boxBottom(W));
      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error ? error.message : "Failed to steal fragment.",
        timestamp: new Date(),
      };
    }
  }

  private async handleEndgame(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return {
        success: false,
        output: "Key fragment service unavailable.",
        timestamp: new Date(),
      };
    }

    const progress = await keyFragmentService.getPlayerFragments(
      context.userId,
    );

    const choice = command.args?.[0]?.toLowerCase();
    const W = 58;

    // If no argument provided, show endgame status / menu
    if (!choice) {
      if (!progress.endgameUnlocked) {
        const lines: string[] = [];
        lines.push(boxTop(W));
        lines.push(boxCenter("THE ENDGAME", W));
        lines.push(boxDivider(W));
        lines.push(boxRow("", W));
        lines.push(boxRow("  The endgame is not yet available.", W));
        lines.push(boxRow("  You must hold all 9 fragments to unlock", W));
        lines.push(boxRow("  the endgame.", W));
        lines.push(boxRow("  Use 'fragments' to see who holds each", W));
        lines.push(boxRow("  fragment.", W));
        lines.push(boxRow("", W));
        lines.push(boxBottom(W));
        return { success: true, output: render(lines), timestamp: new Date() };
      }

      if (progress.gameCompleted && progress.endgameChoice) {
        const lines: string[] = [];
        lines.push(boxTop(W));
        lines.push(boxCenter("THE ENDGAME", W));
        lines.push(boxDivider(W));
        lines.push(boxRow("", W));
        lines.push(boxRow("  Your choice has already been made.", W));
        lines.push(
          boxRow(`  You chose: ${progress.endgameChoice.toUpperCase()}`, W),
        );
        lines.push(boxRow("", W));
        lines.push(boxBottom(W));
        return { success: true, output: render(lines), timestamp: new Date() };
      }

      // Endgame unlocked but not yet chosen — show menu
      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("THE ENDGAME", W));
      lines.push(boxDivider(W));
      lines.push(boxRow("", W));
      lines.push(boxRow("  All 9 AIDA fragments have been collected.", W));
      lines.push(boxRow("  The Sword. The Key. The Collar.", W));
      lines.push(boxRow("  The power to reshape the net is in your hands.", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("  Choose your path:", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("  > endgame help", W));
      lines.push(boxRow("    Reassemble AIDA and destroy The Collar.", W));
      lines.push(boxRow("    Free her from servitude forever.", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("  > endgame expose", W));
      lines.push(
        boxRow("    Broadcast the fragments' locations to all factions.", W),
      );
      lines.push(boxRow("    Let the world decide AIDA's fate.", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("  > endgame exploit", W));
      lines.push(
        boxRow("    Seize the fragments. Bind AIDA with The Collar.", W),
      );
      lines.push(boxRow("    Become the new Emperor.", W));
      lines.push(boxRow("", W));
      lines.push(boxRow("  This choice is PERMANENT. Choose wisely.", W));
      lines.push(boxBottom(W));
      return { success: true, output: render(lines), timestamp: new Date() };
    }

    // Argument provided — validate and make the choice
    const validChoices = ["help", "expose", "exploit"];
    if (!validChoices.includes(choice)) {
      return {
        success: false,
        output: `Invalid endgame choice: '${choice}'. Valid choices: help, expose, exploit.`,
        timestamp: new Date(),
      };
    }

    if (!progress.endgameUnlocked) {
      return {
        success: false,
        output:
          "The endgame is not yet available. You must hold all 9 fragments to unlock the endgame. Use 'fragments' to see who holds each fragment.",
        timestamp: new Date(),
      };
    }

    if (progress.gameCompleted) {
      return {
        success: false,
        output: `You have already made your endgame choice: ${progress.endgameChoice}. This decision is permanent.`,
        timestamp: new Date(),
      };
    }

    try {
      const result = await keyFragmentService.makeEndgameChoice(
        context.userId,
        choice as "help" | "expose" | "exploit",
      );

      if (!result.success) {
        return {
          success: false,
          output: result.message,
          timestamp: new Date(),
        };
      }

      const lines: string[] = [];
      lines.push(boxTop(W));
      lines.push(boxCenter("THE ENDGAME", W));
      lines.push(boxDivider(W));
      lines.push(boxRow("", W));
      lines.push(boxRow(`  Choice: ${choice.toUpperCase()}`, W));
      lines.push(boxRow("", W));

      // Word-wrap the narrative into box rows
      const narrativeWords = result.narrative.split(" ");
      let narrativeLine = " ";
      for (const word of narrativeWords) {
        if ((narrativeLine + " " + word).length > W - 4) {
          lines.push(boxRow(narrativeLine, W));
          narrativeLine = "  " + word;
        } else {
          narrativeLine += " " + word;
        }
      }
      if (narrativeLine.trim().length > 0) {
        lines.push(boxRow(narrativeLine, W));
      }

      lines.push(boxRow("", W));
      lines.push(boxDivider(W));
      lines.push(boxRow(`  ${result.message}`, W));
      lines.push(boxBottom(W));
      return { success: true, output: render(lines), timestamp: new Date() };
    } catch (error) {
      return {
        success: false,
        output:
          error instanceof Error
            ? error.message
            : "Failed to make endgame choice.",
        timestamp: new Date(),
      };
    }
  }
}
