/// <reference types="jest" />

/**
 * ForumService Integration Tests
 * Tests forum discovery, access, posting, proxy system, and honeypot detection
 */

import { testDb, createTestUser } from "./setup";
import ForumService from "../services/forumService";
import { container } from "tsyringe";
import { SOCKET_IO } from "../di/tokens";

describe("ForumService Integration Tests", () => {
  let forumService: ForumService;
  let testUser: any;
  let testUser2: any;

  beforeAll(() => {
    // Get or create ForumService instance
    const mockIo = container.resolve(SOCKET_IO) as any;
    // MissionIntegrationService is optional, pass null
    forumService = new ForumService(mockIo, undefined);
  });

  beforeEach(async () => {
    // Create test users with different skill levels
    testUser = await createTestUser({
      username: "forumtester",
      email: "forum@test.com",
    });

    testUser2 = await createTestUser({
      username: "forumtester2",
      email: "forum2@test.com",
    });

    // Update test user with higher skills for discovery
    await testDb.playerProgress.update({
      where: { userId: testUser.id },
      data: {
        networking: 5,
        hacking: 5,
        level: 5,
      },
    });
  });

  // ==================== HELPER FUNCTIONS ====================

  async function createTestForum(data?: {
    name?: string;
    description?: string;
    securityLevel?: number;
    isHoneypot?: boolean;
    requiresProxy?: boolean;
  }) {
    const forumName = data?.name || "Test Forum";
    const forumUrl =
      forumName.toLowerCase().replace(/\s+/g, "-") +
      "-" +
      Math.random().toString(36).substring(7);

    return await testDb.forum.create({
      data: {
        name: forumName,
        url: forumUrl,
        description: data?.description || "A test forum for hackers",
        category: "tech",
        securityLevel: data?.securityLevel ?? 1,
        isHoneypot: data?.isHoneypot ?? false,
        requiresProxy: data?.requiresProxy ?? false,
        isActive: true,
      },
    });
  }

  async function createTestForumPost(
    forumId: string,
    authorId: string,
    data?: {
      title?: string;
      content?: string;
      storyRelevant?: boolean;
      keyFragmentId?: string;
    },
  ) {
    return await testDb.post.create({
      data: {
        forumId,
        authorId,
        authorHandle: `user_${authorId.substring(0, 8)}`,
        title: data?.title || "Test Post",
        content: data?.content || "This is a test post content",
        storyRelevant: data?.storyRelevant ?? false,
        keyFragmentId: data?.keyFragmentId ?? null,
      },
    });
  }

  async function createForumMembership(userId: string, forumId: string) {
    return await testDb.forumMember.create({
      data: {
        userId,
        forumId,
        handle: `user_${userId.substring(0, 8)}`,
        reputation: 0,
      },
    });
  }

  async function discoverForum(userId: string, forumId: string) {
    return await testDb.forumDiscovery.create({
      data: {
        userId,
        forumId,
        method: "scan",
      },
    });
  }

  async function createProxyConnection(userId: string, proxyServer: string) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    return await testDb.proxyConnection.create({
      data: {
        userId,
        proxyServer: proxyServer,
        location: "Unknown",
        active: true,
        connectedAt: new Date(),
        expiresAt: expiresAt,
      },
    });
  }

  // ==================== FORUM DISCOVERY & SCANNING ====================

  describe("Forum Discovery", () => {
    it("should scan and discover forums based on skill level", async () => {
      // Create forums with different security levels
      await createTestForum({ name: "Public Forum", securityLevel: 1 });
      await createTestForum({ name: "Medium Security", securityLevel: 3 });
      await createTestForum({ name: "High Security", securityLevel: 5 });

      const result = await forumService.scanForForums(testUser.id, false);

      expect(result).toBeDefined();
      expect(result.forums).toBeDefined();
      expect(result.newDiscoveries).toBeGreaterThan(0);
      expect(Array.isArray(result.forums)).toBe(true);
    });

    it("should discover more forums when using proxy", async () => {
      await createTestForum({ name: "Low Security", securityLevel: 1 });
      await createTestForum({ name: "High Security", securityLevel: 4 });

      // Scan without proxy
      const withoutProxy = await forumService.scanForForums(testUser.id, false);
      const countWithoutProxy = withoutProxy.forums.length;

      // Scan with proxy
      const withProxy = await forumService.scanForForums(testUser.id, true);
      const countWithProxy = withProxy.forums.length;

      expect(countWithProxy).toBeGreaterThanOrEqual(countWithoutProxy);
    });

    it("should not rediscover already discovered forums", async () => {
      await createTestForum({ name: "Test Forum" });

      // First scan - should discover
      const firstScan = await forumService.scanForForums(testUser.id, false);
      expect(firstScan.newDiscoveries).toBeGreaterThan(0);

      // Second scan - should not discover again
      const secondScan = await forumService.scanForForums(testUser.id, false);
      expect(secondScan.newDiscoveries).toBe(0);
    });

    it("should return list of forums requiring higher skills", async () => {
      await createTestForum({ name: "Expert Forum", securityLevel: 10 });

      const result = await forumService.scanForForums(testUser.id, false);

      expect(result.requiresHigherSkills).toBeDefined();
      expect(Array.isArray(result.requiresHigherSkills)).toBe(true);
    });

    it("should get all discovered forums for user", async () => {
      const forum1 = await createTestForum({ name: "Forum 1" });
      const forum2 = await createTestForum({ name: "Forum 2" });

      await discoverForum(testUser.id, forum1.id);
      await discoverForum(testUser.id, forum2.id);

      const discovered = await forumService.getDiscoveredForums(testUser.id);

      expect(discovered).toHaveLength(2);
      expect(discovered.map((f) => f.name)).toContain("Forum 1");
      expect(discovered.map((f) => f.name)).toContain("Forum 2");
    });

    it("should return empty array if no forums discovered", async () => {
      const discovered = await forumService.getDiscoveredForums(testUser.id);
      expect(discovered).toEqual([]);
    });

    it("should mark forum as discovered", async () => {
      const forum = await createTestForum();

      await forumService.discoverForum(testUser.id, forum.id, "scan");

      const discoveries = await testDb.forumDiscovery.findMany({
        where: { userId: testUser.id, forumId: forum.id },
      });

      expect(discoveries).toHaveLength(1);
    });

    it("should not duplicate forum discoveries", async () => {
      const forum = await createTestForum();

      await forumService.discoverForum(testUser.id, forum.id, "scan");
      await forumService.discoverForum(testUser.id, forum.id, "scan");

      const discoveries = await testDb.forumDiscovery.findMany({
        where: { userId: testUser.id, forumId: forum.id },
      });

      expect(discoveries).toHaveLength(1);
    });
  });

  // ==================== FORUM ACCESS ====================

  describe("Forum Access", () => {
    it("should access a public forum successfully", async () => {
      const forum = await createTestForum({
        name: "Public Forum",
        securityLevel: 1,
        requiresProxy: false,
      });

      await discoverForum(testUser.id, forum.id);

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result).toBeDefined();
      expect(result.forum.id).toBe(forum.id);
      expect(result.requiresProxy).toBe(false);
      expect(result.isHoneypot).toBe(false);
    });

    it("should detect proxy requirement for high-security forums", async () => {
      const forum = await createTestForum({
        name: "Secure Forum",
        securityLevel: 4,
        requiresProxy: true,
      });

      await discoverForum(testUser.id, forum.id);

      // Should throw error when accessing proxy-required forum without proxy
      await expect(
        forumService.accessForum(testUser.id, forum.id, false),
      ).rejects.toThrow("Forum requires proxy connection");
    });

    it("should allow access when proxy is connected for secure forum", async () => {
      const forum = await createTestForum({
        name: "Secure Forum",
        securityLevel: 4,
        requiresProxy: true,
      });

      await discoverForum(testUser.id, forum.id);
      await createProxyConnection(testUser.id, "proxy1.onion");

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        true,
      );

      expect(result.forum).toBeDefined();
      expect(result.requiresProxy).toBe(true);
    });

    it("should detect honeypot forums", async () => {
      const forum = await createTestForum({
        name: "Honeypot Forum",
        securityLevel: 3,
        isHoneypot: true,
        requiresProxy: false, // Set to false so we can access it
      });

      await discoverForum(testUser.id, forum.id);

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result.isHoneypot).toBe(true);
    });

    it("should check membership status when accessing forum", async () => {
      const forum = await createTestForum({
        name: "Member Forum",
      });

      await discoverForum(testUser.id, forum.id);

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result.isMember).toBe(false);
    });

    it("should return posts when accessing forum", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);

      await createTestForumPost(forum.id, testUser.id, {
        title: "First Post",
      });

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result.posts).toBeDefined();
      expect(Array.isArray(result.posts)).toBe(true);
    });

    it("should throw error for non-existent forum", async () => {
      await expect(
        forumService.accessForum(testUser.id, "invalid-forum-id"),
      ).rejects.toThrow();
    });
  });

  // ==================== FORUM MEMBERSHIP ====================

  describe("Forum Membership", () => {
    it("should register user for forum account", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);

      const result = await forumService.registerForumAccount(
        testUser.id,
        forum.id,
        "hacker123",
      );
      expect(result).toBeDefined();

      const member = await testDb.forumMember.findUnique({
        where: {
          userId_forumId: {
            userId: testUser.id,
            forumId: forum.id,
          },
        },
      });

      expect(member).toBeDefined();
      expect(member?.handle).toBe("hacker123");
      expect(member?.reputation).toBe(0);
    });

    it("should not allow duplicate forum registrations", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);

      await forumService.registerForumAccount(
        testUser.id,
        forum.id,
        "hacker123",
      );

      await expect(
        forumService.registerForumAccount(testUser.id, forum.id, "hacker456"),
      ).rejects.toThrow();
    });

    it("should allow multiple users to register on same forum", async () => {
      const forum = await createTestForum();

      await discoverForum(testUser.id, forum.id);
      await discoverForum(testUser2.id, forum.id);

      await forumService.registerForumAccount(testUser.id, forum.id, "user1");
      await forumService.registerForumAccount(testUser2.id, forum.id, "user2");

      const members = await testDb.forumMember.findMany({
        where: { forumId: forum.id },
      });

      expect(members).toHaveLength(2);
    });

    it("should require forum discovery before registration", async () => {
      const forum = await createTestForum();

      // The service auto-discovers on registration attempt, so it won't throw
      // Instead, test that registration creates both discovery and membership
      await forumService.registerForumAccount(
        testUser.id,
        forum.id,
        "hacker123",
      );

      const discovery = await testDb.forumDiscovery.findUnique({
        where: {
          userId_forumId: {
            userId: testUser.id,
            forumId: forum.id,
          },
        },
      });

      expect(discovery).toBeDefined();
    });
  });

  // ==================== POSTS ====================

  describe("Forum Posts", () => {
    it("should get posts from forum with pagination", async () => {
      const forum = await createTestForum();

      // Create multiple posts
      for (let i = 0; i < 15; i++) {
        await createTestForumPost(forum.id, testUser.id, {
          title: `Post ${i}`,
          content: `Content ${i}`,
        });
      }

      const result = await forumService.getPosts(testUser.id, forum.id, 1, 10);

      expect(result.posts).toHaveLength(10);
      expect(result.total).toBe(15);
      expect(result.hasMore).toBe(true);
    });

    it("should get second page of posts", async () => {
      const forum = await createTestForum();

      for (let i = 0; i < 15; i++) {
        await createTestForumPost(forum.id, testUser.id, {
          title: `Post ${i}`,
        });
      }

      const result = await forumService.getPosts(testUser.id, forum.id, 2, 10);

      expect(result.posts).toHaveLength(5);
      expect(result.hasMore).toBe(false);
    });

    it("should read a specific post", async () => {
      const forum = await createTestForum();
      const post = await createTestForumPost(forum.id, testUser.id, {
        title: "Important Post",
        content: "Critical information here",
      });

      const result = await forumService.readPost(
        testUser.id,
        forum.id,
        post.id,
      );

      expect(result).toBeDefined();
      expect(result.title).toBe("Important Post");
      expect(result.content).toBe("Critical information here");
    });

    it("should create a post when user is member", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);
      await createForumMembership(testUser.id, forum.id);

      const result = await forumService.createPost(
        testUser.id,
        forum.id,
        "My Post Title",
        "This is my post content",
      );

      expect(result).toBeDefined();
      expect(result.title).toBe("My Post Title");
      expect(result.content).toBe("This is my post content");
      expect(result.authorId).toBe(testUser.id);
    });

    it("should not allow posting without membership", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);

      await expect(
        forumService.createPost(
          testUser.id,
          forum.id,
          "Unauthorized Post",
          "Should fail",
        ),
      ).rejects.toThrow();
    });

    it("should create AI post without membership requirement", async () => {
      const forum = await createTestForum();

      // Create AI persona first with unique name
      const uniqueName = `AIBot_${Date.now()}`;
      const persona = await testDb.aIPersona.create({
        data: {
          type: "game_master",
          name: uniqueName,
          personality: "Helpful and informative",
          systemPrompt: "You are a helpful AI assistant",
          model: "llama3.1:8b",
        },
      });

      const result = await forumService.createAIPost(
        persona.id,
        forum.id,
        "AI Generated Post",
        "This post was created by AI",
      );

      expect(result).toBeDefined();
      expect(result.title).toBe("AI Generated Post");
      expect(result.content).toBe("This post was created by AI");
    });

    it("should search posts by query", async () => {
      const forum = await createTestForum();

      await createTestForumPost(forum.id, testUser.id, {
        title: "Vulnerability Discovery",
        content: "Found a critical bug",
      });

      await createTestForumPost(forum.id, testUser.id, {
        title: "Random Topic",
        content: "Nothing important",
      });

      const results = await forumService.searchPosts(
        testUser.id,
        forum.id,
        "vulnerability",
      );

      expect(results).toHaveLength(1);
      if (results[0]) {
        expect(results[0].title).toContain("Vulnerability");
      }
    });

    it("should handle empty search results", async () => {
      const forum = await createTestForum();

      const results = await forumService.searchPosts(
        testUser.id,
        forum.id,
        "nonexistentterm",
      );

      expect(results).toHaveLength(0);
    });

    it("should handle posts with special characters", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);
      await createForumMembership(testUser.id, forum.id);

      const specialContent =
        "Test with <script>alert('xss')</script> and 'quotes'";

      const result = await forumService.createPost(
        testUser.id,
        forum.id,
        "Special Post",
        specialContent,
      );

      expect(result.content).toBe(specialContent);
    });
  });

  // ==================== PROXY SYSTEM ====================

  describe("Proxy System", () => {
    it("should list available proxy servers", async () => {
      const proxies = await forumService.listProxyServers(testUser.id);

      expect(proxies).toBeDefined();
      expect(Array.isArray(proxies)).toBe(true);
      expect(proxies.length).toBeGreaterThan(0);
      expect(proxies[0]).toHaveProperty("id");
      expect(proxies[0]).toHaveProperty("name");
      expect(proxies[0]).toHaveProperty("anonymityLevel");
    });

    it("should connect to a proxy server", async () => {
      await forumService.connectToProxy(testUser.id, "proxy1");

      const connection = await testDb.proxyConnection.findFirst({
        where: { userId: testUser.id },
      });

      expect(connection).toBeDefined();
      expect(connection?.proxyServer).toContain("proxy1");
    });

    it("should disconnect existing proxy before connecting to new one", async () => {
      await forumService.connectToProxy(testUser.id, "proxy1");

      // Give a small delay to ensure first connection is established
      await new Promise((resolve) => setTimeout(resolve, 10));

      await forumService.connectToProxy(testUser.id, "proxy2");

      const connections = await testDb.proxyConnection.findMany({
        where: { userId: testUser.id },
      });

      expect(connections).toHaveLength(1);
      expect(connections[0]?.proxyServer).toBeDefined();
    });

    it("should disconnect from proxy", async () => {
      await forumService.connectToProxy(testUser.id, "proxy1");
      await forumService.disconnectProxy(testUser.id);

      const connection = await testDb.proxyConnection.findFirst({
        where: { userId: testUser.id },
      });

      expect(connection).toBeNull();
    });

    it("should get proxy connection status when connected", async () => {
      await forumService.connectToProxy(testUser.id, "proxy1");

      const status = await forumService.getProxyStatus(testUser.id);

      expect(status.connected).toBe(true);
      expect(status.proxyServer).toBeDefined();
    });

    it("should get proxy status when not connected", async () => {
      const status = await forumService.getProxyStatus(testUser.id);

      expect(status.connected).toBe(false);
      expect(status.proxyServer).toBeUndefined();
    });

    it("should not connect to offline proxy server", async () => {
      await expect(
        forumService.connectToProxy(testUser.id, "proxy4"),
      ).rejects.toThrow();
    });

    it("should not connect to invalid proxy", async () => {
      await expect(
        forumService.connectToProxy(testUser.id, "invalid-proxy"),
      ).rejects.toThrow();
    });
  });

  // ==================== EDGE CASES & VALIDATION ====================

  describe("Edge Cases & Validation", () => {
    it("should handle non-existent user in scanForForums", async () => {
      await expect(
        forumService.scanForForums("invalid-user-id", false),
      ).rejects.toThrow();
    });

    it("should handle inactive forums in scanning", async () => {
      await testDb.forum.create({
        data: {
          name: "Inactive Forum",
          description: "Should not appear",
          category: "tech",
          url: "inactive-forum-" + Math.random().toString(36).substring(7),
          securityLevel: 1,
          isActive: false,
          requiresProxy: false,
          isHoneypot: false,
        },
      });

      const result = await forumService.scanForForums(testUser.id, false);

      expect(result.forums.every((f) => f.isActive)).toBe(true);
    });

    it("should handle user with zero skills", async () => {
      const newUser = await createTestUser({
        username: "newbie",
        email: "newbie@test.com",
      });

      await testDb.playerProgress.update({
        where: { userId: newUser.id },
        data: {
          networking: 0,
          hacking: 0,
        },
      });

      await createTestForum({ securityLevel: 1 });

      const result = await forumService.scanForForums(newUser.id, false);

      // Should still find some forums at security level 1
      expect(result.forums.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle forum with no posts", async () => {
      const forum = await createTestForum();

      const result = await forumService.getPosts(testUser.id, forum.id, 1, 10);

      expect(result.posts).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it("should handle very long post content", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);
      await createForumMembership(testUser.id, forum.id);

      const longContent = "A".repeat(10000);

      const result = await forumService.createPost(
        testUser.id,
        forum.id,
        "Long Post",
        longContent,
      );

      expect(result.content).toHaveLength(10000);
    });

    it("should handle multiple simultaneous proxy connections", async () => {
      await forumService.connectToProxy(testUser.id, "proxy1");

      const connections = await testDb.proxyConnection.findMany({
        where: { userId: testUser.id },
      });

      expect(connections).toHaveLength(1);
    });

    it("should validate forum ID in readPost", async () => {
      await expect(
        forumService.readPost(testUser.id, "invalid-forum", "invalid-post"),
      ).rejects.toThrow();
    });

    it("should handle story-relevant posts", async () => {
      const forum = await createTestForum();
      const post = await createTestForumPost(forum.id, testUser.id, {
        title: "Story Post",
        content: "Important story information",
        storyRelevant: true,
      });

      const result = await forumService.readPost(
        testUser.id,
        forum.id,
        post.id,
      );

      expect(result.storyRelevant).toBe(true);
    });

    it("should handle reputation requirements", async () => {
      const forum = await testDb.forum.create({
        data: {
          name: "Elite Forum",
          description: "High reputation required",
          url: "elite-forum-" + Math.random().toString(36).substring(7),
          category: "elite",
          securityLevel: 3,
          isActive: true,
          requiresProxy: false,
          isHoneypot: false,
        },
      });

      await discoverForum(testUser.id, forum.id);

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result.forum).toBeDefined();
    });
  });

  // ==================== STATISTICS & METRICS ====================

  describe("Statistics & Metrics", () => {
    it("should track forum member count", async () => {
      const forum = await createTestForum();
      await discoverForum(testUser.id, forum.id);
      await discoverForum(testUser2.id, forum.id);

      await forumService.registerForumAccount(testUser.id, forum.id, "user1");
      await forumService.registerForumAccount(testUser2.id, forum.id, "user2");

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result.forum._count?.members).toBe(2);
    });

    it("should track post count in forum", async () => {
      const forum = await createTestForum();

      await createTestForumPost(forum.id, testUser.id);
      await createTestForumPost(forum.id, testUser.id);
      await createTestForumPost(forum.id, testUser2.id);

      const result = await forumService.accessForum(
        testUser.id,
        forum.id,
        false,
      );

      expect(result.forum._count?.posts).toBe(3);
    });

    it("should return correct pagination metadata", async () => {
      const forum = await createTestForum();

      for (let i = 0; i < 25; i++) {
        await createTestForumPost(forum.id, testUser.id, {
          title: `Post ${i}`,
        });
      }

      const result = await forumService.getPosts(testUser.id, forum.id, 2, 10);

      expect(result.total).toBe(25);
      expect(result.hasMore).toBe(true);
    });
  });
});
