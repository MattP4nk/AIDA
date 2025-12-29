import "reflect-metadata";
import { container } from "tsyringe";
import { testDb, createTestUser } from "./setup";
import ServerService from "../services/serverService";
import { CACHE_SERVICE } from "../di/tokens";

describe("ServerService Integration Tests", () => {
  let serverService: ServerService;

  beforeAll(() => {
    const cacheService = container.resolve(CACHE_SERVICE) as any;
    serverService = new ServerService(cacheService);
  });

  describe("Server Creation", () => {
    let testUser: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `serverowner_${timestamp}`,
        email: `serverowner_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: testUser.id },
        data: {
          level: 5,
          experience: 1000,
          hacking: 50,
        },
      });
    });

    test("should create a basic server with minimal data", async () => {
      const result = await serverService.createServer({
        name: "Basic Server",
        ipAddress: "10.0.0.1",
        type: "personal",
      });

      expect(result).toBeDefined();
      expect(result.name).toBe("Basic Server");
      expect(result.ipAddress).toBe("10.0.0.1");
      expect(result.type).toBe("personal");
      expect(result.isOnline).toBe(true);
      expect(result.encryptionLevel).toBe(0);
      expect(result.maxConnections).toBe(10);
      expect(result.currentConnections).toBe(0);
      expect(result.state).toBeDefined();
      expect(result.state.online).toBe(true);
    });

    test("should create a server with an owner", async () => {
      const result = await serverService.createServer({
        name: "Owned Server",
        ipAddress: "10.0.0.2",
        type: "corporate",
        ownerId: testUser.id,
      });

      expect(result.ownerId).toBe(testUser.id);

      const dbServer = await testDb.gameServer.findUnique({
        where: { id: result.id },
      });
      expect(dbServer?.ownerId).toBe(testUser.id);
    });

    test("should create a server with custom encryption and max connections", async () => {
      const result = await serverService.createServer({
        name: "Secure Server",
        ipAddress: "10.0.0.3",
        type: "government",
        ownerId: testUser.id,
        encryptionLevel: 75,
        maxConnections: 25,
      });

      expect(result.encryptionLevel).toBe(75);
      expect(result.maxConnections).toBe(25);
    });

    test("should create a server with access rules", async () => {
      const accessRules = [
        { type: "WHITELIST", value: "192.168.0.0/24" },
        { type: "BLACKLIST", value: "10.0.0.5" },
      ];

      const result = await serverService.createServer({
        name: "Restricted Server",
        ipAddress: "10.0.0.4",
        type: "military",
        ownerId: testUser.id,
        accessRules,
      });

      expect(result.accessRules).toEqual(accessRules);
    });

    test("should initialize server with default state", async () => {
      const result = await serverService.createServer({
        name: "State Server",
        ipAddress: "10.0.0.5",
        type: "personal",
      });

      expect(result.state).toMatchObject({
        online: true,
        load: 0,
        connections: 0,
        alerts: 0,
      });
      expect(result.state.lastActivity).toBeInstanceOf(Date);
    });
  });

  describe("Server Retrieval", () => {
    let testServer: any;

    beforeEach(async () => {
      testServer = await testDb.gameServer.create({
        data: {
          name: "Retrieval Test Server",
          ipAddress: "10.1.0.1",
          type: "corporate",
          encryptionLevel: 30,
          isOnline: true,
          maxConnections: 15,
          currentConnections: 3,
        },
      });
    });

    test("should get server by ID", async () => {
      const result = await serverService.getServer(testServer.id);

      expect(result).toBeDefined();
      expect(result?.id).toBe(testServer.id);
      expect(result?.name).toBe("Retrieval Test Server");
      expect(result?.ipAddress).toBe("10.1.0.1");
    });

    test("should get server by IP address", async () => {
      const result = await serverService.getServerByIp("10.1.0.1");

      expect(result).toBeDefined();
      expect(result?.id).toBe(testServer.id);
      expect(result?.name).toBe("Retrieval Test Server");
    });

    test("should return null for non-existent server ID", async () => {
      const result = await serverService.getServer("non-existent-id");
      expect(result).toBeNull();
    });

    test("should return null for non-existent IP address", async () => {
      const result = await serverService.getServerByIp("192.168.99.99");
      expect(result).toBeNull();
    });

    test("should include server state in retrieved server", async () => {
      const result = await serverService.getServer(testServer.id);

      expect(result?.state).toBeDefined();
      expect(result?.state.online).toBe(true);
      expect(result?.state.connections).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Server Updates", () => {
    let testUser: any;
    let testServer: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `updateowner_${timestamp}`,
        email: `updateowner_${timestamp}@test.com`,
      });

      testServer = await testDb.gameServer.create({
        data: {
          name: "Update Test Server",
          ipAddress: "10.2.0.1",
          type: "personal",
          ownerId: testUser.id,
          encryptionLevel: 10,
          maxConnections: 10,
        },
      });
    });

    test("should update server name", async () => {
      const result = await serverService.updateServer(testServer.id, {
        name: "Updated Server Name",
      });

      expect(result.name).toBe("Updated Server Name");

      const dbServer = await testDb.gameServer.findUnique({
        where: { id: testServer.id },
      });
      expect(dbServer?.name).toBe("Updated Server Name");
    });

    test("should update server type", async () => {
      const result = await serverService.updateServer(testServer.id, {
        type: "corporate",
      });

      expect(result.type).toBe("corporate");
    });

    test("should update encryption level", async () => {
      const result = await serverService.updateServer(testServer.id, {
        encryptionLevel: 50,
      });

      expect(result.encryptionLevel).toBe(50);
    });

    test("should update max connections", async () => {
      const result = await serverService.updateServer(testServer.id, {
        maxConnections: 30,
      });

      expect(result.maxConnections).toBe(30);
    });

    test("should update access rules", async () => {
      const newRules = [{ type: "REQUIRE_AUTH", value: "true" }];

      const result = await serverService.updateServer(testServer.id, {
        accessRules: newRules,
      });

      expect(result.accessRules).toEqual(newRules);
    });

    test("should update multiple fields at once", async () => {
      const result = await serverService.updateServer(testServer.id, {
        name: "Multi-Update Server",
        encryptionLevel: 75,
        maxConnections: 50,
      });

      expect(result.name).toBe("Multi-Update Server");
      expect(result.encryptionLevel).toBe(75);
      expect(result.maxConnections).toBe(50);
    });

    test("should throw error when updating non-existent server", async () => {
      await expect(
        serverService.updateServer("non-existent-id", { name: "New Name" }),
      ).rejects.toThrow("Server not found");
    });
  });

  describe("Server Deletion", () => {
    let testServer: any;
    let testUser: any;
    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `deleteuser_${timestamp}`,
        email: `deleteuser_${timestamp}@test.com`,
      });

      testServer = await testDb.gameServer.create({
        data: {
          name: "Delete Test Server",
          ipAddress: "10.3.0.1",
          type: "personal",
          ownerId: testUser.id,
        },
      });

      await testDb.serverConnection.create({
        data: {
          userId: testUser.id,
          serverId: testServer.id,
          isActive: false,
          accessLevel: 5,
        },
      });
    });

    test("should delete a server", async () => {
      await serverService.deleteServer(testServer.id);

      const dbServer = await testDb.gameServer.findUnique({
        where: { id: testServer.id },
      });
      expect(dbServer).toBeNull();
    });

    test("should delete associated connections when deleting server", async () => {
      await serverService.deleteServer(testServer.id);

      const connections = await testDb.serverConnection.findMany({
        where: { serverId: testServer.id },
      });
      expect(connections).toHaveLength(0);
    });

    test("should throw error when deleting non-existent server", async () => {
      await expect(
        serverService.deleteServer("non-existent-id"),
      ).rejects.toThrow("Server not found");
    });
  });

  describe("Server Discovery", () => {
    let testUser: any;
    let lowSecServer: any;
    let highSecServer: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `discoveryuser_${timestamp}`,
        email: `discoveryuser_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: testUser.id },
        data: {
          level: 3,
          experience: 500,
          hacking: 30,
        },
      });

      lowSecServer = await testDb.gameServer.create({
        data: {
          name: "Low Security Server",
          ipAddress: "10.4.0.1",
          type: "personal",
          encryptionLevel: 10,
          isOnline: true,
        },
      });

      await testDb.gameServer.create({
        data: {
          name: "Medium Security Server",
          ipAddress: "10.4.0.2",
          type: "corporate",
          encryptionLevel: 50,
          isOnline: true,
        },
      });

      highSecServer = await testDb.gameServer.create({
        data: {
          name: "High Security Server",
          ipAddress: "10.4.0.3",
          type: "military",
          encryptionLevel: 150,
          isOnline: true,
        },
      });
    });

    test("should discover servers within player skill range", async () => {
      const scanLevel = 5;
      const result = await serverService.discoverServers(
        testUser.id,
        scanLevel,
      );

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      const foundLow = result.find((s: any) => s.id === lowSecServer.id);
      expect(foundLow).toBeDefined();
    });

    test("should not discover servers above player capability", async () => {
      const scanLevel = 0;
      const result = await serverService.discoverServers(
        testUser.id,
        scanLevel,
      );

      const foundHigh = result.find((s: any) => s.id === highSecServer.id);
      expect(foundHigh).toBeUndefined();
    });

    test("should discover more servers with higher scan level", async () => {
      const lowScan = await serverService.discoverServers(testUser.id, 1);
      const highScan = await serverService.discoverServers(testUser.id, 10);

      expect(highScan.length).toBeGreaterThanOrEqual(lowScan.length);
    });

    test("should only discover online servers", async () => {
      await testDb.gameServer.create({
        data: {
          name: "Offline Server",
          ipAddress: "10.4.0.99",
          type: "personal",
          encryptionLevel: 5,
          isOnline: false,
        },
      });

      const result = await serverService.discoverServers(testUser.id, 5);

      const offlineFound = result.find((s: any) => s.name === "Offline Server");
      expect(offlineFound).toBeUndefined();
    });

    test("should return server info with required fields", async () => {
      const result = await serverService.discoverServers(testUser.id, 5);

      expect(result.length).toBeGreaterThan(0);
      const server = result[0];
      expect(server?.id).toBeDefined();
      expect(server?.name).toBeDefined();
      expect(server?.ipAddress).toBeDefined();
      expect(server?.type).toBeDefined();
      expect(server?.encryptionLevel).toBeDefined();
      expect(server?.isOnline).toBe(true);
    });

    test("should throw error if player progress not found", async () => {
      const fakeUserId = "fake-user-id";
      await expect(
        serverService.discoverServers(fakeUserId, 5),
      ).rejects.toThrow("Player progress not found");
    });
  });

  describe("Server Connections", () => {
    let testUser: any;
    let testServer: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `connuser_${timestamp}`,
        email: `connuser_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: testUser.id },
        data: {
          level: 5,
          experience: 1000,
          hacking: 50,
        },
      });

      testServer = await testDb.gameServer.create({
        data: {
          name: "Connection Test Server",
          ipAddress: "10.5.0.1",
          type: "corporate",
          encryptionLevel: 20,
          isOnline: true,
          maxConnections: 10,
          currentConnections: 0,
        },
      });
    });

    test("should connect to server by ID", async () => {
      const result = await serverService.connectToServer(
        testUser.id,
        testServer.id,
      );

      expect(result.success).toBe(true);
      expect(result.serverId).toBe(testServer.id);
      expect(result.accessLevel).toBeGreaterThan(0);
      expect(result.message).toContain("Connected");
    });

    test("should connect to server by IP address", async () => {
      const result = await serverService.connectToServer(
        testUser.id,
        testServer.ipAddress,
      );

      expect(result.success).toBe(true);
      expect(result.serverId).toBe(testServer.id);
    });

    test("should create connection record in database", async () => {
      await serverService.connectToServer(testUser.id, testServer.id);

      const connection = await testDb.serverConnection.findFirst({
        where: {
          userId: testUser.id,
          serverId: testServer.id,
          isActive: true,
        },
      });

      expect(connection).toBeDefined();
      expect(connection?.isActive).toBe(true);
      expect(connection?.accessLevel).toBeGreaterThan(0);
    });

    test("should increment server connection count", async () => {
      await serverService.connectToServer(testUser.id, testServer.id);

      const server = await testDb.gameServer.findUnique({
        where: { id: testServer.id },
      });

      expect(server?.currentConnections).toBe(1);
    });

    test("should handle existing active connection", async () => {
      await serverService.connectToServer(testUser.id, testServer.id);
      const result = await serverService.connectToServer(
        testUser.id,
        testServer.id,
      );

      expect(result.success).toBe(true);

      const connections = await testDb.serverConnection.findMany({
        where: {
          userId: testUser.id,
          serverId: testServer.id,
          isActive: true,
        },
      });

      expect(connections).toHaveLength(1);
    });

    test("should fail to connect to non-existent server", async () => {
      const result = await serverService.connectToServer(
        testUser.id,
        "non-existent-id",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("not found");
    });

    test("should fail to connect to offline server", async () => {
      await testDb.gameServer.update({
        where: { id: testServer.id },
        data: { isOnline: false },
      });

      const result = await serverService.connectToServer(
        testUser.id,
        testServer.id,
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("offline");
    });

    test("should disconnect from server", async () => {
      await serverService.connectToServer(testUser.id, testServer.id);

      await serverService.disconnectFromServer(testUser.id, testServer.id);

      const connection = await testDb.serverConnection.findFirst({
        where: {
          userId: testUser.id,
          serverId: testServer.id,
          isActive: true,
        },
      });

      expect(connection).toBeNull();
    });

    test("should decrement server connection count on disconnect", async () => {
      await serverService.connectToServer(testUser.id, testServer.id);
      await serverService.disconnectFromServer(testUser.id, testServer.id);

      const server = await testDb.gameServer.findUnique({
        where: { id: testServer.id },
      });

      expect(server?.currentConnections).toBe(0);
    });

    test("should set disconnectedAt timestamp", async () => {
      await serverService.connectToServer(testUser.id, testServer.id);
      await serverService.disconnectFromServer(testUser.id, testServer.id);

      const connection = await testDb.serverConnection.findFirst({
        where: {
          userId: testUser.id,
          serverId: testServer.id,
          isActive: false,
        },
      });

      expect(connection?.disconnectedAt).toBeInstanceOf(Date);
    });
  });

  describe("Connection History and Active Connections", () => {
    let testUser: any;
    let server1: any;
    let server2: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `histuser_${timestamp}`,
        email: `histuser_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: testUser.id },
        data: {
          level: 5,
          experience: 1000,
          hacking: 50,
        },
      });

      server1 = await testDb.gameServer.create({
        data: {
          name: "History Server 1",
          ipAddress: "10.6.0.1",
          type: "personal",
          encryptionLevel: 10,
          isOnline: true,
        },
      });

      server2 = await testDb.gameServer.create({
        data: {
          name: "History Server 2",
          ipAddress: "10.6.0.2",
          type: "corporate",
          encryptionLevel: 20,
          isOnline: true,
        },
      });
    });

    test("should retrieve active connections", async () => {
      await serverService.connectToServer(testUser.id, server1.id);
      await serverService.connectToServer(testUser.id, server2.id);

      const connections = await serverService.getActiveConnections(testUser.id);

      expect(connections).toHaveLength(2);
      expect(connections[0]?.isActive).toBe(true);
      expect(connections[1]?.isActive).toBe(true);
    });

    test("should include server details in active connections", async () => {
      await serverService.connectToServer(testUser.id, server1.id);

      const connections = await serverService.getActiveConnections(testUser.id);

      expect(connections[0]).toBeDefined();
      expect(connections.length).toBeGreaterThan(0);
    });

    test("should not include disconnected connections in active list", async () => {
      await serverService.connectToServer(testUser.id, server1.id);
      await serverService.disconnectFromServer(testUser.id, server1.id);

      const connections = await serverService.getActiveConnections(testUser.id);

      expect(connections).toHaveLength(0);
    });

    test("should retrieve connection history", async () => {
      await serverService.connectToServer(testUser.id, server1.id);
      await serverService.disconnectFromServer(testUser.id, server1.id);

      await serverService.connectToServer(testUser.id, server2.id);

      const history = await serverService.getConnectionHistory(testUser.id);

      expect(history.length).toBeGreaterThanOrEqual(2);
    });

    test("should respect limit parameter in connection history", async () => {
      await serverService.connectToServer(testUser.id, server1.id);
      await serverService.connectToServer(testUser.id, server2.id);

      const history = await serverService.getConnectionHistory(testUser.id, 1);

      expect(history).toHaveLength(1);
    });

    test("should order connection history by most recent first", async () => {
      await serverService.connectToServer(testUser.id, server1.id);
      await new Promise((resolve) => setTimeout(resolve, 10));
      await serverService.connectToServer(testUser.id, server2.id);

      const history = await serverService.getConnectionHistory(testUser.id);

      expect(history[0]?.serverId).toBe(server2.id);
      expect(history[1]?.serverId).toBe(server1.id);
    });
  });

  describe("Security Level Calculation", () => {
    test("should calculate security level for low encryption server", async () => {
      const server = await testDb.gameServer.create({
        data: {
          name: "Low Sec",
          ipAddress: "10.7.0.1",
          type: "personal",
          encryptionLevel: 10,
        },
      });

      const security = serverService.calculateSecurityLevel(server);

      expect(security.encryption).toBe(10);
      expect(security.firewall).toBeLessThanOrEqual(100);
      expect(security.ids).toBeLessThanOrEqual(100);
      expect(security.overall).toBeGreaterThanOrEqual(0);
      expect(security.rating).toBe("LOW");
    });

    test("should calculate security level for medium encryption server", async () => {
      const server = await testDb.gameServer.create({
        data: {
          name: "Med Sec",
          ipAddress: "10.7.0.2",
          type: "corporate",
          encryptionLevel: 50,
        },
      });

      const security = serverService.calculateSecurityLevel(server);

      expect(security.encryption).toBe(50);
      expect(security.rating).toBe("MEDIUM");
    });

    test("should calculate security level for high encryption server", async () => {
      const server = await testDb.gameServer.create({
        data: {
          name: "High Sec",
          ipAddress: "10.7.0.3",
          type: "government",
          encryptionLevel: 80,
        },
      });

      const security = serverService.calculateSecurityLevel(server);

      expect(security.encryption).toBe(80);
      expect(security.rating).toBe("HIGH");
    });

    test("should calculate overall security as average", async () => {
      const server = await testDb.gameServer.create({
        data: {
          name: "Test Sec",
          ipAddress: "10.7.0.4",
          type: "corporate",
          encryptionLevel: 60,
        },
      });

      const security = serverService.calculateSecurityLevel(server);

      const expectedOverall = Math.floor(
        (security.firewall + security.ids + security.encryption) / 3,
      );
      expect(security.overall).toBe(expectedOverall);
    });
  });

  describe("Access Control", () => {
    let easyServer: any;
    let hardServer: any;

    beforeEach(async () => {
      easyServer = await testDb.gameServer.create({
        data: {
          name: "Easy Server",
          ipAddress: "10.8.0.1",
          type: "personal",
          encryptionLevel: 10,
          isOnline: true,
        },
      });

      hardServer = await testDb.gameServer.create({
        data: {
          name: "Hard Server",
          ipAddress: "10.8.0.2",
          type: "military",
          encryptionLevel: 100,
          isOnline: true,
        },
      });
    });

    test("should allow low-level player to access easy server", async () => {
      const timestamp = Date.now();
      const lowLevelUser = await createTestUser({
        username: `lowlevel_${timestamp}`,
        email: `lowlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: lowLevelUser.id },
        data: {
          level: 1,
          experience: 0,
          hacking: 10,
        },
      });

      const access = await serverService.canAccessServer(
        lowLevelUser.id,
        easyServer.id,
      );

      expect(access.canAccess).toBe(true);
      expect(access.accessLevel).toBeGreaterThan(0);
    });

    test("should deny low-level player access to hard server", async () => {
      const timestamp = Date.now();
      const lowLevelUser = await createTestUser({
        username: `lowlevel_${timestamp}`,
        email: `lowlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: lowLevelUser.id },
        data: {
          level: 1,
          experience: 0,
          hacking: 10,
        },
      });

      const access = await serverService.canAccessServer(
        lowLevelUser.id,
        hardServer.id,
      );

      expect(access.canAccess).toBe(false);
      expect(access.reason).toContain("Insufficient level");
      expect(access.requirements).toBeDefined();
    });

    test("should allow high-level player to access hard server", async () => {
      const timestamp = Date.now();
      const highLevelUser = await createTestUser({
        username: `highlevel_${timestamp}`,
        email: `highlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: highLevelUser.id },
        data: {
          level: 10,
          experience: 5000,
          hacking: 90,
        },
      });

      const access = await serverService.canAccessServer(
        highLevelUser.id,
        hardServer.id,
      );

      expect(access.canAccess).toBe(true);
      expect(access.accessLevel).toBeGreaterThan(0);
    });

    test("should calculate higher access level for skilled players", async () => {
      const timestamp = Date.now();

      const lowLevelUser = await createTestUser({
        username: `lowlevel_${timestamp}`,
        email: `lowlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: lowLevelUser.id },
        data: {
          level: 1,
          experience: 0,
          hacking: 10,
        },
      });

      const highLevelUser = await createTestUser({
        username: `highlevel_${timestamp}`,
        email: `highlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: highLevelUser.id },
        data: {
          level: 10,
          experience: 5000,
          hacking: 90,
        },
      });

      const lowAccess = await serverService.canAccessServer(
        lowLevelUser.id,
        easyServer.id,
      );
      const highAccess = await serverService.canAccessServer(
        highLevelUser.id,
        easyServer.id,
      );

      expect(highAccess.accessLevel).toBeGreaterThanOrEqual(
        lowAccess.accessLevel,
      );
    });

    test("should deny access to offline server", async () => {
      const timestamp = Date.now();
      const highLevelUser = await createTestUser({
        username: `highlevel_${timestamp}`,
        email: `highlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: highLevelUser.id },
        data: {
          level: 10,
          experience: 5000,
          hacking: 90,
        },
      });

      await testDb.gameServer.update({
        where: { id: easyServer.id },
        data: { isOnline: false },
      });

      const access = await serverService.canAccessServer(
        highLevelUser.id,
        easyServer.id,
      );

      expect(access.canAccess).toBe(false);
      expect(access.reason).toContain("offline");
    });

    test("should deny access to non-existent server", async () => {
      const timestamp = Date.now();
      const lowLevelUser = await createTestUser({
        username: `lowlevel_${timestamp}`,
        email: `lowlevel_${timestamp}@test.com`,
      });

      await testDb.playerProgress.update({
        where: { userId: lowLevelUser.id },
        data: {
          level: 1,
          experience: 0,
          hacking: 10,
        },
      });

      const access = await serverService.canAccessServer(
        lowLevelUser.id,
        "fake-server-id",
      );

      expect(access.canAccess).toBe(false);
      expect(access.reason).toContain("not found");
    });

    test("should deny access for player without progress", async () => {
      const timestamp = Date.now();
      const noProgressUser = await createTestUser({
        username: `noprogress_${timestamp}`,
        email: `noprogress_${timestamp}@test.com`,
      });

      // Delete the auto-created progress to test the scenario
      await testDb.playerProgress.delete({
        where: { userId: noProgressUser.id },
      });

      const access = await serverService.canAccessServer(
        noProgressUser.id,
        easyServer.id,
      );

      expect(access.canAccess).toBe(false);
      expect(access.reason).toContain("Player not found");
    });
  });

  describe("Security Alerts", () => {
    let testUser: any;
    let testServer: any;
    let serverOwner: any;

    beforeEach(async () => {
      const timestamp = Date.now();

      testUser = await createTestUser({
        username: `intruder_${timestamp}`,
        email: `intruder_${timestamp}@test.com`,
      });

      serverOwner = await createTestUser({
        username: `owner_${timestamp}`,
        email: `owner_${timestamp}@test.com`,
      });

      testServer = await testDb.gameServer.create({
        data: {
          name: "Alert Test Server",
          ipAddress: "10.9.0.1",
          type: "corporate",
          ownerId: serverOwner.id,
          isOnline: true,
        },
      });
    });

    test("should trigger security alert", async () => {
      await serverService.triggerSecurityAlert(
        testServer.id,
        testUser.id,
        "Unauthorized access attempt",
      );

      const hackLogs = await testDb.hackLog.findMany({
        where: {
          attackerId: testUser.id,
          targetServerId: testServer.id,
        },
      });

      expect(hackLogs).toHaveLength(1);
      expect(hackLogs[0]?.method).toBe("SECURITY_ALERT");
      expect(hackLogs[0]?.detected).toBe(true);
    });

    test("should create hack log with alert metadata", async () => {
      await serverService.triggerSecurityAlert(
        testServer.id,
        testUser.id,
        "Port scanning detected",
      );

      const hackLog = await testDb.hackLog.findFirst({
        where: {
          attackerId: testUser.id,
          targetServerId: testServer.id,
        },
      });

      expect(hackLog?.metadata).toBeDefined();
      expect((hackLog?.metadata as any).reason).toBe("Port scanning detected");
    });

    test("should throw error for non-existent server", async () => {
      await expect(
        serverService.triggerSecurityAlert(
          "fake-server-id",
          testUser.id,
          "Test alert",
        ),
      ).rejects.toThrow("Server not found");
    });
  });

  describe("Server State Management", () => {
    let testServer: any;

    beforeEach(async () => {
      testServer = await testDb.gameServer.create({
        data: {
          name: "State Test Server",
          ipAddress: "10.10.0.1",
          type: "personal",
          isOnline: true,
          currentConnections: 5,
        },
      });
    });

    test("should get server state", async () => {
      const state = await serverService.getServerState(testServer.id);

      expect(state).toBeDefined();
      expect(state.online).toBe(true);
      expect(state.connections).toBeGreaterThanOrEqual(0);
      expect(state.load).toBeGreaterThanOrEqual(0);
      expect(state.lastActivity).toBeInstanceOf(Date);
      expect(state.alerts).toBeGreaterThanOrEqual(0);
    });

    test("should calculate load based on connection count", async () => {
      const state = await serverService.getServerState(testServer.id);

      expect(state.load).toBeGreaterThanOrEqual(0);
    });
  });
});
