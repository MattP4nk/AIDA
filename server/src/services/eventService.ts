import { prisma } from "../database/client";
import { io } from "../index";
import type { GameEvent, FactionId } from "../../../shared/types";
import { EventType, EventSeverity } from "../../../shared/types";

// Event subscription tracking
interface EventSubscription {
  userId: string;
  eventType: EventType;
  targetId?: string | undefined; // serverId, factionId, or userId
  method: "bug" | "hack" | "surveillance" | "insider" | "intercept";
  quality: number; // 0-100, affects event detail/reliability
  expiresAt?: Date | undefined;
  createdAt: Date;
}

// In-memory subscription store (could be moved to Redis for scale)
const activeSubscriptions = new Map<string, EventSubscription>();

export class EventService {
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
    this.broadcastEvent(gameEvent, recipients);

    // Log event creation
    console.log(
      `📡 Event created: ${type} - ${title} (recipients: ${recipients.length})`,
    );

    return gameEvent;
  }

  /**
   * Determine which users should receive an event based on subscriptions
   */
  private getEventRecipients(event: GameEvent): string[] {
    const recipients = new Set<string>();

    // Global events go to everyone online
    if (event.isGlobal) {
      // Would query for online users, for now just affected users
      event.affectedUsers.forEach((userId) => recipients.add(userId));
    }

    // Check subscriptions for this event type
    for (const [, subscription] of activeSubscriptions) {
      if (this.shouldReceiveEvent(subscription, event)) {
        recipients.add(subscription.userId);
      }
    }

    // Always send to affected users
    event.affectedUsers.forEach((userId) => recipients.add(userId));

    return Array.from(recipients);
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

    // Check event type match
    if (subscription.eventType !== event.type) {
      return false;
    }

    // Check target match (if subscription is targeted)
    if (subscription.targetId) {
      const eventTargetId =
        event.metadata.serverId ||
        event.metadata.factionId ||
        event.metadata.targetUserId;

      if (subscription.targetId !== eventTargetId) {
        return false;
      }
    }

    // Quality check affects whether low-priority events are received
    if (event.severity === EventSeverity.INFO && subscription.quality < 30) {
      return Math.random() < subscription.quality / 100; // Probabilistic
    }

    return true;
  }

  /**
   * Broadcast event to specific users
   */
  private broadcastEvent(event: GameEvent, recipients: string[]): void {
    recipients.forEach((userId) => {
      io.to(`user:${userId}`).emit("game:event", {
        ...event,
        timestamp: new Date(),
      });
    });

    // Also broadcast to general event channel
    io.emit("game:event:public", {
      type: event.type,
      title: event.title,
      severity: event.severity,
      timestamp: new Date(),
    });
  }

  // ==================== SUBSCRIPTION MANAGEMENT ====================

  /**
   * Create a subscription for a user to listen to events
   */
  async createSubscription(
    userId: string,
    eventType: EventType,
    method: EventSubscription["method"],
    targetId?: string,
    quality: number = 50,
    durationMinutes?: number,
  ): Promise<EventSubscription> {
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
    activeSubscriptions.set(subId, subscription);

    // Persist to database
    await prisma.eventSubscription.create({
      data: {
        userId,
        eventType,
        targetId: targetId || null,
        method,
        quality,
        expiresAt: subscription.expiresAt || null,
        isActive: true,
      },
    });

    console.log(
      `🎧 Subscription created: ${userId} listening to ${eventType} (method: ${method}, quality: ${quality})`,
    );

    return subscription;
  }

  /**
   * Remove a subscription
   */
  async removeSubscription(
    userId: string,
    eventType: EventType,
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
      console.log(`🧹 Cleaned up ${cleaned} expired subscriptions`);
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
        eventType: dbSub.eventType as EventType,
        targetId: dbSub.targetId || undefined,
        method: dbSub.method as EventSubscription["method"],
        quality: dbSub.quality,
        expiresAt: dbSub.expiresAt || undefined,
        createdAt: dbSub.createdAt,
      };

      const subId = `${subscription.userId}:${subscription.eventType}:${subscription.targetId || "global"}`;
      activeSubscriptions.set(subId, subscription);
    });

    console.log(
      `📡 Loaded ${dbSubscriptions.length} active subscriptions from database`,
    );
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
  async createFactionWarEvent(
    faction1: FactionId,
    faction2: FactionId,
    description: string,
  ): Promise<GameEvent> {
    return this.createEvent(
      EventType.FACTION_WAR,
      `Faction Conflict: ${faction1} vs ${faction2}`,
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
}

// Singleton instance
export const eventService = new EventService();

// Cleanup expired subscriptions every 5 minutes
setInterval(
  () => {
    eventService.cleanupExpiredSubscriptions();
  },
  5 * 60 * 1000,
);
