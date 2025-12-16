import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { prisma } from "../database/client";
import { config } from "../config/environment";
import type { AuthRequest, AuthResponse } from "../../../shared/types";
import {
  validateRegistration,
  validateLogin,
  handleValidationErrors,
} from "../middleware/validation";

const router = Router();

// Helper function to generate IP address for new users
function generateHomeIP(): string {
  const octet = () => Math.floor(Math.random() * 200) + 10; // 10-209 range
  return `192.168.${octet()}.${octet()}`;
}

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

      // Generate unique home IP
      let homeIp: string = generateHomeIP();
      let attempts = 0;
      do {
        const ipExists = await prisma.user.findUnique({
          where: { homeIp },
        });
        if (!ipExists) break;
        homeIp = generateHomeIP();
        attempts++;
      } while (attempts < 10);

      if (attempts >= 10) {
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
            repMilitary: 0,
            repSwordCorp: 0,
            repAnons: 0,
            repNeutral: 0,
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

        // Create home directory
        const homeRoot = await tx.fileSystemNode.create({
          data: {
            serverId: homeServer.id,
            name: "home",
            type: "directory",
            permissions: {
              owner: 15, // FULL permissions
              faction: 0,
              others: 1, // READ only
            },
            createdBy: user.id,
            size: 0,
            isEncrypted: false,
            isHidden: false,
            isProtected: true,
          },
        });

        // Create welcome file
        await tx.fileSystemNode.create({
          data: {
            serverId: homeServer.id,
            parentId: homeRoot.id,
            name: "welcome.txt",
            type: "file",
            content: `Welcome to the AIDA Network, ${username}!\n\nYour personal terminal: ${homeIp}\nSecurity Level: Basic\n\nType 'help' for available commands.\nType 'know_servers' to see available servers.\n\nStay vigilant. Trust no one.`,
            permissions: {
              owner: 15,
              faction: 0,
              others: 1,
            },
            createdBy: user.id,
            size: 200,
            isEncrypted: false,
            isHidden: false,
            isProtected: true,
          },
        });

        return user;
      });

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

      const response: AuthResponse = {
        success: true,
        token,
        user: result,
        message: "Account created successfully",
      };

      res.status(201).json(response);
    } catch (error) {
      console.error("Registration error:", error);
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

      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;

      const response: AuthResponse = {
        success: true,
        token,
        user: userWithoutPassword,
        message: "Login successful",
      };

      res.json(response);
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        timestamp: new Date(),
      });
    }
  },
);

// User Logout
router.post("/logout", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (token) {
      // Deactivate session
      await prisma.userSession.updateMany({
        where: { token },
        data: { isActive: false },
      });

      // Update user offline status
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET) as {
          userId: string;
        };
        await prisma.user.update({
          where: { id: decoded.userId },
          data: { isOnline: false },
        });

        // Log logout
        await prisma.auditLog.create({
          data: {
            userId: decoded.userId,
            action: "user_logout",
            resource: "user",
            resourceId: decoded.userId,
            ipAddress: req.ip || null,
            userAgent: req.get("User-Agent") || null,
          },
        });
      } catch (jwtError) {
        // Token might be invalid, but that's okay for logout
      }
    }

    res.json({
      success: true,
      message: "Logged out successfully",
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Logout error:", error);
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
    const token = req.headers.authorization?.replace("Bearer ", "");

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
      user,
      timestamp: new Date(),
    });
  } catch (error) {
    console.error("Token verification error:", error);
    res.status(401).json({
      success: false,
      error: "Invalid token",
      timestamp: new Date(),
    });
  }
});

export default router;
