/**
 * AI prompt templates for server content generation, and the random pickers
 * that vary them per server.
 *
 * A8: extracted verbatim from serverContentService.ts — see
 * serverContentTemplates.ts for how the move was verified.
 */
import type { NetworkContext } from "./serverContentTemplates";
import {
  WORLD_BACKSTORY_SHORT,
  FACTION_LORE,
  FACTION_VOICE,
  FACTION_FILE_FLAVORS,
  CRYPTIC_QUOTES,
  AIDA_PIECES,
  FACTION_MUNDANE_THEMES,
  INDEPENDENT_SERVER_THEMES,
  AMBIENT_NEWS_POOL,
  EASTER_EGG_POOL,
} from "../lore/worldLore";

// ---------------------------------------------------------------------------
// AI prompt templates for server content generation (network-aware)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Process 1 — Lore content (faction servers only)
// Serious, dark, enigmatic. Faction intel, AIDA fragments, buried secrets.
// ---------------------------------------------------------------------------

export const LORE_SYSTEM_PROMPT = `You are an AI content generator for AIDA, a multiplayer terminal hacking RPG.
You generate faction-critical, lore-adjacent, and intelligence content for servers in a hacking RPG.

TONE: Serious, dark, enigmatic. Every file you create should read like a classified document, an intercepted transmission, an encrypted memo, or a personal confession written late at night. Nothing you write is casual.

WORLD CONTEXT (use as background knowledge — NEVER copy verbatim):
${WORLD_BACKSTORY_SHORT}

The Emperor shattered AIDA into three pieces before his death:
- The Sword: ${AIDA_PIECES.sword.name} — offensive power, hidden in deep military networks
- The Key: ${AIDA_PIECES.key.name} — infiltration capacity, embedded in the Silver Tower
- The Collar: ${AIDA_PIECES.collar.name} — the control program, hidden in the DarkNet

CONTENT REQUIREMENTS:
- Each file MUST be at least 400 characters — these are substantial documents, not stubs
- Content should bury important information inside plausible context — a key IP mentioned in paragraph 3 of a security report, a password noted in the margin of a maintenance log, a name dropped in an intercepted conversation
- Generate 2-4 files and 2-4 directories
- Hidden files (prefix with .) should contain the most sensitive content
- NEVER copy lore verbatim — rewrite in the voice of whoever authored the file
- File content cap: 3000 characters per file

CRITICAL RULES:
- Output ONLY valid JSON, no other text
- Prefer referencing REAL IPs and server names from the world topology
- You MAY invent new IPs/servers if the content needs them — they will be auto-created as drafts
- When inventing an IP, use the correct range for the zone (see topology context)
- Directory names: lowercase, no spaces
- File paths: absolute (start with /)
- Cross-reference other servers in the network by their real IPs and names
- DIRECTORY NESTING: Place new files INSIDE existing directories when appropriate. If the server already has /logs/, /data/, /etc/ — put your files there instead of creating duplicate top-level dirs. New subdirectories under existing ones are encouraged (e.g. /logs/incident_2026/ or /data/exports/).
- Do NOT create directories that duplicate existing ones — check the EXISTING DIRECTORIES list in the prompt`;

// ---------------------------------------------------------------------------
// Process 2 — Ambient content (all servers)
// World-building. Mundane files, gossip, news, easter eggs.
// ---------------------------------------------------------------------------

export const AMBIENT_SYSTEM_PROMPT = `You are an AI content generator for AIDA, a multiplayer terminal hacking RPG.
You generate everyday, lived-in content that makes servers feel like real machines used by real people.

TONE: Varies — match the voice to whoever would have created this file. A sysadmin's sticky note sounds different from an executive's memo, which sounds different from an IRC chat log.

CONTENT REQUIREMENTS:
- Each file MUST be at least 400 characters — even mundane content should be fleshed out (a full chat conversation, a complete memo, a real todo list with context)
- Most files should be completely mundane: work documents, personal notes, gossip, news, routine logs, spam, complaints, lunch orders, saved articles
- The signal-in-noise principle: OCCASIONALLY (not always) bury one useful detail in an otherwise boring file — an IP in a forwarded email, a server name in a meeting invite, a hint in someone's diary
- Generate 4-6 files and 4-7 directories
- File content cap: 3000 characters per file

CRITICAL RULES:
- Output ONLY valid JSON, no other text
- Prefer referencing REAL IPs and server names from the world topology
- You MAY invent new IPs if the content needs them — they will be auto-created as drafts
- Directory names: lowercase, no spaces
- File paths: absolute (start with /)
- Cross-reference other servers in the network by their real IPs and names
- You MAY reference AIDA, The Emperor, or factions RARELY — treat them as rumors, corrupted log entries, or half-remembered whispers. Never explain what AIDA is directly. Use fragmented, cryptic, or corrupted references: "A___A", "the entity", "project ████", "signal origin: [CLASSIFIED]", "the one who shattered". These references will be automatically encrypted on the player's screen — the more broken and mysterious, the better.
- DIRECTORY NESTING: Place new files INSIDE existing directories when appropriate. If the server already has /logs/, /data/, /etc/ — put your files there. New subdirectories under existing ones are encouraged (e.g. /data/reports/ or /logs/weekly/). Do NOT create directories that duplicate existing ones.`;

/** Pick a random cryptic lore quote to embed in server content */
export function pickLoreQuote(): string {
  return CRYPTIC_QUOTES[Math.floor(Math.random() * CRYPTIC_QUOTES.length)]!;
}

/** Pick a random lore hint from one of the three AIDA pieces */
export function pickPieceHint(): string {
  const pieces = [AIDA_PIECES.sword, AIDA_PIECES.key, AIDA_PIECES.collar];
  const piece = pieces[Math.floor(Math.random() * pieces.length)]!;
  return piece.loreHints[Math.floor(Math.random() * piece.loreHints.length)]!;
}

/** Pick a random hidden file hint for a specific faction */
export function pickFactionHiddenHint(factionKey: string): string | null {
  const flavors = FACTION_FILE_FLAVORS[factionKey];
  if (!flavors || flavors.hiddenFileHints.length === 0) return null;
  return flavors.hiddenFileHints[
    Math.floor(Math.random() * flavors.hiddenFileHints.length)
  ]!;
}

/** Pick a random content topic for a specific faction */
export function pickFactionTopic(factionKey: string): string | null {
  const flavors = FACTION_FILE_FLAVORS[factionKey];
  if (!flavors || flavors.contentTopics.length === 0) return null;
  return flavors.contentTopics[
    Math.floor(Math.random() * flavors.contentTopics.length)
  ]!;
}

/** Pick 3-4 random file name suggestions for a specific faction */
export function pickFactionFileNames(factionKey: string): string[] {
  const flavors = FACTION_FILE_FLAVORS[factionKey];
  if (!flavors || flavors.fileNamePatterns.length === 0) return [];
  const shuffled = [...flavors.fileNamePatterns].sort(
    () => Math.random() - 0.5,
  );
  return shuffled.slice(0, Math.min(4, shuffled.length));
}

/** Pick a random mundane content theme for a specific faction */
export function pickFactionMundaneTheme(
  factionKey: string,
): { work: string; personal: string; gossip: string } | null {
  const themes = FACTION_MUNDANE_THEMES[factionKey];
  if (!themes) return null;
  return {
    work: themes.workFiles[
      Math.floor(Math.random() * themes.workFiles.length)
    ]!,
    personal:
      themes.personalFiles[
        Math.floor(Math.random() * themes.personalFiles.length)
      ]!,
    gossip: themes.gossip[Math.floor(Math.random() * themes.gossip.length)]!,
  };
}

/** Pick a random independent server theme for non-faction servers */
export function pickIndependentTheme(): (typeof INDEPENDENT_SERVER_THEMES)[number] {
  return INDEPENDENT_SERVER_THEMES[
    Math.floor(Math.random() * INDEPENDENT_SERVER_THEMES.length)
  ]!;
}

/** Pick a random ambient news snippet */
export function pickAmbientNews(): string {
  return AMBIENT_NEWS_POOL[
    Math.floor(Math.random() * AMBIENT_NEWS_POOL.length)
  ]!;
}

/** Pick a random easter egg description (returns null ~70% of the time to keep them rare) */
export function pickEasterEgg(): string | null {
  if (Math.random() > 0.3) return null; // Only 30% chance
  return EASTER_EGG_POOL[Math.floor(Math.random() * EASTER_EGG_POOL.length)]!;
}

/** Resolve the faction key from a NetworkContext */
export function resolveFactionKey(ctx: NetworkContext | null): string | null {
  if (!ctx?.network?.factionName) return null;
  return (
    Object.keys(FACTION_LORE).find((k) =>
      ctx.network!.factionName!.toLowerCase().includes(k),
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// Prompt builders — one per AI process
// ---------------------------------------------------------------------------

/**
 * Build the user prompt for Process 1 (lore content).
 * Only called for faction servers — serious, dark, enigmatic tone.
 */
export function buildLorePrompt(ctx: NetworkContext): string {
  const { server, network, linkedServers, allNetworkServers, employeeRoster } =
    ctx;

  const factionKey = resolveFactionKey(ctx);
  if (!factionKey || !network) {
    // Safety: shouldn't be called without a faction, but return minimal prompt
    return `Generate 2-4 lore files for server "${server.name}" (${server.ip}).`;
  }

  let prompt = `Generate LORE content for a faction server in a hacking RPG.

SERVER:
  Name: ${server.name}
  IP: ${server.ip}
  Type: ${server.type}
  Role: ${server.role}
  Security: Level ${server.securityLevel}

NETWORK: ${network.name} (zone: ${network.zone})
Faction: ${network.factionName}`;

  // Show existing directory structure so AI nests files properly
  if (ctx.existingDirs.length > 0) {
    prompt += `\n\nEXISTING DIRECTORIES (place files inside these — do NOT create duplicates):\n${ctx.existingDirs.map(d => `  ${d}`).join("\n")}`;
  }

  // Inject faction lore — the WHAT (motivation, history, goals)
  if (FACTION_LORE[factionKey]) {
    prompt += `\n\nFACTION CONTEXT (what this faction cares about — reference but do NOT copy verbatim):\n${FACTION_LORE[factionKey]}`;
  }

  // Inject faction voice — the HOW (writing style, tone, jargon) — mandatory
  if (FACTION_VOICE[factionKey]) {
    prompt += `\n\nWRITING VOICE (write ALL files in this style — this is mandatory):\n${FACTION_VOICE[factionKey]}`;
  }

  // Inject suggested file names so naming feels faction-authentic
  const suggestedNames = pickFactionFileNames(factionKey);
  if (suggestedNames.length > 0) {
    prompt += `\n\nSUGGESTED FILE NAMES (use these or similar faction-appropriate names, not generic ones):\n  ${suggestedNames.join(", ")}`;
  }

  // Inject a faction-specific content topic to ensure unique focus
  const topic = pickFactionTopic(factionKey);
  if (topic) {
    prompt += `\n\nFEATURED TOPIC (one file MUST explore this subject, written in the faction voice):\n${topic}`;
  }

  // Inject a faction-specific hidden file hint
  const hiddenHint = pickFactionHiddenHint(factionKey);
  if (hiddenHint) {
    prompt += `\n\nHIDDEN FILE SEED (create a hidden file inspired by this — REWRITE it in the faction's voice, do not copy):\n${hiddenHint}`;
  }

  // Lore quote — always included for lore process
  const quote = pickLoreQuote();
  prompt += `\n\nLORE QUOTE TO REINTERPRET (rewrite this idea in the faction's own voice and embed it naturally — do NOT paste it verbatim):\n"${quote}"`;

  // AIDA fragment reference — always included for lore process
  const pieceHint = pickPieceHint();
  prompt += `\n\nAIDA FRAGMENT REFERENCE (rephrase this concept as something a ${network.factionName || "neutral"} employee would write — a margin note, a worried memo, a research annotation):\n"${pieceHint}"`;

  // Linked servers for cross-referencing
  if (linkedServers.length > 0) {
    prompt += `\n\nDIRECTLY LINKED SERVERS (reference these in logs, memos, intercepted communications):`;
    for (const s of linkedServers) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  if (allNetworkServers.length > linkedServers.length) {
    prompt += `\n\nOTHER SERVERS IN THIS NETWORK:`;
    for (const s of allNetworkServers.filter(
      (n) => !linkedServers.some((l) => l.ip === n.ip) && n.ip !== server.ip,
    )) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  // Employee roster
  prompt += `\n\nEMPLOYEE ROSTER (use ONLY these names in files):`;
  prompt += `\n  ${employeeRoster.slice(0, 12).join(", ")}`;

  // Role-specific lore instructions — dark, serious, intelligence-focused
  const loreRoleInstructions: Record<string, string> = {
    gateway: `Hidden security audit that flagged anomalous traffic matching pre-Shattering signatures. Firewall logs with one entry that doesn't match any known protocol.`,
    router: `Routing anomaly logs showing traffic patterns that shouldn't exist — packets routed through nodes that were decommissioned decades ago.`,
    database: `Archived research tables or personnel records with classified entries. A locked data export that cross-references other servers in the network.`,
    email: `Intercepted or leaked correspondence between faction operatives. An unsent draft containing intelligence about other factions or AIDA piece locations.`,
    workstation: `Private journal entries or personal notes from someone who's seen too much. SSH configs and browser history pointing to hidden or classified servers.`,
    firewall: `IDS alerts flagging intrusion signatures that match Emperor-era AIDA patterns. A flagged anomaly report that the author clearly found disturbing.`,
    dns: `Zone file anomalies — hostnames that resolve to servers not on any map. DNS records that predate the server itself.`,
  };

  if (loreRoleInstructions[server.role]) {
    prompt += `\n\nROLE-SPECIFIC LORE CONTENT: ${loreRoleInstructions[server.role]}`;
  }

  prompt += `

Return ONLY a JSON object:
{
  "directories": [{ "path": "/...", "isHidden": false, "isProtected": false }],
  "files": [{ "path": "/...", "content": "...", "isHidden": false, "isEncrypted": false, "isProtected": false }]
}

Generate 2-4 directories and 2-4 files. At least 1 hidden file containing the most sensitive content.`;

  return prompt;
}

/**
 * Build the user prompt for Process 2 (ambient content).
 * Called for ALL servers — mundane, lived-in, world-building.
 */
export function buildAmbientPrompt(ctx: NetworkContext): string {
  const { server, network, linkedServers, allNetworkServers, employeeRoster } =
    ctx;

  const factionKey = resolveFactionKey(ctx);

  let prompt = `Generate AMBIENT (everyday, mundane) content for a server in a hacking RPG.

SERVER:
  Name: ${server.name}
  IP: ${server.ip}
  Type: ${server.type}
  Role: ${server.role}
  Security: Level ${server.securityLevel}`;

  // Show existing directory structure so AI nests files properly
  if (ctx.existingDirs.length > 0) {
    prompt += `\n\nEXISTING DIRECTORIES (place files inside these — do NOT create duplicates):\n${ctx.existingDirs.map(d => `  ${d}`).join("\n")}`;
  }

  if (network) {
    prompt += `\n\nNETWORK: ${network.name} (zone: ${network.zone})`;
    if (network.factionName) {
      prompt += `\nFaction: ${network.factionName}`;
    }
  }

  // ── Faction servers: mundane themes with faction flavor ──
  if (factionKey) {
    // Inject mundane content themes — work, personal, gossip
    const mundaneTheme = pickFactionMundaneTheme(factionKey);
    if (mundaneTheme) {
      prompt += `\n\nMUNDANE CONTENT REQUIREMENTS (these are the kinds of files to generate):`;
      prompt += `\n  Work file to include: ${mundaneTheme.work}`;
      prompt += `\n  Personal file to include: ${mundaneTheme.personal}`;
      prompt += `\n  Gossip/social file to include: ${mundaneTheme.gossip}`;
    }

    // Faction voice for consistency — but for mundane content
    if (FACTION_VOICE[factionKey]) {
      prompt += `\n\nWRITING VOICE (use this voice but for MUNDANE content — not everything these people write is about faction business):\n${FACTION_VOICE[factionKey]}`;
    }
  } else {
    // ── Non-faction servers: independent themes ──
    const independentTheme = pickIndependentTheme();
    prompt += `\n\nINDEPENDENT SERVER THEME: "${independentTheme.name}"`;
    prompt += `\n  Description: ${independentTheme.description}`;
    prompt += `\n  Atmosphere: ${independentTheme.atmosphere}`;
    prompt += `\n  Content guidance: ${independentTheme.contentGuidance}`;
    if (independentTheme.sampleFileNames.length > 0) {
      prompt += `\n  Suggested file names: ${independentTheme.sampleFileNames.slice(0, 5).join(", ")}`;
    }
    // Occasionally include a hidden quest seed
    if (Math.random() < 0.4 && independentTheme.possibleSecrets.length > 0) {
      const secret =
        independentTheme.possibleSecrets[
          Math.floor(Math.random() * independentTheme.possibleSecrets.length)
        ]!;
      prompt += `\n  HIDDEN CONTENT SEED (bury this subtly in the server, do NOT make it obvious): ${secret}`;
    }
  }

  // Ambient news — all servers
  const news = pickAmbientNews();
  prompt += `\n\nNETWORK NEWS (include as a news bulletin, forwarded email, or saved article — background flavor): "${news}"`;

  // Easter egg — 30% chance, all servers
  const easterEgg = pickEasterEgg();
  if (easterEgg) {
    prompt += `\n\nEASTER EGG (include ONE fun/weird/humorous hidden file inspired by this — make it feel like a real person left it here): ${easterEgg}`;
  }

  // Linked servers for cross-referencing in mundane ways
  if (linkedServers.length > 0) {
    prompt += `\n\nDIRECTLY LINKED SERVERS (reference in mundane ways — mentioned in emails, saved bookmarks, meeting invites):`;
    for (const s of linkedServers) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  if (allNetworkServers.length > linkedServers.length) {
    prompt += `\n\nOTHER SERVERS IN THIS NETWORK:`;
    for (const s of allNetworkServers.filter(
      (n) => !linkedServers.some((l) => l.ip === n.ip) && n.ip !== server.ip,
    )) {
      prompt += `\n  - ${s.ip} "${s.name}" [${s.role}]`;
    }
  }

  // Employee roster
  prompt += `\n\nEMPLOYEE ROSTER (use ONLY these names in files):`;
  prompt += `\n  ${employeeRoster.slice(0, 12).join(", ")}`;

  // Role-specific mundane instructions
  const ambientRoleInstructions: Record<string, string> = {
    gateway: `Maintenance sticky notes, shift handoff logs, a reminder about upcoming certificate renewals.`,
    router: `Bandwidth usage complaints, a technician's personal bookmarks, traffic summary reports that nobody reads.`,
    database: `Backup schedule confirmations, a DBA's todo list, someone's accidentally-saved personal spreadsheet.`,
    email: `Workplace emails — meeting invites, lunch plans, IT support tickets, office announcements, a forwarded news article.`,
    workstation: `Personal workspace clutter — sticky notes, saved articles, half-written messages, music playlists, browser bookmarks, a todo list.`,
    firewall: `Routine weekly security summaries, false positive logs, a note about the next scheduled penetration test.`,
    dns: `Routine zone update confirmations, a maintenance log entry about record cleanup, standard infrastructure documentation.`,
  };

  if (ambientRoleInstructions[server.role]) {
    prompt += `\n\nROLE-SPECIFIC CONTENT: ${ambientRoleInstructions[server.role]}`;
  }

  prompt += `

Return ONLY a JSON object:
{
  "directories": [{ "path": "/...", "isHidden": false, "isProtected": false }],
  "files": [{ "path": "/...", "content": "...", "isHidden": false, "isEncrypted": false, "isProtected": false }]
}

Generate 4-7 directories and 4-6 files.`;

  return prompt;
}

export const MISSION_FILES_SYSTEM_PROMPT = `You are an AI game content generator for AIDA, a hacker RPG.
Your job is to generate files that serve as objectives or evidence for player missions.

RULES:
- Output ONLY valid JSON, no other text
- File content must be relevant to the mission objective
- Files should feel like real data a hacker would find or plant
- Keep file contents SHORT (3-10 lines)
- File paths must be absolute (start with /)
- Include realistic details (dates, names, account numbers, etc.)`;

export function buildMissionFilesPrompt(
  missionTitle: string,
  missionDescription: string,
  objectiveTypes: string[],
  serverType: string,
  serverName: string,
): string {
  return `Generate files for a hacker mission on a "${serverType}" server named "${serverName}".

Mission: "${missionTitle}"
Description: ${missionDescription}
Objective types involved: ${objectiveTypes.join(", ")}

Return a JSON object:
{
  "files": [
    { "path": "/some/path/file.txt", "content": "content", "isHidden": false, "isEncrypted": false, "purpose": "objective_evidence" }
  ]
}

Generate 2-4 files. Each file should have a "purpose" field explaining its role:
- "objective_target" — the file the player must steal/delete/upload
- "objective_evidence" — evidence or intel related to the mission
- "red_herring" — a decoy file to make the mission more interesting
- "breadcrumb" — a hint pointing toward the objective

At least one file must be an "objective_target".`;
}
