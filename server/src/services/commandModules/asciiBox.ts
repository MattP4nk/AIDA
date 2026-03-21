/**
 * asciiBox.ts — Shared ASCII box-drawing utilities for terminal UI
 *
 * Provides consistent, reusable formatting helpers for all command modules.
 * Uses Unicode box-drawing characters for a cohesive hacker terminal aesthetic.
 *
 * Box styles:
 *   Double-line (╔═╗║╚╝) — used for major panels, dashboards, headers
 *   Single-line (┌─┐│└┘) — used for tables, sub-sections, inline boxes
 *   Mixed       (╠═╣)    — used for section dividers within double-line boxes
 */

// ═══════════════════════════════════════════════════════════════
//  LOW-LEVEL PRIMITIVES
// ═══════════════════════════════════════════════════════════════

/** Pad or truncate a string to exactly `len` characters (left-aligned). */
export function pad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + " ".repeat(len - str.length);
}

/** Pad or truncate a string to exactly `len` characters (right-aligned). */
export function padRight(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : " ".repeat(len - str.length) + str;
}

/** Center a string within `len` characters. */
export function center(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  const leftPad = Math.floor((len - str.length) / 2);
  const rightPad = len - str.length - leftPad;
  return " ".repeat(leftPad) + str + " ".repeat(rightPad);
}

/** Format a duration in ms to a human-readable string. */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Render a progress bar: [████░░░░░░] 42% */
export function progressBar(ratio: number, width = 10): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(width - filled)}] ${(clamped * 100).toFixed(0)}%`;
}

/** Render a reputation bar: [▓▓▓▓▓░░░░░] — maps -100..+100 to 0..width */
export function repBar(rep: number, width = 10): string {
  const normalized = Math.round(((rep + 100) / 200) * width);
  const filled = Math.max(0, Math.min(width, normalized));
  return "[" + "▓".repeat(filled) + "░".repeat(width - filled) + "]";
}

// ═══════════════════════════════════════════════════════════════
//  DOUBLE-LINE BOX (for major panels / dashboards)
// ═══════════════════════════════════════════════════════════════

/** ╔══════════════════════════════╗ */
export function boxTop(width: number): string {
  return `╔${"═".repeat(width + 2)}╗`;
}

/** ╚══════════════════════════════╝ */
export function boxBottom(width: number): string {
  return `╚${"═".repeat(width + 2)}╝`;
}

/** ╠══════════════════════════════╣ */
export function boxDivider(width: number): string {
  return `╠${"═".repeat(width + 2)}╣`;
}

/** ║  content padded to width     ║ */
export function boxRow(content: string, width: number): string {
  return `║ ${pad(content, width)} ║`;
}

/** ║  Label:           Value      ║ — aligned label-value pair */
export function boxLine(label: string, value: string, width: number): string {
  const content = `  ${label}${value}`;
  return `║ ${pad(content, width)} ║`;
}

/** ║        CENTERED TEXT         ║ */
export function boxCenter(text: string, width: number): string {
  return `║ ${center(text, width)} ║`;
}

/**
 * Build a complete double-line panel with a title and key-value body.
 *
 * Example:
 *   ╔══════════════════════════════╗
 *   ║  SYSTEM STATUS               ║
 *   ╠══════════════════════════════╣
 *   ║    Uptime:       3h 12m      ║
 *   ║    Players:      7           ║
 *   ╚══════════════════════════════╝
 */
export function panel(
  title: string,
  rows: Array<{ label: string; value: string }>,
  width = 44,
): string[] {
  const lines: string[] = [
    boxTop(width),
    boxRow(title, width),
    boxDivider(width),
  ];
  for (const row of rows) {
    lines.push(boxLine(row.label, row.value, width));
  }
  lines.push(boxBottom(width));
  return lines;
}

/**
 * Build a double-line panel with multiple titled sections.
 *
 * Example:
 *   ╔══════════════════════════════╗
 *   ║  PLAYER INFO: alice          ║
 *   ╠══════════════════════════════╣
 *   ║    Level:        5           ║
 *   ║    Credits:      1200        ║
 *   ╠══════════════════════════════╣
 *   ║  SKILLS                      ║
 *   ╠══════════════════════════════╣
 *   ║    Hacking:      42          ║
 *   ╚══════════════════════════════╝
 */
export function multiPanel(
  title: string,
  sections: Array<{
    heading?: string;
    rows: Array<{ label: string; value: string }>;
  }>,
  width = 44,
): string[] {
  const lines: string[] = [
    boxTop(width),
    boxRow(title, width),
  ];
  for (const section of sections) {
    lines.push(boxDivider(width));
    if (section.heading) {
      lines.push(boxRow(section.heading, width));
      lines.push(boxDivider(width));
    }
    for (const row of section.rows) {
      lines.push(boxLine(row.label, row.value, width));
    }
  }
  lines.push(boxBottom(width));
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  SINGLE-LINE TABLE (for tabular data)
// ═══════════════════════════════════════════════════════════════

export interface Column {
  /** Header label */
  header: string;
  /** Fixed width of the column content area */
  width: number;
  /** Alignment: "left" (default) or "right" */
  align?: "left" | "right";
}

/**
 * Build a complete single-line table with headers, rows, and optional footer.
 *
 * Example:
 *   ┌──────────────┬───────┬──────────┐
 *   │ USERNAME     │ LEVEL │ STATUS   │
 *   ├──────────────┼───────┼──────────┤
 *   │ alice        │     5 │ online   │
 *   │ bob          │     3 │ idle     │
 *   └──────────────┴───────┴──────────┘
 *    2 player(s) online
 */
export function table(
  columns: Column[],
  rows: string[][],
  footer?: string,
): string[] {
  // Build horizontal rules
  const topRule = "┌" + columns.map(c => "─".repeat(c.width + 2)).join("┬") + "┐";
  const midRule = "├" + columns.map(c => "─".repeat(c.width + 2)).join("┼") + "┤";
  const botRule = "└" + columns.map(c => "─".repeat(c.width + 2)).join("┴") + "┘";

  // Build header row
  const headerRow = "│" + columns.map(c =>
    ` ${pad(c.header, c.width)} `
  ).join("│") + "│";

  // Build data rows
  const dataRows = rows.map(row =>
    "│" + columns.map((col, i) => {
      const cell = row[i] ?? "";
      const formatted = col.align === "right" ? padRight(cell, col.width) : pad(cell, col.width);
      return ` ${formatted} `;
    }).join("│") + "│"
  );

  const lines = [topRule, headerRow, midRule, ...dataRows, botRule];
  if (footer) {
    lines.push(` ${footer}`);
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  SINGLE-LINE BOX (for info panels, help text, smaller UI)
// ═══════════════════════════════════════════════════════════════

/** ┌──────────────────────────────┐ */
export function sBoxTop(width: number): string {
  return `┌${"─".repeat(width + 2)}┐`;
}

/** └──────────────────────────────┘ */
export function sBoxBottom(width: number): string {
  return `└${"─".repeat(width + 2)}┘`;
}

/** ├──────────────────────────────┤ */
export function sBoxDivider(width: number): string {
  return `├${"─".repeat(width + 2)}┤`;
}

/** │  content padded to width     │ */
export function sBoxRow(content: string, width: number): string {
  return `│ ${pad(content, width)} │`;
}

/** │        CENTERED TEXT         │ */
export function sBoxCenter(text: string, width: number): string {
  return `│ ${center(text, width)} │`;
}

/**
 * Build a complete single-line info box.
 *
 * Example:
 *   ┌──────────────────────────────┐
 *   │  ANALYSIS REPORT             │
 *   ├──────────────────────────────┤
 *   │  Type:       file            │
 *   │  Size:       1024 bytes      │
 *   │  Encrypted:  No              │
 *   └──────────────────────────────┘
 */
export function infoBox(
  title: string,
  rows: Array<{ label: string; value: string }>,
  width = 40,
): string[] {
  const lines: string[] = [
    sBoxTop(width),
    sBoxRow(title, width),
    sBoxDivider(width),
  ];
  for (const row of rows) {
    const content = `  ${row.label}${row.value}`;
    lines.push(sBoxRow(content, width));
  }
  lines.push(sBoxBottom(width));
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  HELP / MENU PANELS
// ═══════════════════════════════════════════════════════════════

export interface HelpEntry {
  /** Command syntax, e.g. "faction join <name>" */
  command: string;
  /** Short description */
  description: string;
}

/**
 * Build a double-line help/menu panel with command listings.
 *
 * Example:
 *   ╔══════════════════════════════════════════════╗
 *   ║  FACTION MANAGEMENT                          ║
 *   ╠══════════════════════════════════════════════╣
 *   ║  faction list         List factions          ║
 *   ║  faction join <name>  Join a faction         ║
 *   ╚══════════════════════════════════════════════╝
 */
export function helpPanel(
  title: string,
  entries: HelpEntry[],
  width = 50,
): string[] {
  // Determine the widest command for alignment
  const cmdWidth = Math.min(
    Math.max(...entries.map(e => e.command.length), 10) + 2,
    Math.floor(width * 0.5),
  );

  const lines: string[] = [
    boxTop(width),
    boxRow(title, width),
    boxDivider(width),
  ];

  for (const entry of entries) {
    const content = `  ${pad(entry.command, cmdWidth)}${entry.description}`;
    lines.push(boxRow(content, width));
  }

  lines.push(boxBottom(width));
  return lines;
}

/**
 * Build a help panel with multiple sections (e.g., moderator vs admin commands).
 */
export function helpPanelSections(
  title: string,
  sections: Array<{
    heading: string;
    entries: HelpEntry[];
  }>,
  width = 50,
): string[] {
  // Global command width across all sections
  const allEntries = sections.flatMap(s => s.entries);
  const cmdWidth = Math.min(
    Math.max(...allEntries.map(e => e.command.length), 10) + 2,
    Math.floor(width * 0.5),
  );

  const lines: string[] = [
    boxTop(width),
    boxRow(title, width),
  ];

  for (const section of sections) {
    lines.push(boxDivider(width));
    lines.push(boxRow(section.heading, width));
    for (const entry of section.entries) {
      const content = `  ${pad(entry.command, cmdWidth)}${entry.description}`;
      lines.push(boxRow(content, width));
    }
  }

  lines.push(boxBottom(width));
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  LIST / LOG DISPLAY
// ═══════════════════════════════════════════════════════════════

/**
 * Build a bordered list with a title.
 *
 * Example:
 *   ┌──────────────────────────────┐
 *   │  CONTACTS                    │
 *   ├──────────────────────────────┤
 *   │  • alice (online)            │
 *   │  • bob (offline)             │
 *   └──────────────────────────────┘
 */
export function list(
  title: string,
  items: string[],
  width = 40,
  bullet = "•",
): string[] {
  const lines: string[] = [
    sBoxTop(width),
    sBoxRow(title, width),
    sBoxDivider(width),
  ];

  if (items.length === 0) {
    lines.push(sBoxRow("  (empty)", width));
  } else {
    for (const item of items) {
      lines.push(sBoxRow(`  ${bullet} ${item}`, width));
    }
  }

  lines.push(sBoxBottom(width));
  return lines;
}

/**
 * Build a numbered log display (e.g., command history, audit log).
 *
 * Example:
 *   ┌──────────────────────────────────────┐
 *   │  COMMAND HISTORY                     │
 *   ├──────────────────────────────────────┤
 *   │    1  10:30:15  scan                 │
 *   │    2  10:30:22  connect 192.168.1.1  │
 *   └──────────────────────────────────────┘
 *    2 entries
 */
export function numberedLog(
  title: string,
  entries: Array<{ index: number; time: string; text: string }>,
  width = 50,
  footer?: string,
): string[] {
  const lines: string[] = [
    sBoxTop(width),
    sBoxRow(title, width),
    sBoxDivider(width),
  ];

  if (entries.length === 0) {
    lines.push(sBoxRow("  (no entries)", width));
  } else {
    for (const entry of entries) {
      const num = String(entry.index).padStart(4);
      const content = `  ${num}  ${pad(entry.time, 10)} ${entry.text}`;
      lines.push(sBoxRow(content, width));
    }
  }

  lines.push(sBoxBottom(width));
  if (footer) {
    lines.push(` ${footer}`);
  }
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  SECTION BUILDERS (for multi-section output like status, whois)
// ═══════════════════════════════════════════════════════════════

/**
 * Build a "category" header inside a double-line box.
 * Returns an array of lines: [divider, centered heading, divider]
 */
export function sectionHeader(heading: string, width: number): string[] {
  return [
    boxDivider(width),
    boxRow(heading, width),
    boxDivider(width),
  ];
}

// ═══════════════════════════════════════════════════════════════
//  STATUS / DASHBOARD CARDS
// ═══════════════════════════════════════════════════════════════

/**
 * Build a compact status card (small inline box).
 *
 * Example:
 *   ┌─ STATUS ──────────────────┐
 *   │  Connected: YES           │
 *   │  Server:    10.0.0.1      │
 *   └──────────────────────────-┘
 */
export function statusCard(
  label: string,
  rows: Array<{ label: string; value: string }>,
  width = 34,
): string[] {
  // Build a titled top rule
  const titlePart = `─ ${label} `;
  const remainingDashes = Math.max(0, width + 2 - titlePart.length);
  const topLine = `┌${titlePart}${"─".repeat(remainingDashes)}┐`;

  const lines: string[] = [topLine];
  for (const row of rows) {
    const content = `  ${row.label}${row.value}`;
    lines.push(`│ ${pad(content, width)} │`);
  }
  lines.push(sBoxBottom(width));
  return lines;
}

// ═══════════════════════════════════════════════════════════════
//  CONVENIENCE: join lines into a single output string
// ═══════════════════════════════════════════════════════════════

/** Join an array of lines into a single newline-separated string. */
export function render(lines: string[]): string {
  return lines.join("\n");
}

/**
 * Join multiple line arrays into a single output string with a blank line between sections.
 */
export function renderSections(...sections: string[][]): string {
  return sections.map(s => s.join("\n")).join("\n");
}
