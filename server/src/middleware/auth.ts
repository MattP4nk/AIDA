import { Request, Response, NextFunction } from "express";
import { createHash } from "crypto";
import jwt from "jsonwebtoken";
import logger from "../logger";
import { prisma } from "../database/client";
import { config, isProduction } from "../config/environment";

/** Hash token before using as cache key — prevents raw JWT exposure in memory. */
const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

// ── Cookie configuration ─────────────────────────────────────────
export const AUTH_COOKIE_NAME = "aida_token";
export const AUTH_COOKIE_OPTIONS: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax" | "none";
  maxAge: number;
  path: string;
} = {
  httpOnly: true,
  secure: true, // Required for sameSite=none; localhost is treated as secure context by browsers
  sameSite: isProduction ? "strict" : "none", // 'none' required for cross-origin cookie in dev (port 8080 → 3001)
  maxAge: 24 * 60 * 60 * 1000, // 24 hours (matches JWT expiry)
  path: "/",
};

// ── Auth session cache ────────────────────────────────────────────
// Keyed by token; avoids 2 DB queries on every authenticated request.
// TTL is intentionally short so changes (ban, deactivation) take effect quickly.
const AUTH_CACHE_TTL_MS = 60_000; // 60 seconds
const AUTH_CACHE_MAX_SIZE = 1000;
const AUTH_CACHE_CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes

interface AuthCacheEntry {
  user: { id: string; username: string; email: string; homeIp: string; isActive: boolean; isOnline: boolean; role: string };
  expiresAt: number;
}
const authCache = new Map<string, AuthCacheEntry>();

// Periodic cleanup — prevents memory leak from accumulated expired tokens
const authCacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authCache) {
    if (entry.expiresAt <= now) {
      authCache.delete(key);
    }
  }
}, AUTH_CACHE_CLEANUP_INTERVAL_MS);
authCacheCleanupTimer.unref(); // Don't prevent process exit

// Warn about insecure cookie settings in development
if (!isProduction) {
  logger.warn("Running with sameSite=none cookies — NOT safe for public deployment");
}

export function invalidateAuthCache(token: string): void {
  authCache.delete(hashToken(token));
}

/** Invalidate all cached sessions for a specific user (e.g., on ban). */
export function invalidateAuthCacheForUser(userId: string): void {
  for (const [token, entry] of authCache) {
    if (entry.user.id === userId) {
      authCache.delete(token);
    }
  }
}

// Extend Express Request interface to include user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        username: string;
        email: string;
        homeIp: string;
        isActive: boolean;
        role: string;
      } | null;
    }
  }
}

// JWT token verification middleware
export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    // Read token from httpOnly cookie first, fall back to Authorization header
    const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const headerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;
    const token = cookieToken || headerToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Access token required",
        timestamp: new Date(),
      });
    }

    // Cache hit — skip DB entirely (keyed by hash of token)
    const tokenHash = hashToken(token);
    const cached = authCache.get(tokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.user;
      return next();
    }

    // Verify JWT token
    const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string };

    // Check if session is active
    const session = await prisma.userSession.findFirst({
      where: {
        token,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      authCache.delete(tokenHash);
      return res.status(401).json({
        success: false,
        error: "Session expired or invalid",
        timestamp: new Date(),
      });
    }

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        homeIp: true,
        isActive: true,
        isOnline: true,
        role: true,
      },
    });

    if (!user || !user.isActive) {
      authCache.delete(tokenHash);
      return res.status(401).json({
        success: false,
        error: "User not found or inactive",
        timestamp: new Date(),
      });
    }

    // Store in cache (evict oldest if full)
    if (authCache.size >= AUTH_CACHE_MAX_SIZE) {
      const firstKey = authCache.keys().next().value;
      if (firstKey) authCache.delete(firstKey);
    }
    authCache.set(tokenHash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

    // Attach user to request
    req.user = user;
    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({
        success: false,
        error: "Invalid token",
        timestamp: new Date(),
      });
    }

    logger.error({ err: error }, "Authentication error");
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date(),
    });
  }
};

// Optional authentication middleware (doesn't fail if no token)
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Read token from httpOnly cookie first, fall back to Authorization header
    const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
    const authHeader = req.headers.authorization;
    const headerToken =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;
    const token = cookieToken || headerToken;

    if (!token) {
      return next(); // Continue without user
    }

    const optTokenHash = hashToken(token);
    const cached = authCache.get(optTokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      req.user = cached.user;
      return next();
    }

    const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string };

    const session = await prisma.userSession.findFirst({
      where: {
        token,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (session) {
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          username: true,
          email: true,
          homeIp: true,
          isActive: true,
          isOnline: true,
          role: true,
        },
      });

      if (user && user.isActive) {
        if (authCache.size >= AUTH_CACHE_MAX_SIZE) {
          const firstKey = authCache.keys().next().value;
          if (firstKey) authCache.delete(firstKey);
        }
        authCache.set(optTokenHash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
        req.user = user;
      }
    }

    next();
  } catch (error) {
    // Ignore authentication errors in optional auth
    next();
  }
};

// Socket.io authentication helper
export const verifySocketToken = async (token: string) => {
  try {
    const socketTokenHash = hashToken(token);
    const cached = authCache.get(socketTokenHash);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    const decoded = jwt.verify(token, config.JWT_SECRET) as { userId: string };

    const session = await prisma.userSession.findFirst({
      where: {
        token,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        username: true,
        email: true,
        homeIp: true,
        isActive: true,
        isOnline: true,
        role: true,
      },
    });

    if (user && user.isActive) {
      if (authCache.size >= AUTH_CACHE_MAX_SIZE) {
        const firstKey = authCache.keys().next().value;
        if (firstKey) authCache.delete(firstKey);
      }
      authCache.set(socketTokenHash, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
      return user;
    }
    return null;
  } catch (error) {
    return null;
  }
};

// Role hierarchy: admin > moderator > player
const ROLE_HIERARCHY: Record<string, number> = {
  player: 0,
  moderator: 1,
  admin: 2,
};

// Role-based access control middleware
export const requireRole = (minimumRole: string) => {
  if (!(minimumRole in ROLE_HIERARCHY)) {
    throw new Error(`requireRole: unknown role "${minimumRole}"`);
  }
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Authentication required",
        timestamp: new Date(),
      });
      return;
    }

    const userLevel = ROLE_HIERARCHY[req.user.role] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] ?? 0;

    if (userLevel < requiredLevel) {
      res.status(403).json({
        success: false,
        error: "Insufficient permissions",
        timestamp: new Date(),
      });
      return;
    }

    next();
  };
};

// Rate limiting per user (with timer-based cleanup to prevent memory leak)
export const userRateLimit = (requestsPerMinute: number) => {
  const userRequests = new Map<string, { count: number; resetTime: number }>();
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean up every 5 minutes

  // Timer-based cleanup — runs regardless of request activity
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of userRequests) {
      if (now > entry.resetTime) {
        userRequests.delete(key);
      }
    }
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref(); // Don't prevent process exit

  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) {
      return next(); // Skip rate limiting for unauthenticated requests
    }

    const now = Date.now();
    const resetTime = now + 60 * 1000; // 1 minute from now
    const userLimit = userRequests.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
      // Reset or initialize
      userRequests.set(userId, { count: 1, resetTime });
      return next();
    }

    if (userLimit.count >= requestsPerMinute) {
      res.status(429).json({
        success: false,
        error: "Rate limit exceeded",
        retryAfter: Math.ceil((userLimit.resetTime - now) / 1000),
        timestamp: new Date(),
      });
      return;
    }

    userLimit.count++;
    next();
  };
};

// Audit logging middleware
export const auditLog = (action: string, resource: string) => {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (req.user) {
        await prisma.auditLog.create({
          data: {
            userId: req.user.id,
            action,
            resource,
            resourceId: req.params.id || null,
            ipAddress: req.ip || null,
            userAgent: req.get("User-Agent") || null,
            metadata: {
              method: req.method,
              path: req.path,
              query: req.query,
            },
          },
        });
      }
      next();
    } catch (error) {
      logger.error({ err: error }, "Audit logging error");
      next(); // Don't fail the request if audit logging fails
    }
  };
};
