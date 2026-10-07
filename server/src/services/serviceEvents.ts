import type { HackResult } from "../../../shared/types";

/**
 * Payloads for the in-process service event bus.
 *
 * These are the `this.emit(...)` contracts between services — NOT socket
 * events, which live in `shared/types/socketEvents.ts`. The distinction
 * matters: several names appear on both, with DIFFERENT shapes.
 * `missionService` emits `mission:completed` on the bus as
 * `{ userId, missionId, missionTitle, … }` and, separately, to the socket as
 * `{ missionId, title, rewards }`. A type derived from the wrong one compiles
 * and is wrong at runtime.
 *
 * EVERY SHAPE HERE WAS READ OFF THE EMITTER, not off a consumer. Typing a
 * handler from the fields it happens to touch reproduces that handler's bugs
 * as a type — and doing it the other way round is what surfaced two: the
 * `mission:completed` listener in index.ts read `data.title` and `data.type`,
 * and the emitter sends neither.
 *
 * Optional fields are optional because the emitter can omit them (a spread
 * guard, or `|| undefined`), not because a consumer tolerates their absence.
 */

// ── missionService ────────────────────────────────────────────────

export interface MissionCompletedEvent {
  userId: string;
  missionId: string;
  /** NOT `title`. The socket payload calls it that; the bus does not. */
  missionTitle: string;
  missionType: string;
  factionId?: string;
  targetServerId?: string;
  /** The mission's objective TYPES live here — there is no top-level `type`. */
  objectives: Array<{ type: string; metadata: Record<string, unknown> }>;
}

export interface MissionFailedEvent {
  missionId: string;
  userId: string;
  /**
   * "abandoned" (the player walked away) or "expired" (the clock ran out).
   * The distinction is load-bearing: only expiry advances a story arc, because
   * `advanceStory(id, "failed")` can permanently fail it and abandoning
   * returns the mission to the pool.
   */
  reason: "abandoned" | "expired";
}

export interface MissionFeedbackEvent {
  missionId: string;
  templateId: string;
  userId: string;
  playerLevel: number;
  missionDifficulty: number;
  missionType: string;
  timeToCompleteMin: number;
  difficultyGrade: "too_easy" | "just_right" | "too_hard";
  objectiveTypes: string[];
  efficiencyScore: number;
  stealthScore: number;
  factionId?: string;
  abandoned: boolean;
}

export interface RewardsXpGrantedEvent {
  userId: string;
  skillName: string;
  newLevel: number;
  xpGained: number;
}

export interface RewardsCreditsGrantedEvent {
  userId: string;
  amount: number;
  type: "earned";
}

/**
 * Emitted by BOTH missionService and hackService, with the same shape.
 *
 * They are separate EventEmitters, so a listener registered on one does not
 * receive the other's — see the note at the `player:levelup` wiring in
 * `index.ts`.
 */
export interface PlayerLevelUpEvent {
  userId: string;
  newLevel: number;
  experience: number;
}

// ── hackService ───────────────────────────────────────────────────

export interface HackAttemptEvent {
  attackerId: string;
  /** Falls back to `attackerId` when the target is unowned. */
  targetId: string;
  targetServerId: string;
  serverName: string;
  difficulty: number;
  result: HackResult;
  /** The hack method, e.g. "exploit" / "bruteforce". */
  method: string;
  /**
   * Whether the target's defences noticed. Gates the victim alert — an
   * undetected hack must stay silent, or stealth stops meaning anything.
   */
  detected: boolean;
  /** Spread in conditionally — absent for non-layered hacks. */
  layersSolved?: number;
  totalLayers?: number;
}

export interface HackDetectedEvent {
  attackerId: string;
  targetId: string;
  evidenceLeft: number;
  traceInitiated: boolean;
}

export interface IdsAlertEvent {
  targetUserId: string;
  message: string;
  severity: "high" | "critical";
}

export interface BountyPostedEvent {
  targetUsername: string;
  factionId: string;
  reason: string;
  rewardCredits: number;
  rewardReputation: number;
  /** ISO string, not a Date — it is serialised at the emit site. */
  expiresAt: string;
}

// ── factionService ────────────────────────────────────────────────

export interface FactionMembershipEvent {
  factionId: string;
  userId: string;
  factionName: string;
}

export interface FactionReputationChangedEvent {
  userId: string;
  factionId: string;
  amount: number;
  newReputation: number;
  /** Optional: supplied by callers that have one, shown in the notification. */
  reason?: string;
}

export interface FactionRankAchievedEvent {
  userId: string;
  factionId: string;
  newRank: string;
}

// ── keyFragmentService ────────────────────────────────────────────

export interface FragmentClaimedEvent {
  userId: string;
  fragmentId: string;
  keyType: string;
  fragmentNum: number;
  name: string;
}

export interface FragmentStolenEvent {
  attackerUserId: string;
  victimUserId: string;
  fragmentId: string;
  keyType: string;
  fragmentNum: number;
  name: string;
}

export interface FragmentTransferredEvent {
  fromUserId: string;
  toUserId: string;
  fragmentId: string;
  keyType: string;
  fragmentNum: number;
  name: string;
}

export interface EndgameUnlockedEvent {
  userId: string;
}

export interface EndgameCompletedEvent {
  userId: string;
  choice: string;
}

// ── traceService ──────────────────────────────────────────────────
//
// This whole service was bus-only: zero `io.to(...)`, zero `notifyUser`, and
// nothing anywhere listened. Being traced — the most consequential thing that
// can happen to a hacker — was discoverable only by typing `trace.status`.

export interface TraceInitiatedEvent {
  traceId: string;
  /** The player being traced. */
  targetId: string;
  serverId: string;
}

export interface TraceCompletedEvent {
  traceId: string;
  /** The player whose identity is now exposed. */
  targetId: string;
  initiatedBy: string;
}

// ── backdoorService ───────────────────────────────────────────────
//
// Also bus-only. `installerId` was added to every emit for these bridges: both
// events are asset losses the owner cannot cause and could not be told about,
// and the payload did not say whose asset it was.

export interface BackdoorDiscoveredEvent {
  backdoorId: string;
  serverId: string;
  installerId: string;
  /** "system" — tripped on use; "scan" — a third party went looking. */
  discoveredBy: "system" | "scan";
}

export interface BackdoorExpiredEvent {
  backdoorId: string;
  serverId: string;
  installerId: string;
}
