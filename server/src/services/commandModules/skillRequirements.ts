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
 */

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
  hack: { skill: "hacking", level: 20, label: "Hacking" },
  crack: { skill: "hacking", level: 30, label: "Hacking" },
  exploit: { skill: "hacking", level: 40, label: "Hacking" },
  backdoor: { skill: "hacking", level: 50, label: "Hacking" },
  rootkit: { skill: "hacking", level: 60, label: "Hacking" },

  // ── Minigame layer commands ────────────────────────────────────────
  "crack.submit": { skill: "cryptography", level: 5, label: "Cryptography" },
  "firewall.knock": { skill: "networking", level: 5, label: "Networking" },
  "memory.extract": { skill: "forensics", level: 5, label: "Forensics" },
  // hack.hint, hack.status, hack.abort → ungated (session management)

  // ── Backdoor commands ──────────────────────────────────────────────
  "backdoor.list": { skill: "hacking", level: 15, label: "Hacking" },
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

  // ── File commands ──────────────────────────────────────────────────
  encrypt: { skill: "cryptography", level: 10, label: "Cryptography" },
  decrypt: { skill: "cryptography", level: 15, label: "Cryptography" },
  analyze: { skill: "forensics", level: 10, label: "Forensics" },
  // upload, download → ungated (basic file ops)

  // ── Social commands ────────────────────────────────────────────────
  forum: { skill: "socialEng", level: 5, label: "Social Engineering" },
  proxy: { skill: "networking", level: 10, label: "Networking" },
  // msg, mail, inbox, contact, chat → ungated (basic comms)

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
 * Check whether a player meets the skill requirement for a given command.
 *
 * @param command - The command name (e.g. "hack", "crack.submit")
 * @param args - The command arguments (used for subcommand resolution)
 * @param progress - The player's progress record (must include numeric skill fields)
 * @returns `null` if the player meets the requirement or no requirement exists,
 *          or an object with error details if the player is blocked.
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

  const current = progress[req.skill];
  if (typeof current === "number" && current < req.level) {
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
 * Check whether a player meets the skill requirement for a command,
 * returning just a boolean. Useful for filtering command lists.
 */
export function meetsSkillRequirement(
  command: string,
  args: string[] | undefined,
  progress: Record<string, unknown>,
): boolean {
  return checkSkillRequirement(command, args, progress) === null;
}
