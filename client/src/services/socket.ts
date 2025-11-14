import { io, Socket } from "socket.io-client";
import { writable, type Writable } from "svelte/store";
import { apiClient } from "./api";
import type { SocketEvent, SocketEventType } from "../../../shared/types";

// Socket connection configuration
const SOCKET_URL = "http://localhost:3001";

// Connection state stores
export const socketConnected = writable(false);
export const socketError = writable<string | null>(null);

// Real-time data stores
export const onlineUsers = writable<string[]>([]);
export const serverActivity = writable<any[]>([]);
export const liveMessages = writable<any[]>([]);
export const hackAttempts = writable<any[]>([]);
const gameEvents = writable<any[]>([]);

class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second

  constructor() {
    this.connect();
  }

  // ==================== CONNECTION MANAGEMENT ====================

  public connect(): void {
    if (this.socket?.connected) {
      return;
    }

    const token = apiClient.getToken();
    if (!token) {
      console.warn("No auth token available for WebSocket connection");
      return;
    }

    this.socket = io(SOCKET_URL, {
      auth: { token },
      transports: ["websocket", "polling"],
      timeout: 10000,
      forceNew: true,
    });

    this.setupEventHandlers();
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      socketConnected.set(false);
    }
  }

  public reconnect(): void {
    this.disconnect();
    setTimeout(() => {
      this.connect();
    }, 100);
  }

  // ==================== EVENT HANDLERS ====================

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Connection events
    this.socket.on("connect", () => {
      console.log("🔌 WebSocket connected");
      socketConnected.set(true);
      socketError.set(null);
      this.reconnectAttempts = 0;

      // Authenticate the socket connection
      this.socket?.emit("authenticated");
    });

    this.socket.on("disconnect", (reason) => {
      console.log("🔌 WebSocket disconnected:", reason);
      socketConnected.set(false);

      if (reason === "io server disconnect") {
        // Server disconnected us, don't auto-reconnect
        return;
      }

      this.handleReconnect();
    });

    this.socket.on("connect_error", (error) => {
      console.error("🔌 WebSocket connection error:", error);
      socketError.set(error.message);
      this.handleReconnect();
    });

    // Authentication events
    this.socket.on("authenticated", () => {
      console.log("🔐 WebSocket authenticated successfully");
    });

    // ==================== USER PRESENCE EVENTS ====================

    this.socket.on(
      "user:status_change",
      (data: { userId: string; isOnline: boolean; timestamp: Date }) => {
        console.log("👤 User status changed:", data);

        onlineUsers.update((users) => {
          if (data.isOnline) {
            return users.includes(data.userId)
              ? users
              : [...users, data.userId];
          } else {
            return users.filter((id) => id !== data.userId);
          }
        });
      },
    );

    // ==================== SERVER ACTIVITY EVENTS ====================

    this.socket.on("server:user_connected", (data: any) => {
      console.log("🖥️ User connected to server:", data);
      serverActivity.update((activities) => [
        { type: "user_connected", data, timestamp: new Date() },
        ...activities.slice(0, 49), // Keep last 50 activities
      ]);
    });

    this.socket.on("server:user_disconnected", (data: any) => {
      console.log("🖥️ User disconnected from server:", data);
      serverActivity.update((activities) => [
        { type: "user_disconnected", data, timestamp: new Date() },
        ...activities.slice(0, 49),
      ]);
    });

    this.socket.on("server:file_modified", (data: any) => {
      console.log("📁 File modified:", data);
      serverActivity.update((activities) => [
        { type: "file_modified", data, timestamp: new Date() },
        ...activities.slice(0, 49),
      ]);
    });

    // ==================== MESSAGING EVENTS ====================

    this.socket.on("message:received", (data: any) => {
      console.log("💬 New message received:", data);
      liveMessages.update((messages) => [data, ...messages.slice(0, 19)]); // Keep last 20 messages

      // Show notification or update UI
      this.showNotification(
        "New Message",
        `From ${data.sender}: ${data.subject}`,
      );
    });

    this.socket.on("message:error", (data: any) => {
      console.error("💬 Message error:", data);
      socketError.set(`Message error: ${data.message}`);
    });

    // ==================== HACKING EVENTS ====================

    this.socket.on("hack:attempted", (data: any) => {
      console.log("🔓 Hack attempt detected:", data);
      hackAttempts.update((attempts) => [
        { type: "attempted", data, timestamp: new Date() },
        ...attempts.slice(0, 19), // Keep last 20 attempts
      ]);

      if (data.targetUserId === this.getCurrentUserId()) {
        this.showNotification(
          "Security Alert",
          `Hack attempt detected from ${data.attackerName || "unknown"}`,
        );
      }
    });

    this.socket.on("hack:successful", (data: any) => {
      console.log("🔓 Successful hack:", data);
      hackAttempts.update((attempts) => [
        { type: "successful", data, timestamp: new Date() },
        ...attempts.slice(0, 19),
      ]);

      if (data.targetUserId === this.getCurrentUserId()) {
        this.showNotification(
          "Security Breach",
          "Your system has been compromised!",
        );
      }
    });

    this.socket.on("hack:blocked", (data: any) => {
      console.log("🛡️ Hack blocked:", data);
      hackAttempts.update((attempts) => [
        { type: "blocked", data, timestamp: new Date() },
        ...attempts.slice(0, 19),
      ]);
    });

    this.socket.on("hack:result", (data: any) => {
      console.log("🔓 Hack result:", data);
      // Handle hack result in the UI
      this.handleHackResult(data);
    });

    this.socket.on("hack:error", (data: any) => {
      console.error("🔓 Hack error:", data);
      socketError.set(`Hack error: ${data.message}`);
    });

    // ==================== GAME EVENTS ====================

    this.socket.on("game:event", (data: any) => {
      console.log("🎯 Game event received:", data);
      gameEvents.update((events) => [data, ...events.slice(0, 49)]); // Keep last 50 events

      // Show notification for important events
      if (data.severity === "critical" || data.severity === "warning") {
        this.showNotification(data.title, data.description);
      }
    });

    this.socket.on("game:event:public", (data: any) => {
      console.log("📡 Public event:", data);
      // Handle public event broadcasts (visible to all)
    });

    // ==================== SYSTEM EVENTS ====================

    this.socket.on("system:announcement", (data: any) => {
      console.log("📢 System announcement:", data);
      this.showNotification("System Announcement", data.message);
    });

    this.socket.on("mission:assigned", (data: any) => {
      console.log("🎯 Mission assigned:", data);
      this.showNotification("New Mission", `Mission assigned: ${data.title}`);
    });

    this.socket.on("faction:event", (data: any) => {
      console.log("🏛️ Faction event:", data);
      // Handle faction events
    });

    this.socket.on("discovery:made", (data: any) => {
      console.log("🔍 Discovery made:", data);
      this.showNotification("Discovery", `New discovery: ${data.title}`);
    });

    // ==================== ERROR HANDLING ====================

    this.socket.on("error", (data: any) => {
      console.error("🚨 Socket error:", data);
      socketError.set(data.message || "Unknown socket error");
    });
  }

  // ==================== RECONNECTION LOGIC ====================

  private handleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("🔌 Max reconnection attempts reached");
      socketError.set("Connection lost. Please refresh the page.");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff

    console.log(
      `🔌 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    setTimeout(() => {
      if (!this.socket?.connected) {
        this.connect();
      }
    }, delay);
  }

  // ==================== EMISSION METHODS ====================

  public emitServerConnect(serverId: string): void {
    this.socket?.emit("server:connect", { serverId });
  }

  public emitServerDisconnect(serverId: string): void {
    this.socket?.emit("server:disconnect", { serverId });
  }

  public emitSendMessage(data: {
    recipientId: string;
    subject: string;
    content: string;
  }): void {
    this.socket?.emit("message:send", data);
  }

  public emitHackAttempt(data: {
    targetUserId: string;
    targetServerId: string;
    method: string;
    tools: string[];
  }): void {
    this.socket?.emit("hack:attempt", data);
  }

  public emitJoinRoom(room: string): void {
    this.socket?.emit("join:room", { room });
  }

  public emitLeaveRoom(room: string): void {
    this.socket?.emit("leave:room", { room });
  }

  // ==================== UTILITY METHODS ====================

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  private getCurrentUserId(): string | null {
    // This should be implemented to get the current user ID
    // For now, return null - will be implemented when auth store is created
    return null;
  }

  private showNotification(title: string, message: string): void {
    // Browser notification (if permission granted)
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(title, {
        body: message,
        icon: "/favicon.ico",
        tag: "aida-notification",
      });
    }

    // You can also emit to a notification store for in-app notifications
    console.log(`🔔 ${title}: ${message}`);
  }

  private handleHackResult(result: any): void {
    // This will be implemented to handle hack results in the UI
    console.log("Handling hack result:", result);
  }

  // Request notification permission
  public requestNotificationPermission(): void {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then((permission) => {
        console.log("Notification permission:", permission);
      });
    }
  }
}

// Create and export singleton instance
export const socketService = new SocketService();
export default socketService;

// Export connection utilities
export const connectSocket = () => socketService.connect();
export const disconnectSocket = () => socketService.disconnect();
export const reconnectSocket = () => socketService.reconnect();

// Export emission utilities
export const emitServerConnect = (serverId: string) =>
  socketService.emitServerConnect(serverId);
export const emitServerDisconnect = (serverId: string) =>
  socketService.emitServerDisconnect(serverId);
export const emitSendMessage = (data: {
  recipientId: string;
  subject: string;
  content: string;
}) => socketService.emitSendMessage(data);
export const emitHackAttempt = (data: {
  targetUserId: string;
  targetServerId: string;
  method: string;
  tools: string[];
}) => socketService.emitHackAttempt(data);

// Export game event store
export { gameEvents };
