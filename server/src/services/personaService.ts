import { injectable, inject } from "tsyringe";
import { PrismaClient, AIPersona, AIKnowledge, AIAction } from "@prisma/client";
import { Logger } from "pino";
import MissionService from "./missionService";
import { AIService } from "./aiService";
import { MessageService } from "./messageService";
import ForumService from "./forumService";

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
    @inject("Logger") private logger: Logger,
    @inject("MissionService") private missionService: MissionService,
    @inject("AIService") private aiService: AIService,
    @inject("MessageService") private messageService: MessageService,
    @inject("ForumService") private forumService: ForumService
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
   * 
   * PHASE 5 WEEK 3: Event-driven AI responses
   */
  async setupEventListeners() {
    // This method should be called during service initialization
    // to set up listeners for game events
    this.logger.info("PersonaService event listeners configured");
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

  /**
   * Decide on an action based on persona state and knowledge (AI-driven)
   */
  public async decideAction(personaId: string): Promise<AIAction | null> {
    const persona = await this.getPersona(personaId);
    if (!persona) return null;

    // Get recent knowledge
    const knowledge = await this.getRelevantKnowledge(personaId, ["server_location", "file_intel", "player_skill", "faction_activity"]);
    
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
            // Use AI to generate mission content
            const prompt = `Create a mission for this intel:
${JSON.stringify(action.input)}

Generate a realistic hacking mission. Respond ONLY with JSON:
{
  "title": "mission title",
  "description": "detailed description",
  "difficulty": 1-10,
  "objective": "what player must do"
}`;

            const { response } = await this.aiService.generateResponse(prompt, action.persona.systemPrompt);
            
            // Parse mission data from AI
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            let missionData = {
              title: "Covert Operation",
              description: `Investigate intel: ${JSON.stringify(action.input)}`,
              difficulty: 3,
              objective: "Hack the target server"
            };

            if (jsonMatch) {
              try {
                const parsed = JSON.parse(jsonMatch[0]);
                missionData = { ...missionData, ...parsed };
              } catch (e) {
                this.logger.warn("Failed to parse AI mission data, using defaults");
              }
            }

            // Create mission with AI-generated content
            const mission = await this.missionService.createMission({
              title: missionData.title,
              description: missionData.description,
              type: "hack",
              difficulty: Math.min(10, Math.max(1, missionData.difficulty)),
              reward: { 
                credits: missionData.difficulty * 100,
                xp: missionData.difficulty * 50
              },
              factionId: action.persona.faction.id,
              issuedBy: action.persona.id,
              objectives: [
                {
                  id: "obj_" + Date.now(),
                  type: "hack",
                  description: missionData.objective,
                  target: 1,
                  current: 0,
                  completed: false
                }
              ],
              createdBy: action.persona.id
            });

            output = { missionId: mission.id, missionData };
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
   * Generate a clue for the AIDA hunt
   */
  public async generateClue(type: string, serverId: string): Promise<any> {
    // Placeholder logic
    this.logger.info({ type, serverId }, "Generating clue");
    return {
      id: "clue_" + Date.now(),
      type,
      serverId,
      content: "Encrypted fragment...",
    };
  }
}
