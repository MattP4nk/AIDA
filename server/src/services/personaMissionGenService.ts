import { injectable, inject } from "tsyringe";
import { PrismaClient } from "@prisma/client";
import { Logger } from "pino";
import MissionService from "./missionService";
import { AIService } from "./aiService";
import { LOGGER, FACTION_KNOWLEDGE_SERVICE } from "../di/tokens";
import type { FactionKnowledgeService, KnowledgeSnapshot } from "./factionKnowledgeService";
import {
  getEligibleTemplates,
  selectWeightedTemplate,
  type MissionTemplate,
  type RewardScaling,
} from "./missionTemplatePool";
import { OBJECTIVE_TYPES } from "./missionObjectiveTypes";
import { validateMissionOutput } from "../utils/aiOutputValidator";
import { safeAI } from "../utils/safeExecute";

// ── Faction Leader Profiles ────────────────────────────────────────────────

export interface FactionMissionProfile {
  voice: string;
  themes: string[];
  preferredObjectives: string[];
  rewardBias: "xp" | "credits" | "reputation";
}

export const FACTION_PROFILES: Record<string, FactionMissionProfile> = {
  garrison: {
    voice: "Military precision, formal, duty-bound",
    themes: ["Defense", "Patrol", "Secure", "Protect", "Investigate"],
    preferredObjectives: ["hack_stealth", "explore", "scan_network", "connect_server", "delete_file", "faction_reputation"],
    rewardBias: "xp",
  },
  dothackers: {
    voice: "Anarchist, irreverent, freedom-fighter, leet-speak touches",
    themes: ["Expose", "Leak", "Liberate", "Disrupt", "Deface"],
    preferredObjectives: ["hack", "hack_target", "steal", "steal_count", "forum_post", "upload_file"],
    rewardBias: "reputation",
  },
  cybercorp: {
    voice: "Corporate, calculated, profit-motivated, euphemistic",
    themes: ["Acquisition", "Competitive Intelligence", "Asset Recovery", "Market Research", "Hostile Takeover"],
    preferredObjectives: ["install_backdoor", "steal", "hack_stealth", "earn_credits", "contact_player"],
    rewardBias: "credits",
  },
  darknet: {
    voice: "Cryptic, fragmented, oracle-like, glitched formatting",
    themes: ["Signal", "Fragment", "Decode", "Trace", "Awaken", "Remember"],
    preferredObjectives: ["hack_target", "steal", "explore", "gain_access", "skill_level", "forum_interaction"],
    rewardBias: "xp",
  },
};

@injectable()
export class PersonaMissionGenService {
  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject("MissionService") private missionService: MissionService,
    @inject("AIService") private aiService: AIService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    this.factionKnowledge = factionKnowledgeService || null;
  }

  /**
   * Generate a context-aware dynamic mission for a faction.
   * Pipeline: template selection -> fill with real IDs from knowledge -> AI flavor -> fallback
   */
  async generateDynamicMission(factionId: string, context: { lowResources?: boolean; underAttack?: boolean; rebalance?: boolean }): Promise<void> {
    try {
      // Step 1: Find faction leader persona
      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
        include: { faction: true },
      });
      if (!leader || !leader.faction) return;

      const factionShortName = leader.faction.shortName || factionId;
      const profile = FACTION_PROFILES[factionShortName];

      // Step 2: Load faction knowledge snapshot
      const snapshot = this.factionKnowledge
        ? await this.factionKnowledge.getSnapshot(factionId)
        : { factionId, servers: [], files: [], players: [], generatedAt: new Date() };

      // Step 3: Determine player level estimate from faction context (use average member level or default)
      const avgLevel = await this.estimateFactionPlayerLevel(factionId);

      // Step 4: Select template from faction-appropriate pool
      const eligible = getEligibleTemplates(avgLevel, factionShortName);
      if (eligible.length === 0) {
        this.logger.warn({ factionId, avgLevel }, "No eligible templates for faction dynamic mission");
        return;
      }
      const template = selectWeightedTemplate(eligible, avgLevel);
      if (!template) return;

      // Step 5: Fill objective metadata with real IDs from knowledge
      const objectives = this.fillObjectivesFromKnowledge(template, snapshot, factionId);

      // If we couldn't fill any objectives that need targets, fall back to exploration
      if (objectives.length === 0) {
        this.logger.info({ factionId }, "No known targets for template objectives, generating exploration mission");
        objectives.push({
          id: `obj_${Date.now()}`,
          type: "explore",
          description: "Scout the network — discover new servers for the faction",
          target: 3,
          current: 0,
          completed: false,
        });
      }

      // Step 6: Compute rewards from template scaling
      const rewards = this.computeRewards(template.rewards, avgLevel, profile?.rewardBias);
      const difficulty = Math.floor(
        template.difficulty.min + Math.random() * (template.difficulty.max - template.difficulty.min),
      );

      // Step 7: Build situation context for AI prompt
      const situation = context.lowResources
        ? "Your faction's resources are critically low."
        : context.underAttack
          ? "A rival faction is contesting your territory."
          : "Strategic opportunity detected.";

      const objectivesSummary = objectives.map((o) => `- ${o.description}`).join("\n");

      // Step 8: Ask AI for flavor text only (title + description)
      let title = template.titleTemplates[Math.floor(Math.random() * template.titleTemplates.length)]!;
      let description = template.descriptionTemplates[Math.floor(Math.random() * template.descriptionTemplates.length)]!;

      try {
        const knownTargetsBlock = this.factionKnowledge
          ? this.factionKnowledge.serializeForPrompt(snapshot)
          : "No known targets.";

        // Include recent mission feedback so AI can adjust difficulty/tone
        let feedbackBlock = "";
        try {
          const feedbackKnowledge = await this.prisma.aIKnowledge.findMany({
            where: { personaId: leader.id, type: "mission_feedback" },
            orderBy: { id: "desc" },
            take: 5,
            select: { content: true },
          });
          if (feedbackKnowledge.length > 0) {
            feedbackBlock = `\nRECENT MISSION FEEDBACK (adjust difficulty and style based on this):\n${feedbackKnowledge.map(k => `- ${k.content}`).join("\n")}\n`;
          }
        } catch { /* non-critical */ }

        const flavorPrompt = `You are ${leader.name}, faction leader of ${leader.faction.name}.
Voice: ${profile?.voice || "authoritative"}.
Situation: ${situation}

A new mission has been structured for your operatives:
Mission type: ${template.type}
Objectives:
${objectivesSummary}
Difficulty: ${difficulty}/10

${knownTargetsBlock}
${feedbackBlock}
Write a mission title and briefing description IN CHARACTER. Keep the title under 60 chars.
The description should be 1-3 sentences that motivate the operative.
Respond ONLY with JSON:
{
  "title": "...",
  "description": "..."
}`;

        const { enrichWithTopology } = await import("./worldTopologyContext");
        const enrichedSystemPrompt = await enrichWithTopology(leader.systemPrompt, this.prisma, this.logger);

        const validated = await safeAI({
          aiService: this.aiService,
          prompt: flavorPrompt,
          systemPrompt: enrichedSystemPrompt,
          expectedFormat: '{ "title": "string (3-80 chars)", "description": "string (10-500 chars)" }',
          validate: validateMissionOutput,
          fallback: { title, description },
          context: "Mission flavor text for dynamic faction mission",
          logger: this.logger,
        });
        title = validated.title;
        description = validated.description;
      } catch (aiError) {
        this.logger.warn({ err: aiError, factionId }, "AI flavor generation failed, using template defaults");
      }

      // Step 9: Create the mission
      await this.missionService.createMission({
        title,
        description,
        type: template.type,
        difficulty,
        reward: rewards,
        factionId,
        issuedBy: leader.id,
        objectives: objectives as any,
        createdBy: leader.id,
        timeLimit: Math.floor(
          template.timeLimit.min + Math.random() * (template.timeLimit.max - template.timeLimit.min),
        ),
      });

      this.logger.info(
        { factionId, personaId: leader.id, templateId: template.id, objectiveCount: objectives.length, context },
        "Dynamic faction mission generated (knowledge-aware pipeline)",
      );
    } catch (error) {
      this.logger.error(error, "Error in generateDynamicMission");
    }
  }

  // ── Mission Generation Helpers ─────────────────────────────────────────

  /**
   * Estimate the average player level for a faction's members.
   */
  async estimateFactionPlayerLevel(factionId: string): Promise<number> {
    try {
      const members = await this.prisma.factionMember.findMany({
        where: { factionId },
        include: { user: { include: { progress: true } } },
        take: 20,
      });
      if (members.length === 0) return 10; // default
      const levels = members
        .map((m) => {
          const xp = (m.user.progress as any)?.totalXP || 0;
          return Math.floor(Math.sqrt(xp / 100)) + 1;
        });
      return Math.round(levels.reduce((a, b) => a + b, 0) / levels.length);
    } catch {
      return 10;
    }
  }

  /**
   * Fill template objectives with real IDs from faction knowledge.
   * Returns concrete mission objectives ready for createMission().
   */
  fillObjectivesFromKnowledge(
    template: MissionTemplate,
    snapshot: KnowledgeSnapshot,
    factionId: string,
  ): Array<{ id: string; type: string; description: string; target: number | boolean; current: number; completed: boolean; metadata?: Record<string, unknown> }> {
    const result: Array<{ id: string; type: string; description: string; target: number | boolean; current: number; completed: boolean; metadata?: Record<string, unknown> }> = [];

    for (let i = 0; i < template.objectives.length; i++) {
      const objTemplate = template.objectives[i]!;
      const typeDef = OBJECTIVE_TYPES.get(objTemplate.type);
      const requiresServerId = typeDef?.requiredMetadata?.includes("serverId");
      const requiresFileId = typeDef?.requiredMetadata?.includes("fileId");
      const requiresFactionId = typeDef?.requiredMetadata?.includes("factionId");
      const requiresNetworkId = typeDef?.requiredMetadata?.includes("networkId");

      let description = objTemplate.descriptionTemplate;
      const metadata: Record<string, unknown> = { ...objTemplate.metadata };

      // Fill network targets from knowledge (for infiltrate_network)
      if (requiresNetworkId && !metadata.networkId) {
        // Pick a server that belongs to a network (has networkName in meta)
        const networkServer = snapshot.servers.find((s) => s.assetMeta.networkName);
        if (networkServer) {
          metadata.networkId = networkServer.assetMeta.networkId || null;
          metadata.serverId = networkServer.assetId;
          metadata.serverName = networkServer.assetMeta.name || "target network";
          description = description.replace("{network}", String(networkServer.assetMeta.networkName || "target network"));
        } else if (requiresNetworkId) {
          continue; // No known networks
        }
      }

      // Fill server targets from knowledge
      if (requiresServerId && !metadata.serverId) {
        const knownServer = snapshot.servers[Math.floor(Math.random() * snapshot.servers.length)];
        if (knownServer) {
          metadata.serverId = knownServer.assetId;
          metadata.serverName = knownServer.assetMeta.name || "target server";
          metadata.serverIp = knownServer.assetMeta.ip || "";
          description = description.replace("{server}", String(knownServer.assetMeta.name || "target server"));
        } else if (requiresServerId) {
          // No known servers — skip this objective
          continue;
        }
      }

      // Fill file targets from knowledge
      if (requiresFileId && !metadata.fileId) {
        // Try to find a file on the same server if serverId is set
        const serverId = metadata.serverId as string | undefined;
        const candidateFiles = serverId
          ? snapshot.files.filter((f) => (f.assetMeta as any)?.serverId === serverId)
          : snapshot.files;
        const knownFile = candidateFiles[Math.floor(Math.random() * candidateFiles.length)];
        if (knownFile) {
          metadata.fileId = knownFile.assetId;
          metadata.fileName = knownFile.assetMeta.name || "target file";
          description = description.replace("{file}", String(knownFile.assetMeta.name || "target file"));
        } else if (requiresFileId) {
          continue;
        }
      }

      // Fill faction targets
      if (requiresFactionId && !metadata.factionId) {
        metadata.factionId = factionId;
      }

      // Clean up remaining placeholders
      description = description.replace(/\{[^}]+\}/g, "target");

      result.push({
        id: `obj_${Date.now()}_${i}`,
        type: objTemplate.type,
        description,
        target: objTemplate.target,
        current: 0,
        completed: false,
        metadata,
      });
    }

    return result;
  }

  /**
   * Compute rewards from template RewardScaling + player level.
   */
  computeRewards(
    scaling: RewardScaling,
    playerLevel: number,
    bias?: "xp" | "credits" | "reputation",
  ): { xp: number; credits: number; reputation?: number; skillPoints?: number } {
    let xp = scaling.xp.base + scaling.xp.perLevel * playerLevel;
    let credits = scaling.credits.base + scaling.credits.perLevel * playerLevel;
    const reputation = scaling.reputation || 0;
    const skillPoints = scaling.skillPoints || 0;

    // Apply faction reward bias
    if (bias === "xp") xp = Math.round(xp * 1.3);
    else if (bias === "credits") credits = Math.round(credits * 1.3);

    return {
      xp: Math.round(xp),
      credits: Math.round(credits),
      ...(reputation > 0 ? { reputation } : {}),
      ...(skillPoints > 0 ? { skillPoints } : {}),
    };
  }
}
