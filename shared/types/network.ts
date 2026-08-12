// Network, Server, IP Types

export interface CurrentServerInfo {
  id: string;
  name: string;
  ip: string;
  type: string;
  accessLevel: number;
  ownerId?: string;
  encryptionLevel: number;
  securityLevel: number;
  firewallLevel: number;
  discoveryLevel: number;
  isPlayerHome: boolean;
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
  metadata?: Record<string, unknown>;
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

// Server Connection Types
export interface ServerConnectionInfo {
  id: string;
  userId: string;
  serverId: string;
  connectedAt: Date;
  disconnectedAt?: Date;
  isActive: boolean;
  workingDirectory: string;
  accessLevel: number;
  sessionData?: Record<string, unknown>;
}

// Game Server Types
export interface GameServerInfo {
  id: string;
  name: string;
  ipAddress: string;
  type: string;
  ownerId?: string;
  securityLevel: number;
  firewallLevel: number;
  encryptionLevel: number;
  discoveryLevel: number;
  isPlayerHome: boolean;
  isOnline: boolean;
  maxConnections: number;
  currentConnections: number;
  createdAt: Date;
  updatedAt: Date;
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
