export interface User {
    id: string;
    username: string;
    email: string;
    homeIp: string;
    createdAt: Date;
    lastLogin: Date;
    isActive: boolean;
    isOnline: boolean;
}
export interface AuthRequest {
    username: string;
    email?: string;
    password: string;
}
export interface AuthResponse {
    success: boolean;
    token?: string;
    user?: User;
    message?: string;
}
export interface PlayerSkills {
    hacking: number;
    networking: number;
    cryptography: number;
    stealth: number;
    socialEngineering: number;
    forensics: number;
}
export interface PlayerProgress {
    userId: string;
    discoveryLevel: DiscoveryLevel;
    skills: PlayerSkills;
    credits: number;
    level: number;
    experience: number;
    reputation: FactionReputation;
    missionProgress: Record<string, any>;
    achievements: string[];
}
export declare enum DiscoveryLevel {
    NONE = 0,
    STRANGE_ACTIVITY = 1,
    AI_SUSPECTED = 2,
    FACTION_WAR = 3,
    TARGET_IDENTIFIED = 4,
    AIDA_REVEALED = 5
}
export type FactionId = "military" | "sword_corp" | "anons" | "neutral";
export interface FactionReputation {
    military: number;
    sword_corp: number;
    anons: number;
    neutral: number;
}
export interface Faction {
    id: FactionId;
    name: string;
    fullName: string;
    description: string;
    objective: string;
    hostilityLevel: number;
    resources: number;
    knownServers: string[];
    activeMembers: number;
}
export interface GameServer {
    id: string;
    name: string;
    ipAddress: string;
    type: ServerType;
    ownerId?: string;
    encryptionLevel: number;
    accessRules: AccessRule[];
    isOnline: boolean;
    maxConnections: number;
    currentConnections: number;
}
export declare enum ServerType {
    SYSTEM = "system",
    PLAYER_HOME = "player_home",
    CORPORATE = "corporate",
    UNDERGROUND = "underground",
    MILITARY = "military",
    FACTION_BASE = "faction_base"
}
export interface AccessRule {
    type: "allow" | "deny";
    target: "user" | "faction" | "skill_level";
    value: string | number;
    condition?: string;
}
export interface FileSystemNode {
    id: string;
    serverId: string;
    parentId?: string;
    name: string;
    type: "file" | "directory";
    content?: string;
    permissions: FilePermissions;
    createdBy: string;
    createdAt: Date;
    modifiedAt: Date;
    size: number;
    isEncrypted: boolean;
    encryptionKey?: string;
    isHidden: boolean;
    isProtected: boolean;
}
export interface FilePermissions {
    owner: PermissionLevel;
    faction: PermissionLevel;
    others: PermissionLevel;
    specialAccess?: SpecialAccess[];
}
export declare enum PermissionLevel {
    NONE = 0,
    READ = 1,
    WRITE = 2,
    EXECUTE = 4,
    DELETE = 8,
    FULL = 15
}
export interface SpecialAccess {
    userId: string;
    permissions: PermissionLevel;
    expiresAt?: Date;
}
export interface Message {
    id: string;
    senderId: string;
    recipientId: string;
    subject: string;
    content: string;
    timestamp: Date;
    isRead: boolean;
    isEncrypted: boolean;
    encryptionLevel?: number;
    requiredSkill?: {
        skill: keyof PlayerSkills;
        level: number;
    };
    triggerEvent?: string;
    messageType: MessageType;
}
export declare enum MessageType {
    PRIVATE = "private",
    SYSTEM = "system",
    FACTION = "faction",
    MISSION = "mission",
    ALERT = "alert"
}
export interface Contact {
    id: string;
    userId: string;
    contactUserId: string;
    handle: string;
    name?: string;
    status: ContactStatus;
    lastSeen: Date;
    encryptionLevel: number;
    notes?: string;
    faction?: FactionId;
}
export declare enum ContactStatus {
    UNKNOWN = "unknown",
    SUSPICIOUS = "suspicious",
    FRIENDLY = "friendly",
    TRUSTED = "trusted",
    HOSTILE = "hostile",
    BLOCKED = "blocked"
}
export interface ForumPost {
    id: string;
    authorId: string;
    title: string;
    content: string;
    forumSection: ForumSection;
    timestamp: Date;
    isHoneypot: boolean;
    factionAlignment?: FactionId;
    replies: ForumReply[];
    votes: number;
    tags: string[];
    isSticky: boolean;
    isLocked: boolean;
}
export interface ForumReply {
    id: string;
    postId: string;
    authorId: string;
    content: string;
    timestamp: Date;
    votes: number;
    isHidden: boolean;
}
export declare enum ForumSection {
    GENERAL = "general",
    TRADING = "trading",
    EXPLOITS = "exploits",
    INTEL = "intel",
    RECRUITMENT = "recruitment",
    UNDERGROUND = "underground"
}
export interface Mission {
    id: string;
    title: string;
    description: string;
    type: MissionType;
    difficulty: number;
    requiredSkills: Partial<PlayerSkills>;
    reward: MissionReward;
    timeLimit?: number;
    targetServerId?: string;
    targetUserId?: string;
    objectives: MissionObjective[];
    status: MissionStatus;
    assignedTo?: string;
    createdBy: string;
    createdAt: Date;
    expiresAt?: Date;
}
export declare enum MissionType {
    INFILTRATION = "infiltration",
    DATA_THEFT = "data_theft",
    SABOTAGE = "sabotage",
    RECONNAISSANCE = "reconnaissance",
    PROTECTION = "protection",
    ASSASSINATION = "assassination",// Digital assassination
    DELIVERY = "delivery"
}
export interface MissionObjective {
    id: string;
    description: string;
    type: ObjectiveType;
    target: string;
    isCompleted: boolean;
    isOptional: boolean;
    progress: number;
}
export declare enum ObjectiveType {
    ACCESS_SERVER = "access_server",
    STEAL_FILE = "steal_file",
    PLANT_FILE = "plant_file",
    DELETE_FILE = "delete_file",
    DECRYPT_DATA = "decrypt_data",
    MAINTAIN_STEALTH = "maintain_stealth",
    AVOID_DETECTION = "avoid_detection",
    CONTACT_PLAYER = "contact_player"
}
export interface MissionReward {
    credits: number;
    experience: number;
    skillBonus?: Partial<PlayerSkills>;
    items?: string[];
    factionReputation?: Partial<FactionReputation>;
}
export declare enum MissionStatus {
    AVAILABLE = "available",
    ACTIVE = "active",
    COMPLETED = "completed",
    FAILED = "failed",
    EXPIRED = "expired",
    CANCELLED = "cancelled"
}
export interface GameEvent {
    id: string;
    type: EventType;
    title: string;
    description: string;
    timestamp: Date;
    affectedUsers: string[];
    metadata: Record<string, any>;
    isGlobal: boolean;
    severity: EventSeverity;
}
export declare enum EventType {
    PLAYER_HACK = "player_hack",
    FACTION_WAR = "faction_war",
    SERVER_BREACH = "server_breach",
    DISCOVERY = "discovery",
    SYSTEM_ALERT = "system_alert",
    MISSION_UPDATE = "mission_update",
    REPUTATION_CHANGE = "reputation_change"
}
export declare enum EventSeverity {
    INFO = "info",
    WARNING = "warning",
    CRITICAL = "critical",
    EMERGENCY = "emergency"
}
export interface SocketEvent {
    type: SocketEventType;
    data: any;
    timestamp: Date;
    userId?: string;
    serverId?: string;
}
export declare enum SocketEventType {
    USER_CONNECTED = "user_connected",
    USER_DISCONNECTED = "user_disconnected",
    SERVER_ACCESSED = "server_accessed",
    FILE_MODIFIED = "file_modified",
    DIRECTORY_CHANGED = "directory_changed",
    MESSAGE_RECEIVED = "message_received",
    FORUM_POST_CREATED = "forum_post_created",
    HACK_ATTEMPTED = "hack_attempted",
    HACK_SUCCESSFUL = "hack_successful",
    HACK_BLOCKED = "hack_blocked",
    MISSION_ASSIGNED = "mission_assigned",
    FACTION_EVENT = "faction_event",
    DISCOVERY_MADE = "discovery_made",
    SYSTEM_ANNOUNCEMENT = "system_announcement"
}
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
    timestamp: Date;
}
export interface PaginatedResponse<T> extends ApiResponse<T[]> {
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
        hasNext: boolean;
        hasPrev: boolean;
    };
}
export interface FileOperation {
    type: "create" | "read" | "update" | "delete" | "move" | "copy";
    targetId?: string;
    parentId?: string;
    name?: string;
    content?: string;
    permissions?: FilePermissions;
}
export interface FileOperationResult {
    success: boolean;
    node?: FileSystemNode;
    message?: string;
    requiredPermission?: PermissionLevel;
    blockReason?: string;
}
export interface HackAttempt {
    targetUserId: string;
    targetServerId: string;
    method: HackMethod;
    tools: string[];
    stealthLevel: number;
}
export declare enum HackMethod {
    BRUTE_FORCE = "brute_force",
    SOCIAL_ENGINEERING = "social_engineering",
    EXPLOIT = "exploit",
    BACKDOOR = "backdoor",
    PHISHING = "phishing",
    PRIVILEGE_ESCALATION = "privilege_escalation"
}
export interface HackResult {
    success: boolean;
    detected: boolean;
    accessLevel: PermissionLevel;
    discoveredFiles: string[];
    evidenceLeft: number;
    counterMeasures: string[];
}
export interface ScriptExecution {
    code: string;
    environment: "player_terminal" | "target_system" | "neutral_zone";
    allowedOperations: ScriptOperation[];
    timeLimit: number;
    memoryLimit: number;
}
export declare enum ScriptOperation {
    FILE_READ = "file_read",
    FILE_WRITE = "file_write",
    NETWORK_SCAN = "network_scan",
    DECRYPT = "decrypt",
    ENCRYPT = "encrypt",
    SYSTEM_INFO = "system_info",
    PROCESS_LIST = "process_list"
}
export interface ScriptResult {
    success: boolean;
    output: string;
    executionTime: number;
    memoryUsed: number;
    operations: string[];
    warnings: string[];
    errors: string[];
}
export interface GameConfig {
    maxPlayersPerServer: number;
    hackingCooldown: number;
    missionTimeout: number;
    maxMessagesPerMinute: number;
    skillGainMultipliers: PlayerSkills;
    economySettings: {
        startingCredits: number;
        missionBaseReward: number;
        hackingBaseReward: number;
    };
}
//# sourceMappingURL=types.d.ts.map