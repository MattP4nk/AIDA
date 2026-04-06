/**
 * Jest Test Setup
 * Configures test environment with real test database
 */

import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { container } from "tsyringe";
import { Server as SocketIOServer } from "socket.io";

// Import tokens
import * as TOKENS from "../di/tokens";

// Import services
import ShopService from "../services/shopService";
import HackService from "../services/hackService";
import ProgressService from "../services/progressService";
import EventService from "../services/eventService";
import { InventoryService } from "../services/inventoryService";
import MissionService from "../services/missionService";
import ServerService from "../services/serverService";
import { CacheService } from "../services/cacheService";

// Create mock Socket.IO server for tests
const mockIo = {
  on: jest.fn(),
  emit: jest.fn(),
  to: jest.fn().mockReturnThis(),
  sockets: {
    emit: jest.fn(),
  },
} as any as SocketIOServer;

// Create a single Prisma client instance for all tests
export const testDb = new PrismaClient({
  datasources: {
    db: {
      url:
        process.env.DATABASE_URL ||
        "postgresql://mattp4nk@localhost:5432/aida_test",
    },
  },
});

// Global setup - runs once before all tests
beforeAll(async () => {
  // Register services in DI container for tests
  container.registerInstance(TOKENS.SOCKET_IO, mockIo);
  container.registerInstance(TOKENS.PRISMA_CLIENT, testDb);

  // Register null instance for optional dependencies to avoid complex dependency chains
  container.registerInstance(TOKENS.MISSION_INTEGRATION_SERVICE, null);

  // Register services as singletons
  container.registerSingleton(TOKENS.CACHE_SERVICE, CacheService);
  container.registerSingleton(TOKENS.SHOP_SERVICE, ShopService);
  container.registerSingleton(TOKENS.HACK_SERVICE, HackService);
  container.registerSingleton(TOKENS.PROGRESS_SERVICE, ProgressService);
  container.registerSingleton(TOKENS.EVENT_SERVICE, EventService);
  container.registerSingleton(TOKENS.INVENTORY_SERVICE, InventoryService);
  container.registerSingleton(TOKENS.MISSION_SERVICE, MissionService);
  container.registerSingleton(TOKENS.SERVER_SERVICE, ServerService);

  // Connect to test database
  await testDb.$connect();
  console.log("✅ Connected to test database");
  console.log("✅ DI container initialized for tests");
});

// Global teardown - runs once after all tests
afterAll(async () => {
  // Disconnect from test database
  await testDb.$disconnect();
  console.log("✅ Disconnected from test database");
});

// Clean up database before each test to ensure isolation
beforeEach(async () => {
  // Delete all data in reverse order of dependencies to avoid foreign key issues
  await testDb.notification.deleteMany({});
  await testDb.inventoryItem.deleteMany({});
  await testDb.message.deleteMany({});
  await testDb.post.deleteMany({});
  await testDb.forumPost.deleteMany({});
  await testDb.forumDiscovery.deleteMany({});
  await testDb.forumMember.deleteMany({});
  await testDb.forum.deleteMany({});
  await testDb.contact.deleteMany({});
  await testDb.mission.deleteMany({});
  await testDb.keyFragmentDiscovery.deleteMany({});
  await testDb.keyFragment.deleteMany({});
  await testDb.intelligenceReport.deleteMany({});
  await testDb.storyProgress.deleteMany({});
  await testDb.proxyConnection.deleteMany({});
  await testDb.progressBackup.deleteMany({});
  await testDb.playerProgress.deleteMany({});
  await testDb.userSession.deleteMany({});
  await testDb.serverConnection.deleteMany({});
  await testDb.fileSystemNode.deleteMany({});
  // Delete hack-related tables before users
  await testDb.hackLog.deleteMany({});
  await testDb.gameEvent.deleteMany({});
  await testDb.user.deleteMany({});
  await testDb.gameServer.deleteMany({});
  await testDb.shopItem.deleteMany({});
  await testDb.faction.deleteMany({});
});

// Helper function to create a test user
export async function createTestUser(data?: {
  username?: string;
  email?: string;
  password?: string;
}) {
  // Generate unique IP based on timestamp to avoid collisions
  const timestamp = Date.now();
  const ipSuffix = timestamp % 100000; // Use last 5 digits of timestamp
  const octet3 = Math.floor(ipSuffix / 256);
  const octet4 = ipSuffix % 256;

  return await testDb.user.create({
    data: {
      username: data?.username || "testuser",
      email: data?.email || "test@example.com",
      password: data?.password || "$2b$04$testhashedpassword",
      homeIp: `10.${octet3}.${octet4}.1`,
      isActive: true,
      progress: {
        create: {
          level: 1,
          experience: 0,
          credits: 100,
          hacking: 1,
          stealth: 1,
          cryptography: 1,
        },
      },
    },
    include: {
      progress: true,
    },
  });
}

// Helper function to create a test server
export async function createTestServer(data?: {
  name?: string;
  ipAddress?: string;
  difficulty?: number;
}) {
  return await testDb.gameServer.create({
    data: {
      name: data?.name || "TestServer",
      ipAddress: data?.ipAddress || "192.168.1.100",
      type: "corporate",
      securityLevel: data?.difficulty || 1,
      firewallLevel: data?.difficulty || 1,
      encryptionLevel: 0,
      discoveryLevel: 0,
    },
  });
}

// Helper function to create a test faction
export async function createTestFaction(data?: {
  name?: string;
  description?: string;
}) {
  return await testDb.faction.create({
    data: {
      name: data?.name || "Test Faction",
      description: data?.description || "A test faction",
    },
  });
}

// Helper function to create a test shop item
export async function createTestShopItem(data?: {
  name?: string;
  price?: number;
  itemType?: string;
}) {
  return await testDb.shopItem.create({
    data: {
      name: data?.name || "Test Exploit Kit",
      description: "A test hacking tool",
      itemType: data?.itemType || "software",
      category: "hacking",
      price: data?.price || 100,
      level: 1,
      hackingBonus: 5,
    },
  });
}

// Helper function to create a test mission
export async function createTestMission(
  dataOrUserId?:
    | string
    | {
        title?: string;
        difficulty?: number;
        objectives?: any[];
        reward?: any;
        timeLimit?: number;
        status?: string;
        type?: string;
      },
) {
  // Support both calling patterns: createTestMission(userId, data) and createTestMission(data)
  let userId: string;
  let data: any = {};

  if (typeof dataOrUserId === "string") {
    userId = dataOrUserId;
  } else {
    // Create or get system user for mission creator
    let systemUser = await testDb.user.findUnique({
      where: { username: "system" },
    });

    if (!systemUser) {
      systemUser = await testDb.user.create({
        data: {
          username: "system",
          email: "system@aida.local",
          password: "$2b$04$systemhashedpassword",
          homeIp: "127.0.0.1",
          isActive: true,
          progress: {
            create: {
              level: 100,
              experience: 999999,
              credits: 999999,
              hacking: 100,
              stealth: 100,
              cryptography: 100,
            },
          },
        },
      });
    }

    userId = systemUser.id;
    data = dataOrUserId || {};
  }

  return await testDb.mission.create({
    data: {
      title: data?.title || "Test Mission",
      description: "A test hacking mission",
      type: data?.type || "hack",
      difficulty: data?.difficulty ?? 1,
      status: data?.status || "available",
      createdBy: userId,
      reward: data?.reward || { credits: 100, xp: 50 },
      objectives: data?.objectives || [
        { type: "hack_server", target: "192.168.1.1" },
      ],
      timeLimit: data?.timeLimit,
    },
  });
}

// Helper function to create a test notification
export async function createTestNotification(
  userId: string,
  data?: {
    title?: string;
    type?: string;
  },
) {
  return await testDb.notification.create({
    data: {
      userId,
      type: data?.type || "info",
      title: data?.title || "Test Notification",
      message: "This is a test notification",
      category: "game",
    },
  });
}

// Helper function to clean up after a specific test
export async function cleanupTestData() {
  await testDb.notification.deleteMany({});
  await testDb.inventoryItem.deleteMany({});
  await testDb.message.deleteMany({});
  await testDb.post.deleteMany({});
  await testDb.forumPost.deleteMany({});
  await testDb.forumDiscovery.deleteMany({});
  await testDb.forumMember.deleteMany({});
  await testDb.forum.deleteMany({});
  await testDb.contact.deleteMany({});
  await testDb.mission.deleteMany({});
  await testDb.keyFragmentDiscovery.deleteMany({});
  await testDb.keyFragment.deleteMany({});
  await testDb.intelligenceReport.deleteMany({});
  await testDb.storyProgress.deleteMany({});
  await testDb.proxyConnection.deleteMany({});
  await testDb.progressBackup.deleteMany({});
  await testDb.playerProgress.deleteMany({});
  await testDb.userSession.deleteMany({});
  await testDb.serverConnection.deleteMany({});
  await testDb.fileSystemNode.deleteMany({});
  await testDb.user.deleteMany({});
  await testDb.gameServer.deleteMany({});
  await testDb.shopItem.deleteMany({});
  await testDb.faction.deleteMany({});
}

// Export test utilities
export { testDb as db };
