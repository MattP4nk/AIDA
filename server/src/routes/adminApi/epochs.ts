import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError, GameError } from "../../../../shared/types";

const router = Router();

// GET / — List epochs ordered by order field
router.get("/", asyncHandler(async (_req: any, res: any) => {
  const epochs = await prisma.narrativeEpoch.findMany({
    orderBy: { order: "asc" },
    include: {
      _count: { select: { events: true } },
    },
  });

  res.json({
    success: true,
    data: epochs,
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get epoch with its events
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const epoch = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
    include: {
      events: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!epoch) throw new NotFoundError("Epoch not found");

  res.json({
    success: true,
    data: epoch,
    timestamp: new Date().toISOString(),
  });
}));

// POST / — Create epoch
router.post("/", asyncHandler(async (req: any, res: any) => {
  const { epochNum, title, description, summary, status, order } = req.body;

  if (epochNum === undefined || !title || !summary) {
    throw new ValidationError("epochNum, title, and summary are required");
  }

  // Check epochNum uniqueness
  const existing = await prisma.narrativeEpoch.findUnique({
    where: { epochNum: Number(epochNum) },
  });
  if (existing) {
    throw new GameError(`Epoch number ${epochNum} already exists`, "CONFLICT", 409);
  }

  const epoch = await prisma.narrativeEpoch.create({
    data: {
      epochNum: Number(epochNum),
      title,
      description: description ?? undefined,
      summary,
      status: status ?? "draft",
      order: order ?? Number(epochNum),
    },
  });

  res.status(201).json({
    success: true,
    data: epoch,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id — Update epoch
router.put("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Epoch not found");

  const { name, description, status, order, metadata } = req.body;
  const data: Record<string, any> = {};
  if (name !== undefined) data.name = name;
  if (description !== undefined) data.description = description;
  if (status !== undefined) data.status = status;
  if (order !== undefined) data.order = order;
  if (metadata !== undefined) data.metadata = metadata;

  const epoch = await prisma.narrativeEpoch.update({
    where: { id: req.params.id },
    data,
  });

  res.json({
    success: true,
    data: epoch,
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/activate — Set epoch to active, deactivate others
router.post("/:id/activate", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Epoch not found");

  // Deactivate all active epochs, then activate this one
  await prisma.$transaction([
    prisma.narrativeEpoch.updateMany({
      where: { status: "active" },
      data: { status: "draft" },
    }),
    prisma.narrativeEpoch.update({
      where: { id: req.params.id },
      data: { status: "active" },
    }),
  ]);

  const epoch = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
  });

  res.json({
    success: true,
    data: epoch,
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/complete — Set epoch to completed, set endedAt
router.post("/:id/complete", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Epoch not found");

  const epoch = await prisma.narrativeEpoch.update({
    where: { id: req.params.id },
    data: {
      status: "completed",
      endedAt: new Date(),
    },
  });

  res.json({
    success: true,
    data: epoch,
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id/events — List epoch events
router.get("/:id/events", asyncHandler(async (req: any, res: any) => {
  const epoch = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
  });
  if (!epoch) throw new NotFoundError("Epoch not found");

  const events = await prisma.epochEvent.findMany({
    where: { epochId: req.params.id },
    orderBy: { createdAt: "asc" },
  });

  res.json({
    success: true,
    data: events,
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/events — Create event in epoch
router.post("/:id/events", asyncHandler(async (req: any, res: any) => {
  const { name, description, triggerType, scheduledAt, condition, payload } =
    req.body;

  if (!name || !description) {
    throw new ValidationError("name and description are required");
  }

  const epoch = await prisma.narrativeEpoch.findUnique({
    where: { id: req.params.id },
  });
  if (!epoch) throw new NotFoundError("Epoch not found");

  const epochId: string = req.params.id;
  const createData: Record<string, unknown> = {
    epochId,
    name,
    description,
    triggerType: triggerType ?? "manual",
    payload: payload ?? {},
  };
  if (scheduledAt) createData.scheduledAt = new Date(scheduledAt);
  if (condition) createData.condition = condition;

  const event = await prisma.epochEvent.create({
    data: createData as any,
  });

  res.status(201).json({
    success: true,
    data: event,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id/events/:eventId — Update event
router.put("/:id/events/:eventId", asyncHandler(async (req: any, res: any) => {
  const event = await prisma.epochEvent.findFirst({
    where: { id: req.params.eventId, epochId: req.params.id },
  });
  if (!event) throw new NotFoundError("Event not found in this epoch");

  // Handle scheduledAt conversion if present
  const data = { ...req.body };
  if (data.scheduledAt) {
    data.scheduledAt = new Date(data.scheduledAt);
  }

  const updated = await prisma.epochEvent.update({
    where: { id: req.params.eventId },
    data,
  });

  res.json({
    success: true,
    data: updated,
    timestamp: new Date().toISOString(),
  });
}));

// DELETE /:id/events/:eventId — Delete event
router.delete("/:id/events/:eventId", asyncHandler(async (req: any, res: any) => {
  const event = await prisma.epochEvent.findFirst({
    where: { id: req.params.eventId, epochId: req.params.id },
  });
  if (!event) throw new NotFoundError("Event not found in this epoch");

  await prisma.epochEvent.delete({ where: { id: req.params.eventId } });

  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/events/:eventId/fire — Manually fire event
router.post("/:id/events/:eventId/fire", asyncHandler(async (req: any, res: any) => {
  const event = await prisma.epochEvent.findFirst({
    where: { id: req.params.eventId, epochId: req.params.id },
  });
  if (!event) throw new NotFoundError("Event not found in this epoch");

  if (event.status === "fired") {
    throw new ValidationError("Event has already been fired");
  }

  // Use EpochSchedulerService to actually execute the event payload
  const { getService } = await import("../../di/container");
  const { EPOCH_SCHEDULER_SERVICE } = await import("../../di/tokens");
  const scheduler = getService<any>(EPOCH_SCHEDULER_SERVICE);
  await scheduler.fireEvent(event);

  // Re-fetch the updated event
  const fired = await prisma.epochEvent.findUnique({
    where: { id: req.params.eventId },
  });

  res.json({
    success: true,
    data: fired,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
