/**
 * Server-Side ASCII Avatar Generator
 * Pure utility module — no DI, no external dependencies.
 * Generates deterministic ASCII art avatars for players, NPCs, AI, and system entities.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AvatarData {
  name: string;
  template: string[];
  templateKey: string;
  color: string;
  type: "player" | "npc" | "system" | "ai";
  glyph: string;
  factionId?: string;
}

// ─── Constants: Avatar Templates ─────────────────────────────────────────────

export const AVATAR_TEMPLATES: Record<string, string[]> = {
  // Player avatars
  hacker1: [
    "  ┌───────┐  ",
    "  │ ◉   ◉ │  ",
    "  │   ▼   │  ",
    "  │ ‾───‾ │  ",
    "  └───────┘  ",
    "     |||      ",
  ],
  hacker2: [
    "  ╔═══════╗  ",
    "  ║ ●   ● ║  ",
    "  ║   <   ║  ",
    "  ║ \\_____/ ║  ",
    "  ╚═══════╝  ",
    "    /|||\\    ",
  ],
  elite: [
    "  ▓▓▓▓▓▓▓▓▓  ",
    "  ▓ █   █ ▓  ",
    "  ▓   ╳   ▓  ",
    "  ▓ ▂▂▂▂▂ ▓  ",
    "  ▓▓▓▓▓▓▓▓▓  ",
    "    ║║║║║    ",
  ],
  anonymous: [
    "    ?????    ",
    "   ? ● ● ?   ",
    "   ?  ~  ?   ",
    "   ? ─── ?   ",
    "    ?????    ",
    "     |||     ",
  ],
  default: [
    "  ┌───────┐  ",
    "  │ •   • │  ",
    "  │   ·   │  ",
    "  │ ‾‾‾‾‾ │  ",
    "  └───────┘  ",
    "     |||     ",
  ],

  // NPC avatars
  corporate: [
    "  ┌───────┐  ",
    "  │ $   $ │  ",
    "  │   ▪   │  ",
    "  │ ▁▁▁▁▁ │  ",
    "  └───────┘  ",
    "    ▐███▌    ",
  ],
  security: [
    "  ╔═══════╗  ",
    "  ║ ■   ■ ║  ",
    "  ║   ▲   ║  ",
    "  ║ ━━━━━ ║  ",
    "  ╚═══════╝  ",
    "   ▓▓███▓▓   ",
  ],
  scientist: [
    "  ┌───────┐  ",
    "  │ ○   ○ │  ",
    "  │   ^   │  ",
    "  │ └───┘ │  ",
    "  └───────┘  ",
    "    {||||}   ",
  ],
  bot: [
    "  ┌─┐───┌─┐  ",
    "  │●│   │●│  ",
    "  └─┘───└─┘  ",
    "  ▐ ▂▂▂▂▂ ▌  ",
    "  ▐▓▓▓▓▓▓▓▌  ",
    "   ║║║║║║║   ",
  ],

  // AI / System avatars
  aida: [
    "  ╔═══════╗  ",
    "  ║█▓▒░░▒▓█║  ",
    "  ║ ▓ ◈ ▓ ║  ",
    "  ║░▒▓█▓▒░║  ",
    "  ╚═══════╝  ",
    "   ∿∿∿∿∿∿∿   ",
  ],
  system: [
    "  ▒▒▒▒▒▒▒▒▒  ",
    "  ▒ ▓   ▓ ▒  ",
    "  ▒   ▓   ▒  ",
    "  ▒ ▓▓▓▓▓ ▒  ",
    "  ▒▒▒▒▒▒▒▒▒  ",
    "   ╚╩╩╩╩╝   ",
  ],

  // Faction avatars
  garrison: [
    "  ╔══╦═╦══╗  ",
    "  ║ ★   ★ ║  ",
    "  ║  ‹›   ║  ",
    "  ║ ▀▄▀▄▀ ║  ",
    "  ╠══╩═╩══╣  ",
    "   ▐▓▓▓▓▓▌   ",
  ],
  dothackers: [
    "  ┌─┬─┬─┬─┐  ",
    "  ├ #   # ┤  ",
    "  │  ░▒░  │  ",
    "  ├ ╌╌╌╌╌ ┤  ",
    "  └─┴─┴─┴─┘  ",
    "   /|\\|/|\\   ",
  ],
  cybercorp: [
    "  ┌─$$$$─┐   ",
    "  │ ◆   ◆ │  ",
    "  │   ═   │  ",
    "  │ ▁▁▁▁▁ │  ",
    "  └───────┘  ",
    "   ▐█▓▓▓█▌   ",
  ],
  darknet: [
    "  ░▒▓█▓▒░▒▓  ",
    "  ▒ ░   ░ ▓  ",
    "  ░  ▓▒▓  ▒  ",
    "  ▓ ░░░░░ ░  ",
    "  ▒▓░▒▓░▒▓░  ",
    "   ░▒▓▒░▓░   ",
  ],
  faction_leader: [
    " ╔═══════════╗",
    " ║ ╔═══════╗ ║",
    " ║ ║ ◈   ◈ ║ ║",
    " ║ ║   ▼   ║ ║",
    " ║ ║ ▂▂▂▂▂ ║ ║",
    " ║ ╚═══════╝ ║",
    " ╠═══════════╣",
    " ║  LEADER   ║",
    " ╚═══════════╝",
  ],
};

// ─── Constants: Avatar Colors ────────────────────────────────────────────────

export const AVATAR_COLORS: Record<string, string> = {
  player: "#00ff41",
  hacker1: "#00ff41",
  hacker2: "#00ff41",
  elite: "#ffaa00",
  anonymous: "#888888",
  corporate: "#ffaa00",
  security: "#ff4444",
  scientist: "#4488ff",
  bot: "#00ccff",
  aida: "#ff00ff",
  system: "#00ccff",
  garrison: "#ff4444",
  dothackers: "#00ff41",
  cybercorp: "#ffaa00",
  darknet: "#ff00ff",
  default: "#888888",
};

// ─── Faction → Template mapping ──────────────────────────────────────────────

const FACTION_TEMPLATE_MAP: Record<string, string> = {
  garrison: "garrison",
  dothackers: "dothackers",
  cybercorp: "cybercorp",
  darknet: "darknet",
};

// ─── Hash Utility ────────────────────────────────────────────────────────────

/**
 * Deterministic hash for a string. Same name always yields the same number.
 */
export function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}

// ─── Core Generation ─────────────────────────────────────────────────────────

/**
 * Generate an avatar for a given entity.
 *
 * Decision tree:
 *  - type === 'ai'     → name === 'AIDA' ? aida : faction_leader (+ faction color if provided)
 *  - type === 'system' → system template, cyan
 *  - type === 'npc'    → has factionId ? faction template : hash-pick from [corporate, security, scientist]
 *  - type === 'player' → has factionId ? faction template : hash-pick from [hacker1, hacker2, elite, anonymous]
 *
 * All selections are deterministic via hashCode(name).
 */
export function generateAvatar(
  name: string,
  type: "player" | "npc" | "system" | "ai",
  factionId?: string,
): AvatarData {
  let templateKey: string;
  let color: string;

  if (type === "ai") {
    if (name.toUpperCase() === "AIDA") {
      templateKey = "aida";
      color = AVATAR_COLORS.aida!;
    } else {
      templateKey = "faction_leader";
      color =
        factionId && AVATAR_COLORS[factionId]
          ? AVATAR_COLORS[factionId]!
          : AVATAR_COLORS.aida!;
    }
  } else if (type === "system") {
    templateKey = "system";
    color = AVATAR_COLORS.system!;
  } else if (type === "npc") {
    if (factionId && FACTION_TEMPLATE_MAP[factionId]) {
      templateKey = FACTION_TEMPLATE_MAP[factionId]!;
      color = AVATAR_COLORS[factionId] ?? AVATAR_COLORS.default!;
    } else {
      const npcTemplates = ["corporate", "security", "scientist"];
      const index = Math.abs(hashCode(name)) % npcTemplates.length;
      templateKey = npcTemplates[index]!;
      color = AVATAR_COLORS[templateKey] ?? AVATAR_COLORS.default!;
    }
  } else {
    // type === 'player'
    if (factionId && FACTION_TEMPLATE_MAP[factionId]) {
      templateKey = FACTION_TEMPLATE_MAP[factionId]!;
      color = AVATAR_COLORS[factionId] ?? AVATAR_COLORS.player!;
    } else {
      const playerTemplates = ["hacker1", "hacker2", "elite", "anonymous"];
      const index = Math.abs(hashCode(name)) % playerTemplates.length;
      templateKey = playerTemplates[index]!;
      color = AVATAR_COLORS[templateKey] ?? AVATAR_COLORS.player!;
    }
  }

  const template =
    AVATAR_TEMPLATES[templateKey] ?? AVATAR_TEMPLATES.default ?? [];
  const glyph = getInlineGlyph(type, factionId);

  const result: AvatarData = {
    name,
    template: [...template],
    templateKey,
    color,
    type,
    glyph,
  };
  if (factionId !== undefined) {
    result.factionId = factionId;
  }
  return result;
}

// ─── Compact / Inline ────────────────────────────────────────────────────────

/**
 * Return the first 5 lines of the avatar template (the "face" without body).
 */
export function getCompactAvatar(avatar: AvatarData): string[] {
  return avatar.template.slice(0, 5);
}

/**
 * Return a single inline glyph for the entity type (5-char badge).
 *
 * Faction variants override the base type glyph when a recognized factionId is supplied.
 */
export function getInlineGlyph(
  type: "player" | "npc" | "system" | "ai",
  factionId?: string,
): string {
  // Faction-specific glyphs take priority
  if (factionId) {
    const factionGlyphs: Record<string, string> = {
      garrison: "[★_★]",
      dothackers: "[#_#]",
      cybercorp: "[$_$]",
      darknet: "[░◈░]",
    };
    if (factionGlyphs[factionId]) {
      return factionGlyphs[factionId];
    }
  }

  const baseGlyphs: Record<string, string> = {
    player: "[◉_◉]",
    npc: "[●_●]",
    ai: "[▓◈▓]",
    system: "[▓_▓]",
  };

  return baseGlyphs[type] ?? "[•_•]";
}

// ─── Formatting Helpers ──────────────────────────────────────────────────────

/**
 * Pad (or trim) every line of the avatar template so it is exactly `width` characters.
 */
export function formatAvatarBlock(avatar: AvatarData, width: number): string[] {
  return avatar.template.map((line) => {
    if (line.length >= width) {
      return line.slice(0, width);
    }
    return line + " ".repeat(width - line.length);
  });
}

/**
 * Render avatar art on the left with info text on the right, side-by-side.
 *
 * Returns an array of lines, each exactly `totalWidth` characters.
 */
export function renderAvatarWithInfo(
  avatar: AvatarData,
  infoLines: string[],
  totalWidth: number,
): string[] {
  const avatarWidth = 16; // standard template width with some padding
  const gap = 2;
  const infoWidth = totalWidth - avatarWidth - gap;
  const paddedAvatar = formatAvatarBlock(avatar, avatarWidth);

  const maxRows = Math.max(paddedAvatar.length, infoLines.length);
  const result: string[] = [];

  for (let i = 0; i < maxRows; i++) {
    const artPart =
      i < paddedAvatar.length ? paddedAvatar[i] : " ".repeat(avatarWidth);
    const infoPart = i < infoLines.length ? (infoLines[i] ?? "") : "";
    const paddedInfo =
      infoPart.length >= infoWidth
        ? infoPart.slice(0, infoWidth)
        : infoPart + " ".repeat(infoWidth - infoPart.length);
    result.push(artPart + " ".repeat(gap) + paddedInfo);
  }

  return result;
}

// ─── High-Level Renderers ────────────────────────────────────────────────────

/**
 * Render a message header block suitable for the mail-read view.
 * Includes the sender's avatar alongside metadata key-value pairs.
 */
export function renderMessageHeader(
  senderName: string,
  senderType: string,
  factionId: string | null,
  metadata: Record<string, string>,
): string[] {
  const type = (senderType as AvatarData["type"]) || "npc";
  const avatar = generateAvatar(senderName, type, factionId ?? undefined);
  const totalWidth = 60;
  const border = "═".repeat(totalWidth);

  const metaLines: string[] = [];
  metaLines.push(`From: ${senderName}`);
  for (const [key, value] of Object.entries(metadata)) {
    metaLines.push(`${key}: ${value}`);
  }

  const body = renderAvatarWithInfo(avatar, metaLines, totalWidth);

  return [
    `╔${border}╗`,
    `║${"  MESSAGE".padEnd(totalWidth)}║`,
    `╠${border}╣`,
    ...body.map((line) => `║${line.padEnd(totalWidth)}║`),
    `╠${border}╣`,
  ];
}

/**
 * Render a full profile card for the `whois` command.
 */
export function renderProfileCard(
  name: string,
  level: number,
  faction: string | null,
  stats: Record<string, string>,
): string[] {
  const avatar = generateAvatar(name, "player", faction ?? undefined);
  const totalWidth = 50;
  const innerWidth = totalWidth - 2; // inside the box border characters
  const border = "═".repeat(innerWidth);

  const infoLines: string[] = [
    `Name:    ${name}`,
    `Level:   ${level}`,
    `Faction: ${faction ?? "None"}`,
    `Glyph:   ${avatar.glyph}`,
    "",
  ];
  for (const [key, value] of Object.entries(stats)) {
    infoLines.push(`${key}: ${value}`);
  }

  const body = renderAvatarWithInfo(avatar, infoLines, innerWidth);

  const result: string[] = [
    `╔${border}╗`,
    `║${"  PLAYER PROFILE".padEnd(innerWidth)}║`,
    `╠${border}╣`,
  ];

  for (const line of body) {
    const padded =
      line.length >= innerWidth
        ? line.slice(0, innerWidth)
        : line + " ".repeat(innerWidth - line.length);
    result.push(`║${padded}║`);
  }

  result.push(`╚${border}╝`);
  return result;
}

/**
 * Render a compact notification badge for system alerts / new mail indicators.
 */
export function renderNotificationBadge(
  sender: string,
  message: string,
  unread: number,
): string[] {
  const avatar = generateAvatar(sender, "system");
  const glyph = avatar.glyph;
  const innerWidth = 42;
  const border = "─".repeat(innerWidth);

  const truncatedMsg =
    message.length > innerWidth - 4
      ? message.slice(0, innerWidth - 7) + "..."
      : message;

  const unreadLabel =
    unread > 1 ? `+${unread - 1} more messages` : "New message";

  return [
    `┌${border}┐`,
    `│ ${glyph} ${sender.padEnd(innerWidth - glyph.length - 3)}│`,
    `│ ${truncatedMsg.padEnd(innerWidth - 2)}│`,
    `│ ${unreadLabel.padEnd(innerWidth - 2)}│`,
    `└${border}┘`,
  ];
}
