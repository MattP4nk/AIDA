/**
 * Integration tests for Notification Model
 * Tests CRUD operations for in-game notifications using real database
 */

import { describe, it, expect, beforeEach } from "@jest/globals";
import { testDb, createTestUser, createTestNotification } from "./setup";

describe("Notification Model Integration Tests", () => {
  let testUser: any;

  beforeEach(async () => {
    // Create test user
    testUser = await createTestUser({
      username: "notif_user",
      email: "notif@test.com",
    });
  });

  describe("Create Notifications", () => {
    it("should create a notification for user", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Welcome",
          message: "Welcome to AIDA!",
          category: "game",
        },
      });

      expect(notification).toBeDefined();
      expect(notification.id).toBeDefined();
      expect(notification.title).toBe("Welcome");
      expect(notification.isRead).toBe(false);
    });

    it("should create notification with different types", async () => {
      const types = ["info", "warning", "success", "error", "mission"];

      for (const type of types) {
        const notification = await testDb.notification.create({
          data: {
            userId: testUser.id,
            type,
            title: `${type} notification`,
            message: `This is a ${type} notification`,
            category: "game",
          },
        });

        expect(notification.type).toBe(type);
      }

      const allNotifications = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      expect(allNotifications.length).toBe(types.length);
    });

    it("should create notification with priority levels", async () => {
      const priorities = ["low", "normal", "high", "urgent"];

      for (const priority of priorities) {
        const notification = await testDb.notification.create({
          data: {
            userId: testUser.id,
            type: "info",
            title: "Test",
            message: "Test message",
            category: "game",
            priority,
          },
        });

        expect(notification.priority).toBe(priority);
      }
    });

    it("should create notification with additional data", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "mission",
          title: "New Mission Available",
          message: "A new hacking mission is available",
          category: "mission",
          data: {
            missionId: "mission-123",
            reward: 500,
            difficulty: 3,
          },
        },
      });

      expect(notification.data).toBeDefined();
      expect(notification.data).toMatchObject({
        missionId: "mission-123",
        reward: 500,
        difficulty: 3,
      });
    });

    it("should create notification with expiration", async () => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Limited Time",
          message: "This notification will expire",
          category: "game",
          expiresAt,
        },
      });

      expect(notification.expiresAt).toBeInstanceOf(Date);
      expect(notification.expiresAt?.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("Read Notifications", () => {
    beforeEach(async () => {
      // Create some test notifications
      await createTestNotification(testUser.id, {
        title: "First Notification",
        type: "info",
      });
      await createTestNotification(testUser.id, {
        title: "Second Notification",
        type: "warning",
      });
      await createTestNotification(testUser.id, {
        title: "Third Notification",
        type: "success",
      });
    });

    it("should retrieve all notifications for user", async () => {
      const notifications = await testDb.notification.findMany({
        where: { userId: testUser.id },
        orderBy: { createdAt: "desc" },
      });

      expect(notifications.length).toBe(3);
      expect(notifications[0]?.title).toBe("Third Notification");
    });

    it("should filter unread notifications", async () => {
      const unreadNotifications = await testDb.notification.findMany({
        where: {
          userId: testUser.id,
          isRead: false,
        },
      });

      expect(unreadNotifications.length).toBe(3);
      unreadNotifications.forEach((notif) => {
        expect(notif.isRead).toBe(false);
      });
    });

    it("should filter notifications by type", async () => {
      const warningNotifications = await testDb.notification.findMany({
        where: {
          userId: testUser.id,
          type: "warning",
        },
      });

      expect(warningNotifications.length).toBe(1);
      expect(warningNotifications[0]?.type).toBe("warning");
    });

    it("should filter notifications by category", async () => {
      // Create notifications with different categories
      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Social Update",
          message: "New message",
          category: "social",
        },
      });

      const socialNotifications = await testDb.notification.findMany({
        where: {
          userId: testUser.id,
          category: "social",
        },
      });

      expect(socialNotifications.length).toBe(1);
      expect(socialNotifications[0]?.category).toBe("social");
    });

    it("should count unread notifications", async () => {
      const unreadCount = await testDb.notification.count({
        where: {
          userId: testUser.id,
          isRead: false,
        },
      });

      expect(unreadCount).toBe(3);
    });

    it("should get notifications sorted by priority", async () => {
      // Create notifications with different priorities
      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "error",
          title: "Urgent Alert",
          message: "System compromised",
          category: "security",
          priority: "urgent",
        },
      });

      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Low Priority",
          message: "General update",
          category: "game",
          priority: "low",
        },
      });

      const allNotifications = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      const urgentNotif = allNotifications.find((n) => n.priority === "urgent");
      const lowNotif = allNotifications.find((n) => n.priority === "low");

      expect(urgentNotif).toBeDefined();
      expect(lowNotif).toBeDefined();
    });
  });

  describe("Update Notifications", () => {
    it("should mark notification as read", async () => {
      const notification = await createTestNotification(testUser.id);

      const updated = await testDb.notification.update({
        where: { id: notification.id },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      expect(updated.isRead).toBe(true);
      expect(updated.readAt).toBeInstanceOf(Date);
    });

    it("should mark notification as dismissed", async () => {
      const notification = await createTestNotification(testUser.id);

      const updated = await testDb.notification.update({
        where: { id: notification.id },
        data: { isDismissed: true },
      });

      expect(updated.isDismissed).toBe(true);
    });

    it("should mark multiple notifications as read", async () => {
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);

      const result = await testDb.notification.updateMany({
        where: {
          userId: testUser.id,
          isRead: false,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });

      expect(result.count).toBe(3);

      const unreadCount = await testDb.notification.count({
        where: {
          userId: testUser.id,
          isRead: false,
        },
      });

      expect(unreadCount).toBe(0);
    });

    it("should update notification data", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "mission",
          title: "Mission Update",
          message: "Mission progress",
          category: "mission",
          data: { progress: 50 },
        },
      });

      const updated = await testDb.notification.update({
        where: { id: notification.id },
        data: {
          data: { progress: 75 },
        },
      });

      expect(updated.data).toMatchObject({ progress: 75 });
    });
  });

  describe("Delete Notifications", () => {
    it("should delete a single notification", async () => {
      const notification = await createTestNotification(testUser.id);

      await testDb.notification.delete({
        where: { id: notification.id },
      });

      const found = await testDb.notification.findUnique({
        where: { id: notification.id },
      });

      expect(found).toBeNull();
    });

    it("should delete all notifications for user", async () => {
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);

      const result = await testDb.notification.deleteMany({
        where: { userId: testUser.id },
      });

      expect(result.count).toBe(3);

      const remaining = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      expect(remaining.length).toBe(0);
    });

    it("should delete read notifications only", async () => {
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);

      // Mark one as read
      const notifications = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      await testDb.notification.update({
        where: { id: notifications[0]!.id },
        data: { isRead: true },
      });

      // Delete only read notifications
      const result = await testDb.notification.deleteMany({
        where: {
          userId: testUser.id,
          isRead: true,
        },
      });

      expect(result.count).toBe(1);

      const remaining = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      expect(remaining.length).toBe(1);
      expect(remaining[0]?.isRead).toBe(false);
    });

    it("should delete expired notifications", async () => {
      // Create expired notification
      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Expired",
          message: "This is expired",
          category: "game",
          expiresAt: new Date(Date.now() - 1000), // Expired 1 second ago
        },
      });

      // Create active notification
      await createTestNotification(testUser.id);

      // Delete expired
      const result = await testDb.notification.deleteMany({
        where: {
          userId: testUser.id,
          expiresAt: {
            lt: new Date(),
          },
        },
      });

      expect(result.count).toBe(1);

      const remaining = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      expect(remaining.length).toBe(1);
    });
  });

  describe("Notification Categories", () => {
    it("should handle game category notifications", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "success",
          title: "Level Up!",
          message: "You reached level 5",
          category: "game",
        },
      });

      expect(notification.category).toBe("game");
    });

    it("should handle social category notifications", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "New Message",
          message: "You have a new message from Alice",
          category: "social",
        },
      });

      expect(notification.category).toBe("social");
    });

    it("should handle security category notifications", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "warning",
          title: "Security Alert",
          message: "Suspicious login attempt detected",
          category: "security",
          priority: "high",
        },
      });

      expect(notification.category).toBe("security");
      expect(notification.priority).toBe("high");
    });

    it("should handle mission category notifications", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "mission",
          title: "Mission Complete",
          message: "You completed the hacking challenge",
          category: "mission",
          data: {
            missionId: "hack-001",
            reward: 1000,
          },
        },
      });

      expect(notification.category).toBe("mission");
    });

    it("should handle faction category notifications", async () => {
      const notification = await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Faction Update",
          message: "Your faction reputation increased",
          category: "faction",
        },
      });

      expect(notification.category).toBe("faction");
    });
  });

  describe("Notification Queries", () => {
    beforeEach(async () => {
      // Create diverse set of notifications
      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "info",
          title: "Info 1",
          message: "Message 1",
          category: "game",
          priority: "normal",
        },
      });

      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "warning",
          title: "Warning 1",
          message: "Message 2",
          category: "security",
          priority: "high",
        },
      });

      await testDb.notification.create({
        data: {
          userId: testUser.id,
          type: "error",
          title: "Error 1",
          message: "Message 3",
          category: "security",
          priority: "urgent",
        },
      });
    });

    it("should paginate notifications", async () => {
      const page1 = await testDb.notification.findMany({
        where: { userId: testUser.id },
        orderBy: { createdAt: "desc" },
        take: 2,
        skip: 0,
      });

      const page2 = await testDb.notification.findMany({
        where: { userId: testUser.id },
        orderBy: { createdAt: "desc" },
        take: 2,
        skip: 2,
      });

      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
      expect(page1[0]?.id).not.toBe(page2[0]?.id);
    });

    it("should get recent notifications", async () => {
      const recentNotifications = await testDb.notification.findMany({
        where: { userId: testUser.id },
        orderBy: { createdAt: "desc" },
        take: 5,
      });

      expect(recentNotifications.length).toBeLessThanOrEqual(5);
    });

    it("should count notifications by category", async () => {
      const securityCount = await testDb.notification.count({
        where: {
          userId: testUser.id,
          category: "security",
        },
      });

      expect(securityCount).toBe(2);
    });

    it("should get high priority unread notifications", async () => {
      const highPriorityUnread = await testDb.notification.findMany({
        where: {
          userId: testUser.id,
          isRead: false,
          priority: {
            in: ["high", "urgent"],
          },
        },
      });

      expect(highPriorityUnread.length).toBe(2);
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid user ID", async () => {
      await expect(
        testDb.notification.create({
          data: {
            userId: "invalid-user-id",
            type: "info",
            title: "Test",
            message: "Test",
            category: "game",
          },
        }),
      ).rejects.toThrow();
    });

    it("should handle missing required fields", async () => {
      await expect(
        testDb.notification.create({
          data: {
            userId: testUser.id,
            // Missing type, title, message
          } as any,
        }),
      ).rejects.toThrow();
    });
  });

  describe("Cascade Delete", () => {
    it("should delete notifications when user is deleted", async () => {
      await createTestNotification(testUser.id);
      await createTestNotification(testUser.id);

      // Delete user (should cascade to notifications)
      await testDb.user.delete({
        where: { id: testUser.id },
      });

      const notifications = await testDb.notification.findMany({
        where: { userId: testUser.id },
      });

      expect(notifications.length).toBe(0);
    });
  });
});
