import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { db } from "../database/client";
import { HackMethod } from "../types/game";
import { hackService } from "../services/hackService";

describe("HackService", () => {
  let attackerId: string;
  let targetId: string;
  let serverId: string;

  beforeAll(async () => {
    // Initialize database connection
    await db.connect();

    // Create test users
    const attacker = await db.client.user.create({
      data: {
        username: "test_attacker",
        email: "attacker@test.com",
        passwordHash: "test_hash",
        progress: {
          create: {
            level: 10,
            experience: 1000,
            hacking: 50,
            stealth: 40,
            security: 30,
          },
        },
      },
    });
    attackerId = attacker.id;

    const target = await db.client.user.create({
      data: {
        username: "test_target",
        email: "target@test.com",
        passwordHash: "test_hash",
        progress: {
          create: {
            level: 8,
            experience: 800,
            hacking: 30,
            stealth: 20,
            security: 40,
          },
        },
      },
    });
    targetId = target.id;

    // Create test server
    const server = await db.client.gameServer.create({
      data: {
        name: "test_server",
        ipAddress: "192.168.1.100",
        ownerId: targetId,
        type: "personal",
        securityLevel: 30,
        encryptionLevel: 2,
        firewallActive: true,
      },
    });
    serverId = server.id;
  });

  afterAll(async () => {
    // Cleanup test data
    if (serverId) {
      await db.client.gameServer
        .delete({ where: { id: serverId } })
        .catch(() => {});
    }
    if (attackerId) {
      await db.client.user
        .delete({ where: { id: attackerId } })
        .catch(() => {});
    }
    if (targetId) {
      await db.client.user.delete({ where: { id: targetId } }).catch(() => {});
    }

    await db.disconnect();
  });

  beforeEach(() => {
    // Clear cooldowns before each test
    hackService.clearCooldown(attackerId);
  });

  describe("processHackAttempt", () => {
    it("should successfully process a hack attempt", async () => {
      const result = await hackService.processHackAttempt(
        attackerId,
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("detected");
      expect(result).toHaveProperty("accessLevel");
      expect(result).toHaveProperty("message");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.detected).toBe("boolean");
      expect(typeof result.accessLevel).toBe("number");
    });

    it("should reject hack attempt against own server", async () => {
      const result = await hackService.processHackAttempt(
        targetId,
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("cannot hack your own");
    });

    it("should apply cooldown after hack attempt", async () => {
      await hackService.processHackAttempt(
        attackerId,
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(hackService.isOnCooldown(attackerId)).toBe(true);
      const remaining = hackService.getRemainingCooldown(attackerId);
      expect(remaining).toBeGreaterThan(0);
    });

    it("should reject hack during cooldown period", async () => {
      // First hack
      await hackService.processHackAttempt(
        attackerId,
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      // Second hack (should be rejected)
      const result = await hackService.processHackAttempt(
        attackerId,
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Cooldown active");
    });

    it("should handle different hack methods", async () => {
      const methods = [
        HackMethod.BRUTEFORCE,
        HackMethod.EXPLOIT,
        HackMethod.SOCIAL,
        HackMethod.BACKDOOR,
        HackMethod.SQL_INJECTION,
        HackMethod.PHISHING,
        HackMethod.ROOTKIT,
      ];

      for (const method of methods) {
        hackService.clearCooldown(attackerId);

        const result = await hackService.processHackAttempt(
          attackerId,
          targetId,
          serverId,
          method,
          [],
        );

        expect(result).toBeDefined();
        expect(result).toHaveProperty("success");
      }
    });

    it("should apply tool bonuses", async () => {
      const tools = ["scanner", "exploitkit", "proxychains"];

      const result = await hackService.processHackAttempt(
        attackerId,
        targetId,
        serverId,
        HackMethod.EXPLOIT,
        tools,
      );

      expect(result).toBeDefined();
      expect(result).toHaveProperty("success");
    });

    it("should generate evidence when detected", async () => {
      // Run multiple attempts to increase chance of detection
      let detectedAttempt: any = null;

      for (let i = 0; i < 10; i++) {
        hackService.clearCooldown(attackerId);

        const result = await hackService.processHackAttempt(
          attackerId,
          targetId,
          serverId,
          HackMethod.BRUTEFORCE,
          [],
        );

        if (result.detected) {
          detectedAttempt = result;
          break;
        }
      }

      // If we got a detected attempt, verify evidence
      if (detectedAttempt) {
        expect((detectedAttempt as any).evidenceLeft).toBeGreaterThan(0);
        expect((detectedAttempt as any).counterMeasures).toBeDefined();
        expect(Array.isArray((detectedAttempt as any).counterMeasures)).toBe(
          true,
        );
      }
    });

    it("should discover files on successful hack", async () => {
      // Run multiple attempts to get a success
      let successfulHack: any = null;

      for (let i = 0; i < 20; i++) {
        hackService.clearCooldown(attackerId);

        const result = await hackService.processHackAttempt(
          attackerId,
          targetId,
          serverId,
          HackMethod.BRUTEFORCE,
          ["exploitkit", "zero_day"],
        );

        if (result.success) {
          successfulHack = result;
          break;
        }
      }

      if (successfulHack) {
        expect((successfulHack as any).accessLevel).toBeGreaterThan(0);
        expect(Array.isArray((successfulHack as any).discoveredFiles)).toBe(
          true,
        );
      }
    });

    it("should handle invalid attacker", async () => {
      const result = await hackService.processHackAttempt(
        "invalid_id",
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
    });

    it("should handle invalid target", async () => {
      const result = await hackService.processHackAttempt(
        attackerId,
        "invalid_id",
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
    });

    it("should handle invalid server", async () => {
      const result = await hackService.processHackAttempt(
        attackerId,
        targetId,
        "invalid_id",
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
    });
  });

  describe("getHackHistory", () => {
    it("should retrieve hack history for a user", async () => {
      // Perform a hack first
      hackService.clearCooldown(attackerId);
      await hackService.processHackAttempt(
        attackerId,
        targetId,
        serverId,
        HackMethod.BRUTEFORCE,
        [],
      );

      // Wait a bit for database write
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const history = await hackService.getHackHistory(attackerId, 1, 10);

      expect(history.success).toBe(true);
      expect(history.data).toBeDefined();
      expect(Array.isArray(history.data)).toBe(true);
      expect(history.pagination).toBeDefined();
    });
  });

  describe("getSecurityAlerts", () => {
    it("should retrieve security alerts for a user", async () => {
      const alerts = await hackService.getSecurityAlerts(targetId);

      expect(alerts).toBeDefined();
      expect(alerts).toHaveProperty("success");
      expect(alerts).toHaveProperty("data");
    });
  });

  describe("getStats", () => {
    it("should return service statistics", () => {
      const stats = hackService.getStats() as any;

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty("activeCooldowns");
      expect(stats).toHaveProperty("activeHacks");
      expect(stats).toHaveProperty("cooldownDuration");
      expect(typeof stats.activeCooldowns).toBe("number");
      expect(typeof stats.activeHacks).toBe("number");
      expect(typeof stats.cooldownDuration).toBe("number");
    });
  });

  describe("cooldown management", () => {
    it("should correctly track cooldown state", () => {
      expect(hackService.isOnCooldown(attackerId)).toBe(false);

      hackService["applyCooldown"](attackerId);

      expect(hackService.isOnCooldown(attackerId)).toBe(true);
    });

    it("should clear cooldown", () => {
      hackService["applyCooldown"](attackerId);
      expect(hackService.isOnCooldown(attackerId)).toBe(true);

      hackService.clearCooldown(attackerId);
      expect(hackService.isOnCooldown(attackerId)).toBe(false);
    });

    it("should return correct remaining cooldown time", () => {
      hackService["applyCooldown"](attackerId);

      const remaining = hackService.getRemainingCooldown(attackerId);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30);
    });

    it("should automatically cleanup expired cooldowns", () => {
      hackService["applyCooldown"](attackerId);

      // Manually expire the cooldown
      const cooldowns = hackService["cooldowns"];
      const pastDate = new Date(Date.now() - 60000); // 1 minute ago
      cooldowns.set(attackerId, pastDate);

      hackService.cleanupCooldowns();

      expect(hackService.isOnCooldown(attackerId)).toBe(false);
    });
  });
});
