import { injectable, inject } from "tsyringe";
import { prisma, Prisma } from "../database/client";
import { EventEmitter } from "events";
import { ShopItem, ItemCategory, ItemEffects } from "./shopService";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";

/**
 * Equipment slots based on item categories
 */
export enum EquipmentSlot {
  TOOL = "TOOL",
  SOFTWARE = "SOFTWARE",
  EXPLOIT = "EXPLOIT",
  DEFENSE = "DEFENSE",
  UPGRADE = "UPGRADE",
}

/**
 * Equipment state for a player
 */
export interface Equipment {
  [EquipmentSlot.TOOL]?: string;
  [EquipmentSlot.SOFTWARE]?: string;
  [EquipmentSlot.EXPLOIT]?: string;
  [EquipmentSlot.DEFENSE]?: string;
  [EquipmentSlot.UPGRADE]?: string;
}

/**
 * Result of equipment operations
 */
export interface EquipmentResult {
  success: boolean;
  message: string;
  slot?: EquipmentSlot;
  itemId?: string;
  effects?: ItemEffects;
}

/**
 * Combined bonuses from all equipped items
 */
export interface CombinedBonuses {
  hackingBonus: number;
  stealthBonus: number;
  speedBonus: number;
  detectionReduction: number;
  successRateIncrease: number;
  xpMultiplier: number;
  creditsMultiplier: number;
}

/**
 * Service for managing player inventory and equipment
 */
@injectable()
export class InventoryService extends EventEmitter {
  constructor(@inject(LOGGER) private logger: Logger) {
    super();
  }

  /**
   * Get player's currently equipped items
   */
  public async getEquipment(userId: string): Promise<Equipment> {
    try {
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {};
      }

      const equipment = progress.equipment as unknown as Equipment;
      return equipment || {};
    } catch (error) {
      this.logger.error({ err: error }, "Error getting equipment");
      return {};
    }
  }

  /**
   * Equip an item from inventory to an equipment slot
   */
  public async equipItem(
    userId: string,
    itemId: string,
    item: ShopItem,
  ): Promise<EquipmentResult> {
    try {
      // Check if item can be equipped (only certain categories)
      const equipableCategories = [
        ItemCategory.TOOL,
        ItemCategory.SOFTWARE,
        ItemCategory.EXPLOIT,
        ItemCategory.DEFENSE,
        ItemCategory.UPGRADE,
      ];

      if (!equipableCategories.includes(item.category)) {
        return {
          success: false,
          message: `${item.name} cannot be equipped (${item.category})`,
        };
      }

      // Determine equipment slot
      const slot = item.category as unknown as EquipmentSlot;

      // Atomic transaction: verify ownership + equip
      const txResult = await prisma.$transaction(async (tx) => {
        const progress = await tx.playerProgress.findUnique({
          where: { userId },
        });

        if (!progress) {
          return { success: false as const, message: "Player progress not found" };
        }

        // Check if player owns the item
        const inventory = progress.inventory as Record<string, number>;
        if (!inventory[itemId] || inventory[itemId] <= 0) {
          return { success: false as const, message: `You don't own ${item.name}` };
        }

        // Get current equipment
        const equipment = (progress.equipment as unknown as Equipment) || {};

        // Check if slot is already occupied by same item
        const currentItemId = equipment[slot];
        if (currentItemId === itemId) {
          return { success: false as const, message: `${item.name} is already equipped` };
        }

        // Equip the item
        equipment[slot] = itemId;

        await tx.playerProgress.update({
          where: { userId },
          data: { equipment: equipment as Prisma.JsonObject },
        });

        return { success: true as const, currentItemId };
      });

      if (!txResult.success) {
        return { success: false, message: txResult.message };
      }

      // Emit event
      this.emit("item:equipped", { userId, itemId, slot, item });

      const result: EquipmentResult = {
        success: true,
        message: txResult.currentItemId
          ? `Equipped ${item.name}, replacing previous item`
          : `Equipped ${item.name}`,
        slot,
        itemId,
      };

      if (item.effects) {
        result.effects = item.effects;
      }

      return result;
    } catch (error) {
      this.logger.error({ err: error }, "Error equipping item");
      return {
        success: false,
        message: "Failed to equip item",
      };
    }
  }

  /**
   * Unequip an item from an equipment slot
   */
  public async unequipItem(
    userId: string,
    slot: EquipmentSlot,
  ): Promise<EquipmentResult> {
    try {
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

      // Get current equipment
      const equipment = (progress.equipment as unknown as Equipment) || {};

      // Check if slot has an item
      const itemId = equipment[slot];
      if (!itemId) {
        return {
          success: false,
          message: `No item equipped in ${slot} slot`,
        };
      }

      // Remove item from slot
      delete equipment[slot];

      // Update database
      await prisma.playerProgress.update({
        where: { userId },
        data: { equipment: equipment as Prisma.JsonObject },
      });

      // Emit event
      this.emit("item:unequipped", {
        userId,
        itemId,
        slot,
      });

      return {
        success: true,
        message: `Unequipped item from ${slot} slot`,
        slot,
        itemId,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error unequipping item");
      return {
        success: false,
        message: "Failed to unequip item",
      };
    }
  }

  /**
   * Unequip a specific item by item ID
   */
  public async unequipItemById(
    userId: string,
    itemId: string,
  ): Promise<EquipmentResult> {
    try {
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

      // Get current equipment
      const equipment = (progress.equipment as unknown as Equipment) || {};

      // Find the slot containing this item
      let foundSlot: EquipmentSlot | null = null;
      for (const [slot, equippedItemId] of Object.entries(equipment)) {
        if (equippedItemId === itemId) {
          foundSlot = slot as EquipmentSlot;
          break;
        }
      }

      if (!foundSlot) {
        return {
          success: false,
          message: "Item is not currently equipped",
        };
      }

      // Unequip using the slot
      return await this.unequipItem(userId, foundSlot);
    } catch (error) {
      this.logger.error({ err: error }, "Error unequipping item by ID");
      return {
        success: false,
        message: "Failed to unequip item",
      };
    }
  }

  /**
   * Get combined bonuses from all equipped items
   */
  public async getEquipmentBonuses(
    userId: string,
    catalog: ShopItem[],
  ): Promise<CombinedBonuses> {
    const defaultBonuses: CombinedBonuses = {
      hackingBonus: 0,
      stealthBonus: 0,
      speedBonus: 0,
      detectionReduction: 0,
      successRateIncrease: 0,
      xpMultiplier: 1.0,
      creditsMultiplier: 1.0,
    };

    try {
      const equipment = await this.getEquipment(userId);
      const bonuses = { ...defaultBonuses };

      // Sum up bonuses from all equipped items
      for (const itemId of Object.values(equipment)) {
        if (!itemId) continue;

        const item = catalog.find((i) => i.id === itemId);
        if (!item || !item.effects) continue;

        const effects = item.effects;
        bonuses.hackingBonus += effects.hackingBonus || 0;
        bonuses.stealthBonus += effects.stealthBonus || 0;
        bonuses.speedBonus += effects.speedBonus || 0;
        bonuses.detectionReduction += effects.detectionReduction || 0;
        bonuses.successRateIncrease += effects.successRateIncrease || 0;

        // Multipliers are multiplicative (1.1 * 1.2 = 1.32)
        if (effects.xpMultiplier) {
          bonuses.xpMultiplier *= effects.xpMultiplier;
        }
        if (effects.creditsMultiplier) {
          bonuses.creditsMultiplier *= effects.creditsMultiplier;
        }
      }

      return bonuses;
    } catch (error) {
      this.logger.error({ err: error }, "Error calculating equipment bonuses");
      return defaultBonuses;
    }
  }

  /**
   * Check if a specific item is equipped
   */
  public async isEquipped(userId: string, itemId: string): Promise<boolean> {
    try {
      const equipment = await this.getEquipment(userId);
      return Object.values(equipment).includes(itemId);
    } catch (error) {
      this.logger.error({ err: error }, "Error checking if item is equipped");
      return false;
    }
  }

  /**
   * Get the slot an item is equipped in (if any)
   */
  public async getEquippedSlot(
    userId: string,
    itemId: string,
  ): Promise<EquipmentSlot | null> {
    try {
      const equipment = await this.getEquipment(userId);

      for (const [slot, equippedItemId] of Object.entries(equipment)) {
        if (equippedItemId === itemId) {
          return slot as EquipmentSlot;
        }
      }

      return null;
    } catch (error) {
      this.logger.error({ err: error }, "Error getting equipped slot");
      return null;
    }
  }

  /**
   * Validate equipment state (ensure all equipped items are owned)
   */
  public async validateEquipment(userId: string): Promise<void> {
    try {
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) return;

      const equipment = (progress.equipment as unknown as Equipment) || {};
      const inventory = progress.inventory as Record<string, number>;
      let modified = false;

      // Check each equipped item
      for (const [slot, itemId] of Object.entries(equipment)) {
        if (!itemId) continue;

        // If item is not in inventory or quantity is 0, unequip it
        if (!inventory[itemId] || inventory[itemId] <= 0) {
          delete equipment[slot as EquipmentSlot];
          modified = true;

          this.emit("item:auto_unequipped", {
            userId,
            itemId,
            slot,
            reason: "Item no longer in inventory",
          });
        }
      }

      // Update database if modifications were made
      if (modified) {
        await prisma.playerProgress.update({
          where: { userId },
          data: { equipment: equipment as Prisma.JsonObject },
        });
      }
    } catch (error) {
      this.logger.error({ err: error }, "Error validating equipment");
    }
  }

  /**
   * Unequip all items
   */
  public async unequipAll(userId: string): Promise<EquipmentResult> {
    try {
      await prisma.playerProgress.update({
        where: { userId },
        data: { equipment: {} as Prisma.JsonObject },
      });

      this.emit("equipment:cleared", { userId });

      return {
        success: true,
        message: "Unequipped all items",
      };
    } catch (error) {
      this.logger.error({ err: error }, "Error unequipping all items");
      return {
        success: false,
        message: "Failed to unequip all items",
      };
    }
  }
}

export default InventoryService;
