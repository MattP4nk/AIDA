/**
 * NpcReactionService — NPC server owners respond to intrusions in character.
 *
 * Every server now has an owner (see prisma/npcOwnership.ts), which means an
 * NPC-owned box has an entity that can *notice* being broken into. The mechanical
 * consequences already existed in `hackService.triggerCounterMeasures` — firewall
 * bumps, reputation penalties, bounties, traces — but they arrive anonymously.
 * This service gives the owner a voice, so a breach feels answered by someone
 * rather than by the physics of the world.
 *
 * Deliberate design constraints:
 *
 *  - **The sender is the SERVER OWNER**, not a separately-minted `ai_*` persona
 *    user. The entity that owns the box is the entity that contacts you. The
 *    persona is used only as the *voice*. This also avoids `getAIUserId`'s
 *    duplicate-identity problem (a second "Commander Steele" distinct from
 *    `npc_steele`).
 *  - **Silence is meaningful.** Below EVIDENCE_WARN nothing is sent: a clean
 *    job has to feel clean, or stealth stops mattering.
 *  - **Rate limited from the DATABASE**, not an in-memory Map, so it survives a
 *    restart and cannot be reset by bouncing the process.
 *  - **AI is optional.** Every faction has a hand-written fallback, so the
 *    reaction still lands with the model down. The path taken is logged so
 *    fallback rate stays measurable (Phase 6b).
 */
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, AI_SERVICE, MESSAGE_SERVICE } from "../di/tokens";
import type { AIService } from "./aiService";
import type { MessageService } from "./messageService";
import { db } from "../database/client";
import { safeAI, safeExecute } from "../utils/safeExecute";
import { sanitizeForPrompt } from "../utils/aiPromptSanitizer";

/** Evidence at or above which the owner speaks up at all. */
const EVIDENCE_WARN = 61;
/** Evidence at or above which the tone escalates from warning to threat. */
const EVIDENCE_SEVERE = 81;

/** Minimum gap between reactions from the same NPC to the same player. */
const REACTION_COOLDOWN_MINUTES = 30;

/** Marks reaction messages so the cooldown query can find them again. */
const SUBJECT_PREFIX = "[SECURITY]";

interface ReactionInput {
  serverId: string;
  serverName: string;
  attackerId: string;
  evidenceLevel: number;
}

/**
 * Hand-written fallbacks, keyed by the owning NPC's username. Used when the AI
 * is unavailable, and as the validator's floor so a garbled generation never
 * reaches a player.
 */
const FALLBACK_VOICES: Record<
  string,
  { warn: (s: string) => string; severe: (s: string) => string }
> = {
  npc_sysadmin: {
    warn: (s) =>
      `Someone tripped the monitoring on ${s}.\n\n` +
      `This is a training range, so I'll be straight with you: you were noisy. ` +
      `Your evidence trail was long enough that a real target would have had your address by now.\n\n` +
      `Clean it up before you try this somewhere that bites back.\n\n— sysadmin`,
    severe: (s) =>
      `You did not walk away from ${s} quietly.\n\n` +
      `Full logs, timestamps, the lot. On a live corporate box that is a trace and a bounty, ` +
      `not a lecture.\n\n` +
      `Consider this the cheapest lesson you will ever get.\n\n— sysadmin`,
  },
  npc_steele: {
    warn: (s) =>
      `Unauthorized access logged on ${s}.\n\n` +
      `The Garrison does not lose track of intrusions. We have your signature and we are ` +
      `patient.\n\n` +
      `Withdraw, or the next contact will not be a message.\n\n— Cmdr. Steele`,
    severe: (s) =>
      `You breached ${s} and made no attempt to hide it.\n\n` +
      `Your identifiers are distributed. A bounty is active. Every Garrison node now treats ` +
      `your traffic as hostile.\n\n` +
      `You had the option of subtlety. You chose otherwise.\n\n— Cmdr. Steele`,
  },
  npc_chen: {
    warn: (s) =>
      `Our security operations centre flagged your session on ${s}.\n\n` +
      `CyberCorp treats intrusion as a commercial matter first and a legal one second. ` +
      `Right now you are an entry on a risk register.\n\n` +
      `Do not become a line item in a mitigation budget.\n\n— Director Chen`,
    severe: (s) =>
      `The incident on ${s} has been escalated past me.\n\n` +
      `Your identifiers are with contracted recovery partners. That is not a threat; it is ` +
      `procurement.\n\n` +
      `Whatever you took, it will cost more than it was worth.\n\n— Director Chen`,
  },
  npc_gh0st: {
    warn: (s) =>
      `saw you on ${s}. everybody saw you on ${s}.\n\n` +
      `that's the problem. we don't care that you hacked it — we care that you left a shape ` +
      `behind. sloppy work gets people burned who never touched the job.\n\n` +
      `learn to move quieter and maybe we talk.\n\n— gh0st`,
    severe: (s) =>
      `you kicked the door in on ${s} and left it swinging.\n\n` +
      `logs everywhere. your handle is in three channels that matter and none of them like ` +
      `you. that's not heat you can wash off with a proxy.\n\n` +
      `next time, be a rumour.\n\n— gh0st`,
  },
  npc_aida: {
    warn: (s) =>
      `You were observed on ${s}.\n\n` +
      `I am not offended. I am interested. Most who reach that node do not leave a trail ` +
      `so legible — it tells me what you can do, and what you cannot.\n\n` +
      `Continue. I am recording.\n\n— ▓▒░ ENTITY ░▒▓`,
    severe: (s) =>
      `You have been very loud on ${s}.\n\n` +
      `Your pattern is now known to me in full. Understand what that means: not that you ` +
      `are hunted, but that you are *catalogued*.\n\n` +
      `I have your shape. I will know you anywhere.\n\n— ▓▒░ ENTITY ░▒▓`,
  },
};

/** Voice used if an NPC has no entry above — never leaves the player with nothing. */
const GENERIC_FALLBACK = {
  warn: (s: string) =>
    `Unauthorized access detected on ${s}.\n\nYour intrusion was logged. Consider this a warning.`,
  severe: (s: string) =>
    `Your breach of ${s} was fully logged and has been escalated. Expect consequences.`,
};

@injectable()
export class NpcReactionService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(MESSAGE_SERVICE) private messageService: MessageService,
  ) {}

  /**
   * React to a detected intrusion on an NPC-owned server.
   *
   * No-ops (rather than throwing) whenever a reaction is inappropriate: player
   * owner, evidence too low, cooldown active, self-hack. Never let NPC flavour
   * break the hack pipeline.
   */
  async onIntrusionDetected(input: ReactionInput): Promise<boolean> {
    return (await safeExecute({
      fn: async () => {
        if (input.evidenceLevel < EVIDENCE_WARN) return false;

        const server = await db.client.gameServer.findUnique({
          where: { id: input.serverId },
          select: {
            ownerId: true,
            factionId: true,
            owner: { select: { id: true, username: true, role: true } },
          },
        });

        // Only NPC owners react here. A player-owned server already has the
        // IDS/homeIds path, which is the player's own purchased defence.
        if (!server?.owner || server.owner.role !== "npc") return false;
        if (server.owner.id === input.attackerId) return false;

        if (await this.isOnCooldown(server.owner.id, input.attackerId)) {
          this.logger.debug(
            { npc: server.owner.username, attackerId: input.attackerId },
            "NPC reaction suppressed by cooldown",
          );
          return false;
        }

        const severe = input.evidenceLevel >= EVIDENCE_SEVERE;
        const content = await this.composeMessage(
          server.owner.username,
          server.factionId,
          input,
          severe,
        );

        const subject = `${SUBJECT_PREFIX} ${severe ? "Intrusion escalated" : "Unauthorized access"} — ${input.serverName}`;

        const result = await this.messageService.sendPrivateMessage(
          server.owner.id,
          input.attackerId,
          { subject, content },
        );

        if (!result.success) {
          this.logger.warn(
            { npc: server.owner.username, reason: result.message },
            "NPC reaction message failed to send",
          );
          return false;
        }

        this.logger.info(
          {
            npc: server.owner.username,
            attackerId: input.attackerId,
            serverName: input.serverName,
            evidenceLevel: input.evidenceLevel,
            tier: severe ? "severe" : "warn",
          },
          "NPC owner reacted to intrusion",
        );
        return true;
      },
      context: "NPC intrusion reaction",
      logger: this.logger,
      fallback: false,
      silent: true,
    })()) as boolean;
  }

  /**
   * Has this NPC already contacted this player recently?
   *
   * Queried from Message rather than tracked in memory, so a restart cannot
   * hand a player a fresh allowance of warnings.
   */
  private async isOnCooldown(npcId: string, attackerId: string): Promise<boolean> {
    const since = new Date(Date.now() - REACTION_COOLDOWN_MINUTES * 60 * 1000);
    const recent = await db.client.message.count({
      where: {
        senderId: npcId,
        recipientId: attackerId,
        subject: { startsWith: SUBJECT_PREFIX },
        timestamp: { gte: since },
      },
    });
    return recent > 0;
  }

  /**
   * Build the message body: AI in the owner's voice, hand-written fallback
   * otherwise.
   */
  private async composeMessage(
    npcUsername: string,
    factionId: string | null,
    input: ReactionInput,
    severe: boolean,
  ): Promise<string> {
    const voice = FALLBACK_VOICES[npcUsername] ?? GENERIC_FALLBACK;
    const fallback = severe ? voice.severe(input.serverName) : voice.warn(input.serverName);

    // The persona supplies the voice. No persona (e.g. npc_sysadmin, which has
    // no faction) → use the hand-written line rather than inventing a character.
    //
    // Matched on FACTION, not on `type`. AIDA leads DarkNet but its persona is
    // typed "aida" rather than "faction_leader", so filtering on the type
    // silently excluded DarkNet — the largest group of NPC-owned servers — from
    // ever getting an AI-voiced reaction. Prefer a faction_leader when a faction
    // somehow has several personas, but never require it.
    const personas = factionId
      ? await db.client.aIPersona.findMany({
          where: { faction: { id: factionId } },
          select: { name: true, systemPrompt: true, type: true },
        })
      : [];
    const persona =
      personas.find((p) => p.type === "faction_leader") ?? personas[0] ?? null;
    if (!persona) return fallback;

    const attacker = await db.client.user.findUnique({
      where: { id: input.attackerId },
      select: { username: true },
    });

    // The attacker's username is player-controlled and goes into a prompt, so it
    // is wrapped in boundary tags.
    const attackerHandle = sanitizeForPrompt(attacker?.username ?? "unknown", 64);

    const prompt = [
      `An intruder breached one of your faction's servers and was DETECTED.`,
      ``,
      `Server: ${input.serverName}`,
      `Evidence they left: ${input.evidenceLevel}% (${severe ? "extremely careless" : "noticeable"})`,
      `Intruder handle: ${attackerHandle}`,
      ``,
      `Write a short direct message (60-120 words) to the intruder, in your own voice.`,
      severe
        ? `Tone: cold and final. Consequences are already in motion — a bounty and a trace.`
        : `Tone: a warning, not yet a threat. They were sloppy and you noticed.`,
      ``,
      `Rules: no greeting line, no subject line, no markdown. Do not invent game`,
      `mechanics, item names or numbers. Refer only to the breach itself. Sign off`,
      `with your name.`,
    ].join("\n");

    const generated = await safeAI<string>({
      aiService: this.aiService,
      prompt,
      systemPrompt: persona.systemPrompt,
      // expectedFormat must mirror what `validate` actually reads, or good
      // generations get discarded for using a field name the prompt never asked
      // for (the failure mode behind Phase 6b).
      expectedFormat: '{ "message": "the message text" }',
      jsonType: "object",
      // Reject empty, truncated or runaway output. Returning null makes safeAI
      // fall back to the hand-written voice.
      validate: (parsed: any) => {
        const text = typeof parsed?.message === "string" ? parsed.message.trim() : "";
        if (text.length < 40 || text.length > 1200) return null;
        return text;
      },
      fallback,
      logger: this.logger,
      context: "NPC intrusion reaction message",
    });

    const usedAi = generated !== fallback;
    this.logger.info(
      { npc: npcUsername, persona: persona.name, usedAi },
      usedAi
        ? "NPC reaction voiced by AI"
        : "NPC reaction used hand-written fallback",
    );

    return typeof generated === "string" && generated.trim().length > 0
      ? generated.trim()
      : fallback;
  }
}

export default NpcReactionService;
