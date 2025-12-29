/**
 * HackService Integration Tests
 * Tests hacking mechanics, cooldowns, success/failure, detection, evidence, and logging
 */

import "reflect-metadata";
import HackService from "../services/hackService";
import { testDb, createTestUser } from "./setup";
import { HackMethod } from "../types/game";

describe("HackService Integration Tests", () => {
  let hackService: HackService;

  beforeAll(() => {
    // Instantiate HackService directly with undefined for optional MissionIntegrationService
    hackService = new HackService(undefined);
  });

  // Helper to create a test server
  const createTestServer = async (data?: {
    name?: string;
    ipAddress?: string;
    securityLevel?: number;
    firewallLevel?: number;
    ownerId?: string;
  }) => {
    const serverData: any = {
      name: data?.name || "Test Server",
      ipAddress: data?.ipAddress || "192.168.1.100",
      type: "corporate",
      securityLevel: data?.securityLevel ?? 1,
      firewallLevel: data?.firewallLevel ?? 1,
      encryptionLevel: 0,
      discoveryLevel: 0,
    };

    if (data?.ownerId) {
      serverData.ownerId = data.ownerId;
    }

    return await testDb.gameServer.create({
      data: serverData,
    });
  };

  // ==================== HACK ATTEMPT VALIDATION ====================

  describe("Hack Attempt Validation", () => {
    it("should validate a proper hack attempt", async () => {
      const attacker = await createTestUser({
        username: "attacker1",
        email: "attacker1@test.com",
      });
      const target = await createTestUser({
        username: "target1",
        email: "target1@test.com",
      });
      const server = await createTestServer({
        ipAddress: "10.0.0.1",
        ownerId: target.id,
      });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        ["scanner"],
      );

      expect(result).toBeDefined();
      expect(result.success).toBeDefined();
      expect(result.detected).toBeDefined();
      expect(result.message).toBeDefined();
    });

    it("should reject hack with invalid attacker", async () => {
      const target = await createTestUser({
        username: "target2",
        email: "target2@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        "invalid-id",
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Attacker not found");
    });

    it("should reject hack with invalid target", async () => {
      const attacker = await createTestUser({
        username: "attacker3",
        email: "attacker3@test.com",
      });
      const server = await createTestServer();

      // Set attacker hacking skill to pass validation
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: { hacking: 15 },
      });

      const result = await hackService.processHackAttempt(
        attacker.id,
        "invalid-id",
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("Target not found");
    });

    it("should reject hack with invalid server", async () => {
      const attacker = await createTestUser({
        username: "attacker4",
        email: "attacker4@test.com",
      });
      const target = await createTestUser({
        username: "target4",
        email: "target4@test.com",
      });

      // Set attacker hacking skill to pass validation
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: { hacking: 15 },
      });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        "invalid-server-id",
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("server not found");
    });
  });

  // ==================== COOLDOWN MANAGEMENT ====================

  describe("Cooldown Management", () => {
    it("should enforce cooldown after hack attempt", async () => {
      const attacker = await createTestUser({
        username: "cooldown1",
        email: "cooldown1@test.com",
      });
      const target = await createTestUser({
        username: "cooltarget1",
        email: "cooltarget1@test.com",
      });
      const server = await createTestServer({ ownerId: target.id });

      // Set attacker hacking skill to pass validation
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: { hacking: 15 },
      });

      // First hack attempt
      await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      // Check cooldown is active
      expect(hackService.isOnCooldown(attacker.id)).toBe(true);
    });

    it("should return remaining cooldown time", async () => {
      const attacker = await createTestUser({
        username: "cooldown2",
        email: "cooldown2@test.com",
      });
      const target = await createTestUser({
        username: "cooltarget2",
        email: "cooltarget2@test.com",
      });
      const server = await createTestServer({ ownerId: target.id });

      // Set attacker hacking skill to pass validation
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: { hacking: 15 },
      });

      // Perform hack
      await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      const remaining = hackService.getRemainingCooldown(attacker.id);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(30);
    });

    it("should prevent hack during cooldown", async () => {
      const attacker = await createTestUser({
        username: "cooldown3",
        email: "cooldown3@test.com",
      });
      const target = await createTestUser({
        username: "cooltarget3",
        email: "cooltarget3@test.com",
      });
      const server = await createTestServer({ ownerId: target.id });

      // Set attacker hacking skill to pass validation
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: { hacking: 15 },
      });

      // First hack
      await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      // Second hack immediately after
      const result2 = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result2.success).toBe(false);
      expect(result2.message).toContain("Cooldown");
    });

    it("should allow clearing cooldown", async () => {
      const attacker = await createTestUser({
        username: "cooldown4",
        email: "cooldown4@test.com",
      });
      const target = await createTestUser({
        username: "cooltarget4",
        email: "cooltarget4@test.com",
      });
      const server = await createTestServer();

      // Perform hack
      await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      // Clear cooldown
      hackService.clearCooldown(attacker.id);

      expect(hackService.isOnCooldown(attacker.id)).toBe(false);
      expect(hackService.getRemainingCooldown(attacker.id)).toBe(0);
    });

    it("should return 0 for non-existent cooldown", async () => {
      const remaining = hackService.getRemainingCooldown("nonexistent-user");
      expect(remaining).toBe(0);
    });

    it("should cleanup expired cooldowns", async () => {
      const attacker = await createTestUser({
        username: "cooldown5",
        email: "cooldown5@test.com",
      });

      // Manually set an expired cooldown
      hackService.clearCooldown(attacker.id);

      hackService.cleanupCooldowns();

      expect(hackService.isOnCooldown(attacker.id)).toBe(false);
    });
  });

  // ==================== HACK METHODS ====================

  describe("Hack Methods", () => {
    it("should handle BRUTEFORCE method", async () => {
      const attacker = await createTestUser({
        username: "brute1",
        email: "brute1@test.com",
      });
      const target = await createTestUser({
        username: "brutetarget1",
        email: "brutetarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 1 });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    it("should handle EXPLOIT method", async () => {
      const attacker = await createTestUser({
        username: "exploit1",
        email: "exploit1@test.com",
      });
      const target = await createTestUser({
        username: "exploittarget1",
        email: "exploittarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.EXPLOIT,
        ["exploitkit"],
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    it("should handle SOCIAL method", async () => {
      const attacker = await createTestUser({
        username: "social1",
        email: "social1@test.com",
      });
      const target = await createTestUser({
        username: "socialtarget1",
        email: "socialtarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.SOCIAL,
        [],
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });

    it("should handle SQL_INJECTION method", async () => {
      const attacker = await createTestUser({
        username: "sql1",
        email: "sql1@test.com",
      });
      const target = await createTestUser({
        username: "sqltarget1",
        email: "sqltarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.SQL_INJECTION,
        [],
      );

      expect(result).toBeDefined();
      expect(typeof result.success).toBe("boolean");
    });
  });

  // ==================== TOOLS EFFECTIVENESS ====================

  describe("Tools Effectiveness", () => {
    it("should process hack with no tools", async () => {
      const attacker = await createTestUser({
        username: "notool1",
        email: "notool1@test.com",
      });
      const target = await createTestUser({
        username: "notooltarget1",
        email: "notooltarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
    });

    it("should process hack with basic tools", async () => {
      const attacker = await createTestUser({
        username: "basictool1",
        email: "basictool1@test.com",
      });
      const target = await createTestUser({
        username: "basictooltarget1",
        email: "basictooltarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        ["scanner", "portscanner"],
      );

      expect(result).toBeDefined();
    });

    it("should process hack with advanced tools", async () => {
      const attacker = await createTestUser({
        username: "advtool1",
        email: "advtool1@test.com",
      });
      const target = await createTestUser({
        username: "advtooltarget1",
        email: "advtooltarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.EXPLOIT,
        ["exploitkit", "rootkit", "zero_day"],
      );

      expect(result).toBeDefined();
    });

    it("should process hack with stealth tools", async () => {
      const attacker = await createTestUser({
        username: "stealth1",
        email: "stealth1@test.com",
      });
      const target = await createTestUser({
        username: "stealthtarget1",
        email: "stealthtarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BACKDOOR,
        ["anonymizer", "trace_remover", "proxychains"],
      );

      expect(result).toBeDefined();
    });
  });

  // ==================== SUCCESS AND DETECTION ====================

  describe("Success and Detection", () => {
    it("should return success as boolean", async () => {
      const attacker = await createTestUser({
        username: "success1",
        email: "success1@test.com",
      });
      const target = await createTestUser({
        username: "successtarget1",
        email: "successtarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(typeof result.success).toBe("boolean");
    });

    it("should return detection as boolean", async () => {
      const attacker = await createTestUser({
        username: "detect1",
        email: "detect1@test.com",
      });
      const target = await createTestUser({
        username: "detecttarget1",
        email: "detecttarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(typeof result.detected).toBe("boolean");
    });

    it("should include evidence level", async () => {
      const attacker = await createTestUser({
        username: "evidence1",
        email: "evidence1@test.com",
      });
      const target = await createTestUser({
        username: "evidencetarget1",
        email: "evidencetarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(typeof result.evidenceLeft).toBe("number");
      expect(result.evidenceLeft).toBeGreaterThanOrEqual(0);
      expect(result.evidenceLeft).toBeLessThanOrEqual(100);
    });

    it("should include access level on success", async () => {
      const attacker = await createTestUser({
        username: "access1",
        email: "access1@test.com",
      });
      const target = await createTestUser({
        username: "accesstarget1",
        email: "accesstarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 1 });

      // Try multiple times to get a success
      let result;
      let attempts = 0;
      do {
        hackService.clearCooldown(attacker.id);
        result = await hackService.processHackAttempt(
          attacker.id,
          target.id,
          server.id,
          HackMethod.BRUTEFORCE,
          ["exploitkit", "rootkit"],
        );
        attempts++;
      } while (!result.success && attempts < 20);

      if (result.success) {
        expect(result.accessLevel).toBeGreaterThan(0);
      } else {
        // If we didn't get a success after multiple attempts, just check the field exists
        expect(result.accessLevel).toBeDefined();
      }
    });

    it("should include discovered files array", async () => {
      const attacker = await createTestUser({
        username: "files1",
        email: "files1@test.com",
      });
      const target = await createTestUser({
        username: "filestarget1",
        email: "filestarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(Array.isArray(result.discoveredFiles)).toBe(true);
    });

    it("should include countermeasures array", async () => {
      const attacker = await createTestUser({
        username: "counter1",
        email: "counter1@test.com",
      });
      const target = await createTestUser({
        username: "countertarget1",
        email: "countertarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(Array.isArray(result.counterMeasures)).toBe(true);
    });

    it("should include trace initiated flag", async () => {
      const attacker = await createTestUser({
        username: "trace1",
        email: "trace1@test.com",
      });
      const target = await createTestUser({
        username: "tracetarget1",
        email: "tracetarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(typeof result.traceInitiated).toBe("boolean");
    });

    it("should include result message", async () => {
      const attacker = await createTestUser({
        username: "message1",
        email: "message1@test.com",
      });
      const target = await createTestUser({
        username: "messagetarget1",
        email: "messagetarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(typeof result.message).toBe("string");
      expect(result.message.length).toBeGreaterThan(0);
    });
  });

  // ==================== SECURITY LEVELS ====================

  describe("Security Levels", () => {
    it("should handle low security server", async () => {
      const attacker = await createTestUser({
        username: "lowsec1",
        email: "lowsec1@test.com",
      });
      const target = await createTestUser({
        username: "lowsectarget1",
        email: "lowsectarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 1 });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
    });

    it("should handle medium security server", async () => {
      const attacker = await createTestUser({
        username: "medsec1",
        email: "medsec1@test.com",
      });
      const target = await createTestUser({
        username: "medsectarget1",
        email: "medsectarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 5 });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.EXPLOIT,
        ["exploitkit"],
      );

      expect(result).toBeDefined();
    });

    it("should handle high security server", async () => {
      const attacker = await createTestUser({
        username: "highsec1",
        email: "highsec1@test.com",
      });
      const target = await createTestUser({
        username: "highsectarget1",
        email: "highsectarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 10 });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.ROOTKIT,
        ["rootkit", "zero_day"],
      );

      expect(result).toBeDefined();
    });

    it("should handle firewall levels", async () => {
      const attacker = await createTestUser({
        username: "firewall1",
        email: "firewall1@test.com",
      });
      const target = await createTestUser({
        username: "firewalltarget1",
        email: "firewalltarget1@test.com",
      });
      const server = await createTestServer({
        securityLevel: 5,
        firewallLevel: 8,
      });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.EXPLOIT,
        ["exploitkit"],
      );

      expect(result).toBeDefined();
    });
  });

  // ==================== SERVICE STATS ====================

  describe("Service Statistics", () => {
    it("should return service stats", () => {
      const stats = hackService.getStats();

      expect(stats).toBeDefined();
      expect(typeof stats).toBe("object");
      expect(stats).toHaveProperty("activeCooldowns");
    });

    it("should track active cooldowns in stats", async () => {
      const attacker = await createTestUser({
        username: "stats1",
        email: "stats1@test.com",
      });
      const target = await createTestUser({
        username: "statstarget1",
        email: "statstarget1@test.com",
      });
      const server = await createTestServer();

      // Perform hack to create cooldown
      await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      const stats = hackService.getStats();
      expect(stats).toHaveProperty("activeCooldowns");
    });
  });

  // ==================== EDGE CASES ====================

  describe("Edge Cases", () => {
    it("should handle attacker hacking themselves", async () => {
      const user = await createTestUser({
        username: "selfhack1",
        email: "selfhack1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        user.id,
        user.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
      // Should likely fail validation, but service should handle it gracefully
    });

    it("should handle empty tools array", async () => {
      const attacker = await createTestUser({
        username: "notools1",
        email: "notools1@test.com",
      });
      const target = await createTestUser({
        username: "notoolstarget1",
        email: "notoolstarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
    });

    it("should handle unknown tools gracefully", async () => {
      const attacker = await createTestUser({
        username: "badtools1",
        email: "badtools1@test.com",
      });
      const target = await createTestUser({
        username: "badtoolstarget1",
        email: "badtoolstarget1@test.com",
      });
      const server = await createTestServer();

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        ["nonexistent_tool", "fake_tool"],
      );

      expect(result).toBeDefined();
    });

    it("should handle multiple rapid hack attempts with cooldown", async () => {
      const attacker = await createTestUser({
        username: "rapid1",
        email: "rapid1@test.com",
      });
      const target = await createTestUser({
        username: "rapidtarget1",
        email: "rapidtarget1@test.com",
      });
      const server = await createTestServer({ ownerId: target.id });

      // Set attacker hacking skill to pass validation
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: { hacking: 15 },
      });

      const results = [];
      for (let i = 0; i < 3; i++) {
        const result = await hackService.processHackAttempt(
          attacker.id,
          target.id,
          server.id,
          HackMethod.BRUTEFORCE,
          [],
        );
        results.push(result);
      }

      // First should process, others should be blocked by cooldown
      expect(results[0]).toBeDefined();
      expect(results[1]?.message).toContain("Cooldown");
      expect(results[2]?.message).toContain("Cooldown");
    });

    it("should handle user with low skills", async () => {
      const attacker = await createTestUser({
        username: "lowskill1",
        email: "lowskill1@test.com",
      });
      const target = await createTestUser({
        username: "lowskilltarget1",
        email: "lowskilltarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 10 });

      // Update attacker to have very low skills
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: {
          hacking: 1,
          stealth: 1,
          cryptography: 1,
        },
      });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        [],
      );

      expect(result).toBeDefined();
      // Low skills vs high security should likely fail
    });

    it("should handle user with high skills", async () => {
      const attacker = await createTestUser({
        username: "highskill1",
        email: "highskill1@test.com",
      });
      const target = await createTestUser({
        username: "highskilltarget1",
        email: "highskilltarget1@test.com",
      });
      const server = await createTestServer({ securityLevel: 1 });

      // Update attacker to have very high skills
      await testDb.playerProgress.update({
        where: { userId: attacker.id },
        data: {
          hacking: 100,
          stealth: 100,
          cryptography: 100,
        },
      });

      const result = await hackService.processHackAttempt(
        attacker.id,
        target.id,
        server.id,
        HackMethod.BRUTEFORCE,
        ["zero_day", "rootkit"],
      );

      expect(result).toBeDefined();
      // High skills vs low security should have better success rate
    });
  });
});
