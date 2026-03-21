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

import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { LOGGER } from "../di/tokens";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single file to plant on a server's filesystem. */
interface PlannedFile {
  path: string;
  content: string;
  isHidden?: boolean;
  isEncrypted?: boolean;
  isProtected?: boolean;
}

/** A single directory to create on a server's filesystem. */
interface PlannedDirectory {
  path: string;
  isHidden?: boolean;
  isProtected?: boolean;
}

/** The full content plan for a server, either AI-generated or static. */
interface ServerContentPlan {
  directories: PlannedDirectory[];
  files: PlannedFile[];
}

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
// Static content templates — used when AI is unavailable
// ---------------------------------------------------------------------------

const STATIC_CONTENT: Record<string, ServerContentPlan> = {
  corporate: {
    directories: [
      { path: "/data" },
      { path: "/data/employees" },
      { path: "/data/financial" },
      { path: "/data/research", isProtected: true },
      { path: "/data/backups", isHidden: true },
      { path: "/logs" },
      { path: "/logs/access" },
      { path: "/logs/security" },
      { path: "/www" },
      { path: "/www/public" },
      { path: "/mail" },
      { path: "/mail/admin" },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          "=== AUTHORIZED ACCESS ONLY ===\nAll activity on this system is monitored and logged.\nUnauthorized access will be prosecuted to the fullest extent of the law.\n",
      },
      {
        path: "/www/public/index.html",
        content:
          "<html><head><title>Corporate Portal</title></head>\n<body><h1>Welcome to the Corporate Network</h1>\n<p>Authorized personnel only. Contact IT for access credentials.</p></body></html>\n",
      },
      {
        path: "/data/employees/directory.csv",
        content:
          "id,name,department,clearance\n001,J.Smith,Engineering,3\n002,A.Chen,Finance,2\n003,R.Kumar,Security,5\n004,L.Johansson,Research,4\n",
      },
      {
        path: "/data/financial/q4_report.txt",
        content:
          "Q4 FINANCIAL SUMMARY — CONFIDENTIAL\n\nRevenue: $42.8M (+12% YoY)\nR&D Spend: $8.1M\nNet Income: $11.2M\n\nProjection: Aggressive acquisition strategy in Q1.\n",
      },
      {
        path: "/logs/access/auth.log",
        content:
          "[2024-12-01 03:14:22] LOGIN admin@corp.internal — SUCCESS\n[2024-12-01 03:15:01] ACCESS /data/research — DENIED (clearance 2 < 4)\n[2024-12-01 04:22:17] LOGIN root@localhost — FAILED (3 attempts)\n[2024-12-01 04:22:19] LOCKOUT root@localhost — 15 min\n",
      },
      {
        path: "/data/backups/.env.bak",
        content:
          "DB_HOST=172.16.0.50\nDB_USER=sa\nDB_PASS=Tr0ub4dor&3\nAPI_KEY=sk-corp-889af23c\n",
        isHidden: true,
      },
      {
        path: "/mail/admin/memo.txt",
        content:
          "From: IT Security <itsec@corp.internal>\nTo: All Staff\nSubject: Password Policy Update\n\nEffective immediately: all passwords must be rotated every 30 days.\nPlease do NOT store credentials in plaintext files.\n\n— IT Security Team\n",
      },
    ],
  },

  government: {
    directories: [
      { path: "/classified", isProtected: true },
      { path: "/classified/operations" },
      { path: "/classified/intelligence" },
      { path: "/public" },
      { path: "/public/notices" },
      { path: "/logs" },
      { path: "/logs/audit" },
      { path: "/personnel" },
      { path: "/personnel/active" },
      { path: "/personnel/archived", isHidden: true },
      { path: "/comms" },
      { path: "/comms/encrypted", isProtected: true },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          "*** GOVERNMENT SECURE NETWORK ***\nClassification: RESTRICTED\nAll connections are monitored. Unauthorized access is a federal offense.\n",
      },
      {
        path: "/public/notices/advisory_2024.txt",
        content:
          "CYBERSECURITY ADVISORY 2024-117\n\nThreat Level: ELEVATED\nMultiple intrusion attempts detected across government networks.\nAll personnel must enable two-factor authentication immediately.\nReport suspicious activity to CERT.\n",
      },
      {
        path: "/classified/operations/op_blacksite.txt",
        content:
          "OPERATION BLACKSITE — TOP SECRET\nStatus: ACTIVE\nObjective: Locate and contain rogue AI entity (codename: SIGNAL)\nAssets deployed: 4 field teams, 12 digital operatives\nLast contact: Subnet 169.254.x.x — signal lost.\n",
        isProtected: true,
      },
      {
        path: "/logs/audit/connections.log",
        content:
          "[2024-12-01 00:00:01] SYSTEM BOOT — secure kernel loaded\n[2024-12-01 00:01:15] SSH admin@gov.mil.net — key auth OK\n[2024-12-01 02:33:44] ALERT — anomalous traffic from 169.254.42.1\n[2024-12-01 02:34:01] FIREWALL — blocked 169.254.42.1 (rule: gov_perimeter)\n",
      },
      {
        path: "/personnel/active/roster.dat",
        content:
          "PERSONNEL ROSTER — CLEARANCE LEVEL 3+\nCOMMANDER STEELE — CL5 — CYBER OPS DIVISION\nAGENT VOSS — CL4 — FIELD OPERATIONS\nAGENT MORA — CL3 — SIGNALS INTELLIGENCE\nAGENT NULL — CL5 — [REDACTED]\n",
      },
      {
        path: "/comms/encrypted/.directive_7.enc",
        content:
          "ENCRYPTED COMMUNICATION — CIPHER: AES-256-GCM\n[HEADER] FROM: HIGH COMMAND\n[HEADER] TO: ALL STATION CHIEFS\n[BODY] ████████████████████████████████\n        ████ AIDA ████ PRIORITY ████\n        ████████████████████████████████\n",
        isHidden: true,
        isEncrypted: true,
      },
    ],
  },

  underground: {
    directories: [
      { path: "/drops" },
      { path: "/drops/active" },
      { path: "/drops/expired" },
      { path: "/tools" },
      { path: "/tools/exploits" },
      { path: "/tools/scripts" },
      { path: "/boards" },
      { path: "/boards/public" },
      { path: "/boards/verified", isProtected: true },
      { path: "/stash", isHidden: true },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          ">> Welcome to the Underground <<\n>> Trust no one. Verify everything. <<\n>> Leave no trace. <<\n",
      },
      {
        path: "/boards/public/rules.txt",
        content:
          "RULES:\n1. No fed talk. No snitching. Period.\n2. Verify your handle before posting in /verified.\n3. Dead drops expire in 48h. Claim them or lose them.\n4. Exploits stay in /tools. Don't leak to clearnet.\n5. If AIDA contacts you — tell no one.\n",
      },
      {
        path: "/tools/exploits/readme.txt",
        content:
          "EXPLOIT REPOSITORY\n\nAvailable tools:\n  - port_scanner.sh    — Fast TCP/UDP scanner\n  - brute.py           — Dictionary attack toolkit\n  - sqli_probe.rb      — SQL injection detector\n  - priv_esc.sh        — Local privilege escalation\n\nUse responsibly. Or don't. We're not your mother.\n",
      },
      {
        path: "/tools/scripts/port_scanner.sh",
        content:
          '#!/bin/bash\n# Fast port scanner — scans common ports\nTARGET=$1\nfor PORT in 21 22 23 25 53 80 110 143 443 993 995 3306 5432 8080; do\n  (echo >/dev/tcp/$TARGET/$PORT) 2>/dev/null && echo "[+] $TARGET:$PORT OPEN"\ndone\n',
      },
      {
        path: "/drops/active/dead_drop_001.dat",
        content:
          "DEAD DROP #001\nPosted: 2024-12-01 02:15 UTC\nExpires: 2024-12-03 02:15 UTC\n\nIntel package: Garrison patrol schedules, sector 7.\nPrice: 500 credits or equivalent trade.\nContact: GhostNode via encrypted DM.\n",
      },
      {
        path: "/stash/.credentials.txt",
        content:
          "LEAKED CREDENTIALS — HANDLE WITH CARE\n\nadmin@techcorp.io : Summer2024!\nroot@gov-relay-7  : [rotated — check dead drop #003]\nsa@corp-db-prod   : Tr0ub4dor&3\n",
        isHidden: true,
      },
    ],
  },

  tutorial: {
    directories: [
      { path: "/tutorial" },
      { path: "/tutorial/lessons" },
      { path: "/practice" },
      { path: "/practice/sandbox" },
      { path: "/docs" },
    ],
    files: [
      {
        path: "/etc/motd",
        content:
          "=== AIDA TUTORIAL SERVER ===\nWelcome, recruit. This server is your training ground.\nExplore the filesystem, read the lessons, and practice your skills.\nType 'help' if you get stuck.\n",
      },
      {
        path: "/tutorial/lessons/01_navigation.txt",
        content:
          "LESSON 1: NAVIGATION\n\nBasic commands:\n  ls          — List files and directories\n  cd <dir>    — Change directory\n  pwd         — Print working directory\n  cat <file>  — Read a file\n\nTry it now:\n  1. Type 'ls' to see what's here\n  2. Type 'cd tutorial' to enter this directory\n  3. Type 'cat lessons/01_navigation.txt' to read this file\n",
      },
      {
        path: "/tutorial/lessons/02_scanning.txt",
        content:
          "LESSON 2: NETWORK SCANNING\n\nNow that you can navigate, let's find other servers.\n\n  scan          — Scan your current network for servers\n  servers       — List all servers you know about\n  connect <ip>  — Connect to a server\n  disconnect    — Return to your home server\n\nTry: 'disconnect' to go home, then 'scan' to find more servers.\n",
      },
      {
        path: "/tutorial/lessons/03_hacking.txt",
        content:
          "LESSON 3: HACKING (coming soon)\n\nOnce your hacking skill reaches level 20, you can attempt to\nhack into secured servers. The 'hack' command will initiate a\nmulti-stage minigame.\n\nFor now, focus on exploring and leveling up your skills.\n",
      },
      {
        path: "/practice/sandbox/test_file.txt",
        content:
          "This is a sandbox file. Feel free to practice:\n  - Creating files: touch <name>\n  - Making directories: mkdir <name>\n  - Reading files: cat <name>\n\nNothing here is permanent. Experiment freely.\n",
      },
      {
        path: "/docs/commands.txt",
        content:
          "QUICK REFERENCE — COMMON COMMANDS\n\n  help              Show all available commands\n  help <category>   Show commands in a category\n  man <command>     Detailed manual for a command\n  status            Your player stats\n  scan              Scan for nearby servers\n  servers           List known servers\n  connect <ip>      Connect to a server\n  disconnect        Return home\n  ls                List directory contents\n  cd <dir>          Change directory\n  cat <file>        Read a file\n  missions          View your missions\n",
      },
    ],
  },

  player_home: {
    directories: [],
    files: [],
  },
};

// Default plan for unknown server types
const DEFAULT_CONTENT: ServerContentPlan = {
  directories: [{ path: "/data" }, { path: "/logs" }, { path: "/tmp" }],
  files: [
    {
      path: "/etc/motd",
      content: "System online. No additional information available.\n",
    },
    {
      path: "/logs/system.log",
      content:
        "[BOOT] System initialized\n[INFO] Network interface up\n[INFO] Services started\n",
    },
  ],
};

// ---------------------------------------------------------------------------
// AI prompt templates for server content generation
// ---------------------------------------------------------------------------

const SERVER_CONTENT_SYSTEM_PROMPT = `You are an AI game content generator for AIDA, a hacker RPG.
Your job is to generate realistic filesystem content for game servers.

RULES:
- Output ONLY valid JSON, no other text
- File content should feel authentic to the server type
- Include subtle story hooks, faction references, or hints
- Keep individual file contents SHORT (5-15 lines max)
- Directory names should be lowercase, no spaces
- File paths must be absolute (start with /)
- Do NOT generate player_home content
- Make some files hidden (prefix with .) for skilled players to discover`;

function buildServerContentPrompt(
  serverType: string,
  serverName: string,
  factionName?: string,
  factionDescription?: string,
): string {
  let prompt = `Generate filesystem content for a "${serverType}" server named "${serverName}".`;

  if (factionName) {
    prompt += `\nThis server belongs to the faction "${factionName}".`;
    if (factionDescription) {
      prompt += ` ${factionDescription}`;
    }
    prompt += `\nInclude faction-specific files, communications, and references.`;
  }

  prompt += `

Return a JSON object with this exact structure:
{
  "directories": [
    { "path": "/some/dir", "isHidden": false, "isProtected": false }
  ],
  "files": [
    { "path": "/some/file.txt", "content": "file content here", "isHidden": false, "isEncrypted": false, "isProtected": false }
  ]
}

Generate 6-10 directories and 5-8 files. Include at least one hidden file with a story hint.`;

  return prompt;
}

const MISSION_FILES_SYSTEM_PROMPT = `You are an AI game content generator for AIDA, a hacker RPG.
Your job is to generate files that serve as objectives or evidence for player missions.

RULES:
- Output ONLY valid JSON, no other text
- File content must be relevant to the mission objective
- Files should feel like real data a hacker would find or plant
- Keep file contents SHORT (3-10 lines)
- File paths must be absolute (start with /)
- Include realistic details (dates, names, account numbers, etc.)`;

function buildMissionFilesPrompt(
  missionTitle: string,
  missionDescription: string,
  objectiveTypes: string[],
  serverType: string,
  serverName: string,
): string {
  return `Generate files for a hacker mission on a "${serverType}" server named "${serverName}".

Mission: "${missionTitle}"
Description: ${missionDescription}
Objective types involved: ${objectiveTypes.join(", ")}

Return a JSON object:
{
  "files": [
    { "path": "/some/path/file.txt", "content": "content", "isHidden": false, "isEncrypted": false, "purpose": "objective_evidence" }
  ]
}

Generate 2-4 files. Each file should have a "purpose" field explaining its role:
- "objective_target" — the file the player must steal/delete/upload
- "objective_evidence" — evidence or intel related to the mission
- "red_herring" — a decoy file to make the mission more interesting
- "breadcrumb" — a hint pointing toward the objective

At least one file must be an "objective_target".`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@injectable()
export class ServerContentService {
  private prisma: PrismaClient;

  constructor(
    @inject("PrismaClient") prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
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
        include: { faction: { include: { aiPersona: true } } },
      });

      if (!server) {
        this.logger.warn({ serverId }, "Server not found for provisioning");
        return;
      }

      // Skip player homes — they have their own initialization
      if (server.isPlayerHome || server.type === "player_home") {
        return;
      }

      // Check if server already has content beyond the base scaffold
      if (!options.force) {
        const fileCount = await this.prisma.fileSystemNode.count({
          where: { serverId },
        });
        // Base scaffold creates ~7 nodes (root + home/bin/etc/var/tmp/logs).
        // If we have more than that, content was already provisioned.
        if (fileCount > 8) {
          this.logger.debug(
            { serverId, fileCount },
            "Server already has content, skipping provision",
          );
          return;
        }
      }

      // Ensure base filesystem exists
      await this.ensureBaseFilesystem(serverId, server.ownerId || "system");

      // Generate content plan
      const plan = await this.generateContentPlan(
        server.type,
        server.name,
        server.faction?.name,
        server.faction?.description ?? undefined,
        server.faction?.aiPersona?.systemPrompt ?? undefined,
        options.skipAI,
      );

      // Apply the plan
      await this.applyContentPlan(serverId, server.ownerId || "system", plan);

      this.logger.info(
        {
          serverId,
          serverName: server.name,
          serverType: server.type,
          dirs: plan.directories.length,
          files: plan.files.length,
        },
        "Server content provisioned",
      );
    } catch (error) {
      this.logger.error(
        { err: error, serverId },
        "Failed to provision server content",
      );
      // Fire-and-forget: don't rethrow
    }
  }

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
      // Determine which objective types need server/file infrastructure
      const serverObjectiveTypes = new Set([
        "hack",
        "hack_target",
        "hack_stealth",
        "hack_method",
        "gain_access",
        "steal",
        "steal_count",
        "upload_file",
        "delete_file",
        "connect_server",
        "explore",
        "discover_server_type",
      ]);

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

    // Use FileService's initializer via lazy import to avoid circular DI
    const { getService } = await import("../di/container");
    const { FILE_SERVICE } = await import("../di/tokens");
    const fileService = getService<any>(FILE_SERVICE);
    await fileService.initializeFileSystem(serverId, ownerId);
  }

  /**
   * Generate a content plan for a server.
   * Tries AI first, falls back to static templates.
   */
  private async generateContentPlan(
    serverType: string,
    serverName: string,
    factionName?: string,
    factionDescription?: string,
    factionSystemPrompt?: string,
    skipAI?: boolean,
  ): Promise<ServerContentPlan> {
    // Try AI generation
    if (!skipAI) {
      try {
        const aiPlan = await this.generateContentPlanWithAI(
          serverType,
          serverName,
          factionName,
          factionDescription,
          factionSystemPrompt,
        );
        if (aiPlan) return aiPlan;
      } catch (err) {
        this.logger.debug(
          { err },
          "AI content generation failed, falling back to static",
        );
      }
    }

    // Fall back to static template
    return this.getStaticContentPlan(serverType);
  }

  /**
   * Attempt to generate content plan using AI.
   */
  private async generateContentPlanWithAI(
    serverType: string,
    serverName: string,
    factionName?: string,
    factionDescription?: string,
    factionSystemPrompt?: string,
  ): Promise<ServerContentPlan | null> {
    try {
      const { getService } = await import("../di/container");
      const { AI_SERVICE } = await import("../di/tokens");
      const aiService = getService<any>(AI_SERVICE);

      const systemPrompt = factionSystemPrompt
        ? `${factionSystemPrompt}\n\n${SERVER_CONTENT_SYSTEM_PROMPT}`
        : SERVER_CONTENT_SYSTEM_PROMPT;

      const prompt = buildServerContentPrompt(
        serverType,
        serverName,
        factionName,
        factionDescription,
      );

      const { response } = await aiService.generateResponse(
        prompt,
        systemPrompt,
      );

      // Extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.debug("AI response did not contain valid JSON");
        return null;
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate structure
      if (!Array.isArray(parsed.directories) || !Array.isArray(parsed.files)) {
        this.logger.debug("AI JSON missing directories or files arrays");
        return null;
      }

      // Sanitize paths
      const plan: ServerContentPlan = {
        directories: parsed.directories
          .filter(
            (d: any) => typeof d.path === "string" && d.path.startsWith("/"),
          )
          .map((d: any) => ({
            path: d.path,
            isHidden: Boolean(d.isHidden),
            isProtected: Boolean(d.isProtected),
          })),
        files: parsed.files
          .filter(
            (f: any) =>
              typeof f.path === "string" &&
              f.path.startsWith("/") &&
              typeof f.content === "string",
          )
          .map((f: any) => ({
            path: f.path,
            content: String(f.content).slice(0, 2000), // Cap content length
            isHidden: Boolean(f.isHidden),
            isEncrypted: Boolean(f.isEncrypted),
            isProtected: Boolean(f.isProtected),
          })),
      };

      // Must have at least some content to be useful
      if (plan.directories.length === 0 && plan.files.length === 0) {
        return null;
      }

      return plan;
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
   * Apply a content plan to a server's filesystem.
   */
  private async applyContentPlan(
    serverId: string,
    ownerId: string,
    plan: ServerContentPlan,
  ): Promise<void> {
    const { getService } = await import("../di/container");
    const { FILE_SERVICE } = await import("../di/tokens");
    const fileService = getService<any>(FILE_SERVICE);

    // Create directories first (in order, so parents exist before children)
    const sortedDirs = [...plan.directories].sort(
      (a, b) => a.path.split("/").length - b.path.split("/").length,
    );

    for (const dir of sortedDirs) {
      try {
        const result = await fileService.createDirectory(
          serverId,
          ownerId,
          dir.path,
        );
        if (!result.success && result.error !== "ALREADY_EXISTS") {
          this.logger.debug(
            { path: dir.path, error: result.error },
            "Failed to create directory",
          );
        }

        // Set hidden/protected flags if needed
        if ((dir.isHidden || dir.isProtected) && result.success) {
          const node = await this.prisma.fileSystemNode.findFirst({
            where: { serverId, name: dir.path.split("/").pop()! },
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
      } catch (err) {
        this.logger.debug(
          { err, path: dir.path },
          "Error creating directory during provision",
        );
      }
    }

    // Create files
    for (const file of plan.files) {
      try {
        const result = await fileService.createFile(
          serverId,
          ownerId,
          file.path,
          file.content,
          file.isEncrypted || false,
        );
        if (!result.success && result.error !== "ALREADY_EXISTS") {
          this.logger.debug(
            { path: file.path, error: result.error },
            "Failed to create file",
          );
        }

        // Set hidden/protected flags if needed
        if ((file.isHidden || file.isProtected) && result.success) {
          const fileName = file.path.split("/").pop()!;
          const dirPath =
            file.path.substring(0, file.path.length - fileName.length - 1) ||
            "/";
          const parentNode = await this.findNodeByPath(serverId, dirPath);
          if (parentNode) {
            const node = await this.prisma.fileSystemNode.findFirst({
              where: {
                serverId,
                parentId: parentNode.id,
                name: fileName,
              },
            });
            if (node) {
              await this.prisma.fileSystemNode.update({
                where: { id: node.id },
                data: {
                  ...(file.isHidden ? { isHidden: true } : {}),
                  ...(file.isProtected ? { isProtected: true } : {}),
                },
              });
            }
          }
        }
      } catch (err) {
        this.logger.debug(
          { err, path: file.path },
          "Error creating file during provision",
        );
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
  } | null> {
    try {
      const { getService } = await import("../di/container");
      const { IP_SERVICE, SERVER_SERVICE } = await import("../di/tokens");
      const ipService = getService<any>(IP_SERVICE);
      const serverService = getService<any>(SERVER_SERVICE);

      // Determine which IP zone to use
      const zoneMap: Record<string, string> = {
        corporate: "corporate",
        government: "government",
        underground: "underground",
      };
      const zone = zoneMap[serverType] || "corporate";
      const ip = await ipService.generateUniqueIP(zone);

      // Generate a thematic name
      const name = this.generateServerName(serverType, mission.factionId);

      const encryptionLevel = Math.min(
        100,
        Math.max(0, mission.difficulty * 10),
      );

      const server = await serverService.createServer({
        name,
        ipAddress: ip,
        type: serverType,
        encryptionLevel,
        maxConnections: 10 + mission.difficulty * 2,
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
        ownerId: null,
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
    const { FILE_SERVICE } = await import("../di/tokens");
    const fileService = getService<any>(FILE_SERVICE);

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
    const { getService } = await import("../di/container");
    const { AI_SERVICE } = await import("../di/tokens");
    const aiService = getService<any>(AI_SERVICE);

    const objectiveTypes = mission.objectives.map((o) => o.type);
    const prompt = buildMissionFilesPrompt(
      mission.title,
      mission.description,
      objectiveTypes,
      serverType,
      serverName,
    );

    const { response } = await aiService.generateResponse(
      prompt,
      MISSION_FILES_SYSTEM_PROMPT,
    );

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.files)) return [];

    return parsed.files
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

  // ========================================================================
  // Utilities
  // ========================================================================

  /**
   * Find a filesystem node by its full path on a server.
   */
  private async findNodeByPath(
    serverId: string,
    path: string,
  ): Promise<{ id: string } | null> {
    if (path === "/" || path === "") {
      return this.prisma.fileSystemNode.findFirst({
        where: { serverId, parentId: null, type: "directory" },
        select: { id: true },
      });
    }

    const parts = path.split("/").filter(Boolean);
    let current = await this.prisma.fileSystemNode.findFirst({
      where: { serverId, parentId: null, type: "directory" },
      select: { id: true },
    });

    for (const part of parts) {
      if (!current) return null;
      const next = await this.prisma.fileSystemNode.findFirst({
        where: { serverId, parentId: current.id, name: part },
        select: { id: true },
      });
      if (!next) return null;
      current = next;
    }

    return current;
  }
}

export default ServerContentService;
