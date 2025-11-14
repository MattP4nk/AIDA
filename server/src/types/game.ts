// Game Type Definitions for AIDA Multiplayer System

export interface PlayerSession {
  userId: string;
  socketId: string;
  connectedAt: Date;
  lastActivity: Date;
  currentServerId?: string;
  homeServerId?: string; // Player's home system server ID
  currentDirectory: string; // Current working directory path
  isActive: boolean;
  ipAddress: string;
  commandQueue: Command[];
}

export interface Command {
  id: string;
  userId: string;
  command: string;
  args: string[];
  timestamp: Date;
  serverId?: string;
  rawInput?: string;
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
  output: string | string[]; // Support both single string and array for terminal output
  exitCode?: number; // 0 = success, non-zero = error (terminal convention)
  data?: any;
  error?: string;
  timestamp: Date;
  executionTime?: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  details?: any;
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

export interface FactionReputation {
  military: number;
  swordCorp: number;
  anons: number;
  neutral: number;
}

export interface CurrentServerInfo {
  id: string;
  name: string;
  ip: string;
  type: string;
  accessLevel: number;
  ownerId?: string;
  encryptionLevel: number;
  securityLevel: number; // 1-10, affects hack difficulty
  firewallLevel: number; // 1-10, affects detection
  discoveryLevel: number; // Required skill level to discover
  isPlayerHome: boolean; // Flag for player home systems
}

export interface InventoryItem {
  id: string;
  name: string;
  type: string;
  description: string;
  quantity: number;
  metadata?: any;
}

export interface MissionInfo {
  id: string;
  title: string;
  description: string;
  type: string;
  status: MissionStatus;
  difficulty: number;
  objectives: MissionObjective[];
  reward: MissionReward;
  timeLimit?: number;
  expiresAt?: Date;
}

export enum MissionStatus {
  AVAILABLE = "available",
  ASSIGNED = "assigned",
  IN_PROGRESS = "in_progress",
  COMPLETED = "completed",
  FAILED = "failed",
  EXPIRED = "expired",
}

export interface MissionObjective {
  id: string;
  description: string;
  type: string;
  target?: string;
  progress: number;
  required: number;
  completed: boolean;
  metadata?: MissionObjectiveMetadata;
}

export interface MissionObjectiveMetadata {
  fileId?: string;
  serverId?: string;
  requiredAccessLevel?: number;
  requiredFiles?: string[];
  targetUsers?: string[];
  timeLimit?: number;
  stealthRequired?: boolean;
}

export interface MissionReward {
  credits: number;
  experience: number;
  items?: string[];
  reputation?: Partial<FactionReputation>;
  unlocks?: string[];
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
  priority: NotificationPriority;
  data?: any;
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
  totalPlayTime: number; // seconds
  commandsExecuted: number;
  successfulHacks: number;
  failedHacks: number;
  missionsCompleted: number;
  serversDiscovered: number;
  filesAccessed: number;
  messagesSent: number;
}

// IP Service Types
export interface IPRange {
  start: string;
  end: string;
  zone: IPZone;
  description: string;
}

export enum IPZone {
  PLAYER = "player",
  CORPORATE = "corporate",
  GOVERNMENT = "government",
  UNDERGROUND = "underground",
}

export interface IPOwner {
  type: "user" | "server" | "npc";
  id: string;
  name: string;
  ip: string;
  isOnline: boolean;
  zone: IPZone;
  metadata?: any;
}

export interface DiscoveryResult {
  success: boolean;
  discovered: boolean;
  target?: IPOwner;
  message: string;
  partialInfo?: boolean;
}

export interface TraceRouteHop {
  hopNumber: number;
  ip: string;
  name?: string;
  latency: number;
  hidden: boolean;
}

export interface TraceRouteResult {
  success: boolean;
  route: TraceRouteHop[];
  totalHops: number;
  reachable: boolean;
}

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

// Event System Types
export interface GameEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  timestamp: Date;
  affectedUsers: string[];
  metadata: any;
  isGlobal: boolean;
  severity: EventSeverity;
}

export enum EventType {
  HACK_ATTEMPT = "hack_attempt",
  HACK_SUCCESS = "hack_success",
  HACK_DETECTED = "hack_detected",
  MISSION_ASSIGNED = "mission_assigned",
  MISSION_COMPLETED = "mission_completed",
  SERVER_DISCOVERED = "server_discovered",
  PLAYER_LEVEL_UP = "player_level_up",
  FACTION_CHANGE = "faction_change",
  SYSTEM_ANNOUNCEMENT = "system_announcement",
  WORLD_EVENT = "world_event",
}

export enum EventSeverity {
  INFO = "info",
  WARNING = "warning",
  CRITICAL = "critical",
}

export interface EventSubscription {
  id: string;
  userId: string;
  eventType: EventType;
  targetId?: string;
  method: SubscriptionMethod;
  quality: number; // 0-100
  expiresAt?: Date;
  isActive: boolean;
}

export enum SubscriptionMethod {
  BUG = "bug",
  HACK = "hack",
  SURVEILLANCE = "surveillance",
  INSIDER = "insider",
  INTERCEPT = "intercept",
}

// File System Types
export interface FileSystemNode {
  id: string;
  serverId: string;
  parentId?: string;
  name: string;
  type: "file" | "directory";
  content?: string;
  permissions: FilePermissions;
  size: number;
  isEncrypted: boolean;
  isHidden: boolean;
  isProtected: boolean;
  createdAt: Date;
  modifiedAt: Date;
  lastAccessedAt?: Date; // Track when file was last read
  lastAccessedBy?: string; // Track who last accessed it
}

export interface FilePermissions {
  owner: string;
  read: boolean;
  write: boolean;
  execute: boolean;
  delete: boolean;
}

export interface FileOperation {
  type: FileOperationType;
  fileId?: string;
  serverId: string;
  parentId?: string;
  name?: string;
  content?: string;
  newName?: string;
  targetPath?: string;
}

export enum FileOperationType {
  READ = "read",
  WRITE = "write",
  CREATE = "create",
  DELETE = "delete",
  RENAME = "rename",
  MOVE = "move",
  COPY = "copy",
  CHMOD = "chmod",
  ACCESS = "access",
}

// Session Types
export interface SessionInfo {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  isActive: boolean;
  ipAddress?: string;
  userAgent?: string;
  currentDirectory: string; // Persisted working directory
  lastServerId?: string; // Last connected server for resume
}

// File Access Tracking
export interface FileAccessRecord {
  fileId: string;
  userId: string;
  serverId: string;
  action: FileOperationType;
  timestamp: Date;
  success: boolean;
}

export interface FileAccessSummary {
  fileId: string;
  fileName: string;
  totalAccesses: number;
  lastAccessedAt?: Date;
  lastAccessedBy?: string;
  accessedByUsers: string[];
}

// Server Connection Types
export interface ServerConnectionInfo {
  id: string;
  userId: string;
  serverId: string;
  connectedAt: Date;
  disconnectedAt?: Date;
  isActive: boolean;
  workingDirectory: string; // Current directory on this server
  accessLevel: number; // 0-10, achieved access level
  sessionData?: any;
}

// Game Server Types
export interface GameServerInfo {
  id: string;
  name: string;
  ipAddress: string;
  type: string;
  ownerId?: string;
  securityLevel: number; // 1-10, hack difficulty
  firewallLevel: number; // 1-10, detection chance
  encryptionLevel: number;
  discoveryLevel: number; // Required skill to discover
  isPlayerHome: boolean;
  isOnline: boolean;
  maxConnections: number;
  currentConnections: number;
  createdAt: Date;
  updatedAt: Date;
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
  data: any;
  createdAt: Date;
  reason: string;
  checksum?: string;
}

// AI System Types (Future)
export interface NPCAgent {
  id: string;
  type: NPCType;
  name: string;
  faction?: string;
  behaviorTree?: any;
  state: NPCState;
  personality: NPCPersonality;
  objectives: string[];
}

export enum NPCType {
  CONTACT = "contact",
  VENDOR = "vendor",
  SECURITY = "security",
  HACKER = "hacker",
  CORPORATE = "corporate",
  GOVERNMENT = "government",
}

export interface NPCState {
  location: string;
  mood: string;
  awareness: number;
  hostility: number;
  lastInteraction?: Date;
}

export interface NPCPersonality {
  aggression: number;
  helpfulness: number;
  greed: number;
  loyalty: number;
  paranoia: number;
}

// WebSocket Event Types
export interface SocketEventData {
  userId?: string;
  timestamp: Date;
  data: any;
}

export interface StateUpdateEvent extends SocketEventData {
  fullState?: GameState;
  delta?: StateDelta;
}

export interface StateDelta {
  path: string;
  value: any;
  operation: "set" | "push" | "remove" | "update";
}

export interface CommandExecuteEvent extends SocketEventData {
  command: string;
  args: string[];
  serverId?: string;
}

export interface BroadcastMessage {
  type: string;
  target: BroadcastTarget;
  data: any;
  priority: NotificationPriority;
}

export enum BroadcastTarget {
  USER = "user",
  SERVER = "server",
  FACTION = "faction",
  ZONE = "zone",
  GLOBAL = "global",
}

// Error Types
export class GameError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: any,
  ) {
    super(message);
    this.name = "GameError";
  }
}

export class ValidationError extends GameError {
  constructor(message: string, details?: any) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class AuthorizationError extends GameError {
  constructor(message: string, details?: any) {
    super(message, "AUTHORIZATION_ERROR", 403, details);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends GameError {
  constructor(message: string, details?: any) {
    super(message, "NOT_FOUND", 404, details);
    this.name = "NotFoundError";
  }
}

export class RateLimitError extends GameError {
  constructor(message: string, details?: any) {
    super(message, "RATE_LIMIT_EXCEEDED", 429, details);
    this.name = "RateLimitError";
  }
}

// Server Discovery Types
export interface ServerDiscoveryResult {
  servers: GameServerInfo[];
  newDiscoveries: number;
  requiresHigherSkills: string[];
  playerSkillLevel: number;
}

export interface ServerScanOptions {
  includeOffline?: boolean;
  maxSecurityLevel?: number;
  serverType?: string;
  zone?: IPZone;
}

// Hack Difficulty Calculation
export interface HackDifficultyFactors {
  securityLevel: number; // From server.securityLevel
  firewallLevel: number; // From server.firewallLevel
  encryptionLevel: number; // From server.encryptionLevel
  playerHackingSkill: number;
  playerStealthSkill: number;
  toolBonuses: number;
  finalDifficulty: number; // Calculated value
  successChance: number; // 0-100%
  detectionChance: number; // 0-100%
}

// Mission Tracking Types
export interface MissionProgress {
  missionId: string;
  userId: string;
  objectives: ObjectiveProgress[];
  filesAccessed: string[];
  serversCompromised: string[];
  startedAt: Date;
  lastUpdated: Date;
}

export interface ObjectiveProgress {
  objectiveId: string;
  type: MissionObjectiveType;
  current: number;
  required: number;
  completed: boolean;
  completedAt?: Date;
}

export enum MissionObjectiveType {
  ACCESS_FILE = "access_file",
  HACK_SERVER = "hack_server",
  STEAL_DATA = "steal_data",
  INSTALL_BACKDOOR = "install_backdoor",
  DISCOVER_SERVERS = "discover_servers",
  REACH_ACCESS_LEVEL = "reach_access_level",
  EARN_CREDITS = "earn_credits",
  COMPLETE_HACKS = "complete_hacks",
  AVOID_DETECTION = "avoid_detection",
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
