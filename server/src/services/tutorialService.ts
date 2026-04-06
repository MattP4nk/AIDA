/**
 * TutorialService — Mail-driven tutorial system for new AIDA players.
 *
 * The tutorial is mandatory and auto-starts on first login. Instead of a
 * `tutorial` command, players interact with The Architect — the game's
 * mysterious AI Game Master — via the in-game mail system.
 *
 * Flow:
 *   1. On first login, `startTutorial()` creates step-1's mission and sends
 *      an in-character mail from The Architect.
 *   2. The player completes the objective (tracked by MissionIntegrationService).
 *   3. `advanceTutorial()` fires, creates the next mission, and sends the
 *      next Architect mail automatically.
 *   4. At any point the player can reply to The Architect's mail. If an
 *      active tutorial exists, the reply is fed to the AI service for a
 *      contextual, in-character hint. Otherwise a generic sign-off is sent.
 *   5. After step 5 completes, a graduation mail is sent and the tutorial
 *      is marked complete.
 *
 * Five steps teach core mechanics:
 *   1. Terminal Basics     — Connect to 3 servers
 *   2. Data Recovery       — Download a file
 *   3. First Contact       — Send a message
 *   4. Choosing Your Path  — Join a faction
 *   5. Graduation          — Earn 200 credits
 */

import "reflect-metadata";
import { injectable, inject } from "tsyringe";
import { PrismaClient, Mission } from "@prisma/client";
import { Logger } from "pino";
import MissionService from "./missionService";
import MessageService from "./messageService";
import { AIService } from "./aiService";
import {
  PRISMA_CLIENT,
  MISSION_SERVICE,
  MESSAGE_SERVICE,
  AI_SERVICE,
  LOGGER,
} from "../di/tokens";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface TutorialProgress {
  currentStep: number; // 1-based (0 = not started)
  totalSteps: number; // 5
  isComplete: boolean;
  activeMission: { id: string; title: string; description: string } | null;
  completedSteps: string[];
  hint: string | null;
}

interface TutorialStepDefinition {
  title: string;
  description: string;
  objective: {
    type: string;
    description: string;
    target: number | boolean;
    metadata?: Record<string, any>;
  };
  reward: { xp: number; credits: number; skillPoints?: number };
  hint: string;
  architectMail: {
    subject: string;
    content: string;
  };
}

// ═══════════════════════════════════════════════════════════════════
// Tutorial Step Definitions
// ═══════════════════════════════════════════════════════════════════

const TUTORIAL_STEPS: TutorialStepDefinition[] = [
  // ── Step 1: Terminal Basics ──────────────────────────────────────
  {
    title: "Terminal Basics",
    description:
      "Learn to navigate the network by connecting to remote servers.",
    objective: {
      type: "explore",
      description: "Connect to 3 different servers",
      target: 3,
    },
    reward: { xp: 50, credits: 100 },
    hint: "Type 'scan' to discover nearby servers. Use 'connect 10.10.10.1' to visit the Training Gateway. From there, 'scan' again to find more training servers. 'disconnect' returns you home.",
    architectMail: {
      subject: "Your Training Begins",
      content:
        "I've been watching you, recruit. You've entered a world you don't yet understand.\n\n" +
        "Before you can be of any use, you need to learn the basics. Your first task is simple: explore the network.\n\n" +
        "OBJECTIVE: Connect to at least 3 different servers.\n\n" +
        "There's a Training Network at 10.10.10.x — start there. Type 'scan' to see what's nearby, then 'connect <ip>' to reach a server. Use 'disconnect' to return home.\n\n" +
        "Complete this task, and I'll have your next assignment ready.\n\n" +
        "Reply to this message if you need guidance.\n\n" +
        "— The Architect",
    },
  },

  // ── Step 2: Data Recovery ────────────────────────────────────────
  {
    title: "Data Recovery",
    description:
      "Learn to extract files from remote servers for offline analysis.",
    objective: {
      type: "download_file",
      description: "Download a file from any server",
      target: true,
    },
    reward: { xp: 75, credits: 150 },
    hint: "Connect to a server, use 'ls' and 'cd' to browse, then 'download <filename>' to copy a file to your ~/downloads/ directory. Try the Training Archive at 10.10.10.20.",
    architectMail: {
      subject: "Training Assignment: Data Recovery",
      content:
        "Not bad, recruit. You can find your way around. But reading is one thing — keeping intel is another.\n\n" +
        "Any data you see with 'cat' vanishes the moment you disconnect. If you want to keep it, you need to download it.\n\n" +
        "OBJECTIVE: Download a file from any remote server.\n\n" +
        "Connect to a server (try the Training Archive at 10.10.10.20), browse with 'ls' and 'cd', then use 'download <filename>' to copy a file to your home machine's ~/downloads/ directory.\n\n" +
        "Reply if you get stuck. I have... limited patience, but I'll help.\n\n" +
        "— The Architect",
    },
  },

  // ── Step 3: First Contact ────────────────────────────────────────
  {
    title: "First Contact",
    description: "Learn to communicate with other users on the network.",
    objective: {
      type: "message",
      description: "Send a direct message to another player",
      target: 1,
    },
    reward: { xp: 50, credits: 100 },
    hint: "Use 'msg <username> <message>' to send a direct message. Try 'players' to see who's online, or message 'alice' or 'bob'.",
    architectMail: {
      subject: "Training Assignment: First Contact",
      content:
        "You're learning. But a lone wolf doesn't last long in this world.\n\n" +
        "The network is full of other operators — some allies, some threats. Either way, you need to know how to communicate.\n\n" +
        "OBJECTIVE: Send a message to another user.\n\n" +
        "Use 'msg <username> <message>' to reach someone. Try 'players' to see who's active. Even sending a message to 'alice' or 'bob' counts.\n\n" +
        "Trust is a currency here. Spend it wisely.\n\n" +
        "— The Architect",
    },
  },

  // ── Step 4: Choosing Your Path ───────────────────────────────────
  {
    title: "Choosing Your Path",
    description:
      "Pledge your allegiance to one of the three factions shaping the digital underground.",
    objective: {
      type: "join_faction",
      description: "Join a faction",
      target: true,
    },
    reward: { xp: 100, credits: 250 },
    hint: "Use 'faction list' to see the factions and what they stand for, then 'faction join <name>' to pledge allegiance.",
    architectMail: {
      subject: "Training Assignment: Choose Your Allegiance",
      content:
        "You've proven you can navigate, gather intel, and communicate. Now it's time to choose where your loyalties lie.\n\n" +
        "Three factions shape this digital underground:\n" +
        "  • The Garrison — Order through force\n" +
        "  • dotHackers — Freedom through chaos\n" +
        "  • CyberCorp — Power through wealth\n\n" +
        "Each offers unique missions, resources, and allies. Choose carefully — your allegiance defines your path.\n\n" +
        "OBJECTIVE: Join a faction.\n\n" +
        "Use 'faction list' to learn more, then 'faction join <name>' to pledge yourself.\n\n" +
        "A word of advice: there are no wrong choices. Only consequences.\n\n" +
        "— The Architect",
    },
  },

  // ── Step 5: Graduation ──────────────────────────────────────────
  {
    title: "Graduation",
    description:
      "Prove you can earn your keep in the digital underground by accumulating credits.",
    objective: {
      type: "earn_credits",
      description: "Earn 200 credits",
      target: 200,
    },
    reward: { xp: 150, credits: 500, skillPoints: 5 },
    hint: "Check 'missions' for available jobs. Accept one with 'accept <id>' and complete its objectives. Mission rewards include credits and XP.",
    architectMail: {
      subject: "Final Assignment: Prove Your Worth",
      content:
        "One final test, recruit. Everything you've learned comes down to this.\n\n" +
        "In this world, credits are survival. They buy hardware, software, access — everything you need to stay ahead. Earn them through missions, exploration, or... less legitimate means.\n\n" +
        "OBJECTIVE: Earn 200 credits.\n\n" +
        "Check 'missions' for available assignments. Accept one with 'accept <id>' and complete its objectives. Mission rewards include credits, XP, and reputation.\n\n" +
        "After this, your training is complete. What comes next is up to you.\n\n" +
        "— The Architect",
    },
  },
];

// Graduation mail — sent when all 5 steps are done
const GRADUATION_MAIL = {
  subject: "Training Complete",
  content:
    "Congratulations. You've completed the training program.\n\n" +
    "You now know how to navigate, extract data, communicate, align with a faction, and earn your keep. But this was just the surface.\n\n" +
    "The real game begins now:\n" +
    "  • 'missions' — Take on faction assignments\n" +
    "  • 'hack <ip>' — Break into secured servers (Hacking skill 20+)\n" +
    "  • 'shop' — Upgrade your hardware and software\n" +
    "  • 'help' — Full command reference\n\n" +
    "Stay sharp. Trust no one. And remember — I see everything.\n\n" +
    "— The Architect",
};

// The Architect's AI persona name (must match the seeded AIPersona record)
const ARCHITECT_PERSONA_NAME = "The Architect";

// Subjects used in training mails — used to detect training-context replies
const TRAINING_MAIL_SUBJECTS = TUTORIAL_STEPS.map(
  (s) => s.architectMail.subject,
);

// System prompt for AI-powered hint generation
const ARCHITECT_SYSTEM_PROMPT =
  "You are The Architect, the mysterious Game Master of AIDA — a multiplayer terminal hacking game. " +
  "You are guiding a new recruit through their training. Speak in a cryptic, authoritative tone — " +
  "like a mentor who knows more than they reveal. Keep responses concise (2-4 sentences). " +
  "Never reveal exact command syntax directly — nudge the player toward discovery. " +
  "If they seem very stuck, you can be more specific. " +
  "IMPORTANT: You ONLY discuss game-related topics — hacking, servers, missions, factions, " +
  "commands, and the AIDA world. If the recruit asks about anything unrelated to the game, " +
  "deflect firmly but in-character: remind them to focus on their assignment.";

// ═══════════════════════════════════════════════════════════════════
// Service
// ═══════════════════════════════════════════════════════════════════

@injectable()
export class TutorialService {
  constructor(
    @inject(PRISMA_CLIENT) private prisma: PrismaClient,
    @inject(MISSION_SERVICE) private missionService: MissionService,
    @inject(MESSAGE_SERVICE) private messageService: MessageService,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(LOGGER) private logger: Logger,
  ) {}

  // ─────────────────────────────────────────────────────────────────
  // Public Methods
  // ─────────────────────────────────────────────────────────────────

  /**
   * Check whether a player should auto-start the tutorial.
   * Returns true if the player has zero tutorial missions and is level ≤ 5.
   */
  public async shouldStartTutorial(userId: string): Promise<boolean> {
    try {
      const tutorialCount = await this.prisma.mission.count({
        where: { assignedTo: userId, type: "tutorial" },
      });

      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      const level = progress?.level ?? 1;

      return tutorialCount === 0 && level <= 5;
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Error checking tutorial eligibility",
      );
      return false;
    }
  }

  /**
   * Start the tutorial for a new player.
   * Creates the first tutorial mission and sends the first Architect mail.
   * No-ops if the tutorial has already been started.
   */
  public async startTutorial(userId: string): Promise<void> {
    try {
      // Guard: don't re-start if tutorial missions already exist
      const existingCount = await this.prisma.mission.count({
        where: { assignedTo: userId, type: "tutorial" },
      });

      if (existingCount > 0) {
        this.logger.debug(
          { userId },
          "Tutorial already started, skipping initialization",
        );
        return;
      }

      // Create the first tutorial mission (step index 0)
      const mission = await this.createTutorialMission(userId, 0);

      if (!mission) {
        this.logger.error(
          { userId },
          "Failed to create first tutorial mission",
        );
        return;
      }

      // Send step 1 mail from The Architect
      await this.sendArchitectMail(userId, 0);

      this.logger.info({ userId }, "Tutorial started for new player");
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error starting tutorial");
    }
  }

  /**
   * Advance the tutorial after a mission is completed.
   * If the completed mission is a tutorial mission, creates the next step's
   * mission and sends the next Architect mail. If all steps are done, sends
   * the graduation mail instead.
   */
  public async advanceTutorial(
    userId: string,
    completedMissionId: string,
  ): Promise<void> {
    try {
      // Look up the completed mission — bail if it isn't a tutorial mission
      const mission = await this.prisma.mission.findUnique({
        where: { id: completedMissionId },
      });

      if (!mission || mission.type !== "tutorial") {
        return;
      }

      // Count how many tutorial missions this player has completed so far
      const completedCount = await this.prisma.mission.count({
        where: {
          assignedTo: userId,
          type: "tutorial",
          status: "completed",
        },
      });

      // Next step index (0-based). After completing 1 mission the next is index 1, etc.
      const nextStep = completedCount;

      if (nextStep >= TUTORIAL_STEPS.length) {
        // All steps done — send graduation mail
        await this.sendGraduationMail(userId);

        this.logger.info(
          { userId, completedSteps: completedCount },
          "Player completed the full tutorial",
        );
        return;
      }

      // Create the next mission and send the corresponding Architect mail
      const nextMission = await this.createTutorialMission(userId, nextStep);

      if (!nextMission) {
        this.logger.error(
          { userId, nextStep },
          "Failed to create next tutorial mission",
        );
        return;
      }

      await this.sendArchitectMail(userId, nextStep);

      this.logger.info(
        { userId, step: nextStep + 1, title: TUTORIAL_STEPS[nextStep]!.title },
        "Tutorial advanced to next step",
      );
    } catch (error) {
      this.logger.error(
        { err: error, userId, completedMissionId },
        "Error advancing tutorial",
      );
    }
  }

  /**
   * Get the player's current tutorial progress.
   */
  public async getTutorialProgress(userId: string): Promise<TutorialProgress> {
    try {
      const tutorialMissions = await this.prisma.mission.findMany({
        where: { assignedTo: userId, type: "tutorial" },
        orderBy: { createdAt: "asc" },
      });

      // No tutorial missions at all — not started
      if (tutorialMissions.length === 0) {
        return {
          currentStep: 0,
          totalSteps: TUTORIAL_STEPS.length,
          isComplete: false,
          activeMission: null,
          completedSteps: [],
          hint: null,
        };
      }

      const completedMissions = tutorialMissions.filter(
        (m) => m.status === "completed",
      );
      const completedTitles = completedMissions.map((m) => m.title);

      // Find the active / available tutorial mission
      const activeMission = tutorialMissions.find(
        (m) =>
          m.status === "available" ||
          m.status === "assigned" ||
          m.status === "active",
      );

      const isComplete = completedMissions.length >= TUTORIAL_STEPS.length;

      // Determine current step number (1-based for display)
      let currentStep: number;
      if (isComplete) {
        currentStep = TUTORIAL_STEPS.length;
      } else if (activeMission) {
        const stepIndex = TUTORIAL_STEPS.findIndex(
          (s) => s.title === activeMission.title,
        );
        currentStep =
          stepIndex >= 0 ? stepIndex + 1 : completedMissions.length + 1;
      } else {
        currentStep = completedMissions.length + 1;
      }

      // Get hint for the active step
      let hint: string | null = null;
      if (activeMission && !isComplete) {
        const stepDef = TUTORIAL_STEPS.find(
          (s) => s.title === activeMission.title,
        );
        hint = stepDef?.hint ?? null;
      }

      return {
        currentStep,
        totalSteps: TUTORIAL_STEPS.length,
        isComplete,
        activeMission: activeMission
          ? {
              id: activeMission.id,
              title: activeMission.title,
              description: activeMission.description,
            }
          : null,
        completedSteps: completedTitles,
        hint,
      };
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Error fetching tutorial progress",
      );
      return {
        currentStep: 0,
        totalSteps: TUTORIAL_STEPS.length,
        isComplete: false,
        activeMission: null,
        completedSteps: [],
        hint: null,
      };
    }
  }

  /**
   * Handle a player's reply to The Architect during an active tutorial.
   *
   * Called from the MessageService post-send hook whenever any private message
   * is sent. This method is context-aware and ONLY responds when:
   *   1. The recipient is The Architect's AI user account
   *   2. The message subject indicates a reply to a training mail (contains
   *      a known training subject or keywords like "training"/"assignment")
   *   3. The sender has an active tutorial mission
   *
   * Messages to AI personas that are NOT training-related are silently ignored.
   */
  public async handlePlayerReply(
    senderId: string,
    recipientId: string,
    messageContent: string,
    messageSubject?: string,
  ): Promise<void> {
    try {
      // ── 1. Is the recipient The Architect? ──────────────────────
      const recipientUser = await this.prisma.user.findUnique({
        where: { id: recipientId },
      });

      if (!recipientUser || recipientUser.username !== ARCHITECT_PERSONA_NAME) {
        return; // Not addressed to The Architect — nothing to do
      }

      // ── 2. Is this a training-context reply? ───────────────────
      // Only respond if the subject references a training mail or training
      // keywords. This prevents random messages to The Architect from
      // triggering tutorial hint responses.
      if (!this.isTrainingRelatedMessage(messageSubject, messageContent)) {
        this.logger.debug(
          { senderId, subject: messageSubject },
          "Message to The Architect is not training-related — ignoring",
        );
        return;
      }

      // ── 3. Look up The Architect's AI persona ──────────────────
      const architectPersona = await this.prisma.aIPersona.findFirst({
        where: { name: ARCHITECT_PERSONA_NAME },
      });

      if (!architectPersona) {
        this.logger.warn(
          "The Architect AI persona not found in database — cannot reply",
        );
        return;
      }

      // ── 4. Does the sender have an active tutorial? ────────────
      const activeTutorialMission = await this.prisma.mission.findFirst({
        where: {
          assignedTo: senderId,
          type: "tutorial",
          status: { in: ["available", "assigned", "active"] },
        },
      });

      if (!activeTutorialMission) {
        // Subject looked training-related but tutorial is done — nothing to do
        return;
      }

      // ── 5. Find the matching tutorial step ─────────────────────
      const step = TUTORIAL_STEPS.find(
        (s) => s.title === activeTutorialMission.title,
      );

      if (!step) {
        this.logger.warn(
          { missionTitle: activeTutorialMission.title },
          "Active tutorial mission does not match any known step",
        );
        return;
      }

      const stepIndex = TUTORIAL_STEPS.indexOf(step);

      // ── 6. Build AI prompt and generate a response ─────────────
      const userPrompt =
        `The recruit is on training step ${stepIndex + 1}: '${step.title}'. ` +
        `The objective is: ${step.objective.description}. ` +
        `The correct hint is: ${step.hint}. ` +
        `The recruit asks: '${messageContent}'`;

      let replyContent: string;

      try {
        const aiResult = await this.aiService.generateResponse(
          userPrompt,
          ARCHITECT_SYSTEM_PROMPT,
        );
        replyContent = aiResult.response;
      } catch (aiError) {
        // AI unavailable — fall back to the raw hint text
        this.logger.warn(
          { err: aiError, userId: senderId },
          "AI response failed, falling back to static hint",
        );
        replyContent =
          `${step.hint}\n\n` +
          "— The Architect\n\n" +
          "[AI response unavailable — static hint provided]";
      }

      // ── 7. Send the reply from The Architect ───────────────────
      await this.messageService.sendAIMessage(
        architectPersona.id,
        senderId,
        `Re: ${step.architectMail.subject}`,
        replyContent,
      );

      this.logger.debug(
        { senderId, step: stepIndex + 1 },
        "Sent Architect hint reply to player",
      );
    } catch (error) {
      this.logger.error(
        { err: error, senderId, recipientId },
        "Error handling player reply to The Architect",
      );
    }
  }

  /**
   * Determine whether a message to The Architect is training-related.
   *
   * Returns true if:
   *   - The subject matches or references a known training mail subject
   *     (e.g. "Re: Your Training Begins", "Re: Training Assignment: ...")
   *   - The subject contains training/assignment/tutorial keywords
   *   - The message body explicitly references training topics
   *
   * Returns false for unrelated messages — those are silently dropped.
   */
  private isTrainingRelatedMessage(
    subject?: string,
    content?: string,
  ): boolean {
    const subjectLower = (subject ?? "").toLowerCase();
    const contentLower = (content ?? "").toLowerCase();

    // Check if subject references any known training mail subject
    for (const trainingSubject of TRAINING_MAIL_SUBJECTS) {
      if (subjectLower.includes(trainingSubject.toLowerCase())) {
        return true;
      }
    }

    // Check for training/assignment keywords in subject
    const trainingKeywords = [
      "training",
      "assignment",
      "tutorial",
      "recruit",
      "architect",
      "lesson",
      "objective",
      "graduation",
    ];

    for (const keyword of trainingKeywords) {
      if (subjectLower.includes(keyword)) {
        return true;
      }
    }

    // Check message body for training-related questions
    const bodyKeywords = [
      "training",
      "assignment",
      "how do i",
      "how to",
      "what do i do",
      "stuck",
      "help me",
      "hint",
      "objective",
      "mission",
      "tutorial",
      "scan",
      "connect",
      "download",
      "faction",
      "what next",
      "where do i",
    ];

    for (const keyword of bodyKeywords) {
      if (contentLower.includes(keyword)) {
        return true;
      }
    }

    return false;
  }

  // ─────────────────────────────────────────────────────────────────
  // Private Helpers
  // ─────────────────────────────────────────────────────────────────

  /**
   * Send an in-character mail from The Architect for a given tutorial step.
   * Falls back to a system message if the AI persona can't be resolved or
   * the daily AI message limit has been reached.
   */
  private async sendArchitectMail(
    userId: string,
    stepIndex: number,
  ): Promise<void> {
    const step = TUTORIAL_STEPS[stepIndex];
    if (!step) {
      this.logger.warn({ stepIndex }, "Invalid step index for Architect mail");
      return;
    }

    const { subject, content } = step.architectMail;

    try {
      // Resolve The Architect's AI persona
      const architectPersona = await this.prisma.aIPersona.findFirst({
        where: { name: ARCHITECT_PERSONA_NAME },
      });

      if (!architectPersona) {
        this.logger.warn(
          "The Architect persona not found — falling back to system message",
        );
        await this.messageService.sendSystemMessage(userId, subject, content);
        return;
      }

      const result = await this.messageService.sendAIMessage(
        architectPersona.id,
        userId,
        subject,
        content,
      );

      if (!result.success) {
        // Rate-limited or other failure — fall back to system message
        this.logger.warn(
          { reason: result.message, stepIndex },
          "sendAIMessage failed — falling back to system message",
        );
        await this.messageService.sendSystemMessage(userId, subject, content);
      }
    } catch (error) {
      this.logger.error(
        { err: error, userId, stepIndex },
        "Error sending Architect mail — falling back to system message",
      );
      await this.messageService.sendSystemMessage(userId, subject, content);
    }
  }

  /**
   * Send the graduation mail from The Architect after all 5 steps are done.
   */
  private async sendGraduationMail(userId: string): Promise<void> {
    const { subject, content } = GRADUATION_MAIL;

    try {
      const architectPersona = await this.prisma.aIPersona.findFirst({
        where: { name: ARCHITECT_PERSONA_NAME },
      });

      if (!architectPersona) {
        this.logger.warn(
          "The Architect persona not found — sending graduation as system message",
        );
        await this.messageService.sendSystemMessage(userId, subject, content);
        return;
      }

      const result = await this.messageService.sendAIMessage(
        architectPersona.id,
        userId,
        subject,
        content,
      );

      if (!result.success) {
        this.logger.warn(
          { reason: result.message },
          "sendAIMessage failed for graduation — falling back to system message",
        );
        await this.messageService.sendSystemMessage(userId, subject, content);
      }
    } catch (error) {
      this.logger.error(
        { err: error, userId },
        "Error sending graduation mail — falling back to system message",
      );
      await this.messageService.sendSystemMessage(userId, subject, content);
    }
  }

  /**
   * Create a tutorial mission for the given step index and assign it to
   * the player. The mission is added to both the Mission table and the
   * player's missionProgress JSON blob.
   */
  private async createTutorialMission(
    userId: string,
    stepIndex: number,
  ): Promise<Mission | null> {
    this.logger.debug({ userId, stepIndex }, "Creating tutorial mission");

    if (stepIndex < 0 || stepIndex >= TUTORIAL_STEPS.length) {
      this.logger.warn({ userId, stepIndex }, "Invalid tutorial step index");
      return null;
    }

    const step = TUTORIAL_STEPS[stepIndex]!;

    // Generate a unique objective ID
    const objectiveId = `tut_${stepIndex}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const objectives = [
      {
        id: objectiveId,
        type: step.objective.type,
        description: step.objective.description,
        target: step.objective.target,
        current: typeof step.objective.target === "number" ? 0 : false,
        completed: false,
        metadata: step.objective.metadata ?? {},
      },
    ];

    try {
      // Create the mission record via MissionService
      const mission = await this.missionService.createMission({
        title: step.title,
        description: step.description,
        type: "tutorial",
        difficulty: 1,
        reward: step.reward,
        objectives: objectives as any,
        createdBy: userId,
      });

      // Assign the mission to the player
      await this.prisma.mission.update({
        where: { id: mission.id },
        data: { assignedTo: userId, status: "active" },
      });

      // Upsert the player's missionProgress to include this mission
      const progress = await this.prisma.playerProgress.findUnique({
        where: { userId },
      });

      const missionProgress =
        (progress?.missionProgress as Record<string, any>) || {};

      missionProgress[mission.id] = {
        missionId: mission.id,
        userId,
        status: "active",
        objectives: objectives.map((obj) => ({
          ...obj,
          current: typeof obj.target === "number" ? 0 : false,
          completed: false,
        })),
        startedAt: new Date().toISOString(),
        completedAt: null,
        expiresAt: null,
      };

      if (progress) {
        await this.prisma.playerProgress.update({
          where: { userId },
          data: { missionProgress: missionProgress as any },
        });
      } else {
        // First-time player — create the progress record
        await this.prisma.playerProgress.create({
          data: {
            userId,
            missionProgress: missionProgress as any,
            experience: 0,
            level: 1,
            credits: 0,
            skills: {} as any,
            inventory: [] as any,
            equipment: {} as any,
          },
        });
      }

      this.logger.info(
        {
          userId,
          missionId: mission.id,
          step: stepIndex + 1,
          title: step.title,
        },
        "Tutorial mission created",
      );

      return mission;
    } catch (error) {
      this.logger.error(
        { err: error, userId, stepIndex, title: step.title },
        "Error creating tutorial mission",
      );
      return null;
    }
  }
}
