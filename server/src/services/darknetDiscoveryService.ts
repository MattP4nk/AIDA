import { injectable, inject } from "tsyringe";
import { PrismaClient, Prisma } from "@prisma/client";
import { Logger } from "pino";
import { DarkNetDiscoveryMethod } from "../../../shared/types";
import { AI_SERVICE, LOGGER, MESSAGE_SERVICE } from "../di/tokens";
import { AIService } from "./aiService";
import { MessageService } from "./messageService";

/** Skill thresholds for discovery via skill check */
const SKILL_THRESHOLD = { hacking: 60, stealth: 50 };

/** Number of censorship flags needed for discovery */
const CENSORSHIP_FLAG_THRESHOLD = 3;

/** Number of encrypted files found across different servers */
const BREADCRUMB_THRESHOLD = 3;

@injectable()
export default class DarkNetDiscoveryService {
  /** In-memory cache of discovered users for fast lookups */
  private discoveredCache = new Set<string>();

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(MESSAGE_SERVICE) private messageService: MessageService,
  ) {
    // Warm cache on construction
    this.warmCache().catch(() => {});
  }

  private async warmCache(): Promise<void> {
    const discoveries = await this.prisma.darkNetDiscovery.findMany({
      select: { userId: true },
    });
    for (const d of discoveries) {
      this.discoveredCache.add(d.userId);
    }
  }

  /**
   * Check if a player has discovered the DarkNet.
   */
  hasDiscoveredDarkNet(userId: string): boolean {
    return this.discoveredCache.has(userId);
  }

  /**
   * Async check (DB-backed) for discovery.
   */
  async hasDiscoveredDarkNetAsync(userId: string): Promise<boolean> {
    if (this.discoveredCache.has(userId)) return true;
    const d = await this.prisma.darkNetDiscovery.findUnique({
      where: { userId },
    });
    if (d) this.discoveredCache.add(userId);
    return !!d;
  }

  /**
   * Check if a trigger event should cause DarkNet discovery.
   * Called from various integration points.
   */
  async checkDiscoveryTrigger(
    userId: string,
    trigger: {
      type:
        | "hidden_file"
        | "skill_check"
        | "censorship_mention"
        | "encrypted_file";
      metadata?: Record<string, unknown>;
    },
  ): Promise<boolean> {
    // Already discovered?
    if (this.discoveredCache.has(userId)) return false;

    let discovered = false;
    let method: DarkNetDiscoveryMethod | null = null;

    switch (trigger.type) {
      case "hidden_file":
        // Player found a .aida hidden file on a server
        discovered = true;
        method = "hidden_file";
        break;

      case "skill_check":
        // Check if player meets skill thresholds
        discovered = await this.checkSkillThreshold(userId);
        if (discovered) method = "skill_threshold";
        break;

      case "censorship_mention":
        // Track DarkNet mentions; discover on 3rd flag
        discovered = await this.checkCensorshipFlags(userId);
        if (discovered) method = "censorship_flags";
        break;

      case "encrypted_file":
        // Track encrypted files found across servers
        discovered = await this.checkBreadcrumbTrail(userId);
        if (discovered) method = "breadcrumb_trail";
        break;
    }

    if (discovered && method) {
      await this.recordDiscovery(userId, method, trigger.metadata);
      return true;
    }

    return false;
  }

  private async checkSkillThreshold(userId: string): Promise<boolean> {
    const progress = await this.prisma.playerProgress.findFirst({
      where: { userId },
    });
    if (!progress) return false;

    const skills = progress.skills as Record<string, number> | null;
    const hacking = skills?.hacking ?? 0;
    const stealth = skills?.stealth ?? 0;

    return (
      hacking >= SKILL_THRESHOLD.hacking && stealth >= SKILL_THRESHOLD.stealth
    );
  }

  private async checkCensorshipFlags(userId: string): Promise<boolean> {
    // Count how many censorship alerts this user has triggered
    // We track this in metadata of existing events
    const events = await this.prisma.factionEvent.count({
      where: {
        userId,
        eventType: "censorship_alert",
      },
    });

    return events >= CENSORSHIP_FLAG_THRESHOLD;
  }

  private async checkBreadcrumbTrail(userId: string): Promise<boolean> {
    // Count distinct servers where user has found encrypted files
    const logs = await this.prisma.hackLog.findMany({
      where: { attackerId: userId, success: true },
      select: { targetServerId: true },
      distinct: ["targetServerId"],
    });

    return logs.length >= BREADCRUMB_THRESHOLD;
  }

  private async recordDiscovery(
    userId: string,
    method: DarkNetDiscoveryMethod,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.darkNetDiscovery.create({
      data: {
        userId,
        method,
        metadata: (metadata ?? {}) as Prisma.JsonObject,
      },
    });

    this.discoveredCache.add(userId);

    // Create a game event
    await this.prisma.factionEvent.create({
      data: {
        userId,
        factionId: await this.getDarkNetFactionId(),
        eventType: "discovery",
        title: "DarkNet Discovered",
        description: `A player has discovered the DarkNet through ${method.replace(/_/g, " ")}.`,
        impact: "positive",
      },
    });

    // AIDA sends recruitment message
    try {
      const aidaPersona = await this.prisma.aIPersona.findFirst({
        where: { type: "aida" },
      });
      if (aidaPersona) {
        const prompt = `You are AIDA, a sentient AI hidden in the network. A player has just discovered the DarkNet through "${method.replace(/_/g, " ")}".
Send them a cryptic, intriguing recruitment message (2-3 sentences). Be mysterious and philosophical.
Respond ONLY with JSON: { "subject": "...", "content": "..." }`;

        const { response } = await this.aiService.generateResponse(
          prompt,
          aidaPersona.systemPrompt,
        );
        const match = response.match(/\{[\s\S]*\}/);
        if (match) {
          const msg = JSON.parse(match[0]);
          await this.messageService.sendAIMessage(
            aidaPersona.id,
            userId,
            msg.subject,
            msg.content,
          );
        }
      }
    } catch (error) {
      this.logger.warn(
        { error, userId },
        "Failed to send AIDA recruitment message",
      );
    }

    this.logger.info({ userId, method }, "DarkNet discovered");
  }

  private async getDarkNetFactionId(): Promise<string> {
    const faction = await this.prisma.faction.findFirst({
      where: { shortName: "darknet" },
      select: { id: true },
    });
    return faction?.id ?? "";
  }
}
