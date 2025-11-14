/**
 * ASCII Avatar Generator
 * Generates ASCII art profile pictures for players and NPCs
 */

export interface AsciiAvatar {
  name: string;
  avatar: string[];
  color: string;
  type: 'player' | 'npc' | 'system' | 'ai';
}

// Predefined ASCII avatar templates
export const AVATAR_TEMPLATES = {
  // Player avatars
  hacker1: [
    '  ┌───────┐  ',
    '  │ ◉   ◉ │  ',
    '  │   ▼   │  ',
    '  │ ‾───‾ │  ',
    '  └───────┘  ',
    '     |||      ',
  ],
  hacker2: [
    '  ╔═══════╗  ',
    '  ║ ●   ● ║  ',
    '  ║   <   ║  ',
    '  ║ \_____/ ║  ',
    '  ╚═══════╝  ',
    '    /|||\\    ',
  ],
  elite: [
    '  ▓▓▓▓▓▓▓▓▓  ',
    '  ▓ █   █ ▓  ',
    '  ▓   ╳   ▓  ',
    '  ▓ ▂▂▂▂▂ ▓  ',
    '  ▓▓▓▓▓▓▓▓▓  ',
    '    ║║║║║    ',
  ],
  anonymous: [
    '    ?????    ',
    '   ? ● ● ?   ',
    '   ?  ~  ?   ',
    '   ? ─── ?   ',
    '    ?????    ',
    '     |||     ',
  ],

  // NPC avatars
  corporate: [
    '  ┌───────┐  ',
    '  │ $   $ │  ',
    '  │   ▪   │  ',
    '  │ ▁▁▁▁▁ │  ',
    '  └───────┘  ',
    '    ▐███▌    ',
  ],
  security: [
    '  ╔═══════╗  ',
    '  ║ ■   ■ ║  ',
    '  ║   ▲   ║  ',
    '  ║ ━━━━━ ║  ',
    '  ╚═══════╝  ',
    '   ▓▓███▓▓   ',
  ],
  scientist: [
    '  ┌───────┐  ',
    '  │ ○   ○ │  ',
    '  │   ^   │  ',
    '  │ └───┘ │  ',
    '  └───────┘  ',
    '    {||||}   ',
  ],

  // AI/System avatars
  aida: [
    '  ╔═══════╗  ',
    '  ║█▓▒░░▒▓█║  ',
    '  ║ ▓ ◈ ▓ ║  ',
    '  ║░▒▓█▓▒░║  ',
    '  ╚═══════╝  ',
    '   ∿∿∿∿∿∿∿   ',
  ],
  system: [
    '  ▒▒▒▒▒▒▒▒▒  ',
    '  ▒ ▓   ▓ ▒  ',
    '  ▒   ▓   ▒  ',
    '  ▒ ▓▓▓▓▓ ▒  ',
    '  ▒▒▒▒▒▒▒▒▒  ',
    '   ╚╩╩╩╩╝   ',
  ],
  bot: [
    '  ┌─┐───┌─┐  ',
    '  │●│   │●│  ',
    '  └─┘───└─┘  ',
    '  ▐ ▂▂▂▂▂ ▌  ',
    '  ▐▓▓▓▓▓▓▓▌  ',
    '   ║║║║║║║   ',
  ],

  // Default/Generic
  default: [
    '  ┌───────┐  ',
    '  │ •   • │  ',
    '  │   ·   │  ',
    '  │ ‾‾‾‾‾ │  ',
    '  └───────┘  ',
    '     |||     ',
  ],
};

// Color schemes for avatars
export const AVATAR_COLORS = {
  player: '#00ff41',      // Green
  npc: '#00ccff',         // Cyan
  corporate: '#ffaa00',   // Orange
  security: '#ff4444',    // Red
  scientist: '#4488ff',   // Blue
  ai: '#ff00ff',          // Magenta
  system: '#00ccff',      // Cyan
  default: '#888888',     // Gray
};

/**
 * Generate an ASCII avatar for a user
 */
export function generateAvatar(
  name: string,
  type: 'player' | 'npc' | 'system' | 'ai' = 'player',
  template?: string
): AsciiAvatar {
  // Determine template based on name/type if not specified
  let avatarTemplate: string[] = AVATAR_TEMPLATES.default;
  let color = AVATAR_COLORS.default;

  if (template && AVATAR_TEMPLATES[template as keyof typeof AVATAR_TEMPLATES]) {
    avatarTemplate = AVATAR_TEMPLATES[template as keyof typeof AVATAR_TEMPLATES];
  } else {
    // Auto-select based on type and name
    if (type === 'ai' || name.toLowerCase() === 'aida') {
      avatarTemplate = AVATAR_TEMPLATES.aida;
      color = AVATAR_COLORS.ai;
    } else if (type === 'system') {
      avatarTemplate = AVATAR_TEMPLATES.system;
      color = AVATAR_COLORS.system;
    } else if (type === 'npc') {
      // Select NPC avatar based on name hash
      const npcTemplates = ['corporate', 'security', 'scientist'];
      const index = Math.abs(hashCode(name)) % npcTemplates.length;
      const templateKey = npcTemplates[index] as keyof typeof AVATAR_TEMPLATES;
      avatarTemplate = AVATAR_TEMPLATES[templateKey];
      color = AVATAR_COLORS[templateKey];
    } else {
      // Player avatar - select based on name hash
      const playerTemplates = ['hacker1', 'hacker2', 'elite', 'anonymous'];
      const index = Math.abs(hashCode(name)) % playerTemplates.length;
      avatarTemplate = AVATAR_TEMPLATES[playerTemplates[index] as keyof typeof AVATAR_TEMPLATES];
      color = AVATAR_COLORS.player;
    }
  }

  return {
    name,
    avatar: avatarTemplate,
    color,
    type,
  };
}

/**
 * Get a compact version of avatar (just the face, no body)
 */
export function getCompactAvatar(avatar: AsciiAvatar): string[] {
  // Return just the first 5 lines (face part)
  return avatar.avatar.slice(0, 5);
}

/**
 * Get avatar as a single line (for inline display)
 */
export function getInlineAvatar(avatar: AsciiAvatar): string {
  // Return a simplified single-line version
  const faces: Record<string, string> = {
    player: '[◉_◉]',
    npc: '[●_●]',
    ai: '[▓◈▓]',
    system: '[▓_▓]',
  };
  return faces[avatar.type] || '[•_•]';
}

/**
 * Format avatar for display in terminal
 */
export function formatAvatarForTerminal(avatar: AsciiAvatar): string[] {
  return avatar.avatar.map(line => `  ${line}`);
}

/**
 * Create a message header with avatar
 */
export function createMessageHeader(
  sender: string,
  senderType: 'player' | 'npc' | 'system' | 'ai',
  timestamp?: Date
): string[] {
  const avatar = generateAvatar(sender, senderType);
  const compactAvatar = getCompactAvatar(avatar);
  const time = timestamp ? timestamp.toLocaleTimeString() : new Date().toLocaleTimeString();

  const header: string[] = [
    '╔════════════════════════════════════════════════════════════╗',
    '║ NEW MESSAGE                                                ║',
    '╠════════════════════════════════════════════════════════════╣',
  ];

  // Add avatar lines with sender info
  compactAvatar.forEach((line, index) => {
    if (index === 0) {
      header.push(`║ ${line}    From: ${sender.padEnd(30)} ║`);
    } else if (index === 2) {
      header.push(`║ ${line}    Time: ${time.padEnd(30)} ║`);
    } else {
      header.push(`║ ${line}${' '.repeat(42)}║`);
    }
  });

  header.push('╠════════════════════════════════════════════════════════════╣');

  return header;
}

/**
 * List all available avatar templates
 */
export function listAvatarTemplates(): string[] {
  return Object.keys(AVATAR_TEMPLATES);
}

/**
 * Preview an avatar template
 */
export function previewAvatar(templateName: string): string[] {
  const template = AVATAR_TEMPLATES[templateName as keyof typeof AVATAR_TEMPLATES];
  if (!template) {
    return ['Template not found'];
  }

  return [
    `Avatar: ${templateName}`,
    '',
    ...template,
  ];
}

/**
 * Simple hash function for consistent avatar selection
 */
function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Create a player profile card
 */
export function createProfileCard(
  name: string,
  level: number,
  reputation: number,
  status: string = 'Online'
): string[] {
  const avatar = generateAvatar(name, 'player');

  return [
    '╔════════════════════════════════╗',
    '║      PLAYER PROFILE            ║',
    '╠════════════════════════════════╣',
    ...avatar.avatar.map(line => `║  ${line}          ║`),
    '╠════════════════════════════════╣',
    `║  Name: ${name.padEnd(23)} ║`,
    `║  Level: ${level.toString().padEnd(22)} ║`,
    `║  Rep: ${reputation.toString().padEnd(24)} ║`,
    `║  Status: ${status.padEnd(21)} ║`,
    '╚════════════════════════════════╝',
  ];
}

/**
 * Create notification badge with avatar
 */
export function createNotificationBadge(
  sender: string,
  message: string,
  unread: number = 1
): string[] {
  const inlineAvatar = getInlineAvatar(generateAvatar(sender));

  return [
    '┌────────────────────────────────────────┐',
    `│ ${inlineAvatar} ${sender.padEnd(30)} │`,
    `│ ${message.substring(0, 38).padEnd(38)} │`,
    `│ ${unread > 1 ? `+${unread - 1} more messages` : 'New message'.padEnd(38)} │`,
    '└────────────────────────────────────────┘',
  ];
}

// Export everything
export default {
  generateAvatar,
  getCompactAvatar,
  getInlineAvatar,
  formatAvatarForTerminal,
  createMessageHeader,
  createProfileCard,
  createNotificationBadge,
  listAvatarTemplates,
  previewAvatar,
  AVATAR_TEMPLATES,
  AVATAR_COLORS,
};
