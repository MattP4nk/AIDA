import { injectable, inject } from "tsyringe";
import { PrismaClient, AIPersona, AIKnowledge, AIAction } from "@prisma/client";
import { Logger } from "pino";
import MissionService from "./missionService";
import { AIService } from "./aiService";
import { MessageService } from "./messageService";
import ForumService from "./forumService";
import EventService from "./eventService";
import { LOGGER, EVENT_SERVICE, RESOURCE_SERVICE, FACTION_KNOWLEDGE_SERVICE, STORY_MISSION_SERVICE } from "../di/tokens";
import { EventSeverity } from "../../../shared/types";
import type { FactionKnowledgeService } from "./factionKnowledgeService";
import { FACTION_PROFILES } from "./personaMissionGenService";
import type { PersonaMissionGenService } from "./personaMissionGenService";
import {
  getEligibleTemplates,
  selectWeightedTemplate,
} from "./missionTemplatePool";
import { validateOrRetry, validateDecisionOutput, validateMissionOutput, validateMessageOutput, type ValidatedDecision } from "../utils/aiOutputValidator";
import { safeAI } from "../utils/safeExecute";
import { fallbackActionDecision } from "../utils/aiFallbacks";

export interface NarrativeContext {
  factionPower: { factionId: string; name: string; score: number; members: number; servers: number }[];
  activeWars: { warId: string; attacker: string; defender: string; scores: [number, number] }[];
  tensionLevel: number; // 1-5
  dominantFaction: string | null;
  recentKnowledge: AIKnowledge[];
}

@injectable()
export class PersonaActionService {
  private factionKnowledge: FactionKnowledgeService | null = null;

  constructor(
    @inject("PrismaClient") private prisma: PrismaClient,
    @inject(LOGGER) private logger: Logger,
    @inject("MissionService") private missionService: MissionService,
    @inject("AIService") private aiService: AIService,
    @inject("MessageService") private messageService: MessageService,
    @inject("ForumService") private forumService: ForumService,
    @inject(EVENT_SERVICE) private eventService: EventService,
    @inject("PersonaMissionGenService") private missionGenService: PersonaMissionGenService,
    @inject(FACTION_KNOWLEDGE_SERVICE)
    factionKnowledgeService?: FactionKnowledgeService,
  ) {
    this.factionKnowledge = factionKnowledgeService || null;
  }

  // ==================== GAME MASTER DIRECTOR LOGIC ====================

  /**
   * Build the omniscient narrative context for the Game Master.
   * Queries all factions' data — ONLY the Game Master should use this.
   */
  private async buildNarrativeContext(
    getPersonaByType: (type: string) => Promise<AIPersona | null>,
    getRelevantKnowledge: (personaId: string, types: string[], limit?: number) => Promise<AIKnowledge[]>,
  ): Promise<NarrativeContext> {
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
    const gameMaster = await getPersonaByType("game_master");
    const recentKnowledge = gameMaster
      ? await getRelevantKnowledge(gameMaster.id, ["faction_activity", "server_location", "player_skill", "war_attrition", "rival_intel"], 10)
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
  public async decideDirectorAction(
    personaId: string,
    getPersona: (id: string) => Promise<AIPersona | null>,
    getPersonaByType: (type: string) => Promise<AIPersona | null>,
    getRelevantKnowledge: (personaId: string, types: string[], limit?: number) => Promise<AIKnowledge[]>,
  ): Promise<AIAction | null> {
    const persona = await getPersona(personaId);
    if (!persona || persona.type !== "game_master") return null;

    try {
      const ctx = await this.buildNarrativeContext(getPersonaByType, getRelevantKnowledge);

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

      // Use agent loop so AI can query DB and create entities
      const expectedFormat = '{ "action": "issue_mission|create_story_arc|send_message|forum_post|trigger_event|none", "reason": "string", "details": {}, "target": "string" }';
      const { runAgentLoop } = await import("./aiAgentTools");
      const agentPrompt = prompt + `\n\nYour final response MUST be JSON:\n${expectedFormat}`;

      // Try agent loop first, then fall back to safeAI
      let responseText: string | null = null;
      try {
        responseText = await runAgentLoop(this.aiService, this.prisma, persona.systemPrompt, agentPrompt, this.logger, 6);
      } catch { /* fall through to safeAI */ }

      // If agent loop produced a response, validate it directly
      if (responseText) {
        const decision = validateOrRetry(responseText, validateDecisionOutput);
        if (decision && decision.action !== "none") {
          return this.prisma.aIAction.create({
            data: {
              personaId,
              type: decision.action,
              status: "pending",
              input: {
                reason: decision.reason,
                details: (decision as any).details,
                narrativeContext: {
                  tensionLevel: ctx.tensionLevel,
                  dominantFaction: ctx.dominantFaction,
                  activeWars: ctx.activeWars.length,
                },
              },
              triggeredBy: "director_analysis",
            },
          });
        }
      }

      // Agent loop failed or invalid — use safeAI with generateOrThrow
      const prismaRef = this.prisma;
      const decision = await safeAI<ValidatedDecision | null>({
        aiService: this.aiService,
        prompt,
        systemPrompt: persona.systemPrompt,
        expectedFormat,
        validate: validateDecisionOutput,
        fallback: () => {
          const fb = fallbackActionDecision(persona.type);
          return fb ? { action: fb.type, reason: fb.reasoning } : null;
        },
        context: "Director decision (Game Master)",
        logger: this.logger,
        retry: true,
        onRetrySuccess: async (result) => {
          if (!result || result.action === "none") return;
          await prismaRef.aIAction.create({
            data: {
              personaId,
              type: result.action,
              status: "pending",
              input: {
                reason: result.reason,
                details: result.details,
                narrativeContext: {
                  tensionLevel: ctx.tensionLevel,
                  dominantFaction: ctx.dominantFaction,
                  activeWars: ctx.activeWars.length,
                },
                source: "retry_queue",
              },
              triggeredBy: "director_analysis_retry",
            },
          });
        },
      });

      if (!decision || decision.action === "none") return null;

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
  public async decideAction(
    personaId: string,
    getPersona: (id: string) => Promise<AIPersona | null>,
    getPersonaByType: (type: string) => Promise<AIPersona | null>,
    getRelevantKnowledge: (personaId: string, types: string[], limit?: number) => Promise<AIKnowledge[]>,
  ): Promise<AIAction | null> {
    const persona = await getPersona(personaId);
    if (!persona) return null;

    // Game Master uses director logic with narrative context
    if (persona.type === "game_master") {
      return this.decideDirectorAction(personaId, getPersona, getPersonaByType, getRelevantKnowledge);
    }

    // Get recent knowledge (faction leaders include war_attrition + rival_intel)
    const knowledge = await getRelevantKnowledge(personaId, ["server_location", "file_intel", "player_skill", "faction_activity", "war_attrition", "rival_intel"]);

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
- Create a story arc if there's a complex multi-step operation worth planning (3-7 step narrative campaign)
- Send a message if you need to recruit or warn someone
- Post to forum to spread propaganda or misinformation
- Do nothing if intel is not actionable

Respond ONLY with JSON:
{
  "action": "issue_mission" | "create_story_arc" | "send_message" | "forum_post" | "none",
  "reason": "brief explanation",
  "target": "optional target info"
}`;

      // Use agent loop so AI can query DB and create entities
      const expectedFormat = '{ "action": "issue_mission|create_story_arc|send_message|forum_post|trigger_event|none", "reason": "string", "details": {}, "target": "string" }';
      const { runAgentLoop } = await import("./aiAgentTools");
      const agentPrompt = prompt + `\n\nYour final response MUST be JSON:\n${expectedFormat}`;

      // Try agent loop first, then fall back to safeAI
      let responseText: string | null = null;
      try {
        responseText = await runAgentLoop(this.aiService, this.prisma, persona.systemPrompt, agentPrompt, this.logger, 6);
      } catch { /* fall through to safeAI */ }

      const knowledgeIds = knowledge.map(k => k.id);

      // If agent loop produced a response, validate it directly
      if (responseText) {
        const decision = validateOrRetry(responseText, validateDecisionOutput);
        if (decision && decision.action !== "none") {
          return this.prisma.aIAction.create({
            data: {
              personaId,
              type: decision.action,
              status: "pending",
              input: {
                knowledge: knowledgeIds,
                reason: decision.reason,
                target: decision.target,
              },
              triggeredBy: "intel_analysis",
            },
          });
        }
      }

      // Agent loop failed or invalid — use safeAI with generateOrThrow
      const prismaRef = this.prisma;
      const decision = await safeAI<ValidatedDecision | null>({
        aiService: this.aiService,
        prompt,
        systemPrompt: persona.systemPrompt,
        expectedFormat,
        validate: validateDecisionOutput,
        fallback: () => {
          const fb = fallbackActionDecision(persona.type);
          return fb ? { action: fb.type, reason: fb.reasoning } : null;
        },
        context: "Persona action decision (faction leader)",
        logger: this.logger,
        retry: true,
        onRetrySuccess: async (result) => {
          if (!result || result.action === "none") return;
          await prismaRef.aIAction.create({
            data: {
              personaId,
              type: result.action,
              status: "pending",
              input: {
                knowledge: knowledgeIds,
                reason: result.reason,
                target: result.target,
                source: "retry_queue",
              },
              triggeredBy: "intel_analysis_retry",
            },
          });
        },
      });

      if (!decision || decision.action === "none") return null;

      return this.prisma.aIAction.create({
        data: {
          personaId,
          type: decision.action,
          status: "pending",
          input: {
            knowledge: knowledgeIds,
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
  public async executeAction(
    actionId: string,
    generateClue: (type: string, serverId: string) => Promise<any>,
  ): Promise<void> {
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
        case "issue_mission": {
          if (action.persona.faction) {
            // Knowledge-aware, template-constrained pipeline (same as generateDynamicMission)
            const factionId = action.persona.faction.id;
            const fShortName = action.persona.faction.shortName || factionId;
            const fProfile = FACTION_PROFILES[fShortName];

            // Load knowledge & estimate level
            const mSnapshot = this.factionKnowledge
              ? await this.factionKnowledge.getSnapshot(factionId)
              : { factionId, servers: [], files: [], players: [], generatedAt: new Date() };
            const mLevel = await this.missionGenService.estimateFactionPlayerLevel(factionId);

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
            const mObjectives = this.missionGenService.fillObjectivesFromKnowledge(mTemplate, mSnapshot, factionId);
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
            const mRewards = this.missionGenService.computeRewards(mTemplate.rewards, mLevel, fProfile?.rewardBias);
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

              const prismaRef = this.prisma;
              const personaId = action.persona.id;

              const validated = await safeAI({
                aiService: this.aiService,
                prompt: flavorPrompt,
                systemPrompt: action.persona.systemPrompt,
                expectedFormat: '{ "title": "string (3-80 chars)", "description": "string (10-500 chars)" }',
                validate: validateMissionOutput,
                fallback: { title: mTitle, description: mDescription },
                context: "Mission flavor text for issue_mission action",
                logger: this.logger,
                retry: true,
                onRetrySuccess: async (result) => {
                  const recentMission = await prismaRef.mission.findFirst({
                    where: { issuedBy: personaId, factionId },
                    orderBy: { createdAt: "desc" },
                  });
                  if (recentMission) {
                    await prismaRef.mission.update({
                      where: { id: recentMission.id },
                      data: { title: result.title, description: result.description },
                    });
                  }
                },
              });
              mTitle = validated.title;
              mDescription = validated.description;
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
        } break;
        case "create_story_arc": {
          // Faction leader creates a multi-step story arc for a faction member
          if (action.persona.faction) {
            const factionId = action.persona.faction.id;

            // Find an active faction member to assign the arc to
            const member = await this.prisma.factionMember.findFirst({
              where: { factionId },
              include: { user: { include: { progress: true } } },
              orderBy: { reputation: "desc" },
            });

            if (member) {
              try {
                const { getService } = await import("../di/container");
                const storyService = getService<import("./storyMissionService").StoryMissionService>(STORY_MISSION_SERVICE);
                const playerLevel = member.user.progress?.level ?? 1;
                const difficulty = Math.min(10, Math.max(3, Math.floor(playerLevel / 10) + 3));

                const result = await storyService.createStoryArc(member.userId, factionId, action.persona.id, difficulty);
                output = { type: "create_story_arc", ...result };
                if (result.success) {
                  this.logger.info({ actionId, arcId: result.arcId, userId: member.userId }, "Faction leader created story arc");
                }
              } catch (err) {
                this.logger.warn({ err }, "StoryMissionService not available for arc creation");
                output = { type: "create_story_arc", error: "service_unavailable" };
              }
            } else {
              output = { type: "create_story_arc", error: "no_faction_members" };
            }
          }
          break;
        }
        case "send_message": {
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
            const messageData = await safeAI({
              aiService: this.aiService,
              prompt: messagePrompt,
              systemPrompt: action.persona.systemPrompt,
              expectedFormat: '{ "subject": "string", "content": "string" }',
              validate: validateMessageOutput,
              fallback: {
                subject: "Message from " + action.persona.name,
                content: "Greetings. We should talk."
              },
              context: "AI persona send_message action",
              logger: this.logger,
            });

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
        }
        case "forum_post": {
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
            const validateTitleContent = (parsed: any): { title: string; content: string } | null => {
              if (!parsed || typeof parsed !== "object") return null;
              if (typeof parsed.title !== "string" || typeof parsed.content !== "string") return null;
              if (!parsed.title.trim() || !parsed.content.trim()) return null;
              return { title: parsed.title.trim(), content: parsed.content.trim() };
            };

            const postData = await safeAI({
              aiService: this.aiService,
              prompt: forumPrompt,
              systemPrompt: action.persona.systemPrompt,
              expectedFormat: '{ "title": "string", "content": "string" }',
              validate: validateTitleContent,
              fallback: {
                title: `Message from ${action.persona.name}`,
                content: "Something interesting is happening..."
              },
              context: "AI persona forum_post action",
              logger: this.logger,
            });

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
        }
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
          // Game Master plants an AI-generated clue/intel file on a server
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
            targetServer = await this.prisma.gameServer.findFirst({
              where: { factionId: { not: null } },
              orderBy: { securityLevel: "asc" },
            });
          }

          if (targetServer) {
            const clueType = details.title || "signal";
            const clue = await generateClue(clueType, targetServer.id);

            output = {
              type: "plant_discovery",
              serverId: targetServer.id,
              serverName: targetServer.name,
              fileId: clue.id,
              title: details.title,
            };
            this.logger.info({ actionId, serverId: targetServer.id, fileId: clue.id }, "Game Master planted discovery via generateClue");
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
}
