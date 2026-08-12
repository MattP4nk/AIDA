/**
 * fileAccessMinigameGenerator.ts — Minigame challenges for file access commands.
 *
 * Generates 5 challenge types:
 *   1. Anomaly Scan      — identify hidden files from inode table gaps (sweep, easy)
 *   2. Disk Sector       — decode hex dump to find hidden filenames (sweep, hard)
 *   3. Brute Force       — analyze encryption and choose attack strategy (crack)
 *   4. Cipher Storm      — solve 3 interdependent ciphers simultaneously (crack.storm)
 *   5. Entropy Overload  — find a byte sequence in a massive hex grid (crack.storm)
 */

import type { MinigameChallenge } from "../../../shared/types";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

interface HiddenFileInfo {
  id: string;
  name: string;
  type: "file" | "directory";
  size: number;
  createdAt: Date;
}

interface VisibleFileInfo {
  name: string;
  type: "file" | "directory";
  size: number;
  createdAt: Date;
}

interface PlayerSkills {
  forensics?: number;
  cryptography?: number;
  hacking?: number;
}

// ═══════════════════════════════════════════════════════════════════
// 1. Anomaly Scan (sweep — security 1-5)
// ═══════════════════════════════════════════════════════════════════

export function generateAnomalyScanChallenge(
  difficulty: number,
  hiddenFiles: HiddenFileInfo[],
  visibleFiles: VisibleFileInfo[],
  skills: PlayerSkills,
): MinigameChallenge {
  const forensics = skills.forensics ?? 0;

  // Build inode table: interleave visible and hidden entries with sequential inodes
  const allEntries: Array<{ inode: number; name: string; size: number; date: string; hidden: boolean }> = [];
  let inode = 1001 + Math.floor(Math.random() * 50);

  // Merge visible and hidden, sorted randomly to scatter gaps
  const combined = [
    ...visibleFiles.map(f => ({ ...f, hidden: false })),
    ...hiddenFiles.map(f => ({ ...f, hidden: true })),
  ].sort(() => Math.random() - 0.5);

  for (const entry of combined) {
    allEntries.push({
      inode,
      name: entry.name,
      size: entry.size || (entry.type === "directory" ? 4096 : Math.floor(Math.random() * 4000) + 100),
      date: entry.createdAt ? entry.createdAt.toISOString().split("T")[0]! : "2026-08-01",
      hidden: entry.hidden,
    });
    inode += entry.hidden ? 1 : Math.floor(Math.random() * 2) + 1; // gaps for hidden entries
  }

  // Build display text
  const lines: string[] = [
    "[FILESYSTEM ANOMALY SCAN]",
    "══════════════════════════════════════════════",
    ` ${"INODE".padEnd(8)}${"SIZE".padEnd(8)}${"MODIFIED".padEnd(14)}NAME`,
    ` ${"─────".padEnd(8)}${"─────".padEnd(8)}${"────────".padEnd(14)}────`,
  ];

  for (const entry of allEntries) {
    if (entry.hidden) {
      // Show gap with size hint at higher forensics
      const sizeStr = forensics >= 70 ? String(entry.size) : "???";
      const dateStr = "???";
      const nameStr = forensics >= 50
        ? entry.name.slice(0, 2) + "•".repeat(Math.max(1, entry.name.length - 2))
        : "[MISSING]";
      lines.push(` ${String(entry.inode).padEnd(8)}${sizeStr.padEnd(8)}${dateStr.padEnd(14)}${nameStr}`);
    } else {
      const typeIndicator = entry.name.endsWith("/") || entry.size === 4096 ? "/" : "";
      lines.push(` ${String(entry.inode).padEnd(8)}${String(entry.size).padEnd(8)}${entry.date.padEnd(14)}${entry.name}${typeIndicator}`);
    }
  }

  // Solution: sorted hidden file names
  const solution = hiddenFiles.map(f => f.name).sort().join(" ");

  // Hints based on forensics skill
  const hints: string[] = [`${hiddenFiles.length} entries missing from inode table.`];
  if (forensics >= 30) {
    const types = hiddenFiles.map(f => f.type);
    const allFiles = types.every(t => t === "file");
    const allDirs = types.every(t => t === "directory");
    hints.push(allFiles ? "Missing entries are files." : allDirs ? "Missing entries are directories." : "Mix of files and directories.");
  }

  const clampedDifficulty = Math.max(1, Math.min(5, difficulty));
  const timeLimit = clampedDifficulty <= 3 ? 45 : 35;
  const maxAttempts = clampedDifficulty <= 3 ? 3 : 2;

  return {
    type: "anomaly_scan",
    difficulty: clampedDifficulty,
    displayText: lines,
    solution,
    hints,
    timeLimit,
    maxAttempts,
    metadata: { hiddenFileIds: hiddenFiles.map(f => f.id) },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 2. Disk Sector Analysis (sweep — security 6-10)
// ═══════════════════════════════════════════════════════════════════

export function generateDiskSectorChallenge(
  difficulty: number,
  hiddenFiles: HiddenFileInfo[],
  skills: PlayerSkills,
): MinigameChallenge {
  const forensics = skills.forensics ?? 0;

  // Encode each hidden filename as hex bytes
  const encodedNames: Array<{ name: string; hex: string[] }> = hiddenFiles.map(f => ({
    name: f.name,
    hex: [...f.name].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")),
  }));

  // Build hex dump display with embedded filenames in noise
  const BYTES_PER_ROW = 12;
  const totalRows = Math.max(8, hiddenFiles.length * 3 + 4);
  const grid: string[][] = [];

  // Fill with random noise bytes
  for (let r = 0; r < totalRows; r++) {
    const row: string[] = [];
    for (let c = 0; c < BYTES_PER_ROW; c++) {
      row.push(Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0"));
    }
    grid.push(row);
  }

  // Plant hidden filenames in random rows
  const usedRows = new Set<number>();
  for (const encoded of encodedNames) {
    let row: number;
    do {
      row = Math.floor(Math.random() * totalRows);
    } while (usedRows.has(row));
    usedRows.add(row);

    const startCol = Math.floor(Math.random() * Math.max(1, BYTES_PER_ROW - encoded.hex.length - 1));
    for (let i = 0; i < encoded.hex.length; i++) {
      grid[row]![startCol + i] = encoded.hex[i]!;
    }
    // Add null terminator
    if (startCol + encoded.hex.length < BYTES_PER_ROW) {
      grid[row]![startCol + encoded.hex.length] = "00";
    }
  }

  // Build display
  const lines: string[] = [
    "[DISK SECTOR ANALYSIS]",
    "══════════════════════════════════════════════",
    ` ${"SECTOR".padEnd(10)}${"OFFSET".padEnd(8)}DATA`,
    ` ${"──────".padEnd(10)}${"──────".padEnd(8)}${"─".repeat(BYTES_PER_ROW * 3 + 4)}`,
  ];

  for (let r = 0; r < totalRows; r++) {
    const sectorAddr = (0x0400 + r * 0x10).toString(16).toUpperCase().padStart(4, "0");
    const offset = (r * 16).toString(16).toUpperCase().padStart(2, "0");
    const hexData = grid[r]!.join(" ");

    // ASCII interpretation column
    const ascii = grid[r]!.map(b => {
      const code = parseInt(b, 16);
      return code >= 0x20 && code <= 0x7E ? String.fromCharCode(code) : ".";
    }).join("");

    const isDataRow = usedRows.has(r);
    const highlight = forensics >= 50 && isDataRow ? " <<" : "";
    lines.push(` 0x${sectorAddr}    +${offset}     ${hexData}  ${ascii}${highlight}`);
  }

  const solution = hiddenFiles.map(f => f.name).sort().join(" ");

  const hints: string[] = [
    `${hiddenFiles.length} hidden filenames encoded in sector data.`,
    "Filenames are ASCII hex terminated by 00.",
  ];
  if (forensics >= 70) {
    hints.push(`Name lengths: ${hiddenFiles.map(f => f.name.length).join(", ")} chars.`);
  }
  if (forensics >= 90) {
    hints.push(`First chars: ${hiddenFiles.map(f => f.name[0]).join(", ")}`);
  }

  const clampedDifficulty = Math.max(6, Math.min(10, difficulty));
  const timeLimit = clampedDifficulty <= 7 ? 40 : 30;

  return {
    type: "disk_sector",
    difficulty: clampedDifficulty,
    displayText: lines,
    solution,
    hints,
    timeLimit,
    maxAttempts: 2,
    metadata: { hiddenFileIds: hiddenFiles.map(f => f.id) },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 3. Brute Force Visualizer (crack — encrypted files)
// ═══════════════════════════════════════════════════════════════════

/** Determine best crack strategy from encryption key characteristics. */
function determineBestStrategy(encryptionKey: string | null | undefined): {
  bestStrategy: "dict" | "mask" | "pattern";
  charset: string;
  entropy: string;
} {
  const key = encryptionKey || "unknown";

  // Check if key matches common patterns
  const isLowerAlpha = /^[a-z]+$/.test(key);
  const isAlphaNumeric = /^[a-zA-Z0-9]+$/.test(key);
  const hasPattern = /^[A-Za-z]+[0-9]+$/.test(key) || /^[A-Za-z]+[!@#$%]+$/.test(key);
  const isShort = key.length <= 8;

  if (isLowerAlpha && isShort) {
    return { bestStrategy: "dict", charset: "a-z (lowercase)", entropy: "LOW" };
  }
  if (hasPattern) {
    return { bestStrategy: "pattern", charset: isAlphaNumeric ? "a-zA-Z0-9" : "a-zA-Z0-9+special", entropy: "MEDIUM" };
  }
  // Default: brute force mask
  const charset = isLowerAlpha ? "a-z" : isAlphaNumeric ? "a-zA-Z0-9" : "full (a-zA-Z0-9+special)";
  return { bestStrategy: "mask", charset, entropy: "HIGH" };
}

export function generateBruteForceChallenge(
  difficulty: number,
  file: { id: string; name: string; encryptionKey?: string | null; metadata?: any },
  skills: PlayerSkills,
): MinigameChallenge {
  const cryptography = skills.cryptography ?? 0;
  const { bestStrategy, charset, entropy } = determineBestStrategy(file.encryptionKey);

  // Generate a fake hash preview
  const hashBytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, "0"),
  ).join("");
  const hashPreview = `${hashBytes.slice(0, 8)}...${hashBytes.slice(-4)}`;

  const keyLength = file.encryptionKey?.length || Math.floor(Math.random() * 8) + 4;
  const cipherType = difficulty <= 4 ? "AES-128-CBC" : "AES-256-CBC";

  const lines: string[] = [
    "[ENCRYPTION ANALYSIS]",
    "══════════════════════════════════════════════",
    ` File:      ${file.name}`,
    ` Cipher:    ${cipherType}`,
    ` Hash:      ${hashPreview} (SHA-256)`,
    ` Key Len:   ${keyLength} bytes`,
    ` Entropy:   ${entropy}`,
    ` Charset:   ${charset}`,
    "",
    ` Your cryptography skill: ${cryptography}/100`,
    "",
    " Choose your attack approach:",
    "   crack.dict          Dictionary attack",
    "   crack.mask <set>    Brute force (a-z, 0-9, a-z0-9)",
    "   crack.pattern       Pattern-based (word123, Name!)",
  ];

  // Add hint based on skill
  const hints: string[] = [];
  if (cryptography >= 30 && entropy === "LOW") {
    hints.push("Entropy is very low — dictionary attack recommended.");
  }
  if (cryptography >= 50 && bestStrategy === "pattern") {
    hints.push("Key structure suggests a common pattern (word+digits).");
  }
  if (cryptography >= 70) {
    hints.push(`Key charset appears to be: ${charset}`);
  }

  return {
    type: "brute_force",
    difficulty,
    displayText: lines,
    solution: bestStrategy,
    hints,
    timeLimit: 120, // generous — choosing strategy is analytical, not rushed
    maxAttempts: 2,
    metadata: {
      fileId: file.id,
      fileName: file.name,
      bestStrategy,
      encryptionDifficulty: difficulty,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 4. Cipher Storm (crack.storm — protected files, near-impossible)
// ═══════════════════════════════════════════════════════════════════

function caesarShift(text: string, shift: number): string {
  return text.split("").map(c => {
    if (c >= "A" && c <= "Z") return String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
    if (c >= "a" && c <= "z") return String.fromCharCode(((c.charCodeAt(0) - 97 + shift) % 26) + 97);
    return c;
  }).join("");
}

function vigenereEncrypt(text: string, key: string): string {
  const k = key.toUpperCase();
  let ki = 0;
  return text.split("").map(c => {
    if (c >= "A" && c <= "Z") {
      const shift = k.charCodeAt(ki % k.length) - 65;
      ki++;
      return String.fromCharCode(((c.charCodeAt(0) - 65 + shift) % 26) + 65);
    }
    return c;
  }).join("");
}

function xorEncrypt(text: string, key: number): string {
  return text.split("").map(c => {
    const xored = c.charCodeAt(0) ^ key;
    return xored.toString(16).toUpperCase().padStart(2, "0");
  }).join(" ");
}

const CIPHER_STORM_WORDS = [
  "ALPHA", "BRAVO", "DELTA", "ECHO", "GAMMA",
  "OMEGA", "SIGMA", "THETA", "ZETA", "KAPPA",
  "NEXUS", "PRISM", "VAULT", "STORM", "CIPHER",
  "PULSE", "GHOST", "BLADE", "SPARK", "FLAME",
];

export function generateCipherStormChallenge(
  difficulty: number,
  fileId: string,
  skills: PlayerSkills,
): MinigameChallenge {
  const cryptography = skills.cryptography ?? 0;
  const d = Math.max(5, Math.min(10, difficulty));

  // Difficulty scaling: harder = bigger shift, longer key, more complex XOR
  const caesarRange = d <= 7 ? 10 : 20; // shift range scales
  const vigenereKeyLen = d <= 7 ? 3 : d <= 9 ? 4 : 5;
  const timeLimit = Math.max(10, 25 - d); // d5=20s, d7=18s, d10=15s

  // Pick 3 random words as the answers
  const shuffled = [...CIPHER_STORM_WORDS].sort(() => Math.random() - 0.5);
  const word1 = shuffled[0]!;
  const word2 = shuffled[1]!;
  const word3 = shuffled[2]!;

  // Layer 1: Caesar
  const caesarShiftVal = Math.floor(Math.random() * caesarRange) + 3;
  const caesarEncrypted = caesarShift(word1, caesarShiftVal);

  // Layer 2: Vigenere
  const vigenereKey = shuffled[3]!.slice(0, vigenereKeyLen);
  const vigenereEncrypted = vigenereEncrypt(word2, vigenereKey);

  // Layer 3: XOR
  const xorKey = Math.floor(Math.random() * 200) + 30;
  const xorEncrypted = xorEncrypt(word3, xorKey);

  const lines: string[] = [
    "[!] PROTECTED ENCRYPTION — CASCADING CIPHER STORM",
    "══════════════════════════════════════════════",
    "",
    ` Layer 1 [CAESAR]:    ${caesarEncrypted}  →  ?????`,
    ` Layer 2 [VIGENÈRE]:  ${vigenereEncrypted}  →  ?????`,
    ` Layer 3 [XOR-0x${xorKey.toString(16).toUpperCase().padStart(2, "0")}]:   ${xorEncrypted}  →  ?????`,
    "",
    " All 3 answers must be correct together.",
    "",
    ` Time: ${timeLimit}s | Attempts: 1`,
    " Submit: crack.storm.submit <ans1> <ans2> <ans3>",
  ];

  // Hints scale with crypto skill — higher skill = more help on this near-impossible challenge
  const hints: string[] = [];
  if (cryptography >= 30) hints.push("Layer 1: Caesar cipher detected.");
  if (cryptography >= 50) hints.push(`Layer 2: Vigenère key length = ${vigenereKey.length}.`);
  if (cryptography >= 70) hints.push(`Layer 1 shift is between ${Math.max(1, caesarShiftVal - 2)} and ${caesarShiftVal + 2}.`);
  if (cryptography >= 90) hints.push(`Layer 3: XOR key = 0x${xorKey.toString(16).toUpperCase().padStart(2, "0")}`);

  return {
    type: "cipher_storm",
    difficulty: d,
    displayText: lines,
    solution: `${word1} ${word2} ${word3}`,
    hints,
    timeLimit,
    maxAttempts: 1,
    metadata: { fileId },
  };
}

// ═══════════════════════════════════════════════════════════════════
// 5. Entropy Overload (crack.storm — protected files, near-impossible)
// ═══════════════════════════════════════════════════════════════════

export function generateEntropyOverloadChallenge(
  difficulty: number,
  fileId: string,
  skills: PlayerSkills,
): MinigameChallenge {
  const cryptography = skills.cryptography ?? 0;
  const d = Math.max(5, Math.min(10, difficulty));

  // Difficulty scaling: more rows, more decoys, less time
  const COLS = 12;
  const ROWS = d <= 7 ? 8 : d <= 9 ? 10 : 12;
  const decoyCount = d <= 7 ? 3 : d <= 9 ? 5 : 7;
  const timeLimit = Math.max(12, 30 - d * 2); // d5=20s, d7=16s, d10=10s (brutal)

  // Generate the target sequence (8 bytes)
  const targetBytes = Array.from({ length: 8 }, () =>
    Math.floor(Math.random() * 256),
  );
  const targetHex = targetBytes.map(b => b.toString(16).toUpperCase().padStart(2, "0"));
  const prefix = targetHex.slice(0, 3).join(" ");
  const checkBytes = targetHex.slice(3, 5).join(" ");

  // Build grid with random noise
  const grid: string[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: string[] = [];
    for (let c = 0; c < COLS; c++) {
      row.push(Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0"));
    }
    grid.push(row);
  }

  // Plant decoys (matching prefix but wrong check bytes)
  for (let i = 0; i < decoyCount; i++) {
    const row = Math.floor(Math.random() * ROWS);
    const maxCol = COLS - 8;
    const col = Math.floor(Math.random() * Math.max(1, maxCol));
    for (let j = 0; j < 3; j++) {
      grid[row]![col + j] = targetHex[j]!;
    }
    for (let j = 3; j < 8; j++) {
      grid[row]![col + j] = Math.floor(Math.random() * 256).toString(16).toUpperCase().padStart(2, "0");
    }
  }

  // Plant the real answer
  const answerRow = Math.floor(Math.random() * ROWS);
  const answerCol = Math.floor(Math.random() * Math.max(1, COLS - 8));
  for (let i = 0; i < 8; i++) {
    grid[answerRow]![answerCol + i] = targetHex[i]!;
  }

  // Build display
  const lines: string[] = [
    "[!] PROTECTED ENCRYPTION — ENTROPY OVERLOAD",
    "══════════════════════════════════════════════",
    "",
    ` Target prefix:    ${prefix}`,
    ` Check bytes 4-5:  ${checkBytes}`,
    ` Find the 8-byte sequence that matches BOTH.`,
    "",
    ` ${"ROW".padEnd(5)}DATA`,
    ` ${"───".padEnd(5)}${"─".repeat(COLS * 3 + 2)}`,
  ];

  for (let r = 0; r < ROWS; r++) {
    const rowLabel = String(r + 1).padStart(2, " ");
    const rowData = grid[r]!.join(" ");
    // Skill-based highlight: only at very high crypto, and never gives the exact answer
    const highlight = cryptography >= 80 && r === answerRow ? "  ◄" : "";
    lines.push(` ${rowLabel}   ${rowData}${highlight}`);
  }

  lines.push("");
  lines.push(` ${decoyCount} decoy matches. Only one has correct check bytes.`);
  lines.push(` Time: ${timeLimit}s | Attempts: 1`);
  lines.push(" Submit: crack.storm.submit <row> <col>");

  const solution = `${answerRow + 1} ${answerCol + 1}`;

  const hints: string[] = [];
  if (cryptography >= 40) {
    // Give a safe hint — the answer is NOT in these rows
    const safeExclusions = Array.from({ length: ROWS }, (_, i) => i)
      .filter(r => r !== answerRow)
      .sort(() => Math.random() - 0.5)
      .slice(0, 2);
    hints.push(`Rows ${safeExclusions.map(r => r + 1).join(", ")} are definitely noise.`);
  }
  if (cryptography >= 70) {
    hints.push(`Answer row is between ${Math.max(1, answerRow)} and ${Math.min(ROWS, answerRow + 2)}.`);
  }

  return {
    type: "entropy_overload",
    difficulty: d,
    displayText: lines,
    solution,
    hints,
    timeLimit,
    maxAttempts: 1,
    metadata: { fileId },
  };
}

// ═══════════════════════════════════════════════════════════════════
// Validators
// ═══════════════════════════════════════════════════════════════════

/** Validate a sweep answer (space-separated hidden file names). */
export function validateSweepAnswer(challenge: MinigameChallenge, answer: string): boolean {
  const expected = challenge.solution.toLowerCase().split(" ").sort();
  const submitted = answer.trim().toLowerCase().split(/\s+/).sort();

  if (expected.length !== submitted.length) return false;
  return expected.every((e, i) => e === submitted[i]);
}

/** Validate a crack strategy choice. Returns success probability modifier. */
export function validateCrackStrategy(
  challenge: MinigameChallenge,
  strategy: "dict" | "mask" | "pattern",
): { isCorrect: boolean; successMultiplier: number } {
  const best = challenge.metadata?.bestStrategy as string;
  if (strategy === best) {
    return { isCorrect: true, successMultiplier: 1.5 };
  }
  return { isCorrect: false, successMultiplier: 0.5 };
}

/** Validate a crack.storm answer. Case-insensitive for cipher storm, exact for entropy. */
export function validateStormAnswer(challenge: MinigameChallenge, answer: string): boolean {
  if (challenge.type === "cipher_storm") {
    return answer.trim().toUpperCase() === challenge.solution.toUpperCase();
  }
  // Entropy overload: exact row+col match
  return answer.trim() === challenge.solution;
}
