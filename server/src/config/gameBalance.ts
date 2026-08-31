/**
 * Game Balance Configuration — Skill-Scaled Constants
 *
 * All gameplay-affecting magic numbers centralized here.
 * Many values scale with player skills to reward progression.
 *
 * Naming convention:
 *   BASE_*  = starting value at skill level 0
 *   MIN_*   = floor (skill can't reduce below this)
 *   MAX_*   = ceiling (skill can't increase beyond this)
 *   PER_LEVEL_* = bonus per skill level
 */

// ═══════════════════════════════════════════════════════════════════
// Hacking
// ═══════════════════════════════════════════════════════════════════

/**
 * Which shop item grants each `--tools` keyword.
 *
 * `hack --tools X` previously accepted arbitrary free text with no ownership
 * check and no de-duplication, and `calculateToolBonus` added a bonus per array
 * entry. Repeating one name five times pinned successRate to its 0.95 ceiling
 * and detectionRate to its 0.05 floor — free undetected root while owning
 * nothing. De-duplication alone does NOT close this: the 15 distinct tool
 * keywords sum to roughly +2.0 success bonus, which still maxes the clamp.
 * Ownership is the load-bearing check.
 *
 * Keys are `TOOL_EFFECTIVENESS` entries in hackService; values are
 * `SHOP_CATALOG` ids in shopService. The two vocabularies were never aligned
 * (`passwordcracker` vs `password_cracker`, `zero_day` vs `zero_day_exploit`),
 * which is why a naive name-based lookup would reject even legitimately owned
 * tools.
 *
 * Four tool keywords — `keylogger`, `vpn`, `custom_backdoor`, `anonymizer` —
 * have NO catalog item, so they are deliberately absent and grant no bonus:
 * a tool you cannot buy is a tool you cannot use. Add a catalog item and map it
 * here to bring one into play.
 */
export const HACK_TOOL_ITEMS: Readonly<Record<string, string>> = {
  scanner: "basic_scanner",
  portscanner: "basic_scanner",
  passwordcracker: "password_cracker",
  exploitkit: "exploit_framework",
  rootkit: "rootkit",
  proxychains: "proxy_chains",
  zero_day: "zero_day_exploit",
  advanced_stealth: "stealth_boost",
  encryption_breaker: "quantum_decryptor",
  trace_remover: "trace_scrambler",
  log_cleaner: "log_cleaner",
};

/** Ceilings on aggregate `--tools` bonuses, applied after summing. */
export const MAX_TOOL_SUCCESS_BONUS = 0.3;
export const MAX_TOOL_STEALTH_BONUS = 0.3;

/** Cooldown between hack attempts (seconds). Decreases with hacking skill. */
export const HACK_COOLDOWN_BASE_S = 30;
export const HACK_COOLDOWN_MIN_S = 10;
export const HACK_COOLDOWN_PER_LEVEL_S = 0.3;

export function getHackCooldown(hackingSkill: number): number {
  return Math.max(
    HACK_COOLDOWN_MIN_S,
    HACK_COOLDOWN_BASE_S - hackingSkill * HACK_COOLDOWN_PER_LEVEL_S,
  );
}

/** Detection floor — minimum detection chance regardless of stealth. */
export const DETECTION_FLOOR_PCT = 5;
export const DETECTION_AGGRESSIVE_BONUS_PCT = 30;
export const DETECTION_STEALTH_REDUCTION_PCT = 8;

// ═══════════════════════════════════════════════════════════════════
// Backdoors
// ═══════════════════════════════════════════════════════════════════

/** Backdoor duration (hours). Increases with stealth skill. */
export const BACKDOOR_DURATION_STANDARD_BASE_H = 24;
export const BACKDOOR_DURATION_PERSISTENT_BASE_H = 72;

export const BACKDOOR_DURATION_PER_STEALTH_H = 1;
export const BACKDOOR_DURATION_MAX_STANDARD_H = 48;
export const BACKDOOR_DURATION_MAX_PERSISTENT_H = 168; // 7 days

export function getBackdoorDuration(type: string, stealthSkill: number): number | null {
  switch (type) {
    case "rootkit":
      return null; // permanent
    case "persistent":
      return Math.min(
        BACKDOOR_DURATION_MAX_PERSISTENT_H,
        BACKDOOR_DURATION_PERSISTENT_BASE_H + stealthSkill * BACKDOOR_DURATION_PER_STEALTH_H,
      );
    default: // standard
      return Math.min(
        BACKDOOR_DURATION_MAX_STANDARD_H,
        BACKDOOR_DURATION_STANDARD_BASE_H + stealthSkill * BACKDOOR_DURATION_PER_STEALTH_H,
      );
  }
}

/** Detection risk increment per backdoor use. Decreases with stealth. */
export const BACKDOOR_DETECTION_INCREMENT_BASE = 10;
export const BACKDOOR_DETECTION_INCREMENT_MIN = 3;
export const BACKDOOR_DETECTION_PER_STEALTH = 0.15;

export function getBackdoorDetectionIncrement(stealthSkill: number): number {
  return Math.max(
    BACKDOOR_DETECTION_INCREMENT_MIN,
    BACKDOOR_DETECTION_INCREMENT_BASE - stealthSkill * BACKDOOR_DETECTION_PER_STEALTH,
  );
}

/** Initial detection risk per backdoor type. */
export const BACKDOOR_INITIAL_RISK: Record<string, number> = {
  standard: 20,
  persistent: 15,
  rootkit: 10,
};

/** Discovery threshold — backdoor discovered when risk exceeds this. */
export const BACKDOOR_DISCOVERY_THRESHOLD = 75;

// ═══════════════════════════════════════════════════════════════════
// Traces
// ═══════════════════════════════════════════════════════════════════

/** Trace duration (minutes) based on evidence level. Stealth reduces duration. */
export const TRACE_DURATION_TIERS: { minEvidence: number; baseMins: number }[] = [
  { minEvidence: 85, baseMins: 15 },
  { minEvidence: 70, baseMins: 30 },
  { minEvidence: 50, baseMins: 60 },
  { minEvidence: 0, baseMins: 120 },
];

export function getTraceDuration(evidenceLevel: number, stealthSkill: number): number {
  const tier = TRACE_DURATION_TIERS.find(t => evidenceLevel >= t.minEvidence) || TRACE_DURATION_TIERS[TRACE_DURATION_TIERS.length - 1]!;
  const reduction = Math.floor(stealthSkill * 0.3); // 0.3 min per stealth level
  return Math.max(5, tier.baseMins - reduction); // minimum 5 minutes
}

/** Trace evasion chance. Scales with stealth, decreases with trace progress. */
export function getTraceEvasionChance(stealthSkill: number, traceProgress: number): number {
  const baseChance = (stealthSkill / 100) * 0.7;
  const progressPenalty = (traceProgress / 100) * 0.5;
  return Math.max(0, Math.min(0.95, baseChance - progressPenalty));
}

// ═══════════════════════════════════════════════════════════════════
// Sessions & Resources
// ═══════════════════════════════════════════════════════════════════

/** Session idle timeout (minutes). */
export const SESSION_IDLE_TIMEOUT_MIN = 60;

/** Session lock TTL (ms) — prevents concurrent session creation. */
export const SESSION_LOCK_TTL_MS = 30_000;

/** Max concurrent sessions. */
export const MAX_SESSIONS = 1000;

/** Cleanup interval for idle sessions (ms). */
export const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// Rate Limiting
// ═══════════════════════════════════════════════════════════════════

/** Commands per second per player. */
export const COMMAND_RATE_LIMIT = 10;
export const COMMAND_RATE_WINDOW_MS = 1000;

// ═══════════════════════════════════════════════════════════════════
// AI & Scheduling
// ═══════════════════════════════════════════════════════════════════

/** Architect evaluation interval (ms). */
export const ARCHITECT_EVAL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/** Minimum unprocessed events before Architect evaluates. */
export const ARCHITECT_MIN_EVENTS = 5;

/** AI persona action limits. */
export const AI_ACTIONS_PER_DAY = 3;
export const AI_LEADER_INTERVAL_H = 4;
export const AI_OTHER_INTERVAL_H = 8;

/** Low resource threshold for faction defensive missions. */
export const FACTION_LOW_RESOURCE_THRESHOLD = 50;

// ═══════════════════════════════════════════════════════════════════
// Missions
// ═══════════════════════════════════════════════════════════════════

/** Max active missions per player. */
export const MAX_ACTIVE_MISSIONS = 5;

/** Mission expiration check interval (ms). */
export const MISSION_EXPIRATION_INTERVAL_MS = 15 * 60 * 1000;

/** Daily mission generation count per player. */
export const DAILY_MISSIONS_PER_PLAYER = 3;

// ═══════════════════════════════════════════════════════════════════
// Dungeons
// ═══════════════════════════════════════════════════════════════════

/** DarkNet dungeon TTL (days). */
export const DUNGEON_TTL_DAYS = 7;

/** Dungeon regeneration delay after conquest (ms). */
export const DUNGEON_REGEN_DELAY_MS = 30_000;

/** Dungeon expiration check interval (ms). */
export const DUNGEON_EXPIRATION_INTERVAL_MS = 60 * 60 * 1000;

// ═══════════════════════════════════════════════════════════════════
// Bounties
// ═══════════════════════════════════════════════════════════════════

/** Bounty expiration (hours). */
export const BOUNTY_EXPIRATION_H = 48;

/** Evidence threshold for bounty posting. */
export const BOUNTY_EVIDENCE_THRESHOLD = 81;

/** Bounty reward scaling. */
export const BOUNTY_BASE_CREDITS = 1000;
export const BOUNTY_CREDITS_PER_EVIDENCE = 200;
export const BOUNTY_BASE_REP = 5;

// ═══════════════════════════════════════════════════════════════════
// Reputation
// ═══════════════════════════════════════════════════════════════════

// (An orphaned "Reputation bounds and thresholds" docstring used to sit here,
// above the Connection Challenges banner, documenting the wrong section.)

// ═══════════════════════════════════════════════════════════════════
// Soft Skill Gates
// ═══════════════════════════════════════════════════════════════════

/**
 * Skill requirements are a BASELINE, not a wall.
 *
 * A player below the requirement may still attempt the action, but pays a
 * penalty proportional to how far short they are. This exists because the
 * underlying systems already degrade gracefully with skill — `successRate`,
 * `detectionRate`, minigame layer difficulty and earned access level all scale
 * with it, and `awardExperience` grants XP even on failure. The old hard gate
 * sat on top of that and blocked the one loop that could resolve it: hacking
 * skill is earned BY hacking, so a player at the starting Hacking 10 could
 * never reach the `hack` requirement of 20.
 *
 * Shortfall beyond SKILL_SOFT_BAND is still refused. "Within reach" is the
 * intent — curiosity should not let a Hacking 10 player burn an hour of
 * resources on a rootkit that cannot land.
 */

/** Max points below a requirement at which an attempt is still permitted. */
export const SKILL_SOFT_BAND = 15;

/**
 * Penalty ceilings, reached at the edge of the band (severity 1.0).
 * Severity is `shortfall / SKILL_SOFT_BAND`, so these are the worst case.
 */
export const SKILL_PENALTY = {
  /** successRate multiplier at full shortfall (0.6 → down to 40% of normal). */
  maxSuccessPenalty: 0.6,
  /** Absolute detectionRate added at full shortfall. Fumbling is loud. */
  maxDetectionPenalty: 0.25,
} as const;

/**
 * Severity of a skill shortfall, 0 (met the requirement) to 1 (at the edge of
 * the band). Returns null when the shortfall exceeds the band — caller refuses.
 */
export function getSkillShortfallSeverity(
  required: number,
  current: number,
): number | null {
  const shortfall = Math.max(0, required - current);
  if (shortfall === 0) return 0;
  if (shortfall > SKILL_SOFT_BAND) return null;
  return shortfall / SKILL_SOFT_BAND;
}

// ═══════════════════════════════════════════════════════════════════
// Connection Challenges
// ═══════════════════════════════════════════════════════════════════

/**
 * WHAT `securityLevel` ACTUALLY CHANGES (measured 2026-08-31, U2).
 *
 * Every consumer rounds and then BUCKETS the difficulty, so most single-step
 * changes to a server's securityLevel are invisible to players. Across the
 * whole 1..10 range there are only **6 distinct player-visible configurations**,
 * and these values are strictly indistinguishable from each other:
 *
 *     sec 1 == 2        sec 4 == 5        sec 8 == 9 == 10
 *
 * The real thresholds — the only places a +1 is felt — are:
 *
 *   sec 3  revisits start being challenged (CONNECTION_CHALLENGE_SKIP_THRESHOLD)
 *   sec 4  connection challenge tier easy -> medium
 *   sec 7  connection challenge tier medium -> hard
 *   sec 8  a 4th hack layer appears (assignLayers duplicates the hardest type)
 *
 * Corollary: tuning a server from 1->2 or 4->5 does nothing. Move it across a
 * threshold or don't bother. This is why the seed's Training Firewall 2->1
 * change had no measurable effect.
 *
 * `firewallLevel` is NOT a difficulty knob despite the name: its only consumer
 * is `assignLayers`, where it merely REORDERS the same three layer types. It
 * never adds, removes, or hardens a layer. Treat it as flavour.
 */

/** Security threshold below which revisits skip the challenge. */
export const CONNECTION_CHALLENGE_SKIP_THRESHOLD = 2;

/** Security level above which a backdoor suggestion is shown after challenge success. */
export const BACKDOOR_CHALLENGE_SUGGESTION_THRESHOLD = 3;

/** Handshake challenge settings by difficulty tier. */
export const HANDSHAKE_CONFIG = {
  easy:   { packets: 3, real: 2, decoys: 1, timeLimit: 45, maxAttempts: 3 },
  medium: { packets: 5, real: 3, decoys: 2, timeLimit: 35, maxAttempts: 3 },
  hard:   { packets: 7, real: 4, decoys: 3, timeLimit: 25, maxAttempts: 2 },
} as const;

/** Signal trace grid settings by difficulty tier. */
export const SIGNAL_TRACE_CONFIG = {
  easy:   { rows: 4, cols: 6, hops: 3, noise: 0, timeLimit: 50, maxAttempts: 3 },
  medium: { rows: 5, cols: 8, hops: 4, noise: 1, timeLimit: 40, maxAttempts: 3 },
  hard:   { rows: 6, cols: 10, hops: 5, noise: 2, timeLimit: 30, maxAttempts: 2 },
} as const;

/** Get difficulty tier from numeric difficulty. */
export function getChallengeTier(difficulty: number): "easy" | "medium" | "hard" {
  if (difficulty <= 3) return "easy";
  if (difficulty <= 6) return "medium";
  return "hard";
}

/** Calculate connection challenge difficulty from server security and player networking skill. */
export function getConnectionDifficulty(
  securityLevel: number,
  isFirstVisit: boolean,
  networkingSkill: number,
): number {
  const base = isFirstVisit
    ? Math.max(1, Math.min(8, securityLevel))
    : Math.max(1, securityLevel - 1);
  const reduction = networkingSkill / (isFirstVisit ? 50 : 40);
  return Math.max(1, Math.min(10, Math.round(base - reduction)));
}

/** Factions/zones that get signal_trace instead of handshake. */
export const SIGNAL_TRACE_FACTIONS = new Set(["darknet", "dothackers"]);
export const SIGNAL_TRACE_ZONES = new Set(["underground", "darknet", "hidden"]);

// ═══════════════════════════════════════════════════════════════════
// Special File Triggers (cat command checks these)
// ═══════════════════════════════════════════════════════════════════

/** Filename that triggers DarkNet vault conquest when read. */
export const VAULT_PAYLOAD_FILENAME = "vault_payload.enc";

/** File prefix/suffix that triggers DarkNet discovery check when read. */
export const AIDA_FILE_PREFIX = ".aida";

// ═══════════════════════════════════════════════════════════════════
// Reputation
// ═══════════════════════════════════════════════════════════════════

export const REPUTATION_MIN = -100;
export const REPUTATION_MAX = 100;
export const REPUTATION_ALLIED_THRESHOLD = 30;
export const REPUTATION_HOSTILE_THRESHOLD = -30;
