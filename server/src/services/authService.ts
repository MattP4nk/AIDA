/**
 * AuthService — the auth domain: registration, login (with lockout), logout,
 * token verification and refresh.
 *
 * A8: this lived inside the HTTP handlers of routes/auth.ts, so the most
 * security-critical code in the server was reachable only through an HTTP
 * request — register alone was a 250-line provisioning pipeline inside a
 * route. The routes are now thin adapters (validate, call, set the cookie,
 * respond); every rule lives here. Behaviour is characterized end to end by
 * scripts/verify-phase7-a8-auth.ts, recorded before the move.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { prisma } from "../database/client";
import { config } from "../config/environment";
import { invalidateAuthCache } from "../middleware/auth";
import { FACTION_SERVICE, IP_SERVICE, LOGGER, NETWORK_TOPOLOGY_SERVICE } from "../di/tokens";
import type { FactionService } from "./factionService";
import type IPService from "./ipService";
import type { NetworkTopologyService } from "./networkTopologyService";
import { GameError, type User } from "../../../shared/types";

/** What the HTTP layer knows about a request that the domain needs. */
export interface AuthRequestMeta {
  /** `req.ip`, as recorded on sessions and audit rows. */
  ip: string | null;
  userAgent: string | null;
  /** The address lockout keys on — falls back to the socket peer. */
  lockoutIp: string;
}

/** The public user shape every auth response returns. */
const USER_SELECT = {
  id: true,
  username: true,
  email: true,
  homeIp: true,
  createdAt: true,
  lastLogin: true,
  isActive: true,
  isOnline: true,
  role: true,
} as const;

/** Resolved lazily: a static di/container import from a service closes a cycle. */
async function resolve<T>(token: string): Promise<T> {
  const { getService } = await import("../di/container");
  return getService<T>(token);
}

@injectable()
export class AuthService {
  /**
   * Server-side session lifetime. Was the literal `24 * 60 * 60 * 1000` in
   * three places (register, login, refresh). It is NOT derived from
   * `config.JWT_EXPIRES_IN` ("24h" by default), so changing that config
   * leaves sessions and tokens disagreeing — whether to derive it is an open
   * question, since a deployed .env that differs would change behaviour.
   */
  private static readonly SESSION_TTL_MS = 24 * 60 * 60 * 1000;

  // Per-account lockout after repeated failed login attempts
  private static readonly LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
  private static readonly MAX_LOGIN_ATTEMPTS = 10;
  private static readonly MAX_IP_LOGIN_ATTEMPTS = 30; // Per-IP limit across all usernames
  private readonly loginAttempts = new Map<string, { count: number; firstAttempt: number }>();

  constructor(@inject(LOGGER) private logger: Logger) {
    // Periodic cleanup of expired lockout entries (every 5 minutes)
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.loginAttempts) {
        if (now - entry.firstAttempt > AuthService.LOGIN_ATTEMPT_WINDOW_MS) {
          this.loginAttempts.delete(key);
        }
      }
    }, 5 * 60 * 1000).unref();
  }

  // Helper function to generate JWT token
  //
  // `jwtid` makes every token unique. Without it the payload was only
  // { userId, iat, exp }, and `iat` has ONE-SECOND resolution while HMAC is
  // deterministic — so two tokens issued to one user in the same second were
  // byte-identical, and `userSession.token` is @unique. Logging in during the
  // second you registered answered 409 "A record with this session token
  // already exists"; two tabs logging in together failed the same way; and a
  // refresh in the same second as its login deactivated the old session, then
  // failed to create the "new" one with the same token — signing the user out.
  private generateToken(userId: string): string {
    return jwt.sign({ userId }, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN,
      jwtid: randomUUID(),
    } as jwt.SignOptions);
  }

  private async createSession(userId: string, token: string, meta: AuthRequestMeta): Promise<void> {
    await prisma.userSession.create({
      data: {
        userId,
        token,
        expiresAt: new Date(Date.now() + AuthService.SESSION_TTL_MS),
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  }

  // ==================== REGISTER ====================

  async register(
    input: { username: string; email: string; password: string },
    meta: AuthRequestMeta,
  ): Promise<{ token: string; user: User }> {
    const { username, email, password } = input;

    // Check if user already exists. The USERNAME check is case-insensitive:
    // the column is a case-sensitive @unique, so an exact check let "Bob"
    // register beside "bob", and every by-name lookup in the game
    // (userRepository.findByUsername) relies on there being only one. Email
    // needs no such care — the route's validator `normalizeEmail()`s it, and
    // every stored email is lowercase.
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: username, mode: "insensitive" } },
          ...(email ? [{ email }] : []),
        ],
      },
    });

    if (existingUser) {
      throw new GameError(
        "Username or email already in use",
        "CONFLICT",
        409,
      );
    }

    // Generate unique home IP on an isolated /16 subnet via IPService
    const ipService = await resolve<IPService>(IP_SERVICE);
    const homeIp = await ipService.generatePlayerHomeIP();

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
        select: USER_SELECT,
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
          isPlayerHome: true,
          ownerId: user.id,
          encryptionLevel: 1,
          accessRules: [{ type: "allow", target: "user", value: user.id }],
          isOnline: true,
          maxConnections: 5,
          currentConnections: 0,
        },
      });

      // Link user to home server
      await tx.user.update({
        where: { id: user.id },
        data: { homeServerId: homeServer.id },
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
          content: `NEURAL LINK TERMINAL — ${username}\n═══════════════════════════════════\n\nTerminal IP: ${homeIp}\nSecurity Clearance: Basic\nNetwork Gateway: 10.0.0.1 (Internet Exchange)\n\nQUICK START:\n  scan          — Discover servers on your network\n  connect 10.0.0.1  — Connect to the Internet Exchange\n  help          — List all available commands\n  status        — View your profile and skills\n  tutorial      — Check training progress\n\nThe network is vast. Every server holds secrets.\nEvery faction has an agenda. Trust is earned.\n\n— System Administrator`,
          permissions: { owner: 15, faction: 0, others: 1 },
          createdBy: user.id,
          size: 200,
          isEncrypted: false,
          isHidden: false,
          isProtected: true,
        },
      });

      return { user, homeServerId: homeServer.id };
    });

    const { homeServerId } = result;

    // Initialize faction standings for new user
    try {
      const factionService = await resolve<FactionService>(FACTION_SERVICE);
      await factionService.initializeStandings(result.user.id);
    } catch (factionErr) {
      // Non-critical: standings will be created on first interaction
      this.logger.warn({ err: factionErr, userId: result.user.id }, "Failed to initialize faction standings");
    }

    // Link home server to Internet Exchange (using ID from transaction, no re-query)
    try {
      const topoService = await resolve<NetworkTopologyService>(NETWORK_TOPOLOGY_SERVICE);
      if (homeServerId) {
        await topoService.createHomeLink(homeServerId);
        this.logger.info({ homeServerId }, "Home server linked to Internet Exchange");
      }
    } catch (err) {
      this.logger.warn({ err, homeIp }, "Failed to link home server to IX on registration (will retry on session)");
    }

    const token = this.generateToken(result.user.id);
    await this.createSession(result.user.id, token, meta);

    // Log successful registration
    await prisma.auditLog.create({
      data: {
        userId: result.user.id,
        action: "user_registered",
        resource: "user",
        resourceId: result.user.id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
        metadata: {
          username,
          homeIp,
        },
      },
    });

    return { token, user: result.user };
  }

  // ==================== LOGIN ====================

  async login(
    input: { username: string; password: string },
    meta: AuthRequestMeta,
  ): Promise<{ token: string; user: User }> {
    const { username, password } = input;
    const ip = meta.lockoutIp;

    // Check per-IP lockout (blocks entire IP after too many failed attempts across all usernames)
    const ipLockoutKey = `ip:${ip}`;
    const ipAttempts = this.loginAttempts.get(ipLockoutKey);
    if (ipAttempts) {
      if (Date.now() - ipAttempts.firstAttempt > AuthService.LOGIN_ATTEMPT_WINDOW_MS) {
        this.loginAttempts.delete(ipLockoutKey);
      } else if (ipAttempts.count >= AuthService.MAX_IP_LOGIN_ATTEMPTS) {
        const remainingMs = AuthService.LOGIN_ATTEMPT_WINDOW_MS - (Date.now() - ipAttempts.firstAttempt);
        const remainingMin = Math.ceil(remainingMs / 60000);
        throw new GameError(
          `Too many failed attempts from this IP. Try again in ${remainingMin} minute${remainingMin > 1 ? "s" : ""}.`,
          "IP_LOCKED",
          429,
        );
      }
    }

    // Check per-account lockout (keyed by IP + username to prevent cross-user lockout attacks)
    const lockoutKey = `${ip}:${username.toLowerCase()}`;
    const attempts = this.loginAttempts.get(lockoutKey);
    if (attempts) {
      if (Date.now() - attempts.firstAttempt > AuthService.LOGIN_ATTEMPT_WINDOW_MS) {
        this.loginAttempts.delete(lockoutKey); // Window expired, reset
      } else if (attempts.count >= AuthService.MAX_LOGIN_ATTEMPTS) {
        const remainingMs = AuthService.LOGIN_ATTEMPT_WINDOW_MS - (Date.now() - attempts.firstAttempt);
        const remainingMin = Math.ceil(remainingMs / 60000);
        throw new GameError(
          `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin > 1 ? "s" : ""}.`,
          "ACCOUNT_LOCKED",
          429,
        );
      }
    }

    // Record a failed attempt (per IP+username and per IP)
    const recordFailure = () => {
      const prev = this.loginAttempts.get(lockoutKey);
      if (prev) { prev.count++; } else { this.loginAttempts.set(lockoutKey, { count: 1, firstAttempt: Date.now() }); }
      const ipPrev = this.loginAttempts.get(ipLockoutKey);
      if (ipPrev) { ipPrev.count++; } else { this.loginAttempts.set(ipLockoutKey, { count: 1, firstAttempt: Date.now() }); }
    };

    // Find user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { username },
          { email: username }, // Allow login with email
        ],
        isActive: true,
      },
      select: { ...USER_SELECT, password: true },
    });

    if (!user) {
      recordFailure();
      throw new GameError("Invalid username or password", "AUTH_FAILED", 401);
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      recordFailure();
      throw new GameError("Invalid username or password", "AUTH_FAILED", 401);
    }

    // Clear lockout on successful login
    this.loginAttempts.delete(lockoutKey);

    // Update last login and online status
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLogin: new Date(),
        isOnline: true,
      },
    });

    const token = this.generateToken(user.id);
    await this.createSession(user.id, token, meta);

    // Log successful login
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "user_login",
        resource: "user",
        resourceId: user.id,
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;
    return { token, user: userWithoutPassword as unknown as User };
  }

  // ==================== LOGOUT / VERIFY / REFRESH ====================

  /** Deactivates only the caller's own session for this token. */
  async logout(userId: string, token: string, meta: AuthRequestMeta): Promise<void> {
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
        ipAddress: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  }

  async verify(token: string) {
    const decoded = jwt.verify(token, config.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as { userId: string };

    // Check if session is active
    const session = await prisma.userSession.findFirst({
      where: {
        token,
        isActive: true,
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) throw new GameError("Session expired or invalid", "SESSION_EXPIRED", 401);

    // Get user info
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: USER_SELECT,
    });

    if (!user || !user.isActive) throw new GameError("User not found or inactive", "AUTH_FAILED", 401);

    return user;
  }

  /** Issues a new token + session and deactivates the old one. */
  async refresh(userId: string, oldToken: string | undefined, meta: AuthRequestMeta): Promise<string> {
    if (oldToken) {
      invalidateAuthCache(oldToken);
      await prisma.userSession.updateMany({
        where: { token: oldToken, userId },
        data: { isActive: false },
      });
    }

    const newToken = this.generateToken(userId);
    await this.createSession(userId, newToken, meta);
    return newToken;
  }
}

export default AuthService;
