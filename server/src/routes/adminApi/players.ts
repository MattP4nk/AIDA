import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError } from "../../../../shared/types";

const router = Router();

const VALID_ROLES = ["player", "moderator", "admin", "npc"];

// GET / — List players with search and pagination
router.get("/", asyncHandler(async (req: any, res: any) => {
  const { search, page = "1", limit = "50" } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const showNpcs = req.query.showNpcs === "true";
  const where: Record<string, unknown> = {};
  if (!showNpcs) {
    where.role = { not: "npc" };
  }
  if (search) {
    where.username = { contains: String(search), mode: "insensitive" };
  }

  const [players, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: Number(limit),
      select: {
        id: true,
        username: true,
        email: true,
        role: true,
        isActive: true,
        isOnline: true,
        createdAt: true,
        lastLogin: true,
        progress: {
          select: {
            level: true,
            credits: true,
            experience: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);

  res.json({
    success: true,
    data: players,
    total,
    page: Number(page),
    limit: Number(limit),
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get player with full progress, faction membership, active missions
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const player = await prisma.user.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      username: true,
      email: true,
      homeIp: true,
      role: true,
      isActive: true,
      isOnline: true,
      createdAt: true,
      lastLogin: true,
      progress: true,
      factionMembers: {
        include: {
          faction: {
            select: { id: true, name: true, shortName: true },
          },
        },
      },
      missions: {
        where: { status: { in: ["active", "available", "in_progress"] } },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          difficulty: true,
        },
      },
    },
  });

  if (!player) throw new NotFoundError("Player not found");

  res.json({
    success: true,
    data: player,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id/progress — Update player progress
router.put("/:id/progress", asyncHandler(async (req: any, res: any) => {
  const {
    level,
    credits,
    experience,
    hacking,
    networking,
    cryptography,
    stealth,
    socialEng,
    forensics,
  } = req.body;

  // Verify player exists
  const player = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: { progress: true },
  });
  if (!player) throw new NotFoundError("Player not found");

  if (!player.progress) {
    throw new NotFoundError("Player progress record not found");
  }

  const data: Record<string, unknown> = {};
  if (level !== undefined) data.level = Number(level);
  if (credits !== undefined) data.credits = Number(credits);
  if (experience !== undefined) data.experience = Number(experience);
  if (hacking !== undefined) data.hacking = Number(hacking);
  if (networking !== undefined) data.networking = Number(networking);
  if (cryptography !== undefined) data.cryptography = Number(cryptography);
  if (stealth !== undefined) data.stealth = Number(stealth);
  if (socialEng !== undefined) data.socialEng = Number(socialEng);
  if (forensics !== undefined) data.forensics = Number(forensics);

  const progress = await prisma.playerProgress.update({
    where: { userId: req.params.id },
    data,
  });

  res.json({
    success: true,
    data: progress,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id/role — Change player role
router.put("/:id/role", asyncHandler(async (req: any, res: any) => {
  const { role } = req.body;

  if (!role || !VALID_ROLES.includes(role)) {
    throw new ValidationError(`role must be one of: ${VALID_ROLES.join(", ")}`);
  }

  const player = await prisma.user.findUnique({
    where: { id: req.params.id },
  });
  if (!player) throw new NotFoundError("Player not found");

  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { role },
    select: {
      id: true,
      username: true,
      role: true,
    },
  });

  res.json({
    success: true,
    data: updated,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
