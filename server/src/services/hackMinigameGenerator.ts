/**
 * hackMinigameGenerator.ts — Pure puzzle generation + validation for hack minigames.
 * No DI dependencies. Fully testable.
 */

import type { MinigameChallenge, MinigameType, PlayerSkills } from "../types/game";

// ==================== WORD LISTS ====================

const PHRASES: string[][] = [
  ["HELLO", "WORLD", "ACCESS", "GRANTED"],
  ["SYSTEM", "OVERRIDE", "ENABLED"],
  ["LAUNCH", "SECURE", "PORTAL"],
  ["BYPASS", "FIREWALL", "ACTIVE"],
  ["SHADOW", "GHOST", "VECTOR"],
  ["KERNEL", "DAEMON", "SPLICE"],
  ["DECODE", "CIPHER", "BREACH"],
  ["INJECT", "BUFFER", "THREAD"],
  ["SOCKET", "PACKET", "BINARY"],
  ["TARGET", "LOCKED", "DENIED"],
  ["MATRIX", "ENABLE", "SYSTEM"],
  ["MEMORY", "BUFFER", "OVERFLOW"],
];

const PORT_SERVICES: Record<number, string> = {
  21: "ftp", 22: "ssh", 23: "telnet", 25: "smtp", 53: "dns",
  80: "http", 110: "pop3", 143: "imap", 443: "https", 445: "smb",
  993: "imaps", 995: "pop3s", 1080: "socks", 1337: "unknown",
  1433: "mssql", 1521: "oracle", 3128: "squid-proxy", 3306: "mysql",
  3389: "rdp", 4444: "backdoor-svc", 5432: "postgres", 5900: "vnc",
  6379: "redis", 6667: "irc", 8080: "http-alt", 8443: "https-alt",
  8888: "web-proxy", 9090: "zeus-admin", 9200: "elasticsearch",
  9999: "abyss", 27017: "mongodb",
};

const PORT_RESPONSES: Record<string, string[]> = {
  open: ["200-OK", "301-MOVED", "220-READY", "BANNER"],
  filtered: ["SYN_WAIT", "RST_ACK", "NO_RESP", "TIMEOUT"],
  closed: ["REFUSED", "RST", "UNREACHABLE"],
};

// ==================== CIPHER CHALLENGE ====================

function caesarEncrypt(text: string, shift: number): string {
  return text.split("").map(ch => {
    if (ch >= "A" && ch <= "Z") {
      return String.fromCharCode(((ch.charCodeAt(0) - 65 + shift) % 26) + 65);
    }
    return ch;
  }).join("");
}

function substitutionEncrypt(text: string, key: Map<string, string>): string {
  return text.split("").map(ch => key.get(ch) ?? ch).join("");
}

function generateSubstitutionKey(seed: number): Map<string, string> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const shuffled = [...alphabet];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    const tmp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = tmp;
  }
  const key = new Map<string, string>();
  for (let i = 0; i < alphabet.length; i++) {
    key.set(alphabet[i]!, shuffled[i]!);
  }
  return key;
}

function getLetterFrequency(text: string): Map<string, number> {
  const freq = new Map<string, number>();
  for (const ch of text) {
    if (ch >= "A" && ch <= "Z") {
      freq.set(ch, (freq.get(ch) || 0) + 1);
    }
  }
  return freq;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateCipherChallenge(difficulty: number, skills: Partial<PlayerSkills> = {}): MinigameChallenge {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const crypto = skills.cryptography ?? 0;

  // Skill adjustment: 80+ drops difficulty one tier
  const effectiveDifficulty = crypto >= 80 ? Math.max(1, d - 3) : d;

  // Pick phrase
  const phrase = pickRandom(PHRASES);
  const plaintext = phrase.join(" ");

  let ciphertext: string;
  const mappings: string[] = [];
  const hints: string[] = [];

  if (effectiveDifficulty <= 3) {
    // Caesar cipher
    const shift = 1 + Math.floor(Math.random() * 25);
    ciphertext = caesarEncrypt(plaintext, shift);

    // Generate known mappings (4+ clues)
    const usedLetters = [...new Set(plaintext.replace(/ /g, "").split(""))];
    const numMappings = Math.min(usedLetters.length, 4 + Math.floor(crypto / 20));
    const shuffledLetters = usedLetters.sort(() => Math.random() - 0.5);
    for (let i = 0; i < numMappings; i++) {
      const plain = shuffledLetters[i]!;
      const enc = caesarEncrypt(plain, shift);
      mappings.push(`${plain}→${enc}`);
    }

    hints.push(`Cipher type: Caesar (shift cipher)`);
    hints.push(`Try shifting each letter back by the same amount`);
  } else if (effectiveDifficulty <= 6) {
    // Vigenère with 2-3 char key
    const keyLen = effectiveDifficulty <= 4 ? 2 : 3;
    const keyChars: string[] = [];
    for (let i = 0; i < keyLen; i++) {
      keyChars.push(String.fromCharCode(65 + Math.floor(Math.random() * 26)));
    }
    const vigKey = keyChars.join("");

    ciphertext = plaintext.split("").map((ch, idx) => {
      if (ch >= "A" && ch <= "Z") {
        const keyIdx = idx % vigKey.length;
        const shift = vigKey.charCodeAt(keyIdx) - 65;
        return String.fromCharCode(((ch.charCodeAt(0) - 65 + shift) % 26) + 65);
      }
      return ch;
    }).join("");

    const numMappings = Math.min(3, 2 + Math.floor(crypto / 30));
    const usedLetters = [...new Set(plaintext.replace(/ /g, "").split(""))];
    const shuffledLetters = usedLetters.sort(() => Math.random() - 0.5);
    for (let i = 0; i < numMappings; i++) {
      const plain = shuffledLetters[i]!;
      const encIdx = plaintext.indexOf(plain);
      mappings.push(`Position ${i}: ${plain}→${ciphertext[encIdx]}`);
    }

    hints.push(`Key length: ${vigKey.length} characters`);
    if (crypto >= 60) hints.push(`Cipher type: Vigenère`);
  } else {
    // Substitution cipher
    const seed = Date.now() % 100000;
    const key = generateSubstitutionKey(seed);
    ciphertext = substitutionEncrypt(plaintext, key);

    const numMappings = Math.max(1, Math.min(2, 1 + Math.floor(crypto / 40)));
    const usedLetters = [...new Set(plaintext.replace(/ /g, "").split(""))];
    const shuffledLetters = usedLetters.sort(() => Math.random() - 0.5);
    for (let i = 0; i < numMappings; i++) {
      const plain = shuffledLetters[i]!;
      mappings.push(`${plain}→${key.get(plain) ?? "?"}`);
    }

    if (crypto >= 60) hints.push(`Cipher type: Substitution (monoalphabetic)`);
  }

  // Frequency hint
  const freq = getLetterFrequency(ciphertext);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) {
    hints.unshift(`Most common cipher letter: ${sorted[0]![0]} (common English: E, T, A)`);
  }

  // Fragment hint: show start of plaintext
  const fragmentLen = effectiveDifficulty <= 3 ? 5 : effectiveDifficulty <= 6 ? 3 : 2;
  hints.push(`Plaintext starts with "${plaintext.substring(0, fragmentLen)}..."`);

  // Extra mappings from cryptography skill (every 20 pts → +1)
  const bonusMappings = Math.floor(crypto / 20);
  if (bonusMappings > 0) {
    const usedLetters = [...new Set(plaintext.replace(/ /g, "").split(""))];
    const existingMapped = new Set(mappings.map(m => m.charAt(0)));
    const available = usedLetters.filter(l => !existingMapped.has(l));
    for (let i = 0; i < Math.min(bonusMappings, available.length); i++) {
      const plain = available[i]!;
      const encIdx = plaintext.indexOf(plain);
      const enc = ciphertext[encIdx] ?? "?";
      mappings.push(`${plain}→${enc}`);
    }
  }

  const timeLimit = effectiveDifficulty <= 3 ? 60 : effectiveDifficulty <= 6 ? 45 : 30;
  const maxAttempts = effectiveDifficulty <= 3 ? 4 : 3;

  const displayText = [
    `[ENCRYPTION BARRIER]`,
    `${"═".repeat(50)}`,
    `Intercepted encrypted transmission:`,
    ``,
    `  CIPHERTEXT: ${ciphertext}`,
    ``,
    `  Known mappings:  ${mappings.join("  ")}`,
    ...hints.map(h => `  ${h}`),
    ``,
    `  Time: ${timeLimit}s | Attempts: ${maxAttempts}`,
    ``,
    `Submit with: crack.submit <decrypted plaintext>`,
  ];

  return {
    type: "cipher",
    difficulty: d,
    displayText,
    solution: plaintext,
    hints,
    timeLimit,
    maxAttempts,
  };
}

// ==================== PORT SEQUENCE CHALLENGE ====================

export function generatePortSequenceChallenge(difficulty: number, skills: Partial<PlayerSkills> = {}): MinigameChallenge {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const networking = skills.networking ?? 0;

  const sequenceLength = d <= 3 ? 3 : d <= 6 ? 4 : Math.min(6, 4 + Math.floor((d - 6) / 2));

  // Pick ports for the correct sequence (filtered status)
  const allPorts = Object.keys(PORT_SERVICES).map(Number);
  const shuffledPorts = allPorts.sort(() => Math.random() - 0.5);

  const solutionPorts = shuffledPorts.slice(0, sequenceLength).sort((a, b) => a - b);

  // Generate decoy ports
  const maxDecoys = d <= 3 ? 2 : d <= 6 ? 4 : 6;
  const numDecoys = Math.max(1, maxDecoys - Math.floor(networking / 25));
  const remainingPorts = shuffledPorts.slice(sequenceLength);
  const decoyPorts = remainingPorts.slice(0, numDecoys);

  interface PortEntry {
    port: number;
    service: string;
    status: string;
    response: string;
    timestamp: string;
  }

  const baseTime = 14 * 60 + Math.floor(Math.random() * 5);
  let timeIdx = 0;

  const entries: PortEntry[] = [];

  // Add solution ports (all filtered)
  const filteredResponses = PORT_RESPONSES["filtered"]!;
  for (const port of solutionPorts) {
    entries.push({
      port,
      service: PORT_SERVICES[port] ?? "unknown",
      status: "filtered",
      response: pickRandom(filteredResponses),
      timestamp: `14:${String(Math.floor(baseTime / 60)).padStart(2, "0")}:${String((baseTime + timeIdx) % 60).padStart(2, "0")}`,
    });
    timeIdx++;
  }

  // Add decoys with mixed statuses
  const statusOptions = d >= 7 ? ["open", "filtered", "closed"] : ["open", "closed"];
  for (const port of decoyPorts) {
    const status = pickRandom(statusOptions);
    const responses = PORT_RESPONSES[status]!;
    entries.push({
      port,
      service: PORT_SERVICES[port] ?? "unknown",
      status,
      response: pickRandom(responses),
      timestamp: `14:${String(Math.floor(baseTime / 60)).padStart(2, "0")}:${String((baseTime + timeIdx) % 60).padStart(2, "0")}`,
    });
    timeIdx++;
  }

  // Shuffle entries for display
  entries.sort(() => Math.random() - 0.5);

  const hints: string[] = [];
  hints.push(`${sequenceLength}-port knock required.`);

  if (d <= 3) {
    hints.push(`Only "filtered" ports are part of the sequence.`);
    hints.push(`Use ascending port order.`);
  } else if (d <= 6) {
    hints.push(`Only "filtered" ports. Ascending port order.`);
  } else {
    hints.push(`Look for "filtered" status ports.`);
  }

  if (networking >= 50) hints.push(`Sequence length: ${sequenceLength}`);
  if (networking >= 75) hints.push(`Sort by: port number (ascending)`);

  const timeLimit = d <= 3 ? 60 : d <= 6 ? 50 : 40;
  const maxAttempts = d <= 3 ? 3 : 2;

  const header = `  PORT   SERVICE         STATUS    RESPONSE    TIMESTAMP`;
  const divider = `  ─────  ──────────────  ────────  ──────────  ─────────`;
  const rows = entries.map(e =>
    `  ${String(e.port).padEnd(5)}  ${e.service.padEnd(14)}  ${e.status.padEnd(8)}  ${e.response.padEnd(10)}  ${e.timestamp}`
  );

  const displayText = [
    `[FIREWALL — Port Knock Required]`,
    `${"═".repeat(55)}`,
    `Network scan results:`,
    ``,
    header,
    divider,
    ...rows,
    ``,
    ...hints.map(h => `  Hint: ${h}`),
    ``,
    `  Time: ${timeLimit}s | Attempts: ${maxAttempts}`,
    ``,
    `Submit with: firewall.knock <port1> <port2> ...`,
  ];

  return {
    type: "port_sequence",
    difficulty: d,
    displayText,
    solution: solutionPorts.join(" "),
    hints,
    timeLimit,
    maxAttempts,
  };
}

// ==================== MEMORY TRACE CHALLENGE ====================

function toHex(n: number, pad = 2): string {
  return n.toString(16).toUpperCase().padStart(pad, "0");
}

function randomByte(): number {
  return Math.floor(Math.random() * 256);
}

export function generateMemoryTraceChallenge(difficulty: number, skills: Partial<PlayerSkills> = {}): MinigameChallenge {
  const d = Math.max(1, Math.min(10, Math.round(difficulty)));
  const hacking = skills.hacking ?? 0;
  const forensics = skills.forensics ?? 0;

  const numRows = d <= 3 ? 5 : d <= 6 ? 10 : 16;
  const tokenLength = d <= 3 ? 4 : d <= 6 ? 5 : 6;

  // Generate token bytes
  const tokenBytes: number[] = [];
  for (let i = 0; i < tokenLength; i++) {
    tokenBytes.push(randomByte());
  }
  const tokenHex = tokenBytes.map(b => toHex(b)).join("");

  // Marker pattern
  const marker = [0xDE, 0xAD];
  const markerHex = marker.map(b => toHex(b)).join(" ");

  // Build memory dump rows
  const baseAddr = 0x7F0100;
  const rows: { addr: number; bytes: number[] }[] = [];
  for (let i = 0; i < numRows; i++) {
    const bytes: number[] = [];
    for (let j = 0; j < 16; j++) {
      bytes.push(randomByte());
    }
    rows.push({ addr: baseAddr + i * 0x10, bytes });
  }

  // Pick a row whose address is divisible by 0x20
  const eligibleRows = rows.filter(r => r.addr % 0x20 === 0);
  const targetRow = eligibleRows.length > 0
    ? eligibleRows[Math.floor(Math.random() * eligibleRows.length)]!
    : rows[0]!;

  // Place marker at offset 4-5, token starting at offset 8
  const markerOffset = 4;
  const tokenOffset = markerOffset + marker.length + 2; // 2 bytes after marker
  targetRow.bytes[markerOffset] = marker[0]!;
  targetRow.bytes[markerOffset + 1] = marker[1]!;
  for (let i = 0; i < tokenLength; i++) {
    if (tokenOffset + i < 16) {
      targetRow.bytes[tokenOffset + i] = tokenBytes[i]!;
    }
  }

  // Place false markers at other rows for higher difficulty
  const numFalseMarkers = d <= 3 ? 0 : d <= 6 ? 1 : 2;
  const otherRows = rows.filter(r => r !== targetRow);
  for (let i = 0; i < Math.min(numFalseMarkers, otherRows.length); i++) {
    const fakeRow = otherRows[i]!;
    const fakeOffset = Math.floor(Math.random() * 14);
    fakeRow.bytes[fakeOffset] = marker[0]!;
    fakeRow.bytes[fakeOffset + 1] = marker[1]!;
  }

  // Build hints
  const hints: string[] = [];
  const markerCount = 1 + numFalseMarkers;
  hints.push(`Markers: [${markerHex}] at ${markerCount} location${markerCount > 1 ? "s" : ""}. Token starts 2 bytes after the marker at address divisible by 0x20.`);

  if (d >= 5) {
    const xorResult = tokenBytes.reduce((acc, b) => acc ^ b, 0);
    hints.push(`Checksum: Token bytes XOR to 0x${toHex(xorResult)}`);
  }

  if (forensics >= 40) hints.push(`Token length: ${tokenLength} bytes`);
  if (forensics >= 70) hints.push(`Token is at address range 0x${toHex(targetRow.addr, 6)}`);

  const highlightedMarkers = Math.floor(hacking / 20);
  if (highlightedMarkers > 0) {
    hints.push(`Skill scan: ${Math.min(highlightedMarkers, markerCount)} marker location(s) confirmed`);
  }

  const timeLimit = d <= 3 ? 50 : d <= 6 ? 40 : 30;
  const maxAttempts = d <= 3 ? 3 : 2;

  const dumpHeader = `  ADDR      00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F`;
  const dumpDivider = `  ────────  ──────────────────────────────────────────────────`;
  const dumpRows = rows.map(r => {
    const left = r.bytes.slice(0, 8).map(b => toHex(b)).join(" ");
    const right = r.bytes.slice(8, 16).map(b => toHex(b)).join(" ");
    return `  0x${toHex(r.addr, 6)}  ${left}  ${right}`;
  });

  const solutionAddr = `0x${toHex(targetRow.addr, 6)}`;

  const displayText = [
    `[IDS — Memory Extraction]`,
    `${"═".repeat(55)}`,
    `Process memory dump (PID ${1000 + Math.floor(Math.random() * 9000)}):`,
    ``,
    dumpHeader,
    dumpDivider,
    ...dumpRows,
    ``,
    ...hints.map(h => `  ${h}`),
    ``,
    `  Time: ${timeLimit}s | Attempts: ${maxAttempts}`,
    ``,
    `Submit with: memory.extract <address> <hex_token>`,
  ];

  return {
    type: "memory_trace",
    difficulty: d,
    displayText,
    solution: `${solutionAddr} ${tokenHex}`,
    hints,
    timeLimit,
    maxAttempts,
  };
}

// ==================== VALIDATION ====================

export function validateAnswer(challenge: MinigameChallenge, answer: string): { correct: boolean; feedback: string } {
  const normalizedAnswer = answer.trim().toUpperCase();
  const normalizedSolution = challenge.solution.trim().toUpperCase();

  switch (challenge.type) {
    case "cipher":
      if (normalizedAnswer === normalizedSolution) {
        return { correct: true, feedback: "Encryption layer breached!" };
      }
      if (normalizedSolution.startsWith(normalizedAnswer) && normalizedAnswer.length > normalizedSolution.length * 0.5) {
        return { correct: false, feedback: "Close! Some characters are wrong. Check the remaining mappings." };
      }
      return { correct: false, feedback: "Incorrect decryption. Check your cipher mappings." };

    case "port_sequence": {
      const answerPorts = normalizedAnswer.split(/[\s,]+/).filter(Boolean).join(" ");
      if (answerPorts === normalizedSolution) {
        return { correct: true, feedback: "Firewall bypassed!" };
      }
      const answerSet = new Set(answerPorts.split(" "));
      const solutionSet = new Set(normalizedSolution.split(" "));
      if (answerSet.size === solutionSet.size && [...answerSet].every(p => solutionSet.has(p))) {
        return { correct: false, feedback: "Right ports, wrong order! Check the sequence." };
      }
      return { correct: false, feedback: "Incorrect port sequence. Analyze the scan data." };
    }

    case "memory_trace": {
      const parts = normalizedAnswer.split(/\s+/);
      const solParts = normalizedSolution.split(/\s+/);
      if (parts.length >= 2 && solParts.length >= 2) {
        const addrMatch = (parts[0] ?? "").replace(/^0X/, "0x") === (solParts[0] ?? "").replace(/^0X/, "0x");
        const tokenMatch = (parts[1] ?? "") === (solParts[1] ?? "");
        if (addrMatch && tokenMatch) {
          return { correct: true, feedback: "Access token extracted! IDS evaded." };
        }
        if (addrMatch && !tokenMatch) {
          return { correct: false, feedback: "Correct address but wrong token bytes." };
        }
        if (!addrMatch && tokenMatch) {
          return { correct: false, feedback: "Correct token but wrong address." };
        }
      }
      return { correct: false, feedback: "Incorrect extraction. Check markers and address alignment." };
    }

    default:
      return { correct: false, feedback: "Unknown challenge type." };
  }
}

// ==================== LAYER ASSIGNMENT ====================

export interface ServerProfile {
  securityLevel: number;
  firewallLevel: number;
  encryptionLevel: number;
}

export function assignLayers(server: ServerProfile): MinigameType[] {
  const types: MinigameType[] = [];

  if (server.encryptionLevel >= server.firewallLevel && server.encryptionLevel >= server.securityLevel) {
    types.push("cipher", "port_sequence", "memory_trace");
  } else if (server.firewallLevel >= server.encryptionLevel && server.firewallLevel >= server.securityLevel) {
    types.push("port_sequence", "cipher", "memory_trace");
  } else {
    types.push("memory_trace", "cipher", "port_sequence");
  }

  // Security 8+: hardest type appears twice (4 layers)
  if (server.securityLevel >= 8) {
    types.push(types[0]!);
  }

  return types;
}

export function calculateLayerDifficulty(
  serverSecurityLevel: number,
  layerIndex: number,
  relevantSkill: number,
  methodModifier: number,
): number {
  return Math.max(1, Math.min(10,
    serverSecurityLevel + (layerIndex * 0.5) - (relevantSkill / 25) + methodModifier
  ));
}

const METHOD_MODIFIERS: Record<string, number> = {
  bruteforce: 0,
  exploit: -0.5,
  social: -1,
  backdoor: -1.5,
  sql_injection: -0.3,
  phishing: -0.8,
  rootkit: -2,
};

export function getMethodModifier(method: string): number {
  return METHOD_MODIFIERS[method.toLowerCase()] ?? 0;
}

function getRelevantSkill(type: MinigameType, skills: Partial<PlayerSkills>): number {
  switch (type) {
    case "cipher": return skills.cryptography ?? 0;
    case "port_sequence": return skills.networking ?? 0;
    case "memory_trace": return (skills.hacking ?? 0) + (skills.forensics ?? 0) / 2;
  }
}

export function generateLayersForServer(
  server: ServerProfile,
  skills: Partial<PlayerSkills>,
  method: string,
): MinigameChallenge[] {
  const layerTypes = assignLayers(server);
  const methodMod = getMethodModifier(method);

  return layerTypes.map((type, idx): MinigameChallenge => {
    const relevantSkill = getRelevantSkill(type, skills);
    const difficulty = calculateLayerDifficulty(server.securityLevel, idx, relevantSkill, methodMod);

    switch (type) {
      case "cipher": return generateCipherChallenge(difficulty, skills);
      case "port_sequence": return generatePortSequenceChallenge(difficulty, skills);
      case "memory_trace": return generateMemoryTraceChallenge(difficulty, skills);
    }
  });
}
