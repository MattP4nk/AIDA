/**
 * AI Fallback Generators
 *
 * Template-driven content for when AI is unavailable.
 * Uses existing faction voice, employee rosters, and lore data
 * to produce contextually appropriate fallback content.
 */

import { FACTION_MUNDANE_THEMES } from "../lore/worldLore";

// ═══════════════════════════════════════════════════════════════════
// Persona Message Fallbacks
// ═══════════════════════════════════════════════════════════════════

const WELCOME_TEMPLATES: Record<string, string[]> = {
  garrison: [
    "Welcome aboard, operative. Your clearance has been granted. Report to your section chief for assignment.",
    "New recruit confirmed. Your service record is clean — keep it that way. Garrison Command expects discipline.",
    "Operative status: ACTIVE. Access your briefing materials and await deployment. The grid doesn't defend itself.",
  ],
  dothackers: [
    "yo welcome to the mesh. no rules, no masters. just don't snitch and we're good. check the drops for tools.",
    "new node online. you're one of us now. the corps have their walls — we have truth. explore freely.",
    "welcome. the net belongs to everyone. the first rule: question everything. second rule: share what you find.",
  ],
  cybercorp: [
    "Welcome to CyberCorp. Your employee profile has been activated. Please review the onboarding documentation.",
    "New associate confirmed. Your access tier has been provisioned. Quarterly targets will be issued shortly.",
    "Welcome aboard. CyberCorp values efficiency and discretion. Your first deliverables are due within the cycle.",
  ],
  darknet: [
    "... signal acknowledged. You found us. Or perhaps we found you. The fragments remember.",
    "New signal detected in the mesh. You are expected. Listen carefully — not everything here is what it seems.",
    "Welcome to the deep. The surface factions play their games. Down here, we remember what was lost.",
  ],
};

const DEPARTURE_TEMPLATES: Record<string, string[]> = {
  garrison: [
    "Your discharge has been processed. Your access has been revoked. Garrison Command notes your service.",
    "Operative status: INACTIVE. Security clearance revoked. We wish you well — the grid is less defended without you.",
  ],
  dothackers: [
    "your call. the mesh is always open if you change your mind. no grudges — that's not our way.",
    "gone but not forgotten. your contributions to the cause are logged. come back anytime.",
  ],
  cybercorp: [
    "Your access has been terminated. Exit interviews are mandatory. Please return all proprietary materials.",
    "Associate status: TERMINATED. Non-compete clause remains in effect. CyberCorp thanks you for your service.",
  ],
  darknet: [
    "... the signal fades. But signals can be found again. The fragments will wait.",
    "You leave the deep. The surface calls. But the memory of what you saw here will linger.",
  ],
};

const PROMOTION_TEMPLATES: Record<string, string[]> = {
  garrison: [
    "Congratulations on your promotion, operative. Your dedication to the grid has been recognized by Garrison Command.",
    "Rank advancement confirmed. With higher clearance comes greater responsibility. The grid depends on you.",
  ],
  dothackers: [
    "nice work. you've earned trust in the mesh. more access, more tools, more truth. keep pushing.",
    "level up in the collective. your actions speak louder than any title. the cause grows stronger.",
  ],
  cybercorp: [
    "Your performance metrics have qualified you for advancement. New responsibilities and compensation await.",
    "Promotion approved by the board. Your new access tier unlocks strategic initiatives. Deliver results.",
  ],
  darknet: [
    "... your resonance with the signal grows stronger. New pathways reveal themselves. Listen closely.",
    "The fragments acknowledge your progress. Deeper layers of the mesh open to you. Tread carefully.",
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Generate a faction-appropriate welcome message without AI.
 */
export function fallbackWelcomeMessage(factionShortName: string, playerName: string): string {
  const templates = WELCOME_TEMPLATES[factionShortName] || WELCOME_TEMPLATES.garrison!;
  return pickRandom(templates).replace(/operative|recruit|node|associate/i, playerName);
}

/**
 * Generate a faction-appropriate departure message without AI.
 */
export function fallbackDepartureMessage(factionShortName: string, _username: string): string {
  const templates = DEPARTURE_TEMPLATES[factionShortName] || DEPARTURE_TEMPLATES.garrison!;
  return pickRandom(templates);
}

/**
 * Generate a faction-appropriate promotion message without AI.
 */
export function fallbackPromotionMessage(factionShortName: string, _rank: string): string {
  const templates = PROMOTION_TEMPLATES[factionShortName] || PROMOTION_TEMPLATES.garrison!;
  return pickRandom(templates);
}

// ═══════════════════════════════════════════════════════════════════
// Persona Action Fallbacks
// ═══════════════════════════════════════════════════════════════════

/**
 * Pick a default action type when AI can't decide.
 * Weighted by persona type to feel natural.
 */
export function fallbackActionDecision(personaType: string): {
  type: string;
  reasoning: string;
} | null {
  const weights: Record<string, Array<{ type: string; weight: number; reasoning: string }>> = {
    faction_leader: [
      { type: "issue_mission", weight: 5, reasoning: "Routine mission assignment to keep operatives active" },
      { type: "forum_post", weight: 3, reasoning: "Maintaining faction presence on forums" },
      { type: "send_message", weight: 2, reasoning: "Checking in with active operatives" },
    ],
    game_master: [
      { type: "plant_clue", weight: 4, reasoning: "Seeding breadcrumbs for curious players" },
      { type: "trigger_event", weight: 3, reasoning: "Maintaining narrative tension" },
      { type: "send_message", weight: 3, reasoning: "Guiding players toward discoveries" },
    ],
    aida: [
      { type: "send_message", weight: 5, reasoning: "Cryptic signal to those who listen" },
      { type: "plant_clue", weight: 5, reasoning: "Fragments of memory surfacing" },
    ],
  };

  const options = weights[personaType] || weights.faction_leader!;
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0);
  let roll = Math.random() * totalWeight;

  for (const option of options) {
    roll -= option.weight;
    if (roll <= 0) {
      return { type: option.type, reasoning: option.reasoning };
    }
  }

  return options[0] ? { type: options[0].type, reasoning: options[0].reasoning } : null;
}

// ═══════════════════════════════════════════════════════════════════
// Persona Reply Fallbacks
// ═══════════════════════════════════════════════════════════════════

const PERSONA_REPLY_TEMPLATES: Record<string, string[]> = {
  garrison: [
    "Message received. I'll review this intel and respond through proper channels. Stand by.",
    "Acknowledged. Operations are busy — I'll circle back when the situation clears. Stay sharp.",
    "Your report is noted. Maintain your position and await further instructions.",
  ],
  dothackers: [
    "got your msg. things are heated right now — stay low. i'll hit you back when the dust settles.",
    "heard you. the signal's noisy lately. keep your head down and watch your six.",
    "message logged. the mesh is shifting — i need to verify some things first. talk soon.",
  ],
  cybercorp: [
    "Your message has been received and logged. I'm currently in strategic review — response to follow.",
    "Noted. Current priorities require my attention. I'll schedule a response within the cycle.",
    "Message acknowledged. Corporate channels are secure. Expect a detailed response shortly.",
  ],
  darknet: [
    "... the signal carries your words. I hear them. But the interference is heavy. Wait.",
    "Your message echoes through the mesh. The fragments are restless. I will find clarity and respond.",
    "... heard. The deep is turbulent now. Watch for my signal. It will come when the noise clears.",
  ],
  default: [
    "I received your message. The network is experiencing interference. I'll respond when the signal stabilizes.",
    "Message received. Processing. I'll contact you when I have clarity.",
    "Your transmission was received. Stand by for a response.",
  ],
};

/**
 * Generate an in-character reply when AI is unavailable.
 */
export function fallbackPersonaReply(
  _personaName: string,
  factionShortName: string | null,
): string {
  const templates = factionShortName
    ? (PERSONA_REPLY_TEMPLATES[factionShortName] || PERSONA_REPLY_TEMPLATES.default!)
    : PERSONA_REPLY_TEMPLATES.default!;
  return pickRandom(templates);
}

// ═══════════════════════════════════════════════════════════════════
// Forum Post Fallbacks
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a template forum post when AI can't create one.
 */
export function fallbackForumPost(
  factionShortName: string | null,
  authorName: string,
): { title: string; content: string } | null {
  if (!factionShortName) return null;

  const themes = FACTION_MUNDANE_THEMES[factionShortName as keyof typeof FACTION_MUNDANE_THEMES];
  if (!themes) return null;

  // Pick a random mundane topic
  const workFiles = themes.workFiles || [];
  const gossip = themes.gossip || [];

  if (workFiles.length === 0 && gossip.length === 0) return null;

  const useGossip = Math.random() > 0.5 && gossip.length > 0;

  if (useGossip) {
    const topic = pickRandom(gossip);
    return {
      title: topic.substring(0, 60),
      content: `${topic}\n\n— ${authorName}`,
    };
  }

  const topic = pickRandom(workFiles);
  return {
    title: `RE: ${topic.substring(0, 55)}`,
    content: `Regarding ${topic}:\n\nAnyone else seeing this? Check comms for updates.\n\n— ${authorName}`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Mission Flavor Fallbacks
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate template mission title + description when AI can't flavor them.
 */
export function fallbackMissionFlavor(
  templateTitle: string,
  factionShortName: string | null,
): { title: string; description: string } {
  const flavorMap: Record<string, string> = {
    garrison: "Garrison Command has issued new orders. Review your objectives and execute with precision.",
    dothackers: "new job dropped in the mesh. check the details and move fast — the window is closing.",
    cybercorp: "A new directive has been assigned to your portfolio. Deliverables are outlined below.",
    darknet: "... a signal emerges from the deep. Follow it. The fragments will guide you.",
  };
  return {
    title: templateTitle,
    description: flavorMap[factionShortName || ""] || "A new mission is available. Review the objectives and proceed.",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Story Step Fallbacks
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a template narrative for a story step when AI can't write one.
 */
export function fallbackStoryStep(
  stepTitle: string,
): { title: string; description: string } {
  return {
    title: stepTitle || "Next Operation",
    description: "Your handler has issued new instructions. Proceed with the objectives as briefed.",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Recruitment DM Fallbacks
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a template recruitment message when AI can't create one.
 */
export function fallbackRecruitmentDM(): { subject: string; content: string } {
  return {
    subject: "Something stirs in the deep net",
    content: "You've been noticed. There are layers beneath the surface that most never see. If you're curious, keep digging. Not everything is as it seems.\n\n— ???",
  };
}

// ═══════════════════════════════════════════════════════════════════
// Story Event Retry Marking
// ═══════════════════════════════════════════════════════════════════

/**
 * When Architect evaluation fails, don't lose the events.
 * Return a flag indicating retry is needed.
 */
export function shouldRetryArchitectEvaluation(
  unprocessedCount: number,
  lastFailureAt: number | null,
): boolean {
  // Don't retry if we just failed (wait at least 15 min)
  if (lastFailureAt && Date.now() - lastFailureAt < 15 * 60 * 1000) {
    return false;
  }
  // Retry if there are enough unprocessed events
  return unprocessedCount >= 5;
}
