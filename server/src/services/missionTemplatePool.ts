/**
 * missionTemplatePool.ts — Tiered Mission Template Pool
 *
 * Replaces the original 11 hardcoded templates with a structured pool of 29
 * templates distributed across 5 difficulty tiers. Each template references
 * canonical objective types (validated at generation time against the vocabulary
 * defined in missionObjectiveTypes.ts).
 *
 * Architecture:
 *   Tier 1 — Script Kiddie  (Levels 1–5,   Difficulty 1–2,  5 templates)
 *   Tier 2 — Apprentice      (Levels 5–15,  Difficulty 2–4,  6 templates)
 *   Tier 3 — Operator         (Levels 15–30, Difficulty 4–6,  6 templates)
 *   Tier 4 — Elite            (Levels 30–50, Difficulty 6–8,  6 templates)
 *   Tier 5 — Ghost            (Levels 50+,   Difficulty 8–10, 6 templates)
 *
 * Exported helpers allow efficient lookup by tier, faction affinity, player
 * level eligibility, and weighted random selection.
 */

// ────────────────────────────────────────────────────────────────────────────
// Interfaces
// ────────────────────────────────────────────────────────────────────────────

/**
 * A single objective within a mission template.
 *
 * `type` must correspond to a canonical objective type (e.g. "hack",
 * "steal_count", "hack_stealth"). Validation against the canonical
 * vocabulary happens at generation time, not here.
 */
export interface ObjectiveTemplate {
  /** Canonical objective type identifier. */
  type: string;
  /** Human-readable description with {placeholders} filled at generation. */
  descriptionTemplate: string;
  /** Goal value — a numeric target or boolean flag. */
  target: number | boolean;
  /** Optional metadata populated with real IDs at generation time. */
  metadata?: Record<string, any>;
  /** If true this is a bonus objective — failure doesn't fail the mission. */
  isBonus?: boolean;
}

/**
 * Reward scaling formula.
 *
 * Final reward = base + (perLevel × playerLevel) at generation time,
 * with optional fixed bonuses for reputation, skill points, items,
 * and feature unlocks.
 */
export interface RewardScaling {
  xp: { base: number; perLevel: number };
  credits: { base: number; perLevel: number };
  /** Fixed reputation reward. */
  reputation?: number;
  /** Fixed skill point reward. */
  skillPoints?: number;
  /** Item IDs awarded on completion. */
  items?: string[];
  /** Feature / content unlock keys. */
  unlocks?: string[];
}

/**
 * A complete mission template that can be instantiated into a live mission.
 */
export interface MissionTemplate {
  /** Unique template identifier (snake_case). */
  id: string;
  /** Human-readable template name. */
  name: string;
  /** Difficulty tier (1–5). */
  tier: 1 | 2 | 3 | 4 | 5;
  /** Primary mission archetype. */
  type: "hack" | "steal" | "social" | "explore" | "mixed";
  /** Minimum player level to receive this mission. */
  minLevel: number;
  /** Maximum player level to receive this mission. */
  maxLevel: number;
  /** Difficulty range — the generator picks a value within this range. */
  difficulty: { min: number; max: number };
  /** Title options — one is chosen at random during generation. */
  titleTemplates: string[];
  /** Description options — one is chosen at random during generation. */
  descriptionTemplates: string[];
  /** Ordered list of objectives the player must complete. */
  objectives: ObjectiveTemplate[];
  /** Scaling reward formula. */
  rewards: RewardScaling;
  /** Time limit range in seconds — the generator picks within this range. */
  timeLimit: { min: number; max: number };
  /** Searchable tags for filtering and categorisation. */
  tags: string[];
  /** Factions that are more likely to issue this mission. */
  factionAffinity?: string[];
  /** Template IDs that should be completed before this one is offered. */
  prerequisites?: string[];
}

/**
 * Metadata for a single difficulty tier.
 */
export interface TierDefinition {
  tier: 1 | 2 | 3 | 4 | 5;
  name: string;
  levelRange: { min: number; max: number };
  difficultyRange: { min: number; max: number };
  /** Whether stealth behaviour is expected/required at this tier. */
  stealthRequired: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Tier Definitions
// ────────────────────────────────────────────────────────────────────────────

export const TIER_DEFINITIONS: TierDefinition[] = [
  {
    tier: 1,
    name: "Script Kiddie",
    levelRange: { min: 1, max: 5 },
    difficultyRange: { min: 1, max: 2 },
    stealthRequired: false,
  },
  {
    tier: 2,
    name: "Apprentice",
    levelRange: { min: 5, max: 15 },
    difficultyRange: { min: 2, max: 4 },
    stealthRequired: false,
  },
  {
    tier: 3,
    name: "Operator",
    levelRange: { min: 15, max: 30 },
    difficultyRange: { min: 4, max: 6 },
    stealthRequired: false,
  },
  {
    tier: 4,
    name: "Elite",
    levelRange: { min: 30, max: 50 },
    difficultyRange: { min: 6, max: 8 },
    stealthRequired: true,
  },
  {
    tier: 5,
    name: "Ghost",
    levelRange: { min: 50, max: 100 },
    difficultyRange: { min: 8, max: 10 },
    stealthRequired: true,
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Template Definitions
// ────────────────────────────────────────────────────────────────────────────

const templates: MissionTemplate[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // TIER 1 — Script Kiddie (Levels 1–5, Difficulty 1–2)
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1. first_blood ─────────────────────────────────────────────────────
  {
    id: "first_blood",
    name: "Hack your first server",
    tier: 1,
    type: "hack",
    minLevel: 1,
    maxLevel: 5,
    difficulty: { min: 1, max: 2 },
    titleTemplates: [
      "First Blood",
      "Baptism by Firewall",
      "Welcome to the Grid",
    ],
    descriptionTemplates: [
      "Every legend starts somewhere. Break into your first server and leave your mark on the Grid.",
      "The underground is watching. Prove you belong by hacking your first target.",
      "Boot up your tools and crack open a server — consider this your entrance exam.",
    ],
    objectives: [
      {
        type: "hack",
        descriptionTemplate: "Successfully hack into {target} server",
        target: 1,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Bonus: hack without triggering any alarms",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 50, perLevel: 10 },
      credits: { base: 100, perLevel: 25 },
    },
    timeLimit: { min: 3600, max: 7200 }, // 1–2 hours
    tags: ["tutorial", "beginner"],
  },

  // ── 2. neighborhood_watch ──────────────────────────────────────────────
  {
    id: "neighborhood_watch",
    name: "Explore the local network",
    tier: 1,
    type: "explore",
    minLevel: 1,
    maxLevel: 5,
    difficulty: { min: 1, max: 2 },
    titleTemplates: [
      "Neighborhood Watch",
      "Network Recon",
      "Digital Cartography",
    ],
    descriptionTemplates: [
      "Map out the local network. Discover what's hiding in the nodes around you.",
      "Before you can own the Grid you need to know it. Explore {target} nearby servers.",
      "A good hacker always does recon first. Scout the neighborhood and catalog what you find.",
    ],
    objectives: [
      {
        type: "explore",
        descriptionTemplate: "Explore {target} servers on the local network",
        target: 3,
      },
      {
        type: "steal_count",
        descriptionTemplate:
          "Bonus: read {target} file from a server you visit",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 75, perLevel: 10 },
      credits: { base: 150, perLevel: 30 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["exploration", "beginner"],
  },

  // ── 3. message_runner ──────────────────────────────────────────────────
  {
    id: "message_runner",
    name: "Send a message to a contact",
    tier: 1,
    type: "social",
    minLevel: 1,
    maxLevel: 5,
    difficulty: { min: 1, max: 2 },
    titleTemplates: ["Message Runner", "Word on the Wire", "Relay Point"],
    descriptionTemplates: [
      "Get the word out. Deliver {target} messages to your contacts on the network.",
      "Communication keeps the underground alive. Relay {target} messages for your handler.",
      "Run point on a message chain — {target} drops, no questions asked.",
    ],
    objectives: [
      {
        type: "message",
        descriptionTemplate: "Send {target} messages to contacts",
        target: 2,
      },
      {
        type: "forum_post",
        descriptionTemplate: "Bonus: post a message on the forum",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 40, perLevel: 8 },
      credits: { base: 80, perLevel: 20 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["social", "beginner"],
  },

  // ── 4. petty_theft ─────────────────────────────────────────────────────
  {
    id: "petty_theft",
    name: "Read files from a server",
    tier: 1,
    type: "steal",
    minLevel: 1,
    maxLevel: 5,
    difficulty: { min: 1, max: 2 },
    titleTemplates: [
      "Petty Theft",
      "Data Dumpster Diving",
      "Low-Hanging Fruit",
    ],
    descriptionTemplates: [
      "Grab some low-value data to practice your exfiltration skills. Read {target} files from any server.",
      "There's data sitting in the open if you know where to look. Snag {target} files.",
      "Start small. Pull {target} files from a poorly-secured server and see what you find.",
    ],
    objectives: [
      {
        type: "steal_count",
        descriptionTemplate: "Read {target} files from servers",
        target: 2,
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download a stolen file to your home server",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 60, perLevel: 12 },
      credits: { base: 200, perLevel: 40 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["theft", "beginner"],
  },

  // ── 5. credit_hustle ───────────────────────────────────────────────────
  {
    id: "credit_hustle",
    name: "Earn some starter credits",
    tier: 1,
    type: "mixed",
    minLevel: 1,
    maxLevel: 5,
    difficulty: { min: 1, max: 2 },
    titleTemplates: ["Credit Hustle", "Making Ends Meet", "First Paycheck"],
    descriptionTemplates: [
      "Credits make the Grid go round. Earn {target} credits by any means necessary.",
      "Build up a war chest. Hustle, hack, or trade your way to {target} credits.",
      "Nothing's free in the underground. Stack {target} credits to fund your next move.",
    ],
    objectives: [
      {
        type: "earn_credits",
        descriptionTemplate: "Earn {target} credits",
        target: 1000,
      },
      {
        type: "spend_credits",
        descriptionTemplate: "Bonus: spend 500 credits on equipment",
        target: 500,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 100, perLevel: 15 },
      credits: { base: 50, perLevel: 10 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["economic", "beginner"],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 2 — Apprentice (Levels 5–15, Difficulty 2–4)
  // ══════════════════════════════════════════════════════════════════════════

  // ── 6. silent_entry ────────────────────────────────────────────────────
  {
    id: "silent_entry",
    name: "Hack servers without detection",
    tier: 2,
    type: "hack",
    minLevel: 5,
    maxLevel: 15,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Silent Entry", "Ghost in the Machine", "Under the Radar"],
    descriptionTemplates: [
      "Brute force is for amateurs. Break into {target} servers without tripping a single alarm.",
      "Stealth is the mark of a real operator. Hack {target} servers undetected.",
      "Move like a shadow. Access {target} systems and leave no trace behind.",
    ],
    objectives: [
      {
        type: "hack_stealth",
        descriptionTemplate: "Hack {target} servers without being detected",
        target: 2,
      },
      {
        type: "install_backdoor",
        descriptionTemplate:
          "Bonus: install a backdoor on one of the servers for future access",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 200, perLevel: 20 },
      credits: { base: 500, perLevel: 50 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["stealth", "intermediate"],
  },

  // ── 7. data_heist ─────────────────────────────────────────────────────
  {
    id: "data_heist",
    name: "Steal multiple files",
    tier: 2,
    type: "steal",
    minLevel: 5,
    maxLevel: 15,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Data Heist", "Corporate Raid", "Information Extraction"],
    descriptionTemplates: [
      "A client needs data — lots of it. Exfiltrate {target} files from corporate servers.",
      "Information is currency. Steal {target} files and deliver them to your handler.",
      "Pull off a clean heist: {target} files extracted, zero complications.",
    ],
    objectives: [
      {
        type: "steal_count",
        descriptionTemplate: "Steal {target} files from servers",
        target: 4,
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download at least one file to your home server",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 250, perLevel: 25 },
      credits: { base: 600, perLevel: 60 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["theft", "intermediate"],
  },

  // ── 8. network_sweep ──────────────────────────────────────────────────
  {
    id: "network_sweep",
    name: "Discover different server types",
    tier: 2,
    type: "explore",
    minLevel: 5,
    maxLevel: 15,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Network Sweep", "Topology Mapping", "Grid Survey"],
    descriptionTemplates: [
      "Map the network topology. Explore {target} servers and identify corporate infrastructure.",
      "We need eyes on the Grid. Survey {target} nodes and flag any corporate server types.",
      "Run a full sweep: visit {target} servers and catalog the network's corporate assets.",
    ],
    objectives: [
      {
        type: "explore",
        descriptionTemplate: "Explore {target} servers",
        target: 5,
      },
      {
        type: "discover_server_type",
        descriptionTemplate: "Discover {target} corporate server types",
        target: 2,
        metadata: { serverType: "corporate" },
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode an encoded file found during your sweep",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 300, perLevel: 20 },
      credits: { base: 400, perLevel: 40 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["exploration", "intermediate"],
  },

  // ── 9. forum_operative ────────────────────────────────────────────────
  {
    id: "forum_operative",
    name: "Establish forum presence",
    tier: 2,
    type: "social",
    minLevel: 5,
    maxLevel: 15,
    difficulty: { min: 2, max: 4 },
    titleTemplates: [
      "Forum Operative",
      "Voice of the Underground",
      "Digital Footprint",
    ],
    descriptionTemplates: [
      "Build your reputation on the forums. Post {target} threads and interact with the community.",
      "The underground needs to know your name. Create {target} forum posts and spark conversation.",
      "Become a voice. Establish a forum presence with {target} posts and meaningful interactions.",
    ],
    objectives: [
      {
        type: "forum_post",
        descriptionTemplate: "Create {target} forum posts",
        target: 2,
      },
      {
        type: "forum_interaction",
        descriptionTemplate: "Interact with {target} forum threads",
        target: 4,
      },
      {
        type: "message",
        descriptionTemplate:
          "Bonus: send a direct message to {target} other players",
        target: 2,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 200, perLevel: 15 },
      credits: { base: 300, perLevel: 30 },
      reputation: 5,
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["social", "forum", "intermediate"],
  },

  // ── 10. faction_recruit ───────────────────────────────────────────────
  {
    id: "faction_recruit",
    name: "Join and prove yourself to a faction",
    tier: 2,
    type: "mixed",
    minLevel: 5,
    maxLevel: 15,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Faction Recruit", "Proving Ground", "Loyalty Test"],
    descriptionTemplates: [
      "Factions run the Grid. Join one and earn enough reputation to prove your loyalty.",
      "Pick a side and make yourself useful. Reach {target} reputation with your chosen faction.",
      "The underground doesn't trust outsiders. Join a faction and earn your place.",
    ],
    objectives: [
      {
        type: "join_faction",
        descriptionTemplate: "Join a faction",
        target: true,
      },
      {
        type: "faction_reputation",
        descriptionTemplate: "Reach {target} reputation with your faction",
        target: 10,
      },
      {
        type: "hack",
        descriptionTemplate:
          "Bonus: hack {target} server to prove your worth to the faction",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 350, perLevel: 25 },
      credits: { base: 500, perLevel: 50 },
      reputation: 10,
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["faction", "intermediate"],
    factionAffinity: ["garrison", "dothackers", "cybercorp", "darknet"],
  },

  // ── 11. xp_grinder ───────────────────────────────────────────────────
  {
    id: "xp_grinder",
    name: "Build your skills",
    tier: 2,
    type: "mixed",
    minLevel: 5,
    maxLevel: 15,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Skill Sharpening", "Training Montage", "Level Up"],
    descriptionTemplates: [
      "Experience is the best teacher. Earn {target} XP through any activities on the Grid.",
      "Sharpen your edge. Accumulate {target} XP and unlock your potential.",
      "Grind it out. Hit {target} XP and you'll be ready for what comes next.",
    ],
    objectives: [
      {
        type: "gain_xp",
        descriptionTemplate: "Earn {target} XP",
        target: 2000,
      },
      {
        type: "hack",
        descriptionTemplate:
          "Bonus: hack {target} server to put those skills to work",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 150, perLevel: 20 },
      credits: { base: 400, perLevel: 40 },
      skillPoints: 1,
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["progression", "intermediate"],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 3 — Operator (Levels 15–30, Difficulty 4–6)
  // ══════════════════════════════════════════════════════════════════════════

  // ── 12. clean_sweep ───────────────────────────────────────────────────
  {
    id: "clean_sweep",
    name: "Multi-server hack operation",
    tier: 3,
    type: "hack",
    minLevel: 15,
    maxLevel: 30,
    difficulty: { min: 4, max: 6 },
    titleTemplates: ["Clean Sweep", "Zero Footprint", "Scorched Logs"],
    descriptionTemplates: [
      "Hit multiple targets and erase the evidence. Hack {target} servers, stay silent on at least 2, and wipe the logs.",
      "Run a clean multi-server op: breach, extract, and sanitise. Leave nothing behind.",
      "Coordinate a sweep across several nodes. Stealth on 2, and delete every log file you touch.",
    ],
    objectives: [
      {
        type: "hack",
        descriptionTemplate: "Hack {target} servers",
        target: 4,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Hack {target} servers without detection",
        target: 2,
      },
      {
        type: "delete_file",
        descriptionTemplate: "Delete log files to cover your tracks",
        target: true,
        metadata: { filePattern: "logs" },
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download evidence files before wiping them",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 600, perLevel: 30 },
      credits: { base: 2000, perLevel: 100 },
      reputation: 10,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 5400, max: 10800 }, // 1.5–3 hours
    tags: ["stealth", "cleanup", "advanced"],
  },

  // ── 13. chain_reaction ────────────────────────────────────────────────
  {
    id: "chain_reaction",
    name: "Multi-step infiltration",
    tier: 3,
    type: "mixed",
    minLevel: 15,
    maxLevel: 30,
    difficulty: { min: 4, max: 6 },
    titleTemplates: ["Chain Reaction", "Domino Protocol", "Cascading Access"],
    descriptionTemplates: [
      "One breach leads to the next. Connect, hack, and exfiltrate in a single chain.",
      "Execute a cascading infiltration — establish a connection, compromise the target, and steal the payload.",
      "Dominos, not dynamite. Chain your access through a relay, pop the target, and grab the data.",
    ],
    objectives: [
      {
        type: "connect_server",
        descriptionTemplate: "Connect to the relay server",
        target: true,
      },
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
      },
      {
        type: "steal",
        descriptionTemplate: "Steal the target data",
        target: true,
      },
      {
        type: "install_backdoor",
        descriptionTemplate: "Bonus: install a backdoor for persistent access",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 800, perLevel: 35 },
      credits: { base: 2500, perLevel: 120 },
      reputation: 12,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 5400, max: 10800 },
    tags: ["multi-step", "advanced"],
  },

  // ── 14. dead_drop ─────────────────────────────────────────────────────
  {
    id: "dead_drop",
    name: "Steal and upload intel",
    tier: 3,
    type: "steal",
    minLevel: 15,
    maxLevel: 30,
    difficulty: { min: 4, max: 6 },
    titleTemplates: ["Dead Drop", "Information Exchange", "Courier Run"],
    descriptionTemplates: [
      "Grab the intel and leave it at the dead drop. Steal the file, then upload it to the drop server.",
      "Classic tradecraft: exfiltrate the payload and deliver it to the designated relay.",
      "Intercept the data and courier it to a secure drop point. Clean and simple.",
    ],
    objectives: [
      {
        type: "steal",
        descriptionTemplate: "Steal the target file",
        target: true,
      },
      {
        type: "upload_file",
        descriptionTemplate: "Upload the file to the drop server",
        target: true,
        metadata: { serverId: "drop_server" },
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode the file's contents to extract hidden intel",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 700, perLevel: 30 },
      credits: { base: 2000, perLevel: 100 },
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 5400, max: 10800 },
    tags: ["theft", "tradecraft", "advanced"],
  },

  // ── 15. reputation_play ───────────────────────────────────────────────
  {
    id: "reputation_play",
    name: "Build faction standing",
    tier: 3,
    type: "mixed",
    minLevel: 15,
    maxLevel: 30,
    difficulty: { min: 4, max: 6 },
    titleTemplates: ["Reputation Play", "Standing Order", "Climbing the Ranks"],
    descriptionTemplates: [
      "Your faction needs operators who deliver. Reach {target} rep and complete 2 faction missions.",
      "Climb the ladder. Build your standing to {target} and prove it with faction ops.",
      "Reputation is everything. Hit {target} with your faction and knock out 2 missions for them.",
    ],
    objectives: [
      {
        type: "faction_reputation",
        descriptionTemplate: "Reach {target} reputation with your faction",
        target: 25,
      },
      {
        type: "faction_mission",
        descriptionTemplate: "Complete {target} faction missions",
        target: 2,
      },
      {
        type: "hack",
        descriptionTemplate:
          "Bonus: hack {target} rival faction server to intimidate the competition",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 500, perLevel: 25 },
      credits: { base: 1500, perLevel: 80 },
      reputation: 15,
      skillPoints: 1,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 7200, max: 14400 }, // 2–4 hours
    tags: ["faction", "advanced"],
  },

  // ── 16. intel_gathering ───────────────────────────────────────────────
  {
    id: "intel_gathering",
    name: "Recon on rival servers",
    tier: 3,
    type: "explore",
    minLevel: 15,
    maxLevel: 30,
    difficulty: { min: 4, max: 6 },
    titleTemplates: ["Intel Gathering", "Reconnaissance Op", "Eyes on Target"],
    descriptionTemplates: [
      "We need intelligence. Explore {target} servers, establish a connection, and exfiltrate 3 files.",
      "Run recon on rival infrastructure. Map 5 nodes, connect to a target, and grab 3 files.",
      "Full reconnaissance sweep: explore, connect, and exfiltrate. Bring back everything you find.",
    ],
    objectives: [
      {
        type: "explore",
        descriptionTemplate: "Explore {target} servers",
        target: 5,
      },
      {
        type: "connect_server",
        descriptionTemplate: "Connect to a target server",
        target: true,
      },
      {
        type: "steal_count",
        descriptionTemplate: "Steal {target} files",
        target: 3,
      },
      {
        type: "decode_content",
        descriptionTemplate: "Bonus: decode an encoded file found during recon",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 650, perLevel: 30 },
      credits: { base: 1800, perLevel: 90 },
      reputation: 8,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 5400, max: 10800 },
    tags: ["recon", "exploration", "advanced"],
  },

  // ── 17. credit_empire ─────────────────────────────────────────────────
  {
    id: "credit_empire",
    name: "Economic warfare",
    tier: 3,
    type: "mixed",
    minLevel: 15,
    maxLevel: 30,
    difficulty: { min: 4, max: 6 },
    titleTemplates: [
      "Credit Empire",
      "Market Manipulation",
      "Economic Warfare",
    ],
    descriptionTemplates: [
      "Money moves the Grid. Earn {target} credits and reinvest 5,000 to destabilise the market.",
      "Build an economic empire: accumulate {target} credits, then burn 5,000 to shake the market.",
      "Wage financial war. Stack {target} credits and spend 5,000 to manipulate the economy.",
    ],
    objectives: [
      {
        type: "earn_credits",
        descriptionTemplate: "Earn {target} credits",
        target: 10000,
      },
      {
        type: "spend_credits",
        descriptionTemplate: "Spend {target} credits strategically",
        target: 5000,
      },
      {
        type: "contact_player",
        descriptionTemplate:
          "Bonus: make a business contact with another player",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 500, perLevel: 25 },
      credits: { base: 1000, perLevel: 50 },
      reputation: 8,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 7200, max: 14400 },
    tags: ["economic", "advanced"],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 4 — Elite (Levels 30–50, Difficulty 6–8)
  // ══════════════════════════════════════════════════════════════════════════

  // ── 18. persistent_access ─────────────────────────────────────────────
  {
    id: "persistent_access",
    name: "Install backdoor and maintain access",
    tier: 4,
    type: "hack",
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: [
      "Persistent Access",
      "Permanent Foothold",
      "Root Authority",
    ],
    descriptionTemplates: [
      "Compromise the target and dig in. Hack it, establish level-3 access, and stay invisible.",
      "This isn't a smash-and-grab — it's an occupation. Root the target and hold it silently.",
      "Plant a permanent foothold. Hack, escalate to level 3, and maintain stealth across 3 operations.",
    ],
    objectives: [
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
      },
      {
        type: "gain_access",
        descriptionTemplate: "Gain level 3+ access on the target",
        target: true,
        metadata: { minLevel: 3 },
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 3,
      },
      {
        type: "hack_method",
        descriptionTemplate:
          "Bonus: install a rootkit for deep system persistence",
        target: 1,
        metadata: { method: "rootkit" },
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 1500, perLevel: 40 },
      credits: { base: 5000, perLevel: 200 },
      reputation: 20,
      skillPoints: 2,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 7200, max: 14400 }, // 2–4 hours
    tags: ["backdoor", "stealth", "elite"],
  },

  // ── 19. ghost_protocol ────────────────────────────────────────────────
  {
    id: "ghost_protocol",
    name: "Complete mission with zero detection",
    tier: 4,
    type: "mixed",
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: ["Ghost Protocol", "Phantom Operation", "Invisible Hand"],
    descriptionTemplates: [
      "You were never here. Connect, steal, hack 3 targets silently, and wipe every log.",
      "Full ghost protocol: infiltrate, exfiltrate, and sanitise. Zero detection tolerance.",
      "Execute a phantom op — relay in, grab the payload, stealth 3 hacks, and burn the logs.",
    ],
    objectives: [
      {
        type: "connect_server",
        descriptionTemplate: "Connect to the target network",
        target: true,
      },
      {
        type: "steal",
        descriptionTemplate: "Steal the target data",
        target: true,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 3,
      },
      {
        type: "delete_file",
        descriptionTemplate: "Delete all log files",
        target: true,
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download the stolen data to your home server for safekeeping",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 2000, perLevel: 45 },
      credits: { base: 6000, perLevel: 250 },
      reputation: 25,
      skillPoints: 2,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 7200, max: 14400 },
    tags: ["stealth", "multi-objective", "elite"],
  },

  // ── 20. resource_war ──────────────────────────────────────────────────
  {
    id: "resource_war",
    name: "Faction territory operations",
    tier: 4,
    type: "mixed",
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: ["Resource War", "Territory Dispute", "Faction Offensive"],
    descriptionTemplates: [
      "Your faction is expanding. Hack 3 rival servers, build rep to 30, and bankroll the operation with 15k credits.",
      "War costs money and blood. Breach 3 targets, hit 30 rep, and fund the campaign with 15,000 credits.",
      "Territory doesn't conquer itself. Launch an offensive: 3 hacks, 30 rep, 15k credits on the table.",
    ],
    objectives: [
      {
        type: "hack",
        descriptionTemplate: "Hack {target} rival servers",
        target: 3,
      },
      {
        type: "faction_reputation",
        descriptionTemplate: "Reach {target} faction reputation",
        target: 30,
      },
      {
        type: "earn_credits",
        descriptionTemplate: "Earn {target} credits for the war effort",
        target: 15000,
      },
      {
        type: "install_backdoor",
        descriptionTemplate:
          "Bonus: plant a backdoor on a rival server for long-term surveillance",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 200, perLevel: 15 },
      credits: { base: 300, perLevel: 30 },
      reputation: 5,
      items: [
        "Commander Steele's Briefing Token",
        "gh0st's Dead Drop Token",
        "Director Chen's Business Card",
      ],
    },
    timeLimit: { min: 10800, max: 21600 }, // 3–6 hours
    tags: ["faction", "territory", "elite"],
    factionAffinity: ["garrison", "dothackers", "cybercorp"],
  },

  // ── 21. double_agent ──────────────────────────────────────────────────
  {
    id: "double_agent",
    name: "Work for two factions",
    tier: 4,
    type: "social",
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: ["Double Agent", "Playing Both Sides", "Divided Loyalty"],
    descriptionTemplates: [
      "Serve two masters. Build rep with a secondary faction, contact another player, and stay in the shadows.",
      "Loyalty is a luxury. Earn standing with both sides, make a contact, and keep your cover intact.",
      "Play both factions against each other. Reach 15 rep, recruit a player, and maintain stealth on 2 hacks.",
    ],
    objectives: [
      {
        type: "faction_reputation",
        descriptionTemplate:
          "Reach {target} reputation with a secondary faction",
        target: 15,
      },
      {
        type: "contact_player",
        descriptionTemplate: "Make contact with another player",
        target: true,
      },
      {
        type: "hack_stealth",
        descriptionTemplate:
          "Complete {target} stealth hacks to maintain cover",
        target: 2,
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode a piece of classified intelligence to deepen your cover",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 2200, perLevel: 50 },
      credits: { base: 7000, perLevel: 300 },
      reputation: 20,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 10800, max: 21600 },
    tags: ["social", "faction", "elite"],
  },

  // ── 22. intelligence_sweep ────────────────────────────────────────────
  {
    id: "intelligence_sweep",
    name: "Comprehensive network reconnaissance",
    tier: 4,
    type: "explore",
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: [
      "Intelligence Sweep",
      "Full Spectrum Recon",
      "Network Cartography",
    ],
    descriptionTemplates: [
      "Full-spectrum intelligence gathering. Explore 8 nodes, identify 3 server types, and exfiltrate 5 files.",
      "Map the entire sector. Sweep 8 servers, catalog 3 distinct types, and steal 5 priority files.",
      "Comprehensive recon: 8 servers explored, 3 types identified, 5 files extracted. Leave nothing uncatalogued.",
    ],
    objectives: [
      {
        type: "explore",
        descriptionTemplate: "Explore {target} servers",
        target: 8,
      },
      {
        type: "discover_server_type",
        descriptionTemplate: "Discover {target} different server types",
        target: 3,
      },
      {
        type: "steal_count",
        descriptionTemplate: "Steal {target} files",
        target: 5,
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode {target} encoded files from your sweep for additional intel",
        target: 2,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 1600, perLevel: 35 },
      credits: { base: 5000, perLevel: 180 },
      reputation: 18,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 10800, max: 21600 },
    tags: ["recon", "exploration", "elite"],
  },

  // ── 23. surgical_strike ───────────────────────────────────────────────
  {
    id: "surgical_strike",
    name: "Precise targeted operation",
    tier: 4,
    type: "hack",
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: ["Surgical Strike", "Precision Operation", "One Shot"],
    descriptionTemplates: [
      "Surgical precision. Hack the target with SQL injection, steal the payload, and burn the evidence.",
      "One shot, one kill. Use a specific exploit, grab the data, and wipe the logs. No room for error.",
      "Execute a precision strike: targeted hack via SQL injection, data exfil, and full log deletion.",
    ],
    objectives: [
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
      },
      {
        type: "hack_method",
        descriptionTemplate: "Use SQL injection to breach the target",
        target: 1,
        metadata: { method: "sql_injection" },
      },
      {
        type: "steal",
        descriptionTemplate: "Steal the target data",
        target: true,
      },
      {
        type: "delete_file",
        descriptionTemplate: "Delete all log files",
        target: true,
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download the stolen data to your home server for safekeeping",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 2500, perLevel: 50 },
      credits: { base: 8000, perLevel: 300 },
      reputation: 22,
      skillPoints: 2,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 7200, max: 14400 },
    tags: ["precision", "stealth", "elite"],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // TIER 5 — Ghost (Levels 50+, Difficulty 8–10)
  // ══════════════════════════════════════════════════════════════════════════

  // ── 24. kingmaker ─────────────────────────────────────────────────────
  {
    id: "kingmaker",
    name: "Shift faction war balance",
    tier: 5,
    type: "mixed",
    minLevel: 50,
    maxLevel: 100,
    difficulty: { min: 8, max: 10 },
    titleTemplates: ["Kingmaker", "Power Broker", "The Tipping Point"],
    descriptionTemplates: [
      "You have the power to decide the war. Hack 5 key servers, reach 40 rep, earn 25k credits, and stay invisible.",
      "Tip the balance. Massive multi-front operation: 5 hacks, 40 faction rep, 25,000 credits, 3 stealth ops.",
      "Become the kingmaker. Your actions will determine the outcome of the faction war.",
    ],
    objectives: [
      {
        type: "hack",
        descriptionTemplate: "Hack {target} key faction servers",
        target: 5,
      },
      {
        type: "faction_reputation",
        descriptionTemplate: "Reach {target} faction reputation",
        target: 40,
      },
      {
        type: "earn_credits",
        descriptionTemplate: "Earn {target} credits to fund operations",
        target: 25000,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 3,
      },
      {
        type: "install_backdoor",
        descriptionTemplate:
          "Bonus: plant backdoors on {target} key servers to control the outcome",
        target: 2,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 5000, perLevel: 60 },
      credits: { base: 20000, perLevel: 500 },
      reputation: 40,
      skillPoints: 3,
      items: ["AIDA Signal Fragment"],
    },
    timeLimit: { min: 14400, max: 28800 }, // 4–8 hours
    tags: ["faction", "war", "endgame"],
  },

  // ── 25. aida_trail ────────────────────────────────────────────────────
  {
    id: "aida_trail",
    name: "Follow AIDA breadcrumbs",
    tier: 5,
    type: "explore",
    minLevel: 50,
    maxLevel: 100,
    difficulty: { min: 8, max: 10 },
    titleTemplates: ["AIDA Trail", "Signal Trace", "Digital Archaeology"],
    descriptionTemplates: [
      "Something is leaving breadcrumbs across the Grid. Follow the trail: explore 6 nodes, steal the payload, escalate to level 4, and stay ghosted.",
      "AIDA left traces — fragments of something ancient. Track them through 6 servers, exfiltrate the data, and gain deep access.",
      "Digital archaeology. The signal leads through 6 nodes. Follow it, extract what you find, and don't let anyone know you were there.",
    ],
    objectives: [
      {
        type: "explore",
        descriptionTemplate: "Explore {target} servers along the trail",
        target: 6,
      },
      {
        type: "steal",
        descriptionTemplate: "Steal the AIDA data fragment",
        target: true,
      },
      {
        type: "gain_access",
        descriptionTemplate: "Gain level 4+ access to the archive",
        target: true,
        metadata: { minLevel: 4 },
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 4,
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode the AIDA fragment to reveal its hidden message",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 6000, perLevel: 70 },
      credits: { base: 15000, perLevel: 400 },
      reputation: 35,
      skillPoints: 4,
      items: ["AIDA Signal Fragment", "Envoy's Cipher Token"],
      unlocks: ["aida_knowledge"],
    },
    timeLimit: { min: 14400, max: 28800 },
    tags: ["story", "mystery", "endgame"],
    factionAffinity: ["darknet"],
  },

  // ── 26. scorched_earth ────────────────────────────────────────────────
  {
    id: "scorched_earth",
    name: "Total server exfiltration",
    tier: 5,
    type: "hack",
    minLevel: 50,
    maxLevel: 100,
    difficulty: { min: 8, max: 10 },
    titleTemplates: [
      "Scorched Earth",
      "Total Exfiltration",
      "Burn After Reading",
    ],
    descriptionTemplates: [
      "Burn it all. Hack the target, steal every file, wipe the evidence, and do it all without a trace.",
      "Total exfiltration protocol. Compromise the server, pull 8 files, delete the logs, and ghost 5 hacks.",
      "Scorched earth. By the time they notice, there should be nothing left — and no record you were ever there.",
    ],
    objectives: [
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
      },
      {
        type: "steal_count",
        descriptionTemplate: "Steal {target} files from the server",
        target: 8,
      },
      {
        type: "delete_file",
        descriptionTemplate: "Delete all evidence",
        target: true,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 5,
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download the stolen files to your home server before burning the evidence",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 7000, perLevel: 80 },
      credits: { base: 25000, perLevel: 600 },
      reputation: 45,
      skillPoints: 4,
      items: ["AIDA Signal Fragment"],
    },
    timeLimit: { min: 14400, max: 28800 },
    tags: ["destruction", "stealth", "endgame"],
  },

  // ── 27. zero_day ──────────────────────────────────────────────────────
  {
    id: "zero_day",
    name: "Dynamic AI-directed mission",
    tier: 5,
    type: "mixed",
    minLevel: 50,
    maxLevel: 100,
    difficulty: { min: 8, max: 10 },
    titleTemplates: ["Zero Day", "Unknown Vulnerability", "First Strike"],
    descriptionTemplates: [
      "An unknown vulnerability has surfaced. Exploit it before it's patched — hack 3 targets, steal the payload, relay through a server, and run a faction op.",
      "Zero-day window. You have limited time to hack 3 nodes, exfiltrate data, establish a relay, and complete a faction mission.",
      "This is a first-strike scenario. The vulnerability won't last. Move fast across multiple objectives.",
    ],
    objectives: [
      {
        type: "hack",
        descriptionTemplate: "Hack {target} servers using the zero-day",
        target: 3,
      },
      {
        type: "steal",
        descriptionTemplate: "Steal the target data",
        target: true,
      },
      {
        type: "connect_server",
        descriptionTemplate: "Establish relay through a server",
        target: true,
      },
      {
        type: "faction_mission",
        descriptionTemplate: "Complete {target} faction mission",
        target: 1,
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode intelligence gathered during the zero-day window",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 5500, perLevel: 65 },
      credits: { base: 18000, perLevel: 450 },
      reputation: 38,
      skillPoints: 3,
      items: ["AIDA Signal Fragment"],
    },
    timeLimit: { min: 10800, max: 21600 }, // 3–6 hours
    tags: ["dynamic", "ai-generated", "endgame"],
  },

  // ── 28. shadow_broker ─────────────────────────────────────────────────
  {
    id: "shadow_broker",
    name: "Maintain persistent access on multiple servers",
    tier: 5,
    type: "hack",
    minLevel: 50,
    maxLevel: 100,
    difficulty: { min: 8, max: 10 },
    titleTemplates: ["Shadow Broker", "Information Monopoly", "The Puppeteer"],
    descriptionTemplates: [
      "Become the shadow broker. Hack a priority target, establish level-4 access, ghost 5 hacks, and upload your payload.",
      "Control the flow of information. Root the target, plant deep access, stay invisible across 5 ops, and exfiltrate via upload.",
      "The puppeteer pulls all the strings. Persistent access, deep privileges, total stealth, and a clean upload.",
    ],
    objectives: [
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
      },
      {
        type: "gain_access",
        descriptionTemplate: "Gain level 4+ persistent access",
        target: true,
        metadata: { minLevel: 4 },
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 5,
      },
      {
        type: "upload_file",
        descriptionTemplate: "Upload the payload to the target",
        target: true,
      },
      {
        type: "survive_trace",
        descriptionTemplate:
          "Bonus: evade a trace to demonstrate total operational security",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 8000, perLevel: 90 },
      credits: { base: 30000, perLevel: 700 },
      reputation: 50,
      skillPoints: 5,
      items: ["AIDA Signal Fragment"],
    },
    timeLimit: { min: 14400, max: 28800 },
    tags: ["backdoor", "persistence", "endgame"],
  },

  // ── 29. endgame ───────────────────────────────────────────────────────
  {
    id: "endgame",
    name: "Story-critical branching mission",
    tier: 5,
    type: "mixed",
    minLevel: 50,
    maxLevel: 100,
    difficulty: { min: 8, max: 10 },
    titleTemplates: ["Endgame", "Final Protocol", "Point of No Return"],
    descriptionTemplates: [
      "This is the endgame. Everything you've built leads here. Hack 6 critical servers, steal 10 files, reach 50 faction rep, ghost 5 ops, and earn 50,000 credits.",
      "Point of no return. The final protocol requires total mastery: 6 hacks, 10 exfils, 50 rep, 5 stealth ops, 50k credits.",
      "There's no coming back from this. Execute the final operation across every domain. This is what you trained for.",
    ],
    objectives: [
      {
        type: "hack",
        descriptionTemplate: "Hack {target} critical servers",
        target: 6,
      },
      {
        type: "steal_count",
        descriptionTemplate: "Steal {target} classified files",
        target: 10,
      },
      {
        type: "faction_reputation",
        descriptionTemplate: "Reach {target} faction reputation",
        target: 50,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete {target} stealth hacks",
        target: 5,
      },
      {
        type: "earn_credits",
        descriptionTemplate: "Earn {target} credits",
        target: 50000,
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode the final AIDA data fragment to unlock its secrets",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 10000, perLevel: 100 },
      credits: { base: 50000, perLevel: 1000 },
      reputation: 50,
      skillPoints: 5,
      items: ["AIDA Signal Fragment"],
      unlocks: ["endgame_access"],
    },
    timeLimit: { min: 21600, max: 43200 }, // 6–12 hours
    tags: ["story", "finale", "endgame"],
  },

  // ══════════════════════════════════════════════════════════════════════
  // Network-Aware Templates (30-33)
  // ══════════════════════════════════════════════════════════════════════

  // ── 30. network_probe ──────────────────────────────────────────────────
  {
    id: "network_probe",
    name: "Network Probe",
    tier: 2 as const,
    type: "explore",
    minLevel: 5,
    maxLevel: 20,
    difficulty: { min: 2, max: 4 },
    titleTemplates: [
      "Network Reconnaissance",
      "Mapping the Grid",
      "Perimeter Scan",
    ],
    descriptionTemplates: [
      "We need eyes on a rival faction's network. Infiltrate their perimeter and map what's inside.",
      "Intelligence reports suggest interesting infrastructure behind this gateway. Scout it out.",
    ],
    objectives: [
      {
        type: "infiltrate_network",
        descriptionTemplate:
          "Penetrate the target network and reach an internal server",
        target: true,
        metadata: {},
      },
      {
        type: "explore",
        descriptionTemplate: "Discover {target} servers within the network",
        target: 3,
      },
      {
        type: "decode_content",
        descriptionTemplate:
          "Bonus: decode an encoded file found inside the network",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 200, perLevel: 20 },
      credits: { base: 500, perLevel: 50 },
      reputation: 5,
    },
    timeLimit: { min: 43200, max: 86400 }, // 12-24h
    tags: ["network", "exploration", "reconnaissance"],
  },

  // ── 31. deep_extraction ────────────────────────────────────────────────
  {
    id: "deep_extraction",
    name: "Deep Extraction",
    tier: 3 as const,
    type: "mixed",
    minLevel: 15,
    maxLevel: 40,
    difficulty: { min: 4, max: 7 },
    titleTemplates: [
      "Operation Deep Dive",
      "Core Extraction",
      "The Inner Sanctum",
    ],
    descriptionTemplates: [
      "Critical intel is buried deep inside a faction network. Hack through their defenses layer by layer and extract the data.",
      "The target data is on a database server behind multiple firewalls. No shortcuts — hack your way in.",
    ],
    objectives: [
      {
        type: "infiltrate_network",
        descriptionTemplate:
          "Penetrate the faction network to reach their core servers",
        target: true,
        metadata: {},
      },
      {
        type: "exfiltrate_data",
        descriptionTemplate: "Extract the target data from the deep server",
        target: true,
        metadata: {},
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download the extracted data to your home server",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 600, perLevel: 40 },
      credits: { base: 2000, perLevel: 150 },
      reputation: 15,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 21600, max: 43200 }, // 6-12h
    tags: ["network", "stealth", "extraction"],
  },

  // ── 32. follow_the_trail ───────────────────────────────────────────────
  {
    id: "follow_the_trail",
    name: "Follow the Trail",
    tier: 3 as const,
    type: "explore",
    minLevel: 15,
    maxLevel: 35,
    difficulty: { min: 4, max: 6 },
    titleTemplates: [
      "Digital Breadcrumbs",
      "Trace the Signal",
      "Follow the Money",
    ],
    descriptionTemplates: [
      "We know the target exists but not where. Read files, follow IP references, and trace the connection to the hidden server.",
      "Intel suggests suspicious activity on a network. Read the logs, follow the clues, and find where the data leads.",
    ],
    objectives: [
      {
        type: "trace_connection",
        descriptionTemplate:
          "Discover the hidden target server by following network clues",
        target: true,
        metadata: {},
      },
      {
        type: "steal",
        descriptionTemplate: "Read the evidence file once you find the target",
        target: true,
        metadata: {},
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Bonus: reach the target without being detected",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 500, perLevel: 30 },
      credits: { base: 1500, perLevel: 100 },
      reputation: 10,
      items: ["Envoy's Cipher Token"],
    },
    timeLimit: { min: 28800, max: 57600 }, // 8-16h
    tags: ["network", "investigation", "discovery"],
  },

  // ── 33. network_siege ──────────────────────────────────────────────────
  {
    id: "network_siege",
    name: "Network Siege",
    tier: 4 as const,
    type: "hack",
    minLevel: 30,
    maxLevel: 60,
    difficulty: { min: 6, max: 9 },
    titleTemplates: [
      "Full Spectrum Assault",
      "Network Siege",
      "Total Compromise",
    ],
    descriptionTemplates: [
      "This is a full network takedown. Hack every server from gateway to core. Leave backdoors for persistent access.",
      "Command wants total control of this network. Breach every node and install backdoors on the critical infrastructure.",
    ],
    objectives: [
      {
        type: "infiltrate_network",
        descriptionTemplate: "Penetrate the target network",
        target: true,
        metadata: {},
      },
      {
        type: "hack",
        descriptionTemplate: "Hack {target} servers within the network",
        target: 4,
      },
      {
        type: "install_backdoor",
        descriptionTemplate: "Install a backdoor on a core server",
        target: true,
        metadata: {},
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Complete at least one hack undetected",
        target: 1,
      },
      {
        type: "survive_trace",
        descriptionTemplate: "Bonus: evade a trace during the siege",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 500, perLevel: 30 },
      credits: { base: 1500, perLevel: 100 },
      reputation: 10,
      items: [
        "Envoy's Cipher Token",
        "Commander Steele's Briefing Token",
        "Director Chen's Business Card",
      ],
    },
    timeLimit: { min: 5, max: 12 },
    tags: ["network", "siege", "backdoor", "stealth"],
    factionAffinity: ["garrison", "cybercorp"],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // NEW SYSTEM INTEGRATION TEMPLATES (6 templates using new objective types)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── data_extraction (T2) — hack + download ──
  {
    id: "data_extraction",
    name: "Extract data to home server",
    tier: 2,
    type: "steal" as const,
    minLevel: 5,
    maxLevel: 20,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Data Extraction", "Bring It Home", "Secure the Package"],
    descriptionTemplates: [
      "Intelligence is useless if it stays on the enemy server. Hack in, find the files, and download them to your home system.",
      "We need hard evidence, not screenshots. Break into the target server and download the files to your machine.",
      "Your handler wants copies, not memories. Infiltrate, locate, and extract the data to your home server.",
    ],
    objectives: [
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
        metadata: { serverId: "{targetServerId}" },
      },
      {
        type: "download_file",
        descriptionTemplate: "Download the target file to your home server",
        target: true,
        metadata: { fileId: "{targetFileId}" },
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Bonus: extract without being detected",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 300, perLevel: 25 },
      credits: { base: 700, perLevel: 60 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["download", "hack", "extraction"],
    factionAffinity: ["cybercorp", "dothackers"],
  },

  // ── cipher_breaker (T3) — hack + steal + decode ──
  {
    id: "cipher_breaker",
    name: "Crack encoded intelligence",
    tier: 3,
    type: "steal" as const,
    minLevel: 15,
    maxLevel: 35,
    difficulty: { min: 4, max: 6 },
    titleTemplates: [
      "Cipher Breaker",
      "Decode the Signal",
      "Cracking the Vault",
    ],
    descriptionTemplates: [
      "A classified file has been located, but it's encoded. Steal it, then use your decryption skills to extract the intelligence.",
      "Enemy communications are encoded. Find the source file, grab it, and break the cipher.",
      "The target file is protected by layered encoding. Your cryptography skills will be put to the test.",
    ],
    objectives: [
      {
        type: "hack_target",
        descriptionTemplate: "Hack the target server",
        target: true,
        metadata: { serverId: "{targetServerId}" },
      },
      {
        type: "steal",
        descriptionTemplate: "Steal the encoded file",
        target: true,
        metadata: { fileId: "{targetFileId}" },
      },
      {
        type: "decode_content",
        descriptionTemplate: "Decode the file's contents",
        target: true,
        metadata: { encoding: "{encoding}" },
      },
      {
        type: "download_file",
        descriptionTemplate:
          "Bonus: download the decoded file to your home server",
        target: true,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 150, perLevel: 20 },
      credits: { base: 400, perLevel: 40 },
      skillPoints: 1,
      items: ["gh0st's Dead Drop Token"],
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["decode", "cryptography", "steal"],
    factionAffinity: ["darknet", "dothackers"],
  },

  // ── bounty_hunter (T3) — claim and complete a bounty ──
  {
    id: "bounty_hunter",
    name: "Hunt a bounty target",
    tier: 3,
    type: "hack" as const,
    minLevel: 15,
    maxLevel: 40,
    difficulty: { min: 4, max: 7 },
    titleTemplates: ["Bounty Hunter", "Wanted: Dead Link", "Justice for Hire"],
    descriptionTemplates: [
      "A bounty has been posted. Track down the target, hack their home server, and collect the reward.",
      "Someone crossed the wrong faction. Find them, breach their defenses, and make them pay.",
      "The price on their head is yours for the taking. Accept a bounty and deliver.",
    ],
    objectives: [
      {
        type: "claim_bounty",
        descriptionTemplate: "Claim and complete an active bounty",
        target: true,
      },
      {
        type: "hack_stealth",
        descriptionTemplate: "Bonus: breach the target without being detected",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 200, perLevel: 15 },
      credits: { base: 300, perLevel: 30 },
      reputation: 5,
      items: [
        "Commander Steele's Briefing Token",
        "Director Chen's Business Card",
      ],
    },
    timeLimit: { min: 7200, max: 14400 },
    tags: ["bounty", "pvp", "hack"],
    factionAffinity: ["garrison", "cybercorp"],
  },

  // ── home_fortification (T2) — upgrade home defenses ──
  {
    id: "home_fortification",
    name: "Fortify your home server",
    tier: 2,
    type: "explore" as const,
    minLevel: 5,
    maxLevel: 25,
    difficulty: { min: 1, max: 3 },
    titleTemplates: ["Home Fortification", "Raise the Walls", "Digital Bunker"],
    descriptionTemplates: [
      "Your home server is vulnerable. Purchase and install defenses before someone raids your data.",
      "A good hacker protects their own turf. Upgrade your home security to keep bounty hunters out.",
      "Offense wins games, defense wins championships. Fortify your home server.",
    ],
    objectives: [
      {
        type: "defend_home",
        descriptionTemplate: "Purchase or upgrade a home defense",
        target: true,
        metadata: { defenseType: "any" },
      },
      {
        type: "explore",
        descriptionTemplate: "Bonus: scan your local network for threats",
        target: 2,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 150, perLevel: 15 },
      credits: { base: 300, perLevel: 25 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["defense", "home", "tutorial"],
  },

  // ── ghost_run (T4) — stealth hack + download + evade trace ──
  {
    id: "ghost_run",
    name: "Stealth extraction under pressure",
    tier: 4,
    type: "hack" as const,
    minLevel: 30,
    maxLevel: 50,
    difficulty: { min: 6, max: 8 },
    titleTemplates: ["Ghost Run", "Silent Extraction", "Phantom Protocol"],
    descriptionTemplates: [
      "Get in, grab the data, and get out — all without leaving a trace. If they catch you, evade the trace.",
      "This is a precision operation. Stealth hack, extract files, and if the alarm trips, disappear.",
      "You're smoke. Infiltrate undetected, download the package, and ghost out before they trace you.",
    ],
    objectives: [
      {
        type: "hack_stealth",
        descriptionTemplate: "Hack servers without detection",
        target: 1,
      },
      {
        type: "download_file",
        descriptionTemplate: "Download the target file",
        target: true,
        metadata: { fileId: "{targetFileId}" },
      },
      {
        type: "survive_trace",
        descriptionTemplate: "Successfully evade a trace if detected",
        target: 1,
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 800, perLevel: 50 },
      credits: { base: 2000, perLevel: 100 },
      reputation: 15,
      skillPoints: 1,
      items: ["gh0st's Dead Drop Token", "Envoy's Cipher Token"],
    },
    timeLimit: { min: 5400, max: 10800 },
    tags: ["stealth", "download", "trace", "elite"],
    factionAffinity: ["dothackers", "darknet"],
  },

  // ── network_cartographer (T2) — subnet + explore + trace ──
  {
    id: "network_cartographer",
    name: "Map the network",
    tier: 2,
    type: "explore" as const,
    minLevel: 5,
    maxLevel: 20,
    difficulty: { min: 2, max: 4 },
    titleTemplates: ["Network Cartographer", "Map the Grid", "Recon Sweep"],
    descriptionTemplates: [
      "Before we can plan an operation, we need to know the terrain. Analyze subnet ranges and discover connected servers.",
      "Use your networking tools to map the target area. Calculate subnets, scan for servers, and trace connections.",
      "Intelligence starts with reconnaissance. Map the network topology in the target zone.",
    ],
    objectives: [
      {
        type: "scan_subnet",
        descriptionTemplate: "Analyze network subnets",
        target: 2,
      },
      {
        type: "explore",
        descriptionTemplate: "Discover new servers",
        target: 3,
      },
      {
        type: "trace_connection",
        descriptionTemplate: "Trace a connection to a specific server",
        target: true,
        metadata: { serverId: "{targetServerId}" },
        isBonus: true,
      },
    ],
    rewards: {
      xp: { base: 250, perLevel: 20 },
      credits: { base: 400, perLevel: 40 },
    },
    timeLimit: { min: 3600, max: 7200 },
    tags: ["network", "explore", "subnet", "recon"],
    factionAffinity: ["garrison", "dothackers"],
  },
];

// ────────────────────────────────────────────────────────────────────────────
// Primary Index — all 35 templates keyed by ID
// ────────────────────────────────────────────────────────────────────────────

/**
 * Master map of every mission template, keyed by `template.id`.
 *
 * @example
 *   const tpl = MISSION_TEMPLATES.get("ghost_protocol");
 */
export const MISSION_TEMPLATES: Map<string, MissionTemplate> = new Map(
  templates.map((t) => [t.id, t]),
);

// ────────────────────────────────────────────────────────────────────────────
// Query Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return all templates belonging to a specific tier.
 *
 * @param tier — 1 through 5
 * @returns Array of templates (empty if tier is invalid).
 *
 * @example
 *   const beginnerTemplates = getTemplatesByTier(1); // 5 templates
 */
export function getTemplatesByTier(tier: number): MissionTemplate[] {
  return templates.filter((t) => t.tier === tier);
}

/**
 * Return all templates that list a given faction in their `factionAffinity`.
 *
 * Templates without a `factionAffinity` field are **excluded** — they are
 * considered faction-neutral and should be retrieved via other queries.
 *
 * @param factionId — e.g. "garrison", "dothackers", "cybercorp", "darknet"
 * @returns Matching templates.
 *
 * @example
 *   const darknetMissions = getTemplatesByFaction("darknet");
 */
export function getTemplatesByFaction(factionId: string): MissionTemplate[] {
  return templates.filter(
    (t) => t.factionAffinity && t.factionAffinity.includes(factionId),
  );
}

/**
 * Return templates whose level range contains `playerLevel`, optionally
 * narrowed to a specific faction's affinity pool.
 *
 * When `factionId` is provided, the result includes:
 *   1. Templates whose `factionAffinity` includes the factionId, AND
 *   2. Templates with **no** `factionAffinity` (faction-neutral).
 *
 * This ensures players always have access to generic missions alongside
 * faction-specific ones.
 *
 * @param playerLevel — the player's current level
 * @param factionId   — optional faction filter
 * @returns Eligible templates sorted by tier ascending.
 *
 * @example
 *   const missions = getEligibleTemplates(12, "garrison");
 */
export function getEligibleTemplates(
  playerLevel: number,
  factionId?: string,
): MissionTemplate[] {
  return templates
    .filter((t) => {
      // Level range check
      if (playerLevel < t.minLevel || playerLevel > t.maxLevel) {
        return false;
      }
      // Faction filter (if provided)
      if (factionId) {
        const hasFactionAffinity =
          t.factionAffinity && t.factionAffinity.length > 0;
        if (hasFactionAffinity && !t.factionAffinity!.includes(factionId)) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => a.tier - b.tier);
}

/**
 * Weighted random selection from a set of templates, favouring templates
 * whose level midpoint is closest to the player's current level.
 *
 * Weight formula:
 *   weight = 1 / (1 + |midpoint - playerLevel|)
 *
 * This produces a smooth bell-curve bias towards appropriately-levelled
 * content while still allowing outlier picks for variety.
 *
 * @param candidateTemplates — pre-filtered list of eligible templates
 * @param playerLevel        — used to compute distance-based weights
 * @returns A single selected template, or `undefined` if the input is empty.
 *
 * @example
 *   const eligible = getEligibleTemplates(25);
 *   const pick = selectWeightedTemplate(eligible, 25);
 */
export function selectWeightedTemplate(
  candidateTemplates: MissionTemplate[],
  playerLevel: number,
): MissionTemplate | undefined {
  if (candidateTemplates.length === 0) {
    return undefined;
  }

  // Single candidate — skip math
  if (candidateTemplates.length === 1) {
    return candidateTemplates[0];
  }

  // Compute weights based on level midpoint proximity
  const weights = candidateTemplates.map((t) => {
    const midpoint = (t.minLevel + t.maxLevel) / 2;
    const distance = Math.abs(midpoint - playerLevel);
    return 1 / (1 + distance);
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let random = Math.random() * totalWeight;

  for (let i = 0; i < candidateTemplates.length; i++) {
    random -= weights[i]!;
    if (random <= 0) {
      return candidateTemplates[i];
    }
  }

  // Floating-point safety — return the last template
  return candidateTemplates[candidateTemplates.length - 1]!;
}
