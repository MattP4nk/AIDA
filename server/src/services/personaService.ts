import { injectable, inject } from "tsyringe";
import { PrismaClient, AIPersona, AIKnowledge, AIAction } from "@prisma/client";
import { Logger } from "pino";
import MissionService from "./missionService";
import { AIService } from "./aiService";

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
    @inject("AIService") private aiService: AIService
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
          // Placeholder: await this.messageService.sendMessage(...)
          this.logger.info({ actionId }, "Simulating sending message");
          output = { simulated: true, type: "message" };
          break;
        case "forum_post":
          // Placeholder: await this.forumService.createPost(...)
          this.logger.info({ actionId }, "Simulating forum post");
          output = { simulated: true, type: "forum_post" };
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
