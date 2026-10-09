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
import { LOGGER, SOCKET_IO, USER_REPOSITORY } from "../di/tokens";
import { generateAvatar, getCompactAvatar } from "../utils/asciiAvatars";
import type { AvatarInfo } from "../../../shared/types";

import type { MessageOperationResult, ChatContact } from "./messageService";
import { getService } from "../di/resolve";
import type { UserRepository } from "../repositories/userRepository";
import { notifyUser } from "../utils/notify";

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

  // ── Contacts: a MUTUAL relationship (maintainer decision Q5, 2026-10-08) ──
  //
  // Rows are directional (owner → contact). `contact add bob` writes
  // me→bob "pending" and notifies bob; `contact accept me` (by bob) turns it
  // "accepted" and writes bob→me "accepted"; `decline` deletes the request;
  // `remove` ends it from both sides. Before this there was no accept flow at
  // all: every contact read "(pending)" forever.

  private users() {
    return getService<UserRepository>(USER_REPOSITORY);
  }

  /**
   * The caller's contacts, split by state. Selects usernames only — the
   * command module once loaded whole User rows, password hash included.
   */
  async listContacts(userId: string): Promise<{ accepted: string[]; outgoing: string[]; incoming: string[] }> {
    const [mine, toMe] = await Promise.all([
      prisma.contact.findMany({ where: { userId }, select: { status: true, contact: { select: { username: true } } } }),
      prisma.contact.findMany({ where: { contactUserId: userId, status: "pending" }, select: { owner: { select: { username: true } } } }),
    ]);
    return {
      accepted: mine.filter((c) => c.status === "accepted").map((c) => c.contact.username),
      outgoing: mine.filter((c) => c.status === "pending").map((c) => c.contact.username),
      incoming: toMe.map((c) => c.owner.username),
    };
  }

  /**
   * Ask to add someone. If they already asked YOU, this accepts instead —
   * two people adding each other end up mutual, not two dangling requests.
   * A4 fixes kept: no self-add; a concurrent duplicate is "already sent",
   * not a P2002 thrown as "Command execution failed".
   */
  async addContact(userId: string, username: string): Promise<{ ok: boolean; message: string }> {
    const target = await this.users().findByUsername(username);
    if (!target) return { ok: false, message: "User not found" };
    if (target.id === userId) return { ok: false, message: "You can't add yourself as a contact." };

    const existing = await prisma.contact.findUnique({
      where: { userId_contactUserId: { userId, contactUserId: target.id } },
      select: { status: true },
    });
    if (existing?.status === "accepted") return { ok: false, message: `${target.username} is already a contact.` };
    if (existing) return { ok: false, message: `Request to ${target.username} already sent.` };

    const theirs = await prisma.contact.findUnique({
      where: { userId_contactUserId: { userId: target.id, contactUserId: userId } },
      select: { status: true },
    });
    if (theirs?.status === "pending") return this.acceptContact(userId, target.username);

    const me = await this.users().findById(userId);
    try {
      await prisma.contact.create({
        data: { userId, contactUserId: target.id, handle: target.username, status: "pending" },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") return { ok: false, message: `Request to ${target.username} already sent.` };
      throw err;
    }
    await notifyUser(this.io, target.id, {
      type: "contact_request",
      category: "social",
      title: "Contact request",
      message: `${me?.username ?? "Someone"} wants to add you as a contact. 'contact accept ${me?.username}' or 'contact decline ${me?.username}'.`,
    });
    return { ok: true, message: `Contact request sent to ${target.username}.` };
  }

  /** Accept `requesterName`'s pending request. Makes the contact mutual. */
  async acceptContact(userId: string, requesterName: string): Promise<{ ok: boolean; message: string }> {
    const requester = await this.users().findByUsername(requesterName);
    if (!requester) return { ok: false, message: "User not found" };
    const me = await this.users().findById(userId);
    const accepted = await prisma.$transaction(async (tx) => {
      // The transition is the authorization: only a PENDING request moves.
      const moved = await tx.contact.updateMany({
        where: { userId: requester.id, contactUserId: userId, status: "pending" },
        data: { status: "accepted" },
      });
      if (moved.count !== 1) return false;
      await tx.contact.upsert({
        where: { userId_contactUserId: { userId, contactUserId: requester.id } },
        update: { status: "accepted" },
        create: { userId, contactUserId: requester.id, handle: requester.username, status: "accepted" },
      });
      return true;
    });
    if (!accepted) return { ok: false, message: `No pending request from ${requester.username}.` };
    await notifyUser(this.io, requester.id, {
      type: "contact_accepted",
      category: "social",
      title: "Contact accepted",
      message: `${me?.username ?? "Someone"} accepted your contact request.`,
    });
    return { ok: true, message: `${requester.username} is now a contact.` };
  }

  /** Decline `requesterName`'s pending request (deletes it). */
  async declineContact(userId: string, requesterName: string): Promise<{ ok: boolean; message: string }> {
    const requester = await this.users().findByUsername(requesterName);
    if (!requester) return { ok: false, message: "User not found" };
    const gone = await prisma.contact.deleteMany({
      where: { userId: requester.id, contactUserId: userId, status: "pending" },
    });
    if (gone.count === 0) return { ok: false, message: `No pending request from ${requester.username}.` };
    return { ok: true, message: `Declined ${requester.username}'s request.` };
  }

  /**
   * End a contact from BOTH sides (it is mutual), or withdraw your own
   * pending request. Says so when there was nothing to remove.
   */
  async removeContact(userId: string, username: string): Promise<{ ok: boolean; message: string }> {
    const target = await this.users().findByUsername(username);
    if (!target) return { ok: false, message: "User not found" };
    const mine = await prisma.contact.deleteMany({ where: { userId, contactUserId: target.id } });
    if (mine.count === 0) return { ok: false, message: `${target.username} is not in your contacts.` };
    await prisma.contact.deleteMany({ where: { userId: target.id, contactUserId: userId, status: "accepted" } });
    return { ok: true, message: `Removed ${target.username} from contacts` };
  }

  /**
   * Get chat contacts for a user (from DB contacts + message history)
   */
  async getChatContacts(userId: string): Promise<MessageOperationResult> {
    try {
      // Get DB contacts
      // ACCEPTED contacts only: a request the other side never answered is
      // not a contact (Q5). Messaging anyone stays allowed regardless.
      const dbContacts = await prisma.contact.findMany({
        where: { userId, status: "accepted" },
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

      // `message:conversation_read` DELETED 2026-10-07. No listener anywhere,
      // and nothing to feed: ChatDialog assigns `isRead` (:132, :295) but never
      // renders it — zero references in its template — so there is no read
      // state in the chat UI for a live receipt to update.

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
