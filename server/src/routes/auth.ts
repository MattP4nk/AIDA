import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import logger from "../logger";
import { prisma } from "../database/client";
import { config } from "../config/environment";
import { authenticateToken, invalidateAuthCache, AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS } from "../middleware/auth";
import { getService } from "../di/container";
import { FACTION_SERVICE, IP_SERVICE } from "../di/tokens";
import type { FactionService } from "../services/factionService";
import type IPService from "../services/ipService";
import type { AuthRequest, AuthResponse, User } from "../../../shared/types";
import {
  validateRegistration,
  validateLogin,
  handleValidationErrors,
} from "../middleware/validation";

const router = Router();

// Helper function to generate JWT token
function generateToken(userId: string): string {
  return jwt.sign({ userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN,
  } as jwt.SignOptions);
}

// User Registration
router.post(
  "/register",
  validateRegistration(),
  handleValidationErrors,
  async (req: any, res: any) => {
    try {
      const { username, email, password } = req.body as {
        username: string;
        email: string;
        password: string;
      };

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [{ username }, ...(email ? [{ email }] : [])],
        },
      });

      if (existingUser) {
        const response: AuthResponse = {
          success: false,
          message:
            existingUser.username === username
              ? "Username already exists"
              : "Email already registered",
        };
        return res.status(409).json(response);
      }

      // Generate unique home IP on an isolated /16 subnet via IPService
      let homeIp: string;
      try {
        const ipService = getService<IPService>(IP_SERVICE);
        homeIp = await ipService.generatePlayerHomeIP();
      } catch (err) {
        logger.error({ err }, "Failed to generate player home IP");
        return res.status(500).json({
          success: false,
          error: "Unable to generate unique home IP",
          timestamp: new Date(),
        });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, config.BCRYPT_ROUNDS);

      // Create user with transaction
      const result = await prisma.$transaction(async (tx: any) => {
        // Create user
        const user = await tx.user.create({
          data: {
            username,
            email,
            password: hashedPassword,
            homeIp,
            isActive: true,
            isOnline: true,
          },
          select: {
            id: true,
            username: true,
            email: true,
            homeIp: true,
            createdAt: true,
            lastLogin: true,
            isActive: true,
            isOnline: true,
            role: true,
          },
        });

        // Create player progress
        await tx.playerProgress.create({
          data: {
            userId: user.id,
            discoveryLevel: 0,
            credits: 1000,
            level: 1,
            experience: 0,
            hacking: 10,
            networking: 10,
            cryptography: 5,
            stealth: 10,
            socialEng: 5,
            forensics: 5,
            missionProgress: {},
            achievements: [],
          },
        });

        // Create user's home server
        const homeServer = await tx.gameServer.create({
          data: {
            name: `${username}'s Terminal`,
            ipAddress: homeIp,
            type: "player_home",
            ownerId: user.id,
            encryptionLevel: 1,
            accessRules: [{ type: "allow", target: "user", value: user.id }],
            isOnline: true,
            maxConnections: 5,
            currentConnections: 0,
          },
        });

        // Create root filesystem
        const root = await tx.fileSystemNode.create({
          data: {
            serverId: homeServer.id,
            parentId: null,
            name: "/",
            type: "directory",
            permissions: { owner: 15, faction: 5, others: 0 },
            createdBy: user.id,
            size: 0,
          },
        });

        // Create standard directories under root
        const baseDirs = ["home", "etc", "var", "tmp", "logs", "data"];
        const dirMap: Record<string, string> = {};
        for (const dirName of baseDirs) {
          const dir = await tx.fileSystemNode.create({
            data: {
              serverId: homeServer.id,
              parentId: root.id,
              name: dirName,
              type: "directory",
              permissions: { owner: 15, faction: 5, others: 1 },
              createdBy: user.id,
              size: 0,
            },
          });
          dirMap[dirName] = dir.id;
        }

        // Create user home directory under /home
        const userHome = await tx.fileSystemNode.create({
          data: {
            serverId: homeServer.id,
            parentId: dirMap["home"]!,
            name: username,
            type: "directory",
            permissions: { owner: 15, faction: 0, others: 0 },
            createdBy: user.id,
            size: 0,
          },
        });

        // Create welcome file in user home
        await tx.fileSystemNode.create({
          data: {
            serverId: homeServer.id,
            parentId: userHome.id,
            name: "welcome.txt",
            type: "file",
            content: `Welcome to the AIDA Network, ${username}!\n\nYour personal terminal: ${homeIp}\nSecurity Level: Basic\n\nType 'help' for available commands.\nType 'scan' to discover nearby servers.\nType 'connect <ip>' to connect to a server.\n\nStay vigilant. Trust no one.`,
            permissions: { owner: 15, faction: 0, others: 1 },
            createdBy: user.id,
            size: 200,
            isEncrypted: false,
            isHidden: false,
            isProtected: true,
          },
        });

        return user;
      });

      // Initialize faction standings for new user
      try {
        const factionService = getService<FactionService>(FACTION_SERVICE);
        await factionService.initializeStandings(result.id);
      } catch {
        // Non-critical: standings will be created on first interaction
      }

      // Link home server to Internet Exchange (fire-and-forget)
      try {
        const { NETWORK_TOPOLOGY_SERVICE } = await import("../di/tokens");
        const topoService = getService<any>(NETWORK_TOPOLOGY_SERVICE);
        // Find the home server ID from the transaction result
        const homeServerRecord = await prisma.gameServer.findFirst({
          where: { ipAddress: homeIp, isPlayerHome: true },
          select: { id: true },
        });
        if (homeServerRecord) {
          topoService.createHomeLink(homeServerRecord.id).catch(() => {});
        }
      } catch {
        // Non-critical: home link will be created on first session if missed
      }

      // Generate JWT token
      const token = generateToken(result.id);

      // Create session
      await prisma.userSession.create({
        data: {
          userId: result.id,
          token,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          ipAddress: req.ip || null,
          userAgent: req.get("User-Agent") || null,
        },
      });

      // Log successful registration
      await prisma.auditLog.create({
        data: {
          userId: result.id,
          action: "user_registered",
          resource: "user",
          resourceId: result.id,
          ipAddress: req.ip || null,
          userAgent: req.get("User-Agent") || null,
          metadata: {
            username,
            homeIp,
          },
        },
      });

      // Set httpOnly cookie with JWT
      res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

      const response: AuthResponse = {
        success: true,
        token,
        user: result,
        message: "Account created successfully",
      };

      res.status(201).json(response);
    } catch (error) {
      logger.error({ err: error }, "Registration error");
      res.status(500).json({
        success: false,
        error: "Internal server error",
        timestamp: new Date(),
      });
    }
  },
);

// User Login
router.post(
  "/login",
  validateLogin(),
  handleValidationErrors,
  async (req: any, res: any) => {
    try {
      const { username, password }: AuthRequest = req.body;

      // Find user
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username },
            { email: username }, // Allow login with email
          ],
          isActive: true,
        },
        select: {
          id: true,
          username: true,
          email: true,
          password: true,
          homeIp: true,
          createdAt: true,
          lastLogin: true,
          isActive: true,
          isOnline: true,
          role: true,
        },
      });

      if (!user) {
        const response: AuthResponse = {
          success: false,
          message: "Invalid username or password",
        };
        return res.status(401).json(response);
      }

      // Verify password
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        const response: AuthResponse = {
          success: false,
          message: "Invalid username or password",
        };
        return res.status(401).json(response);
      }

      // Update last login and online status
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLogin: new Date(),
          isOnline: true,
        },
      });

      // Generate JWT token
      const token = generateToken(user.id);

      // Create session
      await prisma.userSession.create({
        data: {
          userId: user.id,
          token,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
          ipAddress: req.ip || null,
          userAgent: req.get("User-Agent") || null,
        },
      });

      // Log successful login
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "user_login",
          resource: "user",
          resourceId: user.id,
          ipAddress: req.ip || null,
          userAgent: req.get("User-Agent") || null,
        },
      });

      // Set httpOnly cookie with JWT
      res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      const response: AuthResponse = {
        success: true,
        token,
        user: userWithoutPassword as unknown as User,
        message: "Login successful",
      };

      res.json(response);
    } catch (error) {
      logger.error({ err: error }, "Login error");
      res.status(500).json({
        success: false,
        error: "Internal server error",
        timestamp: new Date(),
      });
    }
  },
);

// User Logout (authenticated — only deactivates YOUR session)
router.post("/logout", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        error: "Not authenticated",
        timestamp: new Date(),
      });
      return;
    }

    // Read token from cookie or header
    const token =
      req.cookies?.[AUTH_COOKIE_NAME] ||
      req.headers.authorization?.replace("Bearer ", "");

    if (token) {
      // Evict from auth cache immediately so the token stops working at once
      invalidateAuthCache(token);

      // Deactivate only sessions belonging to the authenticated user
      await prisma.userSession.updateMany({
        where: { token, userId },
        data: { isActive: false },
      });

      // Update user offline status
      await prisma.user.update({
        where: { id: userId },
        data: { isOnline: false },
      });

      // Log logout
      await prisma.auditLog.create({
        data: {
          userId,
          action: "user_logout",
          resource: "user",
          resourceId: userId,
          ipAddress: req.ip || null,
          userAgent: req.get("User-Agent") || null,
        },
      });
    }

    // Clear the httpOnly cookie
    res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });

    res.json({
      success: true,
      message: "Logged out successfully",
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ err: error }, "Logout error");
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date(),
    });
  }
});

// Verify Token
router.get("/verify", async (req: any, res: any) => {
  try {
    const token =
      req.cookies?.[AUTH_COOKIE_NAME] ||
      req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided",
        timestamp: new Date(),
      });
    }

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
        createdAt: true,
        lastLogin: true,
        isActive: true,
        isOnline: true,
        role: true,
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        error: "User not found or inactive",
        timestamp: new Date(),
      });
    }

    res.json({
      success: true,
      token, // Return token so client can restore it for Socket.IO auth
      user,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ err: error }, "Token verification error");
    res.status(401).json({
      success: false,
      error: "Invalid token",
      timestamp: new Date(),
    });
  }
});

// Refresh Token — issues a new JWT + cookie, deactivates old session
router.post("/refresh", authenticateToken, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, error: "Not authenticated", timestamp: new Date() });
      return;
    }

    // Deactivate old session
    const oldToken =
      req.cookies?.[AUTH_COOKIE_NAME] ||
      req.headers.authorization?.replace("Bearer ", "");
    if (oldToken) {
      invalidateAuthCache(oldToken);
      await prisma.userSession.updateMany({
        where: { token: oldToken, userId },
        data: { isActive: false },
      });
    }

    // Issue new token + session
    const newToken = generateToken(userId);
    await prisma.userSession.create({
      data: {
        userId,
        token: newToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ipAddress: req.ip || null,
        userAgent: req.get("User-Agent") || null,
      },
    });

    // Set new cookie
    res.cookie(AUTH_COOKIE_NAME, newToken, AUTH_COOKIE_OPTIONS);

    res.json({
      success: true,
      token: newToken,
      message: "Token refreshed",
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error({ err: error }, "Token refresh error");
    res.status(500).json({ success: false, error: "Internal server error", timestamp: new Date() });
  }
});

export default router;
