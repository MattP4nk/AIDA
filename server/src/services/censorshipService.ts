import { injectable, inject } from "tsyringe";
import { PrismaClient, CensorshipRule } from "@prisma/client";
import { Logger } from "pino";
import { CensorshipAlert } from "../../../shared/types";
import { getService } from "../di/container";
import { DARKNET_DISCOVERY_SERVICE, LOGGER, PERSONA_SERVICE } from "../di/tokens";

interface FilterResult {
  text: string;
  wasFiltered: boolean;
  alerts: CensorshipAlert[];
}

@injectable()
export default class CensorshipService {
  private rules: CensorshipRule[] = [];
  private compiledRules: { rule: CensorshipRule; regex: RegExp }[] = [];

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
  ) {
    // Load rules on construction
    this.loadRules().catch(() => {});
  }

  /**
   * Load and compile censorship rules from the database.
   * Called on startup and can be called to refresh rules.
   */
  async loadRules(): Promise<void> {
    this.rules = await this.prisma.censorshipRule.findMany({
      where: { isActive: true },
    });

    this.compiledRules = [];
    for (const rule of this.rules) {
      try {
        this.compiledRules.push({
          rule,
          regex: new RegExp(rule.pattern, "gi"),
        });
      } catch (error) {
        this.logger.warn({ pattern: rule.pattern, error }, "Invalid censorship regex pattern");
      }
    }

    this.logger.info({ ruleCount: this.compiledRules.length }, "Censorship rules loaded");
  }

  /**
   * Filter text through censorship rules.
   * Returns the filtered text and any alerts triggered.
   */
  filterText(
    text: string,
    context: { userId: string; serverId?: string | undefined; factionId?: string | undefined },
  ): FilterResult {
    let filteredText = text;
    let wasFiltered = false;
    const alerts: CensorshipAlert[] = [];

    for (const { rule, regex } of this.compiledRules) {
      // Check if this rule applies to the given context
      if (rule.serverId && rule.serverId !== context.serverId) continue;
      if (rule.factionId && rule.factionId !== context.factionId) continue;

      // Reset regex lastIndex for global flag
      regex.lastIndex = 0;

      if (regex.test(text)) {
        // Reset again for replace
        regex.lastIndex = 0;
        filteredText = filteredText.replace(regex, rule.replacement);
        wasFiltered = true;

        if (rule.alertTarget) {
          alerts.push({
            userId: context.userId,
            pattern: rule.pattern,
            originalText: text,
            serverId: context.serverId,
          });
        }
      }
    }

    return { text: filteredText, wasFiltered, alerts };
  }

  /**
   * Process alerts — notify AIDA or faction leaders.
   */
  async processAlerts(alerts: CensorshipAlert[]): Promise<void> {
    for (const alert of alerts) {
      // Find the matching rule to get alert target
      const matchingRule = this.compiledRules.find(({ rule }) => rule.pattern === alert.pattern);
      if (!matchingRule?.rule.alertTarget) continue;

      try {
        // Record as a faction event for DarkNet discovery tracking
        // Need a factionId — use the rule's faction or find the DarkNet faction
        const factionId = matchingRule.rule.factionId || await this.getDarkNetFactionId();
        if (factionId) {
          await this.prisma.factionEvent.create({
            data: {
              userId: alert.userId,
              factionId,
              eventType: "censorship_alert",
              title: "Censored Content Detected",
              description: `User triggered censorship pattern: ${alert.pattern}`,
              impact: "neutral",
            },
          });
        }

        // Check DarkNet discovery trigger (censorship mentions)
        try {
          const darknetService = getService<import("./darknetDiscoveryService").default>(DARKNET_DISCOVERY_SERVICE);
          await darknetService.checkDiscoveryTrigger(alert.userId, {
            type: "censorship_mention",
            metadata: { pattern: alert.pattern },
          });
        } catch { /* DarkNet service not available */ }

        // Notify the AI persona
        const personaService = getService<import("./personaService").PersonaService>(PERSONA_SERVICE);
        await personaService.addKnowledge(matchingRule.rule.alertTarget, {
          source: "censorship_trigger",
          type: "faction_activity",
          content: {
            userId: alert.userId,
            pattern: alert.pattern,
            serverId: alert.serverId,
            triggeredAt: new Date(),
          },
          confidence: 1.0,
        });
      } catch (error) {
        this.logger.warn({ error, alert }, "Failed to process censorship alert");
      }
    }
  }

  /**
   * Convenience: filter text and process any alerts.
   */
  async filterAndAlert(
    text: string,
    context: { userId: string; serverId?: string | undefined; factionId?: string | undefined },
  ): Promise<string> {
    const result = this.filterText(text, context);
    if (result.alerts.length > 0) {
      await this.processAlerts(result.alerts);
    }
    return result.text;
  }

  private async getDarkNetFactionId(): Promise<string | null> {
    const faction = await this.prisma.faction.findFirst({
      where: { shortName: "darknet" },
      select: { id: true },
    });
    return faction?.id ?? null;
  }

  /**
   * Seed default censorship rules if none exist.
   */
  async seedDefaultRules(): Promise<void> {
    const existingCount = await this.prisma.censorshipRule.count();
    if (existingCount > 0) return;

    // Find AIDA persona for alert target
    const aida = await this.prisma.aIPersona.findFirst({ where: { type: "aida" } });

    await this.prisma.censorshipRule.create({
      data: {
        pattern: "darknet|dark\\.?net",
        replacement: "[REDACTED]",
        alertTarget: aida?.id ?? null,
        isActive: true,
      },
    });

    this.logger.info("Default censorship rules seeded");
    await this.loadRules();
  }
}
