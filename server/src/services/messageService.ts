/**
 * MessageService - Real-Time Messaging System
 *
 * Handles all messaging operations including:
 * - Private messages between players
 * - Real-time delivery via Socket.IO
 * - Message encryption based on cryptography skill
 * - Read receipts and message status
 * - Message history and inbox management
 * - Encrypted message interception (for gameplay)
 *
 * Phase 2, Day 8
 */

import { prisma } from "../database/client";
import { Server as SocketIOServer } from "socket.io";
import crypto from "crypto";
import { Logger } from "pino";
import { injectable, inject } from "tsyringe";
import { LOGGER, SOCKET_IO, MISSION_INTEGRATION_SERVICE } from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";

// ==================== TYPES ====================

export interface MessageData {
  id: string;
  senderId: string;
  senderUsername?: string;
  recipientId: string;
  recipientUsername?: string;
  subject: string;
  content: string;
  timestamp: Date;
  isRead: boolean;
  isEncrypted: boolean;
  encryptionLevel?: number;
  messageType: MessageType;
}

export type MessageType =
  | "private"
  | "system"
  | "mission"
  | "alert"
  | "faction";

export interface SendMessageOptions {
  subject?: string;
  content: string;
  encrypt?: boolean;
  encryptionLevel?: number;
  messageType?: MessageType;
}

export interface MessageFilter {
  type?: MessageType;
  unreadOnly?: boolean;
  since?: Date;
  limit?: number;
  offset?: number;
}

export interface MessageOperationResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface EncryptionResult {
  encryptedContent: string;
  encryptionLevel: number;
  key: string;
}

// ==================== MESSAGE SERVICE CLASS ====================

@injectable()
export class MessageService {
  private encryptionAlgorithm = "aes-256-cbc";
  private deliveryQueue: Map<string, QueuedMessage[]> = new Map();
  private deliveryProcessorInterval: NodeJS.Timeout | null = null;
  private missionIntegration: MissionIntegrationService | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
  ) {
    this.missionIntegration = missionIntegrationService || null;
    this.startDeliveryProcessor();
  }

  // ==================== SEND MESSAGES ====================

  /**
   * Send a private message to another player
   */
  async sendPrivateMessage(
    senderId: string,
    recipientId: string,
    options: SendMessageOptions,
  ): Promise<MessageOperationResult> {
    try {
      // Validate users exist
      const [sender, recipient] = await Promise.all([
        prisma.user.findUnique({ where: { id: senderId } }),
        prisma.user.findUnique({ where: { id: recipientId } }),
      ]);

      if (!sender) {
        return {
          success: false,
          message: "Sender not found",
          error: "SENDER_NOT_FOUND",
        };
      }

      if (!recipient) {
        return {
          success: false,
          message: "Recipient not found",
          error: "RECIPIENT_NOT_FOUND",
        };
      }

      // Get sender's cryptography skill for encryption
      const senderProgress = await prisma.playerProgress.findUnique({
        where: { userId: senderId },
      });

      // Apply censorship filtering
      let filteredContent = options.content;
      try {
        const { getService } = await import("../di/container");
        const censorshipService = getService<import("./censorshipService").default>("CensorshipService");
        filteredContent = await censorshipService.filterAndAlert(options.content, { userId: senderId });
      } catch { /* Censorship service not available — pass through */ }

      let finalContent = filteredContent;
      let isEncrypted = false;
      let encryptionLevel: number | undefined;
      // SECURITY NOTE: Encryption keys are stored server-side deliberately to
      // enable future AI moderation and content-policy enforcement. This is a
      // conscious design choice — the threat model protects data in transit and
      // at the application boundary, not from the server itself.
      let storedEncryptionKey: string | undefined;

      // Handle encryption
      if (options.encrypt) {
        if (!senderProgress) {
          return {
            success: false,
            message: "Cannot encrypt: player progress not found",
            error: "NO_PROGRESS",
          };
        }

        const cryptoSkill = senderProgress.cryptography;
        const maxEncryptionLevel = Math.floor(cryptoSkill / 10); // 0-10 based on skill 0-100

        encryptionLevel = options.encryptionLevel
          ? Math.min(options.encryptionLevel, maxEncryptionLevel)
          : maxEncryptionLevel;

        if (encryptionLevel > 0) {
          const encryptionResult = await this.encryptMessage(
            options.content,
            encryptionLevel,
          );
          finalContent = encryptionResult.encryptedContent;
          storedEncryptionKey = encryptionResult.key;
          isEncrypted = true;
        }
      }

      // Create message in database (includes encryption key for server-side decryption)
      const message = await prisma.message.create({
        data: {
          senderId,
          recipientId,
          subject: options.subject || "", // Empty string for chat messages
          content: finalContent,
          isRead: false,
          isEncrypted,
          encryptionLevel:
            isEncrypted && encryptionLevel !== undefined
              ? encryptionLevel
              : null,
          encryptionKey: storedEncryptionKey || null,
          messageType: options.messageType || "private",
        },
      });

      // Try immediate delivery via Socket.IO
      const delivered = await this.deliverMessageRealtime(
        message.id,
        recipientId,
      );

      if (!delivered) {
        // Queue for later delivery
        this.queueMessage(recipientId, {
          messageId: message.id,
          timestamp: new Date(),
        });
      }

      // Log the message send
      await this.logMessageActivity(senderId, "send", message.id);

      // Track for mission objectives
      if (this.missionIntegration) {
        await this.missionIntegration.onMessageSent(
          senderId,
          recipientId,
          message.id,
        );
      }

      return {
        success: true,
        message: `Message sent to ${recipient.username}`,
        data: {
          messageId: message.id,
          delivered,
          isEncrypted,
          encryptionLevel: isEncrypted ? encryptionLevel : undefined,
          message: {
            id: message.id,
            senderId: message.senderId,
            senderUsername: sender.username,
            recipientId: message.recipientId,
            recipientUsername: recipient.username,
            subject: message.subject,
            content: finalContent,
            timestamp: message.timestamp,
            isRead: message.isRead,
            isEncrypted: message.isEncrypted,
            encryptionLevel: message.encryptionLevel,
            messageType: message.messageType as MessageType,
          },
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Send private message error");
      return {
        success: false,
        message: "Failed to send message",
        error: error.message,
      };
    }
  }

  /**
   * Send a system message (automated, from the game)
   */
  async sendSystemMessage(
    recipientId: string,
    subject: string,
    content: string,
    messageType: MessageType = "system",
  ): Promise<MessageOperationResult> {
    try {
      // Use system user ID (or create a system account)
      const systemUserId = await this.getSystemUserId();

      const message = await prisma.message.create({
        data: {
          senderId: systemUserId,
          recipientId,
          subject,
          content,
          isRead: false,
          isEncrypted: false,
          messageType,
        },
      });

      // Deliver immediately
      await this.deliverMessageRealtime(message.id, recipientId);

      return {
        success: true,
        message: "System message sent",
        data: { messageId: message.id },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Send system message error");
      return {
        success: false,
        message: "Failed to send system message",
        error: error.message,
      };
    }
  }

  /**
   * Send a message from an AI persona to a player
   *
   * PHASE 5: AI-driven messaging with rate limiting
   */
  async sendAIMessage(
    personaId: string,
    recipientId: string,
    subject: string,
    content: string,
  ): Promise<MessageOperationResult> {
    try {
      // Check daily AI message limit (5 total across all personas)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayCount = await prisma.message.count({
        where: {
          messageType: "faction",
          timestamp: { gte: today },
          sender: {
            id: { startsWith: "ai_" }, // AI persona IDs
          },
        },
      });

      if (todayCount >= 5) {
        return {
          success: false,
          message: "Daily AI message limit reached (5/day total)",
        };
      }

      // Get or create AI system user for this persona
      const aiUserId = await this.getAIUserId(personaId);

      const message = await prisma.message.create({
        data: {
          senderId: aiUserId,
          recipientId,
          subject,
          content,
          isRead: false,
          isEncrypted: false,
          messageType: "faction", // AI messages tagged as faction messages
        },
      });

      // Deliver immediately
      await this.deliverMessageRealtime(message.id, recipientId);

      return {
        success: true,
        message: "AI message sent",
        data: { messageId: message.id, count: todayCount + 1 },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Send AI message error");
      return {
        success: false,
        message: "Failed to send AI message",
        error: error.message,
      };
    }
  }

  /**
   * Broadcast message to multiple recipients
   */
  async broadcastMessage(
    senderId: string,
    recipientIds: string[],
    options: SendMessageOptions,
  ): Promise<MessageOperationResult> {
    try {
      const results = await Promise.all(
        recipientIds.map((recipientId) =>
          this.sendPrivateMessage(senderId, recipientId, options),
        ),
      );

      const successCount = results.filter((r) => r.success).length;

      return {
        success: true,
        message: `Broadcast sent to ${successCount}/${recipientIds.length} recipients`,
        data: {
          total: recipientIds.length,
          successful: successCount,
          failed: recipientIds.length - successCount,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Broadcast message error");
      return {
        success: false,
        message: "Failed to broadcast message",
        error: error.message,
      };
    }
  }

  // ==================== RECEIVE & READ MESSAGES ====================

  /**
   * Get inbox messages for a user
   */
  async getInbox(
    userId: string,
    filter: MessageFilter = {},
  ): Promise<MessageOperationResult> {
    try {
      const where: any = {
        recipientId: userId,
        subject: { not: { equals: "" } },
      };

      if (filter.type) {
        where.messageType = filter.type;
      }

      if (filter.unreadOnly) {
        where.isRead = false;
      }

      if (filter.since) {
        where.timestamp = { gte: filter.since };
      }

      const messages = await prisma.message.findMany({
        where,
        include: {
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { timestamp: "desc" },
        take: filter.limit || 50,
        skip: filter.offset || 0,
      });

      const unreadCount = await prisma.message.count({
        where: {
          recipientId: userId,
          isRead: false,
        },
      });

      return {
        success: true,
        message: `Retrieved ${messages.length} messages`,
        data: {
          messages: messages.map((msg) => this.formatMessageData(msg)),
          total: messages.length,
          unreadCount,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get inbox error");
      return {
        success: false,
        message: "Failed to retrieve inbox",
        error: error.message,
      };
    }
  }

  /**
   * Get sent messages for a user
   */
  async getSentMessages(
    userId: string,
    filter: MessageFilter = {},
  ): Promise<MessageOperationResult> {
    try {
      const where: any = {
        senderId: userId,
        subject: { not: { equals: "" } },
      };

      if (filter.type) {
        where.messageType = filter.type;
      }

      if (filter.since) {
        where.timestamp = { gte: filter.since };
      }

      const messages = await prisma.message.findMany({
        where,
        include: {
          recipient: {
            select: {
              id: true,
              username: true,
            },
          },
        },
        orderBy: { timestamp: "desc" },
        take: filter.limit || 50,
        skip: filter.offset || 0,
      });

      return {
        success: true,
        message: `Retrieved ${messages.length} sent messages`,
        data: {
          messages: messages.map((msg) => this.formatMessageData(msg)),
          total: messages.length,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get sent messages error");
      return {
        success: false,
        message: "Failed to retrieve sent messages",
        error: error.message,
      };
    }
  }

  /**
   * Get a specific message by ID
   */
  async getMessage(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
          recipient: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!message) {
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      // Check permission (sender or recipient)
      if (message.senderId !== userId && message.recipientId !== userId) {
        return {
          success: false,
          message: "Permission denied",
          error: "PERMISSION_DENIED",
        };
      }

      return {
        success: true,
        message: "Message retrieved",
        data: this.formatMessageData(message),
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get message error");
      return {
        success: false,
        message: "Failed to retrieve message",
        error: error.message,
      };
    }
  }

  /**
   * Mark message as read
   */
  async markAsRead(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      // Only recipient can mark as read
      if (message.recipientId !== userId) {
        return {
          success: false,
          message: "Permission denied",
          error: "PERMISSION_DENIED",
        };
      }

      if (message.isRead) {
        return {
          success: true,
          message: "Message already read",
          data: { messageId },
        };
      }

      await prisma.message.update({
        where: { id: messageId },
        data: { isRead: true },
      });

      // Send read receipt to sender in real-time
      await this.sendReadReceipt(message.senderId, messageId);

      await this.logMessageActivity(userId, "read", messageId);

      return {
        success: true,
        message: "Message marked as read",
        data: { messageId },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Mark as read error");
      return {
        success: false,
        message: "Failed to mark message as read",
        error: error.message,
      };
    }
  }

  /**
   * Mark multiple messages as read
   */
  async markMultipleAsRead(
    messageIds: string[],
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const updated = await prisma.message.updateMany({
        where: {
          id: { in: messageIds },
          recipientId: userId,
        },
        data: { isRead: true },
      });

      return {
        success: true,
        message: `Marked ${updated.count} messages as read`,
        data: { count: updated.count },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Mark multiple as read error");
      return {
        success: false,
        message: "Failed to mark messages as read",
        error: error.message,
      };
    }
  }

  /**
   * Delete a message (soft delete, only removes from user's view)
   */
  async deleteMessage(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      // Only sender or recipient can delete
      if (message.senderId !== userId && message.recipientId !== userId) {
        return {
          success: false,
          message: "Permission denied",
          error: "PERMISSION_DENIED",
        };
      }

      // For now, hard delete (could implement soft delete later)
      await prisma.message.delete({
        where: { id: messageId },
      });

      await this.logMessageActivity(userId, "delete", messageId);

      return {
        success: true,
        message: "Message deleted",
        data: { messageId },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Delete message error");
      return {
        success: false,
        message: "Failed to delete message",
        error: error.message,
      };
    }
  }

  // ==================== ENCRYPTION & DECRYPTION ====================

  /**
   * Encrypt message content based on skill level
   */
  private async encryptMessage(
    content: string,
    encryptionLevel: number,
  ): Promise<EncryptionResult> {
    try {
      // Generate encryption key based on level
      const keyLength = 16 + encryptionLevel * 2; // 16-36 bytes
      const key = crypto.randomBytes(keyLength).toString("hex");

      const iv = crypto.randomBytes(16);
      const keyBuffer = crypto.scryptSync(key, "salt", 32);
      const cipher = crypto.createCipheriv(
        this.encryptionAlgorithm,
        keyBuffer,
        iv,
      );

      let encrypted = cipher.update(content, "utf8", "hex");
      encrypted += cipher.final("hex");

      const encryptedContent = iv.toString("hex") + ":" + encrypted;

      return {
        encryptedContent,
        encryptionLevel,
        key,
      };
    } catch (error) {
      this.logger.error({ err: error }, "Encryption error");
      throw error;
    }
  }

  /**
   * Decrypt message content.
   *
   * If `key` is omitted/empty and `messageId` is provided, the stored
   * server-side encryption key will be looked up from the database.
   */
  async decryptMessage(
    encryptedContent: string,
    key: string | undefined,
    userId: string,
    messageId?: string,
  ): Promise<MessageOperationResult> {
    try {
      // If no key was supplied, try to look it up from the database
      let resolvedKey = key;
      if (!resolvedKey && messageId) {
        const dbMessage = await prisma.message.findUnique({
          where: { id: messageId },
          select: { encryptionKey: true, senderId: true, recipientId: true },
        });

        if (!dbMessage) {
          return { success: false, message: "Message not found", error: "NOT_FOUND" };
        }
        // Only sender or recipient may use the stored key
        if (dbMessage.senderId !== userId && dbMessage.recipientId !== userId) {
          return { success: false, message: "Permission denied", error: "PERMISSION_DENIED" };
        }
        if (!dbMessage.encryptionKey) {
          return {
            success: false,
            message: "No stored encryption key for this message",
            error: "NO_KEY",
          };
        }
        resolvedKey = dbMessage.encryptionKey;
      }

      if (!resolvedKey) {
        return {
          success: false,
          message: "No encryption key provided and no messageId to look it up",
          error: "NO_KEY",
        };
      }

      // Get user's cryptography skill
      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          message: "Player progress not found",
          error: "NO_PROGRESS",
        };
      }

      const parts = encryptedContent.split(":");
      if (parts.length !== 2) {
        return {
          success: false,
          message: "Invalid encrypted content format",
          error: "INVALID_FORMAT",
        };
      }

      const iv = Buffer.from(parts[0]!, "hex");
      const encrypted = parts[1]!;
      const keyBuffer = crypto.scryptSync(resolvedKey, "salt", 32);
      const decipher = crypto.createDecipheriv(
        this.encryptionAlgorithm,
        keyBuffer,
        iv,
      );

      let decrypted = decipher.update(encrypted, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return {
        success: true,
        message: "Message decrypted successfully",
        data: { content: decrypted },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Decryption error");
      return {
        success: false,
        message: "Failed to decrypt message. Invalid key or corrupted data.",
        error: "DECRYPTION_FAILED",
      };
    }
  }

  /**
   * Decrypt a message by its ID using the server-side stored encryption key.
   *
   * Validates that the requesting user is the sender or recipient before
   * allowing decryption.
   */
  async decryptMessageById(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return { success: false, message: "Message not found", error: "NOT_FOUND" };
      }

      // Only sender or recipient may decrypt
      if (message.senderId !== userId && message.recipientId !== userId) {
        return { success: false, message: "Permission denied", error: "PERMISSION_DENIED" };
      }

      if (!message.isEncrypted) {
        return {
          success: true,
          message: "Message is not encrypted",
          data: { content: message.content },
        };
      }

      if (!message.encryptionKey) {
        return {
          success: false,
          message: "No stored encryption key for this message",
          error: "NO_KEY",
        };
      }

      return await this.decryptMessage(
        message.content,
        message.encryptionKey,
        userId,
        messageId,
      );
    } catch (error: any) {
      this.logger.error({ err: error }, "Decrypt message by ID error");
      return {
        success: false,
        message: "Failed to decrypt message",
        error: error.message,
      };
    }
  }

  /**
   * Attempt to crack encrypted message (gameplay mechanic)
   */
  async crackEncryption(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      if (!message.isEncrypted) {
        return {
          success: false,
          message: "Message is not encrypted",
          error: "NOT_ENCRYPTED",
        };
      }

      const progress = await prisma.playerProgress.findUnique({
        where: { userId },
      });

      if (!progress) {
        return {
          success: false,
          message: "Player progress not found",
          error: "NO_PROGRESS",
        };
      }

      const cryptoSkill = progress.cryptography;
      const requiredSkill = (message.encryptionLevel || 5) * 10;

      // Success chance based on skill difference
      const skillDiff = cryptoSkill - requiredSkill;
      const baseChance = 50; // 50% at equal skill
      const successChance = Math.max(10, Math.min(90, baseChance + skillDiff));

      const roll = Math.random() * 100;
      const success = roll < successChance;

      if (success) {
        // Award XP for successful crack
        const xpGain = message.encryptionLevel! * 10;
        await prisma.playerProgress.update({
          where: { userId },
          data: {
            experience: { increment: xpGain },
            cryptography: { increment: Math.min(2, message.encryptionLevel!) },
          },
        });

        return {
          success: true,
          message: "Encryption cracked successfully!",
          data: {
            content: message.content, // In real implementation, decrypt here
            xpGained: xpGain,
            skillGained: Math.min(2, message.encryptionLevel!),
          },
        };
      } else {
        return {
          success: false,
          message: `Failed to crack encryption (${successChance.toFixed(0)}% chance)`,
          error: "CRACK_FAILED",
          data: {
            successChance,
            requiredSkill,
            yourSkill: cryptoSkill,
          },
        };
      }
    } catch (error: any) {
      this.logger.error({ err: error }, "Crack encryption error");
      return {
        success: false,
        message: "Failed to crack encryption",
        error: error.message,
      };
    }
  }

  // ==================== REAL-TIME DELIVERY ====================

  /**
   * Deliver message in real-time via Socket.IO
   */
  private async deliverMessageRealtime(
    messageId: string,
    recipientId: string,
  ): Promise<boolean> {
    try {
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!message) return false;

      // Emit to recipient's room
      this.io.to(`user:${recipientId}`).emit("message:received", {
        id: message.id,
        messageId: message.id,
        senderId: message.senderId,
        senderUsername: message.sender.username,
        recipientId: message.recipientId,
        recipientUsername: null, // Recipient already knows their own username
        subject: message.subject,
        content: message.isEncrypted ? "[ENCRYPTED]" : message.content,
        timestamp: message.timestamp,
        isEncrypted: message.isEncrypted,
        messageType: message.messageType,
        isRead: message.isRead,
        from: message.sender.username,
        preview: message.isEncrypted
          ? "[ENCRYPTED]"
          : message.content.substring(0, 50),
      });

      return true;
    } catch (error) {
      this.logger.error({ err: error }, "Real-time delivery error");
      return false;
    }
  }

  /**
   * Send read receipt to sender
   */
  private async sendReadReceipt(
    senderId: string,
    messageId: string,
  ): Promise<void> {
    try {
      this.io.to(`user:${senderId}`).emit("message:read_receipt", {
        messageId,
        readAt: new Date(),
      });
    } catch (error) {
      this.logger.error({ err: error }, "Read receipt error");
    }
  }

  /**
   * Queue message for later delivery
   */
  private queueMessage(
    recipientId: string,
    queuedMessage: QueuedMessage,
  ): void {
    const queue = this.deliveryQueue.get(recipientId) || [];
    queue.push(queuedMessage);
    this.deliveryQueue.set(recipientId, queue);
  }

  /**
   * Process delivery queue (runs periodically)
   */
  private startDeliveryProcessor(): void {
    this.deliveryProcessorInterval = setInterval(async () => {
      for (const [recipientId, queue] of this.deliveryQueue.entries()) {
        if (queue.length === 0) {
          // Clean up empty queue entries for offline users
          this.deliveryQueue.delete(recipientId);
          continue;
        }

        // Try to deliver all queued messages
        const delivered: string[] = [];
        for (const queuedMsg of queue) {
          const success = await this.deliverMessageRealtime(
            queuedMsg.messageId,
            recipientId,
          );
          if (success) {
            delivered.push(queuedMsg.messageId);
          }
        }

        // Remove delivered messages from queue; delete entry if fully delivered
        if (delivered.length > 0) {
          const remainingQueue = queue.filter(
            (msg) => !delivered.includes(msg.messageId),
          );
          if (remainingQueue.length === 0) {
            this.deliveryQueue.delete(recipientId);
          } else {
            this.deliveryQueue.set(recipientId, remainingQueue);
          }
        }
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Deliver all queued messages when user connects
   */
  async deliverQueuedMessages(userId: string): Promise<void> {
    const queue = this.deliveryQueue.get(userId);
    if (!queue || queue.length === 0) return;

    for (const queuedMsg of queue) {
      await this.deliverMessageRealtime(queuedMsg.messageId, userId);
    }

    this.deliveryQueue.delete(userId);
  }

  // ==================== HELPERS ====================

  /**
   * Format message data for client
   */
  private formatMessageData(message: any): MessageData {
    return {
      id: message.id,
      senderId: message.senderId,
      senderUsername: message.sender?.username,
      recipientId: message.recipientId,
      recipientUsername: message.recipient?.username,
      subject: message.subject,
      content: message.content,
      timestamp: message.timestamp,
      isRead: message.isRead,
      isEncrypted: message.isEncrypted,
      encryptionLevel: message.encryptionLevel,
      messageType: message.messageType as MessageType,
    };
  }

  /**
   * Get or create system user ID
   */
  private async getSystemUserId(): Promise<string> {
    const systemUser = await prisma.user.findFirst({
      where: { username: "SYSTEM" },
    });

    if (systemUser) {
      return systemUser.id;
    }

    // Create system user if doesn't exist
    const newSystemUser = await prisma.user.create({
      data: {
        username: "SYSTEM",
        email: "system@aida.internal",
        password: crypto.randomBytes(32).toString("hex"),
        homeIp: "0.0.0.0",
      },
    });

    return newSystemUser.id;
  }

  /**
   * Get or create AI user ID for a persona
   *
   * PHASE 5: Creates user accounts for AI personas to send messages
   */
  private async getAIUserId(personaId: string): Promise<string> {
    const aiUsername = `AI_${personaId.substring(0, 8)}`;

    const aiUser = await prisma.user.findFirst({
      where: { username: aiUsername },
    });

    if (aiUser) {
      return aiUser.id;
    }

    // Get persona info for better naming
    const persona = await prisma.aIPersona.findUnique({
      where: { id: personaId },
    });

    // Create AI user account
    const newAIUser = await prisma.user.create({
      data: {
        id: `ai_${personaId}`,
        username: persona?.name || aiUsername,
        email: `${personaId}@ai.aida.internal`,
        password: crypto.randomBytes(32).toString("hex"),
        homeIp: "127.0.0.1",
      },
    });

    return newAIUser.id;
  }

  /**
   * Log message activity for audit trail
   */
  private async logMessageActivity(
    userId: string,
    action: string,
    messageId: string,
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action: `message_${action}`,
          resource: "message",
          resourceId: messageId,
          metadata: {
            messageId,
            action,
          },
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Failed to log message activity");
    }
  }

  // ==================== STATS & NOTIFICATIONS ====================

  /**
   * Get unread message count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    try {
      return await prisma.message.count({
        where: {
          recipientId: userId,
          isRead: false,
        },
      });
    } catch (error) {
      this.logger.error({ err: error }, "Get unread count error");
      return 0;
    }
  }

  /**
   * Get message statistics for a user
   */
  async getMessageStats(userId: string): Promise<MessageOperationResult> {
    try {
      const [received, sent, unread] = await Promise.all([
        prisma.message.count({ where: { recipientId: userId } }),
        prisma.message.count({ where: { senderId: userId } }),
        prisma.message.count({ where: { recipientId: userId, isRead: false } }),
      ]);

      return {
        success: true,
        message: "Message stats retrieved",
        data: {
          received,
          sent,
          unread,
          total: received + sent,
        },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get message stats error");
      return {
        success: false,
        message: "Failed to retrieve message stats",
        error: error.message,
      };
    }
  }

  public stop(): void {
    if (this.deliveryProcessorInterval !== null) {
      clearInterval(this.deliveryProcessorInterval);
      this.deliveryProcessorInterval = null;
    }
  }
}

// ==================== SUPPORT TYPES ====================

interface QueuedMessage {
  messageId: string;
  timestamp: Date;
}

export default MessageService;
