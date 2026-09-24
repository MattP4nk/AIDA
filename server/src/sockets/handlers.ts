import { Server as SocketIOServer, Socket } from "socket.io";
import logger from "../logger";
import { verifySocketToken } from "../middleware/auth";
import { getService } from "../di/container";
import {
  GAME_STATE_MANAGER,
  PROGRESS_SERVICE,
  COMMAND_PROCESSOR,
  PLAYER_PRESENCE_SERVICE,
  MESSAGE_SERVICE,
  TUTORIAL_SERVICE,
} from "../di/tokens";

import type GameStateManager from "../services/gameStateManager";
import type ProgressService from "../services/progressService";
import type CommandProcessor from "../services/commandProcessor";
import type PlayerPresenceService from "../services/playerPresenceService";
import type MessageService from "../services/messageService";
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
}

function resolveServices(): SocketServices {
  return {
    gameStateManager: getService<GameStateManager>(GAME_STATE_MANAGER),
    progressService: getService<ProgressService>(PROGRESS_SERVICE),
    commandProcessor: getService<CommandProcessor>(COMMAND_PROCESSOR),
    presenceService: getService<PlayerPresenceService>(PLAYER_PRESENCE_SERVICE),
    messageService: getService<MessageService>(MESSAGE_SERVICE),
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
  /** When this budget was last consulted — drives the idle sweep below. */
  lastUsed: number;
}

/**
 * The longest limiter window (10s). An entry untouched for longer than this
 * has an empty sliding window by definition, so discarding it is a no-op —
 * which is what makes the sweep safe.
 */
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

    // Rate limiters are shared across ALL of this user's sockets (S9).
    const limiters = limitersFor(userId);
    const commandRateLimit = limiters.command;
    const messageRateLimit = limiters.message;
    const terminalRateLimit = limiters.terminal;
    const generalRateLimit = limiters.general;

    // Kept as defence in depth. `io.use` already authenticated this socket, so
    // this now short-circuits on the first packet rather than doing work.
    setupAuthMiddleware(socket);

    // ── Authentication events ────────────────────────────────────
    socket.on("authenticated", (cb) =>
      handleAuthentication(socket, io, services, cb),
    );
    socket.on("authenticate:request", (cb) =>
      handleAuthentication(socket, io, services, cb),
    );

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
      const survivor = userSockets.get(userId)?.values().next().value;
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
  { gameStateManager, presenceService, progressService }: SocketServices,
  callback?: unknown,
): Promise<void> {
  const userId = socket.data.user?.id;
  const username = socket.data.user?.username;

  if (!userId) {
    const error = "No user ID found";
    if (typeof callback === "function") {
      callback({ success: false, error });
    } else {
      socket.emit("authentication:complete", { success: false, error });
    }
    return;
  }

  try {
    // Join user-specific room
    socket.join(`user:${userId}`);
    socket.join(`player:${userId}`);

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
    const response = { success: true, userId, username };
    if (typeof callback === "function") {
      callback(response);
    } else {
      socket.emit("authentication:complete", response);
    }

    logger.info({ username }, "User authenticated and session ready");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error({ err: error }, "Authentication error");
    if (typeof callback === "function") {
      callback({ success: false, error: msg });
    } else {
      socket.emit("authentication:complete", { success: false, error: msg });
    }
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
