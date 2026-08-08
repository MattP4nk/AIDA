import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { successResult, errorResult } from "./helpers";
import {
  boxTop,
  boxBottom,
  boxDivider,
  boxRow,
  boxCenter,
  render,
} from "./asciiBox";

export class FragmentCommandsModule implements CommandModule {
  public category = "fragment";
  public commands: Set<string> = new Set([
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
        case "fragment":
        case "fragments":
          return await this.handleFragments(command, context);
        case "endgame":
          return await this.handleEndgame(command, context);
        default:
          return errorResult(`Fragment command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("Fragment command failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "fragments",
        category: "fragment",
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
        category: "fragment",
        description: "Alias for 'fragments'",
        usage: "fragment [give <type> <#> <player> | steal [<type> <#>]]",
      },
      {
        command: "endgame",
        category: "fragment",
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

  private async handleFragments(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return errorResult("Key fragment service unavailable.");
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
      return errorResult("Key fragment service unavailable.");
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
    return successResult(render(lines));
  }

  private async handleFragmentGive(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return errorResult("Key fragment service unavailable.");
    }

    const type = command.args?.[1]?.toLowerCase();
    const num = command.args?.[2];
    const targetUsername = command.args?.[3];

    if (!type || !num || !targetUsername) {
      return errorResult("Usage: fragments give <type> <#> <player>\n  type: sword, key, collar\n  #: 1, 2, or 3");
    }

    const validTypes = ["sword", "key", "collar"];
    if (!validTypes.includes(type)) {
      return errorResult(`Invalid fragment type: '${type}'. Valid types: sword, key, collar.`);
    }

    const fragmentNum = parseInt(num);
    if (![1, 2, 3].includes(fragmentNum)) {
      return errorResult(`Invalid fragment number: '${num}'. Must be 1, 2, or 3.`);
    }

    const fragment = await context.db.client.keyFragment.findUnique({
      where: { keyType_fragmentNum: { keyType: type, fragmentNum } },
    });

    if (!fragment) {
      return errorResult(`Fragment ${type} #${fragmentNum} not found.`);
    }

    const targetUser = await context.db.client.user.findFirst({
      where: { username: { equals: targetUsername, mode: "insensitive" } },
    });

    if (!targetUser) {
      return errorResult(`Player not found: '${targetUsername}'.`);
    }

    if (targetUser.id === context.userId) {
      return errorResult("Cannot give a fragment to yourself.");
    }

    try {
      const result = await keyFragmentService.transferFragment(
        context.userId,
        targetUser.id,
        fragment.id,
      );

      if (!result.transferred) {
        return errorResult(result.message || `Failed to transfer ${type} fragment #${fragmentNum}.`);
      }

      const recipientProgress = await keyFragmentService.getPlayerFragments(
        targetUser.id,
      );

      return successResult(`You gave ${fragment.name} to ${targetUser.username}. They now hold ${recipientProgress.totalHeld}/${recipientProgress.totalRequired} fragments.`);
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : `Failed to transfer fragment.`);
    }
  }

  private async handleFragmentSteal(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return errorResult("Key fragment service unavailable.");
    }

    // Check current server connection
    const connection = await context.db.client.serverConnection.findFirst({
      where: { userId: context.userId, isActive: true },
      include: { server: true },
    });
    if (!connection || !connection.server) {
      return errorResult("Not connected to any server.");
    }
    if (!connection.server.isPlayerHome) {
      return errorResult("You can only steal fragments from a player's home server.");
    }
    if (connection.server.ownerId === context.userId) {
      return errorResult("This is your own server.");
    }
    const ownerId = connection.server.ownerId;
    if (!ownerId) {
      return errorResult("This server has no owner.");
    }

    // Must have hacked access (accessLevel >= 5) — no stealing via keycard/open
    if (connection.accessLevel < 5) {
      return errorResult("Insufficient access level. You must hack this server before you can steal fragments.");
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
        return successResult("This player holds no fragments.");
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
      return successResult(render(lines));
    }

    // Steal a specific fragment
    const validTypes = ["sword", "key", "collar"];
    if (!validTypes.includes(type)) {
      return errorResult(`Invalid fragment type: '${type}'. Valid types: sword, key, collar.`);
    }

    if (!num) {
      return errorResult("Usage: fragments steal <type> <#>\n  e.g. fragments steal sword 1");
    }

    const fragmentNum = parseInt(num);
    if (![1, 2, 3].includes(fragmentNum)) {
      return errorResult(`Invalid fragment number: '${num}'. Must be 1, 2, or 3.`);
    }

    const fragment = await context.db.client.keyFragment.findUnique({
      where: { keyType_fragmentNum: { keyType: type, fragmentNum } },
    });

    if (!fragment) {
      return errorResult(`Fragment ${type} #${fragmentNum} not found.`);
    }

    try {
      const result = await keyFragmentService.stealFragment(
        context.userId,
        ownerId,
        fragment.id,
      );

      if (!result.stolen) {
        return errorResult(result.message || `Failed to steal ${type} fragment #${fragmentNum}.`);
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
      return successResult(render(lines));
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "Failed to steal fragment.");
    }
  }

  private async handleEndgame(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const keyFragmentService = context.services.keyFragmentService;
    if (!keyFragmentService) {
      return errorResult("Key fragment service unavailable.");
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
        return successResult(render(lines));
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
        return successResult(render(lines));
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
      return successResult(render(lines));
    }

    // Argument provided — validate and make the choice
    const validChoices = ["help", "expose", "exploit"];
    if (!validChoices.includes(choice)) {
      return errorResult(`Invalid endgame choice: '${choice}'. Valid choices: help, expose, exploit.`);
    }

    if (!progress.endgameUnlocked) {
      return errorResult("The endgame is not yet available. You must hold all 9 fragments to unlock the endgame. Use 'fragments' to see who holds each fragment.");
    }

    if (progress.gameCompleted) {
      return errorResult(`You have already made your endgame choice: ${progress.endgameChoice}. This decision is permanent.`);
    }

    try {
      const result = await keyFragmentService.makeEndgameChoice(
        context.userId,
        choice as "help" | "expose" | "exploit",
      );

      if (!result.success) {
        return errorResult(result.message);
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
      return {
        success: true,
        output: render(lines),
        renderMode: "cinematic" as const,
        soundEvent: "levelUp" as const,
        timestamp: new Date(),
      };
    } catch (error) {
      return errorResult(error instanceof Error ? error.message : "Failed to make endgame choice.");
    }
  }
}
