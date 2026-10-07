import "reflect-metadata";
import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import logger from "./logger";

import { config, validateConfig, CORS_ORIGINS } from "./config/environment";
import { db } from "./database/client";
import { reconcileShopItems } from "../prisma/reconcileShopItems";
import { initializeContainer, getService } from "./di/container";
import { ACHIEVEMENT_SERVICE, BACKDOOR_SERVICE, AI_SCHEDULER_SERVICE, ARCHITECT_INTERVENTION_EXECUTOR, CENSORSHIP_SERVICE, CONTENT_DRAFT_SERVICE, CONTENT_QUEUE_SERVICE, DARKNET_DUNGEON_SERVICE, DYNAMIC_CONTENT_SERVICE, EPOCH_SCHEDULER_SERVICE, EVENT_SERVICE, FACTION_SERVICE, FORUM_SERVICE, GAME_STATE_MANAGER, HACK_SERVICE, IP_SERVICE, KEY_FRAGMENT_SERVICE, MESSAGE_SERVICE, MISSION_SERVICE, PERSONA_MAIL_QUEUE_SERVICE, PERSONA_SERVICE, PROGRESS_SERVICE, REFERENCE_VALIDATION_SERVICE, RESOURCE_SERVICE, SERVER_CONTENT_SERVICE, SHOP_SERVICE, STORY_MISSION_SERVICE, TRACE_SERVICE, STORY_PROGRESSION_SERVICE, TUTORIAL_SERVICE, WARFARE_SERVICE } from "./di/tokens";

import type GameStateManager from "./services/gameStateManager";
import type ProgressService from "./services/progressService";
import type IPService from "./services/ipService";
import type EventService from "./services/eventService";
import type ShopService from "./services/shopService";
import type { PersonaService } from "./services/personaService";
import type AISchedulerService from "./services/aiSchedulerService";
import type HackService from "./services/hackService";
import type MissionService from "./services/missionService";
import type { DynamicContentService } from "./services/dynamicContentService";
import type { StoryMissionService } from "./services/storyMissionService";
import type MessageService from "./services/messageService";
import type { TutorialService } from "./services/tutorialService";
import type { StoryProgressionService } from "./services/storyProgressionService";
import type { ArchitectInterventionExecutor } from "./services/architectInterventionExecutor";
import type { DarkNetDungeonService } from "./services/darknetDungeonService";
import type { FactionService } from "./services/factionService";
import type { ForumService } from "./services/forumService";

import type {
  BackdoorDiscoveredEvent,
  BackdoorExpiredEvent,
  BountyPostedEvent,
  EndgameCompletedEvent,
  EndgameUnlockedEvent,
  FactionMembershipEvent,
  FactionRankAchievedEvent,
  FactionReputationChangedEvent,
  FragmentClaimedEvent,
  FragmentStolenEvent,
  FragmentTransferredEvent,
  HackAttemptEvent,
  HackDetectedEvent,
  IdsAlertEvent,
  MissionCompletedEvent,
  MissionFailedEvent,
  MissionFeedbackEvent,
  PlayerLevelUpEvent,
  RewardsCreditsGrantedEvent,
  RewardsXpGrantedEvent,
  TraceCompletedEvent,
  TraceInitiatedEvent,
} from "./services/serviceEvents";

// Extracted modules
import {
  setupMiddleware,
  setupRoutes,
  setupErrorHandling,
} from "./middleware/setup";
import { setupSocketHandlers } from "./sockets/handlers";
import { registerShutdownHandlers } from "./lifecycle";
import { registerShutdownTimer } from "./utils/shutdownTimers";
import { notifyUser } from "./utils/notify";
import {
  ARCHITECT_EVAL_INTERVAL_MS,
  DUNGEON_EXPIRATION_INTERVAL_MS,
  NOTIFICATION_PURGE_INTERVAL_MS,
} from "./config/gameBalance";

// ── Infrastructure ────────────────────────────────────────────────
const app = express();
const server = createServer(app);

/**
 * Fire-and-forget async work without blocking the event emitter.
 *
 * Every cross-service reaction wired below goes through this. The EventEmitter
 * returns immediately, so one slow handler — an AI call, a database write —
 * cannot delay delivery to the other listeners on the same event, and one
 * failing handler cannot reject into an emitter that has nowhere to put the
 * error. The label is what turns that swallowed rejection into a log line.
 *
 * Module scope rather than a local, so the wiring phases can be lifted out of
 * `initialize()` without each one redefining it.
 */
function defer(fn: () => Promise<unknown>, label: string): void {
  queueMicrotask(() => {
    fn().catch((err) => logger.error({ err }, label));
  });
}

const io = new SocketIOServer(server, {
  cors: {
    origin: CORS_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

/**
 * Long-running work owned by services: the two generation queues, the resource
 * and warfare monitors, mission expiry, and the censorship ruleset.
 *
 * Split out of `initialize()`, which had grown to 519 lines. Services are
 * re-resolved here rather than threaded in as parameters — every token is a
 * tsyringe singleton, so resolution is a registry lookup and the alternative
 * is a six-argument signature that has to change every time a phase gains a
 * dependency.
 *
 * THE TWO QUEUES FAIL SOFT, the four monitors do not. That asymmetry is
 * deliberate and predates this split: content generation and persona mail are
 * enrichment, and a server that boots without them is degraded but playable,
 * whereas a failure to start resource generation or load censorship rules is a
 * broken world and should take the boot down.
 */
async function startQueuesAndMonitors(): Promise<void> {
  // Content generation queue — reliable pipeline for server content
  try {
    const contentQueue = getService<import("./services/contentQueueService").ContentQueueService>(CONTENT_QUEUE_SERVICE);
    const contentService = getService<import("./services/serverContentService").ServerContentService>(SERVER_CONTENT_SERVICE);
    contentQueue.setServerContentService(contentService);
    await contentQueue.start();
    await contentQueue.enqueueAllUnpopulated();
    logger.info("✅ Content generation queue started");
  } catch (err) {
    logger.warn({ err }, "Content queue initialization failed (non-critical)");
  }

  // Deferred persona mail — replies arrive after a human-plausible delay, and
  // generation happens when an item comes due so bursts spread over time.
  try {
    const mailQueue =
      getService<import("./services/personaMailQueueService").PersonaMailQueueService>(
        PERSONA_MAIL_QUEUE_SERVICE,
      );
    mailQueue.start();
    logger.info("✅ Persona mail queue started");
  } catch (err) {
    logger.warn({ err }, "Persona mail queue initialization failed (non-critical)");
  }

  const resourceService =
    getService<import("./services/resourceService").default>(RESOURCE_SERVICE);
  resourceService.startResourceGeneration();
  logger.info("✅ Resource generation started");

  // Start warfare monitor
  const warfareService =
    getService<import("./services/warfareService").default>(WARFARE_SERVICE);
  warfareService.startWarMonitor();
  logger.info("✅ Warfare monitor started");

  // Start mission expiration checker (every 15 min)
  const missionService = getService<MissionService>(MISSION_SERVICE);
  missionService.startExpirationChecker();
  logger.info("✅ Mission expiration checker started");

  // Load censorship rules (seed defaults if none exist)
  const censorshipService =
    getService<import("./services/censorshipService").default>(
      CENSORSHIP_SERVICE,
    );
  await censorshipService.seedDefaultRules();
  logger.info("✅ Censorship rules loaded");
}

/**
 * Bridge in-process service events onto sockets and onto other services.
 *
 * This is the largest phase and the one most worth isolating: it is a flat
 * list of `X.on("event", …)` registrations, and the failure mode when it lives
 * inline is that a reader scanning `initialize()` for "what happens when a
 * mission completes" finds one block and stops. Every body here is `defer`-ed.
 *
 * `storyProgression` is a parameter, not a re-resolution, because the caller
 * has already awaited `initializeFirstEpoch()` on that instance — the ledger
 * writes below depend on Epoch 0 existing, and a parameter makes that ordering
 * visible rather than implicit.
 */
function wireServiceEvents(storyProgression: StoryProgressionService): void {
  const personaService = getService<PersonaService>(PERSONA_SERVICE);
  const hackService = getService<HackService>(HACK_SERVICE);
  const missionService = getService<MissionService>(MISSION_SERVICE);
  const factionService = getService<FactionService>(FACTION_SERVICE);
  const traceService = getService<import("./services/traceService").TraceService>(TRACE_SERVICE);
  const backdoorService =
    getService<import("./services/backdoorService").BackdoorService>(BACKDOOR_SERVICE);

  // ── Things happening TO you ──────────────────────────────────────
  //
  // traceService and backdoorService were both 100% bus-only: no `io`, no
  // `notifyUser`, and no listener anywhere. Every event below is a consequence
  // of someone ELSE's action, so the player has no reason to go looking — and
  // the only way to find out was to type `trace.status` or notice a backdoor
  // missing from `backdoor list`.
  //
  // Routed through `notifyUser` rather than new socket events on purpose: it
  // persists, so a player who was offline when they were traced still learns
  // about it on reconnect, and it reuses the notification path the client
  // already renders. A new socket event would have needed a new client
  // listener to say the same thing, less durably.
  traceService.on("trace:initiated", (data: TraceInitiatedEvent) => {
    defer(() => notifyUser(io, data.targetId, {
      type: "security_alert",
      category: "security",
      title: "Trace Detected",
      message: "Someone is tracing your connection. Use `trace.evade` to break it.",
      priority: "high",
      data: { traceId: data.traceId, serverId: data.serverId },
    }), "Trace-initiated notification error");
  });

  traceService.on("trace:completed", (data: TraceCompletedEvent) => {
    defer(() => notifyUser(io, data.targetId, {
      type: "security_alert",
      category: "security",
      title: "Identity Exposed",
      message: "A trace against you completed. Your identity has been exposed.",
      priority: "critical",
      data: { traceId: data.traceId },
    }), "Trace-completed notification error");
  });

  backdoorService.on("backdoor:discovered", (data: BackdoorDiscoveredEvent) => {
    defer(() => notifyUser(io, data.installerId, {
      type: "security_alert",
      category: "security",
      title: "Backdoor Discovered",
      message:
        data.discoveredBy === "scan"
          ? "A security scan found one of your backdoors. It has been removed."
          : "One of your backdoors was detected in use and has been disabled.",
      priority: "high",
      data: { serverId: data.serverId },
    }), "Backdoor-discovered notification error");
  });

  backdoorService.on("backdoor:expired", (data: BackdoorExpiredEvent) => {
    defer(() => notifyUser(io, data.installerId, {
      type: "backdoor_expired",
      category: "game",
      title: "Backdoor Expired",
      message: "One of your backdoors has expired and no longer grants access.",
      priority: "normal",
      data: { serverId: data.serverId },
    }), "Backdoor-expired notification error");
  });

  //
  // All event side-effects are deferred via queueMicrotask so the EventEmitter
  // returns immediately. This prevents slow handlers (AI calls, DB writes)
  // from blocking event delivery to other listeners.
  const dynamicContent = getService<DynamicContentService>(
    DYNAMIC_CONTENT_SERVICE,
  );


  // ── Reward notifications: bridge service events to the player's socket ──
  //
  // `missionService` has always raised these with full payloads, and the client
  // has always had handlers for them — but nothing forwarded the EventEmitter
  // event onto the socket, so they fired into the void. The player earned XP and
  // credits from background paths (a process completing, a mission credited by a
  // hook, a dungeon payout) with NO feedback at all.
  //
  // The old client comment "silent — shown in command output" was true when
  // rewards only came from synchronous commands. It stopped being true once they
  // started arriving asynchronously.
  missionService.on("rewards:xp_granted", (data: RewardsXpGrantedEvent) => {
    if (!data?.userId) return;
    io.to(`player:${data.userId}`).emit("rewards:xp_granted", data);
  });

  missionService.on("rewards:credits_granted", (data: RewardsCreditsGrantedEvent) => {
    if (!data?.userId) return;
    io.to(`player:${data.userId}`).emit("rewards:credits_granted", data);
  });

  hackService.on("hack:detected", (data: HackDetectedEvent) => {
    defer(() => dynamicContent.processEvent("hack:detected", data), "Dynamic content error on hack:detected");
  });

  // Single unified hack:attempt handler — dynamic content, story ledger, persona, achievements
  hackService.on("hack:attempt", (data: HackAttemptEvent) => {
    defer(() => dynamicContent.processEvent("hack:attempt", data), "Dynamic content error on hack:attempt");
    // The `|| data.success`, `|| data.userId` and `|| data.serverId`
    // alternatives that used to be here were DEAD: this payload has never had
    // those names, so every one of them was an unreachable fallback that
    // `any` kept compiling. `method` was the opposite problem — it was read
    // and never sent, so the ledger recorded `undefined` on every hack until
    // the emitter started including it.
    if (data.result?.success) {
      defer(() => storyProgression.recordEvent({
        type: "hack",
        category: "combat",
        actorId: data.attackerId,
        actorType: "player",
        summary: `Player hacked server ${data.serverName || data.targetServerId}`,
        data: {
          serverId: data.targetServerId,
          serverName: data.serverName,
          method: data.method,
        },
        impact: { tension: 1 },
        weight: 3,
      }), "Story ledger error on hack");
      defer(() => personaService.onServerHacked({
        userId: data.attackerId,
        serverId: data.targetServerId,
        serverName: data.serverName,
        difficulty: data.difficulty,
      }), "Persona error on hack:attempt");
      if (data.attackerId) {
        defer(() => achievementService.checkAndAward(data.attackerId), "Achievement check error after hack");
      }
    }

    // ── Tell the VICTIM they were hacked ─────────────────────────────
    //
    // Orphan audit #2: the client has had the whole feature — a `hackAttempts`
    // store, a sound, a "Security Breach" notification — waiting on
    // `hack:attempted` / `hack:successful` / `hack:blocked`, and hackService
    // socket-emitted NOTHING. Zero `io.to(...)` calls in the entire service.
    // The events existed only on the internal bus, so the defender never
    // learned anything, ever.
    //
    // GATED ON DETECTION, which is the whole point. Firing on every attempt
    // would tell the victim about hacks their defences did not notice, which
    // makes the detection roll decorative and every point of stealth skill
    // worthless. `detected` is carried on the payload for exactly this.
    //
    // `targetId` falls back to `attackerId` for an unowned server, so the
    // equality guard is what stops an attacker being notified about their own
    // hack of a neutral box.
    if (data.detected && data.targetId && data.targetId !== data.attackerId) {
      const victimId = data.targetId;
      const succeeded = data.result?.success === true;
      defer(async () => {
        const attacker = await db.client.user.findUnique({
          where: { id: data.attackerId },
          select: { username: true },
        });
        const payload = {
          targetUserId: victimId,
          attackerName: attacker?.username ?? "unknown",
          serverName: data.serverName,
          serverId: data.targetServerId,
          method: data.method,
        };
        io.to(`player:${victimId}`).emit("hack:attempted", payload);
        // Two literal branches rather than `emit(succeeded ? a : b, …)`.
        // A computed event name is invisible to the socket-contract check —
        // it found these as orphaned client listeners even though the emit
        // was right here — and equally invisible to anyone grepping for who
        // sends `hack:successful`.
        if (succeeded) {
          io.to(`player:${victimId}`).emit("hack:successful", payload);
        } else {
          io.to(`player:${victimId}`).emit("hack:blocked", payload);
        }
      }, "Victim hack alert error");
    }
  });

  hackService.on("ids_alert", (data: IdsAlertEvent) => {
    defer(() => dynamicContent.processEvent("ids_alert", data), "Dynamic content error on ids_alert");
    // Push IDS alert to player via Socket.IO
    io.to(`player:${(data as any).targetUserId}`).emit("command:result", {
      success: false,
      output: (data as any).message,
      timestamp: new Date(),
    });
  });

  hackService.countermeasures.on("bounty:posted", (data: BountyPostedEvent) => {
    defer(() => dynamicContent.processEvent("bounty:posted", data), "Dynamic content error on bounty:posted");
  });

  // Resolve services needed by event handlers below
  const storyMissionService = getService<StoryMissionService>(STORY_MISSION_SERVICE);
  const achievementService = getService<import("./services/achievementService").AchievementService>(ACHIEVEMENT_SERVICE);
  const tutorialService = getService<TutorialService>(TUTORIAL_SERVICE);

  // ONE registration for this event, not two.
  //
  // The tutorial advance used to live in its own `missionService.on(
  // "mission:completed", …)` 190 lines further down, purely because that is
  // where `tutorialService` happened to be resolved. Two registrations for one
  // event is how two sets of consequences drift: a reader checking "what
  // happens when a mission completes" finds the first block and stops, and
  // nothing in the type system or the tests says there is a second.
  //
  // Every branch here is `defer`-ed — fire-and-forget microtasks, each with its
  // own catch — so merging them changes no ordering that anything can observe.
  missionService.on("mission:completed", (data: MissionCompletedEvent) => {
    defer(() => personaService.onMissionCompleted(data), "Persona error on mission:completed");
    defer(() => dynamicContent.processEvent("mission:completed", data), "Dynamic content error on mission:completed");
    if (data.userId)
      defer(() => achievementService.checkAndAward(data.userId), "Achievement check error on mission:completed");
    if (data.missionId)
      defer(() => storyMissionService.advanceStory(data.missionId, "completed"), "Story mission advance error on mission:completed");
    defer(() => storyProgression.recordEvent({
      type: "player_choice",
      category: "narrative",
      actorId: data.userId,
      actorType: "player",
      // `data.title` and `data.type`, as this read until 2026-10-06, are not
      // fields of this event — the bus payload calls them `missionTitle` and
      // (newly) `missionType`. So EVERY ledger entry for a completed mission
      // read "Completed mission: <cuid>" with a `type: undefined`, for as long
      // as the feature has existed. `any` is the only reason it compiled.
      summary: `Completed mission: ${data.missionTitle || data.missionId}`,
      data: { missionId: data.missionId, type: data.missionType, factionId: data.factionId },
      impact: data.factionId ? { factions: { [data.factionId]: 2 } } : {},
      weight: 4,
    }), "Story ledger error on mission:completed");
    if (data.userId)
      defer(() => tutorialService.advanceTutorial(data.userId, data.missionId), "Tutorial advance error on mission:completed");
  });

  missionService.on("mission:failed", (data: MissionFailedEvent) => {
    // R12 REVIEW: abandoning is NOT a narrative failure.
    //
    // `advanceStory(id, "failed")` walks the step's `failureBranch`, which can
    // set `storyArc.status = "failed"` permanently — there is no path back.
    // Meanwhile `abandonMission` returns the Mission row to the pool
    // (`status: "available"`, `assignedTo: null`). So a player who took a
    // story mission and thought better of it burned down the whole arc, while
    // the mission itself sat there available for someone to take again. Once
    // the emit existed, "abandon" and "fail" could no longer share a path.
    //
    // Expiry still advances the arc — running out of time IS failing.
    const abandoned = data.reason === "abandoned";

    if (data.missionId && !abandoned)
      defer(() => storyMissionService.advanceStory(data.missionId, "failed"), "Story mission advance error on mission:failed");

    // The ledger records both — the narrative should remember that the player
    // walked away, it just should not branch the arc on it.
    defer(() => storyProgression.recordEvent({
      type: "player_choice",
      category: "narrative",
      actorId: data.userId,
      actorType: "player",
      summary: `${abandoned ? "Abandoned" : "Failed"} mission: ${data.missionId}`,
      data: { missionId: data.missionId, reason: data.reason },
      weight: abandoned ? 1 : 2,
    }), "Story ledger error on mission:failed");
  });

  // Mission feedback → AI learns from outcomes
  missionService.on("mission:feedback", (data: MissionFeedbackEvent) => {
    defer(async () => {
      // Record as faction leader knowledge (if faction mission)
      if (data.factionId) {
        const factionLeader = await db.client.aIPersona.findFirst({
          where: { type: "faction_leader", faction: { id: data.factionId } },
          select: { id: true },
        });
        if (factionLeader) {
          const gradeEmoji = data.difficultyGrade === "too_easy" ? "trivial" : data.difficultyGrade === "too_hard" ? "overwhelming" : "well-calibrated";
          const abandonNote = data.abandoned ? " (ABANDONED)" : "";
          await personaService.addKnowledge(factionLeader.id, {
            source: "mission_feedback",
            type: "mission_feedback",
            content: `Mission feedback${abandonNote}: Level ${data.playerLevel} operative graded difficulty-${data.missionDifficulty} ${data.missionType} mission as "${gradeEmoji}". Time: ${data.timeToCompleteMin}min. Efficiency: ${data.efficiencyScore}%. Objectives: ${data.objectiveTypes.join(", ")}.`,
            confidence: 1.0,
          });
        }
      }

      // Also inform the Game Master
      const gm = await db.client.aIPersona.findFirst({
        where: { type: "game_master" },
        select: { id: true },
      });
      if (gm) {
        await personaService.addKnowledge(gm.id, {
          source: "mission_feedback",
          type: "mission_feedback",
          content: `Mission outcome: Level ${data.playerLevel} player ${data.abandoned ? "abandoned" : "completed"} difficulty-${data.missionDifficulty} ${data.missionType} mission. Grade: ${data.difficultyGrade}. Time: ${data.timeToCompleteMin}min.`,
          confidence: 1.0,
        });
      }
    }, "Mission feedback knowledge error");
  });

  // Faction events → story ledger
  factionService.on("faction:member_joined", (data: FactionMembershipEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player joined faction ${data.factionName || data.factionId}`,
      data: { factionId: data.factionId },
      impact: { factions: { [data.factionId]: 5 } }, weight: 5,
    }), "Story ledger error on faction:member_joined");
    defer(() => dynamicContent.processEvent("faction:member_joined", data), "Dynamic content error on faction:member_joined");
  });

  factionService.on("faction:member_left", (data: FactionMembershipEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player left faction ${data.factionName || data.factionId}`,
      data: { factionId: data.factionId },
      impact: { factions: { [data.factionId]: -5 } }, weight: 4,
    }), "Story ledger error on faction:member_left");
    defer(() => dynamicContent.processEvent("faction:member_left", data), "Dynamic content error on faction:member_left");
  });

  factionService.on("faction:reputation_changed", (data: FactionReputationChangedEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player reputation changed with faction ${data.factionId}: ${data.amount > 0 ? "+" : ""}${data.amount} (now ${data.newReputation})`,
      data: { factionId: data.factionId, amount: data.amount, newReputation: data.newReputation },
      impact: { factions: { [data.factionId]: data.amount > 0 ? 1 : -1 } }, weight: 2,
    }), "Story ledger error on faction:reputation_changed");

    // Tell the player. This bridge was LEDGER-ONLY: the `reputation:changed`
    // socket event exists and the client has always handled it, but the only
    // emitter was reputationEngine — so the two paths that call
    // `factionService.addReputation` directly (hackService's post-hack faction
    // penalty, and the bounty claim in playerInfoCommands) changed standing
    // silently, as did the engine's own rival-faction spillover.
    //
    // Emitting from the bus event means every reputation change is covered by
    // construction, because `addReputation` is the single writer.
    if (data.amount !== 0) {
      defer(async () => {
        const faction = await db.client.faction.findUnique({
          where: { id: data.factionId },
          select: { name: true },
        });
        io.to(`player:${data.userId}`).emit("reputation:changed", {
          factionId: data.factionId,
          factionName: faction?.name ?? "Faction",
          amount: data.amount,
          newReputation: data.newReputation,
          reason: data.reason,
        });
      }, "Reputation socket bridge error");
    }
  });

  factionService.on("faction:rank_achieved", (data: FactionRankAchievedEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "player_choice", category: "diplomacy", actorId: data.userId, actorType: "player",
      summary: `Player achieved rank ${data.newRank} in faction ${data.factionId}`,
      data: { factionId: data.factionId, newRank: data.newRank },
      impact: { factions: { [data.factionId]: 3 } }, weight: 5,
    }), "Story ledger error on faction:rank_achieved");
  });

  // Key Fragment Service events
  const keyFragmentService =
    getService<import("./services/keyFragmentService").KeyFragmentService>(
      KEY_FRAGMENT_SERVICE,
    );

  keyFragmentService.on("fragment:claimed", (data: FragmentClaimedEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "fragment_claimed", category: "discovery", actorId: data.userId, actorType: "player",
      summary: `Player claimed AIDA fragment: ${data.name} (${data.keyType} ${data.fragmentNum}/3)`,
      data: { fragmentId: data.fragmentId, keyType: data.keyType, fragmentNum: data.fragmentNum },
      impact: { discoveryWeight: 5, tension: 2 }, weight: 7,
    }), "Story ledger error on fragment:claimed");
    defer(() => dynamicContent.processEvent("fragment:claimed", data), "Dynamic content error on fragment:claimed");
  });

  keyFragmentService.on("fragment:stolen", (data: FragmentStolenEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "fragment_stolen", category: "conflict", actorId: data.attackerUserId, actorType: "player",
      targetId: data.victimUserId, targetType: "player",
      summary: `Player stole AIDA fragment ${data.name} (${data.keyType}) from another player`,
      data: { fragmentId: data.fragmentId, keyType: data.keyType, fragmentNum: data.fragmentNum, attackerUserId: data.attackerUserId, victimUserId: data.victimUserId },
      impact: { discoveryWeight: 7, tension: 4 }, weight: 8,
    }), "Story ledger error on fragment:stolen");
    defer(() => dynamicContent.processEvent("fragment:stolen", data), "Dynamic content error on fragment:stolen");
  });

  keyFragmentService.on("fragment:transferred", (data: FragmentTransferredEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "fragment_transferred", category: "social", actorId: data.fromUserId, actorType: "player",
      targetId: data.toUserId, targetType: "player",
      summary: `Player traded AIDA fragment ${data.name} (${data.keyType}) to another player`,
      data: { fragmentId: data.fragmentId, keyType: data.keyType, fragmentNum: data.fragmentNum, fromUserId: data.fromUserId, toUserId: data.toUserId },
      impact: { discoveryWeight: 3, tension: 1 }, weight: 6,
    }), "Story ledger error on fragment:transferred");
  });

  keyFragmentService.on("endgame:unlocked", (data: EndgameUnlockedEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "endgame_unlocked", category: "milestone", actorId: data.userId, actorType: "player",
      summary: "A player has collected all 9 AIDA fragments. The endgame is unlocked.",
      data: { userId: data.userId },
      impact: { discoveryWeight: 10, tension: 5 }, weight: 10,
    }), "Story ledger error on endgame:unlocked");
  });

  keyFragmentService.on("endgame:completed", (data: EndgameCompletedEvent) => {
    defer(() => storyProgression.recordEvent({
      type: "endgame_completed", category: "milestone", actorId: data.userId, actorType: "player",
      summary: `A player has completed the endgame. Choice: ${data.choice}`,
      data: { userId: data.userId, choice: data.choice },
      impact: { discoveryWeight: 10, tension: 10 }, weight: 10,
    }), "Story ledger error on endgame:completed");
    defer(() => dynamicContent.processEvent("endgame:completed", data), "Dynamic content error on endgame:completed");
  });

  // Level up → dynamic content (home server log)
  // BOTH emitters, because they are separate EventEmitters.
  //
  // `missionService` and `hackService` each emit `player:levelup` with the same
  // shape, and this was registered on missionService only — so XP earned by
  // HACKING levelled you up in silence. missionService socket-emits and calls
  // notifyUser inline at its own emit site; hackService does neither, and has
  // no `io` to do it with. The asymmetry is why the hack path needs the socket
  // emit added here while the mission path must NOT get a second one.
  //
  // `serviceEvents.ts` has carried a comment warning that these are separate
  // emitters since the day the types were written. A comment is not a fix.
  const onLevelUp = (fromHack: boolean) => (data: PlayerLevelUpEvent) => {
    defer(() => dynamicContent.processEvent("player:levelup", data), "Dynamic content error on player:levelup");
    if (!fromHack) return;
    defer(async () => {
      io.to(`player:${data.userId}`).emit("player:levelup", {
        newLevel: data.newLevel,
        experience: data.experience,
        userId: data.userId,
      });
      const { notifyUser } = await import("./utils/notify");
      await notifyUser(io, data.userId, {
        type: "levelup",
        category: "game",
        title: "Level Up!",
        message: `You reached level ${data.newLevel}.`,
        priority: "high",
      });
    }, "Level-up notification error (hack path)");
  };
  missionService.on("player:levelup", onLevelUp(false));
  hackService.on("player:levelup", onLevelUp(true));

  // Tutorial mission completion is handled by the single `mission:completed`
  // registration above; `tutorialService` is resolved there.

  // Wire message hook: intercept replies to The Architect for training hints
  const msgSvc = getService<MessageService>(MESSAGE_SERVICE);
  msgSvc.onPrivateMessageSent((senderId, recipientId, content, subject) => {
    defer(() => tutorialService.handlePlayerReply(senderId, recipientId, content, subject), "Tutorial reply handler error");
  });

  logger.info("✅ Tutorial service initialized");
}

// ── Initialization ────────────────────────────────────────────────
async function initialize(): Promise<void> {
  // 1. Validate configuration
  validateConfig();
  logger.info("✅ Configuration validated");

  // 2. Connect to database
  await db.connect();
  logger.info("✅ Database connection established");

  // 3. Initialize DI Container (registers all services)
  initializeContainer(io, db.client, logger);
  logger.info("✅ DI Container initialized");

  // 4. Eager-initialize services that need startup work
  const ipService = getService<IPService>(IP_SERVICE);
  await ipService.loadAllocatedIPs();
  logger.info("✅ IP Service initialized");

  const progressService = getService<ProgressService>(PROGRESS_SERVICE);
  progressService.start();
  logger.info("✅ Progress Service started");

  const eventService = getService<EventService>(EVENT_SERVICE);
  await eventService.loadSubscriptionsFromDatabase();
  logger.info("✅ Event subscriptions loaded");

  // Shop catalog must exist as ShopItem rows before any purchase — InventoryItem
  // has a required FK to it. Idempotent upsert, so adding a catalog entry can
  // never again produce an item that lists but cannot be bought.
  const shopService = getService<ShopService>(SHOP_SERVICE);
  await shopService.syncCatalogToDatabase();
  logger.info("✅ Shop catalog synced");

  // Retire the old `seed_*` item universe. This has to run at BOOT, not only in
  // the seed: existing databases already hold those rows and will never be
  // reseeded. Must follow the sync, which creates the catalog rows it repoints
  // onto. Idempotent — a no-op once there is nothing left to move.
  await reconcileShopItems(db.client);

  // GameStateManager is resolved to trigger its constructor/cleanup timer
  getService<GameStateManager>(GAME_STATE_MANAGER);
  logger.info("✅ Game State Manager initialized");

  // 5. Wire AI integration: connect persona event listeners and start scheduler
  //
  // hackService / missionService / factionService used to be resolved here too
  // and are now resolved inside `wireServiceEvents`, which is their only
  // consumer. `personaService` stays because `setupEventListeners()` below
  // needs it; forumService is resolved purely for its constructor side effect.
  const personaService = getService<PersonaService>(PERSONA_SERVICE);
  void getService<ForumService>(FORUM_SERVICE); // side-effect initialization

  // 5b. Initialize Story Progression (The Architect's staging engine)
  const storyProgression = getService<StoryProgressionService>(
    STORY_PROGRESSION_SERVICE,
  );
  await storyProgression.initializeFirstEpoch();
  logger.info("✅ Story Progression initialized (Epoch 0)");

  // 5c. Initialize AI content review pipeline + epoch scheduler
  const { ContentDraftService } = await import("./services/contentDraftService");
  const { ReferenceValidationService } = await import("./services/referenceValidationService");
  const { EpochSchedulerService } = await import("./services/epochSchedulerService");

  const contentDraftService = getService<InstanceType<typeof ContentDraftService>>(CONTENT_DRAFT_SERVICE);
  const refValidation = getService<InstanceType<typeof ReferenceValidationService>>(REFERENCE_VALIDATION_SERVICE);
  const epochScheduler = getService<InstanceType<typeof EpochSchedulerService>>(EPOCH_SCHEDULER_SERVICE);

  // Late-bind services to avoid circular DI
  refValidation.setDraftService(contentDraftService);
  epochScheduler.setDraftService(contentDraftService);
  epochScheduler.start();
  logger.info("✅ Content Draft + Reference Validation + Epoch Scheduler initialized");

  wireServiceEvents(storyProgression);

  await personaService.setupEventListeners();
  logger.info("✅ Persona event listeners configured");

  const aiScheduler = getService<AISchedulerService>(AI_SCHEDULER_SERVICE);
  aiScheduler.startScheduler().catch((err) => {
    logger.error({ err }, "AI Scheduler failed to start");
  });
  logger.info("✅ AI Scheduler started");

  scheduleBackgroundJobs(storyProgression);

  await startQueuesAndMonitors();

  // 6. Setup Express middleware & routes
  setupMiddleware(app);
  logger.info("✅ Middleware configured");

  await setupRoutes(app);
  logger.info("✅ Routes configured");

  // 7. Setup Socket.IO handlers
  setupSocketHandlers(io);
  logger.info("✅ Socket.IO handlers configured");

  // 8. Setup error handling & graceful shutdown
  setupErrorHandling(app);
  registerShutdownHandlers(server, io);
  logger.info("✅ Error handling configured");

  logger.info("AIDA Server initialized successfully");
}

/**
 * The three periodic jobs owned by `index.ts` rather than by a service.
 *
 * ALL THREE ARE REGISTERED FOR SHUTDOWN (O9). Each callback touches the
 * database, and `gracefulShutdown` disconnects Prisma near the end of its
 * sequence — a timer still armed at that point throws from inside a callback
 * where nothing is left to catch it. The one that is easy to get wrong is the
 * Architect evaluation: it was the one that captured no handle at all.
 *
 * `storyProgression` is passed in rather than re-resolved because the caller
 * has already awaited `initializeFirstEpoch()` on that exact instance, and
 * taking it as a parameter makes that ordering dependency visible instead of
 * leaving it to luck.
 */
function scheduleBackgroundJobs(
  storyProgression: StoryProgressionService,
): void {
  // Resolve the Architect Intervention Executor
  const interventionExecutor = getService<ArchitectInterventionExecutor>(
    ARCHITECT_INTERVENTION_EXECUTOR,
  );

  // Periodic Architect evaluation — every 2 hours.
  // O9: registered so shutdown can stop it. This captured no handle at all,
  // and its callback touches the database, which `gracefulShutdown`
  // disconnects near the end of its sequence.
  registerShutdownTimer(setInterval(
    async () => {
      try {
        const evaluation = await storyProgression.evaluateAndAct();
        if (evaluation) {
          logger.info(`[Architect] Evaluated: ${evaluation.narrativeSummary}`);
          logger.info(
            `[Architect] Interventions: ${evaluation.interventions.length}`,
          );

          // Execute interventions — each one is independent, failures don't block others
          if (evaluation.interventions.length > 0) {
            const results = await interventionExecutor.executeBatch(
              evaluation.interventions,
            );
            const succeeded = results.filter((r) => r.success).length;
            const failed = results.length - succeeded;
            logger.info(
              `[Architect] Intervention execution complete: ${succeeded} succeeded, ${failed} failed`,
            );
          }
        }
      } catch (err) {
        logger.error({ err }, "[Architect] Evaluation error");
      }
    },
    ARCHITECT_EVAL_INTERVAL_MS,
  ));
  logger.info("✅ Architect periodic evaluation scheduled (every 2h)");

  // Initialize DarkNet Dungeon system — ensure at least one active dungeon
  const dungeonService = getService<DarkNetDungeonService>(
    DARKNET_DUNGEON_SERVICE,
  );
  // Fire-and-forget: dungeon generation involves multiple AI calls and
  // must not block server startup (which prevents server.listen())
  dungeonService.ensureActiveDungeon()
    .then(() => logger.info("✅ DarkNet Dungeon system initialized"))
    .catch((err) => logger.warn({ err }, "DarkNet Dungeon initialization failed (non-critical)"));

  // Periodic dungeon expiration check — every 1 hour. O9: see above.
  registerShutdownTimer(setInterval(
    async () => {
      try {
        await dungeonService.expireOldDungeons();
      } catch (err) {
        logger.error({ err }, "Dungeon expiration check failed");
      }
    },
    DUNGEON_EXPIRATION_INTERVAL_MS,
  ));
  logger.info("✅ DarkNet Dungeon expiration checker scheduled (every 1h)");

  // Notification retention. Read/dismissed rows older than the window, and
  // anything past its own expiry, are deleted; UNREAD rows are never touched
  // at any age. Registered for shutdown for the same reason as the sweeps
  // above — the callback touches the database, which gracefulShutdown
  // disconnects near the end of its sequence.
  registerShutdownTimer(setInterval(
    async () => {
      try {
        const { purgeOldNotifications } = await import("./utils/notify");
        await purgeOldNotifications();
      } catch (err) {
        logger.error({ err }, "Notification purge failed");
      }
    },
    NOTIFICATION_PURGE_INTERVAL_MS,
  ));
  logger.info("✅ Notification retention sweep scheduled (every 6h)");
}

// ── Start ─────────────────────────────────────────────────────────
async function start(): Promise<void> {
  await initialize();

  const ipService = getService<IPService>(IP_SERVICE);

  server.listen(config.PORT, config.HOST, () => {
    logger.info(
      {
        env: config.NODE_ENV,
        host: config.HOST,
        port: config.PORT,
        allocatedIPs: ipService.getAllocatedIPsCount(),
        autoSaveInterval: config.AUTO_SAVE_INTERVAL_SECONDS,
      },
      "AIDA Multiplayer Server started",
    );
  });
}

if (require.main === module) {
  start().catch((error) => {
    logger.fatal({ err: error }, "Failed to start server");
    process.exit(1);
  });
}

export { app, server, io };
export default { start, initialize };
