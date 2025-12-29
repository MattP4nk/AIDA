/**
 * InventoryService Integration Tests
 * Tests equipment management, bonuses calculation, and inventory validation
 */

import "reflect-metadata";
import { container } from "tsyringe";
import * as TOKENS from "../di/tokens";
import { InventoryService, EquipmentSlot } from "../services/inventoryService";
import { ItemCategory, ItemRarity } from "../services/shopService";
import { testDb, createTestUser } from "./setup";

describe("InventoryService Integration Tests", () => {
  let inventoryService: InventoryService;

  beforeAll(() => {
    inventoryService = container.resolve(TOKENS.INVENTORY_SERVICE as any);
  });

  // Helper to create a test shop item
  const createTestItem = async (data?: {
    name?: string;
    category?: ItemCategory;
    price?: number;
    effects?: any;
  }) => {
    return await testDb.shopItem.create({
      data: {
        name: data?.name || "Test Tool",
        description: "A test item",
        itemType: "tool",
        category: data?.category || ItemCategory.TOOL,
        price: data?.price || 100,
        level: 1,
        hackingBonus: data?.effects?.hackingBonus || 0,
        stealthBonus: data?.effects?.stealthBonus || 0,
        cryptographyBonus: 0,
        networkingBonus: 0,
        isConsumable: false,
        isStackable: false,
        maxStack: 1,
        rarity: "common",
        isActive: true,
      },
    });
  };

  // Helper to add item to user's inventory
  const addToInventory = async (
    userId: string,
    itemId: string,
    quantity: number = 1,
  ) => {
    const progress = await testDb.playerProgress.findUnique({
      where: { userId },
    });

    const inventory = (progress?.inventory as Record<string, number>) || {};
    inventory[itemId] = (inventory[itemId] || 0) + quantity;

    await testDb.playerProgress.update({
      where: { userId },
      data: { inventory: inventory as any },
    });
  };

  // ==================== GET EQUIPMENT ====================

  describe("Get Equipment", () => {
    it("should return empty equipment for new user", async () => {
      const user = await createTestUser({
        username: "newuser1",
        email: "newuser1@test.com",
      });

      const equipment = await inventoryService.getEquipment(user.id);

      expect(equipment).toBeDefined();
      expect(Object.keys(equipment).length).toBe(0);
    });

    it("should return equipped items", async () => {
      const user = await createTestUser({
        username: "equipped1",
        email: "equipped1@test.com",
      });
      const item = await createTestItem({ category: ItemCategory.TOOL });

      // Add item to inventory
      await addToInventory(user.id, item.id);

      // Equip the item
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const equipment = await inventoryService.getEquipment(user.id);

      expect(equipment[EquipmentSlot.TOOL]).toBe(item.id);
    });

    it("should handle missing player progress", async () => {
      const equipment =
        await inventoryService.getEquipment("non-existent-user");

      expect(equipment).toEqual({});
    });
  });

  // ==================== EQUIP ITEM ====================

  describe("Equip Item", () => {
    it("should equip item successfully", async () => {
      const user = await createTestUser({
        username: "equipper1",
        email: "equipper1@test.com",
      });
      const item = await createTestItem({
        name: "Power Tool",
        category: ItemCategory.TOOL,
      });

      await addToInventory(user.id, item.id);

      const result = await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      expect(result.success).toBe(true);
      expect(result.slot).toBe(EquipmentSlot.TOOL);
      expect(result.itemId).toBe(item.id);
      expect(result.message).toContain("Equipped");
    });

    it("should fail if item not owned", async () => {
      const user = await createTestUser({
        username: "noitem1",
        email: "noitem1@test.com",
      });
      const item = await createTestItem();

      const result = await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("don't own");
    });

    it("should fail if player progress not found", async () => {
      const item = await createTestItem();

      const result = await inventoryService.equipItem(
        "non-existent-user",
        item.id,
        {
          id: item.id,
          name: item.name,
          description: item.description,
          category: ItemCategory.TOOL,
          price: item.price,
          requiredLevel: item.level,
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("progress not found");
    });

    it("should replace existing item in slot", async () => {
      const user = await createTestUser({
        username: "replacer1",
        email: "replacer1@test.com",
      });
      const item1 = await createTestItem({
        name: "Tool 1",
        category: ItemCategory.TOOL,
      });
      const item2 = await createTestItem({
        name: "Tool 2",
        category: ItemCategory.TOOL,
      });

      await addToInventory(user.id, item1.id);
      await addToInventory(user.id, item2.id);

      // Equip first item
      await inventoryService.equipItem(user.id, item1.id, {
        id: item1.id,
        name: item1.name,
        description: item1.description,
        category: ItemCategory.TOOL,
        price: item1.price,
        requiredLevel: item1.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Equip second item (should replace)
      const result = await inventoryService.equipItem(user.id, item2.id, {
        id: item2.id,
        name: item2.name,
        description: item2.description,
        category: ItemCategory.TOOL,
        price: item2.price,
        requiredLevel: item2.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("replacing");

      const equipment = await inventoryService.getEquipment(user.id);
      expect(equipment[EquipmentSlot.TOOL]).toBe(item2.id);
    });

    it("should fail if item already equipped", async () => {
      const user = await createTestUser({
        username: "already1",
        email: "already1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      // Equip first time
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Try to equip again
      const result = await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("already equipped");
    });

    it("should not equip consumable items", async () => {
      const user = await createTestUser({
        username: "consumable1",
        email: "consumable1@test.com",
      });
      const item = await createTestItem({
        category: ItemCategory.CONSUMABLE,
      });

      await addToInventory(user.id, item.id);

      const result = await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.CONSUMABLE,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: true,
        maxStack: 10,
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain("cannot be equipped");
    });

    it("should equip items to different slots", async () => {
      const user = await createTestUser({
        username: "multislot1",
        email: "multislot1@test.com",
      });

      const tool = await createTestItem({
        name: "Tool",
        category: ItemCategory.TOOL,
      });
      const software = await createTestItem({
        name: "Software",
        category: ItemCategory.SOFTWARE,
      });
      const exploit = await createTestItem({
        name: "Exploit",
        category: ItemCategory.EXPLOIT,
      });

      await addToInventory(user.id, tool.id);
      await addToInventory(user.id, software.id);
      await addToInventory(user.id, exploit.id);

      await inventoryService.equipItem(user.id, tool.id, {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: ItemCategory.TOOL,
        price: tool.price,
        requiredLevel: tool.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      await inventoryService.equipItem(user.id, software.id, {
        id: software.id,
        name: software.name,
        description: software.description,
        category: ItemCategory.SOFTWARE,
        price: software.price,
        requiredLevel: software.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      await inventoryService.equipItem(user.id, exploit.id, {
        id: exploit.id,
        name: exploit.name,
        description: exploit.description,
        category: ItemCategory.EXPLOIT,
        price: exploit.price,
        requiredLevel: exploit.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const equipment = await inventoryService.getEquipment(user.id);

      expect(equipment[EquipmentSlot.TOOL]).toBe(tool.id);
      expect(equipment[EquipmentSlot.SOFTWARE]).toBe(software.id);
      expect(equipment[EquipmentSlot.EXPLOIT]).toBe(exploit.id);
    });
  });

  // ==================== UNEQUIP ITEM ====================

  describe("Unequip Item", () => {
    it("should unequip item by slot", async () => {
      const user = await createTestUser({
        username: "unequip1",
        email: "unequip1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      // Equip item
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Unequip item
      const result = await inventoryService.unequipItem(
        user.id,
        EquipmentSlot.TOOL,
      );

      expect(result.success).toBe(true);
      expect(result.slot).toBe(EquipmentSlot.TOOL);
      expect(result.itemId).toBe(item.id);

      const equipment = await inventoryService.getEquipment(user.id);
      expect(equipment[EquipmentSlot.TOOL]).toBeUndefined();
    });

    it("should fail if no item in slot", async () => {
      const user = await createTestUser({
        username: "emptyslot1",
        email: "emptyslot1@test.com",
      });

      const result = await inventoryService.unequipItem(
        user.id,
        EquipmentSlot.TOOL,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("No item equipped");
    });

    it("should fail if player progress not found", async () => {
      const result = await inventoryService.unequipItem(
        "non-existent-user",
        EquipmentSlot.TOOL,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("progress not found");
    });

    it("should unequip item by item ID", async () => {
      const user = await createTestUser({
        username: "unequipid1",
        email: "unequipid1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      // Equip item
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Unequip by item ID
      const result = await inventoryService.unequipItemById(user.id, item.id);

      expect(result.success).toBe(true);
      expect(result.itemId).toBe(item.id);

      const equipment = await inventoryService.getEquipment(user.id);
      expect(equipment[EquipmentSlot.TOOL]).toBeUndefined();
    });

    it("should fail if item not equipped when unequipping by ID", async () => {
      const user = await createTestUser({
        username: "notequipped1",
        email: "notequipped1@test.com",
      });
      const item = await createTestItem();

      const result = await inventoryService.unequipItemById(user.id, item.id);

      expect(result.success).toBe(false);
      expect(result.message).toContain("not currently equipped");
    });

    it("should unequip all items", async () => {
      const user = await createTestUser({
        username: "unequipall1",
        email: "unequipall1@test.com",
      });

      const tool = await createTestItem({
        name: "Tool",
        category: ItemCategory.TOOL,
      });
      const software = await createTestItem({
        name: "Software",
        category: ItemCategory.SOFTWARE,
      });

      await addToInventory(user.id, tool.id);
      await addToInventory(user.id, software.id);

      // Equip both items
      await inventoryService.equipItem(user.id, tool.id, {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: ItemCategory.TOOL,
        price: tool.price,
        requiredLevel: tool.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      await inventoryService.equipItem(user.id, software.id, {
        id: software.id,
        name: software.name,
        description: software.description,
        category: ItemCategory.SOFTWARE,
        price: software.price,
        requiredLevel: software.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Unequip all
      const result = await inventoryService.unequipAll(user.id);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Unequipped all");

      const equipment = await inventoryService.getEquipment(user.id);
      expect(Object.keys(equipment).length).toBe(0);
    });
  });

  // ==================== EQUIPMENT BONUSES ====================

  describe("Equipment Bonuses", () => {
    it("should calculate bonuses from equipped items", async () => {
      const user = await createTestUser({
        username: "bonus1",
        email: "bonus1@test.com",
      });

      const item = await createTestItem({
        name: "Bonus Tool",
        category: ItemCategory.TOOL,
        effects: {
          hackingBonus: 10,
          stealthBonus: 5,
        },
      });

      await addToInventory(user.id, item.id);

      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        effects: {
          hackingBonus: 10,
          stealthBonus: 5,
        },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, [
        {
          id: item.id,
          name: item.name,
          description: item.description,
          category: ItemCategory.TOOL,
          price: item.price,
          requiredLevel: item.level,
          effects: {
            hackingBonus: 10,
            stealthBonus: 5,
          },
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
      ]);

      expect(bonuses.hackingBonus).toBe(10);
      expect(bonuses.stealthBonus).toBe(5);
      expect(bonuses.speedBonus).toBe(0);
    });

    it("should stack bonuses from multiple items", async () => {
      const user = await createTestUser({
        username: "multibonus1",
        email: "multibonus1@test.com",
      });

      const tool = await createTestItem({
        name: "Tool",
        category: ItemCategory.TOOL,
        effects: { hackingBonus: 10 },
      });

      const software = await createTestItem({
        name: "Software",
        category: ItemCategory.SOFTWARE,
        effects: { hackingBonus: 15, stealthBonus: 5 },
      });

      await addToInventory(user.id, tool.id);
      await addToInventory(user.id, software.id);

      await inventoryService.equipItem(user.id, tool.id, {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        category: ItemCategory.TOOL,
        price: tool.price,
        requiredLevel: tool.level,
        effects: { hackingBonus: 10 },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      await inventoryService.equipItem(user.id, software.id, {
        id: software.id,
        name: software.name,
        description: software.description,
        category: ItemCategory.SOFTWARE,
        price: software.price,
        requiredLevel: software.level,
        effects: { hackingBonus: 15, stealthBonus: 5 },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, [
        {
          id: tool.id,
          name: tool.name,
          description: tool.description,
          category: ItemCategory.TOOL,
          price: tool.price,
          requiredLevel: tool.level,
          effects: { hackingBonus: 10 },
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
        {
          id: software.id,
          name: software.name,
          description: software.description,
          category: ItemCategory.SOFTWARE,
          price: software.price,
          requiredLevel: software.level,
          effects: { hackingBonus: 15, stealthBonus: 5 },
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
      ]);

      expect(bonuses.hackingBonus).toBe(25); // 10 + 15
      expect(bonuses.stealthBonus).toBe(5);
    });

    it("should return default bonuses for empty equipment", async () => {
      const user = await createTestUser({
        username: "nobonus1",
        email: "nobonus1@test.com",
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, []);

      expect(bonuses.hackingBonus).toBe(0);
      expect(bonuses.stealthBonus).toBe(0);
      expect(bonuses.xpMultiplier).toBe(1.0);
      expect(bonuses.creditsMultiplier).toBe(1.0);
    });

    it("should handle multiplier bonuses", async () => {
      const user = await createTestUser({
        username: "multiplier1",
        email: "multiplier1@test.com",
      });

      const item = await createTestItem({
        name: "XP Boost",
        category: ItemCategory.UPGRADE,
      });

      await addToInventory(user.id, item.id);

      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.UPGRADE,
        price: item.price,
        requiredLevel: item.level,
        effects: {
          xpMultiplier: 1.5,
          creditsMultiplier: 1.2,
        },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, [
        {
          id: item.id,
          name: item.name,
          description: item.description,
          category: ItemCategory.UPGRADE,
          price: item.price,
          requiredLevel: item.level,
          effects: {
            xpMultiplier: 1.5,
            creditsMultiplier: 1.2,
          },
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
      ]);

      expect(bonuses.xpMultiplier).toBe(1.5);
      expect(bonuses.creditsMultiplier).toBe(1.2);
    });

    it("should multiply multipliers correctly", async () => {
      const user = await createTestUser({
        username: "multimult1",
        email: "multimult1@test.com",
      });

      const item1 = await createTestItem({
        name: "Boost 1",
        category: ItemCategory.UPGRADE,
      });

      const item2 = await createTestItem({
        name: "Boost 2",
        category: ItemCategory.TOOL,
      });

      await addToInventory(user.id, item1.id);
      await addToInventory(user.id, item2.id);

      await inventoryService.equipItem(user.id, item1.id, {
        id: item1.id,
        name: item1.name,
        description: item1.description,
        category: ItemCategory.UPGRADE,
        price: item1.price,
        requiredLevel: item1.level,
        effects: { xpMultiplier: 1.5 },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      await inventoryService.equipItem(user.id, item2.id, {
        id: item2.id,
        name: item2.name,
        description: item2.description,
        category: ItemCategory.TOOL,
        price: item2.price,
        requiredLevel: item2.level,
        effects: { xpMultiplier: 1.2 },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, [
        {
          id: item1.id,
          name: item1.name,
          description: item1.description,
          category: ItemCategory.UPGRADE,
          price: item1.price,
          requiredLevel: item1.level,
          effects: { xpMultiplier: 1.5 },
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
        {
          id: item2.id,
          name: item2.name,
          description: item2.description,
          category: ItemCategory.TOOL,
          price: item2.price,
          requiredLevel: item2.level,
          effects: { xpMultiplier: 1.2 },
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
      ]);

      expect(bonuses.xpMultiplier).toBeCloseTo(1.8); // 1.5 * 1.2
    });
  });

  // ==================== EQUIPMENT QUERIES ====================

  describe("Equipment Queries", () => {
    it("should check if item is equipped", async () => {
      const user = await createTestUser({
        username: "isequipped1",
        email: "isequipped1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      // Not equipped yet
      let isEquipped = await inventoryService.isEquipped(user.id, item.id);
      expect(isEquipped).toBe(false);

      // Equip item
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Now equipped
      isEquipped = await inventoryService.isEquipped(user.id, item.id);
      expect(isEquipped).toBe(true);
    });

    it("should get equipped slot", async () => {
      const user = await createTestUser({
        username: "getslot1",
        email: "getslot1@test.com",
      });
      const item = await createTestItem({ category: ItemCategory.SOFTWARE });

      await addToInventory(user.id, item.id);

      // Not equipped yet
      let slot = await inventoryService.getEquippedSlot(user.id, item.id);
      expect(slot).toBeNull();

      // Equip item
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.SOFTWARE,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Get slot
      slot = await inventoryService.getEquippedSlot(user.id, item.id);
      expect(slot).toBe(EquipmentSlot.SOFTWARE);
    });

    it("should return null for unequipped item slot", async () => {
      const user = await createTestUser({
        username: "noslot1",
        email: "noslot1@test.com",
      });
      const item = await createTestItem();

      const slot = await inventoryService.getEquippedSlot(user.id, item.id);
      expect(slot).toBeNull();
    });
  });

  // ==================== EQUIPMENT VALIDATION ====================

  describe("Equipment Validation", () => {
    it("should auto-unequip items not in inventory", async () => {
      const user = await createTestUser({
        username: "validate1",
        email: "validate1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      // Equip item
      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Remove from inventory
      await testDb.playerProgress.update({
        where: { userId: user.id },
        data: { inventory: {} as any },
      });

      // Validate equipment
      await inventoryService.validateEquipment(user.id);

      // Item should be auto-unequipped
      const equipment = await inventoryService.getEquipment(user.id);
      expect(equipment[EquipmentSlot.TOOL]).toBeUndefined();
    });

    it("should not modify valid equipment", async () => {
      const user = await createTestUser({
        username: "validequip1",
        email: "validequip1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Validate equipment
      await inventoryService.validateEquipment(user.id);

      // Item should still be equipped
      const equipment = await inventoryService.getEquipment(user.id);
      expect(equipment[EquipmentSlot.TOOL]).toBe(item.id);
    });

    it("should handle missing player progress", async () => {
      // Should not throw
      await expect(
        inventoryService.validateEquipment("non-existent-user"),
      ).resolves.not.toThrow();
    });
  });

  // ==================== EDGE CASES ====================

  describe("Edge Cases", () => {
    it("should handle empty equipment gracefully", async () => {
      const user = await createTestUser({
        username: "empty1",
        email: "empty1@test.com",
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, []);

      expect(bonuses.hackingBonus).toBe(0);
      expect(bonuses.xpMultiplier).toBe(1.0);
    });

    it("should handle equipment with no effects", async () => {
      const user = await createTestUser({
        username: "noeffects1",
        email: "noeffects1@test.com",
      });
      const item = await createTestItem({ effects: undefined });

      await addToInventory(user.id, item.id);

      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      const bonuses = await inventoryService.getEquipmentBonuses(user.id, [
        {
          id: item.id,
          name: item.name,
          description: item.description,
          category: ItemCategory.TOOL,
          price: item.price,
          requiredLevel: item.level,
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        },
      ]);

      expect(bonuses.hackingBonus).toBe(0);
    });

    it("should handle item not in catalog when calculating bonuses", async () => {
      const user = await createTestUser({
        username: "nocatalog1",
        email: "nocatalog1@test.com",
      });
      const item = await createTestItem();

      await addToInventory(user.id, item.id);

      await inventoryService.equipItem(user.id, item.id, {
        id: item.id,
        name: item.name,
        description: item.description,
        category: ItemCategory.TOOL,
        price: item.price,
        requiredLevel: item.level,
        effects: { hackingBonus: 10 },
        rarity: ItemRarity.COMMON,
        isConsumable: false,
        maxStack: 1,
      });

      // Pass empty catalog
      const bonuses = await inventoryService.getEquipmentBonuses(user.id, []);

      // Should return default bonuses since item not in catalog
      expect(bonuses.hackingBonus).toBe(0);
    });

    it("should handle all equipment slots", async () => {
      const user = await createTestUser({
        username: "allslots1",
        email: "allslots1@test.com",
      });

      const items = [
        { category: ItemCategory.TOOL, slot: EquipmentSlot.TOOL },
        { category: ItemCategory.SOFTWARE, slot: EquipmentSlot.SOFTWARE },
        { category: ItemCategory.EXPLOIT, slot: EquipmentSlot.EXPLOIT },
        { category: ItemCategory.DEFENSE, slot: EquipmentSlot.DEFENSE },
        { category: ItemCategory.UPGRADE, slot: EquipmentSlot.UPGRADE },
      ];

      for (const itemData of items) {
        const item = await createTestItem({
          name: `${itemData.category} Item`,
          category: itemData.category,
        });

        await addToInventory(user.id, item.id);

        await inventoryService.equipItem(user.id, item.id, {
          id: item.id,
          name: item.name,
          description: item.description,
          category: itemData.category,
          price: item.price,
          requiredLevel: item.level,
          rarity: ItemRarity.COMMON,
          isConsumable: false,
          maxStack: 1,
        });
      }

      const equipment = await inventoryService.getEquipment(user.id);

      expect(Object.keys(equipment).length).toBe(5);
      expect(equipment[EquipmentSlot.TOOL]).toBeDefined();
      expect(equipment[EquipmentSlot.SOFTWARE]).toBeDefined();
      expect(equipment[EquipmentSlot.EXPLOIT]).toBeDefined();
      expect(equipment[EquipmentSlot.DEFENSE]).toBeDefined();
      expect(equipment[EquipmentSlot.UPGRADE]).toBeDefined();
    });
  });
});
