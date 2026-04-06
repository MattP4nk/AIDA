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
import {
  LOGGER,
  SOCKET_IO,
  MISSION_INTEGRATION_SERVICE,
  AI_SERVICE,
} from "../di/tokens";
import type MissionIntegrationService from "./missionIntegration";
import type { AIService } from "./aiService";
import {
  findPersonaToken,
  type PersonaTokenInfo,
} from "../utils/tokenConsumption";
import { generateAvatar, getCompactAvatar } from "../utils/asciiAvatars";
import type { AvatarInfo } from "../../../shared/types";

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

export interface ChatContact {
  userId: string;
  username: string;
  isOnline: boolean;
  unreadCount: number;
  lastMessage: string;
  lastMessageTime: Date;
  isContact: boolean;
  factionId: string | null;
  avatar: AvatarInfo;
}

// ==================== MESSAGE SERVICE CLASS ====================

@injectable()
export class MessageService {
  private encryptionAlgorithm = "aes-256-cbc";
  private deliveryQueue: Map<string, QueuedMessage[]> = new Map();
  private deliveryProcessorInterval: NodeJS.Timeout | null = null;
  private missionIntegration: MissionIntegrationService | null = null;

  // Post-send hooks — called after a private message is successfully sent
  private messageSentCallbacks: Array<
    (
      senderId: string,
      recipientId: string,
      content: string,
      subject?: string,
    ) => void
  > = [];

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
    @inject(MISSION_INTEGRATION_SERVICE)
    missionIntegrationService?: MissionIntegrationService,
  ) {
    this.missionIntegration = missionIntegrationService || null;
    this.startDeliveryProcessor();
  }

  // ==================== AVATAR HELPER ====================

  private generateAvatarInfo(
    username: string,
    type: "player" | "npc" | "system" | "ai" = "player",
    factionId?: string,
  ): AvatarInfo {
    const avatar = generateAvatar(username, type, factionId);
    return {
      glyph: avatar.glyph,
      color: avatar.color,
      compact: getCompactAvatar(avatar),
    };
  }

  /**
   * Register a callback to be invoked after any private message is sent.
   * Used by TutorialService to intercept messages to The Architect.
   */
  onPrivateMessageSent(
    callback: (
      senderId: string,
      recipientId: string,
      content: string,
      subject?: string,
    ) => void,
  ): void {
    this.messageSentCallbacks.push(callback);
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
        const censorshipService =
          getService<import("./censorshipService").default>(
            "CensorshipService",
          );
        filteredContent = await censorshipService.filterAndAlert(
          options.content,
          { userId: senderId },
        );
      } catch {
        /* Censorship service not available — pass through */
      }

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

      // Emit new_mail event for messages with subjects (mail, not chat)
      if (options.subject && options.subject !== "") {
        this.io.to(`user:${recipientId}`).emit("message:new_mail", {
          id: message.id,
          senderId,
          senderUsername: sender.username,
          subject: options.subject,
          timestamp: message.timestamp,
          isEncrypted,
          messageType: options.messageType || "private",
          avatar: this.generateAvatarInfo(sender.username, "player"),
        });
      }

      // Track for mission objectives
      if (this.missionIntegration) {
        await this.missionIntegration.onMessageSent(
          senderId,
          recipientId,
          message.id,
        );
      }

      // Fire post-send hooks (e.g., tutorial system listens for messages to AI personas)
      for (const cb of this.messageSentCallbacks) {
        try {
          cb(senderId, recipientId, finalContent, options.subject);
        } catch {
          // Hook errors should not break message sending
        }
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
          return {
            success: false,
            message: "Message not found",
            error: "NOT_FOUND",
          };
        }
        // Only sender or recipient may use the stored key
        if (dbMessage.senderId !== userId && dbMessage.recipientId !== userId) {
          return {
            success: false,
            message: "Permission denied",
            error: "PERMISSION_DENIED",
          };
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
        return {
          success: false,
          message: "Message not found",
          error: "NOT_FOUND",
        };
      }

      // Only sender or recipient may decrypt
      if (message.senderId !== userId && message.recipientId !== userId) {
        return {
          success: false,
          message: "Permission denied",
          error: "PERMISSION_DENIED",
        };
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

        // Actually decrypt the content using the stored encryption key
        const decryptResult = await this.decryptMessage(
          message.content,
          message.encryptionKey!,
          userId,
          messageId,
        );

        const decryptedContent =
          decryptResult.success && decryptResult.data
            ? decryptResult.data.content
            : message.content; // Fallback to ciphertext if decryption fails unexpectedly

        return {
          success: true,
          message: "Encryption cracked successfully!",
          data: {
            content: decryptedContent,
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
              factionMembers: { select: { factionId: true }, take: 1 },
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
        avatar: this.generateAvatarInfo(
          message.sender.username,
          "player",
          message.sender.factionMembers?.[0]?.factionId ?? undefined,
        ),
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

  // ==================== CHAT METHODS ====================

  /**
   * Get chat history between two users
   */
  async getChatHistory(
    userId: string,
    contactId: string,
    limit: number = 100,
  ): Promise<MessageOperationResult> {
    try {
      const messages = await prisma.message.findMany({
        where: {
          OR: [
            { senderId: userId, recipientId: contactId },
            { senderId: contactId, recipientId: userId },
          ],
          subject: "",
        },
        include: {
          sender: { select: { id: true, username: true } },
          recipient: { select: { id: true, username: true } },
        },
        orderBy: { timestamp: "desc" },
        take: limit,
      });

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        senderId: msg.senderId,
        senderUsername: msg.sender?.username ?? "Unknown",
        recipientId: msg.recipientId,
        recipientUsername: msg.recipient?.username ?? "Unknown",
        content: msg.isEncrypted ? "[ENCRYPTED]" : msg.content,
        timestamp: msg.timestamp,
        isRead: msg.isRead,
        isEncrypted: msg.isEncrypted,
        avatar: this.generateAvatarInfo(msg.sender?.username ?? "Unknown"),
      }));

      return {
        success: true,
        message: `Retrieved ${formattedMessages.length} messages`,
        data: { messages: formattedMessages },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get chat history error");
      return {
        success: false,
        message: "Failed to load chat history",
        error: error.message,
      };
    }
  }

  /**
   * Get chat contacts for a user (from DB contacts + message history)
   */
  async getChatContacts(userId: string): Promise<MessageOperationResult> {
    try {
      // Get DB contacts
      const dbContacts = await prisma.contact.findMany({
        where: { userId },
        include: {
          contact: {
            select: {
              id: true,
              username: true,
              factionMembers: { select: { factionId: true }, take: 1 },
            },
          },
        },
      });

      // Get all chat messages to find additional contacts from message history
      const chatMessages = await prisma.message.findMany({
        where: {
          OR: [{ senderId: userId }, { recipientId: userId }],
          subject: "",
        },
        include: {
          sender: {
            select: {
              id: true,
              username: true,
              factionMembers: { select: { factionId: true }, take: 1 },
            },
          },
          recipient: {
            select: {
              id: true,
              username: true,
              factionMembers: { select: { factionId: true }, take: 1 },
            },
          },
        },
        orderBy: { timestamp: "desc" },
      });

      const contactMap = new Map<string, ChatContact>();

      // Add DB contacts
      for (const dbContact of dbContacts) {
        if (dbContact.contact && !contactMap.has(dbContact.contactUserId)) {
          const factionId =
            dbContact.contact.factionMembers?.[0]?.factionId ?? null;
          contactMap.set(dbContact.contactUserId, {
            userId: dbContact.contactUserId,
            username: dbContact.contact.username,
            isOnline: false,
            unreadCount: 0,
            lastMessage: "",
            lastMessageTime: new Date(0),
            isContact: true,
            factionId,
            avatar: this.generateAvatarInfo(
              dbContact.contact.username,
              "player",
              factionId ?? undefined,
            ),
          });
        }
      }

      // Add contacts from message history
      for (const msg of chatMessages) {
        const otherId =
          msg.senderId === userId ? msg.recipientId : msg.senderId;
        const other = msg.senderId === userId ? msg.recipient : msg.sender;
        if (other && !contactMap.has(otherId)) {
          const factionId = other.factionMembers?.[0]?.factionId ?? null;
          contactMap.set(otherId, {
            userId: otherId,
            username: other.username,
            isOnline: false,
            unreadCount: 0,
            lastMessage: "",
            lastMessageTime: new Date(0),
            isContact: false,
            factionId,
            avatar: this.generateAvatarInfo(
              other.username,
              "player",
              factionId ?? undefined,
            ),
          });
        }

        // Update last message preview
        const contact = contactMap.get(otherId);
        if (contact && msg.timestamp > contact.lastMessageTime) {
          contact.lastMessage = msg.isEncrypted
            ? "[ENCRYPTED]"
            : msg.content.substring(0, 50);
          contact.lastMessageTime = msg.timestamp;
        }
      }

      // Get unread counts in a single query
      const unreadCounts = await prisma.message.groupBy({
        by: ["senderId"],
        where: {
          recipientId: userId,
          isRead: false,
          subject: "",
        },
        _count: { id: true },
      });

      for (const uc of unreadCounts) {
        const contact = contactMap.get(uc.senderId);
        if (contact) {
          contact.unreadCount = uc._count.id;
        }
      }

      // Check online status via Socket.IO rooms
      const contacts = Array.from(contactMap.values());
      for (const contact of contacts) {
        const sockets = await this.io
          .in(`user:${contact.userId}`)
          .fetchSockets();
        contact.isOnline = sockets.length > 0;
      }

      // Sort by last message time (most recent first)
      contacts.sort(
        (a, b) => b.lastMessageTime.getTime() - a.lastMessageTime.getTime(),
      );

      return {
        success: true,
        message: `Found ${contacts.length} contacts`,
        data: { contacts },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get chat contacts error");
      return {
        success: false,
        message: "Failed to load contacts",
        error: error.message,
      };
    }
  }

  /**
   * Mark all messages in a conversation as read
   */
  async markConversationRead(
    userId: string,
    senderId: string,
  ): Promise<MessageOperationResult> {
    try {
      const result = await prisma.message.updateMany({
        where: {
          recipientId: userId,
          senderId: senderId,
          isRead: false,
          subject: "",
        },
        data: { isRead: true },
      });

      // Send read receipts for each marked message
      if (result.count > 0) {
        this.io.to(`user:${senderId}`).emit("message:conversation_read", {
          readBy: userId,
          count: result.count,
        });
      }

      return {
        success: true,
        message: `Marked ${result.count} messages as read`,
        data: { count: result.count },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Mark conversation read error");
      return {
        success: false,
        message: "Failed to mark messages as read",
        error: error.message,
      };
    }
  }

  /**
   * Get unread chat message counts grouped by sender
   */
  async getUnreadChatCounts(userId: string): Promise<MessageOperationResult> {
    try {
      const counts = await prisma.message.groupBy({
        by: ["senderId"],
        where: {
          recipientId: userId,
          isRead: false,
          subject: "",
        },
        _count: { id: true },
      });

      const countMap: Record<string, number> = {};
      for (const c of counts) {
        countMap[c.senderId] = c._count.id;
      }

      return {
        success: true,
        message: "Unread counts retrieved",
        data: { counts: countMap },
      };
    } catch (error: any) {
      this.logger.error({ err: error }, "Get unread chat counts error");
      return {
        success: false,
        message: "Failed to get unread counts",
        error: error.message,
      };
    }
  }

  /**
   * Request decryption of a message (wrapper around decryptMessageById)
   */
  async requestDecryption(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    // This delegates to decryptMessageById which checks sender/recipient authorization
    return this.decryptMessageById(messageId, userId);
  }

  // ==================== TOKEN-GATED AI PERSONA MESSAGING ====================

  /**
   * Send a token-gated message to an AI persona.
   * Consumes one communication token from the player's inventory.
   * The persona will respond asynchronously via AI.
   */
  async sendTokenMessage(
    senderId: string,
    personaName: string,
    subject: string,
    content: string,
  ): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      // 1. Look up the AI persona by name
      const persona = await prisma.aIPersona.findUnique({
        where: { name: personaName },
      });

      if (!persona) {
        return {
          success: false,
          error: `AI persona "${personaName}" not found.`,
        };
      }

      // 2. Check for a matching communication token (pre-flight)
      const token = await findPersonaToken(prisma, senderId, personaName);

      if (!token) {
        return {
          success: false,
          error:
            `You need a communication token to contact ${personaName}. ` +
            `These can be found on certain servers or earned through missions.`,
        };
      }

      // 3. Resolve the persona's User account (idempotent — safe outside txn)
      const aiUserId = await this.getAIUserId(persona.id);

      // 4. Resolve sender username for prompt building
      const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { username: true },
      });

      if (!sender) {
        return { success: false, error: "Sender not found." };
      }

      // 5. Atomic transaction: consume token + create message + record PersonaMessage
      const { message: outboundMessage } = await prisma.$transaction(
        async (tx) => {
          // Re-verify the token inside the transaction (race-condition guard)
          const invItem = await tx.inventoryItem.findUnique({
            where: { id: token.inventoryItemId },
          });

          if (!invItem || invItem.quantity <= 0) {
            throw new Error(
              "Your communication token is no longer available. It may have been used already.",
            );
          }

          // Consume the token
          if (invItem.quantity === 1) {
            await tx.inventoryItem.delete({
              where: { id: token.inventoryItemId },
            });
          } else {
            await tx.inventoryItem.update({
              where: { id: token.inventoryItemId },
              data: {
                quantity: { decrement: 1 },
                lastUsedAt: new Date(),
              },
            });
          }

          // Create the outbound message (player → persona)
          const message = await tx.message.create({
            data: {
              senderId,
              recipientId: aiUserId,
              subject,
              content,
              isRead: false,
              isEncrypted: false,
              messageType: "private",
            },
          });

          // Record in PersonaMessage table
          await tx.personaMessage.create({
            data: {
              userId: senderId,
              personaId: persona.id,
              tokenItemId: token.inventoryItemId,
              direction: "outbound",
              subject,
              content,
              messageId: message.id,
            },
          });

          return { message };
        },
      );

      // 6. Deliver outbound message in real-time
      await this.deliverMessageRealtime(outboundMessage.id, aiUserId);

      // 6b. Record token_used event to StoryLedger
      try {
        const { getService } = await import("../di/container");
        const { STORY_PROGRESSION_SERVICE } = await import("../di/tokens");
        const storyProgression = getService<
          import("./storyProgressionService").StoryProgressionService
        >(STORY_PROGRESSION_SERVICE);
        await storyProgression.recordEvent({
          type: "token_used",
          category: "communication",
          actorId: senderId,
          actorType: "player",
          summary: `Player used ${token.shopItemName} to contact ${persona.name}`,
          data: {
            tokenName: token.shopItemName,
            personaName: persona.name,
            personaId: persona.id,
          },
          impact: { discoveryWeight: 2 },
          weight: 5,
        });
      } catch (err) {
        // Non-critical — don't fail the message send
        this.logger.warn({ err }, "Failed to record token_used event");
      }

      // 7. Fire asynchronous AI response generation
      this.generatePersonaReply(
        senderId,
        sender.username,
        persona,
        subject,
        content,
        token,
      ).catch((err) => {
        this.logger.error(
          { err, personaId: persona.id, senderId },
          "Failed to generate AI persona reply",
        );
      });

      return { success: true, messageId: outboundMessage.id };
    } catch (error: any) {
      this.logger.error({ err: error }, "sendTokenMessage error");
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate an AI persona reply and deliver it to the player.
   * Called asynchronously after a token-gated message is sent.
   */
  private async generatePersonaReply(
    playerId: string,
    playerUsername: string,
    persona: { id: string; name: string; systemPrompt: string },
    originalSubject: string,
    originalContent: string,
    token: PersonaTokenInfo,
  ): Promise<void> {
    // 1. Resolve AI service lazily (avoids circular DI)
    let aiService: AIService;
    try {
      const { getService } = await import("../di/container");
      aiService = getService<AIService>(AI_SERVICE);
    } catch {
      this.logger.warn("AIService not available — skipping persona reply");
      return;
    }

    // 2. Fetch recent conversation history from PersonaMessage
    const history = await prisma.personaMessage.findMany({
      where: {
        userId: playerId,
        personaId: persona.id,
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Build conversation context (oldest-first)
    const conversationLines = history
      .reverse()
      .map((pm) => {
        const role =
          pm.direction === "outbound" ? playerUsername : persona.name;
        return `[${role}]: ${pm.content}`;
      })
      .join("\n");

    // 3. Build prompt
    const prompt =
      `A player named ${playerUsername} has used a ${token.shopItemName} to contact you.\n` +
      (conversationLines
        ? `Recent conversation:\n${conversationLines}\n\n`
        : "") +
      `Their latest message (subject: "${originalSubject}"):\n${originalContent}\n\n` +
      `Respond in character. Keep your reply concise (1-3 paragraphs).`;

    // 4. Generate response via AI
    const { response: replyContent } = await aiService.generateResponse(
      prompt,
      persona.systemPrompt,
    );

    // 5. Send the reply as an AI message (persona → player)
    const replySubject = originalSubject.startsWith("Re: ")
      ? originalSubject
      : `Re: ${originalSubject}`;

    const sendResult = await this.sendAIMessage(
      persona.id,
      playerId,
      replySubject,
      replyContent,
    );

    // 6. Record the inbound PersonaMessage
    if (sendResult.success && sendResult.data?.messageId) {
      await prisma.personaMessage.create({
        data: {
          userId: playerId,
          personaId: persona.id,
          tokenItemId: token.inventoryItemId,
          direction: "inbound",
          subject: replySubject,
          content: replyContent,
          messageId: sendResult.data.messageId,
        },
      });
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
