import { Server as SocketIOServer } from "socket.io";
import { prisma } from "../database/client";
import type { GameEvent, FactionId } from "../../../shared/types";
import { EventType, EventSeverity } from "../../../shared/types";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, SOCKET_IO } from "../di/tokens";
import { notifyUser } from "../utils/notify";
import { intercepts } from "../utils/eventIntercept";
import { TAP_ALL_EVENTS, MAX_ACTIVE_TAPS } from "../config/gameBalance";

// Event subscription tracking
interface EventSubscription {
  userId: string;
  /** An `EventType`, or `TAP_ALL_EVENTS` for a tap that watches everything. */
  eventType: EventType | typeof TAP_ALL_EVENTS;
  targetId?: string | undefined; // serverId, factionId, or userId
  method: "bug" | "hack" | "surveillance" | "insider" | "intercept";
  quality: number; // 0-100, affects event detail/reliability
  expiresAt?: Date | undefined;
  createdAt: Date;
}

// In-memory subscription store (could be moved to Redis for scale)
const activeSubscriptions = new Map<string, EventSubscription>();

/**
 * What a WATCHER is told, per event type.
 *
 * A tap buys awareness of activity on a target, not a copy of that target's
 * private record. Anything not listed here degrades to a generic line rather
 * than falling through to the full description, so a new event type leaks
 * nothing by default — the opposite of the key-name denylist this replaces,
 * where forgetting meant a silent leak.
 */
const WATCHER_SUMMARY: Record<string, string> = {
  honeypot_triggered: "A decoy file was accessed on a server you are watching.",
  hack_detected: "An intrusion was detected on a server you are watching.",
  server_breach: "A server you are watching was breached.",
  player_hack: "A hack was attempted on a target you are watching.",
  faction_war: "War activity involving a faction you are watching.",
};

/**
 * FAIL CLOSED on both fields.
 *
 * The first version returned the real `event.title` for an unlisted type while
 * the message degraded to a generic line — so the docstring's claim that an
 * unlisted event "leaks nothing by default" was true of the message and false
 * of the title. `createServerBreachEvent` builds
 * `Server Breach: ${server.name}` and the honeypot's title names the action,
 * so a future event type would have leaked through the half that was not
 * defaulted. Unlisted now yields a generic title AND a generic message.
 */
const WATCHER_TITLE = "Tap Intercept";

function watcherMessage(event: GameEvent): string {
  return WATCHER_SUMMARY[event.type] ?? "Activity on a target you are watching.";
}

/**
 * Strip identifiers before a broadcast reaches every connected socket.
 *
 * REVIEW 2026-09-25 — a leak I introduced. Widening the public payload from
 * `{type, title, severity, timestamp}` to include `metadata` was meant to stop
 * the one channel that reached people carrying the least.
 *
 * Live global producers (an earlier version of this comment said there was
 * only one, and the same file contradicted it 100 lines below):
 * `storyProgressionService` — metadata `{storyType, category, actorId,
 * actorType, weight}`, where `actorId` is a raw `User.id`; the four
 * `createSystemAlert` callers — metadata `{}`; and `createFactionWarEvent`,
 * whose first live caller this same changeset wired.
 *
 * The prose summaries are deliberately anonymised ("Player stole an AIDA
 * fragment from another player") and the game SELLS aliases at 10000 credits,
 * so identity is meant to be a purchasable secret. Shipping the id in the
 * field next to the summary handed it out for free — and `endgame_unlocked`
 * would have named the one player holding all nine fragments at the exact
 * moment they were most worth hunting.
 *
 * Any key ending in `id` goes. That is blunt on purpose: an allowlist has to be
 * updated every time a producer adds a field, and the failure mode of
 * forgetting is a silent leak, whereas the failure mode here is a missing
 * field someone notices.
 */
function publicMetadata(metadata: Record<string, any> | null | undefined): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object") return {};
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/id$/i.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

@injectable()
export class EventService {
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
  ) {
    // Periodically remove expired in-memory subscriptions
    this.cleanupInterval = setInterval(
      () => this.cleanupExpiredSubscriptions(),
      5 * 60 * 1000,
    );
    (this.cleanupInterval as NodeJS.Timeout & { unref?: () => void }).unref?.();
  }
  // ==================== EVENT CREATION ====================

  /**
   * Create and broadcast a global event
   */
  async createEvent(
    type: EventType,
    title: string,
    description: string,
    metadata: Record<string, any>,
    severity: EventSeverity = EventSeverity.INFO,
    affectedUsers: string[] = [],
    isGlobal: boolean = false,
  ): Promise<GameEvent> {
    // Create event in database
    const event = await prisma.gameEvent.create({
      data: {
        type,
        title,
        description,
        severity,
        isGlobal,
        metadata,
        affectedUsers,
        timestamp: new Date(),
      },
    });

    // Determine who should receive this event
    const gameEvent = event as GameEvent;
    const recipients = this.getEventRecipients(gameEvent);

    // Broadcast to recipients via Socket.IO
    await this.broadcastEvent(gameEvent, recipients);

    // Log event creation
    this.logger.info(
      { type, title, named: recipients.named.length, watchers: recipients.watchers.length },
      "Event created",
    );

    return gameEvent;
  }

  /**
   * Determine which users should receive an event based on subscriptions
   */
  private getEventRecipients(event: GameEvent): { named: string[]; watchers: string[] } {
    const recipients = new Set<string>();

    // Global events are NOT enumerated here.
    //
    // The old code had an `if (event.isGlobal)` branch whose whole body was
    // `event.affectedUsers.forEach(add)` under the comment "Would query for
    // online users, for now just affected users" — i.e. it added exactly the
    // same users the unconditional line below already adds. Every live global
    // producer (storyProgression's weight>=7 beats, all four createSystemAlert
    // callers) passes `affectedUsers: []`, so the set came back EMPTY and no
    // global event has ever been delivered to anyone.
    //
    // They are handled in broadcastEvent by a single `io.emit`, matching the
    // rule notifyUser established: global announcements are transient, and
    // targeted notifications persist. Enumerating every online player here
    // would mean one database row each for an ephemeral broadcast.

    // Targeted: whoever the event names.
    event.affectedUsers.forEach((userId) => recipients.add(userId));

    // Watchers are kept SEPARATE from named recipients, because they do not
    // get the same payload. A honeypot alert names its owner and carries the
    // intruder's raw user id; a player who merely tapped that server is
    // entitled to know the honeypot fired, not to be handed the attacker's
    // identity. The game sells aliases at 10000 credits — a tap must not be a
    // cheaper deanonymiser.
    const watchers = new Set<string>();
    for (const [, subscription] of activeSubscriptions) {
      if (this.shouldReceiveEvent(subscription, event) && !recipients.has(subscription.userId)) {
        watchers.add(subscription.userId);
      }
    }

    return { named: Array.from(recipients), watchers: Array.from(watchers) };
  }

  /**
   * Check if a subscription should receive an event
   */
  private shouldReceiveEvent(
    subscription: EventSubscription,
    event: GameEvent,
  ): boolean {
    // Check if subscription expired
    if (subscription.expiresAt && subscription.expiresAt < new Date()) {
      return false;
    }

    // Event type match. `*` means "watch the target, not one kind of event",
    // which is what a network tap buys — requiring a type per subscription
    // would mean one row per EventType for a single tap.
    if (
      subscription.eventType !== TAP_ALL_EVENTS &&
      subscription.eventType !== event.type
    ) {
      return false;
    }

    // Check target match (if subscription is targeted).
    //
    // MATCH ANY CANDIDATE, never the first one present. This was a
    // short-circuit — `metadata.serverId || metadata.factionId ||
    // metadata.targetUserId` — which silently voided two of the three target
    // kinds the `tap` command offers: nearly every event carries a
    // `serverId` (createHackEvent, createServerBreachEvent and alertHoneypot
    // all do), so the chain resolved to the server id and a player or faction
    // tap could never equal it. A player could spend 18000 credits on
    // `tap <username>`, be told the tap was placed, and receive nothing for
    // twelve hours with no error anywhere.
    //
    // `attackerId`/`breacherId` are deliberately NOT candidates. A tap watches
    // what happens TO its target, not what its target does to other people —
    // matching on the aggressor would turn a surveillance tool into a way to
    // shadow another player's offensive moves across the whole map.
    if (subscription.targetId) {
      // `targetFactionId` was missing from the first version of this list, and
      // createFactionWarEvent is the ONLY live producer of faction metadata —
      // it puts the attacker in `factionId` and the DEFENDER in
      // `targetFactionId`, so half of all faction taps matched nothing. The
      // tap command resolves a name to a bare faction id and cannot know which
      // role it will play, so both keys have to be candidates.
      const candidates = [
        event.metadata.serverId,
        event.metadata.factionId,
        event.metadata.targetFactionId,
        event.metadata.targetUserId,
        event.metadata.userId,
      ];
      if (!candidates.includes(subscription.targetId)) {
        return false;
      }
    }

    // Quality is now a real dial across EVERY severity.
    //
    // It used to apply only to INFO events below quality 30, so a quality-30
    // tap and a quality-100 tap were indistinguishable for every event in the
    // game, and the field's own comment ("affects event detail/reliability")
    // described neither. See utils/eventIntercept.ts.
    return intercepts(subscription.quality, event.severity);
  }

  /**
   * Two channels, and the split is the fix.
   *
   * Targeted events go through `notifyUser`, so they persist and are replayed
   * on reconnect — they used to go out as a bare `game:event` emit, which the
   * client pushed into a `gameEvents` store that NO COMPONENT READ. Every
   * targeted event was invisible even when it was addressed correctly.
   *
   * Global events go out once on `game:event:public`, transient by design.
   *
   * THE PUBLIC EMIT IS NOW GATED ON `isGlobal`. It used to fire for EVERY
   * event including targeted ones, so a `hack_detected` or (once routed here)
   * `honeypot_triggered` told every connected player that someone had just
   * been breached or had tripped a decoy. It also dropped `description` and
   * `metadata`, so the one channel that did reach people carried the least.
   */
  private async broadcastEvent(
    event: GameEvent,
    recipients: { named: string[]; watchers: string[] },
  ): Promise<void> {
    const deliver = (
      userId: string,
      title: string,
      message: string,
      metadata: Record<string, unknown>,
    ) =>
      notifyUser(this.io, userId, {
        type: event.type,
        category: "game",
        title,
        message,
        severity: event.severity,
        data: { eventId: event.id, ...metadata },
      });

    await Promise.all([
      // The parties the event names get the full record.
      ...recipients.named.map((userId) =>
        deliver(userId, event.title, event.description, event.metadata ?? {}),
      ),
      // WATCHERS GET A SUMMARY, NOT THE RECORD.
      //
      // The first version scrubbed only `data`, which missed the point
      // entirely: the sensitive datum in a honeypot alert is the decoy
      // FILENAME, and that lives in `description` — "Intruder accessed decoy
      // file 'payroll.db' on your home server" — which was passed to watchers
      // byte-identically. An attacker could tap the server they were about to
      // raid (nothing excludes the aggressor from watchers) and read the
      // victim's own alarm system to enumerate every decoy, then take the real
      // files while tripping nothing.
      //
      // Access control was never going to fix that. The fix is not to send it:
      // a tap reports THAT something happened on a target, not the details.
      // NO PRODUCER METADATA AT ALL for a watcher, not even key-filtered.
      //
      // Switching the TEXT to a summary was half a fix: `publicMetadata` only
      // drops keys ending in "id", so `data.fileName` still carried the decoy
      // filename — the exact thing the summary was introduced to withhold. A
      // tapper needs to know THAT something happened on a target they already
      // chose; they do not need the producer's record. Withholding all of it
      // is fail-closed by construction, so a new producer field cannot leak
      // here no matter what it is called.
      ...recipients.watchers.map((userId) =>
        deliver(userId, WATCHER_TITLE, watcherMessage(event), {}),
      ),
    ]);

    if (event.isGlobal) {
      this.io.emit("game:event:public", {
        id: event.id,
        type: event.type,
        title: event.title,
        description: event.description,
        severity: event.severity,
        metadata: publicMetadata(event.metadata),
        timestamp: new Date(),
      });
    }
  }

  // ==================== SUBSCRIPTION MANAGEMENT ====================

  /**
   * Create a subscription for a user to listen to events
   */
  async createSubscription(
    userId: string,
    eventType: EventType | typeof TAP_ALL_EVENTS,
    method: EventSubscription["method"],
    targetId?: string,
    quality: number = 50,
    durationMinutes?: number,
  ): Promise<EventSubscription> {
    // Bounded per player. Without a cap a player could hold a subscription on
    // every server they have ever seen, and `getEventRecipients` walks the
    // whole map on every event created.
    const active = this.getUserSubscriptions(userId);
    const replacesExisting = active.some(
      (sub) =>
        sub.eventType === eventType && (sub.targetId ?? null) === (targetId ?? null),
    );
    if (!replacesExisting && active.length >= MAX_ACTIVE_TAPS) {
      throw new Error(
        `Maximum of ${MAX_ACTIVE_TAPS} active taps reached. Remove one first.`,
      );
    }


    const subscription: EventSubscription = {
      userId,
      eventType,
      targetId: targetId || undefined,
      method,
      quality: Math.max(0, Math.min(100, quality)), // Clamp 0-100
      expiresAt: durationMinutes
        ? new Date(Date.now() + durationMinutes * 60 * 1000)
        : undefined,
      createdAt: new Date(),
    };

    const subId = `${userId}:${eventType}:${targetId || "global"}`;

    // Reserve the slot synchronously so the cap above is not a check-then-act
    // across the awaits below, then undo the reservation if the writes fail —
    // the caller treats a throw as "the tap was not placed" and refunds the
    // player's item on that basis.
    //
    // Restore, don't delete: re-tapping the same (user, type, target) reuses
    // this key, so a failed write on a re-tap must put the player's existing
    // working tap back rather than take it away.
    const previous = activeSubscriptions.get(subId);
    activeSubscriptions.set(subId, subscription);

    try {
    // Retire any previous row for this exact (user, type, target) first. The
    // Map is keyed by that triple but the insert below is unconditional, so
    // without this every re-tap leaves another `isActive: true` row behind.
    await prisma.eventSubscription.updateMany({
      where: { userId, eventType, targetId: targetId || null, isActive: true },
      data: { isActive: false },
    });

    // Persist to database
    await prisma.eventSubscription.create({
      data: {
        userId,
        eventType,
        targetId: targetId || null,
        method,
        // `subscription.quality`, not the raw argument: the in-memory copy is
        // clamped to 0-100 and the row was not, so a caller passing 500 got a
        // clamped tap now and an uncapped one after the next restart, when
        // loadSubscriptionsFromDatabase read the row back.
        quality: subscription.quality,
        expiresAt: subscription.expiresAt || null,
        isActive: true,
      },
    });

      this.logger.info({ userId, eventType, method, quality }, "Subscription created");
    } catch (err) {
      // Only roll back if the slot is still OURS. Two `tap` commands on the
      // same target from two tabs produce the same subId: A reserves, B
      // reserves over it, B's insert succeeds, A's fails. A restoring its
      // snapshot — or deleting — would destroy B's live, paid-for, DB-backed
      // subscription, and `getEventRecipients` walks this map, so B's tap
      // would deliver nothing until a restart reloaded it from the row.
      if (activeSubscriptions.get(subId) === subscription) {
        if (previous) activeSubscriptions.set(subId, previous);
        else activeSubscriptions.delete(subId);
      }
      throw err;
    }

    return subscription;
  }

  /**
   * Remove a subscription
   */
  async removeSubscription(
    userId: string,
    eventType: EventType | typeof TAP_ALL_EVENTS,
    targetId?: string,
  ): Promise<boolean> {
    const subId = `${userId}:${eventType}:${targetId || "global"}`;
    const removed = activeSubscriptions.delete(subId);

    if (removed) {
      // Mark as inactive in database
      await prisma.eventSubscription.updateMany({
        where: {
          userId,
          eventType,
          targetId: targetId || null,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });
    }

    return removed;
  }

  /**
   * Get all active subscriptions for a user
   */
  getUserSubscriptions(userId: string): EventSubscription[] {
    const userSubs: EventSubscription[] = [];

    for (const [, subscription] of activeSubscriptions) {
      if (subscription.userId === userId) {
        // Check if expired
        if (!subscription.expiresAt || subscription.expiresAt > new Date()) {
          userSubs.push(subscription);
        }
      }
    }

    return userSubs;
  }

  /**
   * Clean up expired subscriptions
   */
  cleanupExpiredSubscriptions(): number {
    let cleaned = 0;
    const now = new Date();

    for (const [subId, subscription] of activeSubscriptions) {
      if (subscription.expiresAt && subscription.expiresAt < now) {
        activeSubscriptions.delete(subId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.info({ cleaned }, "Cleaned up expired subscriptions");
    }

    return cleaned;
  }

  /**
   * Load active subscriptions from database on startup
   */
  async loadSubscriptionsFromDatabase(): Promise<void> {
    const dbSubscriptions = await prisma.eventSubscription.findMany({
      where: {
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });

    dbSubscriptions.forEach((dbSub) => {
      const subscription: EventSubscription = {
        userId: dbSub.userId,
        eventType: dbSub.eventType as EventType | typeof TAP_ALL_EVENTS,
        targetId: dbSub.targetId || undefined,
        method: dbSub.method as EventSubscription["method"],
        quality: dbSub.quality,
        expiresAt: dbSub.expiresAt || undefined,
        createdAt: dbSub.createdAt,
      };

      const subId = `${subscription.userId}:${subscription.eventType}:${subscription.targetId || "global"}`;
      activeSubscriptions.set(subId, subscription);
    });

    this.logger.info({ count: dbSubscriptions.length }, "Loaded active subscriptions from database");
  }

  // ==================== SPECIFIC EVENT CREATORS ====================

  /**
   * Player hack event
   */
  async createHackEvent(
    attackerId: string,
    targetId: string,
    serverId: string,
    success: boolean,
    detected: boolean,
  ): Promise<GameEvent> {
    return this.createEvent(
      EventType.PLAYER_HACK,
      success ? "Successful Hack Detected" : "Failed Hack Attempt",
      detected
        ? `Security breach attempt ${success ? "succeeded" : "failed"} on server`
        : `Undetected hack attempt ${success ? "succeeded" : "failed"}`,
      {
        attackerId,
        targetId,
        serverId,
        success,
        detected,
      },
      success && detected ? EventSeverity.CRITICAL : EventSeverity.WARNING,
      [targetId], // Target always gets notified
      false,
    );
  }

  /**
   * Server breach event
   */
  async createServerBreachEvent(
    serverId: string,
    breacherId: string,
    severity: EventSeverity = EventSeverity.WARNING,
  ): Promise<GameEvent> {
    const server = await prisma.gameServer.findUnique({
      where: { id: serverId },
      select: { name: true, ownerId: true, ipAddress: true },
    });

    return this.createEvent(
      EventType.SERVER_BREACH,
      `Server Breach: ${server?.name || "Unknown"}`,
      `Unauthorized access detected on ${server?.ipAddress}`,
      {
        serverId,
        breacherId,
        serverName: server?.name,
        serverIp: server?.ipAddress,
      },
      severity,
      server?.ownerId ? [server.ownerId] : [],
      false,
    );
  }

  /**
   * Faction war event
   */
  /**
   * @param faction1 attacker faction ID (a `Faction.id`, used for TAP MATCHING)
   * @param faction2 defender faction ID (likewise)
   * @param attackerName human-readable name for the broadcast title
   * @param defenderName likewise — ids must never reach a title
   */
  async createFactionWarEvent(
    faction1: string,
    faction2: string,
    description: string,
    attackerName = faction1,
    defenderName = faction2,
  ): Promise<GameEvent> {
    return this.createEvent(
      EventType.FACTION_WAR,
      `Faction Conflict: ${attackerName} vs ${defenderName}`,
      description,
      {
        factionId: faction1,
        targetFactionId: faction2,
      },
      EventSeverity.CRITICAL,
      [],
      true, // Global event
    );
  }

  /**
   * Discovery event (player discovers something about AIDA)
   */
  async createDiscoveryEvent(
    userId: string,
    discoveryLevel: number,
    title: string,
    description: string,
  ): Promise<GameEvent> {
    return this.createEvent(
      EventType.DISCOVERY,
      title,
      description,
      {
        userId,
        discoveryLevel,
      },
      EventSeverity.INFO,
      [userId],
      false,
    );
  }

  /**
   * System alert (game-wide announcement)
   */
  async createSystemAlert(
    title: string,
    message: string,
    severity: EventSeverity = EventSeverity.INFO,
  ): Promise<GameEvent> {
    return this.createEvent(
      EventType.SYSTEM_ALERT,
      title,
      message,
      {},
      severity,
      [],
      true, // Global
    );
  }

  /**
   * Reputation change event
   */
  async createReputationChangeEvent(
    userId: string,
    factionId: FactionId,
    oldRep: number,
    newRep: number,
    reason: string,
  ): Promise<GameEvent> {
    const change = newRep - oldRep;
    const direction = change > 0 ? "increased" : "decreased";

    return this.createEvent(
      EventType.REPUTATION_CHANGE,
      `Reputation ${direction}: ${factionId}`,
      reason,
      {
        userId,
        factionId,
        oldRep,
        newRep,
        change,
      },
      Math.abs(change) > 20 ? EventSeverity.WARNING : EventSeverity.INFO,
      [userId],
      false,
    );
  }

  /**
   * Mission update event
   */
  async createMissionUpdateEvent(
    userId: string,
    missionId: string,
    status: string,
    message: string,
  ): Promise<GameEvent> {
    return this.createEvent(
      EventType.MISSION_UPDATE,
      "Mission Update",
      message,
      {
        userId,
        missionId,
        status,
      },
      EventSeverity.INFO,
      [userId],
      false,
    );
  }

  // ==================== EVENT QUERIES ====================

  /**
   * Get recent events for a user
   */
  async getUserEvents(
    userId: string,
    limit: number = 50,
  ): Promise<GameEvent[]> {
    const events = await prisma.gameEvent.findMany({
      where: {
        OR: [{ affectedUsers: { has: userId } }, { isGlobal: true }],
      },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return events as GameEvent[];
  }

  /**
   * Get events by type
   */
  async getEventsByType(
    eventType: EventType,
    limit: number = 50,
  ): Promise<GameEvent[]> {
    const events = await prisma.gameEvent.findMany({
      where: { type: eventType },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return events as GameEvent[];
  }

  /**
   * Get global events (visible to all)
   */
  async getGlobalEvents(limit: number = 20): Promise<GameEvent[]> {
    const events = await prisma.gameEvent.findMany({
      where: { isGlobal: true },
      orderBy: { timestamp: "desc" },
      take: limit,
    });

    return events as GameEvent[];
  }

  /**
   * O9 — stop the subscription sweep.
   *
   * Belt-and-braces: this timer is already `unref`'d at construction and its
   * callback only prunes an in-memory Map, so it can neither hold the process
   * open nor touch a disconnected database. Stopped anyway so that "every
   * recurring timer is stopped on shutdown" is a rule with no exceptions to
   * remember.
   *
   * (An earlier version of this comment claimed a `db.disconnect()` hazard.
   * That is true of the index.ts sweeps, not of this one — the file it was
   * written in contradicted it.)
   */
  public stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

}

export default EventService;
