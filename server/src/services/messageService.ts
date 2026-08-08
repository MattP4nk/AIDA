/**
 * MessageService - Real-Time Messaging System
 *
 * Handles all messaging operations including:
 * - Private messages between players
 * - Real-time delivery via Socket.IO
 * - Read receipts and message status
 * - Message history and inbox management
 * - Token-gated AI persona messaging
 *
 * Encryption operations are delegated to MessageEncryptionService.
 * Chat history/contacts are handled by ChatService.
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
  MESSAGE_ENCRYPTION_SERVICE,
} from "../di/tokens";
import { safeExecute } from "../utils/safeExecute";
import type { MessageEncryptionService } from "./messageEncryptionService";
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
    @inject(MESSAGE_ENCRYPTION_SERVICE)
    private encryptionService?: MessageEncryptionService,
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

        if (encryptionLevel > 0 && this.encryptionService) {
          const encryptionResult = await this.encryptionService.encryptMessage(
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
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "deliverMessageRealtime" }, `[deliverMessageRealtime] ${err.message}`);
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
    await safeExecute({
      fn: async () => {
        this.io.to(`user:${senderId}`).emit("message:read_receipt", {
          messageId,
          readAt: new Date(),
        });
      },
      context: "Send read receipt",
      logger: this.logger,
      silent: true,
    })();
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
    const aiId = `ai_${personaId}`;

    // Check by ID first (fastest)
    const byId = await prisma.user.findUnique({ where: { id: aiId }, select: { id: true } });
    if (byId) return byId.id;

    // Check by persona name (seed may have created with different ID)
    const persona = await prisma.aIPersona.findUnique({
      where: { id: personaId },
      select: { name: true },
    });

    if (persona?.name) {
      const byName = await prisma.user.findFirst({
        where: { username: persona.name, email: { endsWith: "@ai.aida.internal" } },
        select: { id: true },
      });
      if (byName) return byName.id;
    }

    // Create AI user account via upsert to prevent race conditions
    const aiUsername = persona?.name || `AI_${personaId.substring(0, 8)}`;
    const newAIUser = await prisma.user.upsert({
      where: { id: aiId },
      update: {},
      create: {
        id: aiId,
        username: aiUsername,
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
    await safeExecute({
      fn: () => prisma.auditLog.create({
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
      }),
      context: "Log message activity",
      logger: this.logger,
      silent: true,
    })();
  }

  // ==================== STATS & NOTIFICATIONS ====================

  /**
   * Get unread message count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return (await safeExecute({
      fn: () => prisma.message.count({
        where: {
          recipientId: userId,
          isRead: false,
        },
      }),
      context: "Get unread count",
      logger: this.logger,
      fallback: 0,
    })()) ?? 0;
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

  /**
   * Request decryption of a message (delegates to MessageEncryptionService)
   */
  async requestDecryption(
    messageId: string,
    userId: string,
  ): Promise<MessageOperationResult> {
    if (!this.encryptionService) {
      return {
        success: false,
        message: "Encryption service not available",
        error: "SERVICE_UNAVAILABLE",
      };
    }
    return this.encryptionService.decryptMessageById(messageId, userId);
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

    // 4. Generate response via AI (with fallback + retry)
    const { fallbackPersonaReply } = await import("../utils/aiFallbacks");
    const { safeExecute } = await import("../utils/safeExecute");

    const personaRecord = await prisma.aIPersona.findUnique({
      where: { id: persona.id },
      include: { faction: { select: { shortName: true } } },
    });
    const factionShortName = (personaRecord as any)?.faction?.shortName || null;
    const personaId = persona.id;
    const replySubjectForRetry = originalSubject.startsWith("Re: ")
      ? originalSubject
      : `Re: ${originalSubject}`;

    // Plain text response (not JSON) — use safeExecute with generateOrThrow directly
    const fallbackReply = fallbackPersonaReply(persona.name, factionShortName);
    let usedFallback = false;

    const replyContent = await safeExecute({
      fn: async () => {
        const result = await aiService.generateOrThrow(prompt, persona.systemPrompt);
        return result.response;
      },
      context: "AI persona reply to player message",
      logger: this.logger,
      silent: true,
      fallback: fallbackReply,
      onError: () => { usedFallback = true; },
    })();

    // Queue retry if AI failed — when it recovers, send the real reply as a follow-up
    if (usedFallback) {
      aiService.queueForRetry(prompt, persona.systemPrompt, async (response) => {
        if (response && response.trim().length > 0) {
          await this.sendAIMessage(personaId, playerId, replySubjectForRetry, response).catch(() => {});
        }
      });
    }

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
