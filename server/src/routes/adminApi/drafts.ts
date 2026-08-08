import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError } from "../../../../shared/types";

const router = Router();

// GET / — List drafts with filtering and pagination
router.get("/", asyncHandler(async (req: any, res: any) => {
  const {
    status = "draft",
    type,
    source,
    page = "1",
    limit = "50",
  } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (source) where.source = source;

  const [drafts, total] = await Promise.all([
    prisma.contentDraft.findMany({
      where,
      skip,
      take: Number(limit),
      orderBy: { createdAt: "desc" },
    }),
    prisma.contentDraft.count({ where }),
  ]);

  res.json({
    success: true,
    data: drafts,
    total,
    page: Number(page),
    limit: Number(limit),
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get draft with full payload
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const draft = await prisma.contentDraft.findUnique({
    where: { id: req.params.id },
  });

  if (!draft) throw new NotFoundError("Draft not found");

  res.json({
    success: true,
    data: draft,
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/approve — Approve draft and create the actual game entity
router.post("/:id/approve", asyncHandler(async (req: any, res: any) => {
  const { reviewNote } = req.body;
  const { getService } = await import("../../di/container");
  const { CONTENT_DRAFT_SERVICE } = await import("../../di/tokens");
  const draftService = getService<any>(CONTENT_DRAFT_SERVICE);

  const { draft, resultId } = await draftService.approveDraft(
    req.params.id,
    req.user?.id ?? "admin",
    reviewNote,
  );

  res.json({
    success: true,
    data: { ...draft, resultId },
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/reject — Reject draft
router.post("/:id/reject", asyncHandler(async (req: any, res: any) => {
  const { reviewNote } = req.body;

  if (!reviewNote) {
    throw new ValidationError("reviewNote is required when rejecting a draft");
  }

  const draft = await prisma.contentDraft.findUnique({
    where: { id: req.params.id },
  });
  if (!draft) throw new NotFoundError("Draft not found");

  if (draft.status !== "draft") {
    throw new ValidationError(`Cannot reject draft with status '${draft.status}'`);
  }

  const updated = await prisma.contentDraft.update({
    where: { id: req.params.id },
    data: {
      status: "rejected",
      reviewNote,
      reviewedBy: req.user?.id ?? "admin",
      reviewedAt: new Date(),
    },
  });

  res.json({
    success: true,
    data: updated,
    timestamp: new Date().toISOString(),
  });
}));

// DELETE /:id — Delete draft
router.delete("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.contentDraft.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Draft not found");

  await prisma.contentDraft.delete({ where: { id: req.params.id } });

  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

export default router;
