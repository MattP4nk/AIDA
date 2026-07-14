import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import logger from "../../logger";
import {
  boxTop,
  boxBottom,
  boxDivider,
  boxRow,
  boxCenter,
  sBoxTop,
  sBoxBottom,
  sBoxRow,
  progressBar,
  formatDuration,
  render,
} from "./asciiBox";
import { getObjectiveHint } from "../missionObjectiveTypes";

export class MissionCommandsModule implements CommandModule {
  // Per-player mission index: maps numeric shortcut (1-based) to full mission ID
  // Refreshed every time the `missions` command runs
  private missionIndex: Map<string, string[]> = new Map();

  public category = "mission";
  public commands: Set<string> = new Set([
    "missions",
    "mission",
    "accept",
    "abandon",
    "progress",
    "stories",
    "story",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
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
        case "stories":
          return await this.handleStories(command, context);
        case "story":
          return await this.handleStory(command, context);
        default:
          return {
            success: false,
            output: `Mission command not implemented: ${command.command}`,
            timestamp: new Date(),
          };
      }
    } catch (error) {
      return {
        success: false,
        output: "Mission command failed",
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date(),
      };
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "missions",
        category: "mission",
        description: "List available and active missions",
        usage: "missions [active|available|completed]",
        examples: ["missions", "missions active"],
      },
      {
        command: "mission",
        category: "mission",
        description: "View detailed mission information",
        usage: "mission <mission_id>",
        examples: ["mission abc123"],
      },
      {
        command: "accept",
        category: "mission",
        description: "Accept a mission and view briefing",
        usage: "accept <mission_id>",
        examples: ["accept mission_001"],
      },
      {
        command: "abandon",
        category: "mission",
        description: "Abandon a mission (reputation penalty warning)",
        usage: "abandon <mission_id>",
        examples: ["abandon mission_001"],
      },
      {
        command: "progress",
        category: "mission",
        description: "Show mission progress",
        usage: "progress",
        examples: ["progress"],
      },
      {
        command: "stories",
        category: "mission",
        description: "List your story arcs",
        usage: "stories",
        examples: ["stories"],
      },
      {
        command: "story",
        category: "mission",
        description: "View or manage a story arc",
        usage: "story <arc_id> | story abandon <arc_id>",
        examples: ["story abc123", "story abandon abc123"],
      },
    ];
  }

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
}
