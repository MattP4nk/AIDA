/**
 * @file missionObjectiveTypes.ts
 * @description Canonical single source of truth for all mission objective types in AIDA.
 *
 * This module defines every recognized objective type, its tracking hook,
 * required/optional metadata, and helper utilities for validation and
 * player-facing hints.
 *
 * **No DI dependencies** — this is a pure data / utility module that can be
 * imported anywhere in the server without side-effects.
 */

// ---------------------------------------------------------------------------
// Core Types
// ---------------------------------------------------------------------------

/**
 * The two fundamental ways objective progress is measured.
 *
 * - `"count"`   — progress is an incrementing number towards a numeric target.
 * - `"boolean"` — progress is a one-shot flag (done / not-done).
 */
export type ObjectiveProgressType = "count" | "boolean";

/**
 * Full definition of a single objective type, including the integration hook
 * that tracks it and the metadata it expects at mission-creation time.
 */
export interface ObjectiveTypeDefinition {
  /** Unique key identifying this objective type (e.g. `"hack"`, `"steal"`). */
  type: string;

  /** Human-readable description of what the objective asks the player to do. */
  description: string;

  /** Whether progress is tracked as a running count or a boolean flag. */
  progressType: ObjectiveProgressType;

  /**
   * The `MissionIntegrationService` hook method responsible for tracking
   * this objective (e.g. `"onHackComplete"`, `"onFileOperation"`).
   */
  trackedBy: string;

  /**
   * Metadata keys that **must** be present in the objective's `metadata`
   * object for the objective to be considered valid.
   */
  requiredMetadata: string[];

  /**
   * Metadata keys that *may* be present but are not strictly required.
   */
  optionalMetadata?: string[];

  /**
   * An example `target` value, useful for mission templates and tests.
   */
  exampleTarget: number | string | boolean;
}

// ---------------------------------------------------------------------------
// Canonical Objective Types  (27 total — 24 original + 3 network-aware)
// ---------------------------------------------------------------------------

/** All 24 canonical objective types, keyed by their unique type string. */
export const OBJECTIVE_TYPES: Map<string, ObjectiveTypeDefinition> = new Map<
  string,
  ObjectiveTypeDefinition
>([
  // ── Action (tracked by onHackComplete) ──────────────────────────────

  [
    "hack",
    {
      type: "hack",
      description: "Hack any server",
      progressType: "count",
      trackedBy: "onHackComplete",
      requiredMetadata: [],
      exampleTarget: 3,
    },
  ],
  [
    "hack_target",
    {
      type: "hack_target",
      description: "Hack a specific server",
      progressType: "boolean",
      trackedBy: "onHackComplete",
      requiredMetadata: ["serverId"],
      exampleTarget: true,
    },
  ],
  [
    "hack_stealth",
    {
      type: "hack_stealth",
      description: "Hack without detection",
      progressType: "count",
      trackedBy: "onHackComplete",
      requiredMetadata: [],
      exampleTarget: 3,
    },
  ],
  [
    "hack_method",
    {
      type: "hack_method",
      description: "Hack using a specific method",
      progressType: "count",
      trackedBy: "onHackComplete",
      requiredMetadata: ["method"],
      exampleTarget: 2,
    },
  ],
  [
    "gain_access",
    {
      type: "gain_access",
      description: "Gain access level on a server",
      progressType: "boolean",
      trackedBy: "onHackComplete",
      requiredMetadata: ["serverId", "minLevel"],
      exampleTarget: true,
    },
  ],
  [
    "install_backdoor",
    {
      type: "install_backdoor",
      description: "Install a backdoor on a server",
      progressType: "boolean",
      trackedBy: "onHackComplete",
      requiredMetadata: [],
      optionalMetadata: ["serverId"],
      exampleTarget: true,
    },
  ],

  // ── File (tracked by onFileOperation) ───────────────────────────────

  [
    "steal",
    {
      type: "steal",
      description: "Download/read a specific file",
      progressType: "boolean",
      trackedBy: "onFileOperation",
      requiredMetadata: ["fileId"],
      exampleTarget: true,
    },
  ],
  [
    "steal_count",
    {
      type: "steal_count",
      description: "Download multiple files",
      progressType: "count",
      trackedBy: "onFileOperation",
      requiredMetadata: [],
      optionalMetadata: ["serverId"],
      exampleTarget: 5,
    },
  ],
  [
    "upload_file",
    {
      type: "upload_file",
      description: "Upload a file to a server",
      progressType: "boolean",
      trackedBy: "onFileOperation",
      requiredMetadata: ["serverId"],
      exampleTarget: true,
    },
  ],
  [
    "delete_file",
    {
      type: "delete_file",
      description: "Delete a specific file",
      progressType: "boolean",
      trackedBy: "onFileOperation",
      requiredMetadata: ["fileId"],
      optionalMetadata: ["filePattern"],
      exampleTarget: true,
    },
  ],

  // ── Social (tracked by onMessageSent) ───────────────────────────────

  [
    "message",
    {
      type: "message",
      description: "Send messages",
      progressType: "count",
      trackedBy: "onMessageSent",
      requiredMetadata: [],
      exampleTarget: 3,
    },
  ],
  [
    "contact_player",
    {
      type: "contact_player",
      description: "Contact a specific player",
      progressType: "boolean",
      trackedBy: "onMessageSent",
      requiredMetadata: ["recipientId"],
      exampleTarget: true,
    },
  ],

  // ── Forum (tracked by onForumActivity) ──────────────────────────────

  [
    "forum_post",
    {
      type: "forum_post",
      description: "Create forum posts",
      progressType: "count",
      trackedBy: "onForumActivity",
      requiredMetadata: [],
      exampleTarget: 1,
    },
  ],
  [
    "forum_reply",
    {
      type: "forum_reply",
      description: "Reply to a specific thread",
      progressType: "boolean",
      trackedBy: "onForumActivity",
      requiredMetadata: ["threadId"],
      exampleTarget: true,
    },
  ],
  [
    "forum_interaction",
    {
      type: "forum_interaction",
      description: "Any forum activity",
      progressType: "count",
      trackedBy: "onForumActivity",
      requiredMetadata: [],
      exampleTarget: 3,
    },
  ],

  // ── Exploration (tracked by onServerConnect) ────────────────────────

  [
    "explore",
    {
      type: "explore",
      description: "Connect to servers",
      progressType: "count",
      trackedBy: "onServerConnect",
      requiredMetadata: [],
      exampleTarget: 5,
    },
  ],
  [
    "connect_server",
    {
      type: "connect_server",
      description: "Connect to a specific server",
      progressType: "boolean",
      trackedBy: "onServerConnect",
      requiredMetadata: ["serverId"],
      exampleTarget: true,
    },
  ],
  [
    "discover_server_type",
    {
      type: "discover_server_type",
      description: "Discover servers of a type",
      progressType: "count",
      trackedBy: "onServerConnect",
      requiredMetadata: ["serverType"],
      exampleTarget: 2,
    },
  ],

  // ── Progression (tracked by onSkillUpdate / onCreditsTransaction) ───

  [
    "skill_level",
    {
      type: "skill_level",
      description: "Reach a skill level",
      progressType: "count",
      trackedBy: "onSkillUpdate",
      requiredMetadata: ["skill"],
      exampleTarget: 5,
    },
  ],
  [
    "gain_xp",
    {
      type: "gain_xp",
      description: "Gain experience points",
      progressType: "count",
      trackedBy: "onSkillUpdate",
      requiredMetadata: [],
      exampleTarget: 1000,
    },
  ],
  [
    "earn_credits",
    {
      type: "earn_credits",
      description: "Earn credits",
      progressType: "count",
      trackedBy: "onCreditsTransaction",
      requiredMetadata: [],
      exampleTarget: 5000,
    },
  ],
  [
    "spend_credits",
    {
      type: "spend_credits",
      description: "Spend credits",
      progressType: "count",
      trackedBy: "onCreditsTransaction",
      requiredMetadata: [],
      exampleTarget: 2000,
    },
  ],

  // ── Faction (tracked by onFactionEvent) ─────────────────────────────

  [
    "join_faction",
    {
      type: "join_faction",
      description: "Join a specific faction",
      progressType: "boolean",
      trackedBy: "onFactionEvent",
      requiredMetadata: ["factionId"],
      exampleTarget: true,
    },
  ],
  [
    "faction_reputation",
    {
      type: "faction_reputation",
      description: "Gain faction reputation",
      progressType: "count",
      trackedBy: "onFactionEvent",
      requiredMetadata: ["factionId"],
      exampleTarget: 20,
    },
  ],
  [
    "faction_mission",
    {
      type: "faction_mission",
      description: "Complete faction missions",
      progressType: "count",
      trackedBy: "onFactionEvent",
      requiredMetadata: ["factionId"],
      exampleTarget: 3,
    },
  ],

  // ── Network objectives (tracked by onServerConnect) ──
  [
    "infiltrate_network",
    {
      type: "infiltrate_network",
      description: "Reach a server deep inside a specific network",
      progressType: "boolean",
      trackedBy: "onServerConnect",
      requiredMetadata: ["networkId"],
      optionalMetadata: ["targetRole", "minDepth"],
      exampleTarget: true,
    },
  ],
  [
    "trace_connection",
    {
      type: "trace_connection",
      description: "Discover a specific server by following network clues",
      progressType: "boolean",
      trackedBy: "onServerConnect",
      requiredMetadata: ["serverId"],
      exampleTarget: true,
    },
  ],
  [
    "exfiltrate_data",
    {
      type: "exfiltrate_data",
      description: "Read specific files from a deep network server",
      progressType: "boolean",
      trackedBy: "onFileOperation",
      requiredMetadata: ["serverId", "fileId"],
      exampleTarget: true,
    },
  ],

  // ── New Systems Integration (tracked by new hooks) ────────────────

  [
    "download_file",
    {
      type: "download_file",
      description: "Download a file to your home server",
      progressType: "boolean",
      trackedBy: "onFileOperation",
      requiredMetadata: ["fileId"],
      optionalMetadata: ["serverId"],
      exampleTarget: true,
    },
  ],
  [
    "decode_content",
    {
      type: "decode_content",
      description: "Decode encoded content from a file",
      progressType: "boolean",
      trackedBy: "onDecodeSuccess",
      requiredMetadata: ["encoding"],
      optionalMetadata: ["serverId", "fileId"],
      exampleTarget: true,
    },
  ],
  [
    "defend_home",
    {
      type: "defend_home",
      description: "Purchase or upgrade a home defense",
      progressType: "boolean",
      trackedBy: "onDefenseEvent",
      requiredMetadata: ["defenseType"],
      optionalMetadata: ["minLevel"],
      exampleTarget: true,
    },
  ],
  [
    "claim_bounty",
    {
      type: "claim_bounty",
      description: "Claim and complete a bounty",
      progressType: "boolean",
      trackedBy: "onBountyCompleted",
      requiredMetadata: [],
      optionalMetadata: ["targetFactionId"],
      exampleTarget: true,
    },
  ],
  [
    "survive_trace",
    {
      type: "survive_trace",
      description: "Successfully evade a trace",
      progressType: "count",
      trackedBy: "onTraceEvaded",
      requiredMetadata: [],
      exampleTarget: 1,
    },
  ],
  [
    "scan_subnet",
    {
      type: "scan_subnet",
      description: "Use subnet analysis on network ranges",
      progressType: "count",
      trackedBy: "onSubnetUsed",
      requiredMetadata: [],
      optionalMetadata: ["networkZone"],
      exampleTarget: 2,
    },
  ],
]);

// ---------------------------------------------------------------------------
// Reverse-Lookup: Hook → Objective Types
// ---------------------------------------------------------------------------

/**
 * Reverse lookup map from `MissionIntegrationService` hook name to the array
 * of objective type keys it is responsible for tracking.
 *
 * Built automatically from {@link OBJECTIVE_TYPES} so it never drifts out of
 * sync with the canonical list.
 */
export const OBJECTIVE_TYPES_BY_HOOK: Map<string, string[]> = (() => {
  const hookMap = new Map<string, string[]>();
  for (const [key, def] of OBJECTIVE_TYPES) {
    const existing = hookMap.get(def.trackedBy);
    if (existing) {
      existing.push(key);
    } else {
      hookMap.set(def.trackedBy, [key]);
    }
  }
  return hookMap;
})();

// ---------------------------------------------------------------------------
// Category Groupings
// ---------------------------------------------------------------------------

/**
 * Groups objective type keys by high-level gameplay category.
 *
 * Useful for UI grouping, mission-generator weighting, and analytics.
 */
export const MISSION_CATEGORIES: Map<string, string[]> = new Map<
  string,
  string[]
>([
  ["action", ["hack", "hack_target", "hack_stealth", "hack_method", "gain_access", "install_backdoor"]],
  ["file", ["steal", "steal_count", "upload_file", "delete_file"]],
  ["social", ["message", "contact_player"]],
  ["forum", ["forum_post", "forum_reply", "forum_interaction"]],
  ["exploration", ["explore", "connect_server", "discover_server_type"]],
  ["progression", ["skill_level", "gain_xp", "earn_credits", "spend_credits"]],
  ["faction", ["join_faction", "faction_reputation", "faction_mission"]],
  ["network", ["infiltrate_network", "trace_connection", "exfiltrate_data"]],
  ["bonus", ["claim_bounty", "survive_trace", "scan_subnet"]],
  ["defense", ["defend_home", "decode_content", "download_file"]],
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Result returned by {@link validateObjective}. */
export interface ObjectiveValidationResult {
  /** `true` when no validation errors were found. */
  valid: boolean;
  /** Human-readable error strings describing every issue found. */
  errors: string[];
}

/**
 * Validates a mission objective definition against the canonical type
 * registry.
 *
 * Checks performed:
 * 1. The `type` key exists in {@link OBJECTIVE_TYPES}.
 * 2. Every entry in `requiredMetadata` is present in the objective's
 *    `metadata` object.
 * 3. The `target` value's JS type matches the expected `progressType`
 *    (`count` → `number`, `boolean` → `boolean`).
 *
 * @param objective - The objective to validate.
 * @returns A result object containing a `valid` flag and an `errors` array.
 *
 * @example
 * ```ts
 * const result = validateObjective({
 *   type: "hack_target",
 *   target: true,
 *   metadata: { serverId: "srv-001" },
 * });
 * // result.valid === true
 * ```
 */
export const validateObjective = (objective: {
  type: string;
  target: any;
  metadata?: Record<string, any>;
}): ObjectiveValidationResult => {
  const errors: string[] = [];

  // 1. Check the type exists
  const definition = OBJECTIVE_TYPES.get(objective.type);
  if (!definition) {
    errors.push(
      `Unknown objective type "${objective.type}". ` +
        `Valid types: ${[...OBJECTIVE_TYPES.keys()].join(", ")}`,
    );
    // Cannot perform further checks without a definition
    return { valid: false, errors };
  }

  // 2. Check required metadata keys are present
  if (definition.requiredMetadata.length > 0) {
    const meta = objective.metadata ?? {};
    for (const key of definition.requiredMetadata) {
      if (!(key in meta) || meta[key] === undefined || meta[key] === null) {
        errors.push(
          `Missing required metadata key "${key}" for objective type "${objective.type}".`,
        );
      }
    }
  }

  // 3. Check target type matches progressType
  if (definition.progressType === "count") {
    if (typeof objective.target !== "number") {
      errors.push(
        `Objective type "${objective.type}" has progressType "count" but target is ` +
          `${typeof objective.target} (expected number).`,
      );
    }
  } else if (definition.progressType === "boolean") {
    if (typeof objective.target !== "boolean") {
      errors.push(
        `Objective type "${objective.type}" has progressType "boolean" but target is ` +
          `${typeof objective.target} (expected boolean).`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

// ---------------------------------------------------------------------------
// Player-Facing Hints
// ---------------------------------------------------------------------------

/**
 * Static mapping of objective type → player-facing hint text.
 *
 * Every canonical type has an entry; the hints are intentionally short so
 * they fit comfortably in a terminal UI or tooltip.
 */
const OBJECTIVE_HINTS: Record<string, string> = {
  // Action
  hack: "Use 'hack <server>' to attempt hacking a server",
  hack_target: "Use 'hack <server>' on the designated target server",
  hack_stealth:
    "Hack servers without triggering detection — keep your trace level low",
  hack_method:
    "Use the specified hacking method (e.g. 'hack <server> --method brute')",
  gain_access:
    "Hack and escalate privileges on the target server to reach the required access level",

  // File
  steal: "Use 'read <filename>' on a target server to access files",
  steal_count:
    "Download files from servers — use 'read' or 'download' commands",
  upload_file:
    "Use 'upload <filename>' while connected to the target server",
  delete_file:
    "Use 'rm <filename>' or 'delete <filename>' on the target server",

  // Social
  message: "Use 'msg <player> <text>' to send messages to other players",
  contact_player:
    "Send a direct message to the specified player with 'msg <player> <text>'",

  // Forum
  forum_post: "Visit the forum and create a new post with 'forum post'",
  forum_reply:
    "Navigate to the specified forum thread and reply with 'forum reply <threadId>'",
  forum_interaction:
    "Engage with the forums — post, reply, or react to content",

  // Exploration
  explore: "Use 'connect <server_id>' to connect to servers",
  connect_server:
    "Use 'connect <server_id>' to connect to the designated server",
  discover_server_type:
    "Explore the network and connect to servers of the required type",

  // Progression
  skill_level:
    "Practice and use the specified skill to increase your level",
  gain_xp:
    "Complete missions, hack servers, and explore to gain experience points",
  earn_credits:
    "Complete missions, sell items, or trade to earn credits",
  spend_credits:
    "Purchase items from shops or the darknet market to spend credits",

  // Faction
  join_faction:
    "Use 'faction join <factionId>' to join the specified faction",
  faction_reputation:
    "Complete faction tasks and missions to increase your reputation",
  faction_mission:
    "Accept and complete missions issued by the specified faction",

  // Network
  infiltrate_network:
    "Hack through a faction's network — use 'scan' to find connected servers, then 'connect' deeper",
  trace_connection:
    "Follow clues in server files to discover the target — read logs, emails, and configs for IP hints",
  exfiltrate_data:
    "Reach the target server deep in a network and read the specified file",

  // New Systems Integration
  download_file:
    "Use 'download <filename>' on a remote server to copy files to your home ~/downloads/",
  decode_content:
    "Use 'decode <method> <text> [key]' to decrypt encoded content found in files",
  defend_home:
    "Use 'upgrade <defense> <level>' to purchase or upgrade your home server defenses",
  claim_bounty:
    "Use 'bounties' to see active bounties, 'bounty claim <id>' to accept, then hack the target's home server",
  survive_trace:
    "When traced, use 'trace.evade <id>' to successfully evade before time runs out",
  scan_subnet:
    "Use 'subnet <ip/cidr>' to analyze network ranges and discover target addresses",
};

/**
 * Returns a short, player-facing hint explaining how to make progress on the
 * given objective type.
 *
 * @param type - One of the 24 canonical objective type keys.
 * @returns The hint string, or a generic fallback if the type is unrecognised.
 *
 * @example
 * ```ts
 * getObjectiveHint("hack");
 * // => "Use 'hack <server>' to attempt hacking a server"
 * ```
 */
export const getObjectiveHint = (type: string): string => {
  return (
    OBJECTIVE_HINTS[type] ??
    `Complete the "${type}" objective to make progress on this mission`
  );
};
