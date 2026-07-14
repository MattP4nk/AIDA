/**
 * Connection Challenge Generator
 *
 * Pure module (no DI) that generates and validates connection challenges.
 * Two challenge types:
 *   - handshake: TCP-style SYN/ACK puzzle for structured networks
 *   - signal_trace: Hex grid path-following for chaotic/darknet networks
 *
 * Mirrors the pattern of hackMinigameGenerator.ts.
 */

import type { ConnectionChallenge, ConnectionChallengeType } from "../../../shared/types";
import {
  HANDSHAKE_CONFIG,
  SIGNAL_TRACE_CONFIG,
  SIGNAL_TRACE_FACTIONS,
  SIGNAL_TRACE_ZONES,
  getChallengeTier,
  getConnectionDifficulty,
} from "../config/gameBalance";

// ═══════════════════════════════════════════════════════════════════
// Challenge Type Selection
// ═══════════════════════════════════════════════════════════════════

/**
 * Select challenge type based on server context.
 * Underground/darknet → signal_trace. Structured networks → handshake.
 */
export function selectChallengeType(
  factionId: string | null | undefined,
  networkZone: string | null | undefined,
): ConnectionChallengeType {
  if (factionId && SIGNAL_TRACE_FACTIONS.has(factionId)) return "signal_trace";
  if (networkZone && SIGNAL_TRACE_ZONES.has(networkZone)) return "signal_trace";
  return "handshake";
}

// ═══════════════════════════════════════════════════════════════════
// Known Ports (for handshake puzzle realism)
// ═══════════════════════════════════════════════════════════════════

const KNOWN_PORTS: Array<{ port: number; service: string; protocol: string }> = [
  { port: 21, service: "ftp", protocol: "TCP" },
  { port: 22, service: "ssh", protocol: "TCP" },
  { port: 25, service: "smtp", protocol: "TCP" },
  { port: 53, service: "dns", protocol: "UDP" },
  { port: 80, service: "http", protocol: "TCP" },
  { port: 110, service: "pop3", protocol: "TCP" },
  { port: 143, service: "imap", protocol: "TCP" },
  { port: 443, service: "https", protocol: "TCP" },
  { port: 993, service: "imaps", protocol: "TCP" },
  { port: 1433, service: "mssql", protocol: "TCP" },
  { port: 3306, service: "mysql", protocol: "TCP" },
  { port: 3389, service: "rdp", protocol: "TCP" },
  { port: 5432, service: "postgres", protocol: "TCP" },
  { port: 6379, service: "redis", protocol: "TCP" },
  { port: 8080, service: "http-alt", protocol: "TCP" },
  { port: 8443, service: "https-alt", protocol: "TCP" },
  { port: 27017, service: "mongodb", protocol: "TCP" },
];

// ═══════════════════════════════════════════════════════════════════
// Handshake Challenge Generator
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a TCP handshake challenge.
 * Player sees SYN packets with ports/flags/windows. Must identify valid
 * SYN packets (non-RST, window > 0) and respond with ACK = SEQ + 1,
 * in ascending port order.
 */
export function generateHandshakeChallenge(
  difficulty: number,
  networkingSkill: number = 0,
): ConnectionChallenge {
  const tier = getChallengeTier(difficulty);
  const config = HANDSHAKE_CONFIG[tier];

  // Shuffle and pick ports
  const shuffled = [...KNOWN_PORTS].sort(() => Math.random() - 0.5);
  const allPorts = shuffled.slice(0, config.packets);

  // Randomly assign which are "real" (valid SYN) vs "decoy" (RST/closed)
  const realIndices = new Set<number>();
  while (realIndices.size < config.real) {
    realIndices.add(Math.floor(Math.random() * allPorts.length));
  }

  interface Packet {
    seq: number;
    port: number;
    service: string;
    flags: string;
    window: number;
    isReal: boolean;
  }

  const packets: Packet[] = allPorts.map((p, i) => {
    const isReal = realIndices.has(i);
    const seq = 1000 + Math.floor(Math.random() * 60000);
    return {
      seq,
      port: p.port,
      service: p.service,
      flags: isReal ? "SYN" : (Math.random() > 0.5 ? "SYN,RST" : "RST"),
      window: isReal ? [16384, 32768, 65535][Math.floor(Math.random() * 3)]! : 0,
      isReal,
    };
  });

  // Sort display by port for readability
  packets.sort((a, b) => a.port - b.port);

  // Solution: ACK values (seq+1) of real packets, sorted by port ascending
  const realPackets = packets.filter(p => p.isReal).sort((a, b) => a.port - b.port);
  const solution = realPackets.map(p => String(p.seq + 1)).join(" ");

  // Build display
  const lines: string[] = [
    "[TCP HANDSHAKE]",
    "═".repeat(55),
    "Incoming SYN packets from target server:",
    "",
    "  SEQ      PORT   SERVICE         FLAGS      WINDOW",
    "  ──────   ─────  ──────────────  ─────────  ──────",
  ];

  for (const p of packets) {
    const seq = String(p.seq).padEnd(6);
    const port = String(p.port).padEnd(5);
    const service = p.service.padEnd(14);
    const flags = p.flags.padEnd(9);
    const win = String(p.window);
    lines.push(`  ${seq}   ${port}  ${service}  ${flags}  ${win}`);
  }

  lines.push("");

  // Build hints — more hints at lower difficulty
  const hints: string[] = [
    `Respond to ${config.real} valid SYN packets (non-RST, window > 0)`,
    "ACK = SEQ + 1, in ascending port order",
  ];

  if (difficulty <= 3) {
    hints.push(`Look for packets with flags "SYN" (not "RST" or "SYN,RST")`);
  }
  if (networkingSkill >= 30) {
    hints.push(`Valid services: ${realPackets.map(p => p.service).join(", ")}`);
  }

  lines.push(`  Time: ${config.timeLimit}s | Attempts: ${config.maxAttempts}`);
  lines.push("");
  lines.push("Submit with: handshake.ack <ack1> <ack2> ...");

  return {
    type: "handshake",
    difficulty,
    displayText: lines,
    solution,
    hints,
    timeLimit: config.timeLimit,
    maxAttempts: config.maxAttempts,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Signal Trace Challenge Generator
// ═══════════════════════════════════════════════════════════════════

const ROW_LABELS = "ABCDEFGHIJKLMNOP";

/**
 * Generate a signal trace challenge.
 * Player sees a hex grid. A signal path starts at a given cell and follows
 * a pattern (incrementing by a fixed hex step). Player must trace the path
 * and identify the endpoint cell.
 */
export function generateSignalTraceChallenge(
  difficulty: number,
  networkingSkill: number = 0,
): ConnectionChallenge {
  const tier = getChallengeTier(difficulty);
  const config = SIGNAL_TRACE_CONFIG[tier];

  // Generate the grid filled with random hex values
  const grid: number[][] = [];
  for (let r = 0; r < config.rows; r++) {
    const row: number[] = [];
    for (let c = 0; c < config.cols; c++) {
      row.push(Math.floor(Math.random() * 256));
    }
    grid.push(row);
  }

  // Choose a hex step for the signal pattern (small enough to stay in byte range)
  const step = [0x05, 0x07, 0x08, 0x0A, 0x0B, 0x0D, 0x11][Math.floor(Math.random() * 7)]!;

  // Place the signal path: start at a random cell, move through adjacent cells
  const startRow = Math.floor(Math.random() * config.rows);
  const startCol = Math.floor(Math.random() * (config.cols - config.hops));
  let startVal = 0x10 + Math.floor(Math.random() * 0x80); // Keep in readable range

  // The path moves generally right/down through the grid
  const pathCells: Array<{ row: number; col: number }> = [];
  let curRow = startRow;
  let curCol = startCol;
  let curVal = startVal;

  for (let h = 0; h <= config.hops; h++) {
    // Clamp to grid bounds
    curRow = Math.min(curRow, config.rows - 1);
    curCol = Math.min(curCol, config.cols - 1);

    grid[curRow]![curCol] = curVal & 0xFF; // Mask to byte
    pathCells.push({ row: curRow, col: curCol });

    // Move to next cell (prefer right, sometimes down)
    if (h < config.hops) {
      curVal = (curVal + step) & 0xFF;
      if (Math.random() > 0.4 && curRow < config.rows - 1) {
        curRow++;
      } else {
        curCol = Math.min(curCol + 1, config.cols - 1);
      }
    }
  }

  // Add noise (false paths) — cells with same step but wrong path
  for (let n = 0; n < config.noise; n++) {
    const nr = Math.floor(Math.random() * config.rows);
    const nc = Math.floor(Math.random() * config.cols);
    if (!pathCells.some(p => p.row === nr && p.col === nc)) {
      grid[nr]![nc] = (startVal + step * (config.hops + n + 1)) & 0xFF;
    }
  }

  const endpoint = pathCells[pathCells.length - 1]!;
  const solution = `${ROW_LABELS[endpoint.row]}${endpoint.col}`;

  // Build display
  const colHeader = Array.from({ length: config.cols }, (_, i) => String(i).padStart(4)).join(" ");
  const lines: string[] = [
    "[SIGNAL TRACE]",
    "═".repeat(5 + config.cols * 5),
    "Darknet relay signal detected. Trace the route:",
    "",
    `     ${colHeader}`,
    `  ┌${"────┬".repeat(config.cols - 1)}────┐`,
  ];

  for (let r = 0; r < config.rows; r++) {
    const label = ROW_LABELS[r];
    const cells = grid[r]!.map(v => v.toString(16).toUpperCase().padStart(2, "0")).map(h => ` ${h} `).join("│");
    lines.push(`${label} │${cells}│`);
    if (r < config.rows - 1) {
      lines.push(`  ├${"────┼".repeat(config.cols - 1)}────┤`);
    }
  }

  lines.push(`  └${"────┴".repeat(config.cols - 1)}────┘`);
  lines.push("");

  const startCell = pathCells[0]!;
  const startHex = grid[startCell.row]![startCell.col]!.toString(16).toUpperCase().padStart(2, "0");
  const stepHex = step.toString(16).toUpperCase().padStart(2, "0");

  // Hints
  const hints: string[] = [
    `Signal origin: ${ROW_LABELS[startCell.row]}${startCell.col} (0x${startHex})`,
    `Pattern: each hop increments by 0x${stepHex}`,
    `Trace ${config.hops} hops from origin to endpoint`,
  ];

  if (networkingSkill >= 40) {
    // High-skill players get the second cell as a bonus hint
    const secondCell = pathCells[1]!;
    hints.push(`Second signal at: ${ROW_LABELS[secondCell.row]}${secondCell.col}`);
  }

  lines.push(`  Time: ${config.timeLimit}s | Attempts: ${config.maxAttempts}`);
  lines.push("");
  lines.push("Submit with: signal.trace <endpoint_cell>");

  return {
    type: "signal_trace",
    difficulty,
    displayText: lines,
    solution,
    hints,
    timeLimit: config.timeLimit,
    maxAttempts: config.maxAttempts,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Answer Validation
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate a player's connection challenge answer.
 */
export function validateConnectionAnswer(
  challenge: ConnectionChallenge,
  answer: string,
): { correct: boolean; feedback: string } {
  const norm = answer.trim().toUpperCase();
  const sol = challenge.solution.trim().toUpperCase();

  if (!norm) {
    return { correct: false, feedback: "No answer provided." };
  }

  switch (challenge.type) {
    case "handshake": {
      const answerParts = norm.split(/[\s,]+/).filter(Boolean).join(" ");
      if (answerParts === sol) {
        return { correct: true, feedback: "Handshake complete! Connection established." };
      }
      // Check if right values but wrong order
      const answerSet = new Set(answerParts.split(" "));
      const solSet = new Set(sol.split(" "));
      if (answerSet.size === solSet.size && [...answerSet].every(v => solSet.has(v))) {
        return { correct: false, feedback: "Correct ACK values but wrong order. Check ascending port order." };
      }
      // Check if partially correct
      const overlap = [...answerSet].filter(v => solSet.has(v)).length;
      if (overlap > 0) {
        return { correct: false, feedback: `${overlap}/${solSet.size} ACK values correct. Re-analyze the packets.` };
      }
      return { correct: false, feedback: "Incorrect ACK sequence. Look for valid SYN packets (non-RST, window > 0)." };
    }

    case "signal_trace": {
      if (norm === sol) {
        return { correct: true, feedback: "Signal traced! Relay connection locked." };
      }
      // Check if correct row but wrong column or vice versa
      if (norm.length >= 2 && sol.length >= 2) {
        if (norm[0] === sol[0]) {
          return { correct: false, feedback: "Correct row but wrong column. Re-trace the hex pattern." };
        }
        if (norm.slice(1) === sol.slice(1)) {
          return { correct: false, feedback: "Correct column but wrong row. Follow the signal path." };
        }
      }
      return { correct: false, feedback: "Signal lost in noise. Follow the hex increment pattern from the origin." };
    }

    default:
      return { correct: false, feedback: "Unknown challenge type." };
  }
}

// Re-export for convenience
export { getConnectionDifficulty, selectChallengeType as selectType };
