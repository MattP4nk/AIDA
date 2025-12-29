// Messaging System Utility
// Simple stub for MessageDialog compatibility

import { writable, get } from "svelte/store";

// ==================== TYPES ====================

export interface Message {
  id: string;
  senderId: string;
  senderUsername: string;
  recipientId: string;
  recipientUsername: string;
  subject: string;
  content: string;
  timestamp: Date;
  isRead: boolean;
  isEncrypted?: boolean;
  encryptionLevel?: number;
  messageType?: string;
}

export interface Thread {
  threadId: string;
  contactId: string;
  contactUsername: string;
  lastMessage: string;
  lastMessageTime: Date;
  unreadCount: number;
  messages: Message[];
}

export interface Contact {
  id: string;
  username: string;
  handle?: string;
  isOnline: boolean;
  lastSeen?: Date;
}

// ==================== STORES ====================

export const messages = writable<Message[]>([]);
export const threads = writable<Thread[]>([]);
export const contacts = writable<Contact[]>([]);

// ==================== MESSAGING SYSTEM ====================

class MessagingSystem {
  // Get all threads
  getThreads(): Thread[] {
    return get(threads);
  }

  // Get thread by ID
  getThread(threadId: string): Thread | undefined {
    const allThreads = get(threads);
    return allThreads.find((t) => t.threadId === threadId);
  }

  // Get messages for a thread
  getThreadMessages(threadId: string): Message[] {
    const thread = this.getThread(threadId);
    return thread?.messages || [];
  }

  // Add message to thread
  addMessage(threadId: string, message: Message): void {
    threads.update((current) => {
      const thread = current.find((t) => t.threadId === threadId);
      if (thread) {
        thread.messages.push(message);
        thread.lastMessage = message.content;
        thread.lastMessageTime = message.timestamp;
        if (!message.isRead) {
          thread.unreadCount++;
        }
      }
      return current;
    });

    messages.update((current) => [...current, message]);
  }

  // Create new thread
  createThread(contactId: string, contactUsername: string): Thread {
    const newThread: Thread = {
      threadId: `thread_${contactId}_${Date.now()}`,
      contactId,
      contactUsername,
      lastMessage: "",
      lastMessageTime: new Date(),
      unreadCount: 0,
      messages: [],
    };

    threads.update((current) => [...current, newThread]);
    return newThread;
  }

  // Mark thread as read
  markThreadAsRead(threadId: string): void {
    threads.update((current) => {
      const thread = current.find((t) => t.threadId === threadId);
      if (thread) {
        thread.unreadCount = 0;
        thread.messages.forEach((msg) => {
          msg.isRead = true;
        });
      }
      return current;
    });
  }

  // Get or create thread for contact
  getOrCreateThread(contactId: string, contactUsername: string): Thread {
    const allThreads = get(threads);
    let thread = allThreads.find((t) => t.contactId === contactId);

    if (!thread) {
      thread = this.createThread(contactId, contactUsername);
    }

    return thread;
  }

  // Delete thread
  deleteThread(threadId: string): void {
    threads.update((current) => current.filter((t) => t.threadId !== threadId));
  }

  // Get total unread count
  getTotalUnreadCount(): number {
    const allThreads = get(threads);
    return allThreads.reduce((sum, thread) => sum + thread.unreadCount, 0);
  }

  // Update threads from server data
  updateThreadsFromMessages(serverMessages: any[]): void {
    const threadMap = new Map<string, Thread>();

    serverMessages.forEach((msg) => {
      const contactId = msg.senderId === msg.currentUserId ? msg.recipientId : msg.senderId;
      const contactUsername = msg.senderId === msg.currentUserId
        ? msg.recipientUsername
        : msg.senderUsername;

      if (!threadMap.has(contactId)) {
        threadMap.set(contactId, {
          threadId: `thread_${contactId}`,
          contactId,
          contactUsername,
          lastMessage: msg.content || msg.subject,
          lastMessageTime: new Date(msg.timestamp),
          unreadCount: msg.isRead ? 0 : 1,
          messages: [],
        });
      }

      const thread = threadMap.get(contactId)!;
      thread.messages.push({
        id: msg.id,
        senderId: msg.senderId,
        senderUsername: msg.senderUsername,
        recipientId: msg.recipientId,
        recipientUsername: msg.recipientUsername,
        subject: msg.subject || "",
        content: msg.content || "",
        timestamp: new Date(msg.timestamp),
        isRead: msg.isRead || false,
        isEncrypted: msg.isEncrypted,
        encryptionLevel: msg.encryptionLevel,
        messageType: msg.messageType,
      });
    });

    threads.set(Array.from(threadMap.values()));
  }

  // Clear all data
  clear(): void {
    messages.set([]);
    threads.set([]);
    contacts.set([]);
  }
}

// ==================== SINGLETON EXPORT ====================

export const messagingSystem = new MessagingSystem();

// ==================== HELPER FUNCTIONS ====================

export function formatMessageTime(timestamp: Date): string {
  const now = new Date();
  const diff = now.getTime() - timestamp.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return timestamp.toLocaleDateString();
}

export function getMessagePreview(content: string, maxLength: number = 50): string {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + "...";
}

export function sortThreadsByTime(threads: Thread[]): Thread[] {
  return [...threads].sort((a, b) =>
    b.lastMessageTime.getTime() - a.lastMessageTime.getTime()
  );
}
