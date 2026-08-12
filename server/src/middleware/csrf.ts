import crypto, { timingSafeEqual } from "crypto";
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

/** Hash JWT before using as Map key — prevents raw token exposure in memory dumps. */
const hashKey = (jwt: string): string =>
  crypto.createHash("sha256").update(jwt).digest("hex");

const csrfTokenStore = new Map<string, Array<{ token: string; expires: number }>>();

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
  for (const [key, tokens] of csrfTokenStore) {
    const valid = tokens.filter((t) => t.expires >= now);
    if (valid.length === 0) {
      csrfTokenStore.delete(key);
    } else {
      csrfTokenStore.set(key, valid);
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

  const existing = csrfTokenStore.get(hashKey(jwtToken)) || [];
  existing.push({ token, expires });
  // Keep only the latest 3 tokens
  if (existing.length > 3) existing.shift();
  csrfTokenStore.set(hashKey(jwtToken), existing);

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
  if (SKIP_PATHS.some((p) => req.path === p)) return next();

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

  const key = hashKey(jwtToken);
  const storedTokens = csrfTokenStore.get(key);
  if (!storedTokens || storedTokens.length === 0) {
    return res.status(403).json({
      success: false,
      error: "Invalid or expired CSRF token",
      timestamp: new Date().toISOString(),
    });
  }

  const validToken = storedTokens.find((stored) => {
    if (stored.expires < Date.now()) return false;
    try {
      const tokenBuf = Buffer.from(csrfToken, "hex");
      const storedBuf = Buffer.from(stored.token, "hex");
      return (
        tokenBuf.length === storedBuf.length &&
        timingSafeEqual(tokenBuf, storedBuf)
      );
    } catch {
      return false;
    }
  });

  if (!validToken) {
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
