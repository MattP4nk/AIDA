import express, { Application, Request, Response, NextFunction, RequestHandler } from "express";
import logger from "../logger";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { config, CORS_ORIGINS, isDevelopment } from "../config/environment";
import {
  sanitizeInputs,
  detectSqlInjection,
  detectXss,
  detectPathTraversal,
} from "./validation";
import { csrfProtection, csrfTokenEndpoint } from "./csrf";
import { GameError } from "../../../shared/types";
import { formatServerError } from "../utils/safeExecute";

/**
 * Wrap an async Express route handler to catch errors automatically.
 * GameError subclasses map to their statusCode; all others bubble to the global handler.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Request, res as Response, next)).catch(next);
  };
}

/**
 * Configure all Express middleware in the correct order.
 */
export function setupMiddleware(app: Application): void {
  // Trust proxy — required for correct req.ip behind reverse proxies (rate limiting, audit logs)
  if (process.env.TRUST_PROXY) {
    app.set("trust proxy", Number(process.env.TRUST_PROXY) || 1);
  }

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          mediaSrc: ["'self'", "data:", "blob:"],
        },
      },
    }),
  );

  // CORS
  app.use(
    cors({
      origin: CORS_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "X-CSRF-Token",
      ],
    }),
  );

  // Cookie parsing
  app.use(cookieParser());

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

  // Rate limiting (API routes only)
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

  // Input validation and sanitization
  app.use(sanitizeInputs);
  app.use(detectSqlInjection);
  app.use(detectXss);
  app.use(detectPathTraversal);

  // CSRF protection
  app.use(csrfProtection);
}

/**
 * Configure all Express routes.
 */
export async function setupRoutes(app: Application): Promise<void> {
  // CSRF token endpoint
  app.get("/api/csrf-token", csrfTokenEndpoint);

  // Admin & health routes
  const adminRoutes = (await import("../routes/admin")).default;
  app.use(adminRoutes);

  // Admin API (CRUD for game entities)
  const adminApi = (await import("../routes/adminApi")).default;
  app.use("/api/admin", adminApi);

  // Admin panel static files (development only — in production, use the authenticated admin API)
  if (isDevelopment) {
    const path = await import("path");
    const adminPanelPath = path.join(__dirname, "../../public/admin");
    app.use("/admin", (await import("express")).static(adminPanelPath));
  }

  // Command execution route — THE MAIN INTERFACE
  app.use("/api/command", (await import("../routes/command")).default);

  // Command list endpoint — for client command palette
  app.get("/api/commands", async (_req, res) => {
    try {
      const { createAllModules } = await import("../services/commandModules/registry");
      const modules = createAllModules();
      const commands: Array<{ name: string; category: string; description: string }> = [];
      for (const mod of modules) {
        const infos = mod.getCommandInfo?.() || [];
        for (const info of infos) {
          commands.push({
            name: info.command,
            category: info.category || mod.category,
            description: info.description,
          });
        }
        // Add commands that don't have getCommandInfo entries
        for (const cmd of mod.commands) {
          if (!commands.some((c) => c.name === cmd)) {
            commands.push({ name: cmd, category: mod.category, description: "" });
          }
        }
      }
      res.json({ success: true, commands });
    } catch {
      res.json({ success: true, commands: [] });
    }
  });

  // Authentication — minimal REST for login/register only
  app.use("/api/auth", (await import("../routes/auth")).default);

  // Catch-all for undefined routes
  app.use("*", (_req, res) => {
    res.status(404).json({
      success: false,
      error: "Endpoint not found",
      timestamp: new Date().toISOString(),
    });
  });
}

/**
 * Configure global error handling.
 */
export function setupErrorHandling(app: Application): void {
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      // formatServerError classifies ALL errors uniformly:
      // Prisma errors → clean message + correct status code
      // GameError subclasses → preserve code + statusCode
      // JWT errors → 401
      // Generic errors → 500 with safe message
      const formatted = formatServerError(err, "HTTP Request");

      // Log with full error details (pino serializes the stack trace)
      if (formatted.statusCode >= 500) {
        logger.error({ err, code: formatted.code }, formatted.logMessage);
      } else {
        logger.warn({ err, code: formatted.code }, formatted.logMessage);
      }

      res.status(formatted.statusCode).json({
        success: false,
        error: formatted.message,
        code: formatted.code,
        // Include GameError details if present
        ...(err instanceof GameError && err.details && isDevelopment ? { details: err.details } : {}),
        timestamp: new Date().toISOString(),
      });
    },
  );
}
