import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { config, validateConfig } from "./config/environment";
import { db } from "./database/client";

// Import new multiplayer services
import GameStateManager from "./services/gameStateManager";
import { ipService } from "./services/ipService";
import { progressService } from "./services/progressService";
import { initializeFileService } from "./services/fileService";
import { initializeMessageService } from "./services/messageService";
import { forumService } from "./services/forumService";
import { initializePresenceService } from "./services/playerPresenceService";

// Track connected users
const connectedUsers = new Map<string, string>(); // socketId -> userId

// Initialize Express app
const app = express();
const server = createServer(app);

// Initialize Socket.IO
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || [
      "http://localhost:8080",
      "http://localhost:8081",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// GameStateManager instance for global access
let gameStateManager: GameStateManager | null = null;

class AidaServer {
  private isShuttingDown = false;

  async initialize(): Promise<void> {
    try {
      // Validate configuration
      validateConfig();
      console.log("✅ Configuration validated");

      // Connect to database
      await db.connect();
      console.log("✅ Database connection established");

      // Initialize Game State Manager
      gameStateManager = new GameStateManager(io);
      console.log("✅ Game State Manager initialized");

      // Initialize IP Service and load allocated IPs
      await ipService.loadAllocatedIPs();
      console.log("✅ IP Service initialized");

      // Start Progress Service (auto-save)
      progressService.start();
      console.log("✅ Progress Service started");

      // Load event subscriptions
      const { eventService } = await import("./services/eventService");
      await eventService.loadSubscriptionsFromDatabase();
      console.log("✅ Event subscriptions loaded");

      // Initialize FileService with Socket.IO
      initializeFileService(io);
      console.log("✅ File Service initialized");

      // Initialize MessageService with Socket.IO
      initializeMessageService(io);
      console.log("✅ Message Service initialized");

      // Initialize ForumService with Socket.IO
      forumService.initialize(io);
      console.log("✅ Forum Service initialized");

      // Initialize PlayerPresenceService with Socket.IO
      initializePresenceService(io);
      console.log("✅ Player Presence Service initialized");

      // Setup middleware
      this.setupMiddleware();
      console.log("✅ Middleware configured");

      // Setup routes
      await this.setupRoutes();
      console.log("✅ Routes configured");

      // Setup Socket.IO handlers
      this.setupSocketHandlers();
      console.log("✅ Socket.IO handlers configured");

      // Setup error handling
      this.setupErrorHandling();
      console.log("✅ Error handling configured");

      console.log("🚀 AIDA Server initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize server:", error);
      process.exit(1);
    }
  }

  private setupMiddleware(): void {
    // Security middleware
    app.use(
      helmet({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
          },
        },
      }),
    );

    // CORS
    app.use(
      cors({
        origin: process.env.CORS_ORIGIN || [
          "http://localhost:8080",
          "http://localhost:8081",
          "http://localhost:5173",
        ],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      }),
    );

    // Compression
    app.use(compression());

    // Request logging
    if (config.NODE_ENV === "development") {
      app.use(morgan("dev"));
    } else {
      app.use(morgan("combined"));
    }

    // Body parsing
    app.use(
      express.json({
        limit: `${config.MAX_FILE_SIZE_MB}mb`,
        strict: true,
      }),
    );
    app.use(
      express.urlencoded({
        extended: true,
        limit: `${config.MAX_FILE_SIZE_MB}mb`,
      }),
    );

    // Rate limiting
    const limiter = rateLimit({
      windowMs: config.RATE_LIMIT_WINDOW_MS,
      max: config.RATE_LIMIT_MAX_REQUESTS,
      message: {
        error: "Too many requests from this IP, please try again later.",
        retryAfter: Math.ceil(config.RATE_LIMIT_WINDOW_MS / 1000),
      },
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.use("/api", limiter);
  }

  private async setupRoutes(): Promise<void> {
    // Health check endpoint
    app.get("/health", async (_req, res) => {
      const dbHealth = await db.healthCheck();
      const status = dbHealth ? "healthy" : "unhealthy";

      res.status(dbHealth ? 200 : 503).json({
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: dbHealth ? "connected" : "disconnected",
        version: process.env.npm_package_version || "1.0.0",
      });
    });

    // ============================================================
    // TERMINAL-FIRST ARCHITECTURE
    // ============================================================
    // The client is a "dumb terminal" - all commands go through
    // the command processor. No direct REST routes for game logic.
    // ============================================================

    // Primary command execution route - THE MAIN INTERFACE
    // All game commands (ls, cd, hack, shop, etc.) go through here
    app.use("/api/command", (await import("./routes/command")).default);

    // Authentication - minimal REST for login/register only
    app.use("/api/auth", (await import("./routes/auth")).default);

    // Catch-all for undefined routes
    app.use("*", (_req, res) => {
      res.status(404).json({
        success: false,
        error: "Endpoint not found",
        timestamp: new Date().toISOString(),
      });
    });
  }

  private setupSocketHandlers(): void {
    io.on("connection", (socket) => {
      console.log(`🔌 User connected: ${socket.id}`);

      // Authentication middleware for socket
      socket.use(async (_packet, next) => {
        try {
          const token = socket.handshake.auth.token;
          if (!token) {
            return next(new Error("No authentication token provided"));
          }

          // Verify JWT token (implement this in auth middleware)
          const { verifySocketToken } = await import("./middleware/auth");
          const user = await verifySocketToken(token);

          if (!user) {
            return next(new Error("Invalid authentication token"));
          }

          socket.data.user = user;
          connectedUsers.set(socket.id, user.id);
          next();
        } catch (error) {
          next(new Error("Authentication failed"));
        }
      });

      // Handle connection after authentication
      socket.on("authenticated", async () => {
        const userId = socket.data.user?.id;
        if (!userId) return;

        // Join user-specific room
        socket.join(`user:${userId}`);

        // Create session in GameStateManager
        try {
          if (gameStateManager) {
            await gameStateManager.createSession(
              userId,
              socket.id,
              socket.handshake.address,
            );
          }

          // Mark player as online in presence service
          const { getPresenceService } = await import(
            "./services/playerPresenceService"
          );
          const presenceService = getPresenceService();
          await presenceService.playerConnected(userId, socket.id);

          // Queue initial save for user
          progressService.queueSave(userId, "login");

          // Broadcast full game state to client
          if (gameStateManager) {
            await gameStateManager.broadcastStateUpdate(userId);
          }

          // Notify contacts that user is online
          socket.broadcast.emit("user:status_change", {
            userId,
            isOnline: true,
            timestamp: new Date(),
          });

          console.log(
            `👤 User ${socket.data.user.username} authenticated via socket`,
          );
        } catch (error) {
          console.error("Error during authentication:", error);
        }
      });

      // Handle real-time game events
      socket.on("server:connect", async (data) => {
        const userId = socket.data.user?.id;
        if (!userId) return;

        const { serverId } = data;

        // Use GameStateManager to handle server connection
        if (gameStateManager) {
          await gameStateManager.connectPlayerToServer(userId, serverId);
        }

        // Update presence service
        const { getPresenceService } = await import(
          "./services/playerPresenceService"
        );
        const presenceService = getPresenceService();
        await presenceService.playerJoinedServer(userId, serverId);

        // Queue save for server connection
        progressService.saveOnEvent(userId, "server_connected");
      });

      socket.on("server:disconnect", async (_data) => {
        const userId = socket.data.user?.id;
        if (!userId) return;

        // Use GameStateManager to handle server disconnection
        if (gameStateManager) {
          await gameStateManager.disconnectPlayerFromServer(userId);
        }

        // Update presence service
        const { getPresenceService } = await import(
          "./services/playerPresenceService"
        );
        const presenceService = getPresenceService();
        const session = gameStateManager?.getPlayerSession(userId);
        if (session?.currentServerId) {
          await presenceService.playerLeftServer(
            userId,
            session.currentServerId,
          );
        }
      });

      socket.on("message:send", async (messageData) => {
        const senderId = socket.data.user?.id;
        if (!senderId) return;

        try {
          const {
            recipientId,
            subject,
            content,
            isEncrypted,
            encryptionLevel,
          } = messageData;

          // Validate required fields
          if (!recipientId || !subject || !content) {
            socket.emit("message:result", {
              success: false,
              error: "recipientId, subject, and content are required",
            });
            return;
          }

          // Use MessageService to send message
          const { messageService } = await import("./services/messageService");

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
          console.error("Error sending message via socket:", error);
          socket.emit("message:result", {
            success: false,
            error:
              error instanceof Error ? error.message : "Failed to send message",
          });
        }
      });

      socket.on("hack:attempt", async (_hackData) => {
        const attackerId = socket.data.user?.id;
        if (!attackerId) return;

        try {
          // Use command:execute handler for hack commands instead
          socket.emit("hack:result", {
            success: false,
            message: "Use command:execute with hack commands instead",
          });
        } catch (error) {
          socket.emit("hack:error", { message: "Hack attempt failed" });
        }
      });

      // Generic command execution handler
      socket.on("command:execute", async (data) => {
        const userId = socket.data.user?.id;
        if (!userId) {
          socket.emit("command:error", { message: "Not authenticated" });
          return;
        }

        try {
          const { command, args, serverId } = data;

          // Validate input
          if (!command || typeof command !== "string") {
            socket.emit("command:error", { message: "Invalid command format" });
            return;
          }

          // Import CommandProcessor
          const { commandProcessor } = await import(
            "./services/commandProcessor"
          );

          // Construct command string
          const commandString =
            args && args.length > 0 ? `${command} ${args.join(" ")}` : command;

          // Parse command
          const parsed = commandProcessor.parseCommand(
            userId,
            commandString,
            serverId,
          );

          // Check if parsing was successful
          if (!parsed.isValid) {
            socket.emit("command:result", {
              success: false,
              output: parsed.error || "Invalid command",
              timestamp: new Date(),
            });
            return;
          }

          // Execute command
          const result = await commandProcessor.executeCommand(
            userId,
            parsed,
            serverId,
          );

          // Send result back to client
          socket.emit("command:result", result);

          // Also broadcast to user's room for multi-device sync
          io.to(`user:${userId}`).emit("command:executed", {
            command: parsed.command,
            args: parsed.args,
            result,
            timestamp: new Date(),
          });
        } catch (error) {
          console.error("Command execution error:", error);
          socket.emit("command:error", {
            message: error instanceof Error ? error.message : "Command failed",
          });
        }
      });

      // Handle disconnection
      socket.on("disconnect", async () => {
        const userId = socket.data.user?.id;

        if (userId && gameStateManager) {
          try {
            // Mark player as offline in presence service
            const { getPresenceService } = await import(
              "./services/playerPresenceService"
            );
            const presenceService = getPresenceService();
            await presenceService.playerDisconnected(userId);

            // Save progress before disconnecting
            await progressService.savePlayerProgress(userId, "disconnect");

            // Destroy session in GameStateManager
            await gameStateManager.destroySession(userId);

            // Notify contacts that user is offline
            socket.broadcast.emit("user:status_change", {
              userId,
              isOnline: false,
              timestamp: new Date(),
            });

            console.log(`👤 User ${userId} disconnected`);
          } catch (error) {
            console.error("Error during disconnect:", error);
          }
        }

        console.log(`🔌 User disconnected: ${socket.id}`);
      });
    });
  }

  private setupErrorHandling(): void {
    // Global error handler
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        console.error("❌ Unhandled error:", err);

        // Don't leak error details in production
        const isDev = config.NODE_ENV === "development";

        res.status(500).json({
          success: false,
          error: isDev ? err.message : "Internal server error",
          stack: isDev ? err.stack : undefined,
          timestamp: new Date().toISOString(),
        });
      },
    );

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      console.error("💥 Uncaught Exception:", error);
      this.gracefulShutdown("uncaughtException");
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      console.error("💥 Unhandled Rejection at:", promise, "reason:", reason);
      this.gracefulShutdown("unhandledRejection");
    });

    // Handle graceful shutdown signals
    process.on("SIGTERM", () => this.gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => this.gracefulShutdown("SIGINT"));
  }

  private async gracefulShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    try {
      // Save all player progress
      console.log("💾 Saving all player progress...");
      await progressService.saveAll("shutdown");

      // Stop auto-save service
      progressService.stop();
      console.log("🛑 Progress Service stopped");

      // Cleanup game state manager
      if (gameStateManager) {
        await gameStateManager.cleanup();
        console.log("🧹 Game State Manager cleaned up");
      }

      // Stop accepting new connections
      server.close(() => {
        console.log("🔌 HTTP server closed");
      });

      // Close Socket.IO connections
      io.close(() => {
        console.log("🔌 Socket.IO server closed");
      });

      // Disconnect from database
      await db.disconnect();

      console.log("✅ Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      console.error("❌ Error during shutdown:", error);
      process.exit(1);
    }
  }

  async start(): Promise<void> {
    await this.initialize();

    server.listen(config.PORT, config.HOST, () => {
      console.log(`
🚀 AIDA Multiplayer Server started successfully!

🌐 Environment: ${config.NODE_ENV}
📡 Server: http://${config.HOST}:${config.PORT}
🏥 Health: http://${config.HOST}:${config.PORT}/health
🗄️  Database: Connected
🔌 WebSocket: Enabled

🎮 Game State Manager: Active
📡 IP Service: ${ipService.getAllocatedIPsCount()} IPs allocated
💾 Progress Service: Auto-save every ${config.AUTO_SAVE_INTERVAL_SECONDS}s

⚡ Ready to accept connections...
      `);
    });
  }
}

// Start the server
const aidaServer = new AidaServer();

if (require.main === module) {
  aidaServer.start().catch((error) => {
    console.error("💥 Failed to start server:", error);
    process.exit(1);
  });
}

export default aidaServer;
export { io, gameStateManager };
