/**
 * ServerContentService
 *
 * Provisions AI-generated filesystem content for game servers and plants
 * mission-specific infrastructure (target servers, objective files/directories).
 *
 * Two main responsibilities:
 *
 * 1. **Server Provisioning** — When a game server is created, populate it with
 *    thematic directories and files that match the server's type and owning
 *    faction.  The faction leader AI persona (or the Game Master for unowned
 *    servers) writes the content so every server feels alive and unique.
 *
 * 2. **Mission Infrastructure** — When a mission is generated, ensure the
 *    objectives that reference servers/files have real targets.  This means:
 *    - Selecting or creating a target server for the mission
 *    - Planting files, directories, and data the player needs to interact with
 *    - Backfilling objective metadata (serverId, fileId) with real DB IDs
 *
 * Design principles:
 *   - Fire-and-forget from callers (errors are logged, never bubble)
 *   - Idempotent: safe to call multiple times for the same server
 *   - AI is optional: falls back to static templates when AI is unavailable
 */

import { MAX_CONTENT_ENCRYPTION_LEVEL } from "../config/gameBalance";
import { resolveNpcOwnerId } from "../../prisma/npcOwnership";
import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { AI_SERVICE, FILE_SERVICE, IP_SERVICE, LOGGER, REFERENCE_VALIDATION_SERVICE, SERVER_SERVICE, SOCKET_IO } from "../di/tokens";
import type { AIService } from "./aiService";
import { validateOrRetry, validateContentPlan } from "../utils/aiOutputValidator";

import type FileService from "./fileService";
import type IPService from "./ipService";
import type { ReferenceValidationService } from "./referenceValidationService";
import type ServerService from "./serverService";
import type { Server as SocketIOServer } from "socket.io";
import { IPZone } from "../../../shared/types/network";
import {
  type PlannedFile,
  type ServerContentPlan,
  type NetworkContext,
  getEmployeeRoster,
  generateFactionSecrets,
  STATIC_CONTENT,
  DEFAULT_CONTENT,
  generateRoleContent,
  generateEncodedFiles,
} from "./serverContentTemplates";
import {
  LORE_SYSTEM_PROMPT,
  AMBIENT_SYSTEM_PROMPT,
  MISSION_FILES_SYSTEM_PROMPT,
  resolveFactionKey,
  buildLorePrompt,
  buildAmbientPrompt,
  buildMissionFilesPrompt,
} from "./serverContentPrompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Represents a provisioned target for a mission objective. */
interface ProvisionedObjective {
  /** The index of the objective in the mission's objectives array. */
  index: number;
  /** Patched metadata to merge into the objective. */
  metadata: Record<string, unknown>;
}

/** Result of provisioning mission infrastructure. */
export interface MissionProvisionResult {
  /** The server ID that the mission targets. */
  targetServerId: string;
  /** Per-objective metadata patches. */
  objectives: ProvisionedObjective[];
  /** Files that were planted for this mission. */
  plantedFiles: string[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Objective types for which `provisionMissionInfrastructure` creates a target
 * server / plants files / patches metadata.
 *
 * This is the GATE. The `switch (obj.type)` inside that method is the WORK.
 * They must list the same types — they previously did not, and three types with
 * working `case` arms were unreachable because the gate excluded them.
 *
 * Exported so a check can assert the pairing rather than trusting a comment.
 */
export const PROVISIONED_OBJECTIVE_TYPES: ReadonlySet<string> = new Set([
  // need a target server to exist, even though they bind no id
  "hack",
  "hack_stealth",
  "hack_method",
  "explore",
  // bind metadata.serverId
  "hack_target",
  "gain_access",
  "upload_file",
  "connect_server",
  "discover_server_type",
  "steal_count",
  // bind metadata.fileId
  "steal",
  "delete_file",
  // previously MISSING from the gate despite having switch arms
  "infiltrate_network",
  "trace_connection",
  "exfiltrate_data",
]);

@injectable()
export class ServerContentService {
  private prisma: PrismaClient;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService?: AIService,
  ) {
    this.prisma = prisma;
  }

  // ========================================================================
  // Public API
  // ========================================================================

  /**
   * Provision a game server with thematic filesystem content.
   *
   * Call this after creating a GameServer row.  It will:
   *   1. Initialize the base filesystem (root + common dirs) via FileService
   *   2. Generate a content plan (AI if available, otherwise static)
   *   3. Create all planned directories and files
   *
   * Safe to call multiple times — skips if the server already has content
   * beyond the base filesystem scaffold.
   *
   * @param serverId  - The GameServer ID
   * @param options   - Optional overrides
   */
  /** Track which servers have had AI enrichment to avoid duplicate AI calls. */
  private aiEnrichedServers = new Set<string>();

  /**
   * Provision server content using the 4-tier approach:
   *   Tier 1 (instant): Static role-based content — ALWAYS applied, never empty
   *   Tier 2 (background): AI enrichment — unique files appear 5-30s later
   *
   * Tiers 3 (pre-warm) and 4 (event-driven) are triggered externally.
   */
  public async provisionServerContent(
    serverId: string,
    options: {
      /** Skip AI generation and use static templates only */
      skipAI?: boolean;
      /** Force re-provision even if content exists */
      force?: boolean;
    } = {},
  ): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({
        where: { id: serverId },
        include: { faction: { include: { aiPersona: true } }, network: true },
      });

      if (!server) {
        this.logger.warn({ serverId }, "Server not found for provisioning");
        return;
      }

      // Skip player homes — they have their own initialization
      if (server.isPlayerHome || server.type === "player_home") {
        return;
      }

      // Check if Tier 1 already applied (count files only, not directories)
      const fileCount = await this.prisma.fileSystemNode.count({
        where: { serverId, type: "file" },
      });

      if (!options.force && fileCount > 12) {
        // Tier 1 already applied (base scaffold ~7 + static content ~8-15 = ~15-22)
        // Only try Tier 2 AI enrichment if not already done
        if (!options.skipAI && !this.aiEnrichedServers.has(serverId)) {
          this.provisionAIContent(serverId, server).catch((err) => {
            this.logger.debug({ err, serverId }, "Tier 2 AI enrichment failed (non-critical)");
          });
        }
        return;
      }

      // ═══ TIER 1: Instant Static Content ═══
      // ALWAYS applied. Server is never empty after this step.

      // Ensure base filesystem exists
      await this.ensureBaseFilesystem(serverId, server.ownerId || "system");

      // Build network context for content generation
      const networkCtx = await this.buildNetworkContext(server);

      // Generate static content plan (role-based with real employee names, IPs)
      const staticPlan: ServerContentPlan = networkCtx
        ? generateRoleContent(networkCtx)
        : this.getStaticContentPlan(server.type);

      // Plant faction secrets on the appropriate server role
      if (networkCtx) {
        const matchingSecrets = networkCtx.secrets.filter(
          (s) =>
            s.targetRole === (server as any).role || s.targetRole === "general",
        );
        for (const secret of matchingSecrets) {
          staticPlan.files.push({
            path: `/data/${secret.fileName}`,
            content: secret.content,
            isHidden: secret.isHidden,
            isEncrypted: secret.isEncrypted,
          });
        }

        // Add encoded content files (decodable by players using `decode` command)
        const encodedFiles = generateEncodedFiles(networkCtx);
        staticPlan.files.push(...encodedFiles);
      }

      // Apply Tier 1 content immediately (awaited — player sees files right away)
      await this.applyContentPlan(serverId, server.ownerId || "system", staticPlan);

      this.logger.info(
        {
          serverId,
          serverName: server.name,
          tier: 1,
          dirs: staticPlan.directories.length,
          files: staticPlan.files.length,
        },
        "Tier 1 static content applied",
      );

      // ═══ TIER 2: AI Enrichment (fire-and-forget) ═══
      // Adds unique AI-generated files in the background.
      if (!options.skipAI) {
        this.provisionAIContent(serverId, server).catch((err) => {
          this.logger.debug({ err, serverId }, "Tier 2 AI enrichment failed (non-critical)");
        });
      }
    } catch (error) {
      this.logger.error(
        { err: error, serverId },
        "Failed to provision server content",
      );
    }
  }

  /**
   * Tier 2: AI Content Enrichment (background).
   * Generates 3-5 unique files via AI and applies them on top of Tier 1 content.
   * Non-blocking, safe to fail.
   */
  private async provisionAIContent(
    serverId: string,
    server: any,
  ): Promise<void> {
    // Deduplicate: only enrich once per server per runtime
    if (this.aiEnrichedServers.has(serverId)) return;
    this.aiEnrichedServers.add(serverId);

    const networkCtx = await this.buildNetworkContext(server);
    const factionKey = resolveFactionKey(networkCtx);

    // Lore content (faction servers only)
    let lorePlan: ServerContentPlan = { directories: [], files: [] };
    if (factionKey && networkCtx) {
      try {
        const loreResult = await this.generatePlanFromAI(
          LORE_SYSTEM_PROMPT,
          buildLorePrompt(networkCtx),
          server.faction?.aiPersona?.systemPrompt ?? undefined,
        );
        if (loreResult) lorePlan = loreResult;
      } catch (err) {
        this.logger.debug({ err }, "Tier 2 lore generation failed");
      }
    }

    // Ambient content (all servers)
    let ambientPlan: ServerContentPlan = { directories: [], files: [] };
    if (networkCtx) {
      try {
        const ambientResult = await this.generatePlanFromAI(
          AMBIENT_SYSTEM_PROMPT,
          buildAmbientPrompt(networkCtx),
        );
        if (ambientResult) ambientPlan = ambientResult;
      } catch (err) {
        this.logger.debug({ err }, "Tier 2 ambient generation failed");
      }
    }

    const aiPlan: ServerContentPlan = {
      directories: [...lorePlan.directories, ...ambientPlan.directories],
      files: [...lorePlan.files, ...ambientPlan.files],
    };

    if (aiPlan.files.length === 0 && aiPlan.directories.length === 0) {
      this.logger.debug({ serverId }, "Tier 2: AI produced no content — queueing for retry");

      // Queue ambient prompt for retry if AI is temporarily down
      if (networkCtx && this.aiService) {
        const ambientPrompt = buildAmbientPrompt(networkCtx);
        const sId = serverId;
        const ownerId = server.ownerId || "system";
        this.aiService.queueForRetry(ambientPrompt, AMBIENT_SYSTEM_PROMPT, async (response: string) => {
          try {
            const retryPlan = validateOrRetry(response, validateContentPlan);
            if (retryPlan) {
              await this.applyContentPlan(sId, ownerId, retryPlan);
              this.logger.info({ serverId: sId, files: retryPlan.files.length }, "Tier 2 retry: AI content applied from queue");
            }
          } catch { /* retry callback failed — non-critical */ }
        });
      }
      return;
    }

    // Apply AI-generated content on top of existing Tier 1 content
    await this.applyContentPlan(serverId, server.ownerId || "system", aiPlan);

    this.logger.info(
      {
        serverId,
        serverName: server.name,
        tier: 2,
        loreFiles: lorePlan.files.length,
        ambientFiles: ambientPlan.files.length,
      },
      "Tier 2 AI content applied",
    );

    // Notify connected players that new files appeared
    try {
      const { getService } = await import("../di/container");
      const io = getService<SocketIOServer>(SOCKET_IO);
      io.to(`server:${serverId}`).emit("command:result", {
        success: true,
        output: `[${server.name}] New files detected.`,
        timestamp: new Date(),
      });
    } catch {
      // Socket.IO not available — no notification
    }
  }

  // D9/D10 — `provisionAllUnpopulatedServers()` lived here and was the "boot
  // provisioning N+1" the audit flagged (one `count()` per server inside the
  // loop). It is DELETED rather than optimised, because it had ZERO callers:
  // `ContentQueueService.enqueueAllUnpopulated()` replaced it — that is what
  // `index.ts:507` actually calls on boot — and it already batches the counts
  // into a single `groupBy(["serverId"])`. The N+1 was fixed by the queue
  // rewrite; only this orphan still contained the pattern.
  //
  // Deleting beats leaving it: the method was `public`, invitingly named, and
  // carried the exact anti-pattern. This codebase has already been bitten by
  // dead methods that looked live (`setSocketIO()` had no callers and stranded
  // 21 socket emits, `player:levelup` among them).

  /**
   * Build network context for a server — linked servers, employee roster, faction secrets.
   */
  private async buildNetworkContext(
    server: any,
  ): Promise<NetworkContext | null> {
    try {
      const role = server.role || "general";
      const networkId = server.networkId;
      const factionShortName = server.faction?.shortName || null;

      // Get linked servers via topology
      const linkedServers: Array<{ name: string; ip: string; role: string }> = [];
      let allNetworkServers: Array<{ name: string; ip: string; role: string }> =
        [];

      if (networkId) {
        const networkServers = await this.prisma.gameServer.findMany({
          where: { networkId },
          select: { id: true, name: true, ipAddress: true, role: true },
        });
        allNetworkServers = networkServers
          .filter((s) => s.id !== server.id)
          .map((s) => ({ name: s.name, ip: s.ipAddress, role: s.role }));
      }

      // Get directly linked servers
      const links = await this.prisma.serverLink.findMany({
        where: {
          OR: [{ sourceId: server.id }, { targetId: server.id }],
          isActive: true,
        },
        include: { source: true, target: true },
      });

      const seenIds = new Set<string>();
      for (const link of links) {
        const other = link.sourceId === server.id ? link.target : link.source;
        if (!seenIds.has(other.id)) {
          seenIds.add(other.id);
          linkedServers.push({
            name: other.name,
            ip: other.ipAddress,
            role: other.role,
          });
        }
      }

      // Get network info
      let networkInfo: NetworkContext["network"] = null;
      if (networkId) {
        const net = await this.prisma.network.findUnique({
          where: { id: networkId },
          select: { name: true, zone: true },
        });
        if (net) {
          networkInfo = {
            name: net.name,
            zone: net.zone,
            factionName: server.faction?.name || null,
            factionShortName,
          };
        }
      }

      const employeeRoster = getEmployeeRoster(factionShortName);
      const secrets = generateFactionSecrets(
        factionShortName,
        allNetworkServers,
      );

      // Get existing directory structure so AI can nest files properly
      const existingNodes = await this.prisma.fileSystemNode.findMany({
        where: { serverId: server.id, type: "directory" },
        select: { id: true, name: true, parentId: true },
      });
      const nameMap = new Map(existingNodes.map(n => [n.id, n.name]));
      const parentMap = new Map(existingNodes.map(n => [n.id, n.parentId]));
      const getPath = (id: string): string => {
        const parts: string[] = [];
        let cur: string | null | undefined = id;
        while (cur && nameMap.has(cur)) {
          const name = nameMap.get(cur)!;
          if (name !== "/") parts.unshift(name);
          cur = parentMap.get(cur);
        }
        return "/" + parts.join("/");
      };
      const existingDirs = existingNodes
        .map(n => getPath(n.id))
        .filter(p => p !== "/")
        .sort();

      return {
        server: {
          name: server.name,
          ip: server.ipAddress,
          type: server.type,
          role,
          securityLevel: server.securityLevel,
        },
        network: networkInfo,
        linkedServers,
        allNetworkServers,
        employeeRoster,
        secrets,
        existingDirs,
      };
    } catch (error) {
      this.logger.debug(
        { err: error, serverId: server.id },
        "Failed to build network context",
      );
      return null;
    }
  }

  // D9/D10 — `provisionAllNetworkServers()` lived here and held the second
  // copy of the boot-provisioning N+1 (a `count()` per server inside the
  // loop). DELETED, not optimised: like its sibling above it had ZERO callers
  // anywhere in the repo, including routes and scripts. Content provisioning
  // goes through ContentQueueService now.
  /**
   * Provision infrastructure for a mission.
   *
   * Given a generated mission (before or after DB insertion), this will:
   *   1. Select or create a target server appropriate for the mission
   *   2. Ensure the target server has a filesystem with content
   *   3. Plant mission-specific files (steal targets, evidence, etc.)
   *   4. Return metadata patches for objectives that need real IDs
   *
   * @param mission  - The mission data (title, description, objectives, etc.)
   * @param userId   - The player the mission is for (used for level-appropriate targeting)
   * @returns Provisioned target info, or null if provisioning fails
   */
  public async provisionMissionInfrastructure(
    mission: {
      title: string;
      description: string;
      type: string;
      difficulty: number;
      objectives: Array<{
        id: string;
        type: string;
        target: number | string | boolean;
        metadata?: Record<string, unknown>;
      }>;
      factionId?: string;
    },
    userId: string,
  ): Promise<MissionProvisionResult | null> {
    try {
      // Objective types that need server/file infrastructure.
      //
      // MUST stay in sync with the `switch (obj.type)` patch block below — this
      // set is the gate, that switch does the work, and they had silently
      // drifted: the switch already had `case` arms for `infiltrate_network`,
      // `trace_connection` and `exfiltrate_data`, but the gate omitted all
      // three. Any mission built only from those types returned early with no
      // server, no planted file and no metadata, so its objectives could never
      // be satisfied. `deep_extraction` is exactly that shape and was
      // impossible to complete.
      //
      // Kept as one named constant next to the switch so the pairing is visible;
      // `PROVISIONED_OBJECTIVE_TYPES` is asserted against the switch's coverage
      // by scripts/verify-mission-provisioning.ts.
      const serverObjectiveTypes = PROVISIONED_OBJECTIVE_TYPES;

      const needsServer = mission.objectives.some((obj) =>
        serverObjectiveTypes.has(obj.type),
      );

      if (!needsServer) {
        // Mission doesn't need server infrastructure (social, progression, etc.)
        return null;
      }

      // 1. Select or create target server
      const targetServer = await this.selectOrCreateTargetServer(
        mission,
        userId,
      );

      if (!targetServer) {
        this.logger.warn(
          { missionTitle: mission.title },
          "Could not select/create target server for mission",
        );
        return null;
      }

      // 2. Ensure the server has content
      await this.provisionServerContent(targetServer.id);

      // 3. Plant mission-specific files
      const plantedFiles = await this.plantMissionFiles(
        targetServer.id,
        targetServer.ownerId || "system",
        mission,
      );

      // 4. Build objective metadata patches
      const objectivePatches: ProvisionedObjective[] = [];

      for (let i = 0; i < mission.objectives.length; i++) {
        const obj = mission.objectives[i]!;
        const patch: Record<string, unknown> = {};

        switch (obj.type) {
          case "hack_target":
          case "connect_server":
          case "gain_access":
          case "upload_file":
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            patch.serverName = targetServer.name;
            break;

          case "steal":
          case "delete_file": {
            // Point to the first "objective_target" file we planted
            const targetFile = plantedFiles.find(
              (f) => f.purpose === "objective_target",
            );
            if (targetFile) {
              patch.fileId = targetFile.nodeId;
              patch.filePath = targetFile.path;
              patch.serverId = targetServer.id;
              patch.serverIp = targetServer.ipAddress;
            }
            break;
          }

          case "steal_count":
          case "hack":
          case "hack_stealth":
          case "hack_method":
          case "explore":
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            break;

          case "discover_server_type":
            patch.serverType = targetServer.type;
            break;

          case "infiltrate_network":
            patch.networkId = targetServer.networkId || null;
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            break;

          case "trace_connection":
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            patch.serverName = targetServer.name;
            break;

          case "exfiltrate_data": {
            const exfilFile = plantedFiles.find(
              (f) => f.purpose === "objective_target",
            );
            if (exfilFile) {
              patch.fileId = exfilFile.nodeId;
              patch.filePath = exfilFile.path;
            }
            patch.serverId = targetServer.id;
            patch.serverIp = targetServer.ipAddress;
            break;
          }

          default:
            continue; // No patch needed
        }

        if (Object.keys(patch).length > 0) {
          objectivePatches.push({ index: i, metadata: patch });
        }
      }

      this.logger.info(
        {
          missionTitle: mission.title,
          targetServerId: targetServer.id,
          targetServerIp: targetServer.ipAddress,
          plantedFiles: plantedFiles.length,
          patchedObjectives: objectivePatches.length,
        },
        "Mission infrastructure provisioned",
      );

      return {
        targetServerId: targetServer.id,
        objectives: objectivePatches,
        plantedFiles: plantedFiles.map((f) => f.path),
      };
    } catch (error) {
      this.logger.error(
        { err: error, missionTitle: mission.title },
        "Failed to provision mission infrastructure",
      );
      return null;
    }
  }

  // ========================================================================
  // Internal — Server Content
  // ========================================================================

  /**
   * Ensure a server has the base filesystem scaffold (root + common dirs).
   */
  private async ensureBaseFilesystem(
    serverId: string,
    ownerId: string,
  ): Promise<void> {
    const hasRoot = await this.prisma.fileSystemNode.findFirst({
      where: { serverId, parentId: null, type: "directory" },
    });

    if (hasRoot) return;

    // ── Try FileService first (works when the full DI container is active) ──
    //
    // The catch here used to be bare, and that is almost certainly how a server
    // ended up with TWO root trees. It was written to mean "FileService is not
    // registered", but it swallowed EVERY failure — so an
    // `initializeFileSystem` that got part-way and then threw was misread as
    // "DI unavailable", and execution fell through to the standalone path
    // below, which built a SECOND root. The unique constraint cannot catch
    // that, because roots have a null `parentId`.
    //
    // So the two cases are now told apart: a resolution failure falls through
    // (that is what the fallback is for), and a real initialisation failure
    // propagates instead of being papered over with a duplicate filesystem.
    let fileService: { initializeFileSystem: (s: string, o: string) => Promise<void> } | null = null;
    try {
      const { getService } = await import("../di/container");
      fileService = getService(FILE_SERVICE);
    } catch {
      // FileService genuinely unavailable — fall through to the Prisma path.
      fileService = null;
    }

    if (fileService) {
      await fileService.initializeFileSystem(serverId, ownerId);
      return;
    }

    // Standalone fallback: create root + standard directories via Prisma
    // System filesystems have NO owner — see the OWNERSHIP note in
    // applyContentPlan. This was the second copy of the same `findFirst()`
    // pick, justified as "a valid user ID for createdBy FK"; the column is
    // nullable (`onDelete: SetNull`), so null IS valid, and it is what every
    // existing system node carries.
    const createdBy = ownerId && ownerId !== "system" ? ownerId : null;

    // ── D7: this is the function that produced the observed duplicate ───────
    // The `hasRoot` check above is a check-then-create with an await between
    // it and the writes, so two concurrent provisioning calls both saw no root
    // and both ran this. That is how the AI-provisioned "Phantom Probe Node"
    // ended up with TWO `/home` directories created in the same second, each
    // holding a different child — the violation that motivated the constraint.
    //
    // ROOT: `@@unique([serverId, parentId, name])` does NOT cover roots —
    // `parentId` is null and Postgres treats NULLs as distinct — so an upsert
    // on that key is impossible (Prisma types the compound's `parentId` as
    // non-nullable). Instead the root gets a DETERMINISTIC id, which makes the
    // PRIMARY KEY do the work: a concurrent creator collides there and the
    // upsert resolves to the existing row. No schema change needed.
    // The `hasRoot` early-return above still covers servers whose root predates
    // this and therefore has a cuid.
    const root = await this.prisma.fileSystemNode.upsert({
      where: { id: `root_${serverId}` },
      create: {
        id: `root_${serverId}`,
        serverId,
        name: "/",
        type: "directory",
        content: null,
        permissions: { owner: 15, faction: 5, others: 5 },
        size: 0,
        createdBy,
      },
      update: {},
    });

    const baseDirs = ["etc", "home", "var", "tmp", "logs", "data"];
    for (const dir of baseDirs) {
      // CHILDREN are covered by the unique, so this is a real upsert.
      await this.prisma.fileSystemNode.upsert({
        where: {
          serverId_parentId_name: { serverId, parentId: root.id, name: dir },
        },
        create: {
          serverId,
          parentId: root.id,
          name: dir,
          type: "directory",
          content: null,
          permissions: { owner: 15, faction: 5, others: 5 },
          size: 0,
          createdBy,
        },
        update: {},
      });
    }
  }

  /**
   * Generate content plan from AI using the given prompts.
   * Used by both lore and ambient content generation processes.
   */
  private async generatePlanFromAI(
    systemPrompt: string,
    userPrompt: string,
    factionSystemPrompt?: string,
  ): Promise<ServerContentPlan | null> {
    try {
      if (!this.aiService) {
        this.logger.warn(
          "AIService not available, skipping AI content plan generation",
        );
        return null;
      }
      const aiService = this.aiService;

      // Build system prompt with faction context
      const fullSystemPrompt = factionSystemPrompt
        ? `${factionSystemPrompt}\n\n${systemPrompt}`
        : systemPrompt;

      // Use agent loop so AI can query DB for real server data and create new entities
      const { runAgentLoop } = await import("./aiAgentTools");
      const agentPrompt = userPrompt + '\n\nYour final response MUST be JSON: { "directories": [{"path": "/..."}], "files": [{"path": "/...", "content": "string (100-3000 chars)", "isHidden": false}] }';

      let responseText: string | null = null;
      try {
        responseText = await runAgentLoop(
          aiService, this.prisma, fullSystemPrompt, agentPrompt, this.logger, 6,
        );
      } catch { /* fall through */ }

      // Fallback: direct call without agent loop if agent fails
      if (!responseText) {
        const directResult = await aiService.generateResponse(
          userPrompt,
          fullSystemPrompt,
          '{ "directories": [{"path": "/..."}], "files": [{"path": "/...", "content": "string (100-3000 chars)", "isHidden": false}] }',
        );
        if (!directResult.success) {
          this.logger.debug({ error: directResult.error }, "AI content plan generation returned error");
          return null;
        }
        responseText = directResult.response;
      }

      // Extract and validate content plan from AI response
      const validated = validateOrRetry(responseText, validateContentPlan);
      if (!validated) {
        this.logger.debug("AI content plan validation failed");
        return null;
      }

      // Auto-backfill: scan generated file content for IPs/URLs that don't exist
      try {
        const { getService } = await import("../di/container");
        const refService = getService<ReferenceValidationService>(REFERENCE_VALIDATION_SERVICE);
        if (refService) {
          const allContent = validated.files.map((f: any) => f.content || "").join("\n");
          if (allContent.length > 10) {
            refService.validateAndBackfillReferences(allContent, "ai_content").catch(() => {});
          }
        }
      } catch { /* non-critical */ }

      return validated;
    } catch (error) {
      this.logger.debug({ err: error }, "AI content plan generation failed");
      return null;
    }
  }

  /**
   * Get the static content plan for a server type.
   */
  private getStaticContentPlan(serverType: string): ServerContentPlan {
    return STATIC_CONTENT[serverType] || DEFAULT_CONTENT;
  }

  /**
   * Apply a content plan to a server's filesystem, Prisma-direct.
   *
   * A9: this was a dispatcher over two implementations, one of them a
   * zero-caller FileService variant kept compilable with @ts-expect-error.
   * Deleted rather than "collapsed" because it was superseded, not bypassed:
   *  - its real encryption is not what the game uses — provisioned files are
   *    deliberately keyless LOCKED files that only the crack flow opens (R9;
   *    see fileService.readFile), which is the shape this path writes;
   *  - its other side effects are wrong for provisioning: createFile credits
   *    mission "upload" objectives and writes an access log as the owner.
   */
  private async applyContentPlan(
    serverId: string,
    ownerId: string,
    plan: ServerContentPlan,
  ): Promise<void> {
    // OWNERSHIP. System content has NO owner: `createdBy` is what fileService
    // grants owner-level access on (canRead returns before the hack-depth
    // `requiredAccessLevel` gate; canWrite bypasses isProtected at root).
    // This used to resolve "system" to `user.findFirst()` with no orderBy —
    // whichever row Postgres returned first, which shifts as rows are
    // updated — making that user owner of every new system file it wrote.
    // In the dev DB it happened to be the NPC `sysadmin`; nothing guaranteed
    // it. null is also what all existing system content already carries.
    const createdBy = ownerId === "system" ? null : ownerId;

    // Get or find root
    const root = await this.prisma.fileSystemNode.findFirst({
      where: { serverId, parentId: null, type: "directory" },
    });
    if (!root) return;

    // Build a path→node cache
    const pathCache = new Map<string, string>();
    pathCache.set("/", root.id);

    // Load existing nodes
    const existing = await this.prisma.fileSystemNode.findMany({
      where: { serverId },
      select: { id: true, name: true, parentId: true },
    });

    // Build path map from existing nodes
    const parentMap = new Map<string, string>();
    for (const node of existing) {
      if (node.parentId) parentMap.set(node.id, node.parentId);
    }
    const nameMap = new Map<string, string>();
    for (const node of existing) {
      nameMap.set(node.id, node.name);
    }

    const getPath = (nodeId: string): string => {
      const parts: string[] = [];
      let current: string | undefined = nodeId;
      while (current && nameMap.has(current)) {
        const name = nameMap.get(current)!;
        if (name !== "/") parts.unshift(name);
        current = parentMap.get(current);
      }
      return "/" + parts.join("/");
    };

    for (const node of existing) {
      pathCache.set(getPath(node.id), node.id);
    }

    // Helper: ensure directory path exists, return its node ID
    const ensureDir = async (dirPath: string): Promise<string | null> => {
      if (pathCache.has(dirPath)) return pathCache.get(dirPath)!;

      const parts = dirPath.split("/").filter(Boolean);
      let currentParentId = root.id;
      let currentPath = "";

      for (const part of parts) {
        currentPath += "/" + part;
        if (pathCache.has(currentPath)) {
          currentParentId = pathCache.get(currentPath)!;
          continue;
        }

        try {
          // D7: upsert — content provisioning is re-entrant by design
          // (ContentQueueService retries, and `ensureReady` can be driven by
          // two players connecting at once), so an intermediate directory that
          // another run just created is expected, not an error.
          const node = await this.prisma.fileSystemNode.upsert({
            where: {
              serverId_parentId_name: {
                serverId,
                parentId: currentParentId,
                name: part,
              },
            },
            update: {},
            create: {
              serverId,
              parentId: currentParentId,
              name: part,
              type: "directory",
              content: null,
              permissions: { owner: 15, faction: 5, others: 5 },
              size: 0,
              createdBy,
            },
          });
          pathCache.set(currentPath, node.id);
          currentParentId = node.id;
        } catch {
          // Already exists — find it
          const found = await this.prisma.fileSystemNode.findFirst({
            where: { serverId, parentId: currentParentId, name: part },
          });
          if (found) {
            pathCache.set(currentPath, found.id);
            currentParentId = found.id;
          } else {
            return null;
          }
        }
      }
      return currentParentId;
    };

    // Create directories
    for (const dir of plan.directories) {
      await ensureDir(dir.path);
    }

    // Create files
    for (const file of plan.files) {
      try {
        const fileName = file.path.split("/").pop()!;
        const dirPath =
          file.path.substring(0, file.path.length - fileName.length - 1) || "/";
        const parentId = await ensureDir(dirPath);
        if (!parentId) continue;

        // D7: the `findFirst` guard this replaces had an await before the
        // write, so a concurrent provisioning run could slip a file in between.
        // Provisioned content is authored, not player-owned, so re-running must
        // leave the existing file alone rather than fail the whole plan.
        await this.prisma.fileSystemNode.upsert({
          where: {
            serverId_parentId_name: { serverId, parentId, name: fileName },
          },
          update: {},
          create: {
            serverId,
            parentId,
            name: fileName,
            type: "file",
            content: file.content,
            permissions: { owner: 15, faction: 5, others: 1 },
            size: file.content.length,
            createdBy,
            isHidden: file.isHidden || false,
            isEncrypted: file.isEncrypted || false,
            isProtected: file.isProtected || false,
          },
        });
      } catch (err) {
        this.logger.debug(
          { err, path: file.path },
          "Error creating file via Prisma",
        );
      }
    }

    // Apply directory flags
    await this.applyFileFlags(serverId, plan);
  }

  /**
   * Apply isHidden/isProtected flags to directories after creation.
   */
  private async applyFileFlags(
    serverId: string,
    plan: ServerContentPlan,
  ): Promise<void> {
    for (const dir of plan.directories) {
      if (dir.isHidden || dir.isProtected) {
        const dirName = dir.path.split("/").pop()!;
        const node = await this.prisma.fileSystemNode.findFirst({
          where: { serverId, name: dirName, type: "directory" },
        });
        if (node) {
          await this.prisma.fileSystemNode.update({
            where: { id: node.id },
            data: {
              ...(dir.isHidden ? { isHidden: true } : {}),
              ...(dir.isProtected ? { isProtected: true } : {}),
            },
          });
        }
      }
    }
  }

  // ========================================================================
  // Internal — Mission Infrastructure
  // ========================================================================

  /**
   * Select an existing server or create a new one as the mission target.
   *
   * Preference order:
   *   1. An existing NPC server matching the mission difficulty & type
   *   2. A faction-owned server (if mission has a factionId)
   *   3. Create a new server on the appropriate network
   */
  private async selectOrCreateTargetServer(
    mission: {
      type: string;
      difficulty: number;
      factionId?: string;
      objectives: Array<{ type: string; metadata?: Record<string, unknown> }>;
    },
    _userId: string,
  ): Promise<{
    id: string;
    ipAddress: string;
    name: string;
    type: string;
    ownerId: string | null;
    networkId?: string | null;
  } | null> {
    // Determine what kind of server we need
    const targetType = this.inferTargetServerType(mission);
    const maxEncryption = Math.min(100, mission.difficulty * 12);
    const minEncryption = Math.max(0, (mission.difficulty - 2) * 8);

    // 1. Try to find an existing NPC server that matches
    const existingServer = await this.prisma.gameServer.findFirst({
      where: {
        type: targetType,
        isPlayerHome: false,
        ownerId: null, // NPC server (no player owner)
        encryptionLevel: {
          gte: minEncryption,
          lte: maxEncryption,
        },
        ...(mission.factionId ? { factionId: mission.factionId } : {}),
      },
      orderBy: { encryptionLevel: "asc" },
    });

    if (existingServer) {
      return {
        id: existingServer.id,
        ipAddress: existingServer.ipAddress,
        name: existingServer.name,
        type: existingServer.type,
        ownerId: existingServer.ownerId,
        networkId: existingServer.networkId,
      };
    }

    // 2. Try a faction server if applicable
    if (mission.factionId) {
      const factionServer = await this.prisma.gameServer.findFirst({
        where: {
          factionId: mission.factionId,
          isPlayerHome: false,
        },
        orderBy: { encryptionLevel: "asc" },
      });

      if (factionServer) {
        return {
          id: factionServer.id,
          ipAddress: factionServer.ipAddress,
          name: factionServer.name,
          type: factionServer.type,
          ownerId: factionServer.ownerId,
          networkId: factionServer.networkId,
        };
      }
    }

    // 3. Create a new server
    return this.createMissionTargetServer(mission, targetType);
  }

  /**
   * Infer what server type a mission should target based on its type and objectives.
   */
  private inferTargetServerType(mission: {
    type: string;
    difficulty: number;
    objectives: Array<{ type: string; metadata?: Record<string, unknown> }>;
  }): string {
    // Check if any objective specifies a serverType
    for (const obj of mission.objectives) {
      const meta = obj.metadata as Record<string, unknown> | undefined;
      if (meta?.serverType && typeof meta.serverType === "string") {
        return meta.serverType;
      }
    }

    // Infer from mission difficulty
    if (mission.difficulty >= 8) return "government";
    if (mission.difficulty >= 5) return "corporate";
    if (mission.difficulty >= 3) return "underground";
    return "corporate"; // Default
  }

  /**
   * Create a brand new server as a mission target.
   */
  private async createMissionTargetServer(
    mission: { type: string; difficulty: number; factionId?: string },
    serverType: string,
  ): Promise<{
    id: string;
    ipAddress: string;
    name: string;
    type: string;
    ownerId: string | null;
    networkId?: string | null;
  } | null> {
    try {
      const { getService } = await import("../di/container");
      const ipService = getService<IPService>(IP_SERVICE);
      const serverService = getService<ServerService>(SERVER_SERVICE);

      // Determine which IP zone to use. Typed as IPZone, not string:
      // `generateUniqueIP` takes the enum and throws "Invalid IP zone" on
      // anything it does not recognise, so a bare string here is a runtime
      // failure waiting on a typo rather than a compile error.
      const zoneMap: Record<string, IPZone> = {
        corporate: IPZone.CORPORATE,
        government: IPZone.GOVERNMENT,
        underground: IPZone.UNDERGROUND,
      };
      const zone = zoneMap[serverType] ?? IPZone.CORPORATE;
      const ip = await ipService.generateUniqueIP(zone);

      // Generate a thematic name
      const name = this.generateServerName(serverType, mission.factionId);

      // P0-4: `difficulty * 10` produced encryptionLevel 10-100, but G4 made
      // `requiredLevel = encryptionLevel * LEVEL_PER_ENCRYPTION` (=2), so a
      // DIFFICULTY-1 mission provisioned a target needing player level 20 —
      // 36,100 XP — and answered "Insufficient level" forever. G4 was calibrated
      // against seed.ts, where nothing exceeds 5, and never against this writer.
      //
      // Map difficulty 1-10 onto the 0-5 band the seeded world actually uses, so
      // the hardest generated target needs level 10 rather than level 200.
      const encryptionLevel = Math.max(
        0,
        Math.min(MAX_CONTENT_ENCRYPTION_LEVEL, Math.round(mission.difficulty / 2)),
      );

      // P0-3: every server must have an owner — `hack` refuses ownerless targets
      // ("Target server has no owner"), so a mission target created without one
      // is an objective the player cannot complete. U3b fixed this for the three
      // creation sites known at the time; this is the fourth, and it defaulted to
      // null through `serverService.createServer`'s `ownerId ?? null`.
      const npcOwnerId = await resolveNpcOwnerId(this.prisma, {
        factionId: mission.factionId ?? null,
        type: serverType,
      });

      const server = await serverService.createServer({
        name,
        ipAddress: ip,
        type: serverType,
        encryptionLevel,
        maxConnections: 10 + mission.difficulty * 2,
        ownerId: npcOwnerId,
      });

      // Associate with faction if applicable
      if (mission.factionId) {
        await this.prisma.gameServer.update({
          where: { id: server.id },
          data: { factionId: mission.factionId },
        });
      }

      this.logger.info(
        {
          serverId: server.id,
          serverIp: ip,
          serverName: name,
          serverType,
          forMissionType: mission.type,
        },
        "Created mission target server",
      );

      return {
        id: server.id,
        ipAddress: ip,
        name,
        type: serverType,
        ownerId: npcOwnerId,
      };
    } catch (error) {
      this.logger.error(
        { err: error },
        "Failed to create mission target server",
      );
      return null;
    }
  }

  /**
   * Generate a thematic server name based on type.
   */
  private generateServerName(serverType: string, _factionId?: string): string {
    const names: Record<string, string[]> = {
      corporate: [
        "DataVault Systems",
        "NexGen Analytics",
        "Pinnacle Financial",
        "Helix Biotech",
        "Quantum Dynamics R&D",
        "Sterling Capital",
        "Apex Logistics",
        "Meridian Consulting",
        "Obsidian Technologies",
        "Prism Data Solutions",
      ],
      government: [
        "GOV-RELAY-ALPHA",
        "CENTCOM-NODE-7",
        "Federal Records Archive",
        "Cyber Defense Station",
        "Intelligence Hub BRAVO",
        "DOD-SIGINT-3",
        "Homeland Security Portal",
        "Joint Operations Center",
        "NSA Listening Post",
        "CERT Response Server",
      ],
      underground: [
        "Shadow Relay",
        "Ghost Market",
        "Dead Drop Station",
        "Null Router",
        "Zero Day Hub",
        "Dark Pool Exchange",
        "Phantom Node",
        "Whisper Network",
        "The Crypt",
        "Black Market Terminal",
      ],
    };

    const pool = names[serverType] || names.corporate!;
    return pool[Math.floor(Math.random() * pool.length)]!;
  }

  /**
   * Plant mission-specific files on the target server.
   */
  private async plantMissionFiles(
    serverId: string,
    ownerId: string,
    mission: {
      title: string;
      description: string;
      objectives: Array<{ type: string }>;
    },
  ): Promise<Array<{ path: string; nodeId: string; purpose: string }>> {
    const planted: Array<{ path: string; nodeId: string; purpose: string }> =
      [];

    // Determine which objective types need files
    const fileObjectiveTypes = new Set([
      "steal",
      "steal_count",
      "delete_file",
      "upload_file",
    ]);
    const hasFileObjectives = mission.objectives.some((o) =>
      fileObjectiveTypes.has(o.type),
    );

    // Get the server info for AI prompt context
    const server = await this.prisma.gameServer.findUnique({
      where: { id: serverId },
    });
    if (!server) return planted;

    // Try AI generation for mission files
    let missionFiles: Array<PlannedFile & { purpose: string }> = [];
    try {
      missionFiles = await this.generateMissionFilesWithAI(
        mission,
        server.type,
        server.name,
      );
    } catch {
      // AI failed, use static fallback
    }

    // Fallback: generate static mission files if AI didn't produce any
    if (missionFiles.length === 0) {
      missionFiles = this.generateStaticMissionFiles(
        mission,
        hasFileObjectives,
      );
    }

    // Plant the files
    const { getService } = await import("../di/container");
    const fileService = getService<FileService>(FILE_SERVICE);

    for (const file of missionFiles) {
      try {
        const result = await fileService.createFile(
          serverId,
          ownerId,
          file.path,
          file.content,
          file.isEncrypted || false,
        );

        if (result.success && result.data?.id) {
          // Set hidden flag if needed
          if (file.isHidden) {
            await this.prisma.fileSystemNode.update({
              where: { id: result.data.id },
              data: { isHidden: true },
            });
          }

          planted.push({
            path: file.path,
            nodeId: result.data.id,
            purpose: file.purpose,
          });
        } else {
          // If createFile doesn't return an ID, look it up
          const fileName = file.path.split("/").pop()!;
          const node = await this.prisma.fileSystemNode.findFirst({
            where: { serverId, name: fileName },
            orderBy: { createdAt: "desc" },
          });
          if (node) {
            planted.push({
              path: file.path,
              nodeId: node.id,
              purpose: file.purpose,
            });
          }
        }
      } catch (err) {
        this.logger.debug(
          { err, path: file.path },
          "Failed to plant mission file",
        );
      }
    }

    return planted;
  }

  /**
   * Try generating mission files via AI.
   */
  private async generateMissionFilesWithAI(
    mission: {
      title: string;
      description: string;
      objectives: Array<{ type: string }>;
    },
    serverType: string,
    serverName: string,
  ): Promise<Array<PlannedFile & { purpose: string }>> {
    if (!this.aiService) {
      this.logger.warn(
        "AIService not available, skipping AI mission file generation",
      );
      return [];
    }
    const aiService = this.aiService;

    const objectiveTypes = mission.objectives.map((o) => o.type);
    const prompt = buildMissionFilesPrompt(
      mission.title,
      mission.description,
      objectiveTypes,
      serverType,
      serverName,
    );

    const result = await aiService.generateResponse(
      prompt,
      MISSION_FILES_SYSTEM_PROMPT,
    );

    if (!result.success) return [];

    const validateMissionFiles = (parsed: any): Array<PlannedFile & { purpose: string }> | null => {
      if (!parsed || typeof parsed !== "object") return null;
      if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
      const files = parsed.files
        .filter(
          (f: any) =>
            typeof f.path === "string" &&
            f.path.startsWith("/") &&
            typeof f.content === "string" &&
            typeof f.purpose === "string",
        )
        .map((f: any) => ({
          path: f.path,
          content: String(f.content).slice(0, 2000),
          isHidden: Boolean(f.isHidden),
          isEncrypted: Boolean(f.isEncrypted),
          isProtected: false,
          purpose: f.purpose,
        }));
      return files.length > 0 ? files : null;
    };

    const validated = validateOrRetry(result.response, validateMissionFiles);
    return validated ?? [];
  }

  /**
   * Generate static mission files as a fallback.
   */
  private generateStaticMissionFiles(
    mission: { title: string; objectives: Array<{ type: string }> },
    hasFileObjectives: boolean,
  ): Array<PlannedFile & { purpose: string }> {
    const files: Array<PlannedFile & { purpose: string }> = [];
    const timestamp = new Date().toISOString().split("T")[0];

    if (hasFileObjectives) {
      // Create an objective target file
      files.push({
        path: "/data/.classified_intel.dat",
        content: [
          `CLASSIFIED DOCUMENT — ${timestamp}`,
          `Reference: ${mission.title}`,
          "",
          "CONTENTS: [ENCRYPTED PAYLOAD]",
          "AUTH: Level 4 clearance required",
          "STATUS: Active — do not distribute",
          "",
          ">> This file contains sensitive intelligence.",
          ">> Unauthorized access will trigger security protocols.",
        ].join("\n"),
        isHidden: true,
        purpose: "objective_target",
      });
    }

    // Always add evidence / breadcrumb files
    files.push({
      path: "/logs/security/recent_activity.log",
      content: [
        `[${timestamp} 03:14:22] AUTH admin — SUCCESS`,
        `[${timestamp} 03:15:01] FILE_ACCESS /data/.classified_intel.dat — admin`,
        `[${timestamp} 04:22:17] ANOMALY — unexpected outbound connection`,
        `[${timestamp} 04:22:19] ALERT — data exfiltration signature detected`,
        `[${timestamp} 04:23:00] LOCKDOWN — automated response engaged`,
      ].join("\n"),
      purpose: "breadcrumb",
    });

    files.push({
      path: "/tmp/.mission_notes.txt",
      content: [
        ">> Intercepted communication fragment <<",
        "",
        `Operation: ${mission.title}`,
        "Status: In progress",
        "Priority: HIGH",
        "",
        "Note: Check /data for the target files.",
        "The security logs may have useful timestamps.",
      ].join("\n"),
      isHidden: true,
      purpose: "objective_evidence",
    });

    return files;
  }
}

export default ServerContentService;
