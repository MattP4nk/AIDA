/**
 * ChatService - Chat History & Contacts
 *
 * Extracted from MessageService. Handles:
 * - Chat history retrieval between two users
 * - Chat contact list with online status
 * - Marking conversations as read
 * - Unread chat counts
 *
 * Phase 2, Day 8 (split)
 */

import { prisma } from "../database/client";
import { Server as SocketIOServer } from "socket.io";
import { Logger } from "pino";
import { injectable, inject } from "tsyringe";
import { LOGGER, SOCKET_IO } from "../di/tokens";
import { generateAvatar, getCompactAvatar } from "../utils/asciiAvatars";
import type { AvatarInfo } from "../../../shared/types";

import type { MessageOperationResult, ChatContact } from "./messageService";

// ==================== CHAT SERVICE CLASS ====================

@injectable()
export class ChatService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
  ) {}

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

  // ==================== CHAT HISTORY ====================

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

  // ==================== CHAT CONTACTS ====================

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

  // ==================== MARK CONVERSATION READ ====================

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

  // ==================== UNREAD COUNTS ====================

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
}

export default ChatService;
