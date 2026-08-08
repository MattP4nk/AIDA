import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError, GameError } from "../../../../shared/types";

const router = Router();

// GET / — List forums with post count
router.get("/", asyncHandler(async (_req: any, res: any) => {
  const forums = await prisma.forum.findMany({
    include: {
      faction: { select: { id: true, name: true } },
      _count: { select: { posts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    success: true,
    data: forums,
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get forum with recent posts (last 20)
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const forum = await prisma.forum.findUnique({
    where: { id: req.params.id },
    include: {
      faction: { select: { id: true, name: true } },
      posts: {
        take: 20,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { replies: true } },
        },
      },
      _count: { select: { posts: true, members: true } },
    },
  });

  if (!forum) throw new NotFoundError("Forum not found");

  res.json({
    success: true,
    data: forum,
    timestamp: new Date().toISOString(),
  });
}));

// POST / — Create forum
router.post("/", asyncHandler(async (req: any, res: any) => {
  const {
    name,
    url,
    description,
    category,
    securityLevel,
    isHoneypot,
    requiresProxy,
    factionId,
  } = req.body;

  if (!name || !url || !description || !category || securityLevel === undefined) {
    throw new ValidationError("name, url, description, category, and securityLevel are required");
  }

  // Check URL uniqueness
  const existing = await prisma.forum.findUnique({ where: { url } });
  if (existing) {
    throw new GameError(`Forum URL '${url}' is already in use`, "CONFLICT", 409);
  }

  const forum = await prisma.forum.create({
    data: {
      name,
      url,
      description,
      category,
      securityLevel: Number(securityLevel),
      isHoneypot: isHoneypot ?? false,
      requiresProxy: requiresProxy ?? false,
      factionId: factionId ?? undefined,
    },
  });

  res.status(201).json({
    success: true,
    data: forum,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id — Update forum
router.put("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.forum.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Forum not found");

  const { name, url, description, category, factionId, accessLevel, isHoneypot, isPublic, status } = req.body;
  const data: Record<string, any> = {};
  if (name !== undefined) data.name = name;
  if (url !== undefined) data.url = url;
  if (description !== undefined) data.description = description;
  if (category !== undefined) data.category = category;
  if (factionId !== undefined) data.factionId = factionId;
  if (accessLevel !== undefined) data.accessLevel = accessLevel;
  if (isHoneypot !== undefined) data.isHoneypot = isHoneypot;
  if (isPublic !== undefined) data.isPublic = isPublic;
  if (status !== undefined) data.status = status;

  const forum = await prisma.forum.update({
    where: { id: req.params.id },
    data,
  });

  res.json({
    success: true,
    data: forum,
    timestamp: new Date().toISOString(),
  });
}));

// DELETE /:id — Delete forum (cascades posts via schema)
router.delete("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.forum.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Forum not found");

  await prisma.forum.delete({ where: { id: req.params.id } });

  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/posts — Create post in forum
router.post("/:id/posts", asyncHandler(async (req: any, res: any) => {
  const { authorId, authorHandle, title, content, tags, isSticky, isPinned } =
    req.body;

  if (!authorId || !authorHandle || !title || !content) {
    throw new ValidationError("authorId, authorHandle, title, and content are required");
  }

  const forum = await prisma.forum.findUnique({
    where: { id: req.params.id },
  });
  if (!forum) throw new NotFoundError("Forum not found");

  const post = await prisma.post.create({
    data: {
      forumId: req.params.id,
      authorId,
      authorHandle,
      title,
      content,
      tags: tags ?? [],
      isSticky: isSticky ?? false,
      isPinned: isPinned ?? false,
    },
  });

  res.status(201).json({
    success: true,
    data: post,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
