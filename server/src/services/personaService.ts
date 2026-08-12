import { injectable, inject } from "tsyringe";
import { PrismaClient, AIPersona, AIKnowledge, AIAction } from "@prisma/client";
import { Logger } from "pino";
import { AIService } from "./aiService";
import { MessageService } from "./messageService";
import ForumService from "./forumService";
import { FactionService } from "./factionService";
import { LOGGER } from "../di/tokens";
import { PersonaMissionGenService } from "./personaMissionGenService";
import { PersonaActionService } from "./personaActionService";
import {
  fallbackWelcomeMessage,
  fallbackDepartureMessage,
  fallbackPromotionMessage,
} from "../utils/aiFallbacks";
import { validateMessageOutput } from "../utils/aiOutputValidator";
import { safeExecute, safeAI } from "../utils/safeExecute";

/** Inline validator for ad-hoc { title, content } forum post shapes */
function validateTitleContent(parsed: any): { title: string; content: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  if (typeof parsed.title !== "string" || typeof parsed.content !== "string") return null;
  if (!parsed.title.trim() || !parsed.content.trim()) return null;
  return { title: parsed.title.trim(), content: parsed.content.trim() };
}

interface KnowledgeInput {
  source: string;
  type: string;
  content: any;
  confidence?: number;
  expiresAt?: Date;
}

@injectable()
export class PersonaService {
  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject("AIService") private aiService: AIService,
    @inject("MessageService") private messageService: MessageService,
    @inject("ForumService") private forumService: ForumService,
    @inject("FactionService") private factionService: FactionService,
    @inject("PersonaMissionGenService") private missionGenService: PersonaMissionGenService,
    @inject("PersonaActionService") private actionService: PersonaActionService,
  ) {}

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
      const faction = await this.prisma.faction.findUnique({ where: { id: factionId }, select: { shortName: true } });
      const factionShort = faction?.shortName || "garrison";

      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (!leader) return;

      const prompt = `You are ${leader.name}. A new recruit just joined your faction.
Send them a brief, in-character welcome message (2-3 sentences). Stay in character.
Respond ONLY with JSON: { "subject": "...", "content": "..." }`;

      const { enrichWithTopology } = await import("./worldTopologyContext");
      const enrichedSystemPrompt = await enrichWithTopology(leader.systemPrompt, this.prisma, this.logger);

      const leaderId = leader.id;
      const msgSvc = this.messageService;

      const msg = await safeAI({
        aiService: this.aiService,
        prompt,
        systemPrompt: enrichedSystemPrompt,
        expectedFormat: '{ "subject": "string", "content": "string (min 5 chars)" }',
        validate: validateMessageOutput,
        fallback: () => ({ subject: "Welcome", content: fallbackWelcomeMessage(factionShort, userId) }),
        context: "Welcome message for new faction member",
        logger: this.logger,
        retry: true,
        onRetrySuccess: async (result) => {
          await msgSvc.sendAIMessage(leaderId, userId, result.subject, result.content).catch(() => {});
        },
      });

      await this.messageService.sendAIMessage(leader.id, userId, msg.subject, msg.content);
      this.logger.info({ factionId, userId, personaId: leader.id }, "Faction leader welcomed new member");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onMemberJoined" }, `[onMemberJoined] ${err.message}`);
    }
  }

  /**
   * React to a faction member leaving.
   */
  async onMemberLeft(factionId: string, userId: string): Promise<void> {
    try {
      const faction = await this.prisma.faction.findUnique({ where: { id: factionId }, select: { shortName: true } });
      const factionShort = faction?.shortName || "garrison";

      const leader = await this.prisma.aIPersona.findFirst({
        where: { type: "faction_leader", faction: { id: factionId } },
      });
      if (!leader) return;

      const prompt = `You are ${leader.name}. A member just left your faction.
React briefly in character (1-2 sentences). This could be disappointment, anger, or indifference.
Respond ONLY with JSON: { "subject": "...", "content": "..." }`;

      const { enrichWithTopology } = await import("./worldTopologyContext");
      const enrichedSystemPrompt = await enrichWithTopology(leader.systemPrompt, this.prisma, this.logger);

      const leaderId = leader.id;
      const msgSvc = this.messageService;

      const msg = await safeAI({
        aiService: this.aiService,
        prompt,
        systemPrompt: enrichedSystemPrompt,
        expectedFormat: '{ "subject": "string", "content": "string (min 5 chars)" }',
        validate: validateMessageOutput,
        fallback: () => ({ subject: "Departure", content: fallbackDepartureMessage(factionShort, userId) }),
        context: "Departure message for leaving faction member",
        logger: this.logger,
        retry: true,
        onRetrySuccess: async (result) => {
          await msgSvc.sendAIMessage(leaderId, userId, result.subject, result.content).catch(() => {});
        },
      });

      await this.messageService.sendAIMessage(leader.id, userId, msg.subject, msg.content);
      this.logger.info({ factionId, userId, personaId: leader.id }, "Faction leader reacted to member leaving");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onMemberLeft" }, `[onMemberLeft] ${err.message}`);
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

      const { enrichWithTopology } = await import("./worldTopologyContext");
      const enrichedSystemPrompt = await enrichWithTopology(leader.systemPrompt, this.prisma, this.logger);

      const faction = await this.prisma.faction.findUnique({ where: { id: factionId }, select: { shortName: true } });
      const factionShort = faction?.shortName || "garrison";

      const leaderId = leader.id;
      const msgSvc = this.messageService;

      const msg = await safeAI({
        aiService: this.aiService,
        prompt,
        systemPrompt: enrichedSystemPrompt,
        expectedFormat: '{ "subject": "string", "content": "string (min 5 chars)" }',
        validate: validateMessageOutput,
        fallback: () => ({ subject: "Promotion", content: fallbackPromotionMessage(factionShort, newRank) }),
        context: "Promotion acknowledgment message",
        logger: this.logger,
        retry: true,
        onRetrySuccess: async (result) => {
          await msgSvc.sendAIMessage(leaderId, userId, result.subject, result.content).catch(() => {});
        },
      });

      await this.messageService.sendAIMessage(leader.id, userId, msg.subject, msg.content);
      this.logger.info({ factionId, userId, newRank, personaId: leader.id }, "Faction leader acknowledged promotion");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onHighRankAchieved" }, `[onHighRankAchieved] ${err.message}`);
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

      const { enrichWithTopology } = await import("./worldTopologyContext");
      const enrichedSystemPrompt = await enrichWithTopology(leader.systemPrompt, this.prisma, this.logger);

      const leaderId = leader.id;
      const forumSvc = this.forumService;
      const prismaRef = this.prisma;

      const validated = await safeAI<{ title: string; content: string } | null>({
        aiService: this.aiService,
        prompt,
        systemPrompt: enrichedSystemPrompt,
        expectedFormat: '{ "title": "string (non-empty)", "content": "string (non-empty)" }',
        validate: validateTitleContent,
        fallback: null,
        context: "Server contest reaction forum post",
        logger: this.logger,
        retry: true,
        onRetrySuccess: async (result) => {
          const forum = await prismaRef.forum.findFirst({ where: { factionId } });
          if (forum && result) await forumSvc.createAIPost(leaderId, forum.id, result.title, result.content);
        },
      });
      if (!validated) return;

      const factionForum = await this.prisma.forum.findFirst({ where: { factionId } });
      if (factionForum) {
        await this.forumService.createAIPost(leader.id, factionForum.id, validated.title, validated.content);
      }
      this.logger.info({ factionId, serverId, won, personaId: leader.id }, "Faction leader reacted to contest result");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onServerContestResolved" }, `[onServerContestResolved] ${err.message}`);
    }
  }

  /**
   * Generate a context-aware dynamic mission for a faction.
   * Delegates to PersonaMissionGenService.
   */
  async generateDynamicMission(factionId: string, context: { lowResources?: boolean; underAttack?: boolean; rebalance?: boolean }): Promise<void> {
    return this.missionGenService.generateDynamicMission(factionId, context);
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
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onMissionCompleted" }, `[onMissionCompleted] ${err.message}`);
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
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onServerHacked" }, `[onServerHacked] ${err.message}`);
    }
  }

  /**
   * Add knowledge to a persona's database
   */
  public async addKnowledge(personaId: string, input: KnowledgeInput): Promise<void> {
    await safeExecute({
      fn: async () => {
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
      },
      context: "Add AI knowledge",
      logger: this.logger,
      silent: true,
    })();
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
          const { enrichWithTopology } = await import("./worldTopologyContext");
          const warSystemPrompt = await enrichWithTopology(attackerLeader.systemPrompt, this.prisma, this.logger);
          const aLeaderId = attackerLeader.id;
          const aFactionId = attackerFactionId;
          const forumSvc = this.forumService;
          const prismaRef = this.prisma;

          const validated = await safeAI<{ title: string; content: string } | null>({
            aiService: this.aiService,
            prompt,
            systemPrompt: warSystemPrompt,
            expectedFormat: '{ "title": "string (non-empty)", "content": "string (non-empty)" }',
            validate: validateTitleContent,
            fallback: null,
            context: "War declaration forum post (attacker)",
            logger: this.logger,
            retry: true,
            onRetrySuccess: async (result) => {
              if (!result) return;
              const forum = await prismaRef.forum.findFirst({ where: { factionId: aFactionId } });
              if (forum) await forumSvc.createAIPost(aLeaderId, forum.id, result.title, result.content);
            },
          });
          if (validated) {
            const forum = await this.prisma.forum.findFirst({ where: { factionId: attackerFactionId } });
            if (forum) await this.forumService.createAIPost(attackerLeader.id, forum.id, validated.title, validated.content);
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
          const { enrichWithTopology } = await import("./worldTopologyContext");
          const defSystemPrompt = await enrichWithTopology(defenderLeader.systemPrompt, this.prisma, this.logger);
          const dLeaderId = defenderLeader.id;
          const dFactionId = defenderFactionId;
          const forumSvc = this.forumService;
          const prismaRef = this.prisma;

          const validated = await safeAI<{ title: string; content: string } | null>({
            aiService: this.aiService,
            prompt,
            systemPrompt: defSystemPrompt,
            expectedFormat: '{ "title": "string (non-empty)", "content": "string (non-empty)" }',
            validate: validateTitleContent,
            fallback: null,
            context: "War declaration forum post (defender)",
            logger: this.logger,
            retry: true,
            onRetrySuccess: async (result) => {
              if (!result) return;
              const forum = await prismaRef.forum.findFirst({ where: { factionId: dFactionId } });
              if (forum) await forumSvc.createAIPost(dLeaderId, forum.id, result.title, result.content);
            },
          });
          if (validated) {
            const forum = await this.prisma.forum.findFirst({ where: { factionId: defenderFactionId } });
            if (forum) await this.forumService.createAIPost(defenderLeader.id, forum.id, validated.title, validated.content);
          }
        } catch { /* best-effort */ }
      }

      this.logger.info({ warId, attackerFactionId, defenderFactionId }, "AI personas notified of war declaration");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onWarDeclared" }, `[onWarDeclared] ${err.message}`);
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
          const { enrichWithTopology } = await import("./worldTopologyContext");
          const winSystemPrompt = await enrichWithTopology(winnerLeader.systemPrompt, this.prisma, this.logger);
          const wLeaderId = winnerLeader.id;
          const wFactionId = winnerId;
          const forumSvc = this.forumService;
          const prismaRef = this.prisma;

          const validated = await safeAI<{ title: string; content: string } | null>({
            aiService: this.aiService,
            prompt,
            systemPrompt: winSystemPrompt,
            expectedFormat: '{ "title": "string (non-empty)", "content": "string (non-empty)" }',
            validate: validateTitleContent,
            fallback: null,
            context: "War victory forum post",
            logger: this.logger,
            retry: true,
            onRetrySuccess: async (result) => {
              if (!result) return;
              const forum = await prismaRef.forum.findFirst({ where: { factionId: wFactionId } });
              if (forum) await forumSvc.createAIPost(wLeaderId, forum.id, result.title, result.content);
            },
          });
          if (validated) {
            const forum = await this.prisma.forum.findFirst({ where: { factionId: winnerId } });
            if (forum) await this.forumService.createAIPost(winnerLeader.id, forum.id, validated.title, validated.content);
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
          const { enrichWithTopology } = await import("./worldTopologyContext");
          const loseSystemPrompt = await enrichWithTopology(loserLeader.systemPrompt, this.prisma, this.logger);
          const lLeaderId = loserLeader.id;
          const lFactionId = loserFactionId;
          const forumSvc = this.forumService;
          const prismaRef = this.prisma;

          const validated = await safeAI<{ title: string; content: string } | null>({
            aiService: this.aiService,
            prompt,
            systemPrompt: loseSystemPrompt,
            expectedFormat: '{ "title": "string (non-empty)", "content": "string (non-empty)" }',
            validate: validateTitleContent,
            fallback: null,
            context: "War defeat regrouping forum post",
            logger: this.logger,
            retry: true,
            onRetrySuccess: async (result) => {
              if (!result) return;
              const forum = await prismaRef.forum.findFirst({ where: { factionId: lFactionId } });
              if (forum) await forumSvc.createAIPost(lLeaderId, forum.id, result.title, result.content);
            },
          });
          if (validated) {
            const forum = await this.prisma.forum.findFirst({ where: { factionId: loserFactionId } });
            if (forum) await this.forumService.createAIPost(loserLeader.id, forum.id, validated.title, validated.content);
          }
        } catch { /* best-effort */ }
      }

      this.logger.info({ warId, winnerId, reason }, "AI personas notified of war end");
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onWarEnded" }, `[onWarEnded] ${err.message}`);
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
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onWarResourceBleed" }, `[onWarResourceBleed] ${err.message}`);
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
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onForumPostCreated" }, `[onForumPostCreated] ${err.message}`);
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

      // Check if attacker belongs to a rival faction -> their leader learns
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
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.debug?.({ err, context: "onFactionServerHacked" }, `[onFactionServerHacked] ${err.message}`);
    }
  }

  // ==================== DELEGATED METHODS ====================

  /**
   * Decide on an action based on persona state and knowledge (AI-driven).
   * Delegates to PersonaActionService.
   */
  public async decideAction(personaId: string): Promise<AIAction | null> {
    return this.actionService.decideAction(
      personaId,
      this.getPersona.bind(this),
      this.getPersonaByType.bind(this),
      this.getRelevantKnowledge.bind(this),
    );
  }

  /**
   * Game Master director decision.
   * Delegates to PersonaActionService.
   */
  public async decideDirectorAction(personaId: string): Promise<AIAction | null> {
    return this.actionService.decideDirectorAction(
      personaId,
      this.getPersona.bind(this),
      this.getPersonaByType.bind(this),
      this.getRelevantKnowledge.bind(this),
    );
  }

  /**
   * Execute a specific AI action.
   * Delegates to PersonaActionService.
   */
  public async executeAction(actionId: string): Promise<void> {
    return this.actionService.executeAction(
      actionId,
      this.generateClue.bind(this),
    );
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

    const validateClueContent = (parsed: any): { content: string } | null => {
      if (!parsed || typeof parsed !== "object") return null;
      if (typeof parsed.content !== "string" || !parsed.content.trim()) return null;
      return { content: parsed.content.trim() };
    };

    let content = "Encrypted fragment detected...";
    if (prompt && aida) {
      try {
        const { enrichWithTopology } = await import("./worldTopologyContext");
        const clueSystemPrompt = await enrichWithTopology(aida.systemPrompt, this.prisma, this.logger);
        const prismaRef = this.prisma;
        const clueServerId = serverId;
        const clueType = type;

        const validated = await safeAI({
          aiService: this.aiService,
          prompt,
          systemPrompt: clueSystemPrompt,
          expectedFormat: '{ "content": "string (cryptic AIDA clue, 100-500 chars)" }',
          validate: validateClueContent,
          fallback: { content: "Encrypted fragment detected..." },
          context: "Generate AIDA clue",
          logger: this.logger,
          retry: true,
          onRetrySuccess: async (result) => {
            const clueFile = await prismaRef.fileSystemNode.findFirst({
              where: {
                serverId: clueServerId,
                name: { startsWith: `.clue_${clueType}_` },
                isHidden: true,
              },
              orderBy: { createdAt: "desc" },
            });
            if (clueFile) {
              await prismaRef.fileSystemNode.update({
                where: { id: clueFile.id },
                data: { content: result.content },
              });
            }
          },
        });
        content = validated.content;
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
        permissions: { owner: 7, faction: 4, others: 0 },
      },
    });

    this.logger.info({ type, serverId, fileId: file.id }, "AIDA clue planted");
    return { id: file.id, type, serverId, content };
  }
}
