/**
 * StoryMissionService — AI-driven multi-step narrative mission arcs.
 *
 * A faction leader AI (or Game Master) plans a coherent story arc:
 *   - 3-7 steps, each backed by a mission template
 *   - Branching on failure (adapted follow-ups, not dead ends)
 *   - Narrative context accumulates so AI writes consistent descriptions
 *   - Completing a step auto-generates the next step's mission
 *
 * Flow:
 *   1. createStoryArc() — AI generates premise + step plan
 *   2. advanceStory()   — called when a step mission completes/fails
 *   3. generateStepMission() — creates the next mission with narrative context
 */

import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, AI_SERVICE, SERVER_CONTENT_SERVICE } from "../di/tokens";
import { db } from "../database/client";
import type { AIService } from "./aiService";
import type { ServerContentService } from "./serverContentService";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface StoryStep {
  stepNumber: number;
  templateId: string; // Mission template to use for this step
  title: string; // AI-generated step title
  narrativeBrief: string; // Context for this step ("After infiltrating the gateway...")
  status: "pending" | "active" | "completed" | "failed" | "skipped";
  successBranch: number | "complete"; // Next step on success (or "complete" to end arc)
  failureBranch: number | "fail" | "adapt"; // Next step on fail, or "fail" to end, or "adapt" for AI to create alternate
  missionId?: string; // Populated when step mission is created
  completedAt?: string;
  failedAt?: string;
  playerActions?: string[]; // Summary of what player did (for AI context)
}

export interface StoryNarrativeContext {
  premise: string; // The overall story premise
  completedSteps: Array<{
    step: number;
    outcome: "success" | "failure";
    summary: string;
  }>;
  playerLevel: number;
  factionName: string;
  leaderName: string;
}

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class StoryMissionService {
  private serverContent: ServerContentService | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(SERVER_CONTENT_SERVICE) serverContentService?: ServerContentService,
  ) {
    this.serverContent = serverContentService || null;
  }

  // ── Create a new story arc ──

  async createStoryArc(
    userId: string,
    factionId: string,
    personaId: string,
    difficulty: number = 3,
  ): Promise<{
    success: boolean;
    arcId?: string;
    title?: string;
    error?: string;
  }> {
    try {
      // Get context
      const [user, faction, persona] = await Promise.all([
        db.client.user.findUnique({
          where: { id: userId },
          include: { progress: true },
        }),
        db.client.faction.findUnique({ where: { id: factionId } }),
        db.client.aIPersona.findUnique({ where: { id: personaId } }),
      ]);

      if (!user || !faction || !persona) {
        return { success: false, error: "Invalid user, faction, or persona." };
      }

      // Check if player already has an active story arc for this faction
      const existing = await db.client.storyArc.findFirst({
        where: { assignedTo: userId, factionId, status: "active" },
      });
      if (existing) {
        return {
          success: false,
          error: `You already have an active story arc: "${existing.title}". Complete or abandon it first.`,
        };
      }

      const playerLevel = user.progress?.level ?? 1;

      // Ask AI to plan the story arc
      const arcPlan = await this.generateArcPlan(
        persona,
        faction,
        playerLevel,
        difficulty,
      );

      if (!arcPlan) {
        return {
          success: false,
          error: "AI failed to generate story arc. Try again.",
        };
      }

      // Create the story arc
      const arc = await db.client.storyArc.create({
        data: {
          title: arcPlan.title,
          description: arcPlan.description,
          factionId,
          issuedBy: personaId,
          assignedTo: userId,
          status: "active",
          currentStep: 0,
          totalSteps: arcPlan.steps.length,
          steps: arcPlan.steps as any,
          narrativeContext: {
            premise: arcPlan.description,
            completedSteps: [],
            playerLevel,
            factionName: faction.name,
            leaderName: persona.name,
          } as any,
          difficulty,
        },
      });

      // Generate the first step's mission
      await this.generateStepMission(arc.id, 0);

      this.logger.info(
        { arcId: arc.id, userId, factionId, steps: arcPlan.steps.length },
        "Story arc created",
      );

      return { success: true, arcId: arc.id, title: arcPlan.title };
    } catch (err) {
      this.logger.error({ err, userId }, "Failed to create story arc");
      return { success: false, error: "Failed to create story arc." };
    }
  }

  // ── Advance story when a mission completes or fails ──

  async advanceStory(
    missionId: string,
    outcome: "completed" | "failed",
  ): Promise<void> {
    try {
      // Find the mission's story arc
      const mission = await db.client.mission.findUnique({
        where: { id: missionId },
        select: {
          storyArcId: true,
          storyStep: true,
          assignedTo: true,
          title: true,
        },
      });

      if (!mission?.storyArcId || mission.storyStep === null) return;

      const arc = await db.client.storyArc.findUnique({
        where: { id: mission.storyArcId },
      });
      if (!arc || arc.status !== "active") return;

      const steps = arc.steps as unknown as StoryStep[];
      const currentStep = steps[mission.storyStep];
      if (!currentStep) return;

      // Update step status
      const now = new Date().toISOString();
      if (outcome === "completed") {
        currentStep.status = "completed";
        currentStep.completedAt = now;
      } else {
        currentStep.status = "failed";
        currentStep.failedAt = now;
      }

      // Update narrative context
      const context = arc.narrativeContext as unknown as StoryNarrativeContext;
      context.completedSteps.push({
        step: mission.storyStep,
        outcome: outcome === "completed" ? "success" : "failure",
        summary: `Step ${mission.storyStep + 1}: "${mission.title}" — ${outcome}`,
      });

      // Determine next step
      let nextStep: number | "complete" | "fail" | "adapt";
      if (outcome === "completed") {
        nextStep = currentStep.successBranch;
      } else {
        nextStep = currentStep.failureBranch;
      }

      if (nextStep === "complete") {
        // Story arc completed successfully
        await db.client.storyArc.update({
          where: { id: arc.id },
          data: {
            status: "completed",
            completedAt: new Date(),
            steps: steps as any,
            narrativeContext: context as any,
          },
        });
        this.logger.info({ arcId: arc.id }, "Story arc completed");
        return;
      }

      if (nextStep === "fail") {
        // Story arc failed
        await db.client.storyArc.update({
          where: { id: arc.id },
          data: {
            status: "failed",
            steps: steps as any,
            narrativeContext: context as any,
          },
        });
        this.logger.info({ arcId: arc.id }, "Story arc failed");
        return;
      }

      if (nextStep === "adapt") {
        // AI generates an adapted follow-up step
        const adaptedStep = await this.generateAdaptedStep(
          arc,
          mission.storyStep,
          context,
        );
        if (adaptedStep) {
          steps.push(adaptedStep);
          nextStep = steps.length - 1;
        } else {
          // Fallback: fail the arc
          await db.client.storyArc.update({
            where: { id: arc.id },
            data: {
              status: "failed",
              steps: steps as any,
              narrativeContext: context as any,
            },
          });
          return;
        }
      }

      // Advance to next step
      const nextStepNum = typeof nextStep === "number" ? nextStep : 0;
      await db.client.storyArc.update({
        where: { id: arc.id },
        data: {
          currentStep: nextStepNum,
          totalSteps: steps.length, // May have grown if adapted
          steps: steps as any,
          narrativeContext: context as any,
        },
      });

      // Generate the next step's mission
      await this.generateStepMission(arc.id, nextStepNum);
    } catch (err) {
      this.logger.error({ err, missionId }, "Failed to advance story");
    }
  }

  // ── Generate a mission for a specific story step ──

  private async generateStepMission(
    arcId: string,
    stepNumber: number,
  ): Promise<void> {
    const arc = await db.client.storyArc.findUnique({ where: { id: arcId } });
    if (!arc) return;

    const steps = arc.steps as unknown as StoryStep[];
    const step = steps[stepNumber];
    if (!step) return;

    const context = arc.narrativeContext as unknown as StoryNarrativeContext;

    // Use PersonaService to generate a mission with narrative context
    let title = step.title;
    let description = step.narrativeBrief;

    // Try AI for richer description
    try {
      const persona = await db.client.aIPersona.findUnique({
        where: { id: arc.issuedBy },
      });
      if (persona) {
        const aiResult = await this.generateStepNarrative(
          persona,
          context,
          step,
          stepNumber,
        );
        if (aiResult) {
          title = aiResult.title || title;
          description = aiResult.description || description;
        }
      }
    } catch {
      // Use template defaults
    }

    // Look up template for objectives and rewards
    const { MISSION_TEMPLATES } = await import("./missionTemplatePool");
    const template = MISSION_TEMPLATES.get(step.templateId);

    // Build objectives from template (with generated IDs)
    const objectives = (template?.objectives || []).map(
      (obj: any, i: number) => ({
        id: `obj_${stepNumber}_${i}`,
        type: obj.type,
        description:
          obj.descriptionTemplate || obj.description || `Objective ${i + 1}`,
        target: obj.target,
        current: typeof obj.target === "boolean" ? false : 0,
        required: typeof obj.target === "number" ? obj.target : 1,
        completed: false,
        isBonus: obj.isBonus || false,
        metadata: obj.metadata || {},
      }),
    );

    // Calculate rewards from template scaling
    const playerLevel = context.playerLevel || 1;
    const rewards = template?.rewards
      ? {
          xp:
            (template.rewards.xp?.base || 100) +
            (template.rewards.xp?.perLevel || 10) * playerLevel,
          credits:
            (template.rewards.credits?.base || 50) +
            (template.rewards.credits?.perLevel || 5) * playerLevel,
          reputation: template.rewards.reputation || 0,
          skillPoints: template.rewards.skillPoints || 0,
        }
      : { xp: 100, credits: 50 };

    const timeLimit = template
      ? template.timeLimit.min +
        Math.floor(
          Math.random() * (template.timeLimit.max - template.timeLimit.min),
        )
      : 3600;

    // Provision mission infrastructure (target server, objective files, etc.)
    let targetServerId: string | undefined;
    if (this.serverContent) {
      try {
        const provision =
          await this.serverContent.provisionMissionInfrastructure(
            {
              title,
              description,
              type: "story",
              difficulty: arc.difficulty,
              objectives,
              ...(arc.factionId ? { factionId: arc.factionId } : {}),
            },
            arc.assignedTo,
          );

        if (provision) {
          targetServerId = provision.targetServerId;
          for (const patch of provision.objectives) {
            const obj = objectives[patch.index];
            if (obj) {
              obj.metadata = { ...(obj.metadata || {}), ...patch.metadata };
            }
          }
          this.logger.info(
            {
              arcId,
              stepNumber,
              targetServerId: provision.targetServerId,
              patchedObjectives: provision.objectives.length,
              plantedFiles: provision.plantedFiles.length,
            },
            "Story mission infrastructure provisioned",
          );
        }
      } catch (err) {
        this.logger.warn(
          { err, arcId, stepNumber },
          "Failed to provision story mission infrastructure",
        );
      }
    }

    // Create the mission
    const mission = await db.client.mission.create({
      data: {
        title,
        description,
        type: "story",
        difficulty: arc.difficulty,
        status: "available",
        assignedTo: arc.assignedTo,
        issuedBy: arc.issuedBy,
        factionId: arc.factionId,
        storyArcId: arcId,
        storyStep: stepNumber,
        objectives: objectives as any,
        reward: rewards as any,
        timeLimit,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        ...(targetServerId ? { targetServerId } : {}),
      },
    });

    // Mark step as active and record mission ID
    step.status = "active";
    step.missionId = mission.id;
    await db.client.storyArc.update({
      where: { id: arcId },
      data: { steps: steps as any },
    });

    this.logger.info(
      { arcId, stepNumber, missionId: mission.id },
      "Story step mission created",
    );
  }

  // ── AI: Generate story arc plan ──

  private async generateArcPlan(
    persona: { name: string; personality: string; systemPrompt: string },
    faction: { name: string; description: string },
    playerLevel: number,
    difficulty: number,
  ): Promise<{
    title: string;
    description: string;
    steps: StoryStep[];
  } | null> {
    const numSteps = Math.min(7, Math.max(3, difficulty));

    const prompt = `You are ${persona.name}, leader of ${faction.name}.

Plan a ${numSteps}-step covert operation for a level ${playerLevel} operative.
Difficulty: ${difficulty}/10.

Respond with ONLY valid JSON:
{
  "title": "Operation name (2-4 words)",
  "description": "1-2 sentence premise",
  "steps": [
    {
      "stepNumber": 0,
      "templateId": "data_heist",
      "title": "Step title",
      "narrativeBrief": "What happens in this step",
      "successBranch": 1,
      "failureBranch": "adapt"
    }
  ]
}

Available templateIds: first_blood, silent_entry, data_heist, network_sweep, clean_sweep, chain_reaction, dead_drop, persistent_access, ghost_protocol, intel_gathering, network_probe, deep_extraction, follow_the_trail, network_siege.

The last step's successBranch must be "complete".
For failureBranch: use a step number to skip ahead, "adapt" to create an alternate path, or "fail" to end the arc.`;

    try {
      const aiResult = await this.aiService.generateResponse(
        prompt,
        persona.systemPrompt,
      );
      if (!aiResult?.response) return null;

      // Extract JSON from response
      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate structure
      if (
        !parsed.title ||
        !parsed.steps ||
        !Array.isArray(parsed.steps) ||
        parsed.steps.length < 2
      ) {
        return null;
      }

      // Ensure steps have required fields
      const steps: StoryStep[] = parsed.steps.map((s: any, i: number) => ({
        stepNumber: i,
        templateId: s.templateId || "data_heist",
        title: (s.title || `Step ${i + 1}`).substring(0, 80),
        narrativeBrief: (
          s.narrativeBrief || "Continue the operation."
        ).substring(0, 300),
        status: "pending" as const,
        successBranch:
          i === parsed.steps.length - 1
            ? "complete"
            : (s.successBranch ?? i + 1),
        failureBranch: s.failureBranch ?? "adapt",
      }));

      return {
        title: parsed.title.substring(0, 80),
        description:
          parsed.description?.substring(0, 500) ||
          "A faction operation awaits.",
        steps,
      };
    } catch (err) {
      this.logger.error({ err }, "AI arc plan generation failed");
      return null;
    }
  }

  // ── AI: Generate narrative for a specific step ──

  private async generateStepNarrative(
    persona: { name: string; systemPrompt: string },
    context: StoryNarrativeContext,
    step: StoryStep,
    stepNumber: number,
  ): Promise<{ title: string; description: string } | null> {
    const previousSummary =
      context.completedSteps.map((s) => `  ${s.summary}`).join("\n") ||
      "  (This is the first step)";

    const prompt = `You are ${context.leaderName} of ${context.factionName}.

Story premise: ${context.premise}

Previous steps:
${previousSummary}

Current step ${stepNumber + 1}: "${step.title}"
Brief: ${step.narrativeBrief}

Write a mission briefing for this step. Respond with JSON:
{
  "title": "Mission title (under 60 chars)",
  "description": "2-3 sentence briefing referencing previous events"
}`;

    try {
      const aiResult = await this.aiService.generateResponse(
        prompt,
        persona.systemPrompt,
      );
      if (!aiResult?.response) return null;

      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        title: (parsed.title || step.title).substring(0, 80),
        description: (parsed.description || step.narrativeBrief).substring(
          0,
          500,
        ),
      };
    } catch {
      return null;
    }
  }

  // ── AI: Generate an adapted step after failure ──

  private async generateAdaptedStep(
    arc: { issuedBy: string; difficulty: number },
    failedStepNumber: number,
    context: StoryNarrativeContext,
  ): Promise<StoryStep | null> {
    const persona = await db.client.aIPersona.findUnique({
      where: { id: arc.issuedBy },
    });
    if (!persona) return null;

    const prompt = `You are ${context.leaderName} of ${context.factionName}.

Story: ${context.premise}
The operative FAILED step ${failedStepNumber + 1}. The mission was compromised.

Create an adapted follow-up step that accounts for the failure. Respond with JSON:
{
  "templateId": "one of: silent_entry, data_heist, clean_sweep, ghost_protocol, dead_drop",
  "title": "Adapted step title",
  "narrativeBrief": "What changed because of the failure and what must be done now"
}`;

    try {
      const aiResult = await this.aiService.generateResponse(
        prompt,
        persona.systemPrompt,
      );
      if (!aiResult?.response) return null;

      const jsonMatch = aiResult.response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]);
      const nextNum = context.completedSteps.length + 1;

      return {
        stepNumber: nextNum,
        templateId: parsed.templateId || "ghost_protocol",
        title: (parsed.title || "Contingency Plan").substring(0, 80),
        narrativeBrief: (
          parsed.narrativeBrief || "Plans have changed. Adapt."
        ).substring(0, 300),
        status: "pending",
        successBranch: "complete", // Adapted steps lead to completion
        failureBranch: "fail", // Second failure ends the arc
      };
    } catch {
      return null;
    }
  }

  // ── Query helpers ──

  async getPlayerStoryArcs(userId: string): Promise<any[]> {
    return db.client.storyArc.findMany({
      where: { assignedTo: userId },
      orderBy: { createdAt: "desc" },
      include: {
        faction: { select: { name: true } },
        persona: { select: { name: true } },
      },
    });
  }

  async getStoryArc(arcId: string): Promise<any> {
    return db.client.storyArc.findUnique({
      where: { id: arcId },
      include: {
        faction: { select: { name: true } },
        persona: { select: { name: true } },
        missions: {
          select: { id: true, title: true, status: true, storyStep: true },
        },
      },
    });
  }

  async abandonStoryArc(
    userId: string,
    arcId: string,
  ): Promise<{ success: boolean; error?: string }> {
    const arc = await db.client.storyArc.findUnique({ where: { id: arcId } });
    if (!arc) return { success: false, error: "Story arc not found." };
    if (arc.assignedTo !== userId)
      return { success: false, error: "Not your story arc." };
    if (arc.status !== "active")
      return { success: false, error: `Story arc is ${arc.status}.` };

    await db.client.storyArc.update({
      where: { id: arcId },
      data: { status: "abandoned" },
    });

    // Also abandon any active missions in this arc
    await db.client.mission.updateMany({
      where: {
        storyArcId: arcId,
        status: { in: ["available", "assigned", "active"] },
      },
      data: { status: "failed" },
    });

    return { success: true };
  }
}

export default StoryMissionService;
