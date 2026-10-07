import { Router } from "express";

import { authenticateToken, AUTH_COOKIE_NAME, AUTH_COOKIE_OPTIONS } from "../middleware/auth";
import { asyncHandler } from "../middleware/setup";
import { getService } from "../di/container";
import { AUTH_SERVICE } from "../di/tokens";
import type { AuthService, AuthRequestMeta } from "../services/authService";
import { GameError, type AuthRequest, type AuthResponse } from "../../../shared/types";
import {
  validateRegistration,
  validateLogin,
  handleValidationErrors,
} from "../middleware/validation";

/**
 * HTTP adapters for the auth domain. A8: every rule — provisioning, lockout,
 * sessions, audit — lives in services/authService.ts. These only validate,
 * call, set or clear the cookie, and shape the response.
 */
const router = Router();

const auth = () => getService<AuthService>(AUTH_SERVICE);

const meta = (req: any): AuthRequestMeta => ({
  ip: req.ip || null,
  userAgent: req.get("User-Agent") || null,
  lockoutIp: req.ip || req.socket.remoteAddress || "unknown",
});

/** The token from the httpOnly cookie, or a Bearer header (Socket.IO clients). */
const requestToken = (req: any): string | undefined =>
  req.cookies?.[AUTH_COOKIE_NAME] ||
  req.headers.authorization?.replace("Bearer ", "");

// User Registration
router.post(
  "/register",
  validateRegistration(),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { token, user } = await auth().register(
      req.body as { username: string; email: string; password: string },
      meta(req),
    );

    // Set httpOnly cookie with JWT
    res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

    // Note: Token is returned in both the cookie AND the JSON body.
    // The body token is needed for Socket.IO auth (cookies can't be sent via WebSocket handshake).
    // This is an intentional security tradeoff — XSS can access the body token,
    // but the httpOnly cookie remains the primary session mechanism.
    const response: AuthResponse = {
      success: true,
      token,
      user,
      message: "Account created successfully",
    };

    res.status(201).json(response);
  }),
);

// User Login
router.post(
  "/login",
  validateLogin(),
  handleValidationErrors,
  asyncHandler(async (req: any, res: any) => {
    const { username, password }: AuthRequest = req.body;
    const { token, user } = await auth().login({ username, password }, meta(req));

    // Set httpOnly cookie with JWT
    res.cookie(AUTH_COOKIE_NAME, token, AUTH_COOKIE_OPTIONS);

    const response: AuthResponse = {
      success: true,
      token,
      user,
      message: "Login successful",
    };

    res.json(response);
  }),
);

// User Logout (authenticated — only deactivates YOUR session)
router.post("/logout", authenticateToken, asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new GameError("Not authenticated", "AUTH_REQUIRED", 401);

    const token = requestToken(req);
    if (token) await auth().logout(userId, token, meta(req));

    // Clear the httpOnly cookie
    res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });

    res.json({
      success: true,
      message: "Logged out successfully",
      timestamp: new Date(),
    });
}));

// Verify Token
router.get("/verify", asyncHandler(async (req: any, res: any) => {
    const token = requestToken(req);
    if (!token) throw new GameError("No token provided", "AUTH_REQUIRED", 401);

    const user = await auth().verify(token);

    res.json({
      success: true,
      token, // Return token so client can restore it for Socket.IO auth
      user,
      timestamp: new Date(),
    });
}));

// Refresh Token — issues a new JWT + cookie, deactivates old session
router.post("/refresh", authenticateToken, asyncHandler(async (req, res) => {
    const userId = req.user?.id;
    if (!userId) throw new GameError("Not authenticated", "AUTH_REQUIRED", 401);

    const newToken = await auth().refresh(userId, requestToken(req), meta(req));

    // Set new cookie
    res.cookie(AUTH_COOKIE_NAME, newToken, AUTH_COOKIE_OPTIONS);

    res.json({
      success: true,
      token: newToken,
      message: "Token refreshed",
      timestamp: new Date(),
    });
}));

export default router;
