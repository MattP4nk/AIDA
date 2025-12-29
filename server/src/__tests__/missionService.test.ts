/**
 * MissionService Integration Tests
 * Tests mission creation, assignment, completion, objectives, rewards, and expiration
 */

import "reflect-metadata";
import { container } from "tsyringe";
import * as TOKENS from "../di/tokens";
import MissionService from "../services/missionService";
import { testDb, createTestUser } from "./setup";

describe("MissionService Integration Tests", () => {
  let missionService: MissionService;

  beforeAll(() => {
    missionService = container.resolve(TOKENS.MISSION_SERVICE as any);
  });

  // Helper to create a test mission
  const createTestMission = async (data?: {
    title?: string;
    type?: string;
    difficulty?: number;
    reward?: any;
    timeLimit?: number;
    objectives?: any[];
    createdBy?: string;
  }) => {
    // Create a system user if createdBy not provided
    let creatorId = data?.createdBy;
    if (!creatorId) {
      const systemUser = await testDb.user.findFirst({
        where: { username: "system" },
      });

      if (!systemUser) {
        const created = await createTestUser({
          username: "system",
          email: "system@aida.com",
        });
        creatorId = created.id;
      } else {
        creatorId = systemUser.id;
      }
    }

    const missionData: any = {
      title: data?.title || "Test Mission",
      description: "A test mission",
      type: data?.type || "hack",
      difficulty: data?.difficulty ?? 1,
      requiredSkills: {},
      reward: data?.reward || { xp: 100, credits: 50 },
      objectives: data?.objectives || [
        {
          id: "obj1",
          type: "count",
          description: "Complete objective",
          target: 5,
          current: 0,
          completed: false,
        },
      ],
      createdBy: creatorId,
    };

    if (data?.timeLimit !== undefined) {
      missionData.timeLimit = data.timeLimit;
    }

    return await missionService.createMission(missionData);
  };

  // ==================== MISSION CREATION ====================

  describe("Mission Creation", () => {
    it("should create a mission successfully", async () => {
      const mission = await createTestMission({
        title: "Hack Target Server",
        type: "hack",
        difficulty: 2,
      });

      expect(mission).toBeDefined();
      expect(mission.title).toBe("Hack Target Server");
      expect(mission.type).toBe("hack");
      expect(mission.difficulty).toBe(2);
      expect(mission.status).toBe("available");
    });

    it("should create mission with objectives", async () => {
      const objectives = [
        {
          id: "obj1",
          type: "count",
          description: "Hack 3 servers",
          target: 3,
          current: 0,
          completed: false,
        },
        {
          id: "obj2",
          type: "boolean",
          description: "Remain undetected",
          target: true,
          current: false,
          completed: false,
        },
      ];

      const mission = await createTestMission({ objectives });

      expect(mission.objectives).toBeDefined();
      expect(Array.isArray(mission.objectives)).toBe(true);
    });

    it("should create mission with rewards", async () => {
      const reward = {
        xp: 500,
        credits: 250,
        items: ["item1"],
        reputation: 10,
      };

      const mission = await createTestMission({ reward });

      expect(mission.reward).toBeDefined();
    });

    it("should create mission with time limit", async () => {
      const mission = await createTestMission({ timeLimit: 3600 });

      expect(mission.timeLimit).toBe(3600);
    });

    it("should handle mission creation errors gracefully", async () => {
      // Test with invalid data
      await expect(
        missionService.createMission({
          title: "",
          description: "",
          type: "",
          difficulty: -1,
          reward: { xp: 0, credits: 0 },
          objectives: [],
          createdBy: "",
        }),
      ).rejects.toThrow();
    });
  });

  // ==================== MISSION RETRIEVAL ====================

  describe("Mission Retrieval", () => {
    it("should get mission by ID", async () => {
      const created = await createTestMission({ title: "Get Mission Test" });

      const mission = await missionService.getMission(created.id);

      expect(mission).not.toBeNull();
      expect(mission?.id).toBe(created.id);
      expect(mission?.title).toBe("Get Mission Test");
    });

    it("should return null for non-existent mission", async () => {
      const mission = await missionService.getMission("non-existent-id");

      expect(mission).toBeNull();
    });

    it("should cache mission data", async () => {
      const created = await createTestMission();

      // First call - should fetch from DB
      await missionService.getMission(created.id);

      // Second call - should fetch from cache (faster)
      const start = Date.now();
      const mission = await missionService.getMission(created.id);
      const duration = Date.now() - start;

      expect(mission).not.toBeNull();
      expect(duration).toBeLessThan(10); // Cache should be very fast
    });

    it("should get available missions for player", async () => {
      const user = await createTestUser({
        username: "missiongetter1",
        email: "missiongetter1@test.com",
      });

      // Update user level
      await testDb.playerProgress.update({
        where: { userId: user.id },
        data: { level: 5 },
      });

      // Create missions at different difficulties
      await createTestMission({ difficulty: 3 });
      await createTestMission({ difficulty: 5 });
      await createTestMission({ difficulty: 7 });

      const missions = await missionService.getAvailableMissions(user.id);

      // Should return missions within ±2 levels (3, 5, 7 are all valid)
      expect(missions.length).toBeGreaterThan(0);
      expect(missions.every((m) => m.status === "available")).toBe(true);
    });

    it("should return empty array for user without progress", async () => {
      const missions =
        await missionService.getAvailableMissions("non-existent-user");

      expect(missions).toEqual([]);
    });
  });

  // ==================== MISSION UPDATE ====================

  describe("Mission Update", () => {
    it("should update mission properties", async () => {
      const mission = await createTestMission({ title: "Original Title" });

      const updated = await missionService.updateMission(mission.id, {
        title: "Updated Title",
        difficulty: 5,
      });

      expect(updated.title).toBe("Updated Title");
      expect(updated.difficulty).toBe(5);
    });

    it("should invalidate cache on update", async () => {
      const mission = await createTestMission();

      // Cache the mission
      await missionService.getMission(mission.id);

      // Update it
      await missionService.updateMission(mission.id, {
        title: "Cache Test Updated",
      });

      // Get it again - should have new data
      const updated = await missionService.getMission(mission.id);
      expect(updated?.title).toBe("Cache Test Updated");
    });
  });

  // ==================== MISSION DELETION ====================

  describe("Mission Deletion", () => {
    it("should delete a mission", async () => {
      const mission = await createTestMission({ title: "To Delete" });

      await missionService.deleteMission(mission.id);

      const deleted = await missionService.getMission(mission.id);
      expect(deleted).toBeNull();
    });

    it("should handle deleting non-existent mission", async () => {
      await expect(
        missionService.deleteMission("non-existent-id"),
      ).rejects.toThrow();
    });
  });

  // ==================== MISSION ASSIGNMENT ====================

  describe("Mission Assignment", () => {
    it("should assign mission to player", async () => {
      const user = await createTestUser({
        username: "assignee1",
        email: "assignee1@test.com",
      });
      const mission = await createTestMission({ title: "Assign Test" });

      const playerMission = await missionService.assignMission(
        user.id,
        mission.id,
      );

      expect(playerMission).toBeDefined();
      expect(playerMission.userId).toBe(user.id);
      expect(playerMission.missionId).toBe(mission.id);
      expect(playerMission.status).toBe("assigned");
      expect(playerMission.objectives).toBeDefined();
      expect(playerMission.objectives.length).toBeGreaterThan(0);
    });

    it("should fail to assign non-existent mission", async () => {
      const user = await createTestUser({
        username: "assignee2",
        email: "assignee2@test.com",
      });

      await expect(
        missionService.assignMission(user.id, "non-existent-id"),
      ).rejects.toThrow();
    });

    it("should fail to assign already assigned mission", async () => {
      const user = await createTestUser({
        username: "assignee3",
        email: "assignee3@test.com",
      });
      const mission = await createTestMission();

      // Assign once
      await missionService.assignMission(user.id, mission.id);

      // Try to assign again
      await expect(
        missionService.assignMission(user.id, mission.id),
      ).rejects.toThrow("not available");
    });

    it("should set expiration for timed missions", async () => {
      const user = await createTestUser({
        username: "timeduser1",
        email: "timeduser1@test.com",
      });
      const mission = await createTestMission({ timeLimit: 3600 });

      const playerMission = await missionService.assignMission(
        user.id,
        mission.id,
      );

      expect(playerMission.expiresAt).not.toBeNull();
    });

    it("should not set expiration for untimed missions", async () => {
      const user = await createTestUser({
        username: "untimeduser1",
        email: "untimeduser1@test.com",
      });
      const mission = await createTestMission();

      const playerMission = await missionService.assignMission(
        user.id,
        mission.id,
      );

      expect(playerMission.expiresAt).toBeNull();
    });
  });

  // ==================== MISSION ACCEPTANCE ====================

  describe("Mission Acceptance", () => {
    it("should accept an assigned mission", async () => {
      const user = await createTestUser({
        username: "accepter1",
        email: "accepter1@test.com",
      });
      const mission = await createTestMission();

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      const missions = await missionService.getPlayerMissions(
        user.id,
        "active",
      );

      expect(missions.length).toBe(1);
      expect(missions[0]?.status).toBe("active");
      expect(missions[0]?.startedAt).toBeDefined();
    });

    it("should fail to accept unassigned mission", async () => {
      const user = await createTestUser({
        username: "accepter2",
        email: "accepter2@test.com",
      });
      const mission = await createTestMission();

      await expect(
        missionService.acceptMission(user.id, mission.id),
      ).rejects.toThrow();
    });

    it("should fail to accept mission not in assigned state", async () => {
      const user = await createTestUser({
        username: "accepter3",
        email: "accepter3@test.com",
      });
      const mission = await createTestMission();

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      // Try to accept again
      await expect(
        missionService.acceptMission(user.id, mission.id),
      ).rejects.toThrow();
    });
  });

  // ==================== MISSION ABANDONMENT ====================

  describe("Mission Abandonment", () => {
    it("should abandon a mission", async () => {
      const user = await createTestUser({
        username: "abandoner1",
        email: "abandoner1@test.com",
      });
      const mission = await createTestMission();

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);
      await missionService.abandonMission(user.id, mission.id);

      const missions = await missionService.getPlayerMissions(
        user.id,
        "failed",
      );

      expect(missions.length).toBe(1);
      expect(missions[0]?.status).toBe("failed");

      // Mission should be available again
      const missionData = await missionService.getMission(mission.id);
      expect(missionData?.status).toBe("available");
    });

    it("should fail to abandon unassigned mission", async () => {
      const user = await createTestUser({
        username: "abandoner2",
        email: "abandoner2@test.com",
      });
      const mission = await createTestMission();

      await expect(
        missionService.abandonMission(user.id, mission.id),
      ).rejects.toThrow();
    });
  });

  // ==================== PLAYER MISSIONS ====================

  describe("Player Missions", () => {
    it("should get all player missions", async () => {
      const user = await createTestUser({
        username: "playeruser1",
        email: "playeruser1@test.com",
      });

      const mission1 = await createTestMission({ title: "Mission 1" });
      const mission2 = await createTestMission({ title: "Mission 2" });

      await missionService.assignMission(user.id, mission1.id);
      await missionService.assignMission(user.id, mission2.id);

      const missions = await missionService.getPlayerMissions(user.id);

      expect(missions.length).toBe(2);
    });

    it("should filter missions by status", async () => {
      const user = await createTestUser({
        username: "filteruser1",
        email: "filteruser1@test.com",
      });

      const mission1 = await createTestMission({ title: "Active Mission" });
      const mission2 = await createTestMission({ title: "Assigned Mission" });

      await missionService.assignMission(user.id, mission1.id);
      await missionService.assignMission(user.id, mission2.id);

      await missionService.acceptMission(user.id, mission1.id);

      const activeMissions = await missionService.getPlayerMissions(
        user.id,
        "active",
      );
      const assignedMissions = await missionService.getPlayerMissions(
        user.id,
        "assigned",
      );

      expect(activeMissions.length).toBe(1);
      expect(assignedMissions.length).toBe(1);
    });

    it("should return empty array for user with no missions", async () => {
      const user = await createTestUser({
        username: "nomissions1",
        email: "nomissions1@test.com",
      });

      const missions = await missionService.getPlayerMissions(user.id);

      expect(missions).toEqual([]);
    });
  });

  // ==================== OBJECTIVE UPDATES ====================

  describe("Objective Updates", () => {
    it("should update count objective", async () => {
      const user = await createTestUser({
        username: "objuser1",
        email: "objuser1@test.com",
      });
      const mission = await createTestMission({
        objectives: [
          {
            id: "count_obj",
            type: "count",
            description: "Complete 5 tasks",
            target: 5,
            current: 0,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      await missionService.updateObjective(user.id, mission.id, "count_obj", 3);

      const isCompleted = await missionService.checkObjectiveCompletion(
        user.id,
        mission.id,
        "count_obj",
      );

      expect(isCompleted).toBe(false);

      // Complete it
      await missionService.updateObjective(user.id, mission.id, "count_obj", 2);

      const isNowCompleted = await missionService.checkObjectiveCompletion(
        user.id,
        mission.id,
        "count_obj",
      );

      expect(isNowCompleted).toBe(true);
    });

    it("should update boolean objective", async () => {
      const user = await createTestUser({
        username: "boolobjuser1",
        email: "boolobjuser1@test.com",
      });
      const mission = await createTestMission({
        objectives: [
          {
            id: "bool_obj",
            type: "boolean",
            description: "Remain undetected",
            target: true,
            current: false,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      await missionService.updateObjective(
        user.id,
        mission.id,
        "bool_obj",
        true,
      );

      const isCompleted = await missionService.checkObjectiveCompletion(
        user.id,
        mission.id,
        "bool_obj",
      );

      expect(isCompleted).toBe(true);
    });

    it("should not exceed target for count objectives", async () => {
      const user = await createTestUser({
        username: "maxcount1",
        email: "maxcount1@test.com",
      });
      const mission = await createTestMission({
        objectives: [
          {
            id: "max_obj",
            type: "count",
            description: "Complete 3 tasks",
            target: 3,
            current: 0,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      // Try to add more than target
      await missionService.updateObjective(user.id, mission.id, "max_obj", 10);

      // Mission will be auto-completed when objective reaches target, so don't filter by status
      const missions = await missionService.getPlayerMissions(user.id);

      const objective = missions[0]?.objectives.find(
        (obj: any) => obj.id === "max_obj",
      );

      expect(objective?.current).toBe(3); // Should cap at target
      expect(objective?.completed).toBe(true);
      expect(missions[0]?.status).toBe("completed");
    });

    it("should not update objectives for non-active missions", async () => {
      const user = await createTestUser({
        username: "inactivemission1",
        email: "inactivemission1@test.com",
      });
      const mission = await createTestMission();

      await missionService.assignMission(user.id, mission.id);

      // Don't accept the mission (status = assigned, not active)
      await missionService.updateObjective(user.id, mission.id, "obj1", 5);

      // Objective should not be updated since mission is not active
      const missions = await missionService.getPlayerMissions(user.id);
      const objective = missions[0]?.objectives[0];
      expect(objective?.current).toBe(0);
    });
  });

  // ==================== MISSION COMPLETION ====================

  describe("Mission Completion", () => {
    it("should complete mission and grant rewards", async () => {
      const user = await createTestUser({
        username: "completer1",
        email: "completer1@test.com",
      });

      const initialProgress = await testDb.playerProgress.findUnique({
        where: { userId: user.id },
      });

      const mission = await createTestMission({
        reward: { xp: 500, credits: 250 },
        objectives: [
          {
            id: "simple_obj",
            type: "boolean",
            description: "Complete task",
            target: true,
            current: false,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);
      await missionService.updateObjective(
        user.id,
        mission.id,
        "simple_obj",
        true,
      );

      // Mission should auto-complete
      const finalProgress = await testDb.playerProgress.findUnique({
        where: { userId: user.id },
      });

      expect(finalProgress!.experience).toBeGreaterThan(
        initialProgress!.experience,
      );
      expect(finalProgress!.credits).toBeGreaterThan(initialProgress!.credits);
    });

    it("should update mission status to completed", async () => {
      const user = await createTestUser({
        username: "statuschecker1",
        email: "statuschecker1@test.com",
      });
      const mission = await createTestMission({
        objectives: [
          {
            id: "obj1",
            type: "boolean",
            description: "Task",
            target: true,
            current: false,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);
      await missionService.updateObjective(user.id, mission.id, "obj1", true);

      const missions = await missionService.getPlayerMissions(
        user.id,
        "completed",
      );

      expect(missions.length).toBe(1);
      expect(missions[0]?.status).toBe("completed");
      expect(missions[0]?.completedAt).toBeDefined();
    });

    it("should fail to complete already completed mission", async () => {
      const user = await createTestUser({
        username: "doublecomplete1",
        email: "doublecomplete1@test.com",
      });
      const mission = await createTestMission({
        objectives: [
          {
            id: "obj1",
            type: "boolean",
            description: "Task",
            target: true,
            current: false,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);
      await missionService.updateObjective(user.id, mission.id, "obj1", true);

      // Try to complete again
      await expect(
        missionService.completeMission(user.id, mission.id),
      ).rejects.toThrow();
    });
  });

  // ==================== REWARD CALCULATION ====================

  describe("Reward Calculation", () => {
    it("should calculate base rewards", async () => {
      const mission = await createTestMission({
        reward: { xp: 1000, credits: 500 },
      });

      const rewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      expect(rewards.xp).toBeGreaterThanOrEqual(1000);
      expect(rewards.credits).toBeGreaterThanOrEqual(500);
    });

    it("should apply time bonus for fast completion", async () => {
      const mission = await createTestMission({
        reward: { xp: 1000, credits: 500 },
        timeLimit: 3600,
      });

      const slowRewards = missionService.calculateRewards(mission, {
        timeElapsed: 3000000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      const fastRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      expect(fastRewards.xp).toBeGreaterThan(slowRewards.xp);
    });

    it("should apply stealth bonus", async () => {
      const mission = await createTestMission({
        reward: { xp: 1000, credits: 500 },
      });

      const normalRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      const stealthRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 95,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      expect(stealthRewards.xp).toBeGreaterThan(normalRewards.xp);
    });

    it("should apply efficiency bonus", async () => {
      const mission = await createTestMission({
        reward: { xp: 1000, credits: 500 },
      });

      const normalRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      const efficientRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 50,
        efficiencyScore: 95,
        bonusObjectivesCompleted: 0,
      });

      expect(efficientRewards.xp).toBeGreaterThan(normalRewards.xp);
    });

    it("should apply bonus objectives multiplier", async () => {
      const mission = await createTestMission({
        reward: { xp: 1000, credits: 500 },
      });

      const baseRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 0,
      });

      const bonusRewards = missionService.calculateRewards(mission, {
        timeElapsed: 1000,
        stealthScore: 50,
        efficiencyScore: 50,
        bonusObjectivesCompleted: 3,
      });

      expect(bonusRewards.xp).toBeGreaterThan(baseRewards.xp);
    });
  });

  // ==================== MISSION EXPIRATION ====================

  describe("Mission Expiration", () => {
    it("should expire a mission manually", async () => {
      const user = await createTestUser({
        username: "expireuser1",
        email: "expireuser1@test.com",
      });
      const mission = await createTestMission();

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      await missionService.expireMission(user.id, mission.id);

      const missions = await missionService.getPlayerMissions(
        user.id,
        "expired",
      );

      expect(missions.length).toBe(1);
      expect(missions[0]?.status).toBe("expired");

      // Mission should be available again
      const missionData = await missionService.getMission(mission.id);
      expect(missionData?.status).toBe("available");
    });

    it("should fail to expire unassigned mission", async () => {
      const user = await createTestUser({
        username: "expireuser2",
        email: "expireuser2@test.com",
      });
      const mission = await createTestMission();

      await expect(
        missionService.expireMission(user.id, mission.id),
      ).rejects.toThrow();
    });
  });

  // ==================== EDGE CASES ====================

  describe("Edge Cases", () => {
    it("should handle multiple objectives completion", async () => {
      const user = await createTestUser({
        username: "multiobjuser1",
        email: "multiobjuser1@test.com",
      });
      const mission = await createTestMission({
        objectives: [
          {
            id: "obj1",
            type: "count",
            description: "Task 1",
            target: 3,
            current: 0,
            completed: false,
          },
          {
            id: "obj2",
            type: "boolean",
            description: "Task 2",
            target: true,
            current: false,
            completed: false,
          },
          {
            id: "obj3",
            type: "count",
            description: "Task 3",
            target: 5,
            current: 0,
            completed: false,
          },
        ],
      });

      await missionService.assignMission(user.id, mission.id);
      await missionService.acceptMission(user.id, mission.id);

      await missionService.updateObjective(user.id, mission.id, "obj1", 3);
      await missionService.updateObjective(user.id, mission.id, "obj2", true);
      await missionService.updateObjective(user.id, mission.id, "obj3", 5);

      const missions = await missionService.getPlayerMissions(
        user.id,
        "completed",
      );

      expect(missions.length).toBe(1);
      expect(missions[0]?.status).toBe("completed");
    });

    it("should handle mission with no time limit", async () => {
      const mission = await createTestMission();

      expect(mission.timeLimit).toBeNull();
    });

    it("should handle empty objectives array", async () => {
      const mission = await createTestMission({
        objectives: [],
      });

      expect(mission.objectives).toBeDefined();
    });

    it("should handle mission with complex rewards", async () => {
      const mission = await createTestMission({
        reward: {
          xp: 1000,
          credits: 500,
          items: ["item1", "item2"],
          reputation: 25,
          skillPoints: 5,
          unlocks: ["feature1", "feature2"],
        },
      });

      expect(mission.reward).toBeDefined();
    });

    it("should handle zero difficulty mission", async () => {
      const mission = await createTestMission({
        difficulty: 0,
      });

      expect(mission.difficulty).toBe(0);
    });

    it("should handle very high difficulty mission", async () => {
      const mission = await createTestMission({
        difficulty: 100,
      });

      expect(mission.difficulty).toBe(100);
    });
  });
});
