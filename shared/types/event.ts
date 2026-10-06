// Event System Types

export interface GameEvent {
  id: string;
  type: EventType;
  title: string;
  description: string;
  timestamp: Date;
  affectedUsers: string[];
  metadata: Record<string, unknown>;
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
  PLAYER_HACK = "player_hack",
  FACTION_WAR = "faction_war",
  SERVER_BREACH = "server_breach",
  DISCOVERY = "discovery",
  SYSTEM_ALERT = "system_alert",
  MISSION_UPDATE = "mission_update",
  REPUTATION_CHANGE = "reputation_change",
  /**
   * Was written to `game_events` as a RAW STRING by fileService (:501, :1026)
   * and never declared here. Since `EventSubscription.eventType` is typed
   * `EventType`, the honeypot alert was unsubscribable by construction — you
   * could not have watched for it even if subscriptions had worked.
   */
  HONEYPOT_TRIGGERED = "honeypot_triggered",
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
