// WebSocket Event Types

import type { GameState, NotificationPriority } from "./game";

export interface SocketEventData {
  userId?: string;
  timestamp: Date;
  data: unknown;
}

export interface StateUpdateEvent extends SocketEventData {
  fullState?: GameState;
  delta?: StateDelta;
}

export interface StateDelta {
  path: string;
  value: unknown;
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
  data: unknown;
  priority: NotificationPriority;
}

export enum BroadcastTarget {
  USER = "user",
  SERVER = "server",
  FACTION = "faction",
  ZONE = "zone",
  GLOBAL = "global",
}
