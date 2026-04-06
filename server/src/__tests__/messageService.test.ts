/**
 * MessageService Integration Tests
 * Tests message sending, receiving, reading, encryption, and notifications
 */

import "reflect-metadata";
import MessageService from "../services/messageService";
import { testDb, createTestUser } from "./setup";

describe("MessageService Integration Tests", () => {
  let messageService: MessageService;

  beforeAll(() => {
    // Instantiate MessageService directly with mocked dependencies
    const mockIo = {
      to: jest.fn().mockReturnThis(),
      emit: jest.fn(),
    } as any;
    messageService = new MessageService(mockIo, undefined);
  });

  // ==================== SEND PRIVATE MESSAGES ====================

  describe("Send Private Messages", () => {
    it("should send a private message successfully", async () => {
      const sender = await createTestUser({
        username: "sender1",
        email: "sender1@test.com",
      });
      const recipient = await createTestUser({
        username: "recipient1",
        email: "recipient1@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Test Message",
          content: "Hello, this is a test message.",
        },
      );

      expect(result.success).toBe(true);
      expect(result.message).toContain("Message sent");
      expect(result.data).toBeDefined();
      expect(result.data.messageId).toBeDefined();
    });

    it("should reject message with invalid sender", async () => {
      const recipient = await createTestUser({
        username: "recipient2",
        email: "recipient2@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        "invalid-sender-id",
        recipient.id,
        {
          subject: "Test",
          content: "Test content",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("SENDER_NOT_FOUND");
    });

    it("should reject message with invalid recipient", async () => {
      const sender = await createTestUser({
        username: "sender3",
        email: "sender3@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        "invalid-recipient-id",
        {
          subject: "Test",
          content: "Test content",
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("RECIPIENT_NOT_FOUND");
    });

    it("should send message without subject (chat style)", async () => {
      const sender = await createTestUser({
        username: "sender4",
        email: "sender4@test.com",
      });
      const recipient = await createTestUser({
        username: "recipient4",
        email: "recipient4@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "Quick chat message",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.message.subject).toBe("");
    });

    it("should include sender and recipient usernames", async () => {
      const sender = await createTestUser({
        username: "sender5",
        email: "sender5@test.com",
      });
      const recipient = await createTestUser({
        username: "recipient5",
        email: "recipient5@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Username Test",
          content: "Testing usernames",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.message.senderUsername).toBe("sender5");
      expect(result.data.message.recipientUsername).toBe("recipient5");
    });

    it("should mark message as unread initially", async () => {
      const sender = await createTestUser({
        username: "sender6",
        email: "sender6@test.com",
      });
      const recipient = await createTestUser({
        username: "recipient6",
        email: "recipient6@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Unread Test",
          content: "Should be unread",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.message.isRead).toBe(false);
    });

    it("should set message type to private by default", async () => {
      const sender = await createTestUser({
        username: "sender7",
        email: "sender7@test.com",
      });
      const recipient = await createTestUser({
        username: "recipient7",
        email: "recipient7@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "Private message",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.message.messageType).toBe("private");
    });

    it("should accept custom message type", async () => {
      const sender = await createTestUser({
        username: "sender8",
        email: "sender8@test.com",
      });
      const recipient = await createTestUser({
        username: "recipient8",
        email: "recipient8@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "Faction message",
          messageType: "faction",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.message.messageType).toBe("faction");
    });
  });

  // ==================== MESSAGE ENCRYPTION ====================

  describe("Message Encryption", () => {
    it("should encrypt message when requested", async () => {
      const sender = await createTestUser({
        username: "encrypt1",
        email: "encrypt1@test.com",
      });
      const recipient = await createTestUser({
        username: "encryptrecip1",
        email: "encryptrecip1@test.com",
      });

      // Set cryptography skill
      await testDb.playerProgress.update({
        where: { userId: sender.id },
        data: { cryptography: 50 },
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Secret Message",
          content: "This should be encrypted",
          encrypt: true,
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.isEncrypted).toBe(true);
      expect(result.data.encryptionLevel).toBeGreaterThan(0);
      expect(result.data.message.isEncrypted).toBe(true);
    });

    it("should fail encryption without player progress", async () => {
      const sender = await createTestUser({
        username: "encrypt2",
        email: "encrypt2@test.com",
      });
      const recipient = await createTestUser({
        username: "encryptrecip2",
        email: "encryptrecip2@test.com",
      });

      // Delete player progress
      await testDb.playerProgress.delete({
        where: { userId: sender.id },
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "Should fail",
          encrypt: true,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("NO_PROGRESS");
    });

    it("should base encryption level on cryptography skill", async () => {
      const sender = await createTestUser({
        username: "encrypt3",
        email: "encrypt3@test.com",
      });
      const recipient = await createTestUser({
        username: "encryptrecip3",
        email: "encryptrecip3@test.com",
      });

      // Set high cryptography skill
      await testDb.playerProgress.update({
        where: { userId: sender.id },
        data: { cryptography: 100 },
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "Highly encrypted",
          encrypt: true,
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.encryptionLevel).toBe(10); // 100 / 10 = max level
    });

    it("should cap encryption level at max based on skill", async () => {
      const sender = await createTestUser({
        username: "encrypt4",
        email: "encrypt4@test.com",
      });
      const recipient = await createTestUser({
        username: "encryptrecip4",
        email: "encryptrecip4@test.com",
      });

      // Set low cryptography skill
      await testDb.playerProgress.update({
        where: { userId: sender.id },
        data: { cryptography: 25 },
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "Capped encryption",
          encrypt: true,
          encryptionLevel: 10, // Request high level but skill too low
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.encryptionLevel).toBe(2); // 25 / 10 = 2, not 10
    });

    it("should not encrypt if encryption level is 0", async () => {
      const sender = await createTestUser({
        username: "encrypt5",
        email: "encrypt5@test.com",
      });
      const recipient = await createTestUser({
        username: "encryptrecip5",
        email: "encryptrecip5@test.com",
      });

      // Set very low cryptography skill
      await testDb.playerProgress.update({
        where: { userId: sender.id },
        data: { cryptography: 5 },
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          content: "No encryption",
          encrypt: true,
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.isEncrypted).toBe(false);
    });
  });

  // ==================== SYSTEM MESSAGES ====================

  describe("System Messages", () => {
    it("should send system message", async () => {
      const recipient = await createTestUser({
        username: "sysrecip1",
        email: "sysrecip1@test.com",
      });

      const result = await messageService.sendSystemMessage(
        recipient.id,
        "System Notice",
        "This is a system message.",
      );

      expect(result.success).toBe(true);
      expect(result.data.messageId).toBeDefined();

      // Fetch message from database to verify
      const message = await testDb.message.findUnique({
        where: { id: result.data.messageId },
      });

      expect(message).toBeDefined();
      expect(message?.messageType).toBe("system");
    });

    it("should use SYSTEM as sender username", async () => {
      const recipient = await createTestUser({
        username: "sysrecip2",
        email: "sysrecip2@test.com",
      });

      const result = await messageService.sendSystemMessage(
        recipient.id,
        "Notice",
        "System notification",
      );

      expect(result.success).toBe(true);

      // Fetch message with sender info
      const message = await testDb.message.findUnique({
        where: { id: result.data.messageId },
        include: { sender: true },
      });

      expect(message).toBeDefined();
      expect(message?.sender.username).toBe("SYSTEM");
    });

    it("should accept custom message type for system messages", async () => {
      const recipient = await createTestUser({
        username: "sysrecip3",
        email: "sysrecip3@test.com",
      });

      const result = await messageService.sendSystemMessage(
        recipient.id,
        "Alert",
        "Important alert",
        "alert",
      );

      expect(result.success).toBe(true);

      // Fetch message from database
      const message = await testDb.message.findUnique({
        where: { id: result.data.messageId },
      });

      expect(message).toBeDefined();
      expect(message?.messageType).toBe("alert");
    });
  });

  // ==================== BROADCAST MESSAGES ====================

  describe("Broadcast Messages", () => {
    it("should broadcast to multiple recipients", async () => {
      const sender = await createTestUser({
        username: "broadcast1",
        email: "broadcast1@test.com",
      });
      const recipient1 = await createTestUser({
        username: "broadrecip1",
        email: "broadrecip1@test.com",
      });
      const recipient2 = await createTestUser({
        username: "broadrecip2",
        email: "broadrecip2@test.com",
      });
      const recipient3 = await createTestUser({
        username: "broadrecip3",
        email: "broadrecip3@test.com",
      });

      const result = await messageService.broadcastMessage(
        sender.id,
        [recipient1.id, recipient2.id, recipient3.id],
        {
          subject: "Broadcast Test",
          content: "Message for everyone",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(3);
      expect(result.data.successful).toBe(3);
      expect(result.data.failed).toBe(0);
    });

    it("should handle partial broadcast failures", async () => {
      const sender = await createTestUser({
        username: "broadcast2",
        email: "broadcast2@test.com",
      });
      const recipient1 = await createTestUser({
        username: "broadrecip4",
        email: "broadrecip4@test.com",
      });

      const result = await messageService.broadcastMessage(
        sender.id,
        [recipient1.id, "invalid-id-1", "invalid-id-2"],
        {
          content: "Partial broadcast",
        },
      );

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(3);
      expect(result.data.successful).toBe(1);
      expect(result.data.failed).toBe(2);
    });

    it("should broadcast with empty recipient list", async () => {
      const sender = await createTestUser({
        username: "broadcast3",
        email: "broadcast3@test.com",
      });

      const result = await messageService.broadcastMessage(sender.id, [], {
        content: "No recipients",
      });

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(0);
    });
  });

  // ==================== RECEIVE MESSAGES ====================

  describe("Receive Messages", () => {
    it("should retrieve inbox messages", async () => {
      const sender = await createTestUser({
        username: "inboxsender1",
        email: "inboxsender1@test.com",
      });
      const recipient = await createTestUser({
        username: "inboxrecip1",
        email: "inboxrecip1@test.com",
      });

      // Send a message
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Inbox Test",
        content: "Message in inbox",
      });

      const result = await messageService.getInbox(recipient.id);

      expect(result.success).toBe(true);
      expect(result.data.messages).toBeDefined();
      expect(result.data.messages.length).toBeGreaterThan(0);
    });

    it("should filter unread messages only", async () => {
      const sender = await createTestUser({
        username: "inboxsender2",
        email: "inboxsender2@test.com",
      });
      const recipient = await createTestUser({
        username: "inboxrecip2",
        email: "inboxrecip2@test.com",
      });

      // Send messages
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Unread 1",
        content: "First unread",
      });
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Unread 2",
        content: "Second unread",
      });

      const result = await messageService.getInbox(recipient.id, {
        unreadOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.data.messages.every((msg: any) => !msg.isRead)).toBe(true);
    });

    it("should filter messages by type", async () => {
      const recipient = await createTestUser({
        username: "inboxrecip3",
        email: "inboxrecip3@test.com",
      });

      // Send system message
      await messageService.sendSystemMessage(
        recipient.id,
        "System Test",
        "System content",
      );

      const result = await messageService.getInbox(recipient.id, {
        type: "system",
      });

      expect(result.success).toBe(true);
      expect(
        result.data.messages.every((msg: any) => msg.messageType === "system"),
      ).toBe(true);
    });

    it("should limit number of messages returned", async () => {
      const sender = await createTestUser({
        username: "inboxsender4",
        email: "inboxsender4@test.com",
      });
      const recipient = await createTestUser({
        username: "inboxrecip4",
        email: "inboxrecip4@test.com",
      });

      // Send multiple messages
      for (let i = 0; i < 10; i++) {
        await messageService.sendPrivateMessage(sender.id, recipient.id, {
          subject: `Message ${i}`,
          content: `Content ${i}`,
        });
      }

      const result = await messageService.getInbox(recipient.id, {
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(result.data.messages.length).toBeLessThanOrEqual(5);
    });

    it("should include unread count in inbox response", async () => {
      const sender = await createTestUser({
        username: "inboxsender5",
        email: "inboxsender5@test.com",
      });
      const recipient = await createTestUser({
        username: "inboxrecip5",
        email: "inboxrecip5@test.com",
      });

      // Send messages
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Test 1",
        content: "Content 1",
      });

      const result = await messageService.getInbox(recipient.id);

      expect(result.success).toBe(true);
      expect(result.data.unreadCount).toBeDefined();
      expect(result.data.unreadCount).toBeGreaterThan(0);
    });

    it("should return empty inbox for user with no messages", async () => {
      const recipient = await createTestUser({
        username: "inboxrecip6",
        email: "inboxrecip6@test.com",
      });

      const result = await messageService.getInbox(recipient.id);

      expect(result.success).toBe(true);
      expect(result.data.messages).toHaveLength(0);
    });
  });

  // ==================== READ MESSAGES ====================

  describe("Read Messages", () => {
    it("should mark message as read", async () => {
      const sender = await createTestUser({
        username: "readsender1",
        email: "readsender1@test.com",
      });
      const recipient = await createTestUser({
        username: "readrecip1",
        email: "readrecip1@test.com",
      });

      // Send message
      const sendResult = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Read Test",
          content: "Please read me",
        },
      );

      const messageId = sendResult.data.messageId;

      // Mark as read
      const result = await messageService.markAsRead(messageId, recipient.id);

      expect(result.success).toBe(true);
    });

    it("should not allow reading other user's messages", async () => {
      const sender = await createTestUser({
        username: "readsender2",
        email: "readsender2@test.com",
      });
      const recipient = await createTestUser({
        username: "readrecip2",
        email: "readrecip2@test.com",
      });
      const hacker = await createTestUser({
        username: "hacker1",
        email: "hacker1@test.com",
      });

      // Send message
      const sendResult = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Private",
          content: "Not for you",
        },
      );

      const messageId = sendResult.data.messageId;

      // Try to read as different user
      const result = await messageService.markAsRead(messageId, hacker.id);

      expect(result.success).toBe(false);
    });

    it("should mark multiple messages as read", async () => {
      const sender = await createTestUser({
        username: "readsender3",
        email: "readsender3@test.com",
      });
      const recipient = await createTestUser({
        username: "readrecip3",
        email: "readrecip3@test.com",
      });

      // Send messages
      const msg1 = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Message 1",
          content: "Content 1",
        },
      );
      const msg2 = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Message 2",
          content: "Content 2",
        },
      );

      const messageIds = [msg1.data.messageId, msg2.data.messageId];

      // Mark multiple as read
      const result = await messageService.markMultipleAsRead(
        messageIds,
        recipient.id,
      );

      expect(result.success).toBe(true);
    });

    it("should get read status of message", async () => {
      const sender = await createTestUser({
        username: "readsender4",
        email: "readsender4@test.com",
      });
      const recipient = await createTestUser({
        username: "readrecip4",
        email: "readrecip4@test.com",
      });

      // Send message
      const sendResult = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Status Test",
          content: "Check my status",
        },
      );

      const messageId = sendResult.data.messageId;

      // Get message to check read status
      const message = await testDb.message.findUnique({
        where: { id: messageId },
      });

      expect(message).toBeDefined();
      expect(message?.isRead).toBe(false);

      // Mark as read
      await messageService.markAsRead(messageId, recipient.id);

      // Check again
      const updatedMessage = await testDb.message.findUnique({
        where: { id: messageId },
      });

      expect(updatedMessage?.isRead).toBe(true);
    });
  });

  // ==================== DELETE MESSAGES ====================

  describe("Delete Messages", () => {
    it("should delete a message", async () => {
      const sender = await createTestUser({
        username: "delsender1",
        email: "delsender1@test.com",
      });
      const recipient = await createTestUser({
        username: "delrecip1",
        email: "delrecip1@test.com",
      });

      // Send message
      const sendResult = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Delete Me",
          content: "This will be deleted",
        },
      );

      const messageId = sendResult.data.messageId;

      // Delete message
      const result = await messageService.deleteMessage(
        messageId,
        recipient.id,
      );

      expect(result.success).toBe(true);

      // Verify deletion
      const message = await testDb.message.findUnique({
        where: { id: messageId },
      });

      expect(message).toBeNull();
    });

    it("should not allow deleting other user's messages", async () => {
      const sender = await createTestUser({
        username: "delsender2",
        email: "delsender2@test.com",
      });
      const recipient = await createTestUser({
        username: "delrecip2",
        email: "delrecip2@test.com",
      });
      const hacker = await createTestUser({
        username: "hacker2",
        email: "hacker2@test.com",
      });

      // Send message
      const sendResult = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Protected",
          content: "Can't delete this",
        },
      );

      const messageId = sendResult.data.messageId;

      // Try to delete as different user
      const result = await messageService.deleteMessage(messageId, hacker.id);

      expect(result.success).toBe(false);
    });
  });

  // ==================== MESSAGE STATISTICS ====================

  describe("Message Statistics", () => {
    it("should get unread message count", async () => {
      const sender = await createTestUser({
        username: "statsender1",
        email: "statsender1@test.com",
      });
      const recipient = await createTestUser({
        username: "statrecip1",
        email: "statrecip1@test.com",
      });

      // Send messages
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Unread 1",
        content: "Content 1",
      });
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Unread 2",
        content: "Content 2",
      });

      const count = await messageService.getUnreadCount(recipient.id);

      expect(count).toBeGreaterThanOrEqual(2);
    });

    it("should get message statistics", async () => {
      const sender = await createTestUser({
        username: "statsender2",
        email: "statsender2@test.com",
      });
      const recipient = await createTestUser({
        username: "statrecip2",
        email: "statrecip2@test.com",
      });

      // Send messages
      await messageService.sendPrivateMessage(sender.id, recipient.id, {
        subject: "Stats Test",
        content: "For statistics",
      });

      const result = await messageService.getMessageStats(recipient.id);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.received).toBeDefined();
      expect(result.data.sent).toBeDefined();
      expect(result.data.unread).toBeDefined();
    });

    it("should return 0 unread for user with no messages", async () => {
      const user = await createTestUser({
        username: "statrecip3",
        email: "statrecip3@test.com",
      });

      const count = await messageService.getUnreadCount(user.id);

      expect(count).toBe(0);
    });
  });

  // ==================== EDGE CASES ====================

  describe("Edge Cases", () => {
    it("should handle very long message content", async () => {
      const sender = await createTestUser({
        username: "edgesender1",
        email: "edgesender1@test.com",
      });
      const recipient = await createTestUser({
        username: "edgerecip1",
        email: "edgerecip1@test.com",
      });

      const longContent = "A".repeat(5000);

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Long Content",
          content: longContent,
        },
      );

      expect(result.success).toBe(true);
    });

    it("should handle special characters in content", async () => {
      const sender = await createTestUser({
        username: "edgesender2",
        email: "edgesender2@test.com",
      });
      const recipient = await createTestUser({
        username: "edgerecip2",
        email: "edgerecip2@test.com",
      });

      const specialContent =
        "Special: <script>alert('xss')</script> & emojis 🎉";

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Special Chars",
          content: specialContent,
        },
      );

      expect(result.success).toBe(true);
    });

    it("should handle empty message content gracefully", async () => {
      const sender = await createTestUser({
        username: "edgesender3",
        email: "edgesender3@test.com",
      });
      const recipient = await createTestUser({
        username: "edgerecip3",
        email: "edgerecip3@test.com",
      });

      const result = await messageService.sendPrivateMessage(
        sender.id,
        recipient.id,
        {
          subject: "Empty Content",
          content: "",
        },
      );

      expect(result.success).toBe(true);
    });

    it("should handle sending to same user multiple times", async () => {
      const sender = await createTestUser({
        username: "edgesender4",
        email: "edgesender4@test.com",
      });
      const recipient = await createTestUser({
        username: "edgerecip4",
        email: "edgerecip4@test.com",
      });

      for (let i = 0; i < 5; i++) {
        const result = await messageService.sendPrivateMessage(
          sender.id,
          recipient.id,
          {
            subject: `Message ${i}`,
            content: `Content ${i}`,
          },
        );

        expect(result.success).toBe(true);
      }

      const inbox = await messageService.getInbox(recipient.id);
      expect(inbox.data.messages.length).toBeGreaterThanOrEqual(5);
    });

    it("should handle deleting non-existent message", async () => {
      const user = await createTestUser({
        username: "edgeuser5",
        email: "edgeuser5@test.com",
      });

      const result = await messageService.deleteMessage(
        "nonexistent-message-id",
        user.id,
      );

      expect(result.success).toBe(false);
    });

    it("should handle reading non-existent message", async () => {
      const user = await createTestUser({
        username: "edgeuser6",
        email: "edgeuser6@test.com",
      });

      const result = await messageService.markAsRead(
        "nonexistent-message-id",
        user.id,
      );

      expect(result.success).toBe(false);
    });
  });
});
