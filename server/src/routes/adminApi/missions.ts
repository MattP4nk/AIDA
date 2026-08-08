import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError } from "../../../../shared/types";

const router = Router();

// GET / — List missions with filtering and pagination
router.get("/", asyncHandler(async (req: any, res: any) => {
  const { status, type, factionId, page = "1", limit = "50" } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (factionId) where.factionId = factionId;

  const [missions, total] = await Promise.all([
    prisma.mission.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
    }),
    prisma.mission.count({ where }),
  ]);

  res.json({
    success: true,
    data: missions,
    total,
    page: Number(page),
    limit: Number(limit),
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get mission details
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const mission = await prisma.mission.findUnique({
    where: { id: req.params.id },
    include: {
      faction: true,
      assignee: { select: { id: true, username: true } },
      creator: { select: { id: true, username: true } },
    },
  });

  if (!mission) throw new NotFoundError("Mission not found");

  res.json({
    success: true,
    data: mission,
    timestamp: new Date().toISOString(),
  });
}));

// POST / — Create mission
router.post("/", asyncHandler(async (req: any, res: any) => {
  const { title, description, type, difficulty, reward, objectives, factionId, createdBy } =
    req.body;

  if (!title || !description || !type) {
    throw new ValidationError("title, description, and type are required");
  }

  const mission = await prisma.mission.create({
    data: {
      title,
      description,
      type,
      difficulty: difficulty ?? 1,
      reward: reward ?? {},
      objectives: objectives ?? [],
      factionId: factionId ?? undefined,
      createdBy: createdBy ?? undefined,
    },
  });

  res.status(201).json({
    success: true,
    data: mission,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id — Update mission
router.put("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.mission.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Mission not found");

  const { title, description, type, difficulty, reward, objectives, factionId, status, expiresAt } = req.body;
  const data: Record<string, any> = {};
  if (title !== undefined) data.title = title;
  if (description !== undefined) data.description = description;
  if (type !== undefined) data.type = type;
  if (difficulty !== undefined) data.difficulty = difficulty;
  if (reward !== undefined) data.reward = reward;
  if (objectives !== undefined) data.objectives = objectives;
  if (factionId !== undefined) data.factionId = factionId;
  if (status !== undefined) data.status = status;
  if (expiresAt !== undefined) data.expiresAt = expiresAt;

  const mission = await prisma.mission.update({
    where: { id: req.params.id },
    data,
  });

  res.json({
    success: true,
    data: mission,
    timestamp: new Date().toISOString(),
  });
}));

// DELETE /:id — Delete mission
router.delete("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.mission.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Mission not found");

  await prisma.mission.delete({ where: { id: req.params.id } });

  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
