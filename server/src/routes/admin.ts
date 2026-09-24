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
router.get("/health", async (_req, res) => {
  const dbHealth = await db.healthCheck();

  // R14c: the Phase 6 gate is "an AI outage is visible in logs AND on the
  // health endpoint". This route reported the database only, while
  // `checkHealth()` and `getMetrics()` existed on AIService with ZERO callers
  // outside a manual script — so a total AI outage was invisible here and the
  // game merely served duller prose.
  let ai: Record<string, unknown> = { status: "unknown" };
  try {
    const { getService } = await import("../di/container");
    const { AI_SERVICE } = await import("../di/tokens");
    const aiService = getService<AIService>(AI_SERVICE);
    const reachable = await aiService.checkHealth();
    const metrics = aiService.getMetrics();
    ai = {
      status: reachable ? "connected" : "unreachable",
      ...metrics,
    };
  } catch (err) {
    ai = { status: "unavailable", error: err instanceof Error ? err.message : "unknown" };
  }

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
