import { EventEmitter } from "events";
import { prisma } from "../database/client";

/**
 * Tool/Software Item Interface
 */
export interface ShopItem {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  price: number;
  requiredLevel: number;
  requiredSkills?: { [key: string]: number };
  effects?: ItemEffects;
  rarity: ItemRarity;
  isConsumable: boolean;
  maxStack: number;
}

/**
 * Item categories
 */
export enum ItemCategory {
  TOOL = "TOOL",
  SOFTWARE = "SOFTWARE",
  EXPLOIT = "EXPLOIT",
  DEFENSE = "DEFENSE",
  UPGRADE = "UPGRADE",
  CONSUMABLE = "CONSUMABLE",
  MISC = "MISC",
}

/**
 * Item rarity levels
 */
export enum ItemRarity {
  COMMON = "COMMON",
  UNCOMMON = "UNCOMMON",
  RARE = "RARE",
  EPIC = "EPIC",
  LEGENDARY = "LEGENDARY",
}

/**
 * Item effects on player stats
 */
export interface ItemEffects {
  hackingBonus?: number;
  stealthBonus?: number;
  speedBonus?: number;
  detectionReduction?: number;
  successRateIncrease?: number;
  xpMultiplier?: number;
  creditsMultiplier?: number;
}

/**
 * Inventory item with quantity
 */
export interface InventoryItem {
  itemId: string;
  item: ShopItem;
  quantity: number;
  acquiredAt: Date;
}

/**
 * Purchase result
 */
export interface PurchaseResult {
  success: boolean;
  message: string;
  item?: ShopItem;
  remainingCredits?: number;
  transactionId?: string;
}

/**
 * Shop catalog organized by categories
 */
const SHOP_CATALOG: ShopItem[] = [
  // ==================== BASIC TOOLS ====================
  {
    id: "basic_scanner",
    name: "Port Scanner",
    description:
      "Basic network port scanning tool. Reveals open ports on target systems.",
    category: ItemCategory.TOOL,
    price: 100,
    requiredLevel: 1,
    effects: {
      hackingBonus: 5,
    },
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "password_cracker",
    name: "Password Cracker",
    description:
      "Brute-force password cracking utility. Increases success rate on password-protected systems.",
    category: ItemCategory.TOOL,
    price: 250,
    requiredLevel: 2,
    effects: {
      hackingBonus: 10,
      successRateIncrease: 0.05,
    },
    rarity: ItemRarity.COMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "proxy_chains",
    name: "Proxy Chains",
    description:
      "Route your connection through multiple proxies. Reduces detection probability.",
    category: ItemCategory.TOOL,
    price: 500,
    requiredLevel: 3,
    effects: {
      stealthBonus: 15,
      detectionReduction: 0.1,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "log_cleaner",
    name: "Log Cleaner",
    description:
      "Removes traces of your activities from system logs. Essential for stealth operations.",
    category: ItemCategory.TOOL,
    price: 750,
    requiredLevel: 4,
    effects: {
      stealthBonus: 20,
      detectionReduction: 0.15,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== INTERMEDIATE SOFTWARE ====================
  {
    id: "exploit_framework",
    name: "Exploit Framework",
    description:
      "Comprehensive exploitation toolkit. Automates discovery and exploitation of vulnerabilities.",
    category: ItemCategory.SOFTWARE,
    price: 1500,
    requiredLevel: 5,
    requiredSkills: { hacking: 30 },
    effects: {
      hackingBonus: 25,
      successRateIncrease: 0.1,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "rootkit",
    name: "Advanced Rootkit",
    description:
      "Maintain persistent access to compromised systems. Grants backdoor access.",
    category: ItemCategory.SOFTWARE,
    price: 2000,
    requiredLevel: 6,
    requiredSkills: { hacking: 40 },
    effects: {
      hackingBonus: 30,
      stealthBonus: 25,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "firewall_bypass",
    name: "Firewall Bypass Kit",
    description: "Circumvent firewall protections on hardened systems.",
    category: ItemCategory.SOFTWARE,
    price: 1200,
    requiredLevel: 5,
    effects: {
      hackingBonus: 20,
      successRateIncrease: 0.08,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== ADVANCED EXPLOITS ====================
  {
    id: "zero_day_exploit",
    name: "Zero-Day Exploit",
    description:
      "Previously unknown vulnerability. Extremely effective but single-use.",
    category: ItemCategory.EXPLOIT,
    price: 5000,
    requiredLevel: 8,
    requiredSkills: { hacking: 60 },
    effects: {
      hackingBonus: 50,
      successRateIncrease: 0.3,
    },
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 3,
  },
  {
    id: "quantum_decryptor",
    name: "Quantum Decryptor",
    description:
      "Break even the strongest encryption. Legendary tool for elite hackers.",
    category: ItemCategory.EXPLOIT,
    price: 10000,
    requiredLevel: 10,
    requiredSkills: { hacking: 80, stealth: 60 },
    effects: {
      hackingBonus: 60,
      successRateIncrease: 0.25,
      speedBonus: 30,
    },
    rarity: ItemRarity.LEGENDARY,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== CONSUMABLES ====================
  {
    id: "quantum_charge",
    name: "Quantum Decryptor Charge",
    description:
      "Single-use quantum decryption charge. Bypasses PROTECTED file encryption instantly. No minigame required.",
    category: ItemCategory.EXPLOIT,
    price: 7500,
    requiredLevel: 8,
    requiredSkills: { cryptography: 50 },
    effects: {},
    rarity: ItemRarity.EPIC,
    isConsumable: true,
    maxStack: 3,
  },

  // ==================== DEFENSE TOOLS ====================
  {
    id: "ids_blocker",
    name: "IDS Blocker",
    description:
      "Prevents Intrusion Detection Systems from flagging your activities.",
    category: ItemCategory.DEFENSE,
    price: 800,
    requiredLevel: 4,
    effects: {
      stealthBonus: 15,
      detectionReduction: 0.12,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "trace_scrambler",
    name: "Trace Scrambler",
    description:
      "Scrambles your digital footprint, making it nearly impossible to trace.",
    category: ItemCategory.DEFENSE,
    price: 1800,
    requiredLevel: 6,
    effects: {
      stealthBonus: 30,
      detectionReduction: 0.2,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== UPGRADES ====================
  {
    id: "cpu_upgrade",
    name: "Overclocked CPU",
    description: "Increases processing speed for faster hack execution.",
    category: ItemCategory.UPGRADE,
    price: 2500,
    requiredLevel: 7,
    effects: {
      speedBonus: 25,
      hackingBonus: 15,
    },
    rarity: ItemRarity.RARE,
    isConsumable: false,
    maxStack: 1,
  },
  {
    id: "neural_interface",
    name: "Neural Interface Upgrade",
    description: "Enhances your connection to the net. Improves all abilities.",
    category: ItemCategory.UPGRADE,
    price: 8000,
    requiredLevel: 9,
    requiredSkills: { hacking: 70 },
    effects: {
      hackingBonus: 40,
      stealthBonus: 40,
      speedBonus: 40,
      xpMultiplier: 1.5,
    },
    rarity: ItemRarity.EPIC,
    isConsumable: false,
    maxStack: 1,
  },

  // ==================== CONSUMABLES ====================
  {
    id: "stealth_boost",
    name: "Stealth Boost",
    description: "Temporary increase to stealth rating. Single-call script.",
    category: ItemCategory.CONSUMABLE,
    price: 300,
    requiredLevel: 3,
    effects: {
      stealthBonus: 20,
      detectionReduction: 0.15,
    },
    rarity: ItemRarity.COMMON,
    isConsumable: true,
    maxStack: 10,
  },
  {
    id: "xp_booster",
    name: "XP Booster",
    description: "Doubles XP gain for the next 5 successful hacks.",
    category: ItemCategory.CONSUMABLE,
    price: 500,
    requiredLevel: 2,
    effects: {
      xpMultiplier: 2.0,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: true,
    maxStack: 5,
  },
  {
    id: "credit_multiplier",
    name: "Credit Multiplier",
    description:
      "Increases credits gained from missions by 50% (next 3 missions).",
    category: ItemCategory.CONSUMABLE,
    price: 800,
    requiredLevel: 4,
    effects: {
      creditsMultiplier: 1.5,
    },
    rarity: ItemRarity.UNCOMMON,
    isConsumable: true,
    maxStack: 5,
  },

  // ==================== MISC ====================
  {
    id: "data_backup",
    name: "Data Backup Kit",
    description: "Protects your data from being wiped if you get caught.",
    category: ItemCategory.MISC,
    price: 600,
    requiredLevel: 3,
    effects: {},
    rarity: ItemRarity.COMMON,
    isConsumable: true,
    maxStack: 3,
  },
];

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, MISSION_INTEGRATION_SERVICE } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";

/**
 * ShopService - Manages shop, inventory, and economy
 */
@injectable()
class ShopService extends EventEmitter {
  private catalog: Map<string, ShopItem>;
  private missionIntegration: MissionIntegrationService | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
  ) {
    super();
    this.missionIntegration = missionIntegrationService || null;
    this.catalog = new Map();
    this.initializeCatalog();
    this.logger.info(
      { itemCount: this.catalog.size },
      "Shop Service initialized",
    );
  }

  /**
   * Initialize shop catalog
   */
  private initializeCatalog(): void {
    SHOP_CATALOG.forEach((item) => {
      this.catalog.set(item.id, item);
    });
  }

  // ==================== SHOP BROWSING ====================

  /**
   * Get all items in shop
   */
  public getAllItems(): ShopItem[] {
    return Array.from(this.catalog.values());
  }

  /**
   * Get items by category
   */
  public getItemsByCategory(category: ItemCategory): ShopItem[] {
    return Array.from(this.catalog.values()).filter(
      (item) => item.category === category,
    );
  }

  /**
   * Get items by rarity
   */
  public getItemsByRarity(rarity: ItemRarity): ShopItem[] {
    return Array.from(this.catalog.values()).filter(
      (item) => item.rarity === rarity,
    );
  }

  /**
   * Get items available for player level
   */
  public getItemsForLevel(level: number): ShopItem[] {
    return Array.from(this.catalog.values()).filter(
      (item) => item.requiredLevel <= level,
    );
  }

  /**
   * Get specific item by ID
   */
  public getItem(itemId: string): ShopItem | undefined {
    return this.catalog.get(itemId);
  }

  /**
   * Search items by name or description
   */
  public searchItems(query: string): ShopItem[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.catalog.values()).filter(
      (item) =>
        item.name.toLowerCase().includes(lowerQuery) ||
        item.description.toLowerCase().includes(lowerQuery),
    );
  }

  // ==================== INVENTORY MANAGEMENT ====================

  /**
   * Get player inventory from InventoryItem table.
   */
  public async getPlayerInventory(userId: string): Promise<InventoryItem[]> {
    const dbItems = await prisma.inventoryItem.findMany({
      where: { userId },
      include: { shopItem: true },
      orderBy: { acquiredAt: "desc" },
    });

    return dbItems
      .map((row) => {
        const catalogItem = this.catalog.get(row.shopItemId);
        if (!catalogItem) return null;
        return {
          itemId: row.shopItemId,
          item: catalogItem,
          quantity: row.quantity,
          acquiredAt: row.acquiredAt,
        };
      })
      .filter((x): x is InventoryItem => x !== null);
  }

  /**
   * Check if player has item in InventoryItem table.
   */
  public async hasItem(userId: string, itemId: string): Promise<boolean> {
    const row = await prisma.inventoryItem.findFirst({
      where: { userId, shopItemId: itemId, quantity: { gt: 0 } },
    });
    return !!row;
  }

  /**
   * Get item quantity from InventoryItem table.
   */
  public async getItemQuantity(
    userId: string,
    itemId: string,
  ): Promise<number> {
    const row = await prisma.inventoryItem.findFirst({
      where: { userId, shopItemId: itemId },
    });
    return row?.quantity ?? 0;
  }

  /**
   * Add item to inventory via InventoryItem table (upsert).
   */
  public async addItemToInventory(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<boolean> {
    try {
      const item = this.catalog.get(itemId);
      if (!item) return false;

      const existing = await prisma.inventoryItem.findFirst({
        where: { userId, shopItemId: itemId },
      });

      if (existing) {
        const newQty = Math.min(existing.quantity + quantity, item.maxStack);
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: newQty },
        });
      } else {
        await prisma.inventoryItem.create({
          data: {
            userId,
            shopItemId: itemId,
            quantity: Math.min(quantity, item.maxStack),
            source: "shop",
          },
        });
      }

      this.emit("item:added", { userId, itemId, quantity });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Error adding item to inventory");
      return false;
    }
  }

  /**
   * Remove item from inventory via InventoryItem table.
   */
  public async removeItemFromInventory(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<boolean> {
    try {
      const existing = await prisma.inventoryItem.findFirst({
        where: { userId, shopItemId: itemId },
      });

      if (!existing) return false;

      if (existing.quantity <= quantity) {
        await prisma.inventoryItem.delete({ where: { id: existing.id } });
      } else {
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: { decrement: quantity } },
        });
      }

      this.emit("item:removed", { userId, itemId, quantity });
      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Error removing item from inventory");
      return false;
    }
  }

  // ==================== PURCHASE SYSTEM ====================

  /**
   * Purchase item from shop
   */
  public async purchaseItem(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<PurchaseResult> {
    try {
      // Get item from catalog
      const item = this.catalog.get(itemId);
      if (!item) {
        return {
          success: false,
          message: "Script not found in store catalog",
        };
      }

      // Get player progress
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          message: "Player progress not found",
        };
      }

      // Check level requirement
      if (progress.level < item.requiredLevel) {
        return {
          success: false,
          message: `Requires level ${item.requiredLevel}. Current level: ${progress.level}`,
        };
      }

      // Check skill requirements
      if (item.requiredSkills) {
        for (const [skill, required] of Object.entries(item.requiredSkills)) {
          // Map skill names to progress fields
          const skillMap: Record<string, keyof typeof progress> = {
            hacking: "hacking",
            networking: "networking",
            cryptography: "cryptography",
            stealth: "stealth",
            socialEng: "socialEng",
            forensics: "forensics",
          };
          const skillField = skillMap[skill];
          const current = skillField ? (progress[skillField] as number) : 0;
          if (current < required) {
            return {
              success: false,
              message: `Requires ${skill}: ${required}. Current: ${current}`,
            };
          }
        }
      }

      // Check if can stack
      if (!item.isConsumable || item.maxStack === 1) {
        const hasItem = await this.hasItem(userId, itemId);
        if (hasItem) {
          return {
            success: false,
            message: "You already own this item",
          };
        }
      }

      // Calculate total cost
      const totalCost = item.price * quantity;

      // Check credits
      if (progress.credits < totalCost) {
        return {
          success: false,
          message: `Insufficient credits. Need ${totalCost}, have ${progress.credits}`,
        };
      }

      // Check stack limit
      const currentQuantity = await this.getItemQuantity(userId, itemId);
      if (currentQuantity + quantity > item.maxStack) {
        return {
          success: false,
          message: `Cannot carry more than ${item.maxStack} of this item`,
        };
      }

      // Atomic: deduct credits and add item in a single transaction
      const newCredits = progress.credits - totalCost;

      await prisma.$transaction(async (tx) => {
        // Re-check credits inside transaction to prevent race conditions
        const freshProgress = await tx.playerProgress.findUnique({
          where: { userId },
          select: { credits: true },
        });
        if (!freshProgress || freshProgress.credits < totalCost) {
          throw new Error("Insufficient credits (concurrent purchase detected)");
        }

        await tx.playerProgress.update({
          where: { userId },
          data: { credits: { decrement: totalCost } },
        });

        // Upsert inventory item
        const existing = await tx.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId },
        });
        if (existing) {
          await tx.inventoryItem.update({
            where: { id: existing.id },
            data: { quantity: { increment: quantity } },
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              userId,
              shopItemId: itemId,
              quantity,
              source: "shop",
            },
          });
        }
      });

      // Track credit spending for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onCreditsTransaction(userId, totalCost, "spent")
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onCreditsTransaction error",
            ),
          );
      }

      // Create transaction record
      const transactionId = `txn_${Date.now()}_${userId.slice(0, 8)}`;

      this.emit("purchase:complete", {
        userId,
        itemId,
        quantity,
        cost: totalCost,
        transactionId,
      });

      return {
        success: true,
        message: `Purchased ${quantity}x ${item.name} for ${totalCost} credits`,
        item,
        remainingCredits: newCredits,
        transactionId,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error purchasing item");
      return {
        success: false,
        message: "Purchase failed due to server error",
      };
    }
  }

  /**
   * Sell item back to shop (50% of original price)
   */
  public async sellItem(
    userId: string,
    itemId: string,
    quantity: number = 1,
  ): Promise<PurchaseResult> {
    try {
      const item = this.catalog.get(itemId);
      if (!item) {
        return {
          success: false,
          message: "Item not found",
        };
      }

      // Calculate sell price (50% of original)
      const sellPrice = Math.floor((item.price * quantity) / 2);

      // Atomic transaction: check quantity, check not equipped, remove item, add credits
      const result = await prisma.$transaction(async (tx) => {
        const invItem = await tx.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId },
        });

        if (!invItem || invItem.quantity < quantity) {
          return {
            success: false as const,
            message: `You only have ${invItem?.quantity ?? 0} of this item`,
          };
        }

        // Check item is not currently equipped
        if (invItem.isEquipped) {
          return {
            success: false as const,
            message: `Cannot sell: ${item.name} is currently equipped. Unequip it first.`,
          };
        }

        // Remove or decrement
        if (invItem.quantity <= quantity) {
          await tx.inventoryItem.delete({ where: { id: invItem.id } });
        } else {
          await tx.inventoryItem.update({
            where: { id: invItem.id },
            data: { quantity: { decrement: quantity } },
          });
        }

        // Add credits
        const progress = await tx.playerProgress.update({
          where: { userId },
          data: { credits: { increment: sellPrice } },
        });

        return { success: true as const, newCredits: progress.credits };
      });

      if (!result.success) {
        return {
          success: false,
          message: result.message,
        };
      }

      this.emit("item:sold", { userId, itemId, quantity, sellPrice });

      // Track credit earning for mission objectives
      if (this.missionIntegration) {
        this.missionIntegration
          .onCreditsTransaction(userId, sellPrice, "earned")
          .catch((err) =>
            this.logger.error(
              { err },
              "Mission integration onCreditsTransaction error",
            ),
          );
      }

      return {
        success: true,
        message: `Sold ${quantity}x ${item.name} for ${sellPrice} credits`,
        item,
        remainingCredits: result.newCredits,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error selling item");
      return {
        success: false,
        message: "Sale failed due to server error",
      };
    }
  }

  // ==================== ITEM USAGE ====================

  /**
   * Use item from inventory
   */
  public async useItem(
    userId: string,
    itemId: string,
  ): Promise<{ success: boolean; message: string; effects?: ItemEffects }> {
    try {
      const item = this.catalog.get(itemId);
      if (!item) {
        return { success: false, message: "Item not found" };
      }

      const hasItem = await this.hasItem(userId, itemId);
      if (!hasItem) {
        return { success: false, message: "You don't have this item" };
      }

      // Apply item effects (this would integrate with other systems)
      if (item.isConsumable) {
        await this.removeItemFromInventory(userId, itemId, 1);
      }

      this.emit("item:used", { userId, itemId, effects: item.effects });

      return {
        success: true,
        message: `Used ${item.name}`,
        ...(item.effects ? { effects: item.effects } : {}),
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error using item");
      return { success: false, message: "Failed to call script" };
    }
  }

  /**
   * Get total bonuses from equipped/owned items
   */
  public async getPlayerBonuses(userId: string): Promise<ItemEffects> {
    const inventory = await this.getPlayerInventory(userId);
    const totalEffects: ItemEffects = {
      hackingBonus: 0,
      stealthBonus: 0,
      speedBonus: 0,
      detectionReduction: 0,
      successRateIncrease: 0,
      xpMultiplier: 1.0,
      creditsMultiplier: 1.0,
    };

    inventory.forEach(({ item }) => {
      if (!item.isConsumable && item.effects) {
        totalEffects.hackingBonus =
          (totalEffects.hackingBonus || 0) + (item.effects.hackingBonus || 0);
        totalEffects.stealthBonus =
          (totalEffects.stealthBonus || 0) + (item.effects.stealthBonus || 0);
        totalEffects.speedBonus =
          (totalEffects.speedBonus || 0) + (item.effects.speedBonus || 0);
        totalEffects.detectionReduction =
          (totalEffects.detectionReduction || 0) +
          (item.effects.detectionReduction || 0);
        totalEffects.successRateIncrease =
          (totalEffects.successRateIncrease || 0) +
          (item.effects.successRateIncrease || 0);
      }
    });

    return totalEffects;
  }
}

export default ShopService;
