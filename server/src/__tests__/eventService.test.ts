import "reflect-metadata";
import { testDb, createTestUser } from "./setup";
import EventService from "../services/eventService";
import { EventType, EventSeverity } from "../../../shared/types";

describe("EventService Integration Tests", () => {
  let eventService: EventService;

  beforeAll(() => {
    eventService = new EventService();
  });

  describe("Event Creation", () => {
    let testUser: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `eventuser_${timestamp}`,
        email: `eventuser_${timestamp}@test.com`,
      });
    });

    test("should create a basic event", async () => {
      const event = await eventService.createEvent(
        EventType.SYSTEM_ALERT,
        "Test Event",
        "This is a test event",
        { testData: "value" },
        EventSeverity.INFO,
        [testUser.id],
        false,
      );

      expect(event).toBeDefined();
      expect(event.type).toBe(EventType.SYSTEM_ALERT);
      expect(event.title).toBe("Test Event");
      expect(event.description).toBe("This is a test event");
      expect(event.severity).toBe(EventSeverity.INFO);
      expect(event.affectedUsers).toContain(testUser.id);
      expect(event.isGlobal).toBe(false);
      expect(event.metadata).toEqual({ testData: "value" });
    });

    test("should create a global event", async () => {
      const event = await eventService.createEvent(
        EventType.WORLD_EVENT,
        "Global Event",
        "This affects everyone",
        {},
        EventSeverity.CRITICAL,
        [],
        true,
      );

      expect(event.isGlobal).toBe(true);
      expect(event.severity).toBe(EventSeverity.CRITICAL);
    });

    test("should persist event to database", async () => {
      const event = await eventService.createEvent(
        EventType.SYSTEM_ANNOUNCEMENT,
        "DB Test",
        "Testing persistence",
        {},
        EventSeverity.INFO,
        [],
        false,
      );

      const dbEvent = await testDb.gameEvent.findUnique({
        where: { id: event.id },
      });

      expect(dbEvent).toBeDefined();
      expect(dbEvent?.title).toBe("DB Test");
      expect(dbEvent?.type).toBe(EventType.SYSTEM_ANNOUNCEMENT);
    });

    test("should handle multiple affected users", async () => {
      const timestamp = Date.now();
      const user2 = await createTestUser({
        username: `eventuser2_${timestamp}`,
        email: `eventuser2_${timestamp}@test.com`,
      });

      const event = await eventService.createEvent(
        EventType.FACTION_CHANGE,
        "Multi-user Event",
        "Affects multiple users",
        {},
        EventSeverity.WARNING,
        [testUser.id, user2.id],
        false,
      );

      expect(event.affectedUsers).toHaveLength(2);
      expect(event.affectedUsers).toContain(testUser.id);
      expect(event.affectedUsers).toContain(user2.id);
    });

    test("should set timestamp on event creation", async () => {
      const beforeCreation = new Date();
      const event = await eventService.createEvent(
        EventType.SYSTEM_ALERT,
        "Timestamp Test",
        "Testing timestamp",
        {},
      );
      const afterCreation = new Date();

      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeCreation.getTime(),
      );
      expect(event.timestamp.getTime()).toBeLessThanOrEqual(
        afterCreation.getTime(),
      );
    });
  });

  describe("Subscription Management", () => {
    let testUser: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `subuser_${timestamp}`,
        email: `subuser_${timestamp}@test.com`,
      });
    });

    test("should create a subscription", async () => {
      const subscription = await eventService.createSubscription(
        testUser.id,
        EventType.PLAYER_HACK,
        "bug",
        undefined,
        50,
        60,
      );

      expect(subscription).toBeDefined();
      expect(subscription.userId).toBe(testUser.id);
      expect(subscription.eventType).toBe(EventType.PLAYER_HACK);
      expect(subscription.method).toBe("bug");
      expect(subscription.quality).toBe(50);
      expect(subscription.expiresAt).toBeDefined();
    });

    test("should create targeted subscription with targetId", async () => {
      const serverId = "test-server-id";
      const subscription = await eventService.createSubscription(
        testUser.id,
        EventType.SERVER_BREACH,
        "surveillance",
        serverId,
        75,
      );

      expect(subscription.targetId).toBe(serverId);
      expect(subscription.quality).toBe(75);
    });

    test("should create permanent subscription without expiration", async () => {
      const subscription = await eventService.createSubscription(
        testUser.id,
        EventType.SYSTEM_ALERT,
        "intercept",
      );

      expect(subscription.expiresAt).toBeUndefined();
    });

    test("should clamp quality values between 0 and 100", async () => {
      const sub1 = await eventService.createSubscription(
        testUser.id,
        EventType.PLAYER_HACK,
        "hack",
        undefined,
        150,
      );
      expect(sub1.quality).toBe(100);

      const sub2 = await eventService.createSubscription(
        testUser.id,
        EventType.SERVER_BREACH,
        "bug",
        undefined,
        -50,
      );
      expect(sub2.quality).toBe(0);
    });

    test("should persist subscription to database", async () => {
      await eventService.createSubscription(
        testUser.id,
        EventType.FACTION_WAR,
        "insider",
        undefined,
        60,
      );

      const dbSub = await testDb.eventSubscription.findFirst({
        where: {
          userId: testUser.id,
          eventType: EventType.FACTION_WAR,
        },
      });

      expect(dbSub).toBeDefined();
      expect(dbSub?.isActive).toBe(true);
      expect(dbSub?.method).toBe("insider");
      expect(dbSub?.quality).toBe(60);
    });

    test("should retrieve user subscriptions", async () => {
      await eventService.createSubscription(
        testUser.id,
        EventType.PLAYER_HACK,
        "bug",
      );
      await eventService.createSubscription(
        testUser.id,
        EventType.SERVER_BREACH,
        "surveillance",
      );

      const subscriptions = eventService.getUserSubscriptions(testUser.id);

      expect(subscriptions).toHaveLength(2);
      expect(subscriptions[0]?.userId).toBe(testUser.id);
      expect(subscriptions[1]?.userId).toBe(testUser.id);
    });

    test("should remove subscription", async () => {
      await eventService.createSubscription(
        testUser.id,
        EventType.DISCOVERY,
        "hack",
      );

      const removed = await eventService.removeSubscription(
        testUser.id,
        EventType.DISCOVERY,
      );

      expect(removed).toBe(true);

      const subscriptions = eventService.getUserSubscriptions(testUser.id);
      expect(subscriptions).toHaveLength(0);
    });

    test("should mark removed subscription as inactive in database", async () => {
      await eventService.createSubscription(
        testUser.id,
        EventType.MISSION_UPDATE,
        "intercept",
      );

      await eventService.removeSubscription(
        testUser.id,
        EventType.MISSION_UPDATE,
      );

      const dbSub = await testDb.eventSubscription.findFirst({
        where: {
          userId: testUser.id,
          eventType: EventType.MISSION_UPDATE,
        },
      });

      expect(dbSub?.isActive).toBe(false);
    });

    test("should return false when removing non-existent subscription", async () => {
      const removed = await eventService.removeSubscription(
        testUser.id,
        EventType.WORLD_EVENT,
      );

      expect(removed).toBe(false);
    });

    test("should exclude expired subscriptions from user subscriptions", async () => {
      // Create subscription that expires in 1ms
      await eventService.createSubscription(
        testUser.id,
        EventType.PLAYER_HACK,
        "bug",
        undefined,
        50,
        0.0001, // Very short duration
      );

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      const subscriptions = eventService.getUserSubscriptions(testUser.id);
      expect(subscriptions).toHaveLength(0);
    });

    test("should clean up expired subscriptions", async () => {
      await eventService.createSubscription(
        testUser.id,
        EventType.PLAYER_HACK,
        "bug",
        undefined,
        50,
        0.0001,
      );

      await new Promise((resolve) => setTimeout(resolve, 10));

      const cleaned = eventService.cleanupExpiredSubscriptions();
      expect(cleaned).toBeGreaterThan(0);
    });
  });

  describe("Specific Event Creators", () => {
    let attacker: any;
    let target: any;
    let testServer: any;

    beforeEach(async () => {
      const timestamp = Date.now();

      attacker = await createTestUser({
        username: `attacker_${timestamp}`,
        email: `attacker_${timestamp}@test.com`,
      });

      target = await createTestUser({
        username: `target_${timestamp}`,
        email: `target_${timestamp}@test.com`,
      });

      testServer = await testDb.gameServer.create({
        data: {
          name: "Hack Target Server",
          ipAddress: `192.168.1.${Math.floor(Math.random() * 255)}`,
          type: "corporate",
          ownerId: target.id,
        },
      });
    });

    test("should create hack event with success and detection", async () => {
      const event = await eventService.createHackEvent(
        attacker.id,
        target.id,
        testServer.id,
        true,
        true,
      );

      expect(event.type).toBe(EventType.PLAYER_HACK);
      expect(event.title).toContain("Successful");
      expect(event.severity).toBe(EventSeverity.CRITICAL);
      expect(event.metadata.attackerId).toBe(attacker.id);
      expect(event.metadata.targetId).toBe(target.id);
      expect(event.metadata.serverId).toBe(testServer.id);
      expect(event.metadata.success).toBe(true);
      expect(event.metadata.detected).toBe(true);
      expect(event.affectedUsers).toContain(target.id);
    });

    test("should create failed hack event", async () => {
      const event = await eventService.createHackEvent(
        attacker.id,
        target.id,
        testServer.id,
        false,
        false,
      );

      expect(event.title).toContain("Failed");
      expect(event.severity).toBe(EventSeverity.WARNING);
      expect(event.metadata.success).toBe(false);
      expect(event.metadata.detected).toBe(false);
    });

    test("should create server breach event", async () => {
      const event = await eventService.createServerBreachEvent(
        testServer.id,
        attacker.id,
        EventSeverity.CRITICAL,
      );

      expect(event.type).toBe(EventType.SERVER_BREACH);
      expect(event.title).toContain("Hack Target Server");
      expect(event.metadata.serverId).toBe(testServer.id);
      expect(event.metadata.breacherId).toBe(attacker.id);
      expect(event.metadata.serverName).toBe("Hack Target Server");
      expect(event.affectedUsers).toContain(target.id);
    });

    test("should create faction war event", async () => {
      const event = await eventService.createFactionWarEvent(
        "military",
        "anons",
        "Conflict escalates between factions",
      );

      expect(event.type).toBe(EventType.FACTION_WAR);
      expect(event.title).toContain("military vs anons");
      expect(event.description).toBe("Conflict escalates between factions");
      expect(event.metadata.factionId).toBe("military");
      expect(event.metadata.targetFactionId).toBe("anons");
      expect(event.isGlobal).toBe(true);
      expect(event.severity).toBe(EventSeverity.CRITICAL);
    });

    test("should create discovery event", async () => {
      const event = await eventService.createDiscoveryEvent(
        attacker.id,
        5,
        "AIDA Fragment Found",
        "You discovered a fragment of AIDA's true purpose",
      );

      expect(event.type).toBe(EventType.DISCOVERY);
      expect(event.title).toBe("AIDA Fragment Found");
      expect(event.metadata.userId).toBe(attacker.id);
      expect(event.metadata.discoveryLevel).toBe(5);
      expect(event.affectedUsers).toContain(attacker.id);
      expect(event.severity).toBe(EventSeverity.INFO);
    });

    test("should create system alert", async () => {
      const event = await eventService.createSystemAlert(
        "Maintenance Window",
        "Server maintenance scheduled for 2am",
        EventSeverity.WARNING,
      );

      expect(event.type).toBe(EventType.SYSTEM_ALERT);
      expect(event.title).toBe("Maintenance Window");
      expect(event.description).toBe("Server maintenance scheduled for 2am");
      expect(event.severity).toBe(EventSeverity.WARNING);
      expect(event.isGlobal).toBe(true);
    });

    test("should create reputation change event", async () => {
      const event = await eventService.createReputationChangeEvent(
        attacker.id,
        "military",
        50,
        75,
        "Completed military contract",
      );

      expect(event.type).toBe(EventType.REPUTATION_CHANGE);
      expect(event.title).toContain("increased");
      expect(event.title).toContain("military");
      expect(event.description).toBe("Completed military contract");
      expect(event.metadata.userId).toBe(attacker.id);
      expect(event.metadata.factionId).toBe("military");
      expect(event.metadata.oldRep).toBe(50);
      expect(event.metadata.newRep).toBe(75);
      expect(event.metadata.change).toBe(25);
      expect(event.severity).toBe(EventSeverity.WARNING);
      expect(event.affectedUsers).toContain(attacker.id);
    });

    test("should create reputation decrease event", async () => {
      const event = await eventService.createReputationChangeEvent(
        attacker.id,
        "sword_corp",
        80,
        60,
        "Failed contract",
      );

      expect(event.title).toContain("decreased");
      expect(event.metadata.change).toBe(-20);
    });

    test("should create low severity reputation change for small changes", async () => {
      const event = await eventService.createReputationChangeEvent(
        attacker.id,
        "anons",
        50,
        55,
        "Minor contribution",
      );

      expect(event.severity).toBe(EventSeverity.INFO);
    });

    test("should create mission update event", async () => {
      const missionId = "test-mission-123";
      const event = await eventService.createMissionUpdateEvent(
        attacker.id,
        missionId,
        "in_progress",
        "Mission objective updated",
      );

      expect(event.type).toBe(EventType.MISSION_UPDATE);
      expect(event.title).toBe("Mission Update");
      expect(event.description).toBe("Mission objective updated");
      expect(event.metadata.userId).toBe(attacker.id);
      expect(event.metadata.missionId).toBe(missionId);
      expect(event.metadata.status).toBe("in_progress");
      expect(event.affectedUsers).toContain(attacker.id);
    });
  });

  describe("Event Queries", () => {
    let testUser: any;
    let event1: any;
    let event2: any;
    let globalEvent: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `queryuser_${timestamp}`,
        email: `queryuser_${timestamp}@test.com`,
      });

      event1 = await eventService.createEvent(
        EventType.PLAYER_HACK,
        "Event 1",
        "First event",
        {},
        EventSeverity.INFO,
        [testUser.id],
        false,
      );

      event2 = await eventService.createEvent(
        EventType.PLAYER_HACK,
        "Event 2",
        "Second event",
        {},
        EventSeverity.WARNING,
        [testUser.id],
        false,
      );

      globalEvent = await eventService.createEvent(
        EventType.WORLD_EVENT,
        "Global Event",
        "Everyone sees this",
        {},
        EventSeverity.CRITICAL,
        [],
        true,
      );
    });

    test("should get user events", async () => {
      const events = await eventService.getUserEvents(testUser.id);

      expect(events.length).toBeGreaterThanOrEqual(2);
      expect(events.some((e) => e.id === event1.id)).toBe(true);
      expect(events.some((e) => e.id === event2.id)).toBe(true);
    });

    test("should include global events in user events", async () => {
      const events = await eventService.getUserEvents(testUser.id);

      expect(events.some((e) => e.id === globalEvent.id)).toBe(true);
    });

    test("should respect limit parameter in user events", async () => {
      const events = await eventService.getUserEvents(testUser.id, 1);

      expect(events).toHaveLength(1);
    });

    test("should order user events by most recent first", async () => {
      const events = await eventService.getUserEvents(testUser.id);

      // Most recent should be first
      expect(events[0]?.timestamp.getTime()).toBeGreaterThanOrEqual(
        events[events.length - 1]?.timestamp.getTime() || 0,
      );
    });

    test("should get events by type", async () => {
      const hackEvents = await eventService.getEventsByType(
        EventType.PLAYER_HACK,
      );

      expect(hackEvents.length).toBeGreaterThanOrEqual(2);
      expect(hackEvents.every((e) => e.type === EventType.PLAYER_HACK)).toBe(
        true,
      );
    });

    test("should respect limit in events by type", async () => {
      const events = await eventService.getEventsByType(
        EventType.PLAYER_HACK,
        1,
      );

      expect(events).toHaveLength(1);
    });

    test("should get global events", async () => {
      const events = await eventService.getGlobalEvents();

      expect(events.length).toBeGreaterThan(0);
      expect(events.every((e) => e.isGlobal === true)).toBe(true);
      expect(events.some((e) => e.id === globalEvent.id)).toBe(true);
    });

    test("should respect limit in global events", async () => {
      const events = await eventService.getGlobalEvents(1);

      expect(events).toHaveLength(1);
    });

    test("should not include user-specific events in global events", async () => {
      const events = await eventService.getGlobalEvents();

      expect(events.some((e) => e.id === event1.id)).toBe(false);
      expect(events.some((e) => e.id === event2.id)).toBe(false);
    });
  });

  describe("Subscription Loading", () => {
    let testUser: any;

    beforeEach(async () => {
      const timestamp = Date.now();
      testUser = await createTestUser({
        username: `loaduser_${timestamp}`,
        email: `loaduser_${timestamp}@test.com`,
      });
    });

    test("should load active subscriptions from database", async () => {
      // Create subscriptions directly in DB
      await testDb.eventSubscription.create({
        data: {
          userId: testUser.id,
          eventType: EventType.SERVER_BREACH,
          method: "surveillance",
          quality: 80,
          isActive: true,
        },
      });

      await testDb.eventSubscription.create({
        data: {
          userId: testUser.id,
          eventType: EventType.FACTION_WAR,
          method: "insider",
          quality: 60,
          isActive: true,
        },
      });

      // Load subscriptions
      await eventService.loadSubscriptionsFromDatabase();

      const subscriptions = eventService.getUserSubscriptions(testUser.id);
      expect(subscriptions.length).toBeGreaterThanOrEqual(2);
    });

    test("should not load inactive subscriptions from database", async () => {
      await testDb.eventSubscription.create({
        data: {
          userId: testUser.id,
          eventType: EventType.DISCOVERY,
          method: "hack",
          quality: 50,
          isActive: false,
        },
      });

      await eventService.loadSubscriptionsFromDatabase();

      const subscriptions = eventService.getUserSubscriptions(testUser.id);
      const hasInactive = subscriptions.some(
        (s) => s.eventType === EventType.DISCOVERY,
      );
      expect(hasInactive).toBe(false);
    });

    test("should not load expired subscriptions from database", async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

      await testDb.eventSubscription.create({
        data: {
          userId: testUser.id,
          eventType: EventType.PLAYER_HACK,
          method: "bug",
          quality: 70,
          isActive: true,
          expiresAt: pastDate,
        },
      });

      await eventService.loadSubscriptionsFromDatabase();

      const subscriptions = eventService.getUserSubscriptions(testUser.id);
      const hasExpired = subscriptions.some(
        (s) => s.eventType === EventType.PLAYER_HACK,
      );
      expect(hasExpired).toBe(false);
    });
  });
});
