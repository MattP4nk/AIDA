import { io, Socket } from "socket.io-client";
import { writable, get, type Writable } from "svelte/store";
import { apiClient } from "./api";
import { terminalTabsStore } from "./terminalTabs";

// Socket connection configuration — override via VITE_SOCKET_URL env var
const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string) || "http://localhost:3001";

// Connection state stores
export const socketConnected = writable(false);
export const socketError = writable<string | null>(null);

// Real-time data stores
export const onlineUsers = writable<string[]>([]);
export const serverActivity = writable<any[]>([]);
export const liveMessages = writable<any[]>([]);
export const hackAttempts = writable<any[]>([]);
const gameEvents = writable<any[]>([]);
export const typingUsers = writable<Map<string, string>>(new Map());
export const newMailNotifications: Writable<any[]> = writable([]);

// Resource/process stores (updated by server push)
export const playerResources = writable<{
  cpuUsed: number;
  cpuTotal: number;
  ramUsed: number;
  ramTotal: number;
  bwUsed: number;
  bwTotal: number;
}>({
  cpuUsed: 0,
  cpuTotal: 200,
  ramUsed: 0,
  ramTotal: 256,
  bwUsed: 0,
  bwTotal: 100,
});

export const activeProcesses = writable<any[]>([]);

// Active hack session store (for sticky challenge panel)
export const activeHackSession = writable<{
  active: boolean;
  targetIp?: string;
  currentLayer?: number;
  totalLayers?: number;
  challenge?: any;
} | null>(null);

// Lazy notification service reference (avoids circular import)
let _notifService: any = null;
// Kick off dynamic import so _notifService is populated asynchronously
import("./notifications")
  .then((mod) => {
    _notifService = mod.notificationService;
  })
  .catch(() => {
    /* ignore */
  });
function getNotifService() {
  return _notifService;
}

// Lazy gameState reference (avoids circular import: gameState → socket → gameState)
let _addOutput:
  | ((
      text: string,
      type?: "info" | "error" | "warning" | "success" | "system",
    ) => void)
  | null = null;
import("../stores/gameState")
  .then((mod) => {
    _addOutput = mod.addOutput;
  })
  .catch(() => {
    /* ignore */
  });

class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private registeredEvents: string[] = []; // Track registered events for clean removal

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
      withCredentials: true, // Send httpOnly cookie alongside Socket.IO handshake
      transports: ["websocket", "polling"],
      timeout: 10000,
      forceNew: true,
    });

    this.setupEventHandlers();
  }

  public disconnect(): void {
    if (this.socket) {
      // Remove all listeners before disconnecting to prevent memory leaks
      this.removeAllListeners();
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

  // ==================== CLEANUP ====================

  /** Register an event handler and track it for automatic cleanup. */
  private on(event: string, handler: (...args: any[]) => void): void {
    if (!this.socket) return;
    this.socket.on(event, handler);
    this.registeredEvents.push(event);
  }

  /** Remove all tracked event listeners to prevent memory leaks. */
  private removeAllListeners(): void {
    if (!this.socket) return;
    for (const event of this.registeredEvents) {
      this.socket.off(event);
    }
    this.registeredEvents = [];
  }

  // ==================== EVENT HANDLERS ====================

  private setupEventHandlers(): void {
    if (!this.socket) return;

    // Remove any existing listeners first to prevent duplicates
    this.removeAllListeners();

    // Connection events
    this.on("connect", () => {
      socketConnected.set(true);
      socketError.set(null);
      this.reconnectAttempts = 0;

      // Authenticate the socket connection
      this.socket?.emit("authenticated");
    });

    this.on("disconnect", (reason) => {
      socketConnected.set(false);

      if (reason === "io server disconnect") {
        // Server disconnected us, don't auto-reconnect
        return;
      }

      this.handleReconnect();
    });

    this.on("connect_error", (error) => {
      console.error("🔌 WebSocket connection error:", error);
      socketError.set(error.message);
      this.handleReconnect();
    });

    // Authentication events
    this.on("authenticated", () => {
      // Authenticated successfully
    });

    // ==================== USER PRESENCE EVENTS ====================

    this.on(
      "user:status_change",
      (data: { userId: string; isOnline: boolean; timestamp: Date }) => {
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

    this.on("server:user_connected", (data: any) => {
      serverActivity.update((activities) => [
        { type: "user_connected", data, timestamp: new Date() },
        ...activities.slice(0, 49), // Keep last 50 activities
      ]);
    });

    this.on("server:user_disconnected", (data: any) => {
      serverActivity.update((activities) => [
        { type: "user_disconnected", data, timestamp: new Date() },
        ...activities.slice(0, 49),
      ]);
    });

    this.on("server:file_modified", (data: any) => {
      serverActivity.update((activities) => [
        { type: "file_modified", data, timestamp: new Date() },
        ...activities.slice(0, 49),
      ]);
    });

    // ==================== MESSAGING EVENTS ====================

    this.on("message:received", (data: any) => {
      console.log("💬 New message received:", data);
      liveMessages.update((messages) => [data, ...messages.slice(0, 19)]); // Keep last 20 messages

      // Show notification or update UI
      this.showNotification(
        "New Message",
        `From ${data.sender}: ${data.subject}`,
      );
    });

    this.on("message:new_mail", (data: any) => {
      newMailNotifications.update((list) => {
        return [data, ...list];
      });
    });

    this.on("message:error", (data: any) => {
      console.error("💬 Message error:", data);
      socketError.set(`Message error: ${data.message}`);
    });

    // ==================== FORUM EVENTS ====================

    this.on("forum:new-post", (data: any) => {
      this.showNotification(
        "New Forum Post",
        `${data.authorHandle || "Someone"} posted in ${data.forumName || "a forum"}: ${data.title || ""}`,
      );
    });

    this.on("forum:new-reply", (data: any) => {
      this.showNotification(
        "Forum Reply",
        `${data.authorHandle || "Someone"} replied to "${data.postTitle || "your post"}"`,
      );
    });

    // ==================== HACKING EVENTS ====================

    this.on("hack:attempted", (data: any) => {
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

    this.on("hack:successful", (data: any) => {
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

    this.on("hack:blocked", (data: any) => {
      console.log("🛡️ Hack blocked:", data);
      hackAttempts.update((attempts) => [
        { type: "blocked", data, timestamp: new Date() },
        ...attempts.slice(0, 19),
      ]);
    });

    this.on("hack:result", (data: any) => {
      console.log("🔓 Hack result:", data);
      // Handle hack result in the UI
      this.handleHackResult(data);
    });

    this.on("hack:error", (data: any) => {
      console.error("🔓 Hack error:", data);
      socketError.set(`Hack error: ${data.message}`);
    });

    // ==================== GAME EVENTS ====================

    this.on("game:event", (data: any) => {
      console.log("🎯 Game event received:", data);
      gameEvents.update((events) => [data, ...events.slice(0, 49)]); // Keep last 50 events

      // Show notification for important events
      if (data.severity === "critical" || data.severity === "warning") {
        this.showNotification(data.title, data.description);
      }
    });

    this.on("game:event:public", (data: any) => {
      console.log("📡 Public event:", data);
      // Handle public event broadcasts (visible to all)
    });

    // ==================== FRAGMENT / ENDGAME EVENTS ====================

    this.on("story:key-fragment", (data: any) => {
      this.showNotification(
        "Fragment Found",
        `${data.name} (${data.keyType})`,
      );
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "AIDA Fragment Claimed",
          message: `You claimed ${data.name} — ${data.description || data.keyType + " fragment"}`,
          priority: "high",
        });
      }
    });

    this.on("story:fragment-stolen", (data: any) => {
      this.showNotification(
        "Fragment Stolen!",
        data.message || `Your fragment "${data.name}" has been stolen!`,
      );
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Fragment Stolen",
          message: data.message || `Your fragment "${data.name}" has been stolen!`,
          priority: "urgent",
        });
      }
    });

    this.on("story:fragment-transferred", (data: any) => {
      this.showNotification(
        "Fragment Sent",
        data.message || `You transferred "${data.name}".`,
      );
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Fragment Transferred",
          message: data.message || `You transferred "${data.name}".`,
          priority: "normal",
        });
      }
    });

    this.on("story:endgame-unlocked", (data: any) => {
      this.showNotification(
        "ENDGAME UNLOCKED",
        data.message || "All fragments collected. The final choice awaits.",
      );
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Endgame Unlocked",
          message: data.message || "All 9 AIDA fragments collected. Use 'endgame' to choose.",
          priority: "urgent",
        });
      }
    });

    this.on("story:endgame-completed", (data: any) => {
      this.showNotification(
        "The Endgame",
        "A player has decided AIDA's fate. The net trembles.",
      );
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Endgame Completed",
          message: "A player has made their final choice about AIDA. The net will never be the same.",
          priority: "urgent",
        });
      }
    });

    // ==================== SYSTEM EVENTS ====================

    this.on("system:announcement", (data: any) => {
      console.log("📢 System announcement:", data);
      this.showNotification("System Announcement", data.message);
    });

    this.on("mission:assigned", (data: any) => {
      console.log("🎯 Mission assigned:", data);
      this.showNotification("New Mission", `Mission assigned: ${data.title}`);
    });

    this.on("faction:event", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Faction Event",
          message: data.message || data.type || "Faction activity",
          priority: "normal",
          data,
        });
      }
    });

    this.on("discovery:made", (data: any) => {
      this.showNotification("Discovery", `New discovery: ${data.title}`);
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Discovery",
          message: data.title || "New discovery",
          priority: "normal",
          data,
        });
      }
    });

    // ==================== PROCESS EVENTS ====================

    this.on("process:started", (data: any) => {
      activeProcesses.update((procs) => [...procs, data]);
    });

    this.on("process:completed", (data: any) => {
      console.log(
        "[process:completed] PID:",
        data.pid,
        "type:",
        data.type,
        "hasOutput:",
        !!data.output,
      );
      activeProcesses.update((procs) =>
        procs.filter((p) => p.pid !== data.pid),
      );

      // If the process completion includes output, render it to the terminal
      if (data.output) {
        const activeTab = terminalTabsStore.getActiveTerminal();
        if (activeTab) {
          terminalTabsStore.addOutputLine(
            activeTab.id,
            data.output,
            data.success === false ? "error" : "output",
          );
        } else if (_addOutput) {
          _addOutput(data.output, data.success === false ? "error" : "info");
        }
      }

      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Process Complete",
          message: `${data.targetLabel || data.type || "Process"} finished (PID ${data.pid})`,
          priority: "high",
          data,
        });
      }
    });

    this.on("process:cancelled", (data: any) => {
      activeProcesses.update((procs) =>
        procs.filter((p) => p.pid !== data.pid),
      );
    });

    this.on("process:progress", (data: any) => {
      activeProcesses.update((procs) =>
        procs.map((p) =>
          p.pid === data.pid ? { ...p, progress: data.progress } : p,
        ),
      );
    });

    this.on("process:failed", (data: any) => {
      activeProcesses.update((procs) =>
        procs.filter((p) => p.pid !== data.pid),
      );
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Process Failed",
          message: data.error || `Process ${data.pid} failed`,
          priority: "high",
          data,
        });
      }
    });

    // ==================== MISSION EVENTS ====================

    this.on("mission:objective:updated", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Objective Progress",
          message: `${data.completed ? "Objective completed!" : "Objective progress updated"}`,
          priority: data.completed ? "high" : "normal",
          data,
        });
      }
    });

    this.on("mission:completed", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Mission Complete!",
          message: data.title || "Mission completed successfully",
          priority: "high",
          data,
        });
      }
    });

    this.on("mission:expired", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Mission Expired",
          message: data.title || "A mission has expired",
          priority: "normal",
          data,
        });
      }
    });

    this.on("mission:updated", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Mission Updated",
          message: data.title || "A mission has been updated",
          priority: "normal",
          data,
        });
      }
    });

    this.on("game:state_update", (data: any) => {
      const ns = getNotifService();
      if (ns && data.message) {
        ns.add({
          type: "system",
          title: "Game State",
          message: data.message,
          priority: "normal",
          data,
        });
      }
    });

    // ==================== PLAYER PROGRESSION EVENTS ====================

    this.on("player:levelup", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Level Up!",
          message: `You reached level ${data.newLevel || data.level}!`,
          priority: "urgent",
          data,
        });
      }
    });

    this.on("rewards:xp_granted", (data: any) => {
      // Silent — XP rewards don't need a popup, shown in command output
    });

    this.on("rewards:credits_granted", (data: any) => {
      // Silent — credit rewards shown in command output
    });

    this.on("achievement:unlocked", (data: any) => {
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Achievement Unlocked!",
          message: `${data.name}: ${data.description}`,
          priority: "urgent",
          data,
        });
      }
    });

    // ==================== SECURITY EVENTS ====================

    this.on("command:result", (data: any) => {
      console.log("[command:result] Received:", {
        hasOutput: !!data.output,
        outputLength: data.output?.length,
        success: data.success,
        terminalId: data.terminalId,
        hasData: !!data.data,
      });

      // Check if this is a hack session start (contains session data with challenge)
      if (data.data?.sessionId && data.data?.targetIp) {
        // Hack session started — parse the challenge from the output
        activeHackSession.set({
          active: true,
          targetIp: data.data.targetIp,
          currentLayer: 0,
          totalLayers: data.data.totalLayers,
          challenge: data.data.challenge,
        });
      }
      // Render output text from background processes (hack prep, scan, traceroute, etc.)
      if (data.output) {
        const activeTab = terminalTabsStore.getActiveTerminal();
        const targetTab = data.terminalId || activeTab?.id;
        console.log(
          "[command:result] Routing output to tab:",
          targetTab,
          "activeTab:",
          activeTab?.id,
        );
        if (targetTab) {
          terminalTabsStore.addOutputLine(
            targetTab,
            data.output,
            data.success ? "output" : "error",
          );
        } else if (_addOutput) {
          console.log("[command:result] Falling back to legacy addOutput");
          _addOutput(data.output, data.success ? "info" : "error");
        } else {
          console.warn(
            "[command:result] No output channel available! Output lost:",
            data.output.substring(0, 100),
          );
        }
      }
    });

    this.on("notification", (data: any) => {
      // Generic server notification (used by bounty system, IDS, etc.)
      const ns = getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: data.title || "Alert",
          message: data.message || data.description || "Server notification",
          priority: data.severity === "critical" ? "urgent" : "high",
          data,
        });
      }
    });

    // ==================== RESOURCE UPDATES ====================

    this.on("resources:update", (data: any) => {
      if (data) {
        playerResources.set({
          cpuUsed: data.cpuUsed ?? 0,
          cpuTotal: data.cpuTotal ?? 200,
          ramUsed: data.ramUsed ?? 0,
          ramTotal: data.ramTotal ?? 256,
          bwUsed: data.bwUsed ?? 0,
          bwTotal: data.bwTotal ?? 100,
        });
      }
    });

    // ==================== TYPING INDICATORS ====================

    this.on(
      "typing:start",
      (data: { userId: string; username: string }) => {
        typingUsers.update((map) => {
          map.set(data.userId, data.username);
          return new Map(map);
        });
      },
    );

    this.on("typing:stop", (data: { userId: string }) => {
      typingUsers.update((map) => {
        map.delete(data.userId);
        return new Map(map);
      });
    });

    // ==================== ERROR HANDLING ====================

    this.on("error", (data: any) => {
      console.error("Socket error:", data);
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

  public emitTypingStart(recipientId: string): void {
    this.socket?.emit("typing:start", { recipientId });
  }

  public emitTypingStop(recipientId: string): void {
    this.socket?.emit("typing:stop", { recipientId });
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
export const emitTypingStart = (recipientId: string) =>
  socketService.emitTypingStart(recipientId);
export const emitTypingStop = (recipientId: string) =>
  socketService.emitTypingStop(recipientId);

// Export game event store
export { gameEvents };
