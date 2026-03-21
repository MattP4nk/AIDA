import { Router } from "express";
import { db } from "../database/client";
import { authenticateToken, requireRole } from "../middleware/auth";
import { getService } from "../di/container";
import { GAME_STATE_MANAGER } from "../di/tokens";
import type GameStateManager from "../services/gameStateManager";

const router = Router();

/**
 * GET /health — public health check (no auth required)
 */
router.get("/health", async (_req, res) => {
  const dbHealth = await db.healthCheck();
  const status = dbHealth ? "healthy" : "unhealthy";

  res.status(dbHealth ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    database: dbHealth ? "connected" : "disconnected",
    version: process.env.npm_package_version || "1.0.0",
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
