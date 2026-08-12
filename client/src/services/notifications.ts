import { writable, derived, get } from "svelte/store";
import { socketService, liveMessages } from "./socket";
import { sound } from "./sound";

// ==================== TYPES ====================

export interface Notification {
  id: string;
  type: "message" | "chat" | "mail" | "forum" | "system" | "game";
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  priority: "low" | "normal" | "high" | "urgent";
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
  private maxNotifications = 50;
  private soundEnabled = true;
  private desktopEnabled = false;

  constructor() {
    this.requestDesktopPermission();
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

  public add(notification: Omit<Notification, "id" | "timestamp" | "read">): void {
    const newNotification: Notification = {
      ...notification,
      id: this.generateId(),
      timestamp: new Date(),
      read: false,
    };

    notifications.update((current) => {
      const updated = [newNotification, ...current];
      // Keep only last N notifications
      return updated.slice(0, this.maxNotifications);
    });

    // Play sound via sound service based on priority
    if (notification.priority === "urgent") {
      sound.alert();
    } else if (notification.priority === "high") {
      sound.notification();
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

  private playSound(): void {
    if (!this.soundEnabled) return;

    try {
      // Create a simple beep using Web Audio API
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Frequency in Hz
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.1
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      console.warn("Could not play notification sound:", error);
    }
  }

  private showDesktopNotification(notification: Notification): void {
    if (!this.desktopEnabled || !("Notification" in window)) return;

    try {
      const desktopNotif = new Notification(notification.title, {
        body: notification.message,
        icon: "/favicon.ico",
        tag: notification.id,
        requireInteraction: notification.priority === "urgent",
      });

      desktopNotif.onclick = () => {
        window.focus();
        if (notification.action) {
          notification.action.handler?.();
        }
        desktopNotif.close();
      };
    } catch (error) {
      console.warn("Could not show desktop notification:", error);
    }
  }

  // ==================== SETTINGS ====================

  public setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
  }

  public setDesktopEnabled(enabled: boolean): void {
    this.desktopEnabled = enabled;
    if (enabled) {
      this.requestDesktopPermission();
    }
  }

  public getSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public getDesktopEnabled(): boolean {
    return this.desktopEnabled;
  }
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
    case "urgent":
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
