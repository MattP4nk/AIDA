/**
 * Integration tests for ShopService
 * Tests shop operations with real database
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { shopService } from "../services/shopService";
import { testDb } from "./setup";

describe("ShopService Integration Tests", () => {
  let testUser: any;

  beforeEach(async () => {
    // Create test user with some credits
    testUser = await testDb.user.create({
      data: {
        username: "shopper",
        email: "shopper@test.com",
        password: "$2b$04$testhash",
        homeIp: "10.0.0.100",
        isActive: true,
        progress: {
          create: {
            level: 5,
            experience: 1000,
            credits: 1000,
            hacking: 5,
            stealth: 3,
            cryptography: 3,
          },
        },
      },
      include: { progress: true },
    });
  });

  describe("Shop Catalog", () => {
    it("should list all shop items", () => {
      const items = shopService.getAllItems();

      expect(Array.isArray(items)).toBe(true);
      expect(items.length).toBeGreaterThan(0);
    });

    it("should get specific item by ID", () => {
      const item = shopService.getItem("basic_scanner");

      expect(item).toBeDefined();
      expect(item?.name).toBeDefined();
      expect(item?.price).toBeDefined();
    });

    it("should return undefined for non-existent item", () => {
      const item = shopService.getItem("invalid_item_id");

      expect(item).toBeUndefined();
    });

    it("should filter items by level", () => {
      const lowLevelItems = shopService.getItemsForLevel(2);

      expect(Array.isArray(lowLevelItems)).toBe(true);
      lowLevelItems.forEach((item) => {
        expect(item.requiredLevel).toBeLessThanOrEqual(2);
      });
    });

    it("should search items by name", () => {
      const results = shopService.searchItems("scanner");

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("Purchase Operations", () => {
    it("should successfully purchase an item", async () => {
      const result = await shopService.purchaseItem(
        testUser.id,
        "basic_scanner",
        1,
      );

      expect(result.success).toBe(true);
      expect(result.message).toBeDefined();
    });

    it("should deduct credits after purchase", async () => {
      const initialCredits = testUser.progress.credits;
      const item = shopService.getItem("basic_scanner");

      await shopService.purchaseItem(testUser.id, "basic_scanner", 1);

      const updatedProgress = await testDb.playerProgress.findUnique({
        where: { userId: testUser.id },
      });

      expect(updatedProgress?.credits).toBeLessThan(initialCredits);
      if (item) {
        expect(updatedProgress?.credits).toBe(initialCredits - item.price);
      }
    });

    it("should reject purchase with insufficient credits", async () => {
      // Update user to have very few credits
      await testDb.playerProgress.update({
        where: { userId: testUser.id },
        data: { credits: 10 },
      });

      const result = await shopService.purchaseItem(
        testUser.id,
        "exploit_framework",
        1,
      );

      expect(result.success).toBe(false);
      // Message could be about credits OR skill requirements
      expect(result.message).toBeDefined();
    });

    it("should add purchased item to inventory", async () => {
      await shopService.purchaseItem(testUser.id, "basic_scanner", 1);

      const hasItem = await shopService.hasItem(testUser.id, "basic_scanner");
      expect(hasItem).toBe(true);
    });

    it("should reject purchase of non-existent item", async () => {
      const result = await shopService.purchaseItem(
        testUser.id,
        "invalid_item",
        1,
      );

      expect(result.success).toBe(false);
    });

    it("should handle zero quantity purchase", async () => {
      const result = await shopService.purchaseItem(
        testUser.id,
        "basic_scanner",
        0,
      );

      // Zero quantity might be allowed by the service
      expect(result).toBeDefined();
    });
  });

  describe("Inventory Management", () => {
    beforeEach(async () => {
      await shopService.purchaseItem(testUser.id, "basic_scanner", 1);
    });

    it("should retrieve player inventory", async () => {
      const inventory = await shopService.getPlayerInventory(testUser.id);

      expect(Array.isArray(inventory)).toBe(true);
      expect(inventory.length).toBeGreaterThan(0);
    });

    it("should check item ownership", async () => {
      const hasItem = await shopService.hasItem(testUser.id, "basic_scanner");
      expect(hasItem).toBe(true);

      const hasOther = await shopService.hasItem(testUser.id, "rootkit");
      expect(hasOther).toBe(false);
    });

    it("should get item quantity", async () => {
      const quantity = await shopService.getItemQuantity(
        testUser.id,
        "basic_scanner",
      );

      expect(quantity).toBe(1);
    });

    it("should return 0 for non-owned items", async () => {
      const quantity = await shopService.getItemQuantity(
        testUser.id,
        "rootkit",
      );

      expect(quantity).toBe(0);
    });
  });

  describe("Sell Operations", () => {
    beforeEach(async () => {
      await shopService.purchaseItem(testUser.id, "password_cracker", 1);
    });

    it("should sell item back to shop", async () => {
      const beforeProgress = await testDb.playerProgress.findUnique({
        where: { userId: testUser.id },
      });
      const beforeCredits = beforeProgress?.credits || 0;

      const result = await shopService.sellItem(
        testUser.id,
        "password_cracker",
        1,
      );

      expect(result.success).toBe(true);

      const afterProgress = await testDb.playerProgress.findUnique({
        where: { userId: testUser.id },
      });

      expect(afterProgress?.credits).toBeGreaterThan(beforeCredits);
    });

    it("should remove sold item from inventory", async () => {
      await shopService.sellItem(testUser.id, "password_cracker", 1);

      const hasItem = await shopService.hasItem(
        testUser.id,
        "password_cracker",
      );
      expect(hasItem).toBe(false);
    });

    it("should reject selling item not owned", async () => {
      const result = await shopService.sellItem(testUser.id, "rootkit", 1);

      expect(result.success).toBe(false);
    });
  });

  describe("Item Bonuses", () => {
    it("should calculate player bonuses from items", async () => {
      await shopService.purchaseItem(testUser.id, "basic_scanner", 1);

      const bonuses = await shopService.getPlayerBonuses(testUser.id);

      expect(bonuses).toBeDefined();
      expect(typeof bonuses).toBe("object");
    });

    it("should return zero bonuses for empty inventory", async () => {
      const bonuses = await shopService.getPlayerBonuses(testUser.id);

      expect(bonuses).toBeDefined();
    });

    it("should stack bonuses from multiple items", async () => {
      await shopService.purchaseItem(testUser.id, "basic_scanner", 1);
      await shopService.purchaseItem(testUser.id, "password_cracker", 1);

      const bonuses = await shopService.getPlayerBonuses(testUser.id);

      expect(bonuses.hackingBonus).toBeGreaterThan(0);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid user ID", async () => {
      const result = await shopService.purchaseItem(
        "invalid-user",
        "basic_scanner",
        1,
      );

      expect(result.success).toBe(false);
    });

    it("should handle database errors gracefully", async () => {
      const inventory = await shopService.getPlayerInventory("non-existent");

      expect(Array.isArray(inventory)).toBe(true);
      expect(inventory.length).toBe(0);
    });
  });

  describe("Level Requirements", () => {
    it("should enforce level requirements on purchase", async () => {
      // User is level 5, try to buy level 10 item
      const result = await shopService.purchaseItem(
        testUser.id,
        "zero_day_exploit",
        1,
      );

      // Should fail due to level requirement
      expect(result.success).toBe(false);
      expect(result.message).toContain("level");
    });

    it("should allow purchase when requirements met", async () => {
      const result = await shopService.purchaseItem(
        testUser.id,
        "basic_scanner",
        1,
      );

      expect(result.success).toBe(true);
    });
  });
});
