import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../database/client";
import { config } from "../config/environment";

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
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: "User not found or inactive",
        timestamp: new Date(),
      });
    }

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

    console.error("Authentication error:", error);
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
        },
      });

      if (user && user.isActive) {
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
      },
    });

    return user && user.isActive ? user : null;
  } catch (error) {
    return null;
  }
};

// Role-based access control middleware
export const requirePermission = (_permission: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Authentication required",
        timestamp: new Date(),
      });
      return;
    }

    // TODO: Implement role/permission system
    // For now, all authenticated users have basic permissions
    next();
  };
};

// Rate limiting per user
export const userRateLimit = (requestsPerMinute: number) => {
  const userRequests = new Map<string, { count: number; resetTime: number }>();

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
      console.error("Audit logging error:", error);
      next(); // Don't fail the request if audit logging fails
    }
  };
};
