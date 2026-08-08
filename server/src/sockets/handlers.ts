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
} from "../di/tokens";

import type GameStateManager from "../services/gameStateManager";
import type ProgressService from "../services/progressService";
import type CommandProcessor from "../services/commandProcessor";
import type PlayerPresenceService from "../services/playerPresenceService";
import type MessageService from "../services/messageService";

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
 * Simple per-socket sliding-window rate limiter.
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

/**
 * Set up all Socket.IO event handlers.
 * Called once during server initialization after the DI container is ready.
 */
export function setupSocketHandlers(io: SocketIOServer): void {
  const services = resolveServices();

  io.on("connection", (socket) => {
    logger.info({ socketId: socket.id }, "User connected");

    // Per-socket rate limiters (events per window)
    const commandRateLimit = createSocketRateLimiter(20, 10_000); // 20 commands per 10s
    const messageRateLimit = createSocketRateLimiter(10, 10_000); // 10 messages per 10s
    const terminalRateLimit = createSocketRateLimiter(10, 10_000); // 10 terminal ops per 10s
    const generalRateLimit = createSocketRateLimiter(30, 10_000); // 30 events per 10s

    // ── Socket authentication middleware ──────────────────────────
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
    socket.on("disconnect", () => handleDisconnect(socket, services));
  });
}

// ═══════════════════════════════════════════════════════════════════
// Individual handler implementations
// ═══════════════════════════════════════════════════════════════════

function setupAuthMiddleware(socket: Socket): void {
  socket.use(async (_packet, next) => {
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

    // Mark player as online
    await presenceService.playerConnected(userId, socket.id);

    // Queue initial save
    progressService.queueSave(userId, "login");

    // Broadcast full game state to client
    await gameStateManager.broadcastStateUpdate(userId);

    // Check if new player needs tutorial
    try {
      const { getService: getSvc } = await import("../di/container");
      const { TUTORIAL_SERVICE } = await import("../di/tokens");
      const tutorialService =
        getSvc<import("../services/tutorialService").TutorialService>(
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

  await gameStateManager.connectPlayerToServer(userId, data.serverId);
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

    if (!command || typeof command !== "string") {
      socket.emit("command:error", {
        success: false,
        error: "Invalid command format",
      });
      return;
    }

    // Build full command string
    const commandString =
      args && args.length > 0 ? `${command} ${args.join(" ")}` : command;

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

    if (!recipientId || !subject || !content) {
      socket.emit("message:result", {
        success: false,
        error: "recipientId, subject, and content are required",
      });
      return;
    }

    const result = await messageService.sendPrivateMessage(
      senderId,
      recipientId,
      {
        subject,
        content,
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
): Promise<void> {
  const userId = socket.data.user?.id;

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
