/**
 * skillRequirements.ts — Shared skill-gating map for all command modules
 *
 * Single source of truth for which commands require which skills at what level.
 * Consumed by:
 *   - CommandProcessor.validateSkillRequirements() — blocks execution if skill too low
 *   - HelpCommandsModule.getAvailableCommands() — hides commands the player can't use yet
 *   - Any future UI that needs to show locked/unlocked commands
 *
 * Lookup key conventions:
 *   - Direct command name: "hack", "scan", "encrypt"
 *   - Dot-separated subcommand: "crack.submit", "backdoor.use"
 *   - Colon-separated positional subcommand: "alias:create", "alias:reveal"
 *
 * Requirements are a BASELINE, not a wall — see `SkillRequirement.mode` and the
 * Soft Skill Gates section of gameBalance.ts.
 */

import {
  SKILL_SOFT_BAND,
  getSkillShortfallSeverity,
} from "../../config/gameBalance";

/**
 * A single skill requirement entry.
 *
 * `skill` must be a numeric field on the Prisma PlayerProgress model.
 * `level` is the minimum value (0–100) needed to use the command.
 * `label` is the human-readable name shown in error messages and help text.
 */
export interface SkillRequirement {
  skill: string; // keyof PlayerProgress numeric fields
  level: number;
  label: string;
  /**
   * How the requirement is enforced.
   *
   * - `"hard"` (default): below the level, the command is refused. Correct for
   *   irreversible or structural actions.
   * - `"soft"`: below the level the command still runs, but the caller applies a
   *   penalty scaled by the shortfall (see `getSkillShortfallSeverity`). Beyond
   *   `SKILL_SOFT_BAND` it is refused anyway.
   * - `"unblockable"`: never refused. For commands that ANSWER a challenge the
   *   game itself forced on the player — blocking one soft-locks the session.
   *
   * Default is `"hard"` deliberately: a requirement only becomes soft once a
   * penalty is actually wired at the call site, so adding an entry can never
   * silently reduce difficulty.
   */
  mode?: "hard" | "soft" | "unblockable";
}

/**
 * Master map of command → skill requirement.
 *
 * Commands NOT listed here have no skill gate (they're available to everyone).
 *
 * Skill fields (from PlayerProgress):
 *   hacking, networking, cryptography, stealth, forensics, socialEng
 */
export const SKILL_REQUIREMENTS: Readonly<Record<string, SkillRequirement>> = {
  // ── Hack commands (hacking) ────────────────────────────────────────
  // SOFT: penalties are applied in hackService.calculateHackParameters, on top
  // of skill scaling that already exists there. Attemptable from `level - 15`.
  hack: { skill: "hacking", level: 20, label: "Hacking", mode: "soft" },
  crack: { skill: "hacking", level: 30, label: "Hacking", mode: "soft" },
  exploit: { skill: "hacking", level: 40, label: "Hacking", mode: "soft" },
  backdoor: { skill: "hacking", level: 50, label: "Hacking", mode: "soft" },
  rootkit: { skill: "hacking", level: 60, label: "Hacking", mode: "soft" },

  // ── Minigame layer commands ────────────────────────────────────────
  // UNBLOCKABLE: these submit an answer to a layer the player is already inside.
  // The layer's difficulty was set from their skill when it was generated, so the
  // skill has already been accounted for — refusing the submission would strand
  // them in a session they legitimately started. Starting cryptography and
  // forensics are both exactly 5, so these passed by a single point; that was
  // luck, not safety.
  "crack.submit": { skill: "cryptography", level: 5, label: "Cryptography", mode: "unblockable" },
  "firewall.knock": { skill: "networking", level: 5, label: "Networking", mode: "unblockable" },
  "memory.extract": { skill: "forensics", level: 5, label: "Forensics", mode: "unblockable" },
  // hack.hint, hack.status, hack.abort → ungated (session management)

  // ── File access minigames ─────────────────────────────────────────
  sweep: { skill: "forensics", level: 15, label: "Forensics" },
  "sweep.reveal": { skill: "forensics", level: 15, label: "Forensics" },
  "crack.dict": { skill: "cryptography", level: 20, label: "Cryptography" },
  "crack.mask": { skill: "cryptography", level: 25, label: "Cryptography" },
  "crack.pattern": { skill: "cryptography", level: 20, label: "Cryptography" },
  "crack.protected": { skill: "cryptography", level: 40, label: "Cryptography" },
  "crack.storm": { skill: "cryptography", level: 50, label: "Cryptography" },
  "crack.storm.submit": { skill: "cryptography", level: 5, label: "Cryptography", mode: "unblockable" },
  // Stays HARD on purpose: failure BRICKS the fragment permanently. A soft gate
  // here would let an under-skilled player destroy a unique endgame item, which
  // is not a penalty — it is an unrecoverable loss.
  "fragment.crack": { skill: "hacking", level: 50, label: "Hacking", mode: "hard" },
  "collar.shield": { skill: "stealth", level: 30, label: "Stealth" },
  "key.contact": { skill: "cryptography", level: 20, label: "Cryptography" },

  // ── Backdoor commands ──────────────────────────────────────────────
  // backdoor.list → UNGATED. It lists backdoors the player already installed;
  // a skill check cannot fail meaningfully on your own inventory, and gating it
  // hid assets the player had legitimately earned.
  "backdoor.use": { skill: "stealth", level: 20, label: "Stealth" },
  "backdoor.remove": { skill: "stealth", level: 15, label: "Stealth" },

  // ── Defense ────────────────────────────────────────────────────────
  "security.scan": { skill: "forensics", level: 15, label: "Forensics" },

  // ── Trace commands ─────────────────────────────────────────────────
  // trace.status → ungated (informational)
  "trace.evade": { skill: "stealth", level: 25, label: "Stealth" },

  // ── Network commands ───────────────────────────────────────────────
  scan: { skill: "networking", level: 5, label: "Networking" },
  // servers → ungated (personal inventory of known servers)
  probe: { skill: "networking", level: 10, label: "Networking" },
  traceroute: { skill: "networking", level: 15, label: "Networking" },
  // connect, disconnect → ungated (basic navigation)

  // ── Defense commands ──────────────────────────────────────────────
  // defenses → ungated (informational)
  // upgrade → ungated (purchase gate, not skill gate)
  protect: { skill: "networking", level: 15, label: "Networking" },
  safevault: { skill: "cryptography", level: 20, label: "Cryptography" },
  honeypot: { skill: "stealth", level: 25, label: "Stealth" },

  // ── Math commands ─────────────────────────────────────────────────
  decode: { skill: "cryptography", level: 10, label: "Cryptography" },
  subnet: { skill: "networking", level: 10, label: "Networking" },
  // calc, expr, math, vars, set, unset, convert, random → ungated (basic tools)

  // ── File commands ──────────────────────────────────────────────────
  encrypt: { skill: "cryptography", level: 10, label: "Cryptography" },
  decrypt: { skill: "cryptography", level: 15, label: "Cryptography" },
  analyze: { skill: "forensics", level: 10, label: "Forensics" },
  // upload, download → ungated (basic file ops)

  // ── Social commands ────────────────────────────────────────────────
  forum: { skill: "socialEng", level: 5, label: "Social Engineering" },
  proxy: { skill: "networking", level: 10, label: "Networking" },
  share_intel: { skill: "socialEng", level: 10, label: "Social Engineering" },
  // msg, mail, inbox, contact, chat → ungated (basic comms)

  // ── Fragment / Endgame commands ─────────────────────────────────────
  // fragment / fragments → UNGATED. A fragment is CLAIMED by `cat`-ing the
  // right file, which has no skill gate at all, so a player could hold a
  // fragment at Hacking 10 and then be told they lack the skill to list it.
  // Possession is the real gate here, not skill. `fragment.crack` stays HARD
  // below — that one destroys the fragment on failure.
  endgame: { skill: "hacking", level: 50, label: "Hacking" },

  // ── Connection challenge commands ─────────────────────────────────
  // UNBLOCKABLE, and the most important case: the connection challenge is
  // MANDATORY on the first visit to any non-home server, so refusing the answer
  // strands the player with no way forward and no way to abort into progress.
  "handshake.ack": { skill: "networking", level: 5, label: "Networking", mode: "unblockable" },
  "signal.trace": { skill: "networking", level: 5, label: "Networking", mode: "unblockable" },

  // ── Alias subcommands (key = "alias:<sub>") ────────────────────────
  "alias:create": {
    skill: "socialEng",
    level: 15,
    label: "Social Engineering",
  },
  "alias:reveal": {
    skill: "socialEng",
    level: 20,
    label: "Social Engineering",
  },
  // alias:destroy, alias:info, alias:help → ungated
};

/**
 * Resolve the lookup key for a given command + optional args.
 *
 * Handles three patterns:
 *   1. Direct match:  "hack" → "hack"
 *   2. Dot-command:   "crack.submit" → "crack.submit"  (already the command name)
 *   3. Subcommand:    command="alias", args=["create"] → "alias:create"
 */
export function resolveSkillKey(command: string, args?: string[]): string {
  // Check for colon-separated subcommand match first
  const sub = args?.[0]?.toLowerCase();
  if (sub) {
    const subKey = `${command}:${sub}`;
    if (subKey in SKILL_REQUIREMENTS) {
      return subKey;
    }
  }

  return command;
}

/**
 * How short of a requirement a player is, and how hard that should bite.
 *
 * `severity` is 0 when the requirement is met and rises to 1 at the edge of
 * `SKILL_SOFT_BAND`. Command modules multiply their own penalty channels by it.
 */
export interface SkillShortfall {
  skillName: string;
  requiredSkill: number;
  currentSkill: number;
  shortfall: number;
  severity: number;
}

/**
 * Shortfall for a command the player is ALLOWED to run (soft gate, under-skilled).
 *
 * Returns null when the requirement is met, when there is no gate, or when the
 * gate is not soft — i.e. null means "apply no penalty", never "blocked".
 * Blocking is `checkSkillRequirement`'s job; call that first.
 */
export function getSkillShortfall(
  command: string,
  args: string[] | undefined,
  progress: Record<string, unknown>,
): SkillShortfall | null {
  const req = SKILL_REQUIREMENTS[resolveSkillKey(command, args)];
  if (!req || req.mode !== "soft") return null;

  const current = progress[req.skill];
  if (typeof current !== "number" || current >= req.level) return null;

  const severity = getSkillShortfallSeverity(req.level, current);
  if (severity === null || severity === 0) return null;

  return {
    skillName: req.label,
    requiredSkill: req.level,
    currentSkill: current,
    shortfall: req.level - current,
    severity,
  };
}

/**
 * Check whether a player may run a command at all.
 *
 * @param command - The command name (e.g. "hack", "crack.submit")
 * @param args - The command arguments (used for subcommand resolution)
 * @param progress - The player's progress record (must include numeric skill fields)
 * @returns `null` if the command is permitted — which now includes the
 *          under-skilled-but-within-band case for `soft` gates, where the caller
 *          is expected to consult `getSkillShortfall` and apply a penalty.
 *          Otherwise an object with error details.
 */
export function checkSkillRequirement(
  command: string,
  args: string[] | undefined,
  progress: Record<string, unknown>,
): {
  error: string;
  requiredSkill: number;
  currentSkill: number;
  skillName: string;
} | null {
  const key = resolveSkillKey(command, args);
  const req = SKILL_REQUIREMENTS[key];

  if (!req) {
    return null; // No skill gate for this command
  }

  // Answering a challenge the game forced on the player is never refused.
  if (req.mode === "unblockable") {
    return null;
  }

  const current = progress[req.skill];
  if (typeof current === "number" && current < req.level) {
    // Soft gate: permit the attempt while the shortfall is within the band, and
    // say so plainly. The penalty is applied by the command itself.
    if (req.mode === "soft") {
      const severity = getSkillShortfallSeverity(req.level, current);
      if (severity !== null) {
        return null;
      }
      return {
        error:
          `${req.label} ${current} is too far below the ${req.level} this needs. ` +
          `You can attempt it from ${req.level - SKILL_SOFT_BAND}, at a penalty.`,
        requiredSkill: req.level,
        currentSkill: current,
        skillName: req.label,
      };
    }

    return {
      error: `Insufficient ${req.label} skill. Required: ${req.level}, Current: ${current}`,
      requiredSkill: req.level,
      currentSkill: current,
      skillName: req.label,
    };
  }

  return null; // Requirement met
}

/**
 * Does the player FULLY meet the requirement (no shortfall at all)?
 *
 * Distinct from `meetsSkillRequirement`, which is now true for a soft gate the
 * player is under-skilled for but allowed to attempt. Help/discovery listings
 * want this stricter form so a command is not advertised as mastered.
 */
export function fullyMeetsSkillRequirement(
  command: string,
  args: string[] | undefined,
  progress: Record<string, unknown>,
): boolean {
  const req = SKILL_REQUIREMENTS[resolveSkillKey(command, args)];
  if (!req) return true;
  const current = progress[req.skill];
  return typeof current !== "number" || current >= req.level;
}

/**
 * Check whether a player may RUN a command, returning just a boolean.
 * Useful for filtering command lists.
 *
 * NOTE: for a `soft` gate this is true while the player is within the band but
 * under-skilled. Use `fullyMeetsSkillRequirement` when you mean "has the skill".
 */
export function meetsSkillRequirement(
  command: string,
  args: string[] | undefined,
  progress: Record<string, unknown>,
): boolean {
  return checkSkillRequirement(command, args, progress) === null;
}
