import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import { PRISMA_CLIENT, LOGGER, CACHE_SERVICE } from "../di/tokens";
import { CacheService } from "./cacheService";

// ── Types ──────────────────────────────────────────────────────────────────

export type AssetType = "server" | "file" | "player";

export type KnowledgeSource =
  | "server_discovery"
  | "mission_completion"
  | "player_report"
  | "forum_intel"
  | "persona_observation";

export interface KnowledgeEntry {
  assetType: AssetType;
  assetId: string;
  assetMeta?: Record<string, unknown>;
  source: KnowledgeSource;
  confidence?: number;
  discoveredBy?: string;
  expiresAt?: Date | null;
}

export interface KnowledgeSnapshot {
  factionId: string;
  servers: KnowledgeAsset[];
  files: KnowledgeAsset[];
  players: KnowledgeAsset[];
  generatedAt: Date;
}

export interface KnowledgeAsset {
  assetId: string;
  assetMeta: Record<string, unknown>;
  confidence: number;
  source: string;
  discoveredBy: string | null;
  discoveredAt: Date;
}

// ── Service ────────────────────────────────────────────────────────────────

@injectable()
export class FactionKnowledgeService {
  private static readonly SNAPSHOT_TTL = 60; // 60s cache for snapshots

  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(CACHE_SERVICE) private cacheService: CacheService,
  ) {}

  /**
   * Add or update a knowledge entry for a faction.
   * Uses upsert on (factionId, assetType, assetId) — rediscovery updates confidence & meta.
   */
  async addEntry(factionId: string, entry: KnowledgeEntry): Promise<void> {
    try {
      await this.prisma.factionKnowledge.upsert({
        where: {
          factionId_assetType_assetId: {
            factionId,
            assetType: entry.assetType,
            assetId: entry.assetId,
          },
        },
        create: {
          factionId,
          assetType: entry.assetType,
          assetId: entry.assetId,
          assetMeta: (entry.assetMeta ?? {}) as any,
          source: entry.source,
          confidence: entry.confidence ?? 0.8,
          discoveredBy: entry.discoveredBy ?? null,
          expiresAt: entry.expiresAt ?? null,
        },
        update: {
          assetMeta: (entry.assetMeta ?? {}) as any,
          source: entry.source,
          // Confidence only increases on rediscovery, never decreases
          confidence: Math.max(entry.confidence ?? 0.8, 0),
          ...(entry.discoveredBy != null ? { discoveredBy: entry.discoveredBy } : {}),
          ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
        },
      });

      // Invalidate snapshot cache
      this.cacheService.del(`fk:snapshot:${factionId}`);

      this.logger.debug(
        { factionId, assetType: entry.assetType, assetId: entry.assetId },
        "Faction knowledge entry added/updated",
      );
    } catch (error) {
      this.logger.error(
        { error, factionId, assetType: entry.assetType, assetId: entry.assetId },
        "Error adding faction knowledge entry",
      );
    }
  }

  /**
   * Bulk-add multiple knowledge entries for a faction (e.g. after mission completion).
   */
  async addEntries(factionId: string, entries: KnowledgeEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.addEntry(factionId, entry);
    }
  }

  /**
   * Get all non-expired knowledge of a specific asset type for a faction.
   */
  async findByType(factionId: string, assetType: AssetType): Promise<KnowledgeAsset[]> {
    const rows = await this.prisma.factionKnowledge.findMany({
      where: {
        factionId,
        assetType,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { confidence: "desc" },
    });

    return rows.map((r) => ({
      assetId: r.assetId,
      assetMeta: (r.assetMeta as Record<string, unknown>) ?? {},
      confidence: r.confidence,
      source: r.source,
      discoveredBy: r.discoveredBy,
      discoveredAt: r.discoveredAt,
    }));
  }

  /**
   * Get a full snapshot of all faction knowledge (servers + files + players).
   * Cached for 60s to avoid repeated DB hits during mission generation.
   */
  async getSnapshot(factionId: string): Promise<KnowledgeSnapshot> {
    const cacheKey = `fk:snapshot:${factionId}`;
    const cached = this.cacheService.get<KnowledgeSnapshot>(cacheKey);
    if (cached) return cached;

    const [servers, files, players] = await Promise.all([
      this.findByType(factionId, "server"),
      this.findByType(factionId, "file"),
      this.findByType(factionId, "player"),
    ]);

    const snapshot: KnowledgeSnapshot = {
      factionId,
      servers,
      files,
      players,
      generatedAt: new Date(),
    };

    this.cacheService.set(cacheKey, snapshot, FactionKnowledgeService.SNAPSHOT_TTL);
    return snapshot;
  }

  /**
   * Check if a specific asset is known to a faction.
   */
  async isKnown(factionId: string, assetType: AssetType, assetId: string): Promise<boolean> {
    const entry = await this.prisma.factionKnowledge.findUnique({
      where: {
        factionId_assetType_assetId: { factionId, assetType, assetId },
      },
      select: { expiresAt: true },
    });
    if (!entry) return false;
    if (entry.expiresAt && entry.expiresAt < new Date()) return false;
    return true;
  }

  /**
   * Get known server IDs for a faction (convenience method for mission generation).
   */
  async getKnownServerIds(factionId: string): Promise<string[]> {
    const servers = await this.findByType(factionId, "server");
    return servers.map((s) => s.assetId);
  }

  /**
   * Get known file IDs for a faction on a specific server.
   */
  async getKnownFilesOnServer(factionId: string, serverId: string): Promise<KnowledgeAsset[]> {
    const files = await this.findByType(factionId, "file");
    return files.filter((f) => (f.assetMeta as any)?.serverId === serverId);
  }

  /**
   * Remove expired knowledge entries across all factions.
   * Called periodically (e.g. from scheduler).
   */
  async expireEntries(): Promise<number> {
    try {
      const result = await this.prisma.factionKnowledge.deleteMany({
        where: {
          expiresAt: { lt: new Date() },
        },
      });
      if (result.count > 0) {
        this.logger.info({ expired: result.count }, "Expired faction knowledge entries cleaned up");
      }
      return result.count;
    } catch (error) {
      this.logger.error(error, "Error expiring faction knowledge entries");
      return 0;
    }
  }

  /**
   * Get the faction ID for a player (via their membership).
   * Returns null if the player is not in any faction.
   */
  async getPlayerFactionId(userId: string): Promise<string | null> {
    const member = await this.prisma.factionMember.findFirst({
      where: { userId },
      select: { factionId: true },
    });
    return member?.factionId ?? null;
  }

  /**
   * Serialize a knowledge snapshot into a compact string for AI prompts.
   * Only includes high-confidence entries.
   */
  serializeForPrompt(snapshot: KnowledgeSnapshot, minConfidence: number = 0.5): string {
    const lines: string[] = ["KNOWN_TARGETS:"];

    const highConfServers = snapshot.servers.filter((s) => s.confidence >= minConfidence);
    const highConfFiles = snapshot.files.filter((f) => f.confidence >= minConfidence);
    const highConfPlayers = snapshot.players.filter((p) => p.confidence >= minConfidence);

    if (highConfServers.length > 0) {
      lines.push("  Servers:");
      for (const s of highConfServers.slice(0, 15)) {
        const meta = s.assetMeta;
        const name = meta.name || meta.serverName || "unknown";
        const ip = meta.ip || "";
        const type = meta.serverType || meta.type || "";
        lines.push(`    - id:${s.assetId} name:"${name}" ip:${ip} type:${type} confidence:${s.confidence.toFixed(1)}`);
      }
    }

    if (highConfFiles.length > 0) {
      lines.push("  Files:");
      for (const f of highConfFiles.slice(0, 15)) {
        const meta = f.assetMeta;
        const name = meta.name || meta.fileName || "unknown";
        const server = meta.serverId || "";
        lines.push(`    - id:${f.assetId} name:"${name}" server:${server} confidence:${f.confidence.toFixed(1)}`);
      }
    }

    if (highConfPlayers.length > 0) {
      lines.push("  Players:");
      for (const p of highConfPlayers.slice(0, 10)) {
        const meta = p.assetMeta;
        const name = meta.username || meta.name || "unknown";
        lines.push(`    - id:${p.assetId} name:"${name}" confidence:${p.confidence.toFixed(1)}`);
      }
    }

    if (lines.length === 1) {
      lines.push("  No known targets. Issue exploration or intel-gathering missions instead.");
    }

    lines.push("");
    lines.push("IMPORTANT: You may ONLY reference targets listed above. DO NOT invent new targets.");
    lines.push("If no suitable targets exist, respond with { \"fallback\": true }.");

    return lines.join("\n");
  }
}

export default FactionKnowledgeService;
