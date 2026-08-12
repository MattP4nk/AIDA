// Core Game Types

import type { FactionReputation } from "./faction";
import type { MissionInfo } from "./mission";
import type { CurrentServerInfo } from "./network";

export interface TerminalTab {
  id: string;
  label: string;
  serverId?: string;
  currentDirectory: string;
  commandHistory: Command[];
  createdAt: Date;
  lastActivity: Date;
  isProcessing: boolean;
  processingCommand?: string;
}

export interface Command {
  id: string;
  userId: string;
  command: string;
  args: string[];
  timestamp: Date;
  serverId?: string;
  rawInput?: string;
  terminalId?: string;
}

export interface ParsedCommand {
  command: string;
  args: string[];
  rawInput: string;
  isValid: boolean;
  error?: string;
}

export interface CommandResult {
  success: boolean;
  output: string | string[];
  exitCode?: number;
  data?: any; // any: required for downstream compatibility
  error?: string;
  timestamp: Date;
  executionTime?: number;
  openDialog?: "mail" | "chat" | "forum";
  terminalId?: string;
  suggestedCommand?: string;
  soundEvent?: "submit" | "success" | "error" | "connected" | "hackSuccess" | "processComplete" | "levelUp" | "alert" | "notification";
  renderMode?: "instant" | "typewriter" | "cinematic";
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface ServerState {
  serverId: string;
  connectedPlayers: string[];
  isOnline: boolean;
  lastUpdate: Date;
  activeConnections: number;
}

export interface GameState {
  player: PlayerInfo;
  currentServer?: CurrentServerInfo;
  inventory: InventoryItem[];
  missions: MissionInfo[];
  notifications: Notification[];
  stats: PlayerStats;
}

export interface PlayerInfo {
  id: string;
  username: string;
  ip: string;
  level: number;
  experience: number;
  credits: number;
  skills: PlayerSkills;
  reputation: FactionReputation;
}

export interface PlayerSkills {
  hacking: number;
  networking: number;
  cryptography: number;
  stealth: number;
  socialEng: number;
  forensics: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  type: string;
  description: string;
  quantity: number;
  metadata?: any; // any: required for downstream compatibility
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  priority: NotificationPriority;
  data?: Record<string, unknown>;
}

export enum NotificationType {
  INFO = "info",
  SUCCESS = "success",
  WARNING = "warning",
  ERROR = "error",
  HACK_ALERT = "hack_alert",
  MISSION = "mission",
  MESSAGE = "message",
  SYSTEM = "system",
}

export enum NotificationPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  CRITICAL = "critical",
}

export interface PlayerStats {
  totalPlayTime: number;
  commandsExecuted: number;
  successfulHacks: number;
  failedHacks: number;
  missionsCompleted: number;
  serversDiscovered: number;
  filesAccessed: number;
  messagesSent: number;
}

// Progress Service Types
export interface SaveTrigger {
  userId: string;
  reason: string;
  timestamp: Date;
  priority: SavePriority;
}

export enum SavePriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  IMMEDIATE = "immediate",
}

export interface ProgressBackup {
  id: string;
  userId: string;
  data: Record<string, unknown>;
  createdAt: Date;
  reason: string;
  checksum?: string;
}

// Player Home System
export interface PlayerHomeSystem {
  serverId: string;
  userId: string;
  initialized: boolean;
  starterFilesCreated: boolean;
  currentDirectory: string;
  customizations?: HomeCustomization;
}

export interface HomeCustomization {
  theme?: string;
  aliases?: Record<string, string>;
  environmentVars?: Record<string, string>;
  customPrompt?: string;
}

// Typed Constants

/** Content draft lifecycle status */
export const DraftStatus = {
  DRAFT: "draft",
  APPROVED: "approved",
  REJECTED: "rejected",
  APPLIED: "applied",
} as const;
export type DraftStatus = (typeof DraftStatus)[keyof typeof DraftStatus];

/** Narrative epoch status */
export const EpochStatus = {
  DRAFT: "draft",
  ACTIVE: "active",
  COMPLETED: "completed",
} as const;
export type EpochStatus = (typeof EpochStatus)[keyof typeof EpochStatus];

/** Reserved PIDs for virtual UI processes (ProcessBar) */
export const ReservedPID = {
  HACK_CHALLENGE: -1,
  CONNECTION_CHALLENGE: -2,
  FILE_CHALLENGE: -3,
} as const;
export type ReservedPID = (typeof ReservedPID)[keyof typeof ReservedPID];
