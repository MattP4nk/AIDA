// Hack Service Types

export interface HackAttempt {
  attackerId: string;
  targetId: string;
  targetServerId: string;
  targetIp: string;
  method: HackMethod;
  tools: string[];
  stealthLevel: number;
  timestamp: Date;
}

export enum HackMethod {
  BRUTEFORCE = "bruteforce",
  EXPLOIT = "exploit",
  SOCIAL = "social",
  BACKDOOR = "backdoor",
  SQL_INJECTION = "sql_injection",
  PHISHING = "phishing",
  ROOTKIT = "rootkit",
}

export interface HackResult {
  success: boolean;
  detected: boolean;
  accessLevel: number;
  discoveredFiles: string[];
  evidenceLeft: number;
  counterMeasures: string[];
  message: string;
  traceInitiated: boolean;
}

export interface HackCalculation {
  successRate: number;
  detectionRate: number;
  evidenceAmount: number;
  accessLevel: number;
  baseTime: number;
}

// Hack Difficulty Calculation
export interface HackDifficultyFactors {
  securityLevel: number;
  firewallLevel: number;
  encryptionLevel: number;
  playerHackingSkill: number;
  playerStealthSkill: number;
  toolBonuses: number;
  finalDifficulty: number;
  successChance: number;
  detectionChance: number;
}

// Hacking Minigame Types

export type MinigameType =
  | "cipher" | "port_sequence" | "memory_trace"
  | "anomaly_scan" | "disk_sector"
  | "brute_force"
  | "cipher_storm" | "entropy_overload";

export interface MinigameChallenge {
  type: MinigameType;
  difficulty: number;
  displayText: string[];
  solution: string;
  hints: string[];
  timeLimit: number;
  maxAttempts: number;
  metadata?: Record<string, unknown>;
}

export interface HackSessionInfo {
  id: string;
  targetIp: string;
  targetServerId: string;
  targetOwnerId: string;
  attackerId: string;
  method: HackMethod;
  tools: string[];
  currentLayer: number;
  totalLayers: number;
  status: "active" | "completed" | "failed" | "expired" | "aborted";
  layers: MinigameChallenge[];
  layerResults: LayerResult[];
  detectionAccumulator: number;
  startedAt: number;
  expiresAt: number;
  layerStartedAt: number;
}

export interface LayerResult {
  type: MinigameType;
  solved: boolean;
  attempts: number;
  timeUsed: number;
}

// Connection Challenge Types

export type ConnectionChallengeType = "handshake" | "signal_trace";

export interface ConnectionChallenge {
  type: ConnectionChallengeType;
  difficulty: number;
  displayText: string[];
  solution: string;
  hints: string[];
  timeLimit: number;
  maxAttempts: number;
}

export interface ConnectionSessionInfo {
  id: string;
  userId: string;
  targetServerId: string;
  targetIp: string;
  targetName: string;
  isFirstVisit: boolean;
  status: "active" | "completed" | "failed" | "expired" | "aborted";
  challenge: ConnectionChallenge;
  attempts: number;
  startedAt: number;
  expiresAt: number;
}
