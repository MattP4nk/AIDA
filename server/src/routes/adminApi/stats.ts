import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";

const router = Router();

// GET /dashboard — Return aggregate stats
router.get("/dashboard", asyncHandler(async (_req: any, res: any) => {
  const [
    playerCount,
    serverCount,
    networkCount,
    missionCount,
    activeMissionCount,
    forumCount,
    pendingDraftCount,
    currentEpoch,
    recentEvents,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "player" } }),
    prisma.gameServer.count(),
    prisma.network.count(),
    prisma.mission.count(),
    prisma.mission.count({ where: { status: "active" } }),
    prisma.forum.count(),
    prisma.contentDraft.count({ where: { status: "draft" } }),
    prisma.narrativeEpoch.findFirst({ where: { status: "active" } }),
    prisma.storyLedger.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  res.json({
    success: true,
    data: {
      playerCount,
      serverCount,
      networkCount,
      missionCount,
      activeMissionCount,
      forumCount,
      pendingDraftCount,
      currentEpoch,
      recentEvents,
    },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
