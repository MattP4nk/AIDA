// AI/NPC System Types

export interface NPCAgent {
  id: string;
  type: NPCType;
  name: string;
  faction?: string;
  behaviorTree?: Record<string, unknown>;
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
