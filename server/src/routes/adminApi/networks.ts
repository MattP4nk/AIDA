import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError, GameError } from "../../../../shared/types";

const router = Router();

// GET / — List networks with server count
router.get("/", asyncHandler(async (_req: any, res: any) => {
  const networks = await prisma.network.findMany({
    include: {
      _count: { select: { servers: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const data = networks.map((n) => ({
    ...n,
    _count: { servers: n._count.servers },
  }));

  res.json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get network with its servers
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const network = await prisma.network.findUnique({
    where: { id: req.params.id },
    include: {
      servers: {
        orderBy: { name: "asc" },
      },
    },
  });

  if (!network) throw new NotFoundError("Network not found");

  res.json({
    success: true,
    data: network,
    timestamp: new Date().toISOString(),
  });
}));

// POST / — Create network
router.post("/", asyncHandler(async (req: any, res: any) => {
  const { name, description, zone } = req.body;

  if (!name || !zone) {
    throw new ValidationError("name and zone are required");
  }

  // Check name uniqueness
  const existing = await prisma.network.findUnique({ where: { name } });
  if (existing) {
    throw new GameError(`Network name '${name}' is already in use`, "CONFLICT", 409);
  }

  const network = await prisma.network.create({
    data: {
      name,
      description: description ?? undefined,
      zone,
    },
  });

  res.status(201).json({
    success: true,
    data: network,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id — Update network
router.put("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.network.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Network not found");

  const { name, description, zone } = req.body;
  const data: Record<string, any> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (zone !== undefined) data.zone = zone;

  const network = await prisma.network.update({
    where: { id: req.params.id },
    data,
  });

  res.json({
    success: true,
    data: network,
    timestamp: new Date().toISOString(),
  });
}));

// DELETE /:id — Delete network only if no servers reference it
router.delete("/:id", asyncHandler(async (req: any, res: any) => {
  const network = await prisma.network.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { servers: true } } },
  });

  if (!network) throw new NotFoundError("Network not found");

  if (network._count.servers > 0) {
    throw new GameError(`Cannot delete network: ${network._count.servers} server(s) still reference it`, "CONFLICT", 409);
  }

  await prisma.network.delete({ where: { id: req.params.id } });

  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
