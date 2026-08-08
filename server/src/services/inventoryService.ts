import { injectable, inject } from "tsyringe";
import { prisma } from "../database/client";
import { EventEmitter } from "events";
import { ShopItem, ItemCategory, ItemEffects } from "./shopService";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";

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
 * Equipment state for a player — maps slot name to item ID
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
 * Service for managing player equipment.
 * All operations use the InventoryItem table (isEquipped + slot fields).
 */
@injectable()
export class InventoryService extends EventEmitter {
  constructor(@inject(LOGGER) private logger: Logger) {
    super();
  }

  /**
   * Get player's currently equipped items as a slot → itemId map.
   */
  public async getEquipment(userId: string): Promise<Equipment> {
    return await safeExecute({
      fn: async () => {
        const equipped = await prisma.inventoryItem.findMany({
          where: { userId, isEquipped: true },
        });

        const equipment: Equipment = {};
        for (const row of equipped) {
          if (row.slot) {
            equipment[row.slot as EquipmentSlot] = row.shopItemId;
          }
        }
        return equipment;
      },
      context: "Get equipment",
      logger: this.logger,
      fallback: {} as Equipment,
    })() as Equipment;
  }

  /**
   * Equip an item from inventory to an equipment slot.
   */
  public async equipItem(
    userId: string,
    itemId: string,
    item: ShopItem,
  ): Promise<EquipmentResult> {
    return await safeExecute({
      fn: async () => {
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

        const slot = item.category as unknown as EquipmentSlot;

        const txResult = await prisma.$transaction(async (tx) => {
          // Verify player owns the item
          const invItem = await tx.inventoryItem.findFirst({
            where: { userId, shopItemId: itemId, quantity: { gt: 0 } },
          });

          if (!invItem) {
            return { success: false as const, message: `You don't own ${item.name}` };
          }

          // Already equipped in this slot?
          if (invItem.isEquipped && invItem.slot === slot) {
            return { success: false as const, message: `${item.name} is already equipped` };
          }

          // Unequip whatever is currently in this slot
          const currentlyEquipped = await tx.inventoryItem.findFirst({
            where: { userId, isEquipped: true, slot },
          });

          if (currentlyEquipped) {
            await tx.inventoryItem.update({
              where: { id: currentlyEquipped.id },
              data: { isEquipped: false, slot: null },
            });
          }

          // Equip the new item
          await tx.inventoryItem.update({
            where: { id: invItem.id },
            data: { isEquipped: true, slot },
          });

          return { success: true as const, replaced: !!currentlyEquipped };
        });

        if (!txResult.success) {
          return { success: false, message: txResult.message };
        }

        this.emit("item:equipped", { userId, itemId, slot, item });

        const result: EquipmentResult = {
          success: true,
          message: txResult.replaced
            ? `Equipped ${item.name}, replacing previous item`
            : `Equipped ${item.name}`,
          slot,
          itemId,
        };

        if (item.effects) {
          result.effects = item.effects;
        }

        return result;
      },
      context: "Equip item",
      logger: this.logger,
      fallback: { success: false, message: "Failed to equip item" } as EquipmentResult,
    })() as EquipmentResult;
  }

  /**
   * Unequip an item from an equipment slot.
   */
  public async unequipItem(
    userId: string,
    slot: EquipmentSlot,
  ): Promise<EquipmentResult> {
    return await safeExecute({
      fn: async () => {
        const equipped = await prisma.inventoryItem.findFirst({
          where: { userId, isEquipped: true, slot },
        });

        if (!equipped) {
          return { success: false, message: `No item equipped in ${slot} slot` };
        }

        await prisma.inventoryItem.update({
          where: { id: equipped.id },
          data: { isEquipped: false, slot: null },
        });

        this.emit("item:unequipped", { userId, itemId: equipped.shopItemId, slot });

        return {
          success: true,
          message: `Unequipped item from ${slot} slot`,
          slot,
          itemId: equipped.shopItemId,
        };
      },
      context: "Unequip item",
      logger: this.logger,
      fallback: { success: false, message: "Failed to unequip item" },
    })() as unknown as EquipmentResult;
  }

  /**
   * Unequip a specific item by item ID.
   */
  public async unequipItemById(
    userId: string,
    itemId: string,
  ): Promise<EquipmentResult> {
    return await safeExecute({
      fn: async () => {
        const equipped = await prisma.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId, isEquipped: true },
        });

        if (!equipped || !equipped.slot) {
          return { success: false, message: "Item is not currently equipped" };
        }

        return await this.unequipItem(userId, equipped.slot as EquipmentSlot);
      },
      context: "Unequip item by ID",
      logger: this.logger,
      fallback: { success: false, message: "Failed to unequip item" },
    })() as unknown as EquipmentResult;
  }

  /**
   * Get combined bonuses from all equipped items.
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

    return await safeExecute({
      fn: async () => {
        const equipped = await prisma.inventoryItem.findMany({
          where: { userId, isEquipped: true },
        });

        const bonuses = { ...defaultBonuses };

        for (const row of equipped) {
          const item = catalog.find((i) => i.id === row.shopItemId);
          if (!item || !item.effects) continue;

          const effects = item.effects;
          bonuses.hackingBonus += effects.hackingBonus || 0;
          bonuses.stealthBonus += effects.stealthBonus || 0;
          bonuses.speedBonus += effects.speedBonus || 0;
          bonuses.detectionReduction += effects.detectionReduction || 0;
          bonuses.successRateIncrease += effects.successRateIncrease || 0;

          if (effects.xpMultiplier) {
            bonuses.xpMultiplier *= effects.xpMultiplier;
          }
          if (effects.creditsMultiplier) {
            bonuses.creditsMultiplier *= effects.creditsMultiplier;
          }
        }

        return bonuses;
      },
      context: "Calculate equipment bonuses",
      logger: this.logger,
      fallback: defaultBonuses,
    })() as CombinedBonuses;
  }

  /**
   * Check if a specific item is equipped.
   */
  public async isEquipped(userId: string, itemId: string): Promise<boolean> {
    return await safeExecute({
      fn: async () => {
        const row = await prisma.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId, isEquipped: true },
        });
        return !!row;
      },
      context: "Check if item is equipped",
      logger: this.logger,
      fallback: false,
    })() as boolean;
  }

  /**
   * Get the slot an item is equipped in (if any).
   */
  public async getEquippedSlot(
    userId: string,
    itemId: string,
  ): Promise<EquipmentSlot | null> {
    return await safeExecute({
      fn: async () => {
        const row = await prisma.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId, isEquipped: true },
        });
        return row?.slot as EquipmentSlot | null ?? null;
      },
      context: "Get equipped slot",
      logger: this.logger,
      fallback: null as EquipmentSlot | null,
    })() as EquipmentSlot | null;
  }

  /**
   * Validate equipment state — auto-unequip items no longer in inventory.
   */
  public async validateEquipment(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        // Items with isEquipped=true but quantity=0 should be unequipped
        const broken = await prisma.inventoryItem.findMany({
          where: { userId, isEquipped: true, quantity: { lte: 0 } },
        });

        for (const row of broken) {
          await prisma.inventoryItem.update({
            where: { id: row.id },
            data: { isEquipped: false, slot: null },
          });

          this.emit("item:auto_unequipped", {
            userId,
            itemId: row.shopItemId,
            slot: row.slot,
            reason: "Item quantity is zero",
          });
        }
      },
      context: "Validate equipment",
      logger: this.logger,
    })();
  }

  /**
   * Unequip all items.
   */
  public async unequipAll(userId: string): Promise<EquipmentResult> {
    return await safeExecute({
      fn: async () => {
        await prisma.inventoryItem.updateMany({
          where: { userId, isEquipped: true },
          data: { isEquipped: false, slot: null },
        });

        this.emit("equipment:cleared", { userId });

        return { success: true, message: "Unequipped all items" };
      },
      context: "Unequip all items",
      logger: this.logger,
      fallback: { success: false, message: "Failed to unequip all items" } as EquipmentResult,
    })() as EquipmentResult;
  }
}

export default InventoryService;
