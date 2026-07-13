import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { verifySocketToken, AUTH_COOKIE_NAME } from "./auth";

/**
 * CSRF Protection using custom header validation (no cookies needed for JWT-based auth).
 *
 * Token lifecycle:
 *  1. Client authenticates via JWT
 *  2. Client calls GET /api/csrf-token to obtain a CSRF token
 *  3. Client sends X-CSRF-Token header on state-changing requests (POST/PUT/DELETE)
 *  4. This middleware validates the token against the in-memory store
 */

const CSRF_TOKEN_TTL_MS = 3_600_000; // 1 hour
const CLEANUP_THRESHOLD = 500;

const csrfTokenStore = new Map<string, { token: string; expires: number }>();

// ── Periodic cleanup (runs every 10 minutes) ─────────────────────
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanupTimer(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(cleanupExpiredTokens, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref(); // Don't prevent process exit
}

function cleanupExpiredTokens(): void {
  const now = Date.now();
  for (const [key, value] of csrfTokenStore) {
    if (value.expires < now) {
      csrfTokenStore.delete(key);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Generate a CSRF token tied to the given JWT token.
 */
export function generateCsrfToken(jwtToken: string): string {
  startCleanupTimer();

  const token = crypto.randomBytes(32).toString("hex");
  const expires = Date.now() + CSRF_TOKEN_TTL_MS;

  csrfTokenStore.set(jwtToken, { token, expires });

  // Eager cleanup if store gets large
  if (csrfTokenStore.size > CLEANUP_THRESHOLD) {
    cleanupExpiredTokens();
  }

  return token;
}

/**
 * Express middleware — validates CSRF token on state-changing methods.
 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SKIP_PATHS = [
  "/health",
  "/api/auth/login",
  "/api/auth/register",
  "/api/csrf-token",
];

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void | Response {
  if (SAFE_METHODS.has(req.method)) return next();
  if (SKIP_PATHS.some((p) => req.path.startsWith(p))) return next();

  const csrfToken = req.headers["x-csrf-token"] as string;
  const authHeader = req.headers.authorization as string;

  if (!csrfToken) {
    return res.status(403).json({
      success: false,
      error: "CSRF token required",
      timestamp: new Date().toISOString(),
    });
  }

  // Read JWT from cookie or Authorization header
  const jwtToken =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    authHeader?.replace("Bearer ", "");
  if (!jwtToken) {
    return res.status(403).json({
      success: false,
      error: "Authentication required",
      timestamp: new Date().toISOString(),
    });
  }

  const stored = csrfTokenStore.get(jwtToken);
  if (!stored || stored.token !== csrfToken || stored.expires < Date.now()) {
    return res.status(403).json({
      success: false,
      error: "Invalid or expired CSRF token",
      timestamp: new Date().toISOString(),
    });
  }

  next();
}

/**
 * Express route handler for GET /api/csrf-token.
 */
export async function csrfTokenEndpoint(
  req: Request,
  res: Response,
): Promise<void> {
  // Read JWT from cookie or Authorization header
  const authHeader = req.headers.authorization as string;
  const jwtToken =
    req.cookies?.[AUTH_COOKIE_NAME] ||
    authHeader?.replace("Bearer ", "");

  if (!jwtToken) {
    res.status(401).json({
      success: false,
      error: "Authentication required",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const user = await verifySocketToken(jwtToken);
  if (!user) {
    res.status(401).json({
      success: false,
      error: "Invalid authentication token",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const csrfToken = generateCsrfToken(jwtToken);
  res.json({
    success: true,
    csrfToken,
    expiresIn: CSRF_TOKEN_TTL_MS,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Cleanup for graceful shutdown.
 */
export function stopCsrfCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
