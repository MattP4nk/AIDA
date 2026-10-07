import { io, Socket } from "socket.io-client";
import { writable, derived, get, type Writable } from "svelte/store";
import { applyStateDelta } from "../../../shared/utils/stateDelta";
import { apiClient } from "./api";
import { terminalTabsStore } from "./terminalTabs";
import { sound } from "./sound";
import { ReservedPID } from "../../../shared/types";

// Socket connection configuration — override via VITE_SOCKET_URL env var
const SOCKET_URL =
  (import.meta.env.VITE_SOCKET_URL as string) || "http://localhost:3001";

// Connection state stores
export const socketConnected = writable(false);
export const socketError = writable<string | null>(null);

// Real-time data stores
export const onlineUsers = writable<string[]>([]);
export const liveMessages = writable<any[]>([]);
const gameEvents = writable<any[]>([]);
export const typingUsers = writable<Map<string, string>>(new Map());
export const newMailNotifications: Writable<any[]> = writable([]);

/**
 * The player's authoritative state, pushed by the server.
 *
 * ORPHAN AUDIT 2026-09-25: `state:update` and `state:delta` were emitted by
 * gameStateManager and had ZERO listeners, while the client's own REST
 * fallback (`loadInitialGameData`) called `/api/users/stats` and
 * `/api/servers` — both of which return 404, because neither route is
 * mounted. So the entire non-terminal state layer was empty, and components
 * that needed a number ran a command to get it.
 *
 * Modelled on `playerResources` directly below: a writable the server pushes
 * into, living here rather than in stores/gameState.ts because socket.ts
 * cannot statically import that module (see the dynamic import at the top).
 */
export const playerState = writable<any | null>(null);

/** Convenience views so a component subscribes to the field it needs. */
export const playerCredits = derived(playerState, ($s) => $s?.player?.credits ?? 0);
export const playerLevel = derived(playerState, ($s) => $s?.player?.level ?? 1);
export const playerExperience = derived(playerState, ($s) => $s?.player?.experience ?? 0);
export const playerSkills = derived(playerState, ($s) => $s?.player?.skills ?? {});
export const playerInventory = derived(playerState, ($s) => $s?.inventory ?? []);
export const playerMissions = derived(playerState, ($s) => $s?.missions ?? []);

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

// Active connection challenge store (for sticky challenge panel)
export const activeConnectionSession = writable<{
  active: boolean;
  targetIp?: string;
  challenge?: any;
  sessionId?: string;
} | null>(null);

// Active file access challenge store (sweep/crack/storm panels)
export const activeFileChallenge = writable<{
  active: boolean;
  type: "sweep" | "crack" | "storm";
  targetFile?: string;
  targetDir?: string;
  challenge?: any;
  sessionId?: string;
} | null>(null);

// Lazy notification service reference (avoids circular import)
// Promises are stored so callers can await resolution — fire-and-forget
// imports would silently drop events if they resolved after socket events arrived.
const _notifServicePromise = import("./notifications")
  .then((mod) => mod.notificationService)
  .catch(() => null);

let _notifServiceCache: any = null;
async function getNotifService() {
  if (!_notifServiceCache) {
    _notifServiceCache = await _notifServicePromise;
  }
  return _notifServiceCache;
}

// Lazy gameState reference (avoids circular import: gameState → socket → gameState)
const _addOutputPromise = import("../stores/gameState")
  .then((mod) => mod.addOutput)
  .catch(() => null);

let _addOutputCache:
  | ((
      text: string,
      type?: "info" | "error" | "warning" | "success" | "system",
    ) => void)
  | null = null;
async function getAddOutput() {
  if (!_addOutputCache) {
    _addOutputCache = await _addOutputPromise;
  }
  return _addOutputCache;
}

class SocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  /**
   * R13 REVIEW: retry indefinitely, with a CAPPED DELAY — not a capped
   * attempt count.
   *
   * Turning off socket.io's built-in reconnection (to stop the duplicate
   * loop) handed the only retry path to `handleReconnect()`, which gave up
   * after 5 attempts — 1+2+4+8+16s, about 31 seconds. socket.io's default is
   * `reconnectionAttempts: Infinity`. So a server restart, a laptop
   * sleep/wake, or any wifi drop longer than half a minute left the client
   * permanently disconnected for the rest of the session, where before it
   * would have recovered on its own. Removing a redundant mechanism must not
   * import a shorter patience budget than the one it replaced.
   */
  private reconnectDelay = 1000; // Start with 1 second
  private maxReconnectDelay = 30_000; // ...and never wait longer than this
  /** Attempts after which the UI says "please refresh" — retries continue. */
  private warnAfterAttempts = 5;
  private registeredEvents: string[] = []; // Track registered events for clean removal
  private userId: string | null = null; // Set during authentication
  /** Pending authentication retry, so a disconnect can cancel it. */
  private authRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

    // Clean up old socket to prevent listener leaks on reconnection
    if (this.socket) {
      this.cancelAuthRetry();
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.socket = io(SOCKET_URL, {
      auth: { token },
      withCredentials: true, // Send httpOnly cookie alongside Socket.IO handshake
      transports: ["websocket", "polling"],
      timeout: 10000,
      forceNew: true,
      // R13: socket.io's built-in reconnection defaults to TRUE and was never
      // disabled, so it ran alongside `handleReconnect()` — two loops for one
      // job. Each internal retry that failed emitted `connect_error`, which
      // called `handleReconnect()`, which incremented the manual attempt
      // counter and scheduled ANOTHER `connect()` — and `connect()` builds a
      // fresh socket (`forceNew: true`), abandoning the one socket.io was
      // still retrying. The two fed each other and raced to create sockets.
      //
      // The explicit loop is kept because the app has real policy around it:
      // a max-attempt ceiling, exponential backoff, a user-facing "please
      // refresh" message, and the deliberate rule that `io server disconnect`
      // (a kick or ban) must NOT auto-reconnect.
      reconnection: false,
    });

    this.setupEventHandlers();
  }

  public disconnect(): void {
    if (this.socket) {
      this.cancelAuthRetry();
      // Remove all listeners before disconnecting to prevent memory leaks
      this.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
      socketConnected.set(false);
    }
  }

  /**
   * R13 — reconnect and RESOLVE once the socket exists.
   *
   * This returned `void` while `disconnect()` nulls `this.socket`
   * synchronously and `connect()` was deferred 100ms. So a caller doing
   *
   *     socketService.reconnect();
   *     const socket = socketService.getSocket();   // always null
   *
   * always took the `if (socket)` false branch — which in `App.svelte` is the
   * whole authentication-wait block, including the listeners attached inside
   * it. Awaiting the returned promise makes `getSocket()` meaningful again.
   */
  public reconnect(): Promise<Socket | null> {
    this.disconnect();
    return new Promise((resolve) => {
      setTimeout(() => {
        this.connect();
        resolve(this.socket);
      }, 100);
    });
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

  /**
   * Drop a pending authentication retry.
   *
   * Called from every teardown path, not just the `disconnect` HANDLER —
   * `connect()` and `disconnect()` both call `removeAllListeners()` before
   * `socket.disconnect()`, so that handler does not run on either of them. A
   * timer surviving `connect()` would fire against the NEW socket and run a
   * second retry chain alongside the one `connect` just started.
   */
  private cancelAuthRetry(): void {
    if (this.authRetryTimer) {
      clearTimeout(this.authRetryTimer);
      this.authRetryTimer = null;
    }
  }

  /**
   * Authenticate this socket, retrying a refusal.
   *
   * A refusal used to be terminal. `socket.emit("authenticated")` ran once per
   * `connect`, and on failure the client set `socketError` and stopped — but
   * the socket was still CONNECTED, so neither `handleReconnect` (driven by
   * `disconnect`/`connect_error`) nor another `connect` ever fired. The result
   * was a healthy-looking socket that had joined no rooms, received no state
   * and no notification replay, recoverable only by a manual reload.
   *
   * The server's refusals are transient by construction — the handshake has
   * already validated the token, so reaching this point and failing means a
   * rate limit or a server-side blip, both of which a retry clears. The delays
   * step past the 10s limiter window rather than hammering it.
   *
   * `setUserId` is called HERE rather than only in App.svelte's bootstrap:
   * that path has its own one-shot attempt and a "degraded, not fatal" catch,
   * so if it loses and this one wins, nothing else would set the id that hack
   * alerts are targeted by.
   */
  private authenticateSocket(attempt = 0): void {
    const delays = [2000, 5000, 11_000];

    this.socket?.emit(
      "authenticated",
      (response: { success: boolean; error?: string; userId?: string }) => {
        if (response?.success) {
          socketError.set(null);
          if (response.userId) this.setUserId(response.userId);
          return;
        }

        if (attempt >= delays.length) {
          console.error("[socket] authentication failed, giving up:", response?.error);
          socketError.set(response?.error || "Authentication failed");
          return;
        }

        const wait = delays[attempt]!;
        console.warn(
          `[socket] authentication refused (${response?.error}); retrying in ${wait}ms`,
        );
        this.cancelAuthRetry();
        this.authRetryTimer = setTimeout(() => {
          this.authRetryTimer = null;
          // The socket may have dropped while we waited; `connect` will run
          // this again from scratch, so retrying a dead socket is pure noise.
          if (this.socket?.connected) this.authenticateSocket(attempt + 1);
        }, wait);
      },
    );
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

      // A3: authenticate WITH an acknowledgement.
      //
      // This emitted with no callback, and `handleAuthentication` branches on
      // `typeof callback === "function"`: with none it fell to the else branch
      // and emitted `authentication:complete` — an event NOTHING in the client
      // listens for. The client instead listened for `authenticated`, which the
      // server never emits. So the success signal was never delivered on this
      // path at all; it only appeared to work because the server's side effects
      // (room joins, attachSocket, broadcastStateUpdate) happen regardless.
      //
      // This path matters more than App.svelte's: it runs on EVERY `connect`,
      // which is what re-authenticates after a reconnect.
      this.authenticateSocket();
    });

    this.on("disconnect", (reason) => {
      socketConnected.set(false);

      // `connect` restarts authentication from attempt 0, so a surviving timer
      // would run a second chain alongside it.
      this.cancelAuthRetry();

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

    // A3: the `authenticated` listener is GONE — the server never emitted it.
    // It was one of 10 client listeners waiting on events no server code
    // sends. The acknowledgement above is the real signal.

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

    // Someone else joined or left the server you are on.
    //
    // These wrote a `serverActivity` store that NO COMPONENT READ, so the
    // information arrived and stopped there — the player could only find out
    // by typing `who`. (And `who` was itself broken: the occupancy map it
    // reads was only ever populated by a socket handler no client calls, so it
    // always answered "No other players on this server." Fixed server-side.)
    //
    // Rendered into the terminal rather than a notification: it is ambient
    // colour, not something that needs acknowledging, and the terminal is
    // where this game says everything else. `addOutputLine` is the same
    // mechanism server-pushed `command:result` text already uses.
    const serverPresenceLine = (text: string) => {
      const tab = terminalTabsStore.getActiveTerminal();
      if (tab) terminalTabsStore.addOutputLine(tab.id, text, "output");
    };

    this.on("server:user_connected", (data: any) => {
      // The room includes the joiner, so skip your own arrival.
      if (data.userId === this.getCurrentUserId()) return;
      serverPresenceLine(`[+] ${data.username ?? "A user"} connected to this server.`);
    });

    this.on("server:user_disconnected", (data: any) => {
      if (data.userId === this.getCurrentUserId()) return;
      serverPresenceLine(`[-] ${data.username ?? "A user"} disconnected from this server.`);
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
      // R13: bounded. This grew without limit for the life of the session —
      // every mail ever received stayed in memory, and the MailDialog
      // subscriber re-rendered the whole list each time. `gameEvents` a few
      // lines above already caps at 50; mail simply never adopted it.
      newMailNotifications.update((list) => [data, ...list].slice(0, 50));
    });

    // Was listening for "message:error", which the server never emits. The real
    // event is "message:result" — but it is an ACK, not an error channel: it
    // carries { success, error } and fires on success too. A straight rename
    // would have shown "Message error: undefined" on every message successfully
    // sent, so the body is reconciled to the actual payload rather than renamed.
    this.on("message:result", (data: any) => {
      if (data?.success !== false) return;
      socketError.set(`Message error: ${data.error ?? "unknown error"}`);
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

      if (data.targetUserId === this.getCurrentUserId()) {
        this.showNotification(
          "Security Alert",
          `Hack attempt detected from ${data.attackerName || "unknown"}`,
        );
      }
    });

    this.on("hack:successful", (data: any) => {
      sound.hackSuccess();

      if (data.targetUserId === this.getCurrentUserId()) {
        this.showNotification(
          "Security Breach",
          "Your system has been compromised!",
        );
      }
    });

    this.on("hack:blocked", (data: any) => {
      console.log("🛡️ Hack blocked:", data);
    });

    this.on("hack:result", (data: any) => {
      console.log("🔓 Hack result:", data);
      // Handle hack result in the UI
      this.handleHackResult(data);
    });

    // REMOVED 2026-10-06: the `hack:error` listener. Unlike its three
    // siblings above it had no producer of ANY kind — not a socket emit, not
    // an internal bus event — and an error on the attacker's own hack command
    // already reaches them through `command:error`. It was a second, unwired
    // path for something already handled.

    // A3: four listeners were removed here — `faction:event`,
    // `mission:updated`, `server:file_modified` and `error`. Nothing in the
    // codebase produced any of them: not a socket emit, not even an internal
    // EventEmitter. They were speculative handlers for events that were never
    // built, and they made the client look like it handled cases it did not.
    //
    // NOT removed, because they are a different problem: the `hack:*` and
    // `process:failed` listeners wait on events that ARE produced — on the
    // internal service bus, never bridged to a socket. See PLAN.md A3.

    // ==================== GAME EVENTS ====================

    // ORPHAN AUDIT 2026-09-24. `game:event` is GONE, in both directions.
    //
    // It had TWO listeners registered on one name with incompatible payload
    // shapes — one reading {title, description, severity}, another ~250 lines
    // below reading {message}. Both ran on every emit, so each saw a payload
    // it could not read half the time. Neither mattered, because the store
    // they fed has no component reading it and the alert they raised went to
    // an empty showNotification.
    //
    // Both producers moved: eventService delivers TARGETED events through
    // notifyUser as `notification` (so they persist and replay), and
    // keyFragmentService's endgame announcement moved to the global channel
    // below, where it belonged. One channel, one shape, one listener.
    //
    // The server used to fire the global channel for EVERY event including
    // targeted ones, so a breach or a tripped honeypot announced itself to
    // every connected player; it is now gated on `isGlobal` and carries
    // `description` and `metadata`, which the old 4-field payload dropped.
    this.on("game:event:public", (data: any) => {
      gameEvents.update((events) => [data, ...events.slice(0, 49)]); // Keep last 50
      this.surfaceWorldEvent(data);
    });

    // ==================== FRAGMENT / ENDGAME EVENTS ====================

    this.on("story:key-fragment", async (data: any) => {
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "AIDA Fragment Claimed",
          message: `You claimed ${data.name} — ${data.description || data.keyType + " fragment"}`,
          priority: "high",
        });
      }
    });

    this.on("story:fragment-stolen", async (data: any) => {
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Fragment Stolen",
          message: data.message || `Your fragment "${data.name}" has been stolen!`,
          priority: "critical",
        });
      }
    });

    this.on("story:fragment-transferred", async (data: any) => {
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Fragment Transferred",
          message: data.message || `You transferred "${data.name}".`,
          priority: "normal",
        });
      }
    });

    this.on("story:endgame-unlocked", async (data: any) => {
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Endgame Unlocked",
          message: data.message || "All 9 AIDA fragments collected. Use 'endgame' to choose.",
          priority: "critical",
        });
      }
    });

    this.on("story:endgame-completed", async (data: any) => {
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Endgame Completed",
          message: "A player has made their final choice about AIDA. The net will never be the same.",
          priority: "critical",
        });
      }
    });

    // ==================== SYSTEM EVENTS ====================

    // Renamed from "system:announcement". The admin `broadcast` command has always
    // emitted "system:broadcast" ({ message, from, timestamp }); this handler was
    // listening for a name nothing sent, so admin broadcasts never reached anyone.
    this.on("system:broadcast", (data: any) => {
      this.showNotification("System Announcement", data.message);
    });

    this.on("mission:assigned", async (data: any) => {
      sound.notification();
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "New Mission",
          message: `Mission assigned: ${data.title}`,
          priority: "high",
          data,
          action: { label: "View missions", command: "missions" },
        });
      }
    });


    // Was listening for "discovery:made" and reading `data.title`. The server
    // emits "server:discovered" with { count, subnet, servers[] } and no title at
    // all — a straight rename would have rendered "New discovery: undefined".
    this.on("server:discovered", async (data: any) => {
      const count: number = data?.count ?? 0;
      if (count <= 0) return;
      const subnet: string = data?.subnet && data.subnet !== "global" ? ` on ${data.subnet}` : "";
      const summary = `Discovered ${count} server${count === 1 ? "" : "s"}${subnet}`;
      // No `showNotification` here: the `ns.add` below is the notification,
      // and it says strictly more (it names the servers). While
      // showNotification was an empty method the redundant call was invisible;
      // making it real turned it into two toasts for one scan.
      const ns = await getNotifService();
      if (ns) {
        // `servers` is capped at 5 by the server; name the first few so the
        // notification is actionable rather than just a count.
        const names = Array.isArray(data?.servers)
          ? data.servers.map((x: any) => x?.ipAddress ?? x?.name).filter(Boolean)
          : [];
        ns.add({
          type: "game",
          title: "Discovery",
          message: names.length ? `${summary}: ${names.join(", ")}` : summary,
          priority: "normal",
          data,
        });
      }
    });

    // ==================== PROCESS EVENTS ====================

    this.on("process:started", (data: any) => {
      activeProcesses.update((procs) => [...procs, data]);
    });

    this.on("process:completed", async (data: any) => {
      sound.processComplete();
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
        } else {
          const addOutput = await getAddOutput();
          if (addOutput) {
            addOutput(data.output, data.success === false ? "error" : "info");
          }
        }
      }

      const ns = await getNotifService();
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

    // A3: `process:failed` listener removed. It had no producer in EITHER
    // process system: the live one (memoryService) never sets a "failed"
    // status at all — only running/completed/cancelled — and the one that
    // does have a `failProcess` (processStateService) is entirely dead, 11
    // methods with zero callers. `process:progress` is NOT removed; that one
    // has a real socket emitter.

    // ==================== MISSION EVENTS ====================

    this.on("mission:objective:updated", async (data: any) => {
      const ns = await getNotifService();
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

    this.on("mission:completed", async (data: any) => {
      const ns = await getNotifService();
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

    this.on("mission:expired", async (data: any) => {
      const ns = await getNotifService();
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


    // ==================== PLAYER PROGRESSION EVENTS ====================

    this.on("player:levelup", async (data: any) => {
      sound.levelUp();
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Level Up!",
          message: `You reached level ${data.newLevel || data.level}!`,
          priority: "critical",
          data,
        });
      }
    });

    // These were empty, on the reasoning that rewards are "shown in command
    // output". That held when rewards only came from a command the player had
    // just typed. It stopped holding once they started arriving asynchronously —
    // a background process completing, a mission credited by a hook, a dungeon
    // payout — where there is no command output to show them in, and the player
    // got XP and credits with no feedback at all.
    //
    // Low priority on purpose: this is a confirmation, not an interruption. The
    // level-up handler above stays "critical" because that one IS an event.
    this.on("rewards:xp_granted", async (data: any) => {
      const amount = data?.xpGained ?? 0;
      if (amount <= 0) return;
      const ns = await getNotifService();
      if (ns) {
        const skill = data?.skillName && data.skillName !== "general" ? ` (${data.skillName})` : "";
        ns.add({
          type: "game",
          title: "Experience gained",
          message: `+${amount} XP${skill}`,
          priority: "low",
          data,
        });
      }
    });

    this.on("rewards:credits_granted", async (data: any) => {
      const amount = data?.amount ?? 0;
      if (amount <= 0) return;
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Credits received",
          message: `+${amount} credits`,
          priority: "low",
          data,
        });
      }
    });

    this.on("achievement:unlocked", async (data: any) => {
      const ns = await getNotifService();
      if (ns) {
        ns.add({
          type: "game",
          title: "Achievement Unlocked!",
          message: `${data.name}: ${data.description}`,
          priority: "critical",
          data,
        });
      }
    });

    // ==================== SECURITY EVENTS ====================

    this.on("command:result", async (data: any) => {
      console.log("[command:result] Received:", {
        hasOutput: !!data.output,
        outputLength: data.output?.length,
        success: data.success,
        terminalId: data.terminalId,
        hasData: !!data.data,
      });

      // Check if this is a hack session start (contains session data with challenge)
      if (data.data?.sessionId && data.data?.targetIp) {
        activeHackSession.set({
          active: true,
          targetIp: data.data.targetIp,
          currentLayer: 0,
          totalLayers: data.data.totalLayers,
          challenge: data.data.challenge,
        });

        // Register as process in ProcessBar for live countdown
        const hackTimeLimit = data.data.challenge?.timeLimit || 60;
        activeProcesses.update(procs => [
          ...procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE),
          { pid: ReservedPID.HACK_CHALLENGE, type: "hack_challenge", description: `Hack challenge — ${data.data.targetIp}`, progress: 0, eta: hackTimeLimit },
        ]);
      }

      // Check if this is a connection challenge start
      if (data.data?.connectionSessionId && data.data?.connectionChallenge) {
        activeConnectionSession.set({
          active: true,
          targetIp: data.data.targetIp,
          challenge: data.data.connectionChallenge,
          sessionId: data.data.connectionSessionId,
        });

        // Register as process in ProcessBar for live countdown
        const connTimeLimit = data.data.connectionChallenge?.timeLimit || 45;
        activeProcesses.update(procs => [
          ...procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE),
          { pid: ReservedPID.CONNECTION_CHALLENGE, type: "connection_challenge", description: `Connection challenge — ${data.data.targetIp}`, progress: 0, eta: connTimeLimit },
        ]);
      }

      // Check if this is a file access challenge (sweep/crack/storm)
      if (data.data?.fileAccessSessionId && data.data?.fileAccessType) {
        activeFileChallenge.set({
          active: true,
          type: data.data.fileAccessType,
          targetFile: data.data.targetFile,
          targetDir: data.data.targetDir,
          challenge: data.data.challenge,
          sessionId: data.data.fileAccessSessionId,
        });

        const timeLimit = data.data.challenge?.timeLimit || 60;
        activeProcesses.update(procs => [
          ...procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE),
          { pid: ReservedPID.FILE_CHALLENGE, type: "file_challenge", description: `${data.data.fileAccessType} challenge`, progress: 0, eta: timeLimit },
        ]);
      }

      // Clear file access challenge on resolution
      if (data.data?.fileAccessResolved) {
        activeFileChallenge.set(null);
        activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.FILE_CHALLENGE));
      }

      // Clear challenge panels + remove from ProcessBar on resolution
      if (data.data?.connectionResolved) {
        activeConnectionSession.set(null);
        activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.CONNECTION_CHALLENGE));
      }
      // Play sound event from server if provided
      if (data.soundEvent) {
        const sfn = sound[data.soundEvent as keyof typeof sound];
        if (typeof sfn === "function") sfn();
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
        } else {
          const addOutput = await getAddOutput();
          if (addOutput) {
            console.log("[command:result] Falling back to legacy addOutput");
            addOutput(data.output, data.success ? "info" : "error");
          } else {
            console.warn(
              "[command:result] No output channel available! Output lost:",
              data.output.substring(0, 100),
            );
          }
        }
      }
    });

    // ── Orphan audit 2026-09-24: six server emits nothing listened for ──
    //
    // Each of these was already being sent by the server, carrying exactly the
    // information the player needed, and thrown away on arrival. They are
    // grouped here because they share one cause: the event was added on the
    // server and the client half was never written.

    /**
     * Honeypot tripped. The `forum access` path prints a warning in its own
     * command output, but `registerForumAccount` prints only "Successfully
     * registered" — while the player's IP is logged and faction rep drops.
     * This was the only signal, and it was dropped.
     */
    this.on("security:warning", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "game",
        title: "⚠ SECURITY ALERT",
        message: data.message || "Your activity has been logged.",
        priority: data.severity === "critical" ? "critical" : "high",
        data,
      });
    });

    /**
     * Faction standing moved. Every rep change flows through here, including
     * the cross-faction rivalry spillover — hacking one faction quietly helps
     * its rival — which was entirely invisible before.
     */
    this.on("reputation:changed", async (data: any) => {
      const ns = await getNotifService();
      const amount = Number(data.amount) || 0;
      if (amount === 0) return;
      ns?.add({
        type: "game",
        title: `${data.factionName ?? "Faction"} ${amount > 0 ? "+" : ""}${amount} rep`,
        message: data.reason || "Your standing has changed.",
        priority: "normal",
        data,
      });
    });

    /**
     * Content was auto-moderated. The author's own command still returns
     * success, so without this their post simply vanishes on next refresh with
     * no explanation — and the reason is right here in the payload.
     */
    this.on("moderation:flagged", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "system",
        title: "Content hidden by moderation",
        message: data.reason || "Your content was flagged by content policy.",
        priority: "high",
        data,
      });
    });

    /**
     * Kicked or banned. The server sends the admin's reason and then closes
     * the socket; the `disconnect` handler returns early on
     * "io server disconnect" without surfacing anything, so the player was
     * left with a frozen interface and no explanation.
     */
    this.on("force:disconnect", (data: any) => {
      socketError.set(
        data?.reason
          ? `Disconnected by an administrator: ${data.reason}`
          : "You have been disconnected by an administrator.",
      );
    });

    /** Socket cap reached — same silent-freeze path as force:disconnect. */
    this.on("connection:refused", (data: any) => {
      socketError.set(
        data?.reason || "Connection refused — too many open sessions.",
      );
    });

    /**
     * A terminal tab operation failed. `terminalTabs.ts` waits with
     * `socket.once("terminal:created"|...)` and no error listener or timeout,
     * so a failed create/close/switch left the click looking ignored forever.
     */
    this.on("terminal:error", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "system",
        title: "Terminal operation failed",
        message: data?.error || "The terminal action could not be completed.",
        priority: "high",
        data,
      });
    });

    // `ack` is how the REPLAY path knows a notification actually landed.
    //
    // Socket.IO appends the acknowledgement callback as the last argument when
    // the server emits with one. The server marks a replayed row read ONLY
    // when this fires, because `socket.emit` alone proves nothing was
    // delivered — it used to mark them read immediately and a client on a
    // half-dead socket lost the backlog permanently. Calling it AFTER `ns.add`
    // means we are confirming the notification is in the store, not merely
    // that a frame arrived.
    this.on("notification", async (data: any, ack?: () => void) => {
      // Generic server notification (used by bounty system, IDS, etc.)
      const ns = await getNotifService();
      if (ns) {
        // The server now sends a real `priority` (utils/notify.ts maps the
        // legacy `severity` onto it once, server-side). Deriving it here a
        // second time discarded it: everything that was not exactly
        // "critical" — rewards, item drops, ordinary alerts — became "high"
        // and played a sound. Prefer the server's value; keep the severity
        // mapping only as the fallback for any emitter still bypassing
        // notifyUser.
        const priority =
          data.priority ??
          (data.severity === "critical" ? "critical" : "high");

        ns.add(
          {
            // The client `type` is a SOURCE taxonomy, so a security alert
            // belongs under "system", not "game".
            type: data.category === "security" ? "system" : "game",
            title: data.title || "Alert",
            message: data.message || data.description || "Server notification",
            priority,
            data,
          },
          {
            // Replayed rows carry their original time and must not each
            // fire a sound.
            id: typeof data.id === "string" ? data.id : undefined,
            timestamp: data.timestamp ? new Date(data.timestamp) : undefined,
            silent: data.replayed === true,
          },
        );
        ack?.();
      }
    });

    // ==================== ORPHANED EVENTS, WIRED 2026-09-25 ====================
    //
    // Each of these was emitted by the server with no listener on this side.
    // They are the payoff of systems that already work: territory changing
    // hands, an alarm the attacker tripped, and a plot lead the game composed
    // and then discarded.

    // #8 — the payoff of the whole contest system produced no on-screen event.
    this.on("faction:contest_started", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "game",
        title: "Territory Contested",
        message:
          `${data?.attackingFaction ?? "A faction"} is contesting ` +
          `${data?.serverName ?? "a server"}` +
          (data?.defendingFaction ? ` (held by ${data.defendingFaction})` : ""),
        priority: "high",
        data,
      });
    });

    this.on("faction:contest_resolved", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "game",
        title: "Territory Resolved",
        message: `${data?.winnerName ?? "Someone"} now holds ${data?.serverName ?? "a server"}`,
        priority: "high",
        data,
      });
    });

    // #19 — the ATTACKER branch had no client equivalent, so a trace could
    // begin with nothing on screen. Both branches route here; the payload
    // names the server either way.
    this.on("server:alert", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "system",
        title: "Security Alert",
        message: data?.message || `Alert on ${data?.serverName ?? "a server"}`,
        priority: data?.severity === "HIGH" || data?.severity === "critical" ? "critical" : "high",
        data,
      });
    });

    // #20 — this tells you WHO holds the fragment you need. It was composed,
    // addressed correctly, and dropped.
    this.on("story:fragment-intel", async (data: any) => {
      const ns = await getNotifService();
      ns?.add({
        type: "game",
        title: "Fragment Traced",
        message: data?.message || "Intel recovered on a fragment's holder.",
        priority: "high",
        data,
      });
    });

    // ==================== AUTHORITATIVE STATE ====================
    //
    // Both of these were emitted by the server with NO listener on this side
    // (orphan audit 2026-09-25), so the full-state batch the server computes
    // on every authenticate was discarded and the client fell back to REST
    // endpoints that are not mounted.

    this.on("state:update", (data: any) => {
      if (data?.fullState) playerState.set(data.fullState);
    });

    this.on("state:delta", (data: any) => {
      const delta = data?.delta;
      if (!delta) return;
      let missed = false;
      playerState.update((current) => {
        const { next, applied } = applyStateDelta(current, delta);
        if (!applied) missed = true;
        return next;
      });
      // A delta that cannot be applied means this client's view has drifted
      // from the server's. Silently dropping it is how a UI goes stale and
      // looks like a server bug, so ask for a full state instead.
      if (missed) this.requestStateResync();
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

  }

  // ==================== RECONNECTION LOGIC ====================

  private handleReconnect(): void {
    this.reconnectAttempts++;

    // Tell the player after a while, but KEEP TRYING — the network coming
    // back is the common case and it should just work when it does.
    if (this.reconnectAttempts === this.warnAfterAttempts) {
      socketError.set("Connection lost — still trying to reconnect…");
    }

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay,
    );

    console.log(
      `🔌 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    setTimeout(() => {
      if (this.socket?.connected) return;

      this.connect();

      // R13 REVIEW: keep the chain alive when `connect()` no-ops.
      //
      // `connect()` returns early if `apiClient.getToken()` is null — a real
      // state while a token refresh is failing. No socket is created, so
      // neither `connect_error` nor `disconnect` fires, so nothing re-arms
      // this loop and the client stays disconnected FOREVER. That was masked
      // while socket.io's built-in reconnection was also running; turning it
      // off (to stop the duplicate loop) made this the only retry path, so it
      // has to be self-sustaining. The attempt ceiling still bounds it.
      if (!this.socket) {
        this.handleReconnect();
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

  // REMOVED 2026-10-06: `emitJoinRoom` / `emitLeaveRoom`. They sent
  // `join:room` / `leave:room`, which the server has never had a handler for,
  // and both methods had ZERO callers in the client. Rooms are joined
  // server-side on authenticate and on forum registration, which is the only
  // place that can decide whether a player is entitled to a room — letting a
  // client ask to join one by name would be the bug, not the feature.

  // ==================== UTILITY METHODS ====================

  public isConnected(): boolean {
    return this.socket?.connected || false;
  }

  /** Typed access to the underlying Socket.IO instance (avoids `as any` casts). */
  public getSocket(): Socket | null {
    return this.socket;
  }

  private getCurrentUserId(): string | null {
    return this.userId;
  }

  /** Called by auth success handler to set the current user's ID for hack alerts. */
  public setUserId(id: string | null): void {
    this.userId = id;
  }

  /** Last resync request, so a burst of bad deltas cannot hammer the server. */
  private lastResyncAt = 0;


  /**
   * Ask the server for a full state.
   *
   * Throttled deliberately: an unappliable delta usually means a path the two
   * sides disagree about, which would repeat for EVERY subsequent delta. One
   * resync fixes the view; the rest would be a self-inflicted request storm.
   */
  private requestStateResync(): void {
    const now = Date.now();
    if (now - this.lastResyncAt < 5000) return;
    this.lastResyncAt = now;
    this.socket?.emit("state:request");
  }

  /**
   * ORPHAN AUDIT 2026-09-24: this was an EMPTY METHOD with 12 call sites.
   *
   * The comment said in-terminal toasts handle notifications "via
   * notificationService.add()" — true of the five story handlers, which call
   * both. The other seven called ONLY this, so new mail, forum replies, a
   * newly assigned mission and a server discovery announced themselves to a
   * no-op. Bug shape #4: a method whose name promises the right thing and
   * whose body does nothing, with no compiler or runtime complaint.
   *
   * Now routed to the toast service it always claimed to defer to.
   *
   * The redundant calls at sites that ALSO `ns.add` were removed so nothing
   * double-notifies — five `story:*` handlers in that change, and
   * `server:discovered`, which the first sweep missed and a code review
   * caught. Counted rather than asserted this time: `showNotification` has
   * seven remaining call sites and none of them is followed by an `ns.add`
   * for the same event.
   */
  private async showNotification(
    title: string,
    message: string,
    priority: "low" | "normal" | "high" | "critical" = "normal",
  ): Promise<void> {
    const ns = await getNotifService();
    ns?.add({ type: "system", title, message, priority });
  }

  /**
   * A world event, from either the targeted or the global channel.
   *
   * Accepts BOTH payload shapes the codebase produces: eventService's
   * {title, description} and keyFragmentService's {message}. The two used to
   * be handled by two separate listeners on the same event name, each blind
   * to the other's shape.
   */
  private surfaceWorldEvent(data: any): void {
    const message = data?.description || data?.message;
    if (!message) return;
    void this.showNotification(
      data.title || "World Event",
      message,
      data.severity === "critical" ? "critical" : data.severity === "warning" ? "high" : "normal",
    );
  }

  private handleHackResult(result: any): void {
    // Check for next layer BEFORE clearing the session
    if (result.nextChallenge) {
      activeHackSession.update(session => {
        if (!session) return session;
        return {
          ...session,
          currentLayer: (session.currentLayer || 0) + 1,
          challenge: result.nextChallenge,
        };
      });
      return; // Still hacking — don't clear
    }

    // Terminal status with no next challenge: clear everything
    if (result.status === "completed" || result.status === "failed" || result.status === "expired") {
      activeHackSession.set(null);
      activeProcesses.update(procs => procs.filter((p: any) => p.pid !== ReservedPID.HACK_CHALLENGE));

      if (result.status === "completed" && result.success) {
        sound.hackSuccess();
      }
    }
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
