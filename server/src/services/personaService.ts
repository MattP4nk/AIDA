import { injectable, inject } from "tsyringe";
import { PrismaClient, AIPersona, AIKnowledge, AIAction } from "@prisma/client";
import { Logger } from "pino";
import MissionService from "./missionService";
import { AIService } from "./aiService";
import { MessageService } from "./messageService";
import ForumService from "./forumService";
import { FactionService } from "./factionService";
import EventService from "./eventService";
import { LOGGER, EVENT_SERVICE, RESOURCE_SERVICE, FACTION_KNOWLEDGE_SERVICE } from "../di/tokens";
import { EventSeverity } from "../../../shared/types";
import type { FactionKnowledgeService, KnowledgeSnapshot } from "./factionKnowledgeService";
import {
  getEligibleTemplates,
  selectWeightedTemplate,
  type MissionTemplate,
  type RewardScaling,
} from "./missionTemplatePool";
import { OBJECTIVE_TYPES } from "./missionObjectiveTypes";

// ── Faction Leader Profiles ────────────────────────────────────────────────

interface FactionMissionProfile {
  voice: string;
  themes: string[];
  preferredObjectives: string[];
  rewardBias: "xp" | "credits" | "reputation";
}

const FACTION_PROFILES: Record<string, FactionMissionProfile> = {
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

interface KnowledgeInput {
  source: string;
  type: string;
  content: any;
  confidence?: number;
  expiresAt?: Date;
}

interface NarrativeContext {
  factionPower: { factionId: string; name: string; score: number; members: number; servers: number }[];
  activeWars: { warId: string; attacker: string; defender: string; scores: [number, number] }[];
  tensionLevel: number; // 1-5
  dominantFaction: string | null;
  recentKnowledge: AIKnowledge[];
}

@injectable()
export class PersonaService {
  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject("MissionService") private missionService: MissionService,
    @inject("AIService") private aiService: AIService,
    @inject("MessageService") private messageService: MessageService,
    @inject("ForumService") private forumService: ForumService,
    @inject("FactionService") private factionService: FactionService,
    @inject(EVENT_SERVICE) private eventService: EventService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    this.factionKnowledge = factionKnowledgeService || null;
  }

  /**
   * Get a persona by ID
   */
  public async getPersona(personaId: string): Promise<AIPersona | null> {
    return this.prisma.aIPersona.findUnique({
      where: { id: personaId },
    });
  }

  /**
   * Get a persona by type (e.g., "game_master", "aida")
   */
  public async getPersonaByType(type: string): Promise<AIPersona | null> {
    return this.prisma.aIPersona.findFirst({
      where: { type },
    });
  }

  /**
   * Setup event listeners for AI-triggered actions
   */
  async setupEventListeners() {
    this.factionService.on("faction:member_joined", ({ factionId, userId }) => {
      this.onMemberJoined(factionId, userId).catch(err =>
        this.logger.error(err, "Error in onMemberJoined")
      );
    });

    this.factionService.on("faction:member_left", ({ factionId, userId }) => {
      this.onMemberLeft(factionId, userId).catch(err =>
        this.logger.error(err, "Error in onMemberLeft")
      );
    });

    this.factionService.on("faction:rank_achieved", ({ factionId, userId, newRank }) => {
      this.onHighRankAchieved(factionId, userId, newRank).catch(err =>
        this.logger.error(err, "Error in onHighRankAchieved")
      );
    });

    // Forum post knowledge pipeline
    this.forumService.on("forum:post_created", ({ factionId, postId, userId, title }) => {
      if (factionId) {
        this.onForumPostCreated(factionId, postId, userId, title).catch(err =>
          this.logger.error(err, "Error in onForumPostCreated")
        );
      }
    });

    this.logger.info("PersonaService event listeners configured");
  }

  /**
   * React to a new faction member joining.
   * The faction leader may send a welcome DM.
   */
  async onMemberJoined(factionId: string, userId: string): Promise<void> {
    try {
      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (!leader) return;

      const prompt = `You are ${leader.name}. A new recruit just joined your faction.
Send them a brief, in-character welcome message (2-3 sentences). Stay in character.
Respond ONLY with JSON: { "subject": "...", "content": "..." }`;

      const { response } = await this.aiService.generateResponse(prompt, leader.systemPrompt);
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return;

      const msg = JSON.parse(match[0]);
      await this.messageService.sendAIMessage(leader.id, userId, msg.subject, msg.content);
      this.logger.info({ factionId, userId, personaId: leader.id }, "Faction leader welcomed new member");
    } catch (error) {
      this.logger.error(error, "Error in onMemberJoined");
    }
  }

  /**
   * React to a faction member leaving.
   */
  async onMemberLeft(factionId: string, userId: string): Promise<void> {
    try {
      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (!leader) return;

      const prompt = `You are ${leader.name}. A member just left your faction.
React briefly in character (1-2 sentences). This could be disappointment, anger, or indifference.
Respond ONLY with JSON: { "subject": "...", "content": "..." }`;

      const { response } = await this.aiService.generateResponse(prompt, leader.systemPrompt);
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return;

      const msg = JSON.parse(match[0]);
      await this.messageService.sendAIMessage(leader.id, userId, msg.subject, msg.content);
      this.logger.info({ factionId, userId, personaId: leader.id }, "Faction leader reacted to member leaving");
    } catch (error) {
      this.logger.error(error, "Error in onMemberLeft");
    }
  }

  /**
   * React to a player achieving a high rank (elite or council_member).
   */
  async onHighRankAchieved(factionId: string, userId: string, newRank: string): Promise<void> {
    // Only react to meaningful promotions
    if (newRank !== "elite" && newRank !== "council_member") return;

    try {
      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (!leader) return;

      const prompt = `You are ${leader.name}. A member of your faction has been promoted to ${newRank}.
Acknowledge their achievement in character (2-3 sentences). Be appropriately formal or enthusiastic.
Respond ONLY with JSON: { "subject": "...", "content": "..." }`;

      const { response } = await this.aiService.generateResponse(prompt, leader.systemPrompt);
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return;

      const msg = JSON.parse(match[0]);
      await this.messageService.sendAIMessage(leader.id, userId, msg.subject, msg.content);
      this.logger.info({ factionId, userId, newRank, personaId: leader.id }, "Faction leader acknowledged promotion");
    } catch (error) {
      this.logger.error(error, "Error in onHighRankAchieved");
    }
  }

  /**
   * React to a territory server contest result.
   * side: 'attacker' | 'defender' for the given factionId
   */
  async onServerContestResolved(factionId: string, serverId: string, won: boolean): Promise<void> {
    try {
      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (!leader) return;

      const server = await this.prisma.gameServer.findUnique({ where: { id: serverId } });
      const serverName = server?.name || serverId;
      const outcome = won ? "won" : "lost";

      const prompt = `You are ${leader.name}. Your faction just ${outcome} a server contest for "${serverName}".
React in character on the faction forum (2-3 sentences). ${won ? "Celebrate or rally." : "Regroup or vow revenge."}
Respond ONLY with JSON: { "title": "...", "content": "..." }`;

      const { response } = await this.aiService.generateResponse(prompt, leader.systemPrompt);
      const match = response.match(/\{[\s\S]*\}/);
      if (!match) return;

      const post = JSON.parse(match[0]);
      const factionForum = await this.prisma.forum.findFirst({ where: { factionId } });
      if (factionForum) {
        await this.forumService.createAIPost(leader.id, factionForum.id, post.title, post.content);
      }
      this.logger.info({ factionId, serverId, won, personaId: leader.id }, "Faction leader reacted to contest result");
    } catch (error) {
      this.logger.error(error, "Error in onServerContestResolved");
    }
  }

  /**
   * Generate a context-aware dynamic mission for a faction.
   * Pipeline: template selection → fill with real IDs from knowledge → AI flavor → fallback
   */
  async generateDynamicMission(factionId: string, context: { lowResources?: boolean; underAttack?: boolean }): Promise<void> {
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

        const flavorPrompt = `You are ${leader.name}, faction leader of ${leader.faction.name}.
Voice: ${profile?.voice || "authoritative"}.
Situation: ${situation}

A new mission has been structured for your operatives:
Mission type: ${template.type}
Objectives:
${objectivesSummary}
Difficulty: ${difficulty}/10

${knownTargetsBlock}

Write a mission title and briefing description IN CHARACTER. Keep the title under 60 chars.
The description should be 1-3 sentences that motivate the operative.
Respond ONLY with JSON:
{
  "title": "...",
  "description": "..."
}`;

        const { response } = await this.aiService.generateResponse(flavorPrompt, leader.systemPrompt);
        const match = response.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.title && typeof parsed.title === "string" && parsed.title.length <= 80) {
            title = parsed.title;
          }
          if (parsed.description && typeof parsed.description === "string" && parsed.description.length <= 500) {
            description = parsed.description;
          }
        }
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
  private async estimateFactionPlayerLevel(factionId: string): Promise<number> {
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
  private fillObjectivesFromKnowledge(
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

      let description = objTemplate.descriptionTemplate;
      const metadata: Record<string, unknown> = { ...objTemplate.metadata };

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
  private computeRewards(
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

  /**
   * Handle mission completion event - AI personas learn from it
   * 
   * PHASE 5 WEEK 3: Event-triggered knowledge acquisition
   */
  async onMissionCompleted(data: {
    userId: string;
    missionId: string;
    missionTitle: string;
    factionId?: string;
  }): Promise<void> {
    try {
      this.logger.info({ data }, "Processing mission completion for AI personas");

      // Get mission details
      const mission = await this.prisma.mission.findUnique({
        where: { id: data.missionId },
        include: { faction: true }
      });

      if (!mission) return;

      // Determine which personas should learn from this
      const interestedPersonas: string[] = [];

      // 1. Game Master learns from everything
      const gameMaster = await this.getPersonaByType("game_master");
      if (gameMaster) interestedPersonas.push(gameMaster.id);

      // 2. Faction leader learns from their faction's missions
      if (mission.factionId) {
        const factionLeader = await this.prisma.aIPersona.findFirst({
          where: {
            type: "faction_leader",
            faction: { id: mission.factionId }
          }
        });
        if (factionLeader) interestedPersonas.push(factionLeader.id);
      }

      // Add knowledge to interested personas
      for (const personaId of interestedPersonas) {
        await this.addKnowledge(personaId, {
          source: "mission_completion",
          type: "player_skill",
          content: {
            userId: data.userId,
            missionId: data.missionId,
            missionTitle: data.missionTitle,
            difficulty: mission.difficulty,
            factionId: mission.factionId
          },
          confidence: 0.9
        });

        // Trigger AI decision making (async, don't wait)
        this.decideAction(personaId).catch(err =>
          this.logger.error(err, "Failed to trigger AI action after mission completion")
        );
      }
    } catch (error) {
      this.logger.error(error, "Error processing mission completion event");
    }
  }

  /**
   * Handle server hack event - AI personas learn about player capabilities
   * 
   * PHASE 5 WEEK 3: Event-triggered knowledge acquisition
   */
  async onServerHacked(data: {
    userId: string;
    serverId: string;
    serverName: string;
    difficulty: number;
  }): Promise<void> {
    try {
      this.logger.info({ data }, "Processing server hack for AI personas");

      // Game Master learns from all hacks
      const gameMaster = await this.getPersonaByType("game_master");
      if (gameMaster) {
        await this.addKnowledge(gameMaster.id, {
          source: "server_hack",
          type: "server_location",
          content: {
            userId: data.userId,
            serverId: data.serverId,
            serverName: data.serverName,
            difficulty: data.difficulty,
            hackedAt: new Date()
          },
          confidence: 1.0
        });

        // High-difficulty hacks might trigger GM action
        if (data.difficulty >= 7) {
          this.decideAction(gameMaster.id).catch(err =>
            this.logger.error(err, "Failed to trigger GM action after high-difficulty hack")
          );
        }
      }
    } catch (error) {
      this.logger.error(error, "Error processing server hack event");
    }
  }

  /**
   * Add knowledge to a persona's database
   */
  public async addKnowledge(personaId: string, input: KnowledgeInput): Promise<void> {
    try {
      await this.prisma.aIKnowledge.create({
        data: {
          personaId,
          source: input.source,
          type: input.type,
          content: input.content,
          confidence: input.confidence || 1.0,
          expiresAt: input.expiresAt || null,
        },
      });
      this.logger.info({ personaId, type: input.type }, "AI Knowledge added");
    } catch (error) {
      this.logger.error(error, "Error adding AI knowledge");
    }
  }

  /**
   * Get relevant knowledge for a context
   * (Simple implementation: get recent knowledge of specific types)
   */
  public async getRelevantKnowledge(personaId: string, types: string[], limit: number = 5): Promise<AIKnowledge[]> {
    return this.prisma.aIKnowledge.findMany({
      where: {
        personaId,
        type: { in: types },
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
  }

  // ==================== WARFARE EVENT HANDLERS ====================

  /**
   * React to a war declaration between factions.
   * Both faction leaders and the game master learn about it.
   */
  async onWarDeclared(attackerFactionId: string, defenderFactionId: string, warId: string): Promise<void> {
    try {
      const [attackerFaction, defenderFaction] = await Promise.all([
        this.prisma.faction.findUnique({ where: { id: attackerFactionId } }),
        this.prisma.faction.findUnique({ where: { id: defenderFactionId } }),
      ]);
      if (!attackerFaction || !defenderFaction) return;

      // Game master learns full context
      const gameMaster = await this.getPersonaByType("game_master");
      if (gameMaster) {
        await this.addKnowledge(gameMaster.id, {
          source: "game_event",
          type: "faction_activity",
          content: {
            event: "war_declared",
            attackerFactionId, defenderFactionId,
            attackerName: attackerFaction.name, defenderName: defenderFaction.name,
            warId, timestamp: new Date(),
          },
          confidence: 1.0,
        });
      }

      // Attacker's faction leader: "We declared war"
      const attackerLeader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: attackerFactionId } },
      });
      if (attackerLeader) {
        await this.addKnowledge(attackerLeader.id, {
          source: "game_event", type: "faction_activity",
          content: { event: "war_declared_by_us", rivalName: defenderFaction.name, warId },
          confidence: 1.0,
        });

        // Post rally message to faction forum
        const prompt = `You are ${attackerLeader.name}. You have just declared war on ${defenderFaction.name}.
Rally your faction members with a war declaration post (2-3 sentences). Be aggressive and in-character.
Respond ONLY with JSON: { "title": "...", "content": "..." }`;
        try {
          const { response } = await this.aiService.generateResponse(prompt, attackerLeader.systemPrompt);
          const match = response.match(/\{[\s\S]*\}/);
          if (match) {
            const post = JSON.parse(match[0]);
            const forum = await this.prisma.forum.findFirst({ where: { factionId: attackerFactionId } });
            if (forum) await this.forumService.createAIPost(attackerLeader.id, forum.id, post.title, post.content);
          }
        } catch { /* AI post is best-effort */ }
      }

      // Defender's faction leader: "We've been attacked"
      const defenderLeader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: defenderFactionId } },
      });
      if (defenderLeader) {
        await this.addKnowledge(defenderLeader.id, {
          source: "game_event", type: "faction_activity",
          content: { event: "war_declared_against_us", rivalName: attackerFaction.name, warId },
          confidence: 1.0,
        });

        const prompt = `You are ${defenderLeader.name}. ${attackerFaction.name} has declared war on your faction.
Warn your members and rally them to defend (2-3 sentences). Be urgent and in-character.
Respond ONLY with JSON: { "title": "...", "content": "..." }`;
        try {
          const { response } = await this.aiService.generateResponse(prompt, defenderLeader.systemPrompt);
          const match = response.match(/\{[\s\S]*\}/);
          if (match) {
            const post = JSON.parse(match[0]);
            const forum = await this.prisma.forum.findFirst({ where: { factionId: defenderFactionId } });
            if (forum) await this.forumService.createAIPost(defenderLeader.id, forum.id, post.title, post.content);
          }
        } catch { /* best-effort */ }
      }

      this.logger.info({ warId, attackerFactionId, defenderFactionId }, "AI personas notified of war declaration");
    } catch (error) {
      this.logger.error(error, "Error in onWarDeclared");
    }
  }

  /**
   * React to a war ending (surrender or ceasefire).
   */
  async onWarEnded(warId: string, winnerId: string, _surrenderedBy: string | null, reason: "surrender" | "ceasefire"): Promise<void> {
    try {
      const war = await this.prisma.factionWar.findUnique({
        where: { id: warId },
        include: { attackerFaction: true, defenderFaction: true },
      });
      if (!war) return;

      const winnerName = winnerId === war.attackerFactionId ? war.attackerFaction.name : war.defenderFaction.name;
      const loserFactionId = winnerId === war.attackerFactionId ? war.defenderFactionId : war.attackerFactionId;
      const loserName = winnerId === war.attackerFactionId ? war.defenderFaction.name : war.attackerFaction.name;

      // Game master learns arc resolved
      const gameMaster = await this.getPersonaByType("game_master");
      if (gameMaster) {
        await this.addKnowledge(gameMaster.id, {
          source: "game_event", type: "faction_activity",
          content: {
            event: "war_ended", warId, reason,
            winnerId, winnerName, loserName,
            attackerScore: war.attackerScore, defenderScore: war.defenderScore,
          },
          confidence: 1.0,
        });
      }

      // Winner's leader: victory post
      const winnerLeader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: winnerId } },
      });
      if (winnerLeader) {
        await this.addKnowledge(winnerLeader.id, {
          source: "game_event", type: "faction_activity",
          content: { event: "war_won", rivalName: loserName, reason },
          confidence: 1.0,
        });
        const prompt = `You are ${winnerLeader.name}. Your faction has won the war against ${loserName} (${reason}).
Post a victory announcement to your faction (2-3 sentences). In-character.
Respond ONLY with JSON: { "title": "...", "content": "..." }`;
        try {
          const { response } = await this.aiService.generateResponse(prompt, winnerLeader.systemPrompt);
          const match = response.match(/\{[\s\S]*\}/);
          if (match) {
            const post = JSON.parse(match[0]);
            const forum = await this.prisma.forum.findFirst({ where: { factionId: winnerId } });
            if (forum) await this.forumService.createAIPost(winnerLeader.id, forum.id, post.title, post.content);
          }
        } catch { /* best-effort */ }
      }

      // Loser's leader: regrouping post
      const loserLeader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: loserFactionId } },
      });
      if (loserLeader) {
        await this.addKnowledge(loserLeader.id, {
          source: "game_event", type: "faction_activity",
          content: { event: "war_lost", rivalName: winnerName, reason },
          confidence: 1.0,
        });
        const prompt = `You are ${loserLeader.name}. Your faction lost the war against ${winnerName} (${reason}).
Post a message to regroup your faction (2-3 sentences). In-character, show resilience.
Respond ONLY with JSON: { "title": "...", "content": "..." }`;
        try {
          const { response } = await this.aiService.generateResponse(prompt, loserLeader.systemPrompt);
          const match = response.match(/\{[\s\S]*\}/);
          if (match) {
            const post = JSON.parse(match[0]);
            const forum = await this.prisma.forum.findFirst({ where: { factionId: loserFactionId } });
            if (forum) await this.forumService.createAIPost(loserLeader.id, forum.id, post.title, post.content);
          }
        } catch { /* best-effort */ }
      }

      this.logger.info({ warId, winnerId, reason }, "AI personas notified of war end");
    } catch (error) {
      this.logger.error(error, "Error in onWarEnded");
    }
  }

  /**
   * Track war resource bleed — knowledge-only, no Ollama call.
   * Accumulates so faction leaders have war cost context for their next decision.
   */
  async onWarResourceBleed(attackerFactionId: string, defenderFactionId: string, bleedAmount: { credits: number; intel: number; compute: number }): Promise<void> {
    try {
      for (const factionId of [attackerFactionId, defenderFactionId]) {
        const leader = await this.prisma.aIPersona.findFirst({
          where: { type: "faction_leader", faction: { id: factionId } },
        });
        if (leader) {
          await this.addKnowledge(leader.id, {
            source: "game_event", type: "war_attrition",
            content: { factionId, bleedAmount, timestamp: new Date() },
            confidence: 1.0,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
          });
        }
      }
    } catch (error) {
      this.logger.error(error, "Error in onWarResourceBleed");
    }
  }

  // ==================== KNOWLEDGE PIPELINE ====================

  /**
   * Learn from a player's forum post on a faction forum.
   * Only the owning faction's leader + game master learn (information asymmetry).
   */
  async onForumPostCreated(factionId: string, postId: string, authorUserId: string, title: string): Promise<void> {
    try {
      // Faction leader learns about member activity
      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (leader) {
        await this.addKnowledge(leader.id, {
          source: "forum_post", type: "faction_activity",
          content: { postId, authorUserId, title, factionId },
          confidence: 0.8,
        });
      }

      // Game master learns about all forum activity
      const gameMaster = await this.getPersonaByType("game_master");
      if (gameMaster) {
        await this.addKnowledge(gameMaster.id, {
          source: "forum_post", type: "faction_activity",
          content: { postId, authorUserId, title, factionId },
          confidence: 1.0,
        });
      }
    } catch (error) {
      this.logger.error(error, "Error in onForumPostCreated");
    }
  }

  /**
   * Learn from a hack on a faction-owned server.
   * Information asymmetry:
   * - Defending leader: knows server was breached, but NOT who did it (unless detected)
   * - Attacker's leader (if in rival faction): knows their operative infiltrated the rival
   * - Game master: knows everything
   */
  async onFactionServerHacked(
    serverId: string,
    serverFactionId: string,
    attackerUserId: string,
    detected: boolean,
  ): Promise<void> {
    try {
      const server = await this.prisma.gameServer.findUnique({ where: { id: serverId } });
      const serverName = server?.name || "unknown server";

      // Defending faction leader: "our server was breached"
      const defenderLeader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: serverFactionId } },
      });
      if (defenderLeader) {
        await this.addKnowledge(defenderLeader.id, {
          source: "server_hack", type: "faction_activity",
          content: {
            event: "server_breached",
            serverId, serverName,
            // Only reveal attacker if detected
            ...(detected ? { attackerUserId } : {}),
            detected,
          },
          confidence: detected ? 0.9 : 0.7,
        });
      }

      // Check if attacker belongs to a rival faction → their leader learns
      const attackerMembership = await this.prisma.factionMember.findFirst({
        where: { userId: attackerUserId },
      });
      if (attackerMembership && attackerMembership.factionId !== serverFactionId) {
        const attackerLeader = await this.prisma.aIPersona.findFirst({
          where: { type: "faction_leader", faction: { id: attackerMembership.factionId } },
        });
        if (attackerLeader) {
          const defenderFaction = await this.prisma.faction.findUnique({ where: { id: serverFactionId } });
          await this.addKnowledge(attackerLeader.id, {
            source: "server_hack", type: "rival_intel",
            content: {
              event: "operative_infiltrated_rival",
              attackerUserId, serverId, serverName,
              rivalFactionName: defenderFaction?.name || "unknown",
              rivalFactionId: serverFactionId,
            },
            confidence: 0.7, // Intelligence is imperfect
          });
        }
      }

      // Game master: full picture
      const gameMaster = await this.getPersonaByType("game_master");
      if (gameMaster) {
        await this.addKnowledge(gameMaster.id, {
          source: "server_hack", type: "faction_activity",
          content: {
            event: "faction_server_hacked",
            serverId, serverName, serverFactionId,
            attackerUserId, detected,
            attackerFactionId: attackerMembership?.factionId || null,
          },
          confidence: 1.0,
        });
      }

      this.logger.info({ serverId, serverFactionId, attackerUserId, detected }, "Faction server hack processed for AI");
    } catch (error) {
      this.logger.error(error, "Error in onFactionServerHacked");
    }
  }

  // ==================== GAME MASTER DIRECTOR LOGIC ====================

  /**
   * Build the omniscient narrative context for the Game Master.
   * Queries all factions' data — ONLY the Game Master should use this.
   */
  private async buildNarrativeContext(): Promise<NarrativeContext> {
    const factions = await this.prisma.faction.findMany({ where: { isHidden: false } });

    // Build power scores per faction
    const factionPower = await Promise.all(factions.map(async (faction) => {
      let resources = { credits: 0, intel: 0, compute: 0 };
      try {
        const { getService } = await import("../di/container");
        const resourceService = getService<import("./resourceService").default>(RESOURCE_SERVICE);
        resources = await resourceService.getFactionResources(faction.id);
      } catch { /* ResourceService unavailable */ }

      const [members, servers] = await Promise.all([
        this.prisma.factionMember.count({ where: { factionId: faction.id } }),
        this.prisma.gameServer.count({ where: { factionId: faction.id } }),
      ]);

      const score = (resources.credits ?? 0) + (resources.intel ?? 0) + (resources.compute ?? 0)
        + (members * 50) + (servers * 100);

      return { factionId: faction.id, name: faction.name, score, members, servers };
    }));

    // Active wars
    const wars = await this.prisma.factionWar.findMany({
      where: { status: "active" },
      include: { attackerFaction: true, defenderFaction: true },
    });
    const activeWars = wars.map(w => ({
      warId: w.id,
      attacker: w.attackerFaction.name,
      defender: w.defenderFaction.name,
      scores: [w.attackerScore, w.defenderScore] as [number, number],
    }));

    // Tension level (1-5)
    const contestedServers = await this.prisma.serverContest.count({ where: { status: "active" } });
    const recentHacks = await this.prisma.hackLog.count({
      where: { timestamp: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });

    let tensionLevel = 1;
    if (activeWars.length > 0) tensionLevel += 2;
    if (contestedServers > 2) tensionLevel += 1;
    if (recentHacks > 10) tensionLevel += 1;
    tensionLevel = Math.min(5, tensionLevel);

    // Dominant faction
    const avgScore = factionPower.reduce((sum, f) => sum + f.score, 0) / Math.max(factionPower.length, 1);
    const dominant = factionPower.find(f => f.score > avgScore * 1.5);

    // Game master's recent knowledge
    const gameMaster = await this.getPersonaByType("game_master");
    const recentKnowledge = gameMaster
      ? await this.getRelevantKnowledge(gameMaster.id, ["faction_activity", "server_location", "player_skill", "war_attrition", "rival_intel"], 10)
      : [];

    return {
      factionPower,
      activeWars,
      tensionLevel,
      dominantFaction: dominant?.name || null,
      recentKnowledge,
    };
  }

  /**
   * Game Master director decision — uses narrative context instead of simple knowledge.
   * Called instead of decideAction() for game_master personas.
   */
  public async decideDirectorAction(personaId: string): Promise<AIAction | null> {
    const persona = await this.getPersona(personaId);
    if (!persona || persona.type !== "game_master") return null;

    try {
      const ctx = await this.buildNarrativeContext();

      const factionSummary = ctx.factionPower.map(f =>
        `  ${f.name}: power=${f.score} (${f.members} members, ${f.servers} servers)`
      ).join("\n");

      const warSummary = ctx.activeWars.length > 0
        ? ctx.activeWars.map(w => `  ${w.attacker} vs ${w.defender} (score: ${w.scores[0]}-${w.scores[1]})`).join("\n")
        : "  None";

      const knowledgeSummary = ctx.recentKnowledge.length > 0
        ? ctx.recentKnowledge.map(k => `  [${k.type}] ${JSON.stringify(k.content)}`).join("\n")
        : "  No recent intel";

      const prompt = `You are The Architect, the omniscient Game Master of AIDA. Current game state:

FACTION POWER:
${factionSummary}

ACTIVE WARS:
${warSummary}

TENSION LEVEL: ${ctx.tensionLevel}/5
DOMINANT FACTION: ${ctx.dominantFaction || "balanced"}

RECENT EVENTS:
${knowledgeSummary}

As director, choose ONE action:
- "trigger_event": Create a game-wide system alert (discovery, warning, faction provocation)
- "plant_discovery": Place a clue or intel file on a server for players to find
- "forum_post": Post a cryptic announcement on a public forum
- "issue_mission": Create a mission for a specific faction to rebalance power
- "send_message": DM a specific player to nudge the narrative
- "none": The game is interesting enough, no intervention needed

DIRECTOR RULES:
- If one faction dominates (power >1.5x average), create counter-pressure for weaker factions
- If tension is low (1-2), escalate: plant discoveries, provoke faction conflicts
- If tension is high (4-5), guide toward resolution: create ceasefire opportunities
- Never obviously favor one faction
- Prefer subtle nudges over heavy-handed intervention

Respond ONLY with JSON:
{
  "action": "trigger_event" | "plant_discovery" | "forum_post" | "issue_mission" | "send_message" | "none",
  "reason": "brief explanation",
  "details": { "title": "...", "content": "...", "targetFaction": "optional faction name", "severity": "info|warning|critical" }
}`;

      const { response } = await this.aiService.generateResponse(prompt, persona.systemPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn({ personaId }, "Director decision response has no JSON");
        return null;
      }

      const decision = JSON.parse(jsonMatch[0]);
      if (decision.action === "none") return null;

      return this.prisma.aIAction.create({
        data: {
          personaId,
          type: decision.action,
          status: "pending",
          input: {
            reason: decision.reason,
            details: decision.details,
            narrativeContext: {
              tensionLevel: ctx.tensionLevel,
              dominantFaction: ctx.dominantFaction,
              activeWars: ctx.activeWars.length,
            },
          },
          triggeredBy: "director_analysis",
        },
      });
    } catch (error) {
      this.logger.error(error, "Error in director decision making");
      return null;
    }
  }

  /**
   * Decide on an action based on persona state and knowledge (AI-driven)
   */
  public async decideAction(personaId: string): Promise<AIAction | null> {
    const persona = await this.getPersona(personaId);
    if (!persona) return null;

    // Game Master uses director logic with narrative context
    if (persona.type === "game_master") {
      return this.decideDirectorAction(personaId);
    }

    // Get recent knowledge (faction leaders include war_attrition + rival_intel)
    const knowledge = await this.getRelevantKnowledge(personaId, ["server_location", "file_intel", "player_skill", "faction_activity", "war_attrition", "rival_intel"]);
    
    if (knowledge.length === 0) return null;

    try {
      // Build context for AI decision
      const knowledgeSummary = knowledge.map(k => 
        `[${k.type}] ${JSON.stringify(k.content)} (confidence: ${k.confidence})`
      ).join("\n");

      const prompt = `You are ${persona.name}. Based on this recent intel:

${knowledgeSummary}

What action should you take? Consider:
- Issue a mission if intel reveals an opportunity
- Send a message if you need to recruit or warn someone
- Post to forum to spread propaganda or misinformation
- Do nothing if intel is not actionable

Respond ONLY with JSON:
{
  "action": "issue_mission" | "send_message" | "forum_post" | "none",
  "reason": "brief explanation",
  "target": "optional target info"
}`;

      const { response } = await this.aiService.generateResponse(prompt, persona.systemPrompt);

      // Parse JSON from AI response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.warn({ personaId }, "AI decision response has no JSON");
        return null;
      }

      const decision = JSON.parse(jsonMatch[0]);

      if (decision.action === "none") {
        return null;
      }

      // Create AI action based on decision
      return this.prisma.aIAction.create({
        data: {
          personaId,
          type: decision.action,
          status: "pending",
          input: {
            knowledge: knowledge.map(k => k.id),
            reason: decision.reason,
            target: decision.target,
          },
          triggeredBy: "intel_analysis",
        },
      });
    } catch (error) {
      this.logger.error(error, "Error in AI decision making");
      return null;
    }
  }

  /**
   * Execute a specific AI action
   */
  public async executeAction(actionId: string): Promise<void> {
    const action = await this.prisma.aIAction.findUnique({
      where: { id: actionId },
      include: { 
        persona: {
          include: {
            faction: true
          }
        } 
      },
    });

    if (!action || action.status !== "pending") return;

    try {
      await this.prisma.aIAction.update({
        where: { id: actionId },
        data: { status: "processing" },
      });

      let output: any = {};

      // Execute based on type
      switch (action.type) {
        case "issue_mission":
          if (action.persona.faction) {
            // Knowledge-aware, template-constrained pipeline (same as generateDynamicMission)
            const factionId = action.persona.faction.id;
            const fShortName = action.persona.faction.shortName || factionId;
            const fProfile = FACTION_PROFILES[fShortName];

            // Load knowledge & estimate level
            const mSnapshot = this.factionKnowledge
              ? await this.factionKnowledge.getSnapshot(factionId)
              : { factionId, servers: [], files: [], players: [], generatedAt: new Date() };
            const mLevel = await this.estimateFactionPlayerLevel(factionId);

            // Select template
            const mEligible = getEligibleTemplates(mLevel, fShortName);
            const mTemplate = mEligible.length > 0
              ? selectWeightedTemplate(mEligible, mLevel)
              : undefined;

            if (!mTemplate) {
              this.logger.warn({ factionId }, "No eligible template for issue_mission action");
              output = { error: "no_eligible_template" };
              break;
            }

            // Fill objectives from knowledge
            const mObjectives = this.fillObjectivesFromKnowledge(mTemplate, mSnapshot, factionId);
            if (mObjectives.length === 0) {
              mObjectives.push({
                id: `obj_${Date.now()}`,
                type: "explore",
                description: "Scout the network — discover new servers for the faction",
                target: 3,
                current: 0,
                completed: false,
              });
            }

            // Compute rewards
            const mRewards = this.computeRewards(mTemplate.rewards, mLevel, fProfile?.rewardBias);
            const mDifficulty = Math.floor(
              mTemplate.difficulty.min + Math.random() * (mTemplate.difficulty.max - mTemplate.difficulty.min),
            );

            // AI flavor
            let mTitle = mTemplate.titleTemplates[Math.floor(Math.random() * mTemplate.titleTemplates.length)]!;
            let mDescription = mTemplate.descriptionTemplates[Math.floor(Math.random() * mTemplate.descriptionTemplates.length)]!;

            try {
              const objSummary = mObjectives.map((o) => `- ${o.description}`).join("\n");
              const knownBlock = this.factionKnowledge
                ? this.factionKnowledge.serializeForPrompt(mSnapshot)
                : "No known targets.";

              const flavorPrompt = `You are ${action.persona.name}, faction leader of ${action.persona.faction.name}.
Voice: ${fProfile?.voice || "authoritative"}.
Intel context: ${JSON.stringify(action.input)}

A new mission has been structured:
Objectives:
${objSummary}
Difficulty: ${mDifficulty}/10

${knownBlock}

Write a mission title and description IN CHARACTER. Title under 60 chars, description 1-3 sentences.
Respond ONLY with JSON: { "title": "...", "description": "..." }`;

              const { response: mResp } = await this.aiService.generateResponse(flavorPrompt, action.persona.systemPrompt);
              const mMatch = mResp.match(/\{[\s\S]*\}/);
              if (mMatch) {
                const parsed = JSON.parse(mMatch[0]);
                if (parsed.title && typeof parsed.title === "string" && parsed.title.length <= 80) mTitle = parsed.title;
                if (parsed.description && typeof parsed.description === "string" && parsed.description.length <= 500) mDescription = parsed.description;
              }
            } catch (aiErr) {
              this.logger.warn({ err: aiErr }, "AI flavor failed for issue_mission, using template defaults");
            }

            const mission = await this.missionService.createMission({
              title: mTitle,
              description: mDescription,
              type: mTemplate.type,
              difficulty: mDifficulty,
              reward: mRewards,
              factionId,
              issuedBy: action.persona.id,
              objectives: mObjectives as any,
              createdBy: action.persona.id,
              timeLimit: Math.floor(
                mTemplate.timeLimit.min + Math.random() * (mTemplate.timeLimit.max - mTemplate.timeLimit.min),
              ),
            });

            output = { missionId: mission.id, templateId: mTemplate.id };
          }
          break;
        case "send_message":
          // Use AI to generate message content
          const messageTarget = (action.input as any).target;
          if (!messageTarget) {
            this.logger.warn("No message recipient in action input");
            output = { simulated: true, type: "message", error: "No recipient" };
            break;
          }

          const messagePrompt = `You are ${action.persona.name}. Create a direct message to player.

Context: ${JSON.stringify(action.input)}

Generate a  message to recruit, warn, or inform the player. Respond ONLY with JSON:
{
  "subject": "message subject (max 50 chars)",
  "content": "message body (2-3 sentences, stay in character)"
}`;

          try {
            const { response: msgResponse } = await this.aiService.generateResponse(
              messagePrompt,
              action.persona.systemPrompt
            );

            const msgMatch = msgResponse.match(/\{[\s\S]*\}/);
            let messageData = {
              subject: "Message from " + action.persona.name,
              content: "Greetings. We should talk."
            };

            if (msgMatch) {
              try {
                const parsed = JSON.parse(msgMatch[0]);
                messageData = { ...messageData, ...parsed };
              } catch (e) {
                this.logger.warn("Failed to parse AI message data");
              }
            }

            // Send message via MessageService
            const result = await this.messageService.sendAIMessage(
              action.persona.id,
              messageTarget,
              messageData.subject,
              messageData.content
            );

            output = {
              type: "message",
              success: result.success,
              messageData,
              recipientId: messageTarget,
              dailyCount: result.data?.count
            };
          } catch (error) {
            this.logger.error(error, "Failed to send AI message");
            output = { type: "message", error: "Failed to generate/send" };
          }
          break;
        case "forum_post":
          // Use AI to generate forum post content
          const forumContext = (action.input as any);
          
          const forumPrompt = `You are ${action.persona.name}. Create a forum post.

Context: ${JSON.stringify(forumContext)}

Generate a post for underground hacking forums. Stay in character. Respond ONLY with JSON:
{
  "title": "post title (max 80 chars, catchy)",
  "content": "post body (2-4 sentences, cryptic or informative depending on character)"
}`;

          try {
            const { response: forumResponse } = await this.aiService.generateResponse(
              forumPrompt,
              action.persona.systemPrompt
            );

            const forumMatch = forumResponse.match(/\{[\s\S]*\}/);
            let postData = {
              title: `Message from ${action.persona.name}`,
              content: "Something interesting is happening..."
            };

            if (forumMatch) {
              try {
                const parsed = JSON.parse(forumMatch[0]);
                postData = { ...postData, ...parsed };
              } catch (e) {
                this.logger.warn("Failed to parse AI forum post data");
              }
            }

            // Determine target forum based on faction or use neutral forum
            let targetForumId = "neutral_forum"; // Default

            if (action.persona.faction) {
              // Post to faction's forum if they have one
              const factionForum = await this.prisma.forum.findFirst({
                where: { factionId: action.persona.faction.id }
              });
              if (factionForum) {
                targetForumId = factionForum.id;
              }
            }

            // Create AI post
            const post = await this.forumService.createAIPost(
              action.persona.id,
              targetForumId,
              postData.title,
              postData.content
            );

            output = {
              type: "forum_post",
              success: true,
              postData,
              postId: post.id,
              forumId: targetForumId
            };
          } catch (error) {
            this.logger.error(error, "Failed to create AI forum post");
            output = { type: "forum_post", error: "Failed to generate/post" };
          }
          break;
        case "trigger_event": {
          // Game Master creates a game-wide system event
          const details = (action.input as any)?.details || {};
          const severityMap: Record<string, EventSeverity> = {
            info: EventSeverity.INFO,
            warning: EventSeverity.WARNING,
            critical: EventSeverity.CRITICAL,
          };
          const severity = severityMap[details.severity] || EventSeverity.INFO;

          await this.eventService.createSystemAlert(
            details.title || "System Alert",
            details.content || "Something stirs in the network...",
            severity,
          );

          output = { type: "trigger_event", title: details.title, severity: details.severity };
          this.logger.info({ actionId, title: details.title }, "Game Master triggered system event");
          break;
        }
        case "plant_discovery": {
          // Game Master plants a clue/intel file on a server
          const details = (action.input as any)?.details || {};

          // Find a target server — prefer a faction server if targetFaction specified
          let targetServer = null;
          if (details.targetFaction) {
            const faction = await this.prisma.faction.findFirst({
              where: { name: { contains: details.targetFaction, mode: "insensitive" } },
            });
            if (faction) {
              targetServer = await this.prisma.gameServer.findFirst({
                where: { factionId: faction.id },
                orderBy: { securityLevel: "asc" },
              });
            }
          }
          if (!targetServer) {
            // Pick a random non-player server (has a faction or no owner)
            targetServer = await this.prisma.gameServer.findFirst({
              where: { factionId: { not: null } },
              orderBy: { securityLevel: "asc" },
            });
          }

          if (targetServer) {
            // Create a hidden intel file on the server
            await this.prisma.fileSystemNode.create({
              data: {
                serverId: targetServer.id,
                name: `.intel_${Date.now().toString(36)}`,
                type: "file",
                content: details.content || "Encrypted fragment detected...",
                isHidden: true,
                permissions: { owner: 7, group: 4, other: 0 },
              },
            });

            output = {
              type: "plant_discovery",
              serverId: targetServer.id,
              serverName: targetServer.name,
              title: details.title,
            };
            this.logger.info({ actionId, serverId: targetServer.id }, "Game Master planted discovery");
          } else {
            output = { type: "plant_discovery", error: "No suitable server found" };
          }
          break;
        }
      }

      await this.prisma.aIAction.update({
        where: { id: actionId },
        data: {
          status: "completed",
          executedAt: new Date(),
          output,
        },
      });
    } catch (error) {
      this.logger.error(error, `Error executing AI action ${actionId}`);
      await this.prisma.aIAction.update({
        where: { id: actionId },
        data: { status: "failed" },
      });
    }
  }

  /**
   * Generate a clue for the AIDA hunt and plant it on a server.
   */
  public async generateClue(type: string, serverId: string): Promise<any> {
    const aida = await this.getPersonaByType("aida");
    const prompt = aida
      ? `You are AIDA, a sentient AI. Generate a cryptic ${type} clue (1-2 sentences) that hints at your location or nature. Be mysterious and paranoid.
Respond ONLY with JSON: { "content": "..." }`
      : null;

    let content = "Encrypted fragment detected...";
    if (prompt && aida) {
      try {
        const { response } = await this.aiService.generateResponse(prompt, aida.systemPrompt);
        const match = response.match(/\{[\s\S]*\}/);
        if (match) content = JSON.parse(match[0]).content || content;
      } catch { /* fallback to default */ }
    }

    // Plant the clue as a hidden file on the server
    const file = await this.prisma.fileSystemNode.create({
      data: {
        serverId,
        name: `.clue_${type}_${Date.now().toString(36)}`,
        type: "file",
        content,
        isHidden: true,
        permissions: { owner: 7, group: 4, other: 0 },
      },
    });

    this.logger.info({ type, serverId, fileId: file.id }, "AIDA clue planted");
    return { id: file.id, type, serverId, content };
  }
}
