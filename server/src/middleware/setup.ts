import express, { Application } from "express";
import logger from "../logger";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { config, CORS_ORIGINS } from "../config/environment";
import {
  sanitizeInputs,
  detectSqlInjection,
  detectXss,
  detectPathTraversal,
} from "./validation";
import { csrfProtection, csrfTokenEndpoint } from "./csrf";

/**
 * Configure all Express middleware in the correct order.
 */
export function setupMiddleware(app: Application): void {
  // Security headers
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

  // Command execution route — THE MAIN INTERFACE
  app.use("/api/command", (await import("../routes/command")).default);

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
      logger.error({ err }, "Unhandled error");

      const isDev = config.NODE_ENV === "development";

      res.status(500).json({
        success: false,
        error: isDev ? err.message : "Internal server error",
        stack: isDev ? err.stack : undefined,
        timestamp: new Date().toISOString(),
      });
    },
  );
}
