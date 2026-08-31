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
//  GLOBAL TERMINAL WIDTH
// ═══════════════════════════════════════════════════════════════

/** Default terminal output width. All panels, tables, and boxes use this. */
export const TERM_WIDTH = 70;

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
  totalWidth?: number,
): string[] {
  // Auto-distribute column widths if totalWidth is provided
  const cols = totalWidth ? autoSizeColumns(columns, totalWidth) : columns;

  // Build horizontal rules
  const topRule = "┌" + cols.map(c => "─".repeat(c.width + 2)).join("┬") + "┐";
  const midRule = "├" + cols.map(c => "─".repeat(c.width + 2)).join("┼") + "┤";
  const botRule = "└" + cols.map(c => "─".repeat(c.width + 2)).join("┴") + "┘";

  // Build header row
  const headerRow = "│" + cols.map(c =>
    ` ${pad(c.header, c.width)} `
  ).join("│") + "│";

  // Build data rows
  const dataRows = rows.map(row =>
    "│" + cols.map((col, i) => {
      const cell = (row[i] ?? "").slice(0, col.width); // truncate to column width
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

/**
 * Auto-size column widths to fill the target total width.
 * Each column's original width is treated as a weight for proportional distribution.
 */
function autoSizeColumns(columns: Column[], totalWidth: number): Column[] {
  // Total border overhead: │ + (space + content + space) per column + │ between columns
  // = 1 (left border) + cols * 3 (space+content+space per col) + (cols-1) * 1 (│ separators)
  // Wait: each cell is ` ${content} ` = width + 2, separated by │
  // Total = 1 + sum(width + 2) + (n-1) * 1 + ... no:
  // "│" + columns.map(" content ").join("│") + "│"
  // = 1 + n*(width+2) + (n-1) + 1 = n*width + 2n + n - 1 + 2 = n*width + 3n + 1
  const n = columns.length;
  const overhead = 3 * n + 1; // border chars + padding
  const available = Math.max(totalWidth - overhead, n * 4); // at least 4 chars per col

  const totalWeight = columns.reduce((sum, c) => sum + c.width, 0);

  return columns.map(c => ({
    ...c,
    width: Math.max(4, Math.floor((c.width / totalWeight) * available)),
  }));
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
  width = TERM_WIDTH,
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
  width = TERM_WIDTH,
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
/**
 * Pack items into width-aware columns, filled column-major like a real `ls`.
 *
 * Boxes are right for output you read once (reports); they are wrong for output
 * you read hundreds of times a session. A 30-entry directory rendered one
 * bullet per line is 30+ lines of scrollback where a real shell gives you four
 * dense columns — see SHELL_DESIGN.md §10a.
 */
export function columns(
  items: string[],
  termWidth = TERM_WIDTH,
  gutter = 2,
): string[] {
  if (items.length === 0) return [];

  const maxLen = items.reduce((m, s) => Math.max(m, s.length), 0);
  const colWidth = maxLen + gutter;

  // At least one column, even if a single name is wider than the terminal.
  const cols = Math.max(1, Math.floor(termWidth / colWidth));
  if (cols === 1) return items.slice();

  const rows = Math.ceil(items.length / cols);
  const lines: string[] = [];

  // Column-major fill: reading *down* each column is alphabetical, which is
  // what `ls` does and what people's eyes expect.
  for (let r = 0; r < rows; r++) {
    let line = "";
    for (let c = 0; c < cols; c++) {
      const idx = c * rows + r;
      if (idx >= items.length) continue;
      const item = items[idx]!;
      const isLastInRow = idx + rows >= items.length;
      line += isLastInRow ? item : item.padEnd(colWidth);
    }
    lines.push(line.trimEnd());
  }

  return lines;
}

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
