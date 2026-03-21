import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
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
  sBoxDivider,
  sBoxRow,
  sBoxCenter,
  panel,
  multiPanel,
  pad,
  padRight,
  progressBar,
  render,
} from "./asciiBox";

export class GameCommandsModule implements CommandModule {
  public commands: Set<string> = new Set([
    "status",
    "skills",
    "missions",
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
        description: "List available missions",
        usage: "missions",
        examples: ["missions"],
      },
      {
        command: "accept",
        category: "game",
        description: "Accept a mission",
        usage: "accept <mission_id>",
        examples: ["accept mission_001"],
      },
      {
        command: "abandon",
        category: "game",
        description: "Abandon a mission",
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
        command: "share_intel",
        category: "game",
        description: "Share discovered intel with your faction",
        usage: "share_intel <server|file|player> <id>",
        examples: [
          "share_intel server srv_abc123",
          "share_intel file file_xyz789",
          "share_intel player user_456",
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

    const factionRows =
      standings.length > 0
        ? standings.map((s) => ({
            label: pad(s.factionName + ":", 20),
            value: `${s.reputation}${s.isAllied ? " (Allied)" : s.isHostile ? " (Hostile)" : ""}`,
          }))
        : [{ label: "", value: "No faction standings yet." }];

    const output = render(
      multiPanel(
        "PLAYER STATUS",
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

  private async handleMissions(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const missionService = context.services.missionService;
    const missionGenerator = context.services.missionGenerator;

    let missions = await missionService.getPlayerMissions(context.userId);

    // Auto-generate missions if list is empty
    if (missions.length === 0 && missionGenerator) {
      try {
        await missionGenerator.generateMissionsForPlayer(context.userId, 5);
        missions = await missionService.getPlayerMissions(context.userId);
      } catch (error) {
        // Silent fail - just show empty list
      }
    }

    return {
      success: true,
      output: this.formatMissionList(missions),
      data: missions,
      timestamp: new Date(),
    };
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
      await missionService.acceptMission(context.userId, missionId);

      // Fetch the mission details to give the player useful feedback
      const missions = await missionService.getPlayerMissions(
        context.userId,
        "active",
      );
      const accepted = missions.find(
        (m: any) => m.missionId === missionId,
      ) as any;

      const lines: string[] = [];
      lines.push(`Mission accepted: ${accepted?.title || missionId}`);
      if (accepted?.difficulty) {
        lines.push(
          `Difficulty: ${"★".repeat(Math.min(accepted.difficulty, 10))}${"☆".repeat(Math.max(0, 10 - accepted.difficulty))}`,
        );
      }
      if (accepted?.expiresAt) {
        const remaining = new Date(accepted.expiresAt).getTime() - Date.now();
        const hours = Math.floor(remaining / (1000 * 60 * 60));
        const mins = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
        lines.push(`Time limit: ${hours}h ${mins}m`);
      }
      if (accepted?.objectives && Array.isArray(accepted.objectives)) {
        lines.push("");
        lines.push("Objectives:");
        for (const obj of accepted.objectives) {
          const target =
            typeof obj.target === "number" ? `0/${obj.target}` : "incomplete";
          lines.push(`  [ ] ${obj.description || obj.type} (${target})`);
        }
      }
      lines.push("");
      lines.push("Use 'progress' to track objective completion.");

      return {
        success: true,
        output: lines.join("\n"),
        timestamp: new Date(),
      };
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

    // Fetch mission details before abandoning so we can show what was dropped
    try {
      const missions = await missionService.getPlayerMissions(context.userId);
      const target = missions.find(
        (m: any) => m.missionId === missionId,
      ) as any;
      const title = target?.title || missionId;

      await missionService.abandonMission(context.userId, missionId);

      const lines: string[] = [];
      lines.push(`Mission abandoned: ${title}`);
      lines.push("Warning: Abandoning missions may affect faction reputation.");

      return {
        success: true,
        output: lines.join("\n"),
        timestamp: new Date(),
      };
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

    return {
      success: true,
      output: this.formatMissionProgress(missions),
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

    const output = presenceService.formatOnlinePlayersList();
    const players = presenceService.getOnlinePlayers();

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
      multiPanel(`PLAYER INFO: ${details.username}`, sections, 44),
    );

    return {
      success: true,
      output,
      data: details,
      timestamp: new Date(),
    };
  }

  // Helper methods
  private formatMissionList(missions: any[]): string {
    if (!missions || missions.length === 0) {
      return "No missions available";
    }

    const W = 44;
    const lines: string[] = [];

    lines.push(sBoxTop(W));
    lines.push(sBoxCenter("MISSIONS", W));
    lines.push(sBoxDivider(W));

    missions.forEach((mission: any) => {
      lines.push(sBoxRow(`[${mission.id}] ${mission.title}`, W));
      lines.push(sBoxRow(`  Status: ${mission.status}`, W));
      lines.push(sBoxRow(`  Difficulty: ${mission.difficulty}`, W));

      if (mission.reward) {
        lines.push(
          sBoxRow(
            `  Reward: ${mission.reward.credits}¢, ${mission.reward.experience} XP`,
            W,
          ),
        );
      }

      if (mission.expiresAt) {
        const expires = new Date(mission.expiresAt);
        lines.push(sBoxRow(`  Expires: ${expires.toLocaleString()}`, W));
      }

      lines.push(sBoxRow("", W));
    });

    lines.push(sBoxBottom(W));

    return render(lines);
  }

  private formatMissionProgress(missions: any[]): string {
    if (!missions || missions.length === 0) {
      return "No active missions";
    }

    const W = 44;
    const lines: string[] = [];

    lines.push(sBoxTop(W));
    lines.push(sBoxCenter("MISSION PROGRESS", W));
    lines.push(sBoxDivider(W));

    missions.forEach((mission: any) => {
      lines.push(sBoxRow(mission.title, W));

      if (mission.objectives && mission.objectives.length > 0) {
        lines.push(sBoxRow("Objectives:", W));
        mission.objectives.forEach((obj: any) => {
          const status = obj.completed ? "[x]" : "[ ]";
          const progress =
            obj.current && obj.target ? ` (${obj.current}/${obj.target})` : "";
          lines.push(sBoxRow(`  ${status} ${obj.description}${progress}`, W));
        });
      }

      lines.push(sBoxRow("", W));
    });

    lines.push(sBoxBottom(W));

    return render(lines);
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

    // Verify the asset exists
    let assetMeta: Record<string, unknown> = {};
    if (assetType === "server") {
      const server = await context.db.client.gameServer.findUnique({
        where: { id: assetId },
        select: { id: true, name: true, ipAddress: true, type: true, securityLevel: true, ownerId: true },
      });
      if (!server) {
        return { success: false, output: `Server not found: ${assetId}`, timestamp: new Date() };
      }
      assetMeta = { name: server.name, ip: server.ipAddress, serverType: server.type, securityLevel: server.securityLevel, ownerId: server.ownerId };
    } else if (assetType === "file") {
      const file = await context.db.client.fileSystemNode.findUnique({
        where: { id: assetId },
        select: { id: true, name: true, serverId: true, type: true, isHidden: true, isEncrypted: true },
      });
      if (!file) {
        return { success: false, output: `File not found: ${assetId}`, timestamp: new Date() };
      }
      assetMeta = { name: file.name, serverId: file.serverId, isHidden: file.isHidden, isEncrypted: file.isEncrypted };
    } else if (assetType === "player") {
      const player = await context.db.client.user.findUnique({
        where: { id: assetId },
        select: { id: true, username: true },
      });
      if (!player) {
        return { success: false, output: `Player not found: ${assetId}`, timestamp: new Date() };
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
}
