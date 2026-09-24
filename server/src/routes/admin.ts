import { Router } from "express";
import { db } from "../database/client";
import { authenticateToken, requireRole } from "../middleware/auth";
import { getService } from "../di/container";
import { GAME_STATE_MANAGER } from "../di/tokens";
import type GameStateManager from "../services/gameStateManager";
import type { AIService } from "../services/aiService";

const router = Router();

/**
 * GET /health — public health check (no auth required)
 */
/**
 * Cached AI health, so /health cannot be used to hammer the AI backend.
 *
 * Review finding: this route is PUBLIC (no auth — the rest of this router is
 * authenticated, but the health check deliberately is not), it is mounted at
 * the app root so the `/api` rate limiter does not cover it, and CSRF exempts
 * it. Calling `checkHealth()` per request therefore turned every probe into an
 * outbound Ollama request: a 5s liveness probe is ~17k extra calls a day, and
 * an unauthenticated loop becomes an amplifier against the backend the game
 * depends on. The probe is now bounded AND its result reused.
 */
let aiHealthCache: { at: number; value: Record<string, unknown> } | null = null;
const AI_HEALTH_TTL_MS = 10_000;

async function getAiHealthCached(): Promise<Record<string, unknown>> {
  if (aiHealthCache && Date.now() - aiHealthCache.at < AI_HEALTH_TTL_MS) {
    return { ...aiHealthCache.value, cached: true };
  }
  let value: Record<string, unknown>;
  try {
    const { getService } = await import("../di/container");
    const { AI_SERVICE } = await import("../di/tokens");
    const aiService = getService<AIService>(AI_SERVICE);
    const reachable = await aiService.checkHealth();
    value = { status: reachable ? "connected" : "unreachable", ...aiService.getMetrics() };
  } catch (err) {
    value = { status: "unavailable", error: err instanceof Error ? err.message : "unknown" };
  }
  aiHealthCache = { at: Date.now(), value };
  return value;
}

router.get("/health", async (_req, res) => {
  const dbHealth = await db.healthCheck();

  // R14c: the Phase 6 gate is "an AI outage is visible in logs AND on the
  // health endpoint". This route reported the database only, while
  // `checkHealth()` and `getMetrics()` existed on AIService with ZERO callers
  // outside a manual script — so a total AI outage was invisible here and the
  // game merely served duller prose.
  const ai = await getAiHealthCached();

  // The DB alone decides 200/503: the game is playable without AI (that is
  // what the fallbacks are for), so an AI outage must be VISIBLE without
  // making an orchestrator kill a serving process.
  const status = dbHealth ? (ai.status === "connected" ? "healthy" : "degraded") : "unhealthy";

  res.status(dbHealth ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    database: dbHealth ? "connected" : "disconnected",
    ai,
  });
});

/**
 * GET /api/stats/sessions — session monitoring (authenticated)
 */
router.get("/api/stats/sessions", authenticateToken, requireRole("moderator"), (_req, res) => {
  try {
    const gsm = getService<GameStateManager>(GAME_STATE_MANAGER);
    const stats = gsm.getStats();
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      success: false,
      error: "GameStateManager not initialized",
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * POST /api/admin/cleanup-sessions — manual session cleanup
 */
router.post("/api/admin/cleanup-sessions", authenticateToken, requireRole("admin"), async (_req, res) => {
  try {
    const gsm = getService<GameStateManager>(GAME_STATE_MANAGER);
    const count = await gsm.cleanupIdleSessions();
    res.json({
      success: true,
      message: `Cleaned up ${count} idle sessions`,
      count,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      success: false,
      error: "GameStateManager not initialized",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
