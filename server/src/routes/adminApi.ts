/**
 * Admin API Router — mounts all admin sub-routers.
 * All routes require admin role authentication.
 */
import { Router } from "express";
import { authenticateToken, requireRole } from "../middleware/auth";

import serversRouter from "./adminApi/servers";
import networksRouter from "./adminApi/networks";
import missionsRouter from "./adminApi/missions";
import forumsRouter from "./adminApi/forums";
import epochsRouter from "./adminApi/epochs";
import draftsRouter from "./adminApi/drafts";
import statsRouter from "./adminApi/stats";
import playersRouter from "./adminApi/players";

const router = Router();

// All admin API routes require admin role
router.use(authenticateToken, requireRole("admin"));

router.use("/servers", serversRouter);
router.use("/networks", networksRouter);
router.use("/missions", missionsRouter);
router.use("/forums", forumsRouter);
router.use("/epochs", epochsRouter);
router.use("/drafts", draftsRouter);
router.use("/stats", statsRouter);
router.use("/players", playersRouter);

export default router;
