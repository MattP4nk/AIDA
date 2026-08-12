import { Command, CommandResult } from "../../../../shared/types";
import { CommandModule, CommandContext } from "./interface";
import { successResult, errorResult } from "./helpers";
import type { ShopItem } from "../shopService";
import type { InventoryItem } from "../shopService";
import {
  boxTop,
  boxBottom,
  boxDivider,
  boxRow,
  boxCenter,
  boxLine,
  multiPanel,
  render,
} from "./asciiBox";

export class ShopCommandsModule implements CommandModule {
  public category = "shop";
  public commands: Set<string> = new Set([
    "shop",
    "buy",
    "sell",
    "use",
    "equip",
    "unequip",
    "equipment",
    "gear",
    "scripts",
  ]);

  public async execute(
    command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    try {
      switch (command.command) {
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
        default:
          return errorResult(`Shop command not implemented: ${command.command}`);
      }
    } catch (error) {
      return errorResult("Shop command failed", error instanceof Error ? error.message : "Unknown error");
    }
  }

  public getCommandInfo(): import("./interface").CommandInfo[] {
    return [
      {
        command: "scripts",
        category: "shop",
        description: "Show player inventory/scripts",
        usage: "scripts",
        examples: ["scripts"],
      },
      {
        command: "shop",
        category: "shop",
        description: "Browse the darknet marketplace",
        usage: "shop [category] [search]",
        examples: ["shop", "shop EXPLOIT", "shop exploit scanner"],
      },
      {
        command: "buy",
        category: "shop",
        description: "Purchase an item from the shop",
        usage: "buy <item_id> [quantity]",
        examples: ["buy port_scanner", "buy firewall 2"],
      },
      {
        command: "sell",
        category: "shop",
        description: "Sell an item from inventory",
        usage: "sell <item_id> [quantity]",
        examples: ["sell old_script", "sell exploit_v1 3"],
      },
      {
        command: "use",
        category: "shop",
        description: "Use an item from inventory",
        usage: "use <item_id>",
        examples: ["use health_pack", "use skill_boost"],
      },
      {
        command: "equip",
        category: "shop",
        description: "Equip an item from your inventory",
        usage: "equip <item_id>",
        examples: ["equip port_scanner", "equip stealth_module"],
      },
      {
        command: "unequip",
        category: "shop",
        description: "Unequip an item from a slot",
        usage: "unequip <slot|item_id>",
        examples: ["unequip TOOL", "unequip port_scanner"],
      },
      {
        command: "equipment",
        category: "shop",
        description: "Show currently equipped items and bonuses",
        usage: "equipment",
        examples: ["equipment", "gear"],
      },
      {
        command: "gear",
        category: "shop",
        description: "View your equipped items (alias for equipment)",
        usage: "gear",
        examples: ["gear"],
      },
    ];
  }

  private async handleInventory(
    _command: Command,
    context: CommandContext,
  ): Promise<CommandResult> {
    const shopService = context.services.shopService;
    const inventory = await shopService.getPlayerInventory(context.userId);
    const bonuses = await shopService.getPlayerBonuses(context.userId);

    if (inventory.length === 0) {
      return successResult("Your scripts folder is empty. Type 'shop' to browse items.");
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
      return errorResult("Player progress not found");
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
      return successResult("No items found matching your criteria.");
    }

    const W = context.terminalWidth;
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
      return errorResult("Usage: buy <item_id> [quantity]");
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
      return errorResult("Usage: sell <item_id> [quantity]");
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
      return errorResult("Usage: use <item_id>");
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
      return errorResult("Usage: equip <item_id>\nExample: equip port_scanner");
    }

    const shopService = context.services.shopService;
    const inventoryService = context.services.inventoryService;

    // Get the item from catalog
    const item = shopService.getItem(itemId);
    if (!item) {
      return errorResult(`Item not found: ${itemId}`);
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
      return errorResult("Usage: unequip <slot|item_id>\nSlots: TOOL, SOFTWARE, EXPLOIT, DEFENSE, UPGRADE");
    }

    const inventoryService = context.services.inventoryService;

    // Check if arg is a valid slot name
    const validSlots = ["TOOL", "SOFTWARE", "EXPLOIT", "DEFENSE", "UPGRADE"];
    if (validSlots.includes(arg.toUpperCase())) {
      const result = await inventoryService.unequipItem(
        context.userId,
        arg.toUpperCase() as import("../inventoryService").EquipmentSlot,
      );
      return result.success ? successResult(result.message) : errorResult(result.message);
    }

    // Otherwise treat it as an item ID
    const result = await inventoryService.unequipItemById(context.userId, arg);
    return result.success ? successResult(result.message) : errorResult(result.message);
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
}
