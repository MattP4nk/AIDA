/**
 * DynamicContentService — Injects files and log entries into servers
 * in response to game events (hacks, bounties, wars, missions).
 *
 * This service provides the HOOKS — it listens to events and writes
 * filesystem entries. Content templates and AI generation are separate concerns.
 *
 * Event → ContentHook → FileSystemNode created on target server
 */

import { injectable, inject } from "tsyringe";
import type { PrismaClient } from "@prisma/client";
import type { Logger } from "pino";
import { LOGGER, PRISMA_CLIENT } from "../di/tokens";
import { ContentEncoder, EncodingType } from "../utils/contentEncoder";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

/** A content entry to be injected into a server's filesystem */
export interface ContentInjection {
  serverId: string;
  /** Path relative to server root (e.g. "/var/log/security.log") */
  path: string;
  /** Content to write. Can be plain text or encoded via ContentEncoder. */
  content: string;
  /** If true, append to existing file instead of creating new */
  append?: boolean;
  /** Optional encoding to apply before writing */
  encoding?: EncodingType;
  encodingKey?: number;
  /** File metadata */
  isHidden?: boolean;
  isEncrypted?: boolean;
  /** Tag for content categorization */
  contentTag?: string;
}

/** Configuration for a content hook */
export interface ContentHook {
  /** Event name to listen for (e.g. "hack:detected") */
  event: string;
  /** Function that generates content injections from event data */
  generator: (data: any) => ContentInjection[] | Promise<ContentInjection[]>;
}

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class DynamicContentService {
  private hooks: ContentHook[] = [];
  private prisma: PrismaClient;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(PRISMA_CLIENT) prisma: PrismaClient,
  ) {
    this.prisma = prisma;
    this.registerDefaultHooks();
  }

  // ── Hook Registration ──

  /** Register a content hook for a specific event */
  registerHook(hook: ContentHook): void {
    this.hooks.push(hook);
    this.logger.debug({ event: hook.event }, "Dynamic content hook registered");
  }

  /** Get all hooks for a given event */
  getHooksForEvent(event: string): ContentHook[] {
    return this.hooks.filter(h => h.event === event);
  }

  // ── Event Processing ──

  /** Process a game event through all matching hooks */
  async processEvent(event: string, data: any): Promise<number> {
    const hooks = this.getHooksForEvent(event);
    if (hooks.length === 0) return 0;

    let injected = 0;
    for (const hook of hooks) {
      try {
        const injections = await hook.generator(data);
        for (const injection of injections) {
          await this.injectContent(injection);
          injected++;
        }
      } catch (err) {
        this.logger.error({ err, event }, "Dynamic content hook error");
      }
    }
    return injected;
  }

  // ── Content Injection ──

  /** Inject a single content entry into a server's filesystem */
  async injectContent(injection: ContentInjection): Promise<boolean> {
    try {
      const { serverId, path, append, encoding, encodingKey, isHidden, isEncrypted, contentTag } = injection;
      let { content } = injection;

      // Apply encoding if specified
      if (encoding) {
        content = ContentEncoder.encode(content, encoding, encodingKey);
      }

      // Parse path into directory + filename
      const parts = path.split("/").filter(Boolean);
      const fileName = parts.pop();
      if (!fileName) return false;
      const dirPath = "/" + parts.join("/");

      // Find or create parent directory chain
      const parentId = await this.ensureDirectoryChain(serverId, dirPath);
      if (!parentId) return false;

      if (append) {
        // Append to existing file
        const existing = await this.prisma.fileSystemNode.findFirst({
          where: { serverId, parentId, name: fileName, type: "file" },
        });
        if (existing) {
          const newContent = (existing.content || "") + "\n" + content;
          await this.prisma.fileSystemNode.update({
            where: { id: existing.id },
            data: {
              content: newContent,
              size: newContent.length,
              modifiedAt: new Date(),
            },
          });
          return true;
        }
        // Fall through to create if doesn't exist
      }

      // Check if file already exists (for non-append, skip if exists)
      if (!append) {
        const existing = await this.prisma.fileSystemNode.findFirst({
          where: { serverId, parentId, name: fileName, type: "file" },
        });
        if (existing) {
          // Update instead of duplicate
          await this.prisma.fileSystemNode.update({
            where: { id: existing.id },
            data: {
              content,
              size: content.length,
              modifiedAt: new Date(),
              ...(contentTag ? { metadata: { contentTag, generatedAt: new Date().toISOString() } } : {}),
            },
          });
          return true;
        }
      }

      // Create new file
      await this.prisma.fileSystemNode.create({
        data: {
          serverId,
          parentId,
          name: fileName,
          type: "file",
          content,
          size: content.length,
          isHidden: isHidden ?? false,
          isEncrypted: isEncrypted ?? false,
          ...(contentTag ? { metadata: { contentTag, generatedAt: new Date().toISOString() } } : {}),
        },
      });

      this.logger.debug({ serverId, path, contentTag }, "Dynamic content injected");
      return true;
    } catch (err) {
      this.logger.error({ err, path: injection.path }, "Content injection failed");
      return false;
    }
  }

  // ── Directory Management ──

  /** Ensure a directory chain exists, return the final directory's ID */
  private async ensureDirectoryChain(serverId: string, dirPath: string): Promise<string | null> {
    const parts = dirPath.split("/").filter(Boolean);

    // Find root
    const root = await this.prisma.fileSystemNode.findFirst({
      where: { serverId, name: "/", parentId: null, type: "directory" },
    });
    if (!root) return null;

    let currentId = root.id;

    for (const part of parts) {
      let dir = await this.prisma.fileSystemNode.findFirst({
        where: { serverId, parentId: currentId, name: part, type: "directory" },
      });

      if (!dir) {
        dir = await this.prisma.fileSystemNode.create({
          data: {
            serverId,
            parentId: currentId,
            name: part,
            type: "directory",
            content: null,
            size: 0,
          },
        });
      }

      currentId = dir.id;
    }

    return currentId;
  }

  // ── Default Hooks ──

  /** Register built-in content hooks for core game events */
  private registerDefaultHooks(): void {
    // ── Hack detected → security log on target server ──
    this.registerHook({
      event: "hack:detected",
      generator: (data) => {
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] SECURITY ALERT: Unauthorized access detected. ` +
          `Method: ${data.method || "unknown"}. ` +
          `Evidence level: ${data.evidenceLeft || 0}%. ` +
          `Source: ${data.attackerIp || "unknown"}. ` +
          `Access level achieved: ${data.accessLevel || 0}/10.`;

        return [{
          serverId: data.serverId,
          path: "/var/log/security.log",
          content: logEntry,
          append: true,
          contentTag: "security_log",
        }];
      },
    });

    // ── Hack attempt (successful) → access log on target server ──
    this.registerHook({
      event: "hack:attempt",
      generator: (data) => {
        if (!data.result?.success) return [];
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] CONNECTION: Remote session established. ` +
          `Access: level ${data.result.accessLevel || 0}. ` +
          `Files discovered: ${data.result.discoveredFiles?.length || 0}.`;

        return [{
          serverId: data.targetServerId,
          path: "/var/log/access.log",
          content: logEntry,
          append: true,
          contentTag: "access_log",
        }];
      },
    });

    // ── Bounty posted → wanted notice file on faction servers ──
    this.registerHook({
      event: "bounty:posted",
      generator: async (data) => {
        const injections: ContentInjection[] = [];
        // Find faction's servers
        const factionServers = await this.prisma.gameServer.findMany({
          where: { factionId: data.factionId, isPlayerHome: false },
          select: { id: true },
          take: 3, // Don't spam every server
        });

        const notice = `WANTED — ${data.targetUsername}\n` +
          `Reason: ${data.reason}\n` +
          `Reward: ${data.rewardCredits}c + ${data.rewardReputation} reputation\n` +
          `Posted: ${new Date().toISOString()}\n` +
          `Expires: ${data.expiresAt || "48 hours"}\n` +
          `Contact faction command for details.`;

        for (const server of factionServers) {
          injections.push({
            serverId: server.id,
            path: "/var/notices/wanted.txt",
            content: notice,
            contentTag: "bounty_notice",
          });
        }
        return injections;
      },
    });

    // ── IDS alert → intrusion log on home server ──
    this.registerHook({
      event: "ids_alert",
      generator: (data) => {
        if (!data.homeServerId) return [];
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] IDS: ${data.message}`;

        return [{
          serverId: data.homeServerId,
          path: "/var/log/ids.log",
          content: logEntry,
          append: true,
          contentTag: "ids_log",
        }];
      },
    });

    // ── Honeypot triggered → trap log on home server ──
    this.registerHook({
      event: "honeypot:triggered",
      generator: (data) => {
        if (!data.serverId) return [];
        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] HONEYPOT: Decoy '${data.fileName}' accessed by ${data.attackerId || "unknown"}.`;

        return [{
          serverId: data.serverId,
          path: "/var/log/honeypot.log",
          content: logEntry,
          append: true,
          isHidden: true,
          contentTag: "honeypot_log",
        }];
      },
    });

    // ── War declared → war notice on both factions' servers ──
    this.registerHook({
      event: "war:declared",
      generator: async (data) => {
        const injections: ContentInjection[] = [];
        const factionIds = [data.attackerFactionId, data.defenderFactionId].filter(Boolean);
        const servers = await this.prisma.gameServer.findMany({
          where: { factionId: { in: factionIds }, isPlayerHome: false },
          select: { id: true, factionId: true },
          take: 6,
        });

        const timestamp = new Date().toISOString();
        for (const server of servers) {
          const isAttacker = server.factionId === data.attackerFactionId;
          const notice = isAttacker
            ? `[${timestamp}] WAR DECLARED: Operations against ${data.defenderName} are authorized. All agents engage.`
            : `[${timestamp}] ALERT: ${data.attackerName} has declared war. All operatives report to stations. Lockdown protocols engaged.`;

          injections.push({
            serverId: server.id,
            path: "/var/notices/war_bulletin.txt",
            content: notice,
            contentTag: "war_notice",
          });
        }
        return injections;
      },
    });

    // ── War ended → ceasefire notice on both factions' servers ──
    this.registerHook({
      event: "war:ended",
      generator: async (data) => {
        const injections: ContentInjection[] = [];
        const factionIds = [data.winnerFactionId, data.loserFactionId].filter(Boolean);
        const servers = await this.prisma.gameServer.findMany({
          where: { factionId: { in: factionIds }, isPlayerHome: false },
          select: { id: true, factionId: true },
          take: 6,
        });

        const timestamp = new Date().toISOString();
        for (const server of servers) {
          const isWinner = server.factionId === data.winnerFactionId;
          const notice = isWinner
            ? `[${timestamp}] VICTORY: War concluded. ${data.loserName} has ${data.reason || "surrendered"}. Stand down.`
            : `[${timestamp}] CEASEFIRE: War concluded. Terms accepted. Reparations in effect. Stand down.`;

          injections.push({
            serverId: server.id,
            path: "/var/notices/war_bulletin.txt",
            content: notice,
            contentTag: "war_notice",
          });
        }
        return injections;
      },
    });

    // ── Mission completed → intel report on faction servers ──
    this.registerHook({
      event: "mission:completed",
      generator: async (data) => {
        if (!data.factionId) return [];
        const factionServers = await this.prisma.gameServer.findMany({
          where: { factionId: data.factionId, isPlayerHome: false, role: { in: ["database", "workstation"] } },
          select: { id: true },
          take: 1,
        });
        if (factionServers.length === 0) return [];

        const timestamp = new Date().toISOString();
        const logEntry = `[${timestamp}] MISSION REPORT: "${data.missionTitle}" completed by operative. ` +
          `Objectives achieved: ${data.objectives?.length || "unknown"}.`;

        return [{
          serverId: factionServers[0]!.id,
          path: "/var/log/operations.log",
          content: logEntry,
          append: true,
          contentTag: "mission_report",
        }];
      },
    });

    // ── Contest resolved → territory notice on conquered server ──
    this.registerHook({
      event: "contest:resolved",
      generator: (data) => {
        if (!data.serverId) return [];
        const timestamp = new Date().toISOString();
        const notice = `[${timestamp}] TERRITORY UPDATE: Server now under control of ${data.winnerName}. ` +
          `Previous controller: ${data.loserName || "uncontested"}. ` +
          `Contest ID: ${data.contestId}.`;

        return [{
          serverId: data.serverId,
          path: "/var/notices/territory.txt",
          content: notice,
          contentTag: "territory_notice",
        }];
      },
    });

    this.logger.info(`Registered ${this.hooks.length} default dynamic content hooks`);
  }
}

export default DynamicContentService;
