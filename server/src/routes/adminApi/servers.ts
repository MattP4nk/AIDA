import { Router } from "express";
import { prisma } from "../../database/client";
import { asyncHandler } from "../../middleware/setup";
import { NotFoundError, ValidationError, GameError } from "../../../../shared/types";

const router = Router();

// GET / — List servers with filtering and pagination
router.get("/", asyncHandler(async (req: any, res: any) => {
  const { type, factionId, networkId, page = "1", limit = "50" } = req.query;
  const skip = (Number(page) - 1) * Number(limit);

  const where: Record<string, unknown> = {};
  if (type) where.type = type;
  if (factionId) where.factionId = factionId;
  if (networkId) where.networkId = networkId;

  const [servers, total] = await Promise.all([
    prisma.gameServer.findMany({
      where,
      skip,
      take: Number(limit),
      include: {
        network: { select: { id: true, name: true } },
        faction: { select: { id: true, name: true } },
        _count: {
          select: { fileSystem: true, linksOut: true, linksIn: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.gameServer.count({ where }),
  ]);

  // Remap counts to match spec naming
  const data = servers.map((s) => ({
    ...s,
    _count: {
      fileSystemNodes: s._count.fileSystem,
      serverLinks: s._count.linksOut + s._count.linksIn,
    },
  }));

  res.json({
    success: true,
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id — Get server by ID with relations
router.get("/:id", asyncHandler(async (req: any, res: any) => {
  const server = await prisma.gameServer.findUnique({
    where: { id: req.params.id },
    include: {
      network: true,
      fileSystem: {
        take: 200,
        orderBy: [{ type: "asc" }, { name: "asc" }],
      },
      linksOut: {
        include: {
          target: { select: { id: true, name: true, ipAddress: true } },
        },
      },
      linksIn: {
        include: {
          source: { select: { id: true, name: true, ipAddress: true } },
        },
      },
    },
  });

  if (!server) throw new NotFoundError("Server not found");

  res.json({
    success: true,
    data: server,
    timestamp: new Date().toISOString(),
  });
}));

// POST / — Create server
router.post("/", asyncHandler(async (req: any, res: any) => {
  const {
    name,
    ipAddress,
    type,
    role,
    networkId,
    factionId,
    securityLevel,
    firewallLevel,
    encryptionLevel,
    discoveryLevel,
    isPublic,
    accessMethod,
    accessKey,
    isOnline,
    maxConnections,
  } = req.body;

  if (!name || !ipAddress || !type) {
    throw new ValidationError("name, ipAddress, and type are required");
  }

  // Check IP uniqueness
  const existing = await prisma.gameServer.findUnique({
    where: { ipAddress },
  });
  if (existing) {
    throw new GameError(`IP address '${ipAddress}' is already in use`, "CONFLICT", 409);
  }

  const server = await prisma.gameServer.create({
    data: {
      name,
      ipAddress,
      type,
      role: role ?? "general",
      networkId: networkId ?? undefined,
      factionId: factionId ?? undefined,
      securityLevel: securityLevel ?? 1,
      firewallLevel: firewallLevel ?? 1,
      encryptionLevel: encryptionLevel ?? 0,
      discoveryLevel: discoveryLevel ?? 0,
      isPublic: isPublic ?? true,
      accessMethod: accessMethod ?? "hackable",
      accessKey: accessKey ?? undefined,
      isOnline: isOnline ?? true,
      maxConnections: maxConnections ?? 10,
    },
  });

  res.status(201).json({
    success: true,
    data: server,
    timestamp: new Date().toISOString(),
  });
}));

// PUT /:id — Update server
router.put("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.gameServer.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Server not found");

  const { name, ipAddress, type, role, networkId, factionId, securityLevel, firewallLevel, encryptionLevel, discoveryLevel, isPublic, accessMethod, accessKey, isOnline, maxConnections, description, motd } = req.body;
  const data: Record<string, any> = {};
  if (name !== undefined) data.name = name;
  if (ipAddress !== undefined) data.ipAddress = ipAddress;
  if (type !== undefined) data.type = type;
  if (role !== undefined) data.role = role;
  if (networkId !== undefined) data.networkId = networkId;
  if (factionId !== undefined) data.factionId = factionId;
  if (securityLevel !== undefined) data.securityLevel = securityLevel;
  if (firewallLevel !== undefined) data.firewallLevel = firewallLevel;
  if (encryptionLevel !== undefined) data.encryptionLevel = encryptionLevel;
  if (discoveryLevel !== undefined) data.discoveryLevel = discoveryLevel;
  if (isPublic !== undefined) data.isPublic = isPublic;
  if (accessMethod !== undefined) data.accessMethod = accessMethod;
  if (accessKey !== undefined) data.accessKey = accessKey;
  if (isOnline !== undefined) data.isOnline = isOnline;
  if (maxConnections !== undefined) data.maxConnections = maxConnections;
  if (description !== undefined) data.description = description;
  if (motd !== undefined) data.motd = motd;

  const server = await prisma.gameServer.update({
    where: { id: req.params.id },
    data,
  });

  res.json({
    success: true,
    data: server,
    timestamp: new Date().toISOString(),
  });
}));

// DELETE /:id — Delete server with all files and links
router.delete("/:id", asyncHandler(async (req: any, res: any) => {
  const existing = await prisma.gameServer.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) throw new NotFoundError("Server not found");

  await prisma.$transaction(async (tx) => {
    await tx.fileSystemNode.deleteMany({ where: { serverId: req.params.id } });
    await tx.serverLink.deleteMany({
      where: {
        OR: [{ sourceId: req.params.id }, { targetId: req.params.id }],
      },
    });
    await tx.gameServer.delete({ where: { id: req.params.id } });
  });

  res.json({
    success: true,
    data: { deleted: true },
    timestamp: new Date().toISOString(),
  });
}));

// GET /:id/files — List files on server
router.get("/:id/files", asyncHandler(async (req: any, res: any) => {
  const { type, parentId } = req.query;

  const server = await prisma.gameServer.findUnique({
    where: { id: req.params.id },
  });
  if (!server) throw new NotFoundError("Server not found");

  const where: Record<string, unknown> = { serverId: req.params.id };
  if (type) where.type = type;
  if (parentId) {
    where.parentId = parentId;
  } else if (!type) {
    // Return root-level items when no filters specified
    where.parentId = null;
  }

  const files = await prisma.fileSystemNode.findMany({
    where,
    include: {
      children: {
        select: { id: true, name: true, type: true },
      },
    },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });

  res.json({
    success: true,
    data: files,
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/files — Create file or directory on server
router.post("/:id/files", asyncHandler(async (req: any, res: any) => {
  const { name, type, parentId, content, isHidden, isEncrypted, permissions } =
    req.body;

  if (!name || !type) {
    throw new ValidationError("name and type are required");
  }

  const server = await prisma.gameServer.findUnique({
    where: { id: req.params.id },
  });
  if (!server) throw new NotFoundError("Server not found");

  const file = await prisma.fileSystemNode.create({
    data: {
      serverId: req.params.id,
      name,
      type,
      parentId: parentId ?? undefined,
      content: content ?? undefined,
      isHidden: isHidden ?? false,
      isEncrypted: isEncrypted ?? false,
      permissions: permissions ?? {},
      size: content ? Buffer.byteLength(content, "utf8") : 0,
    },
  });

  res.status(201).json({
    success: true,
    data: file,
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/links — Create bidirectional link
router.post("/:id/links", asyncHandler(async (req: any, res: any) => {
  const { targetId, networkId, linkType, latency, requiredAccess } = req.body;
  const sourceId = req.params.id;

  if (!targetId) {
    throw new ValidationError("targetId is required");
  }

  // Verify both servers exist
  const [source, target] = await Promise.all([
    prisma.gameServer.findUnique({ where: { id: sourceId } }),
    prisma.gameServer.findUnique({ where: { id: targetId } }),
  ]);

  if (!source) throw new NotFoundError("Source server not found");
  if (!target) throw new NotFoundError("Target server not found");

  // Check for existing link
  const existingLink = await prisma.serverLink.findUnique({
    where: { sourceId_targetId: { sourceId, targetId } },
  });
  if (existingLink) {
    throw new GameError("Link already exists between these servers", "CONFLICT", 409);
  }

  // Create bidirectional links in a transaction
  const [linkAB, linkBA] = await prisma.$transaction([
    prisma.serverLink.create({
      data: {
        sourceId,
        targetId,
        networkId: networkId ?? undefined,
        linkType: linkType ?? "lan",
        latency: latency ?? 10,
        requiredAccess: requiredAccess ?? 0,
      },
    }),
    prisma.serverLink.create({
      data: {
        sourceId: targetId,
        targetId: sourceId,
        networkId: networkId ?? undefined,
        linkType: linkType ?? "lan",
        latency: latency ?? 10,
        requiredAccess: requiredAccess ?? 0,
      },
    }),
  ]);

  res.status(201).json({
    success: true,
    data: { linkAB, linkBA },
    timestamp: new Date().toISOString(),
  });
}));

// POST /:id/investigation-chain — Generate an investigation chain starting from this server
router.post("/:id/investigation-chain", asyncHandler(async (req: any, res: any) => {
  const { depth = 3, theme = "suspicious activity" } = req.body;

  const server = await prisma.gameServer.findUnique({ where: { id: req.params.id } });
  if (!server) throw new NotFoundError("Server not found");

  const { getService } = await import("../../di/container");
  const { REFERENCE_VALIDATION_SERVICE } = await import("../../di/tokens");
  const refService = getService<any>(REFERENCE_VALIDATION_SERVICE);

  const drafts = await refService.generateInvestigationChain(req.params.id, Number(depth), theme);

  res.status(201).json({
    success: true,
    data: { drafts, count: drafts.length },
    message: `Generated ${drafts.length} drafts for investigation chain. Review in Drafts panel.`,
    timestamp: new Date().toISOString(),
  });
}));

export default router;
