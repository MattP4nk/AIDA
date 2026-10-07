import { Server as SocketIOServer, Socket } from "socket.io";
import logger from "../logger";
import { verifySocketToken } from "../middleware/auth";
import { getService } from "../di/container";
import {
  GAME_STATE_MANAGER,
  PROGRESS_SERVICE,
  COMMAND_PROCESSOR,
  PLAYER_PRESENCE_SERVICE,
  FORUM_SERVICE,
  MESSAGE_SERVICE,
  TUTORIAL_SERVICE,
} from "../di/tokens";

import type GameStateManager from "../services/gameStateManager";
import type ProgressService from "../services/progressService";
import type CommandProcessor from "../services/commandProcessor";
import type PlayerPresenceService from "../services/playerPresenceService";
import type MessageService from "../services/messageService";
import type ForumService from "../services/forumService";
import { validateCommandInput, validateCommandArgs, sanitizeSocketInput, validateMessageInput } from "../utils/inputValidation";

/**
 * Socket handler context — resolved once from DI, shared across all connections.
 */
interface SocketServices {
  gameStateManager: GameStateManager;
  progressService: ProgressService;
  commandProcessor: CommandProcessor;
  presenceService: PlayerPresenceService;
  messageService: MessageService;
  forumService: ForumService;
}

function resolveServices(): SocketServices {
  return {
    gameStateManager: getService<GameStateManager>(GAME_STATE_MANAGER),
    progressService: getService<ProgressService>(PROGRESS_SERVICE),
    commandProcessor: getService<CommandProcessor>(COMMAND_PROCESSOR),
    presenceService: getService<PlayerPresenceService>(PLAYER_PRESENCE_SERVICE),
    messageService: getService<MessageService>(MESSAGE_SERVICE),
    forumService: getService<ForumService>(FORUM_SERVICE),
  };
}

/**
 * Helper: extract userId from socket, emit error if missing.
 * Returns null when userId is absent so the caller can `return`.
 */
function getUserId(socket: Socket, errorEvent?: string): string | null {
  const userId = socket.data.user?.id;
  if (!userId && errorEvent) {
    socket.emit(errorEvent, { success: false, error: "Not authenticated" });
  }
  return userId ?? null;
}

const ROLE_HIERARCHY: Record<string, number> = {
  player: 0,
  moderator: 1,
  admin: 2,
};

/**
 * Check if a socket's user has at least the given role.
 */
export function hasSocketRole(socket: Socket, minimumRole: string): boolean {
  const userRole = socket.data.user?.role ?? "player";
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minimumRole] ?? 0);
}

/**
 * Sliding-window rate limiter.
 * Returns true if the event should be allowed, false if rate-limited.
 */
function createSocketRateLimiter(maxEvents: number, windowMs: number) {
  const timestamps: number[] = [];

  return function isAllowed(): boolean {
    const now = Date.now();
    // Remove timestamps outside the window
    while (timestamps.length > 0 && timestamps[0]! <= now - windowMs) {
      timestamps.shift();
    }
    if (timestamps.length >= maxEvents) {
      return false;
    }
    timestamps.push(now);
    return true;
  };
}

// ═══════════════════════════════════════════════════════════════════
// S9 — per-USER limits and connection caps
// ═══════════════════════════════════════════════════════════════════
//
// The limiters used to be closures created inside `io.on("connection")`, i.e.
// per SOCKET. Opening a second socket on the same account bought a second full
// allowance, so every published limit was really "N x however many sockets you
// care to open" — and nothing capped how many that was. Keying them by user,
// and capping concurrent sockets, is what makes the numbers mean anything.

/** Per-user event budgets, shared across all of that user's sockets. */
interface UserLimiters {
  command: () => boolean;
  message: () => boolean;
  terminal: () => boolean;
  general: () => boolean;
  /**
   * Authentication gets its OWN budget, spent by nothing else.
   *
   * This is the whole point. Charging `authenticated` to the shared `general`
   * budget meant typing indicators could starve login — a player who typed a
   * long mail and then reconnected got a live socket that never ran
   * handleAuthentication. With a dedicated budget, hitting the limit can only
   * mean the client is genuinely looping, so refusing is safe.
   */
  auth: () => boolean;
  /**
   * When this budget was last consulted — drives the idle sweep below.
   *
   * Only meaningful because every consultation goes through `limitersFor`.
   * If a caller captured these functions instead, this would record the last
   * CONNECTION rather than the last use, and the sweep would discard budgets
   * out from under players who are actively spending them.
   */
  lastUsed: number;
}

/**
 * The longest limiter window (10s). An entry untouched for longer than this
 * has an empty sliding window by definition, so discarding it is a no-op —
 * which is what makes the sweep safe.
 */
/**
 * How long a replayed notification may go unacknowledged before it is left
 * pending. Generous on purpose: the client's notification service is a dynamic
 * import, so a cold tab legitimately takes a moment, and the cost of waiting is
 * one more replay next connect while the cost of giving up early is a silently
 * destroyed security alert.
 */
const NOTIFICATION_ACK_TIMEOUT_MS = 10_000;

const LIMITER_WINDOW_MS = 10_000;
/** Ample margin over the window; the sweep is about memory, not precision. */
const LIMITER_IDLE_MS = 60_000;

const userLimiters = new Map<string, UserLimiters>();
/** userId -> that user's live socket ids. */
const userSockets = new Map<string, Set<string>>();
/** client IP -> live socket ids, so one host cannot open unbounded sockets. */
const ipSockets = new Map<string, Set<string>>();

/** Most players use one tab; a few use two. Beyond this is abuse, not use. */
const MAX_SOCKETS_PER_USER = 4;
/** Generous enough for a shared NAT / household, tight enough to bound a flood. */
const MAX_SOCKETS_PER_IP = 12;

function limitersFor(userId: string): UserLimiters {
  let limiters = userLimiters.get(userId);
  if (!limiters) {
    limiters = {
      command: createSocketRateLimiter(20, LIMITER_WINDOW_MS), // 20 commands per 10s
      message: createSocketRateLimiter(10, LIMITER_WINDOW_MS), // 10 messages per 10s
      terminal: createSocketRateLimiter(10, LIMITER_WINDOW_MS), // 10 terminal ops per 10s
      general: createSocketRateLimiter(30, LIMITER_WINDOW_MS), // 30 events per 10s
      // 30 per 10s — sized from what the client ACTUALLY does, which is two
      // authentications per connection, not one: `socket.ts` emits
      // `authenticated` on every `connect`, and `App.svelte` then emits
      // `authenticate:request` on the same socket. With
      // MAX_SOCKETS_PER_USER = 4 a simultaneous reload of every tab is 8, so
      // the first draft of this at 5 would have refused legitimate logins.
      //
      // The job here is to stop a LOOP, and a loop emits hundreds a second.
      // 30/10s leaves ~15 page loads of headroom while still cutting an
      // attacker to 3/s — which is what matters, because each one ends in a
      // `socket.broadcast.emit` to every connected client.
      auth: createSocketRateLimiter(30, LIMITER_WINDOW_MS),
      lastUsed: Date.now(),
    };
    userLimiters.set(userId, limiters);
  }
  limiters.lastUsed = Date.now();
  return limiters;
}

/**
 * Drop budgets nobody has touched for a while.
 *
 * The first version of this released a user's limiters the moment their last
 * socket closed. That bounded the map, but it also handed the budget back on
 * every reconnect: spend all 20 commands, disconnect, reconnect, and
 * `limitersFor` built a fresh window. The published "20 per 10s" became "20
 * per handshake", and `MAX_SOCKETS_PER_USER` did not bound it, because the
 * reset fired exactly when the socket count hit zero. S9 would have traded
 * "N x sockets you open" for "N x reconnects you make".
 *
 * Expiring on IDLE instead of on disconnect keeps the budget across a
 * reconnect while still bounding the map by concurrent activity rather than
 * by lifetime player count.
 */
const limiterSweep = setInterval(() => {
  const cutoff = Date.now() - LIMITER_IDLE_MS;
  for (const [userId, limiters] of userLimiters) {
    if (limiters.lastUsed < cutoff) userLimiters.delete(userId);
  }
}, LIMITER_IDLE_MS);
limiterSweep.unref?.();

function addToIndex(map: Map<string, Set<string>>, key: string, socketId: string): number {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(socketId);
  return set.size;
}

function removeFromIndex(map: Map<string, Set<string>>, key: string, socketId: string): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(socketId);
  // Drop the key when it drains, so these maps cannot grow with lifetime player
  // count the way memoryService's per-user maps do.
  if (set.size === 0) map.delete(key);
}

/**
 * The client's address, honouring `X-Forwarded-For` ONLY as far as TRUST_PROXY
 * says to.
 *
 * The first version of this read the header unconditionally — and Socket.IO,
 * unlike Express, does not consult `app.set("trust proxy")` at all; that only
 * affects `req.ip` on HTTP requests. So on a directly-exposed server (the
 * documented default, TRUST_PROXY unset) any client could send
 * `X-Forwarded-For: <anything>` in the handshake and mint a fresh per-IP
 * bucket per value, defeating the per-IP cap completely. The O5 comment in
 * `middleware/setup.ts` warns about exactly this hazard; this function was it.
 *
 * Mirrors Express's model: the chain is [...forwarded, socketAddress] and the
 * trusted client is `hops` entries from the right. With TRUST_PROXY unset the
 * header is ignored entirely and only the real peer address counts.
 */
function clientIp(socket: Socket): string {
  const direct = socket.handshake.address || "unknown";

  const configured = Number(process.env.TRUST_PROXY);
  const hops = Number.isInteger(configured) && configured > 0 ? configured : 0;
  if (hops === 0) return direct;

  const raw = socket.handshake.headers["x-forwarded-for"];
  const forwarded = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (forwarded.length === 0) return direct;

  const chain = [...forwarded, direct];
  const index = Math.max(0, chain.length - 1 - hops);
  return chain[index] ?? direct;
}

/**
 * S3 — force every live socket for a user to close, server-side.
 *
 * Exported because the ban/kick path needs it: emitting `force:disconnect` and
 * trusting the client to hang up is not enforcement, it is a suggestion. A
 * modified or simply old client keeps its socket and carries on.
 */
export function disconnectUserSockets(io: SocketIOServer, userId: string): number {
  const ids = userSockets.get(userId);
  if (!ids || ids.size === 0) return 0;
  const count = ids.size;
  // Snapshot: disconnecting mutates the set through the disconnect handler.
  for (const socketId of [...ids]) {
    io.sockets.sockets.get(socketId)?.disconnect(true);
  }
  return count;
}

/**
 * Set up all Socket.IO event handlers.
 * Called once during server initialization after the DI container is ready.
 */
export function setupSocketHandlers(io: SocketIOServer): void {
  const services = resolveServices();

  // ── S9: authenticate at CONNECTION time, and close what fails ──────────
  //
  // Authentication used to be `socket.use()`, which runs per PACKET: an
  // unauthenticated socket completed the handshake and stayed connected
  // indefinitely, merely having its packets rejected. It held a file
  // descriptor, counted against nothing, and could sit there forever.
  // `io.use()` runs during the handshake, so a socket with no valid token is
  // never established at all.
  //
  // This also means `socket.data.user` exists from the first event, which is
  // what lets the rate limits below be keyed by USER rather than by socket.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No authentication token provided"));

      const user = await verifySocketToken(token);
      if (!user) return next(new Error("Invalid authentication token"));

      socket.data.user = user;
      return next();
    } catch (err) {
      logger.warn({ err }, "Socket handshake authentication failed");
      return next(new Error("Authentication failed"));
    }
  });

  io.on("connection", (socket) => {
    const userId: string | undefined = socket.data.user?.id;
    const ip = clientIp(socket);

    // `io.use` guarantees this, but a future middleware change must not
    // silently turn the caps below into no-ops.
    if (!userId) {
      logger.error({ socketId: socket.id }, "Authenticated socket with no user id — closing");
      socket.disconnect(true);
      return;
    }

    // ── S9: concurrency caps ───────────────────────────────────────────
    const perUser = addToIndex(userSockets, userId, socket.id);
    const perIp = addToIndex(ipSockets, ip, socket.id);

    if (perUser > MAX_SOCKETS_PER_USER || perIp > MAX_SOCKETS_PER_IP) {
      logger.warn(
        { userId, ip, perUser, perIp },
        "Socket connection refused — concurrency cap reached",
      );
      socket.emit("connection:refused", {
        reason:
          perUser > MAX_SOCKETS_PER_USER
            ? "Too many open sessions for this account."
            : "Too many open sessions from this address.",
      });
      removeFromIndex(userSockets, userId, socket.id);
      removeFromIndex(ipSockets, ip, socket.id);
      socket.disconnect(true);
      return;
    }

    logger.info({ socketId: socket.id, userId, perUser }, "User connected");

    // Rate limiters are shared across ALL of this user's sockets (S9), and are
    // RESOLVED PER EVENT rather than captured once.
    //
    // Capturing them here looks equivalent and is not. The idle sweep deletes a
    // user's map entry after LIMITER_IDLE_MS, but a captured closure keeps
    // working after its entry is gone — so a player active in one tab for a
    // minute had their entry swept while tab 1 kept spending the old budget,
    // and opening tab 2 built a second, independent one. That is exactly the
    // "N x however many sockets you care to open" multiplication S9 exists to
    // prevent, reintroduced through the sweep.
    //
    // Going through the map on every event also means `lastUsed` is stamped by
    // USE. It was previously written only by `limitersFor`, which ran once per
    // connection, so the sweep's own safety argument — "an entry untouched for
    // longer than the window has an empty sliding window by definition" — was
    // false for any actively-playing user.
    const limit = (kind: Exclude<keyof UserLimiters, "lastUsed">): boolean =>
      limitersFor(userId)[kind]();
    const commandRateLimit = () => limit("command");
    const messageRateLimit = () => limit("message");
    const terminalRateLimit = () => limit("terminal");
    const generalRateLimit = () => limit("general");
    const authRateLimit = () => limit("auth");

    // Kept as defence in depth. `io.use` already authenticated this socket, so
    // this now short-circuits on the first packet rather than doing work.
    setupAuthMiddleware(socket);

    // ── Authentication events ────────────────────────────────────
    //
    // Limited on a DEDICATED budget. This is the expensive handler on the
    // socket — session create, room joins, a five-query state broadcast, the
    // notification replay, a tutorial check — and it ends in a
    // `socket.broadcast.emit` to every connected client, so an unbounded loop
    // here is a self-amplifying fan-out, not just local load.
    //
    // Charging it to `generalRateLimit` was the wrong fix and was reverted:
    // that budget is shared with typing indicators, so ordinary play could
    // exhaust it and the next reconnect produced a live socket in no rooms
    // with no state. `authRateLimit` is spent by nothing else, so reaching it
    // means the client is looping, and refusing is both safe and correct.
    //
    // ANSWER THE ACK when refusing. Returning silently leaves the client with
    // a promise Socket.IO never settles — it only retries on the next
    // `connect` — so a refusal has to be a refusal the client can see.
    const refuseAuth = (cb: unknown) => {
      if (typeof cb === "function") {
        (cb as (r: unknown) => void)({
          success: false,
          error: "Too many authentication attempts. Reconnect in a moment.",
        });
      }
    };
    socket.on("authenticated", (cb) => {
      if (!authRateLimit()) return refuseAuth(cb);
      handleAuthentication(socket, io, services, cb);
    });
    socket.on("authenticate:request", (cb) => {
      if (!authRateLimit()) return refuseAuth(cb);
      handleAuthentication(socket, io, services, cb);
    });

    // ── Game events ──────────────────────────────────────────────
    socket.on("server:connect", (data) => {
      if (!generalRateLimit()) return;
      handleServerConnect(socket, services, data);
    });
    socket.on("server:disconnect", (data) => {
      if (!generalRateLimit()) return;
      handleServerDisconnect(socket, services, data);
    });

    // ── Command execution (unified with REST validation) ─────────
    socket.on("command:execute", (data) => {
      if (!commandRateLimit()) {
        socket.emit("command:error", {
          success: false,
          error: "Rate limit exceeded. Slow down.",
        });
        return;
      }
      handleCommandExecute(socket, io, services, data);
    });

    // ── Messaging ────────────────────────────────────────────────
    socket.on("message:send", (data) => {
      if (!messageRateLimit()) {
        socket.emit("message:result", {
          success: false,
          error: "Rate limit exceeded.",
        });
        return;
      }
      handleMessageSend(socket, services, data);
    });

    // ── Hack (redirect to command:execute) ───────────────────────
    socket.on("hack:attempt", () => {
      socket.emit("hack:result", {
        success: false,
        error: "Use command:execute with hack commands instead",
      });
    });

    // ── Authoritative state resync ───────────────────────────────
    //
    // The client asks for this when it receives a `state:delta` it cannot
    // apply, which means the two sides disagree about a path. Rate-limited on
    // BOTH ends — the client throttles to one request per 5s, and this uses
    // the general limiter — because the trigger condition can repeat for every
    // subsequent delta and would otherwise be a self-inflicted request storm.
    socket.on("state:request", () => {
      if (!generalRateLimit()) return;
      const userId = getUserId(socket);
      if (!userId) return;
      void services.gameStateManager.broadcastStateUpdate(userId);
    });

    // ── Terminal tab management ──────────────────────────────────
    socket.on("terminal:create", (data) => {
      if (!terminalRateLimit()) return;
      handleTerminal(socket, io, services.gameStateManager, "create", data);
    });
    socket.on("terminal:close", (data) => {
      if (!terminalRateLimit()) return;
      handleTerminal(socket, io, services.gameStateManager, "close", data);
    });
    socket.on("terminal:switch", (data) => {
      if (!terminalRateLimit()) return;
      handleTerminal(socket, io, services.gameStateManager, "switch", data);
    });
    socket.on("terminal:list", () => {
      if (!terminalRateLimit()) return;
      handleTerminal(socket, io, services.gameStateManager, "list", {});
    });

    // ── Typing Indicators ────────────────────────────────────────
    socket.on("typing:start", (data: { recipientId: string }) => {
      if (!generalRateLimit()) return;
      const userId = getUserId(socket);
      if (!userId || !data?.recipientId) return;
      io.to(`user:${data.recipientId}`).emit("typing:start", {
        userId,
        username: socket.data?.user?.username || "Unknown",
      });
    });

    socket.on("typing:stop", (data: { recipientId: string }) => {
      if (!generalRateLimit()) return;
      const userId = getUserId(socket);
      if (!userId || !data?.recipientId) return;
      io.to(`user:${data.recipientId}`).emit("typing:stop", {
        userId,
      });
    });

    // ── Disconnection ────────────────────────────────────────────
    socket.on("disconnect", () => {
      // S9: drop the socket from both indexes. The limiter is NOT released
      // here — see `limiterSweep` for why releasing it on disconnect handed
      // the user a fresh budget on every reconnect.
      removeFromIndex(userSockets, userId, socket.id);
      removeFromIndex(ipSockets, ip, socket.id);
      // `removeFromIndex` deletes the key when the set empties, so this is
      // "was that the user's last socket?".
      const isLastSocket = !userSockets.has(userId);

      // R6: unbind this socket. If it was the one the session was bound to
      // and the user still has others, hand the binding to a survivor —
      // otherwise the session would keep naming a closed socket.
      //
      // REVIEW FIX: the survivor must be a socket that has AUTHENTICATED, not
      // merely one that has connected. `userSockets` is populated at
      // connection time (handshake auth), while `user:<id>` is joined only in
      // `handleAuthentication`. Handing the binding to a connected-but-
      // unauthenticated socket left the session pointing at a socket in no
      // room, so `socketsJoin`/`socketsLeave` over `user:<id>` matched nothing
      // and the player silently stopped receiving their server's broadcasts.
      // Room membership is the source of truth for "has authenticated".
      const authedRoom = io.sockets.adapter.rooms.get(`user:${userId}`);
      const survivor = [...(userSockets.get(userId) ?? [])].find(
        (id) => id !== socket.id && authedRoom?.has(id),
      );
      services.gameStateManager.detachSocket(userId, socket.id, survivor);

      handleDisconnect(socket, services, isLastSocket);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
// Individual handler implementations
// ═══════════════════════════════════════════════════════════════════

function setupAuthMiddleware(socket: Socket): void {
  socket.use(async (_packet, next) => {
    // Skip re-verification if already authenticated
    if (socket.data.user) {
      return next();
    }

    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error("No authentication token provided"));
      }

      const user = await verifySocketToken(token);
      if (!user) {
        return next(new Error("Invalid authentication token"));
      }

      socket.data.user = user;
      next();
    } catch {
      next(new Error("Authentication failed"));
    }
  });
}

/**
 * Unified authentication handler — replaces both "authenticated" and "authenticate:request".
 * Uses callback (ack) pattern when available, falls back to event emission.
 */
async function handleAuthentication(
  socket: Socket,
  _io: SocketIOServer,
  { gameStateManager, presenceService, progressService, forumService }: SocketServices,
  callback?: unknown,
): Promise<void> {
  const userId = socket.data.user?.id;
  const username = socket.data.user?.username;

  /**
   * Answer the caller's acknowledgement.
   *
   * The three sites below used to fall back to
   * `socket.emit("authentication:complete", …)` when no ack was passed — an
   * event NOTHING has ever listened for, on either the client or in any
   * harness. So a caller without an ack received nothing either way; the
   * fallback only made it look handled. Every real emitter passes one (the
   * client at `socket.ts` and `App.svelte`, plus ten harnesses), so this path
   * is unreachable today — and if it ever is reached, a log line is strictly
   * more useful than a message with no recipient.
   */
  const respond = (payload: { success: boolean; userId?: string; username?: string; error?: string }) => {
    if (typeof callback === "function") {
      callback(payload);
      return;
    }
    logger.warn(
      { socketId: socket.id },
      "authenticate called without an acknowledgement — response dropped",
    );
  };

  if (!userId) {
    const error = "No user ID found";
    respond({ success: false, error });
    return;
  }

  try {
    // Join user-specific room
    socket.join(`user:${userId}`);
    socket.join(`player:${userId}`);

    // Forum rooms. `forum:new-post` / `forum:new-reply` are emitted to
    // `forum:<forumId>` and NOTHING HAS EVER JOINED THAT ROOM — the audit's
    // subtlest find, because a name-comparison audit scores those events
    // healthy: the server emits them and the client listens for them. An event
    // is only wired if the listener is in the room it is sent to.
    try {
      // The rule lives in forumService, not here. This used to query
      // `forumMember` directly and join every row — including memberships that
      // had been BANNED, since `banMember` leaves the row in place and only
      // flips a flag that the posting paths check and this one did not.
      const forumIds = await forumService.getLiveFeedForums(userId);
      for (const forumId of forumIds) socket.join(`forum:${forumId}`);
      if (forumIds.length > 0) {
        logger.debug({ userId, forums: forumIds.length }, "Joined forum rooms");
      }
    } catch (err) {
      logger.warn({ err, userId }, "Could not join forum rooms");
    }

    // Create or reuse session
    const existingSession = gameStateManager.getSession(userId);
    if (!existingSession) {
      await gameStateManager.createSession(
        userId,
        socket.id,
        socket.handshake.address,
      );
    }

    // R6: bind THIS socket to the session, and put it back in the room for
    // whatever server the player is on.
    //
    // The reuse path above did neither. A second tab — or a reconnect that
    // found the session still alive — left `session.socketId` naming the old
    // socket, never registered in `activeConnections`, and never rejoined
    // `server:<currentServerId>`. The player was on a server as far as the
    // session was concerned, while receiving none of that server's
    // broadcasts.
    const session = gameStateManager.attachSocket(userId, socket.id);
    if (session?.currentServerId) {
      socket.join(`server:${session.currentServerId}`);
    }

    // Mark player as online
    await presenceService.playerConnected(userId, socket.id);

    // Queue initial save
    progressService.queueSave(userId, "login");

    // Broadcast full game state to client
    await gameStateManager.broadcastStateUpdate(userId);

    // Replay notifications the player has not seen.
    //
    // ORPHAN AUDIT 2026-09-24: the `Notification` model was fully specced and
    // never written OR read, while the client store is in-memory — so a
    // refresh silently discarded every unseen alert, security warnings
    // included. Persisting without this replay would have moved the dead
    // feature rather than fixed it.
    try {
      const { getPendingNotifications, markNotificationsRead } = await import("../utils/notify");
      const pending = await getPendingNotifications(userId);
      if (pending.length > 0) {
        // OLDEST FIRST. `getPendingNotifications` orders newest-first, and the
        // client PREPENDS each arrival, so emitting in query order rendered the
        // backlog upside down — and at the 50-item cap the newest alerts were
        // the ones pushed off the end, then marked read and never replayed.
        const ordered = [...pending].reverse();

        // ACKNOWLEDGED, not fire-and-forget.
        //
        // The previous version marked these read straight after `socket.emit`,
        // justified by "if the emit throws, they stay pending". `socket.emit`
        // does NOT throw and does not report delivery, so that guard could
        // never fire: a client on a half-dead socket, or one still resolving
        // its notification module's dynamic import, had up to 50 alerts
        // emitted into the void and immediately flipped to read. The rows
        // this feature exists to preserve were the ones it destroyed.
        //
        // Only what the client confirms is marked read. Anything unconfirmed
        // stays pending for the next connect — a duplicate is recoverable,
        // a silently dropped security alert is not.
        // NOT AWAITED, and each row settles on its own.
        //
        // The first version did `await Promise.all(...)` of 50 ten-second
        // timeouts INSIDE the auth path, ahead of the tutorial bootstrap, the
        // presence broadcast and the auth callback. A client that cannot ack —
        // the client only acks inside `if (ns)`, so a failed dynamic import
        // means never — stalled every login for the full timeout, forever,
        // because unacked rows stay pending by design. The replay's own
        // comment says it must never break authentication; awaiting it did.
        //
        // Marking read per-ack rather than in one batch also means a partial
        // delivery keeps exactly the undelivered rows pending.
        void Promise.all(
          ordered.map((n) =>
            new Promise<string | null>((resolve) => {
              socket
                .timeout(NOTIFICATION_ACK_TIMEOUT_MS)
                .emit(
                  "notification",
                  {
                    // ENVELOPE LAST, matching notify.ts. The first version
                    // spread `n.data` after these fields, so a persisted blob
                    // carrying `id`, `category`, `timestamp` or `priority`
                    // overwrote them — and storyProgressionService writes a
                    // `category` key into its metadata, so the collision is
                    // live, not hypothetical. A producer-supplied `id` would
                    // break the client's dedupe against the live emit.
                    ...((n.data as Record<string, unknown>) ?? {}),
                    id: n.id,
                    type: n.type,
                    title: n.title,
                    message: n.message,
                    priority: n.priority,
                    category: n.category,
                    timestamp: n.createdAt,
                    replayed: true,
                  },
                  (err: unknown) => resolve(err ? null : n.id),
                );
            }),
          ),
        ).then(async (delivered) => {
          const acked = delivered.filter((id): id is string => id !== null);
          if (acked.length > 0) await markNotificationsRead(userId, acked);
          if (acked.length < ordered.length) {
            logger.warn(
              { userId, sent: ordered.length, acked: acked.length },
              "Some replayed notifications were not acknowledged; they stay pending",
            );
          }
        }).catch((err) => {
          logger.warn({ err, userId }, "Notification replay settlement failed");
        });
      }
    } catch (err) {
      // Never let a replay failure break authentication.
      logger.warn({ err, userId }, "Notification replay failed");
    }

    // Check if new player needs tutorial
    try {
      const tutorialService =
        getService<import("../services/tutorialService").TutorialService>(
          TUTORIAL_SERVICE,
        );
      const needsTutorial = await tutorialService.shouldStartTutorial(userId);
      if (needsTutorial) {
        await tutorialService.startTutorial(userId);
      }
    } catch {
      // Tutorial service not critical — don't fail auth
    }

    // Notify others
    socket.broadcast.emit("user:status_change", {
      userId,
      isOnline: true,
      timestamp: new Date(),
    });

    // Respond
    respond({ success: true, userId, username });

    logger.info({ username }, "User authenticated and session ready");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error({ err: error }, "Authentication error");
    respond({ success: false, error: msg });
  }
}

async function handleServerConnect(
  socket: Socket,
  { gameStateManager, presenceService, progressService }: SocketServices,
  data: { serverId: string },
): Promise<void> {
  const userId = getUserId(socket);
  if (!userId) return;

  // S1: the gate lives in `connectPlayerToServer`, but its answer only means
  // something if this caller reads it. Ignoring the boolean let a refused
  // player be registered by `playerJoinedServer` anyway — which sets their
  // `currentServerId`, adds them to `playersByServer`, and broadcasts
  // `presence:player_joined_server` to everyone already there. The connection
  // was denied while the presence system announced it had happened.
  const connected = await gameStateManager.connectPlayerToServer(
    userId,
    data.serverId,
  );
  if (!connected) {
    socket.emit("server:connect_error", {
      success: false,
      serverId: data.serverId,
      error: "Connection refused.",
    });
    return;
  }

  await presenceService.playerJoinedServer(userId, data.serverId);
  progressService.saveOnEvent(userId, "server_connected");
}

async function handleServerDisconnect(
  socket: Socket,
  { gameStateManager, presenceService }: SocketServices,
  _data: unknown,
): Promise<void> {
  const userId = getUserId(socket);
  if (!userId) return;

  const session = gameStateManager.getPlayerSession(userId);
  const currentServerId = session?.currentServerId;

  await gameStateManager.disconnectPlayerFromServer(userId);

  if (currentServerId) {
    await presenceService.playerLeftServer(userId, currentServerId);
  }
}

/**
 * Command execution via socket — NOW uses the same parse → validate → execute
 * pipeline as the REST route, fixing the validation bypass.
 */
async function handleCommandExecute(
  socket: Socket,
  io: SocketIOServer,
  { commandProcessor }: SocketServices,
  data: {
    command: string;
    args?: string[];
    serverId?: string;
    terminalId?: string;
    terminalCols?: number;
  },
): Promise<void> {
  const userId = getUserId(socket, "command:error");
  if (!userId) return;

  try {
    const { command, args, serverId, terminalId, terminalCols } = data;

    // Validate command input (same rules as HTTP middleware)
    const sanitizedCommand = typeof command === "string" ? sanitizeSocketInput(command) : "";
    const validation = validateCommandInput(sanitizedCommand);
    if (!validation.valid) {
      socket.emit("command:error", {
        success: false,
        error: validation.reason || "Invalid command format",
      });
      return;
    }

    // Validate and sanitize args.
    // The socket path takes `args` pre-split, bypassing the length and
    // character checks the HTTP path applies to the whole command string.
    const argsValidation = validateCommandArgs(args);
    if (!argsValidation.valid) {
      socket.emit("command:error", {
        success: false,
        error: argsValidation.reason || "Invalid arguments",
      });
      return;
    }
    const sanitizedArgs = Array.isArray(args)
      ? args.filter((a): a is string => typeof a === "string").map(sanitizeSocketInput)
      : [];

    // Build full command string
    const commandString =
      sanitizedArgs.length > 0 ? `${sanitizedCommand} ${sanitizedArgs.join(" ")}` : sanitizedCommand;

    // Parse
    const parsed = commandProcessor.parseCommand(
      userId,
      commandString,
      serverId,
    );
    if (!parsed.isValid) {
      socket.emit("command:result", {
        success: false,
        output: parsed.error || "Invalid command",
        timestamp: new Date(),
      });
      return;
    }

    // Execute (executeCommand already calls validateCommand internally)
    const result = await commandProcessor.executeCommand(
      userId,
      parsed,
      serverId,
      terminalId,
      terminalCols ? Number(terminalCols) : undefined,
      socket.data.user?.role,
    );

    // Send result
    socket.emit("command:result", result);

    // Broadcast to user's room for multi-device sync
    io.to(`user:${userId}`).emit("command:executed", {
      command: parsed.command,
      args: parsed.args,
      result,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ err: error }, "Command execution error");
    socket.emit("command:error", {
      success: false,
      error: error instanceof Error ? error.message : "Command failed",
    });
  }
}

async function handleMessageSend(
  socket: Socket,
  { messageService }: SocketServices,
  messageData: {
    recipientId?: string;
    subject?: string;
    content?: string;
    isEncrypted?: boolean;
    encryptionLevel?: number;
  },
): Promise<void> {
  const senderId = getUserId(socket);
  if (!senderId) return;

  try {
    const { recipientId, subject, content, isEncrypted, encryptionLevel } =
      messageData;

    const msgValidation = validateMessageInput({ recipientId, subject, content });
    if (!msgValidation.valid) {
      socket.emit("message:result", {
        success: false,
        error: msgValidation.reason || "Invalid message data",
      });
      return;
    }

    // After validation, recipientId/subject/content are guaranteed to be strings
    const result = await messageService.sendPrivateMessage(
      senderId,
      recipientId!,
      {
        subject: subject!,
        content: content!,
        encrypt: isEncrypted || false,
        encryptionLevel: encryptionLevel || 0,
      },
    );

    socket.emit("message:result", result);
  } catch (error) {
    logger.error({ err: error }, "Error sending message via socket");
    socket.emit("message:result", {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send message",
    });
  }
}

/**
 * Unified terminal handler — one function for create/close/switch/list.
 * Eliminates the duplicated boilerplate from the original index.ts.
 */
async function handleTerminal(
  socket: Socket,
  io: SocketIOServer,
  gameStateManager: GameStateManager,
  action: "create" | "close" | "switch" | "list",
  data: { terminalId?: string; label?: string },
): Promise<void> {
  const userId = getUserId(socket, "terminal:error");
  if (!userId) return;

  try {
    switch (action) {
      case "create": {
        const terminal = gameStateManager.createTerminal(userId, data.label);
        if (terminal) {
          socket.emit("terminal:created", { success: true, ...terminal });
          io.to(`user:${userId}`).emit("terminal:created", {
            success: true,
            ...terminal,
          });
        } else {
          socket.emit("terminal:error", {
            success: false,
            error: "Failed to create terminal",
          });
        }
        break;
      }

      case "close": {
        const success = gameStateManager.closeTerminal(
          userId,
          data.terminalId!,
        );
        if (success) {
          socket.emit("terminal:closed", {
            success: true,
            terminalId: data.terminalId,
          });
          io.to(`user:${userId}`).emit("terminal:closed", {
            success: true,
            terminalId: data.terminalId,
          });
        } else {
          socket.emit("terminal:error", {
            success: false,
            error: "Failed to close terminal",
          });
        }
        break;
      }

      case "switch": {
        const success = gameStateManager.switchTerminal(
          userId,
          data.terminalId!,
        );
        if (success) {
          socket.emit("terminal:switched", {
            success: true,
            terminalId: data.terminalId,
          });
        } else {
          socket.emit("terminal:error", {
            success: false,
            error: "Failed to switch terminal",
          });
        }
        break;
      }

      case "list": {
        const session = gameStateManager.getPlayerSession(userId);
        if (session) {
          socket.emit("terminal:list", {
            success: true,
            terminals: session.terminals,
            activeTerminalId: session.activeTerminalId,
          });
        } else {
          socket.emit("terminal:error", {
            success: false,
            error: "No active session",
          });
        }
        break;
      }
    }
  } catch (error) {
    logger.error({ err: error, action }, "Terminal error");
    socket.emit("terminal:error", {
      success: false,
      error:
        error instanceof Error ? error.message : `Terminal ${action} failed`,
    });
  }
}

async function handleDisconnect(
  socket: Socket,
  { gameStateManager, presenceService, progressService }: SocketServices,
  isLastSocket: boolean,
): Promise<void> {
  const userId = socket.data.user?.id;

  // S9: tear the player down only when their LAST socket goes.
  //
  // This ran unconditionally, which was survivable when a second tab was an
  // edge case and fatal now that `MAX_SOCKETS_PER_USER` explicitly blesses
  // four. Closing one tab called `destroySession`, which nulls the current
  // server, clears command history and deletes the session — while the other
  // tabs' sockets stayed authenticated and hit `if (!session) return false`
  // on every command. It also told every other player `isOnline: false`
  // about someone who was still connected.
  if (userId && !isLastSocket) {
    logger.info(
      { userId, socketId: socket.id },
      "Socket disconnected; user still has other live sockets",
    );
    return;
  }

  if (userId) {
    try {
      await presenceService.playerDisconnected(userId);
      await progressService.savePlayerProgress(userId, "disconnect");
      await gameStateManager.destroySession(userId);

      socket.broadcast.emit("user:status_change", {
        userId,
        isOnline: false,
        timestamp: new Date(),
      });

      logger.info({ userId }, "User disconnected");
    } catch (error) {
      logger.error({ err: error }, "Error during disconnect");
    }
  }

  logger.info({ socketId: socket.id }, "Socket disconnected");
}
