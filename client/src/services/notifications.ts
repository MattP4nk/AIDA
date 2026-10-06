import { writable, derived, get } from "svelte/store";
import { socketService, liveMessages } from "./socket";
import { sound } from "./sound";

// ==================== TYPES ====================

// A2 — NAME COLLISION, NOT A DUPLICATE. `shared/types/game.ts` also declares
// `Notification`, but its `NotificationType` is a SEVERITY taxonomy
// (info|success|warning|error|hack_alert|mission|message|system) while this
// one is a SOURCE taxonomy (message|chat|mail|forum|system|game) — only
// `message` and `system` overlap. The client also adds `action?`. Importing
// the shared type here would reject every chat/mail/forum/game notification.
// The two need reconciling in A3 as part of the socket contract, not by
// deleting one.
export interface Notification {
  id: string;
  type: "message" | "chat" | "mail" | "forum" | "system" | "game";
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  // R13: matches shared/types NotificationPriority (LOW|NORMAL|HIGH|CRITICAL).
  // The client used "urgent", which the server never sends — so every
  // server-emitted CRITICAL notification failed each priority comparison and
  // rendered as an ordinary one.
  priority: "low" | "normal" | "high" | "critical";
  data?: any;
  action?: {
    label: string;
    handler?: () => void; // client-side action
    command?: string; // command to fill in terminal input (server-sent)
  };
}

export interface UnreadCounts {
  messages: number;
  chat: number;
  mail: number;
  forum: number;
  total: number;
}

// ==================== STORES ====================

export const notifications = writable<Notification[]>([]);
export const unreadCounts = writable<UnreadCounts>({
  messages: 0,
  chat: 0,
  mail: 0,
  forum: 0,
  total: 0,
});

// Derived store for unread notifications
export const unreadNotifications = derived(
  notifications,
  ($notifications) => $notifications.filter((n) => !n.read)
);

// Derived store for notification count by type
export const notificationsByType = derived(notifications, ($notifications) => {
  return {
    message: $notifications.filter((n) => n.type === "message" && !n.read),
    chat: $notifications.filter((n) => n.type === "chat" && !n.read),
    mail: $notifications.filter((n) => n.type === "mail" && !n.read),
    forum: $notifications.filter((n) => n.type === "forum" && !n.read),
    system: $notifications.filter((n) => n.type === "system" && !n.read),
    game: $notifications.filter((n) => n.type === "game" && !n.read),
  };
});

// ==================== NOTIFICATION SERVICE ====================

class NotificationService {
  /**
   * R13: declared. `requestDesktopPermission` assigned `this.desktopEnabled`
   * on a field that did not exist, so the permission result was written to an
   * implicit property nothing ever read — desktop notifications could never be
   * gated on it.
   */
  private desktopEnabled = false;

  private maxNotifications = 50;

  constructor() {
    this.setupMessageListener();
  }

  // ==================== INITIALIZATION ====================

  private setupMessageListener(): void {
    // Subscribe to live messages from socket service
    liveMessages.subscribe((messages) => {
      if (messages.length > 0) {
        const latestMessage = messages[0];
        this.handleIncomingMessage(latestMessage);
      }
    });
  }

  private async requestDesktopPermission(): Promise<void> {
    if ("Notification" in window) {
      const permission = await Notification.requestPermission();
      this.desktopEnabled = permission === "granted";
    }
  }

  // ==================== MESSAGE HANDLERS ====================

  private handleIncomingMessage(message: any): void {
    const isChat = message.messageType === "chat" || message.isChat;
    const type = isChat ? "chat" : "mail";

    this.add({
      type,
      title: isChat ? "New Chat Message" : "New Mail",
      message: `From ${message.senderUsername || message.from}: ${message.subject || message.preview || "New message"}`,
      priority: "normal",
      data: message,
    });

    // Update unread counts
    this.updateUnreadCounts();
  }

  // ==================== PUBLIC API ====================

  /**
   * `opts` exists for notification REPLAY (server persistence, 2026-09-24).
   *
   * Without it, replay was actively worse than the dead feature it replaced:
   * `timestamp` was unconditionally stamped `new Date()`, so a three-hour-old
   * security alert displayed as if it had just fired, and every replayed
   * notification played its own sound — reconnecting with a backlog meant up
   * to 50 overlapping alert tones.
   */
  public add(
    notification: Omit<Notification, "id" | "timestamp" | "read">,
    opts?: { timestamp?: Date; silent?: boolean; id?: string },
  ): void {
    const newNotification: Notification = {
      ...notification,
      id: opts?.id ?? this.generateId(),
      timestamp: opts?.timestamp ?? new Date(),
      read: false,
    };

    notifications.update((current) => {
      // Replay can race a live emit of the same row; the server id makes
      // that detectable, so dedupe on it rather than showing both.
      if (current.some((n) => n.id === newNotification.id)) return current;
      const updated = [newNotification, ...current];
      // Keep only last N notifications
      return updated.slice(0, this.maxNotifications);
    });

    // Play sound via sound service based on priority
    if (!opts?.silent) {
      if (notification.priority === "critical") {
        sound.alert();
      } else if (notification.priority === "high") {
        sound.notification();
      }
    }

    // Update counts
    this.updateUnreadCounts();
  }

  public markAsRead(notificationId: string): void {
    notifications.update((current) =>
      current.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
    );
    this.updateUnreadCounts();
  }

  public markAllAsRead(type?: Notification["type"]): void {
    notifications.update((current) =>
      current.map((n) =>
        !type || n.type === type ? { ...n, read: true } : n
      )
    );
    this.updateUnreadCounts();
  }

  public remove(notificationId: string): void {
    notifications.update((current) =>
      current.filter((n) => n.id !== notificationId)
    );
    this.updateUnreadCounts();
  }

  public clearAll(type?: Notification["type"]): void {
    if (type) {
      notifications.update((current) =>
        current.filter((n) => n.type !== type)
      );
    } else {
      notifications.set([]);
    }
    this.updateUnreadCounts();
  }

  // ==================== UNREAD COUNTS ====================

  private updateUnreadCounts(): void {
    const current = get(notifications);
    const counts: UnreadCounts = {
      messages: current.filter(
        (n) => !n.read && (n.type === "message" || n.type === "chat" || n.type === "mail")
      ).length,
      chat: current.filter((n) => !n.read && n.type === "chat").length,
      mail: current.filter((n) => !n.read && n.type === "mail").length,
      forum: current.filter((n) => !n.read && n.type === "forum").length,
      total: current.filter((n) => !n.read).length,
    };
    unreadCounts.set(counts);
  }

  // ==================== SPECIFIC NOTIFICATION TYPES ====================

  public notifyMessage(
    from: string,
    subject: string,
    preview: string,
    data?: any
  ): void {
    this.add({
      type: "message",
      title: `Message from ${from}`,
      message: `${subject}: ${preview}`,
      priority: "normal",
      data,
    });
  }

  public notifyChat(from: string, message: string, data?: any): void {
    this.add({
      type: "chat",
      title: `Chat from ${from}`,
      message,
      priority: "normal",
      data,
    });
  }

  public notifyMail(from: string, subject: string, data?: any): void {
    this.add({
      type: "mail",
      title: "New Mail",
      message: `From ${from}: ${subject}`,
      priority: "normal",
      data,
    });
  }

  public notifyForum(title: string, message: string, data?: any): void {
    this.add({
      type: "forum",
      title,
      message,
      priority: "low",
      data,
    });
  }

  public notifySystem(title: string, message: string, priority: Notification["priority"] = "normal"): void {
    this.add({
      type: "system",
      title,
      message,
      priority,
    });
  }

  public notifyGame(title: string, message: string, priority: Notification["priority"] = "low"): void {
    this.add({
      type: "game",
      title,
      message,
      priority,
    });
  }

  // ==================== UTILITIES ====================

  private generateId(): string {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Desktop notifications and legacy playSound removed —
  // in-terminal toasts (TerminalToast.svelte) and sound service handle all notifications

}

// ==================== SINGLETON EXPORT ====================

export const notificationService = new NotificationService();

// ==================== HELPER FUNCTIONS ====================

export function getNotificationIcon(type: Notification["type"]): string {
  switch (type) {
    case "message":
    case "chat":
      return "💬";
    case "mail":
      return "📧";
    case "forum":
      return "📋";
    case "system":
      return "⚙️";
    case "game":
      return "🎮";
    default:
      return "🔔";
  }
}

export function getNotificationColor(priority: Notification["priority"]): string {
  switch (priority) {
    case "critical":
      return "#ff0000";
    case "high":
      return "#ff6600";
    case "normal":
      return "#00bcd4";
    case "low":
      return "#008800";
    default:
      return "#00bcd4";
  }
}

export function formatNotificationTime(timestamp: Date): string {
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
