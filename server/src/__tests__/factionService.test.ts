/// <reference types="jest" />

/**
 * FactionService Integration Tests
 * Tests faction join/leave, reputation, missions, and member management
 */

import { testDb, createTestUser } from "./setup";
import { FactionService } from "../services/factionService";
import { container } from "tsyringe";
import { PRISMA_CLIENT } from "../di/tokens";

describe("FactionService Integration Tests", () => {
  let factionService: FactionService;
  let testUser: any;
  let testUser2: any;
  let testFaction: any;
  let testFaction2: any;

  beforeAll(() => {
    const prisma = container.resolve(PRISMA_CLIENT) as any;
    const logger = { error: jest.fn(), info: jest.fn() } as any;
    factionService = new FactionService(prisma, logger);
  });

  beforeEach(async () => {
    const timestamp = Date.now();

    // Create test users
    testUser = await createTestUser({
      username: `factionuser_${timestamp}`,
      email: `faction_${timestamp}@test.com`,
    });

    testUser2 = await createTestUser({
      username: `factionuser2_${timestamp}`,
      email: `faction2_${timestamp}@test.com`,
    });

    // Create test factions
    testFaction = await testDb.faction.create({
      data: {
        name: `TestFaction_${timestamp}`,
        shortName: `tf${timestamp % 10000}`,
        description: "A test faction for testing",
        objective: "Test objectives",
        ideology: "Testing ideology",
        activeMembers: 0,
      },
    });

    testFaction2 = await testDb.faction.create({
      data: {
        name: `TestFaction2_${timestamp}`,
        shortName: `tf2${timestamp % 10000}`,
        description: "Another test faction",
        objective: "More test objectives",
        ideology: "Another ideology",
        activeMembers: 0,
      },
    });
  });

  // ==================== FACTION RETRIEVAL ====================

  describe("Faction Retrieval", () => {
    it("should get all factions", async () => {
      const factions = await factionService.getAllFactions();

      expect(factions).toBeDefined();
      expect(Array.isArray(factions)).toBe(true);
      expect(factions.length).toBeGreaterThanOrEqual(2);
      expect(factions.some((f) => f.id === testFaction.id)).toBe(true);
    });

    it("should get faction by ID", async () => {
      const faction = await factionService.getFactionById(testFaction.id);

      expect(faction).toBeDefined();
      expect(faction?.id).toBe(testFaction.id);
      expect(faction?.name).toBe(testFaction.name);
    });

    it("should return null for non-existent faction ID", async () => {
      const faction = await factionService.getFactionById("nonexistent-id");

      expect(faction).toBeNull();
    });

    it("should get faction by name", async () => {
      const faction = await factionService.getFactionByName(testFaction.name);

      expect(faction).toBeDefined();
      expect(faction?.id).toBe(testFaction.id);
    });

    it("should get faction by short name", async () => {
      const faction = await factionService.getFactionByName(
        testFaction.shortName,
      );

      expect(faction).toBeDefined();
      expect(faction?.id).toBe(testFaction.id);
    });

    it("should be case-insensitive when searching by name", async () => {
      const upperCase = await factionService.getFactionByName(
        testFaction.name.toUpperCase(),
      );
      const lowerCase = await factionService.getFactionByName(
        testFaction.name.toLowerCase(),
      );

      expect(upperCase?.id).toBe(testFaction.id);
      expect(lowerCase?.id).toBe(testFaction.id);
    });

    it("should return null for non-existent faction name", async () => {
      const faction =
        await factionService.getFactionByName("NonExistentFaction");

      expect(faction).toBeNull();
    });
  });

  // ==================== JOIN FACTION ====================

  describe("Join Faction", () => {
    it("should allow user to join a faction", async () => {
      const result = await factionService.joinFaction(
        testUser.id,
        testFaction.id,
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully joined");

      // Verify membership created
      const membership = await testDb.factionMember.findFirst({
        where: {
          userId: testUser.id,
          factionId: testFaction.id,
        },
      });

      expect(membership).toBeDefined();
      expect(membership?.rank).toBe("recruit");
      expect(membership?.reputation).toBe(0);
    });

    it("should create faction standing when joining", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const standing = await testDb.factionStanding.findUnique({
        where: {
          userId_factionId: {
            userId: testUser.id,
            factionId: testFaction.id,
          },
        },
      });

      expect(standing).toBeDefined();
      expect(standing?.isAllied).toBe(true);
      expect(standing?.isNeutral).toBe(false);
      expect(standing?.isHostile).toBe(false);
    });

    it("should increment faction active members count", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const faction = await testDb.faction.findUnique({
        where: { id: testFaction.id },
      });

      expect(faction?.activeMembers).toBe(1);
    });

    it("should not allow joining same faction twice", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const result = await factionService.joinFaction(
        testUser.id,
        testFaction.id,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("already a member");
    });

    it("should not allow joining multiple factions", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const result = await factionService.joinFaction(
        testUser.id,
        testFaction2.id,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("leave your current faction");
    });

    it("should reject joining non-existent faction", async () => {
      const result = await factionService.joinFaction(
        testUser.id,
        "nonexistent-id",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    it("should allow multiple users to join same faction", async () => {
      const result1 = await factionService.joinFaction(
        testUser.id,
        testFaction.id,
      );
      const result2 = await factionService.joinFaction(
        testUser2.id,
        testFaction.id,
      );

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const faction = await testDb.faction.findUnique({
        where: { id: testFaction.id },
      });

      expect(faction?.activeMembers).toBe(2);
    });
  });

  // ==================== LEAVE FACTION ====================

  describe("Leave Faction", () => {
    it("should allow user to leave faction", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const result = await factionService.leaveFaction(testUser.id);

      expect(result.success).toBe(true);
      expect(result.message).toContain("Successfully left");

      // Verify membership deleted
      const membership = await testDb.factionMember.findFirst({
        where: {
          userId: testUser.id,
          factionId: testFaction.id,
        },
      });

      expect(membership).toBeNull();
    });

    it("should decrement faction active members count", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);
      await factionService.leaveFaction(testUser.id);

      const faction = await testDb.faction.findUnique({
        where: { id: testFaction.id },
      });

      expect(faction?.activeMembers).toBe(0);
    });

    it("should update standing to neutral when leaving", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);
      await factionService.leaveFaction(testUser.id);

      const standing = await testDb.factionStanding.findUnique({
        where: {
          userId_factionId: {
            userId: testUser.id,
            factionId: testFaction.id,
          },
        },
      });

      expect(standing?.isAllied).toBe(false);
      expect(standing?.isNeutral).toBe(true);
    });

    it("should fail to leave if not in any faction", async () => {
      const result = await factionService.leaveFaction(testUser.id);

      expect(result.success).toBe(false);
      expect(result.message).toContain("not in any faction");
    });

    it("should allow rejoining after leaving", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);
      await factionService.leaveFaction(testUser.id);

      const result = await factionService.joinFaction(
        testUser.id,
        testFaction.id,
      );

      expect(result.success).toBe(true);
    });
  });

  // ==================== USER FACTION ====================

  describe("Get User Faction", () => {
    it("should return user's current faction membership", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const membership = await factionService.getUserFaction(testUser.id);

      expect(membership).toBeDefined();
      expect(membership?.userId).toBe(testUser.id);
      expect(membership?.factionId).toBe(testFaction.id);
      expect(membership?.faction).toBeDefined();
      expect(membership?.faction.name).toBe(testFaction.name);
    });

    it("should return null if user is not in any faction", async () => {
      const membership = await factionService.getUserFaction(testUser.id);

      expect(membership).toBeNull();
    });

    it("should include faction details in response", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const membership = await factionService.getUserFaction(testUser.id);

      expect(membership?.faction).toBeDefined();
      expect(membership?.faction.id).toBe(testFaction.id);
      expect(membership?.faction.description).toBe(testFaction.description);
    });
  });

  // ==================== REPUTATION ====================

  describe("Reputation Management", () => {
    it("should get user's reputation with faction", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(0);
    });

    it("should return 0 reputation if no standing exists", async () => {
      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(0);
    });

    it("should add positive reputation", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      await factionService.addReputation(testUser.id, testFaction.id, 50);

      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(50);
    });

    it("should add negative reputation", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      await factionService.addReputation(testUser.id, testFaction.id, -30);

      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(-30);
    });

    it("should accumulate reputation changes", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      await factionService.addReputation(testUser.id, testFaction.id, 25);
      await factionService.addReputation(testUser.id, testFaction.id, 25);
      await factionService.addReputation(testUser.id, testFaction.id, -10);

      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(40);
    });

    it("should update member reputation when member exists", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);

      await factionService.addReputation(testUser.id, testFaction.id, 75);

      const membership = await testDb.factionMember.findFirst({
        where: {
          userId: testUser.id,
          factionId: testFaction.id,
        },
      });

      expect(membership?.reputation).toBe(75);
    });

    it("should create standing if user is not a member", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, 20);

      const standing = await testDb.factionStanding.findUnique({
        where: {
          userId_factionId: {
            userId: testUser.id,
            factionId: testFaction.id,
          },
        },
      });

      expect(standing).toBeDefined();
      expect(standing?.reputation).toBe(20);
    });

    it("should track last reputation change", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, 50);

      const standing = await testDb.factionStanding.findUnique({
        where: {
          userId_factionId: {
            userId: testUser.id,
            factionId: testFaction.id,
          },
        },
      });

      expect(standing?.lastChange).toBe(50);
    });

    it("should track last action type for positive reputation", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, 10);

      const standing = await testDb.factionStanding.findUnique({
        where: {
          userId_factionId: {
            userId: testUser.id,
            factionId: testFaction.id,
          },
        },
      });

      expect(standing?.lastAction).toBe("reputation_gain");
    });

    it("should track last action type for negative reputation", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, -15);

      const standing = await testDb.factionStanding.findUnique({
        where: {
          userId_factionId: {
            userId: testUser.id,
            factionId: testFaction.id,
          },
        },
      });

      expect(standing?.lastAction).toBe("reputation_loss");
    });
  });

  // ==================== FACTION MISSIONS ====================

  describe("Faction Missions", () => {
    it("should get available missions for faction", async () => {
      // Create some test missions
      await testDb.mission.create({
        data: {
          title: "Test Mission 1",
          description: "First test mission",
          type: "hack",
          difficulty: 1,
          status: "available",
          factionId: testFaction.id,
          createdBy: testUser.id,
          reward: { credits: 100 },
          objectives: [{ type: "test" }],
        },
      });

      await testDb.mission.create({
        data: {
          title: "Test Mission 2",
          description: "Second test mission",
          type: "intel",
          difficulty: 2,
          status: "available",
          factionId: testFaction.id,
          createdBy: testUser.id,
          reward: { credits: 200 },
          objectives: [{ type: "test" }],
        },
      });

      const missions = await factionService.getFactionMissions(testFaction.id);

      expect(missions).toBeDefined();
      expect(Array.isArray(missions)).toBe(true);
      expect(missions.length).toBe(2);
    });

    it("should only return available missions", async () => {
      await testDb.mission.create({
        data: {
          title: "Available Mission",
          description: "Should be returned",
          type: "hack",
          difficulty: 1,
          status: "available",
          factionId: testFaction.id,
          createdBy: testUser.id,
          reward: { credits: 100 },
          objectives: [{ type: "test" }],
        },
      });

      await testDb.mission.create({
        data: {
          title: "Completed Mission",
          description: "Should not be returned",
          type: "hack",
          difficulty: 1,
          status: "completed",
          factionId: testFaction.id,
          createdBy: testUser.id,
          reward: { credits: 100 },
          objectives: [{ type: "test" }],
        },
      });

      const missions = await factionService.getFactionMissions(testFaction.id);

      expect(missions.length).toBe(1);
      expect(missions[0]?.status).toBe("available");
    });

    it("should return empty array if faction has no missions", async () => {
      const missions = await factionService.getFactionMissions(testFaction.id);

      expect(missions).toBeDefined();
      expect(Array.isArray(missions)).toBe(true);
      expect(missions.length).toBe(0);
    });

    it("should not return missions from other factions", async () => {
      await testDb.mission.create({
        data: {
          title: "Other Faction Mission",
          description: "Belongs to another faction",
          type: "hack",
          difficulty: 1,
          status: "available",
          factionId: testFaction2.id,
          createdBy: testUser.id,
          reward: { credits: 100 },
          objectives: [{ type: "test" }],
        },
      });

      const missions = await factionService.getFactionMissions(testFaction.id);

      expect(missions.length).toBe(0);
    });
  });

  // ==================== FACTION SERVERS ====================

  describe("Faction Servers", () => {
    it("should get servers owned by faction", async () => {
      // Create test servers
      await testDb.gameServer.create({
        data: {
          name: "Faction Server 1",
          ipAddress: "10.0.0.10",
          type: "corporate",
          securityLevel: 3,
          firewallLevel: 2,
          encryptionLevel: 1,
          discoveryLevel: 1,
          factionId: testFaction.id,
        },
      });

      await testDb.gameServer.create({
        data: {
          name: "Faction Server 2",
          ipAddress: "10.0.0.11",
          type: "military",
          securityLevel: 5,
          firewallLevel: 4,
          encryptionLevel: 3,
          discoveryLevel: 2,
          factionId: testFaction.id,
        },
      });

      const servers = await factionService.getFactionServers(testFaction.id);

      expect(servers).toBeDefined();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers.length).toBe(2);
    });

    it("should return empty array if faction has no servers", async () => {
      const servers = await factionService.getFactionServers(testFaction.id);

      expect(servers).toBeDefined();
      expect(Array.isArray(servers)).toBe(true);
      expect(servers.length).toBe(0);
    });

    it("should not return servers from other factions", async () => {
      await testDb.gameServer.create({
        data: {
          name: "Other Faction Server",
          ipAddress: "10.0.0.20",
          type: "corporate",
          securityLevel: 3,
          firewallLevel: 2,
          encryptionLevel: 1,
          discoveryLevel: 1,
          factionId: testFaction2.id,
        },
      });

      const servers = await factionService.getFactionServers(testFaction.id);

      expect(servers.length).toBe(0);
    });
  });

  // ==================== EDGE CASES ====================

  describe("Edge Cases", () => {
    it("should handle non-existent user gracefully", async () => {
      const result = await factionService.joinFaction(
        "nonexistent-user-id",
        testFaction.id,
      );

      expect(result.success).toBe(false);
    });

    it("should handle very high reputation values", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, 999999);

      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(999999);
    });

    it("should handle very low reputation values", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, -999999);

      const reputation = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );

      expect(reputation).toBe(-999999);
    });

    it("should handle rapid join/leave cycles", async () => {
      await factionService.joinFaction(testUser.id, testFaction.id);
      await factionService.leaveFaction(testUser.id);
      await factionService.joinFaction(testUser.id, testFaction.id);
      await factionService.leaveFaction(testUser.id);

      const membership = await testDb.factionMember.findFirst({
        where: { userId: testUser.id },
      });

      expect(membership).toBeNull();
    });

    it("should maintain separate reputations for different factions", async () => {
      await factionService.addReputation(testUser.id, testFaction.id, 50);
      await factionService.addReputation(testUser.id, testFaction2.id, -30);

      const rep1 = await factionService.getFactionReputation(
        testUser.id,
        testFaction.id,
      );
      const rep2 = await factionService.getFactionReputation(
        testUser.id,
        testFaction2.id,
      );

      expect(rep1).toBe(50);
      expect(rep2).toBe(-30);
    });
  });
});
