import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import logger from "../logger";
import { prisma } from "../database/client";
import { config } from "../config/environment";

// ── Auth session cache ────────────────────────────────────────────
// Keyed by token; avoids 2 DB queries on every authenticated request.
// TTL is intentionally short so changes (ban, deactivation) take effect quickly.
const AUTH_CACHE_TTL_MS = 60_000; // 60 seconds
interface AuthCacheEntry {
  user: { id: string; username: string; email: string; homeIp: string; isActive: boolean; isOnline: boolean; role: string };
  expiresAt: number;
}
const authCache = new Map<string, AuthCacheEntry>();

export function invalidateAuthCache(token: string): void {
  authCache.delete(token);
}

// Extend Express Request interface to include user
declare global {
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
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Access token required",
        timestamp: new Date(),
      });
    }

    // Cache hit — skip DB entirely
    const cached = authCache.get(token);
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
      authCache.delete(token);
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
      authCache.delete(token);
      return res.status(401).json({
        success: false,
        error: "User not found or inactive",
        timestamp: new Date(),
      });
    }

    // Store in cache
    authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

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
    const authHeader = req.headers.authorization;
    const token =
      authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.substring(7)
        : null;

    if (!token) {
      return next(); // Continue without user
    }

    const cached = authCache.get(token);
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
        authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
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
    const cached = authCache.get(token);
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
      authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
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

// Rate limiting per user (with periodic cleanup to prevent memory leak)
export const userRateLimit = (requestsPerMinute: number) => {
  const userRequests = new Map<string, { count: number; resetTime: number }>();
  let lastCleanup = Date.now();
  const CLEANUP_INTERVAL = 5 * 60 * 1000; // Clean up every 5 minutes

  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (!userId) {
      return next(); // Skip rate limiting for unauthenticated requests
    }

    const now = Date.now();

    // Periodic cleanup of expired entries
    if (now - lastCleanup > CLEANUP_INTERVAL) {
      for (const [key, entry] of userRequests.entries()) {
        if (now > entry.resetTime) {
          userRequests.delete(key);
        }
      }
      lastCleanup = now;
    }

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
