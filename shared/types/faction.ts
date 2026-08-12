// Faction, Territory, Warfare, Alias, DarkNet, Censorship Types

export interface FactionReputation {
  [factionShortName: string]: number;
}

export type FactionId = "garrison" | "dothackers" | "cybercorp" | "darknet";

export type FactionRank = "recruit" | "operative" | "elite" | "council_member";

export interface FactionResources {
  credits: number;
  intel: number;
  compute: number;
}

export interface FactionStandingInfo {
  factionId: string;
  factionName: string;
  factionShortName: string;
  reputation: number;
  isHostile: boolean;
  isAllied: boolean;
}

// Territory & Contest types (Phase 3)
export type ResourceType = "credits" | "intel" | "compute";

export interface ServerContestInfo {
  id: string;
  serverId: string;
  serverName: string;
  serverIp: string;
  attackingFactionId: string;
  attackingFactionName: string;
  defendingFactionId: string | null;
  defendingFactionName: string | null;
  status: ContestStatus;
  decryptionProgress: number;
  startedAt: Date;
  participantCount: number;
}

export enum ContestStatus {
  ACTIVE = "active",
  RESOLVED = "resolved",
  CANCELLED = "cancelled",
}

export interface FactionServerInfo {
  id: string;
  name: string;
  ipAddress: string;
  resourceType: ResourceType | null;
  resourceOutput: number;
  isContested: boolean;
  securityLevel: number;
}

// Phase 5: Warfare, Alias, DarkNet, Censorship

export type WarStatus = "active" | "ceasefire" | "surrendered" | "resolved";

export interface FactionWarInfo {
  id: string;
  attackerFactionId: string;
  attackerName: string;
  defenderFactionId: string;
  defenderName: string;
  status: WarStatus;
  attackerScore: number;
  defenderScore: number;
  reputationMultiplier: number;
  startedAt: Date;
  endedAt: Date | null;
}

export interface PlayerAliasInfo {
  aliasName: string;
  apparentFactionId: string | null;
  isActive: boolean;
}

export type DarkNetDiscoveryMethod =
  | "hidden_file"
  | "skill_threshold"
  | "censorship_flags"
  | "breadcrumb_trail";

export interface CensorshipAlert {
  userId: string;
  pattern: string;
  originalText: string;
  serverId?: string | undefined;
}

/** Faction membership events */
export const FactionEventType = {
  JOIN: "join",
  LEAVE: "leave",
  NEUTRAL: "neutral",
} as const;
export type FactionEventType = (typeof FactionEventType)[keyof typeof FactionEventType];
