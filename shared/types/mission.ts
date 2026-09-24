// Mission Types

import type { FactionReputation } from "./faction";

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

/**
 * A2: these are the values actually written to `Mission.status` and
 * `PlayerMission.status`.
 *
 * `IN_PROGRESS = "in_progress"` was a phantom — declared here, written by
 * NOTHING (verified repo-wide and against the database, which holds only
 * "active"), and read by exactly one defensive admin filter. The value the
 * game really uses for an in-flight mission is "active", which was missing
 * from this enum entirely while `missionService` kept a private union that
 * had it. The two disagreed, and a cast at `gameStateManager.ts:456`
 * (`m.status as MissionStatus`) papered over the difference.
 *
 * NOT here, deliberately, though PLAN.md implied they belonged:
 *   - "abandoned" is a **StoryArc** status (storyMissionService.ts:808).
 *     `abandonMission` writes "failed" to the mission itself.
 *   - "pending" / "skipped" are **StoryStep** statuses
 *     (storyMissionService.ts:41), a different concept again.
 */
export enum MissionStatus {
  AVAILABLE = "available",
  ASSIGNED = "assigned",
  ACTIVE = "active",
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
  HACK = "hack",
  HACK_TARGET = "hack_target",
  HACK_STEALTH = "hack_stealth",
  HACK_METHOD = "hack_method",
  GAIN_ACCESS = "gain_access",
  STEAL = "steal",
  STEAL_COUNT = "steal_count",
  UPLOAD_FILE = "upload_file",
  DELETE_FILE = "delete_file",
  MESSAGE = "message",
  CONTACT_PLAYER = "contact_player",
  FORUM_POST = "forum_post",
  FORUM_REPLY = "forum_reply",
  FORUM_INTERACTION = "forum_interaction",
  EXPLORE = "explore",
  CONNECT_SERVER = "connect_server",
  DISCOVER_SERVER_TYPE = "discover_server_type",
  SKILL_LEVEL = "skill_level",
  GAIN_XP = "gain_xp",
  EARN_CREDITS = "earn_credits",
  SPEND_CREDITS = "spend_credits",
  JOIN_FACTION = "join_faction",
  FACTION_REPUTATION = "faction_reputation",
  FACTION_MISSION = "faction_mission",
  INFILTRATE_NETWORK = "infiltrate_network",
  TRACE_CONNECTION = "trace_connection",
  EXFILTRATE_DATA = "exfiltrate_data",
  DOWNLOAD_FILE = "download_file",
  DECODE_CONTENT = "decode_content",
  DEFEND_HOME = "defend_home",
  CLAIM_BOUNTY = "claim_bounty",
  SURVIVE_TRACE = "survive_trace",
  SCAN_SUBNET = "scan_subnet",
}
