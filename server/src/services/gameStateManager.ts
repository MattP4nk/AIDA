import { Server as SocketIOServer } from "socket.io";
import { db } from "../database/client";
import {
  PlayerSession,
  ServerState,
  GameState,
  InventoryItem,
  PlayerInfo,
  ValidationResult,
  StateDelta,
  NotificationType,
  NotificationPriority,
  TerminalTab,
} from "../types/game";
import { SESSION_TIMEOUT_MS } from "../config/constants";
import {
  MAX_SESSIONS as MAX_SESSIONS_LIMIT,
  SESSION_IDLE_TIMEOUT_MIN,
  SESSION_LOCK_TTL_MS as SESSION_LOCK_TTL_MS_CFG,
  SESSION_CLEANUP_INTERVAL_MS,
} from "../config/gameBalance";

import { injectable, inject } from "tsyringe";
import { safeExecute } from "../utils/safeExecute";
import { Logger } from "pino";
import { COMMAND_PROCESSOR, EVENT_SERVICE, FACTION_SERVICE, FILE_SERVICE, LOGGER, MEMORY_SERVICE, MISSION_SERVICE, NETWORK_TOPOLOGY_SERVICE, PLAYER_MISSION_REPOSITORY, PLAYER_PRESENCE_SERVICE, PLAYER_PROGRESS_REPOSITORY, SERVER_SERVICE, SHOP_SERVICE, SOCKET_IO } from "../di/tokens";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";
import type { PlayerMissionRepository } from "../repositories/playerMissionRepository";
import { getService } from "../di/resolve";
import type EventService from "./eventService";
import type CommandProcessor from "./commandProcessor";
import type ShopService from "./shopService";
import type MissionService from "./missionService";
import type { FactionService } from "./factionService";

import type FileService from "./fileService";
import type { NetworkTopologyService } from "./networkTopologyService";
/**
 * Shop events cluster: one `useItem` emits two, a purchase emits two. Waiting
 * a beat collapses them into a single pair of queries.
 */
const SLICE_REFRESH_DEBOUNCE_MS = 50;

/**
 * The slices a producer can ask to have re-read and pushed.
 *
 * A one-member union with one legal value was flagged as speculative
 * generality in review; it is a real union now that missions and credits use
 * the same path, and the debounce coalesces a burst into ONE pass per player.
 */
type StateSlice = "inventory" | "credits" | "missions";

/**
 * The ONE definition of the `missions` slice's wire shape.
 *
 * Same reasoning as `toStateInventory` below: the moment a delta and the full
 * state each build their own version of a path, the store's shape flips
 * mid-session and `applyStateDelta` reports it as applied either way.
 */
function toStateMissions(rows: any[]): any[] {
  return rows.map((m) => ({
    id: m.missionId,
    title: m.title || "Unknown Mission",
    description: m.description || "Loading...",
    type: m.type || "hack",
    status: m.status,
    difficulty: m.difficulty || 1,
    objectives: (m.objectives ?? []).map((o: any) => ({
      ...o,
      progress: typeof o.current === "number" ? o.current : 0,
      required: typeof o.target === "number" ? o.target : 1,
      target: o.target?.toString(),
    })),
    reward: m.reward || { credits: 0, experience: 0 },
    timeLimit: m.timeLimit,
    ...(m.expiresAt ? { expiresAt: m.expiresAt } : {}),
  }));
}

/**
 * The ONE definition of the `inventory` slice's wire shape.
 *
 * Extracted 2026-09-25 because there were two. `getGameState` mapped the rows
 * to `{id, name, type, description, quantity, metadata}` for `state:update`
 * while the delta path pushed `getPlayerInventory`'s raw
 * `{itemId, item, quantity, acquiredAt}` at the same path — so the store's
 * shape flipped the first time a player bought anything, `.name` became
 * `undefined`, and nothing noticed because `applyStateDelta` reports an opaque
 * top-level `set` as applied either way.
 *
 * Two producers for one path is the bug; one function is the fix.
 */
function toStateInventory(
  rows: Array<{
    itemId: string;
    quantity: number;
    item: { name: string; category: string; description: string; effects?: unknown };
  }>,
): InventoryItem[] {
  return rows.map((row) => ({
    id: row.itemId,
    name: row.item.name,
    type: row.item.category,
    description: row.item.description,
    quantity: row.quantity,
    metadata: row.item.effects,
  }));
}

@injectable()
class GameStateManager {
  private playerSessions: Map<string, PlayerSession>;
  private activeConnections: Map<string, string>; // socketId -> userId
  private serverStates: Map<string, ServerState>;
  private io: SocketIOServer;
  private eventService: EventService;
  private _commandProcessor: CommandProcessor | null = null;
  private shopService: ShopService;
  private missionService: MissionService;
  private factionService: FactionService;
  private cleanupTimer: NodeJS.Timeout | null = null;
  /** Per-player debounce for state-slice refreshes, and what each owes. */
  private sliceRefreshTimers = new Map<string, NodeJS.Timeout>();
  private pendingSlices = new Map<string, Set<StateSlice>>();
  /** Players with a refresh running, so two can never overlap. */
  private sliceRefreshInFlight = new Set<string>();
  /** Exactly what this class subscribed to, so `stop()` can undo just that. */
  private bridgeSubscriptions: Array<{
    emitter: { off: (e: string, h: (...a: any[]) => void) => unknown };
    event: string;
    handler: (...args: any[]) => void;
  }> = [];
  private readonly CLEANUP_INTERVAL_MS = SESSION_CLEANUP_INTERVAL_MS;
  private readonly MAX_SESSIONS = MAX_SESSIONS_LIMIT;
  private readonly SESSION_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MIN * 60 * 1000;
  private readonly SESSION_LOCK_TTL_MS = SESSION_LOCK_TTL_MS_CFG;
  /** userId -> the session creation currently running for them. */
  private sessionCreations = new Map<string, { startedAt: number; promise: Promise<PlayerSession> }>();
  private connectionLocks = new Map<string, number>(); // userId -> lock timestamp (prevents concurrent connectPlayerToServer)

  private get commandProcessor(): CommandProcessor {
    if (!this._commandProcessor) {
      this._commandProcessor = getService<CommandProcessor>(COMMAND_PROCESSOR);
    }
    return this._commandProcessor;
  }

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) io: SocketIOServer,
    @inject(EVENT_SERVICE) eventService: EventService,
    @inject(SHOP_SERVICE) shopService: ShopService,
    @inject(MISSION_SERVICE) missionService: MissionService,
    @inject(FACTION_SERVICE) factionService: FactionService,
    @inject(PLAYER_PROGRESS_REPOSITORY)
    private progressRepo: PlayerProgressRepository,
    @inject(PLAYER_MISSION_REPOSITORY)
    private missionRepo: PlayerMissionRepository,
  ) {
    this.io = io;
    this.eventService = eventService;
    this.shopService = shopService;
    this.missionService = missionService;
    this.factionService = factionService;
    this.playerSessions = new Map();
    this.activeConnections = new Map();
    this.serverStates = new Map();

    // Start automatic cleanup timer
    this.startCleanupTimer();

    this.bridgeStateDeltas();
  }

  /**
   * Turn in-process state changes into `state:delta` pushes.
   *
   * ORPHAN AUDIT 2026-09-25. Two dead things meet here:
   *
   *   - `broadcastStateDelta` had ZERO callers, so the delta channel existed
   *     and nothing ever used it, and `state:update` fired only once per
   *     login. A client reading the pushed state would have seen credits
   *     frozen at the moment it authenticated.
   *   - `shopService extends EventEmitter` and emits five events —
   *     `item:added`, `item:removed`, `purchase:complete`, `item:sold`,
   *     `item:used` — with **no subscribers anywhere**. The emit calls were
   *     already at the right places; they just went nowhere.
   *
   * This is the subscriber. It lives in gameStateManager because that is the
   * class that owns both `io` and the notion of a player's state — the
   * repository is deliberately I/O-free and shopService has no `io` at all.
   */
  private bridgeStateDeltas(): void {
    // ── Credits, experience, level, skills ──────────────────────────
    //
    // Via the repository rather than its ~23 call sites: it is the single
    // sanctioned writer of player_progress, so one subscription covers hack
    // rewards, mission payouts, trace penalties and command grants alike.
    //
    // KNOWN GAP, stated rather than hidden: nine sites still write
    // player_progress directly (CLAUDE.md lists them) and produce no delta.
    // Four are row CREATION, which has no delta to send. The two that matter
    // are the admin progress editor and restoreBackup — both write absolute
    // values, and a client watching either will be stale until its next
    // `state:update`.
    {
      this.subscribe(this.progressRepo, "progress:changed", (change: { userId: string; credits?: number; experience?: number; level?: number; skill?: { name: string; value: number } }) => {
        if (!change?.userId) return;
        if (typeof change.credits === "number") {
          void this.broadcastStateDelta(change.userId, "player.credits", change.credits);
        }
        if (typeof change.experience === "number") {
          void this.broadcastStateDelta(change.userId, "player.experience", change.experience);
        }
        if (typeof change.level === "number") {
          void this.broadcastStateDelta(change.userId, "player.level", change.level);
        }
        if (change.skill) {
          void this.broadcastStateDelta(
            change.userId,
            `player.skills.${change.skill.name}`,
            change.skill.value,
          );
        }
      });
    }

    // ── Inventory ───────────────────────────────────────────────────
    //
    // The five shop events carry {userId, itemId, quantity} — enough to know
    // something changed, not enough to rebuild the row the client holds, so
    // the affected slices are re-read and pushed whole.
    //
    // CREDITS ARE REFRESHED HERE, and that is not incidental. Both money paths
    // run inside a transaction — `spendCredits` in `purchaseItem` and
    // `addCredits` in `sellItem`, both passing `tx` — and `announce`
    // suppresses itself under `tx` because a read through an open transaction
    // sees uncommitted state. So the repository CANNOT be the source of a
    // purchase's credit delta; this post-commit event is. The first version of
    // this bridge refreshed only `inventory`, which meant a purchase changed
    // the item list and never the balance, while ShopDialog had just dropped
    // its own re-poll on the strength of a comment saying otherwise.
    for (const evt of ["item:added", "item:removed", "purchase:complete", "item:sold", "item:used"]) {
      this.subscribe(this.shopService, evt, (payload: { userId?: string }) => {
        if (payload?.userId) this.scheduleSliceRefresh(payload.userId, "inventory", "credits");
      });
    }

    // ── Missions ────────────────────────────────────────────────────
    //
    // `PlayerMissionRepository` is the documented sole owner of mission state
    // and holds zero direct `prisma.playerMission*` access outside itself, so
    // one subscription covers accept, abandon, objective progress, completion
    // and expiry across missionService, tutorialService, storyMissionService
    // and missionGenerator alike.
    //
    // Until this, `missions` only ever arrived in the login snapshot while the
    // client already exported a `playerMissions` derived store — the same trap
    // ShopDialog fell into with credits.
    this.subscribe(this.missionRepo, "missions:changed", (payload: { userId?: string }) => {
      if (payload?.userId) this.scheduleSliceRefresh(payload.userId, "missions");
    });
  }

  /**
   * Coalesce shop refreshes per player.
   *
   * One logical action fires more than one event — `useItem` emits
   * `item:removed` AND `item:used`, and a purchase emits `purchase:complete`
   * plus `item:added` — so an un-debounced listener issues the same queries
   * two or three times and pushes the same arrays down the socket again. A
   * mission granting K items would do it K times.
   */
  public scheduleSliceRefresh(userId: string, ...slices: StateSlice[]): void {
    const pending = this.pendingSlices.get(userId) ?? new Set<StateSlice>();
    for (const slice of slices) pending.add(slice);
    this.pendingSlices.set(userId, pending);

    if (this.sliceRefreshTimers.has(userId)) return;
    const timer = setTimeout(() => {
      this.sliceRefreshTimers.delete(userId);
      void this.flushSlices(userId);
    }, SLICE_REFRESH_DEBOUNCE_MS);
    (timer as NodeJS.Timeout & { unref?: () => void }).unref?.();
    this.sliceRefreshTimers.set(userId, timer);
  }

  /**
   * Subscribe, remembering the exact handler so teardown can be scoped.
   *
   * These are DI singletons this class does not own, so `stop()` must not
   * reach for `removeAllListeners` — that would take every subscriber for the
   * event name, not just this bridge's.
   */
  private subscribe(
    emitter: { on: (e: string, h: (...a: any[]) => void) => unknown },
    event: string,
    handler: (...args: any[]) => void,
  ): void {
    emitter.on(event, handler);
    this.bridgeSubscriptions.push({ emitter: emitter as never, event, handler });
  }

  /**
   * Run a player's pending refreshes ONE AT A TIME.
   *
   * Overlapping flushes are a correctness problem, not just waste: both push
   * whole-slice `set` deltas with no sequence number and `applyStateDelta` is
   * last-write-wins, so a slow flush that started first can land last and
   * leave the client stale with `applied` true, so nothing requests a resync.
   *
   * Serialising per player is enough — Socket.IO preserves order within a
   * connection, so emitting in order means receiving in order.
   */
  private async flushSlices(userId: string): Promise<void> {
    if (this.sliceRefreshInFlight.has(userId)) return;
    this.sliceRefreshInFlight.add(userId);
    let failed = false;
    try {
      // Drain: anything scheduled WHILE a flush runs is picked up by the next
      // turn of this loop rather than by a competing flush.
      for (;;) {
        const due = this.pendingSlices.get(userId);
        if (!due || due.size === 0) break;
        this.pendingSlices.delete(userId);
        if (await this.refreshStateSlices(userId, due)) continue;

        // Put the work back. `refreshStateSlices` swallows its own errors, so
        // without this a single transient query failure drops the slice for
        // good and the client stays stale until a reconnect.
        const back = this.pendingSlices.get(userId) ?? new Set<StateSlice>();
        for (const slice of due) back.add(slice);
        this.pendingSlices.set(userId, back);
        failed = true;
        break;
      }
    } finally {
      this.sliceRefreshInFlight.delete(userId);
      // Closes the gap between the loop's last check and releasing the lock:
      // work scheduled in that window would otherwise sit until the next
      // unrelated event. Skipped after a failure — re-arming on the debounce
      // would retry every SLICE_REFRESH_DEBOUNCE_MS against a down database.
      // The restored slices ride along with the next event instead.
      if (!failed && (this.pendingSlices.get(userId)?.size ?? 0) > 0) {
        this.scheduleSliceRefresh(userId);
      }
    }
  }

  /**
   * Re-read the slices a shop action can change and push them as deltas.
   *
   * The cheap middle ground between a delta the emitter cannot construct and a
   * full `state:update`, which runs five parallel queries.
   *
   * The inventory rows are mapped to the SAME shape `getGameState` builds for
   * this path. Pushing `getPlayerInventory`'s raw rows — which is what the
   * first version did — replaced `{id, name, …}` with `{itemId, item, …}`
   * mid-session, and `applyStateDelta` reports a top-level `set` as applied
   * either way, so nothing detected it and no resync corrected it.
   */
  /** @returns false if the refresh failed, so the caller can re-queue it. */
  public async refreshStateSlices(userId: string, slices: Set<StateSlice>): Promise<boolean> {
    return await safeExecute({
      fallback: false as const,
      fn: async () => {
        if (!this.playerSessions.has(userId) || slices.size === 0) return true;

        if (slices.has("inventory")) {
          const items = await this.shopService.getPlayerInventory(userId);
          await this.broadcastStateDelta(userId, "inventory", toStateInventory(items));
        }
        if (slices.has("credits")) {
          const progress = await db.client.playerProgress.findUnique({
            where: { userId },
            select: { credits: true },
          });
          if (progress) {
            await this.broadcastStateDelta(userId, "player.credits", progress.credits);
          }
        }
        if (slices.has("missions")) {
          const missions = await this.missionService.getPlayerMissions(userId);
          await this.broadcastStateDelta(userId, "missions", toStateMissions(missions));
        }
        return true;
      },
      context: "Refresh state slices",
      logger: this.logger,
    })();
  }

  // ==================== PUBLIC ACCESSORS ====================

  public getPlayerSession(userId: string): PlayerSession | undefined {
    return this.playerSessions.get(userId);
  }

  public getAllActiveSessions(): PlayerSession[] {
    return Array.from(this.playerSessions.values());
  }

  // ==================== SESSION MANAGEMENT ====================

  public async createSession(
    userId: string,
    socketId: string,
    ipAddress: string,
  ): Promise<PlayerSession> {
    // Per-user lock: one session creation at a time — and a concurrent caller
    // JOINS it instead of being refused.
    //
    // This threw "Session creation already in progress" at the second caller,
    // and a page load always has two: SocketService authenticates on every
    // `connect`, and App.svelte sends its own `authenticate:request` — 2ms
    // apart, both landing in handleAuthentication. Whichever lost was told
    // authentication FAILED for a user who was in fact authenticating, and
    // App.svelte's terminal init then timed out on an empty tab list. Two tabs
    // opened together race the same way. Joining hands every concurrent
    // caller the one session being built, which is what all of them wanted.
    const inflight = this.sessionCreations.get(userId);
    if (inflight) {
      const lockAge = Date.now() - inflight.startedAt;
      if (lockAge < this.SESSION_LOCK_TTL_MS) return inflight.promise;
      // Lock expired — stale lock from a crashed operation, proceed
      this.logger.warn(
        { userId, lockAgeMs: lockAge },
        "Expired stale session lock",
      );
    }

    const entry = { startedAt: Date.now(), promise: this.createSessionUnlocked(userId, socketId, ipAddress) };
    this.sessionCreations.set(userId, entry);
    try {
      return await entry.promise;
    } finally {
      // Only clear OUR entry: a stale lock may already have been replaced.
      if (this.sessionCreations.get(userId) === entry) this.sessionCreations.delete(userId);
    }
  }

  private async createSessionUnlocked(
    userId: string,
    socketId: string,
    ipAddress: string,
  ): Promise<PlayerSession> {
    try {
      // Check if session already exists
      const existingSession = this.playerSessions.get(userId);
      if (existingSession) {
        this.logger.info({ userId }, "Session already exists, updating");
        await this.destroySession(userId);
      }

      // Get or create user's home server
      const user = await db.client.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error(`User ${userId} not found`);
      }

      // Use player's home server ID from database (set during registration)
      let homeServerId = user.homeServerId;
      if (!homeServerId) {
        // Backfill: find the home server by owner
        const homeServer = await db.client.gameServer.findFirst({
          where: { ownerId: userId, isPlayerHome: true },
          select: { id: true },
        });
        if (homeServer) {
          homeServerId = homeServer.id;
          await db.client.user.update({
            where: { id: userId },
            data: { homeServerId: homeServer.id },
          });
        } else {
          throw new Error(`No home server found for user ${userId}`);
        }
      }

      // Try to load last session directory
      const lastSession = await db.client.userSession.findFirst({
        where: {
          userId,
          isActive: false, // Get the last inactive session
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Create default terminal tab (home terminal)
      const defaultTerminal: TerminalTab = {
        id: `term_${Date.now()}_0`,
        label: `${user.username}@${user.homeIp}`,
        serverId: homeServerId,
        currentDirectory: this.getValidHomeDirectory(
          lastSession?.currentDirectory,
          user.username,
        ),
        commandHistory: [],
        createdAt: new Date(),
        lastActivity: new Date(),
        isProcessing: false,
      };

      const session: PlayerSession = {
        userId,
        socketId,
        connectedAt: new Date(),
        lastActivity: new Date(),
        isActive: true,
        ipAddress,
        homeServerId,
        currentDirectory: defaultTerminal.currentDirectory, // For backwards compatibility
        commandQueue: [],
        terminals: [defaultTerminal],
        activeTerminalId: defaultTerminal.id,
      };

      // Initialize home file system if it doesn't exist
      await this.initializeHomeFileSystem(homeServerId, userId);

      // Ensure home server is linked to Internet Exchange (fallback if registration missed it)
      await safeExecute({
        fn: async () => {
          const { getService } = await import("../di/container");
          const topoService = getService<NetworkTopologyService>(NETWORK_TOPOLOGY_SERVICE);
          await topoService.createHomeLink(homeServerId);
        },
        context: "Create home link to Internet Exchange",
        logger: this.logger,
        silent: true,
      })();

      this.playerSessions.set(userId, session);
      this.activeConnections.set(socketId, userId);

      // Update database
      await db.client.user.update({
        where: { id: userId },
        data: {
          isOnline: true,
          lastLogin: new Date(),
        },
      });

      // Check if we've exceeded max sessions and cleanup if needed
      if (this.playerSessions.size > this.MAX_SESSIONS) {
        await this.cleanupIdleSessions();
      }

      return session;
    } catch (error) {
      this.logger.error({ err: error, userId }, "Error creating session");
      throw error;
    }
  }

  public async destroySession(userId: string): Promise<void> {
    try {
      const session = this.playerSessions.get(userId);
      if (!session) {
        this.logger.info({ userId }, "No session found for user");
        return;
      }

      // Release the drains this session owns. Only an explicit `disconnect`
      // released the connection drain, so closing the tab leaked it. Backdoors
      // are left alone — they outlive the session and nothing re-registers
      // them at login.
      try {
        const { getService } = await import("../di/container");
        const memory = getService<import("./memoryService").default>(MEMORY_SERVICE);
        memory.releaseSessionConsumersFor(userId);
      } catch (err) {
        this.logger.warn({ err, userId }, "Could not release passive drains");
      }

      // Drop any pending slice refresh; the socket is going away.
      const pendingTimer = this.sliceRefreshTimers.get(userId);
      if (pendingTimer) clearTimeout(pendingTimer);
      this.sliceRefreshTimers.delete(userId);
      this.pendingSlices.delete(userId);

      // Disconnect from any connected servers
      if (session.currentServerId) {
        await this.disconnectPlayerFromServer(userId);
      }

      // Remove from maps
      this.activeConnections.delete(session.socketId);
      this.playerSessions.delete(userId);

      // Clear command history to prevent memory leaks
      this.commandProcessor.clearHistory(userId);

      // Update database
      await db.client.user.update({
        where: { id: userId },
        data: { isOnline: false },
      });

    } catch (error) {
      this.logger.error({ err: error, userId }, "Error destroying session");
      throw error;
    }
  }

  public getSession(userId: string): PlayerSession | undefined {
    return this.playerSessions.get(userId);
  }

  public getUserBySocket(socketId: string): string | undefined {
    return this.activeConnections.get(socketId);
  }

  /**
   * R6 — bind a newly authenticated socket to the user's existing session.
   *
   * `handleAuthentication` only ever called `createSession`, and only when no
   * session existed. Every other authenticating socket was left unbound:
   * `session.socketId` still named the socket that created the session,
   * `activeConnections` never learned the new id, and nothing rejoined the
   * `server:<id>` room. That was survivable while a session died with its
   * socket — but Phase 4 deliberately keeps the session alive while the user
   * has other sockets, so `session.socketId` can now name a CLOSED socket
   * while the player is still playing.
   *
   * Returns the session so the caller can rejoin rooms from it.
   */
  public attachSocket(
    userId: string,
    socketId: string,
  ): PlayerSession | undefined {
    const session = this.playerSessions.get(userId);
    if (!session) return undefined;

    if (session.socketId !== socketId) {
      this.activeConnections.delete(session.socketId);
      session.socketId = socketId;
    }
    this.activeConnections.set(socketId, userId);
    session.lastActivity = new Date();
    return session;
  }

  /**
   * R6 — unbind a closing socket.
   *
   * `destroySession` deletes `activeConnections[session.socketId]`, which is
   * the wrong key whenever the socket that closed is not the bound one, so
   * the map leaked an entry per extra socket. When the bound socket is the
   * one closing and the user still has others, the binding is moved to a
   * survivor rather than left dangling.
   */
  public detachSocket(
    userId: string,
    socketId: string,
    survivingSocketId?: string,
  ): void {
    this.activeConnections.delete(socketId);

    const session = this.playerSessions.get(userId);
    if (!session || session.socketId !== socketId) return;

    if (survivingSocketId) {
      session.socketId = survivingSocketId;
      this.activeConnections.set(survivingSocketId, userId);
    }
  }

  public updateLastActivity(userId: string): void {
    const session = this.playerSessions.get(userId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  public getActivePlayers(): string[] {
    return Array.from(this.playerSessions.keys());
  }

  public getPlayerCount(): number {
    return this.playerSessions.size;
  }

  public isPlayerOnline(userId: string): boolean {
    return this.playerSessions.has(userId);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Validate and fix home directory path
   * Ensures old /home/user paths are corrected to /home/{username}
   */
  private getValidHomeDirectory(
    lastDirectory: string | null | undefined,
    _username: string,
  ): string {
    // Start at root — simplest, most reliable, works on all servers
    if (!lastDirectory) {
      return "/";
    }

    // If last directory is the old hardcoded /home/user, fix to root
    if (lastDirectory === "/home/user") {
      return "/";
    }

    // If directory starts with /, keep it. Otherwise default to root.
    return lastDirectory.startsWith("/") ? lastDirectory : "/";
  }

  // ==================== GAME STATE QUERIES ====================
  // ==================== STATE SYNCHRONIZATION ====================

  public async getGameState(userId: string): Promise<GameState | null> {
    return await safeExecute({
      fn: async () => {
        const user = await db.client.user.findUnique({
          where: { id: userId },
          include: {
            progress: true,
          },
        });

        if (!user || !user.progress) {
          this.logger.info({ userId }, "User or progress not found");
          return null;
        }

        const session = this.playerSessions.get(userId);

        // Batch parallel queries — reputation, inventory, missions, events, server info
        const [reputationMap, inventoryItems, playerMissions, userEvents, currentServer] =
          await Promise.all([
            this.factionService.getReputationMap(userId),
            this.shopService.getPlayerInventory(userId),
            this.missionService.getPlayerMissions(userId),
            this.eventService.getUserEvents(userId, 10),
            session?.currentServerId
              ? this.getServerInfo(session.currentServerId, userId)
              : Promise.resolve(undefined),
          ]);

        // Build player info
        const playerInfo: PlayerInfo = {
          id: user.id,
          username: user.username,
          ip: user.homeIp,
          level: user.progress.level,
          experience: user.progress.experience,
          credits: user.progress.credits,
          skills: {
            hacking: user.progress.hacking,
            networking: user.progress.networking,
            cryptography: user.progress.cryptography,
            stealth: user.progress.stealth,
            socialEng: user.progress.socialEng,
            forensics: user.progress.forensics,
          },
          reputation: reputationMap,
        };

        const gameState: GameState = {
          player: playerInfo,
          currentServer,
          inventory: toStateInventory(inventoryItems),
          missions: toStateMissions(playerMissions),
          notifications: userEvents.map((e) => ({
            id: e.id,
            type: e.type as unknown as NotificationType,
            title: e.title,
            message: e.description,
            timestamp: e.timestamp,
            read: false,
            priority:
              e.severity === "critical"
                ? NotificationPriority.CRITICAL
                : NotificationPriority.NORMAL,
            data: e.metadata,
          })),
          stats: {
            totalPlayTime: 0,
            commandsExecuted: user.progress?.commandsExecuted ?? 0,
            successfulHacks: user.progress?.successfulHacks ?? 0,
            failedHacks: user.progress?.failedHacks ?? 0,
            missionsCompleted: user.progress?.missionsCompleted ?? 0,
            serversDiscovered: user.progress?.serversDiscovered ?? 0,
            filesAccessed: user.progress?.filesAccessed ?? 0,
            messagesSent: user.progress?.messagesSent ?? 0,
          },
        };

        return gameState;
      },
      context: "Get game state",
      logger: this.logger,
      fallback: null as GameState | null,
    })() as unknown as Promise<GameState | null>;
  }

  public async broadcastStateUpdate(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        const session = this.playerSessions.get(userId);
        if (!session) {
          this.logger.info({ userId }, "No session found for user");
          return;
        }

        const state = await this.getGameState(userId);
        if (!state) {
          this.logger.info({ userId }, "Could not get game state for user");
          return;
        }

        this.io.to(`user:${userId}`).emit("state:update", {
          fullState: state,
          timestamp: new Date(),
        });

        this.logger.info({ userId }, "Broadcast full state update to user");
      },
      context: "Broadcast state update",
      logger: this.logger,
    })();
  }

  public async broadcastStateDelta(
    userId: string,
    path: string,
    value: any,
    // `operation` was hardcoded to "set", which left `push`, `remove` and
    // `update` implemented in the shared applier, declared in the wire
    // contract, and unreachable from any producer — CLAUDE.md bug shape #4.
    // It is a parameter so the applier's other branches have a way in; `set`
    // stays the default because most callers replace a whole value.
    operation: StateDelta["operation"] = "set",
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const session = this.playerSessions.get(userId);
        if (!session) return;

        const delta: StateDelta = { path, value, operation };

        this.io.to(`user:${userId}`).emit("state:delta", {
          delta,
          timestamp: new Date(),
        });

        this.logger.debug({ userId, path, operation }, "Broadcast state delta to user");
      },
      context: "Broadcast state delta",
      logger: this.logger,
    })();
  }

  // ==================== SERVER STATE MANAGEMENT ====================

  /**
   * S1 — the single authorization point for "may this player be on this server".
   *
   * Combines the two checks the command path already did separately:
   *   - `serverService.canAccessServer` — level vs encryption, owner bypass
   *   - `networkTopologyService.checkServerAccess` — accessMethod
   *     (open / hackable / keycard / hack_or_key)
   *
   * Resolved through the container rather than injected because
   * `gameStateManager` is constructed before both services exist. A resolution
   * failure FAILS CLOSED: if we cannot evaluate the policy we do not grant
   * access, which is the opposite of what the old `default:` arm in
   * `checkServerAccess` did (see S11).
   */
  private async authorizeServerAccess(
    userId: string,
    serverId: string,
  ): Promise<{ allowed: boolean; reason: string }> {
    try {
      const { getService } = await import("../di/container");

      const serverService =
        getService<import("./serverService").default>(SERVER_SERVICE);
      const access = await serverService.canAccessServer(userId, serverId);
      if (!access.canAccess) {
        return { allowed: false, reason: access.reason };
      }

      const topology = getService<
        import("./networkTopologyService").NetworkTopologyService
      >(NETWORK_TOPOLOGY_SERVICE);
      const method = await topology.checkServerAccess(userId, serverId);
      if (!method.allowed) {
        return { allowed: false, reason: method.reason };
      }

      return { allowed: true, reason: access.reason };
    } catch (err) {
      this.logger.error(
        { err, userId, serverId },
        "Server authorization check failed — refusing connection",
      );
      return { allowed: false, reason: "Authorization unavailable." };
    }
  }

  public async connectPlayerToServer(
    userId: string,
    serverId: string,
  ): Promise<boolean> {
    // Per-user lock to prevent concurrent connection changes (mirrors the sessionCreations lock in createSession)
    const lockTime = this.connectionLocks.get(userId);
    if (lockTime !== undefined && Date.now() - lockTime < this.SESSION_LOCK_TTL_MS) {
      this.logger.warn({ userId }, "Connection change already in progress");
      return false;
    }
    this.connectionLocks.set(userId, Date.now());

    try {
    return await safeExecute({
      fn: async () => {
        const session = this.playerSessions.get(userId);
        if (!session) {
          this.logger.info({ userId }, "No session found for user");
          return false;
        }

        // ── S1: authorization lives HERE, so every caller inherits it ──────
        //
        // The socket handler (`sockets/handlers.ts` server:connect) called this
        // with a client-supplied `serverId` and NO authorization at all — no
        // access check, no adjacency, no challenge. Emitting one event put a
        // player on any server in the game.
        //
        // It is not enough to guard that handler: the `connect` command path
        // authorises correctly today, so a per-handler fix leaves two policies
        // that can drift, and the next entry point starts unguarded again.
        // Putting the check in the one function both paths funnel through means
        // a new caller cannot forget it.
        //
        // Both predicates are pure and idempotent, so the command path
        // re-running them costs one query and changes nothing.
        //
        // NOTE what is deliberately NOT here: adjacency (`canTraverse`) and the
        // first-visit challenge. Those are rules about HOW you travelled, and
        // `connect home` legitimately bypasses adjacency — they stay in
        // `networkCommands`. This gate answers the security question, "may this
        // player be on this server at all".
        const authorized = await this.authorizeServerAccess(userId, serverId);
        if (!authorized.allowed) {
          this.logger.warn(
            { userId, serverId, reason: authorized.reason },
            "Refused server connection — authorization failed",
          );
          return false;
        }

        // Only now tear down the previous connection. This used to run BEFORE
        // the gate, so a refused `server:connect` still evicted the player
        // from the server they were legitimately on — leaving them nowhere,
        // from an event any client can emit with any id.
        if (session.currentServerId) {
          await this.disconnectPlayerFromServer(userId);
        }

        // Verify server exists
        const server = await db.client.gameServer.findUnique({
          where: { id: serverId },
        });

        if (!server) {
          this.logger.info({ serverId }, "Server not found");
          return false;
        }

        // Ensure the target server has a file system (lazy init for game servers)
        const hasFileSystem = await db.client.fileSystemNode.findFirst({
          where: { serverId, parentId: null, type: "directory" },
        });
      if (!hasFileSystem) {
        await safeExecute({
          fn: async () => {
            const { getService } = await import("../di/container");
            const fileService = getService<FileService>(FILE_SERVICE);
            await fileService.initializeFileSystem(
              serverId,
              server.ownerId || userId,
            );
            this.logger.info(
              { serverId, serverName: server.name },
              "Initialized file system for game server on first connect",
            );
          },
          context: "Initialize server file system on connect",
          logger: this.logger,
        })();
      }

      // Content provisioning handled by ContentQueueService.ensureReady()
      // in the connect flow (networkCommands.ts) — no fire-and-forget needed here.

      // Update session
      session.currentServerId = serverId;

      // Reset working directory to root of the new server
      session.currentDirectory = "/";

      // Update the active terminal to point at the new server
      const activeTerminal = session.terminals.find(
        (t) => t.id === session.activeTerminalId,
      );
      if (activeTerminal) {
        activeTerminal.serverId = serverId;
        activeTerminal.currentDirectory = "/";
      }

      // Update or create server state
      let serverState = this.serverStates.get(serverId);
      if (!serverState) {
        serverState = {
          serverId,
          connectedPlayers: [],
          isOnline: true,
          lastUpdate: new Date(),
          activeConnections: 0,
        };
        this.serverStates.set(serverId, serverState);
      }

      serverState.connectedPlayers.push(userId);
      serverState.activeConnections = serverState.connectedPlayers.length;
      serverState.lastUpdate = new Date();

      // R6: join the server room with ALL of the user's sockets, not the one
      // `session.socketId` happens to name.
      //
      // `session.socketId` is written once at session creation and never
      // rebound, so it goes stale the moment a player reconnects or opens a
      // second tab — and `io.sockets.sockets.get(<dead id>)` is `undefined`,
      // which this code silently treated as "nothing to do". The player then
      // sat on a server receiving none of its room broadcasts.
      // `socketsJoin` over the user room is indifferent to which socket is
      // "the" socket, which is the property we actually want now that
      // MAX_SOCKETS_PER_USER permits four.
      await this.io.in(`user:${userId}`).socketsJoin(`server:${serverId}`);

      // PRESENCE TRACKING RUNS HERE, on the live path.
      //
      // `playerPresenceService.playerJoinedServer` was called from exactly one
      // place — the `server:connect` SOCKET handler — and no client has ever
      // emitted `server:connect`: `emitServerConnect` had zero callers and
      // connecting is `connect <ip>` through the command path, which lands
      // here. So `playersByServer` was never populated for a real connection,
      // and `who` has always answered "No other players on this server."
      //
      // That is also why the four `presence:*` events looked orphaned in the
      // socket-contract audit: they could not fire, because the map they
      // iterate was always empty. Fixing the tracking is what makes them real.
      try {
        const { getService } = await import("../di/container");
        const presence =
          getService<import("./playerPresenceService").default>(PLAYER_PRESENCE_SERVICE);
        await presence.playerJoinedServer(userId, serverId);
      } catch (err) {
        this.logger.warn({ err, userId, serverId }, "Could not record server presence");
      }

      // Broadcast to others on server. ENRICHED with the username because the
      // bare `{userId, serverId}` payload is unusable for display — the client
      // listener wrote it to a store no component read, which is how it stayed
      // bare. `playerPresenceService` emitted a rich twin
      // (`presence:player_joined_server`) in a per-socket loop; that is deleted
      // in favour of this one, because a room emit reaches ALL of a player's
      // tabs and the loop only reached `p.socketId`.
      const joiner = await db.client.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });
      this.io.to(`server:${serverId}`).emit("server:user_connected", {
        userId,
        username: joiner?.username ?? "unknown",
        serverId,
        timestamp: new Date(),
      });

      // D10: derive from the connection ROWS, not from `serverState`.
      // `serverStates` is an in-memory Map rebuilt from scratch on every boot,
      // so writing `activeConnections` here published a count that had
      // forgotten everyone connected before the last restart — and it ran
      // AFTER serverService's increment, so it silently overwrote it.
      await this.syncServerConnectionCount(serverId);

        // Passive resource drain. `registerConnection` had ZERO callers, so
        // holding connections open cost the player nothing and the whole
        // passive-drain economy (PASSIVE_COSTS, addPassiveConsumer, the
        // resource ticker) ran against an always-empty consumer set.
        try {
          const { getService } = await import("../di/container");
          const memory = getService<import("./memoryService").default>(MEMORY_SERVICE);
          const srv = await db.client.gameServer.findUnique({
            where: { id: serverId },
            select: { name: true },
          });
          memory.registerConnection(userId, serverId, srv?.name ?? serverId);
        } catch (err) {
          this.logger.warn({ err, userId, serverId }, "Could not register connection drain");
        }

        this.logger.info({ userId, serverId }, "User connected to server");

        return true;
      },
      context: "Connect player to server",
      logger: this.logger,
      fallback: false,
    })() as unknown as Promise<boolean>;
    } finally {
      this.connectionLocks.delete(userId);
    }
  }

  /**
   * D10 — `GameServer.currentConnections` is derived from the `ServerConnection`
   * rows, never from this service's in-memory `serverStates` map. Mirrors
   * `serverService.syncConnectionCount`; kept local rather than reaching across
   * services because `gameStateManager` is constructed before the DI container
   * has `serverService`.
   */
  private async syncServerConnectionCount(serverId: string): Promise<void> {
    const count = await db.client.serverConnection.count({
      where: { serverId, isActive: true },
    });
    await db.client.gameServer.update({
      where: { id: serverId },
      data: { currentConnections: count },
    });
  }

  public async disconnectPlayerFromServer(userId: string): Promise<void> {
    await safeExecute({
      fn: async () => {
        const session = this.playerSessions.get(userId);
        if (!session || !session.currentServerId) return;

        const serverId = session.currentServerId;

        // Update server state — prune empty entries to prevent unbounded growth
        const serverState = this.serverStates.get(serverId);
        if (serverState) {
          serverState.connectedPlayers = serverState.connectedPlayers.filter(
            (id) => id !== userId,
          );
          serverState.activeConnections = serverState.connectedPlayers.length;
          serverState.lastUpdate = new Date();

          // Remove from map if no players remain
          if (serverState.connectedPlayers.length === 0) {
            this.serverStates.delete(serverId);
          }

          // D10: derive from the connection rows — see the note on the connect side.
          await this.syncServerConnectionCount(serverId);
        }

        // R6: leave with ALL of the user's sockets — see the join side. A
        // single-socket `leave` would also have left the player's other tabs
        // in the room, still receiving broadcasts for a server they are no
        // longer on.
        await this.io.in(`user:${userId}`).socketsLeave(`server:${serverId}`);

        // Symmetric with the join above — without this the occupancy map
        // would only ever grow, and `who` would list players who had left.
        try {
          const { getService } = await import("../di/container");
          const presence =
            getService<import("./playerPresenceService").default>(PLAYER_PRESENCE_SERVICE);
          await presence.playerLeftServer(userId, serverId);
        } catch (err) {
          this.logger.warn({ err, userId, serverId }, "Could not clear server presence");
        }

        // Broadcast to others on server
        const leaver = await db.client.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });
        this.io.to(`server:${serverId}`).emit("server:user_disconnected", {
          userId,
          username: leaver?.username ?? "unknown",
          serverId,
          timestamp: new Date(),
        });

        delete session.currentServerId;

        // Restore working directory to the home server context
        if (session.homeServerId) {
          const user = await db.client.user.findUnique({
            where: { id: userId },
            select: { username: true },
          });
          const homeDir = user?.username ? `/home/${user.username}` : "/";
          session.currentDirectory = homeDir;

          const activeTerminal = session.terminals.find(
            (t) => t.id === session.activeTerminalId,
          );
          if (activeTerminal) {
            activeTerminal.serverId = session.homeServerId;
            activeTerminal.currentDirectory = homeDir;
          }
        }

        // Symmetric with registerConnection above: a drain that is never
        // released is worse than one that never starts.
        try {
          const { getService } = await import("../di/container");
          const memory = getService<import("./memoryService").default>(MEMORY_SERVICE);
          memory.unregisterConnection(userId, serverId);
        } catch (err) {
          this.logger.warn({ err, userId, serverId }, "Could not release connection drain");
        }

        this.logger.info({ userId, serverId }, "User disconnected from server");
      },
      context: "Disconnect player from server",
      logger: this.logger,
    })();
  }

  public getServerState(serverId: string): ServerState | undefined {
    return this.serverStates.get(serverId);
  }

  public getConnectedPlayersOnServer(serverId: string): string[] {
    const serverState = this.serverStates.get(serverId);
    return serverState ? serverState.connectedPlayers : [];
  }

  // ==================== VALIDATION ====================

  public async validatePlayerAction(
    userId: string,
    _action: string,
    _data?: any,
  ): Promise<ValidationResult> {
    const session = this.playerSessions.get(userId);

    if (!session) {
      return { valid: false, error: "No active session found" };
    }

    if (!session.isActive) {
      return { valid: false, error: "Session is inactive" };
    }

    // Check session timeout
    const now = new Date();
    const inactiveTime = now.getTime() - session.lastActivity.getTime();
    const timeoutMs = SESSION_TIMEOUT_MS;

    if (inactiveTime > timeoutMs) {
      await this.destroySession(userId);
      return { valid: false, error: "Session timed out" };
    }

    // Update activity
    this.updateLastActivity(userId);

    return { valid: true };
  }

  // ==================== UTILITY METHODS ====================

  private async initializeHomeFileSystem(
    homeServerId: string,
    userId: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        // Import fileService
        const { getService } = await import("../di/container");
        const fileService = getService<FileService>(FILE_SERVICE);

        // Check if home server exists
        let homeServer = await db.client.gameServer.findUnique({
          where: { id: homeServerId },
        });

        if (!homeServer) {
          // Create home server entry
          const user = await db.client.user.findUnique({
            where: { id: userId },
          });

          if (!user) return;

          // Check if a server with this IP already exists (due to unique constraint)
          const existingServerWithIp = await db.client.gameServer.findUnique({
            where: { ipAddress: user.homeIp },
          });

          if (existingServerWithIp) {
            this.logger.info(
              {
                homeIp: user.homeIp,
                existingServerId: existingServerWithIp.id,
                username: user.username,
              },
              "Server with IP already exists, using it",
            );
            homeServer = existingServerWithIp;

            // Update the user's homeServerId to point to the existing server
            await db.client.user.update({
              where: { id: userId },
              data: { homeServerId: existingServerWithIp.id },
            });
          } else {
            homeServer = await db.client.gameServer.create({
              data: {
                id: homeServerId,
                name: `${user.username}'s Home System`,
                ipAddress: user.homeIp,
                type: "player_home",
                ownerId: userId,
                securityLevel: 1,
                firewallLevel: 1,
                encryptionLevel: 1,
                discoveryLevel: 0,
                isPlayerHome: true,
                isOnline: true,
                maxConnections: 1,
                currentConnections: 0,
              },
            });

            this.logger.info(
              { userId, homeServerId },
              "Created home server for user",
            );

            // Store reference in User record
            await db.client.user.update({
              where: { id: userId },
              data: { homeServerId },
            });
          }
        }

        // Initialize file system for home server
        await fileService.initializeFileSystem(homeServer.id, userId);

        // Create user's home directory with some starter files
        await this.createStarterFiles(homeServer.id, userId);
      },
      context: "Initialize home file system",
      logger: this.logger,
    })();
  }

  private async createStarterFiles(
    homeServerId: string,
    userId: string,
  ): Promise<void> {
    await safeExecute({
      fn: async () => {
        const { getService } = await import("../di/container");
        const fileService = getService<FileService>(FILE_SERVICE);

        // Get user info
        const user = await db.client.user.findUnique({
          where: { id: userId },
        });

        if (!user) {
          this.logger.error({ userId }, "User not found");
          return;
        }

        const userHomeDir = `/home/${user.username}`;

        // Try to create user's home directory (will fail gracefully if exists)
        const createDirResult = await fileService.createDirectory(
          homeServerId,
          userId,
          userHomeDir,
        );

        if (createDirResult.success) {
          this.logger.info(
            { username: user.username, userHomeDir },
            "Created home directory for user",
          );
        } else if (createDirResult.error === "DIRECTORY_EXISTS") {
          // Directory already exists, that's fine
          this.logger.info(
            { username: user.username, userHomeDir },
            "Home directory already exists for user",
          );
          return; // Don't recreate starter files
        } else {
          this.logger.error(
            { message: createDirResult.message },
            "Failed to create home directory",
          );
          return;
        }

        // Create welcome.txt
        await fileService.createFile(
          homeServerId,
          userId,
          `${userHomeDir}/welcome.txt`,
          `Welcome to AIDA - AI-Driven Interactive Adventure

You are now connected to your home terminal system.

Basic Commands:
  help           - Show available commands
  ls             - List files and directories
  cd <path>      - Change directory
  pwd            - Print working directory
  cat <file>     - Read file contents
  status         - View your player status
  missions       - View available missions
  scan           - Scan for nearby servers
  connect <ip>   - Connect to a remote server

Type 'help' for a complete list of commands.
Type 'man <command>' for detailed information about a specific command.

Good luck, hacker.
`,
          false,
        );

        // Create readme.txt
        await fileService.createFile(
          homeServerId,
          userId,
          `${userHomeDir}/readme.txt`,
          `AIDA System Information

Your home IP: Check with 'status' command
Current directory: ${userHomeDir}

File System Structure:
  ${userHomeDir}     - Your personal files
  /bin              - System binaries (protected)
  /etc              - Configuration files (protected)
  /var              - Variable data
  /tmp              - Temporary files
  /logs             - System logs

Tips:
- Use 'scan' to discover servers you can hack
- Complete missions to gain experience and credits
- Visit the shop to buy tools and upgrades
- Use 'forum scan' to discover underground forums
`,
          false,
        );

        this.logger.info(
          { username: user.username, userHomeDir },
          "Created starter files for user",
        );
      },
      context: "Create starter files",
      logger: this.logger,
    })();
  }

  private async getServerInfo(serverId: string, userId?: string): Promise<any> {
    return await safeExecute({
      fn: async () => {
        const server = await db.client.gameServer.findUnique({
          where: { id: serverId },
        });

        if (!server) return null;

        // Calculate player's access level for this server
        let accessLevel = 0;
        if (userId) {
          if (server.ownerId === userId) {
            accessLevel = 10; // Full access to own server
          } else {
            const [connection, backdoor] = await Promise.all([
              db.client.serverConnection.findFirst({
                where: { userId, serverId },
                orderBy: { connectedAt: "desc" },
                select: { accessLevel: true },
              }),
              db.client.backdoor.findFirst({
                where: { installerId: userId, serverId, isActive: true },
                select: { accessLevel: true },
              }),
            ]);
            accessLevel = Math.max(connection?.accessLevel ?? 0, backdoor?.accessLevel ?? 0);
          }
        }

        return {
          name: server.name,
          ip: server.ipAddress,
          type: server.type,
          accessLevel,
          encryptionLevel: server.encryptionLevel,
        };
      },
      context: "Get server info",
      logger: this.logger,
      fallback: null,
    })();
  }

  // ==================== TERMINAL TAB MANAGEMENT ====================

  public createTerminal(userId: string, label?: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      this.logger.error({ userId }, "No session found for user");
      return null;
    }

    const terminalNumber = session.terminals.length + 1;
    const newTerminal: TerminalTab = {
      id: `term_${Date.now()}_${terminalNumber}`,
      label: label || `Terminal ${terminalNumber}`,
      currentDirectory: session.terminals[0]?.currentDirectory || "/",
      commandHistory: [],
      createdAt: new Date(),
      lastActivity: new Date(),
      isProcessing: false,
    };

    // Set serverId if homeServerId exists
    if (session.homeServerId) {
      newTerminal.serverId = session.homeServerId;
    }

    session.terminals.push(newTerminal);
    this.logger.info(
      { terminalId: newTerminal.id, userId },
      "Created terminal",
    );

    return newTerminal;
  }

  public closeTerminal(userId: string, terminalId: string): boolean {
    const session = this.playerSessions.get(userId);
    if (!session) {
      this.logger.error({ userId }, "No session found for user");
      return false;
    }

    // Don't allow closing the last terminal
    if (session.terminals.length <= 1) {
      this.logger.warn({ userId }, "Cannot close the last terminal");
      return false;
    }

    const terminalIndex = session.terminals.findIndex(
      (t) => t.id === terminalId,
    );
    if (terminalIndex === -1) {
      this.logger.error({ terminalId, userId }, "Terminal not found for user");
      return false;
    }

    // Don't allow closing the home terminal (first terminal, index 0)
    if (terminalIndex === 0) {
      this.logger.warn({ userId }, "Cannot close the home terminal");
      return false;
    }

    session.terminals.splice(terminalIndex, 1);

    // If we closed the active terminal, switch to the first one (home)
    if (session.activeTerminalId === terminalId) {
      session.activeTerminalId = session.terminals[0]!.id;
    }

    this.logger.info({ terminalId, userId }, "Closed terminal");
    return true;
  }

  public switchTerminal(userId: string, terminalId: string): boolean {
    const session = this.playerSessions.get(userId);
    if (!session) {
      this.logger.error({ userId }, "No session found for user");
      return false;
    }

    const terminal = session.terminals.find((t) => t.id === terminalId);
    if (!terminal) {
      this.logger.error({ terminalId, userId }, "Terminal not found for user");
      return false;
    }

    session.activeTerminalId = terminalId;
    terminal.lastActivity = new Date();
    this.logger.info({ terminalId, userId }, "Switched to terminal");

    return true;
  }

  public getActiveTerminal(userId: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      return null;
    }

    return (
      session.terminals.find((t) => t.id === session.activeTerminalId) ||
      session.terminals[0] ||
      null
    );
  }

  public getTerminal(userId: string, terminalId: string): TerminalTab | null {
    const session = this.playerSessions.get(userId);
    if (!session) {
      return null;
    }

    return session.terminals.find((t) => t.id === terminalId) || null;
  }

  public updateTerminalProcessing(
    userId: string,
    terminalId: string,
    isProcessing: boolean,
    command?: string,
  ): void {
    const terminal = this.getTerminal(userId, terminalId);
    if (terminal) {
      terminal.isProcessing = isProcessing;
      if (command !== undefined) {
        terminal.processingCommand = command;
      }
      terminal.lastActivity = new Date();
    }
  }

  // ==================== CLEANUP ====================

  /**
   * Start automatic cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(async () => {
      await this.cleanupIdleSessions();
    }, this.CLEANUP_INTERVAL_MS);
  }

  /**
   * Release everything this manager holds. Called by `gracefulShutdown`.
   *
   * REVIEW 2026-09-25: GAME_STATE_MANAGER was absent from the shutdown table
   * in lifecycle.ts and `stopCleanupTimer` was private, so its interval could
   * not be stopped even in principle — and this changeset then hung the
   * slice-refresh debounce timers and two EventEmitter subscriptions off the
   * same object. The debounce timers are `unref`'d so they cannot hold the
   * process open, but they fire callbacks that touch the database, which
   * `gracefulShutdown` disconnects near the end of its sequence.
   */
  public stop(): void {
    this.stopCleanupTimer();
    for (const timer of this.sliceRefreshTimers.values()) clearTimeout(timer);
    this.sliceRefreshTimers.clear();
    this.pendingSlices.clear();
    // Drop ONLY the subscriptions this class made, so a restarted container
    // does not stack a second set and a foreign subscriber is left alone.
    for (const { emitter, event, handler } of this.bridgeSubscriptions) {
      (emitter as unknown as { off: (e: string, h: (...a: any[]) => void) => unknown })
        .off(event, handler);
    }
    this.bridgeSubscriptions.length = 0;
  }

  /**
   * Stop automatic cleanup timer
   */
  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Clean up idle sessions that have exceeded timeout
   */
  public async cleanupIdleSessions(): Promise<number> {
    const now = Date.now();
    let cleanedCount = 0;

    // Collect idle userIds first to avoid modifying the Map during iteration
    const idleUserIds: string[] = [];
    for (const [userId, session] of this.playerSessions.entries()) {
      const idleTime = now - session.lastActivity.getTime();
      if (idleTime > this.SESSION_IDLE_TIMEOUT_MS) {
        idleUserIds.push(userId);
      }
    }

    for (const userId of idleUserIds) {
      try {
        await this.destroySession(userId);
        cleanedCount++;
      } catch (error) {
        this.logger.error({ err: error, userId }, "Error cleaning up session");
      }
    }

    // Prune serverStates with no active player sessions
    for (const [serverId] of this.serverStates) {
      const hasActivePlayers = [...this.playerSessions.values()].some(
        session => session.currentServerId === serverId
      );
      if (!hasActivePlayers) {
        this.serverStates.delete(serverId);
      }
    }

    return cleanedCount;
  }

  /**
   * Clean up session on disconnect
   */
  // R6: `handleDisconnect(socketId)` was REMOVED, not wired up.
  //
  // The plan's R6 item said to "call the socket-aware handleDisconnect
  // (socketId)". Reading it showed it only resolved the userId from
  // `activeConnections` and called `destroySession(userId)` — exactly what
  // the socket layer already does, minus the `isLastSocket` guard added in
  // Phase 4. So calling it would have DESTROYED a session that the user's
  // other tabs were still using: the prescription was a regression, not a
  // fix. Per-socket bookkeeping lives in `attachSocket`/`detachSocket`
  // instead, and session teardown stays in the socket layer where the
  // last-socket question can be answered.

  /**
   * Full cleanup - destroy all sessions and stop timer
   */
  public async cleanup(): Promise<void> {
    await safeExecute({
      fn: async () => {
        // Stop the cleanup timer
        this.stopCleanupTimer();

        // Destroy all sessions
        const userIds = Array.from(this.playerSessions.keys());
        for (const userId of userIds) {
          await this.destroySession(userId);
        }

        // Clear all maps
        this.playerSessions.clear();
        this.activeConnections.clear();
        this.serverStates.clear();
      },
      context: "GameStateManager cleanup",
      logger: this.logger,
    })();
  }

  // ==================== MONITORING & STATS ====================

  public getStats() {
    const now = Date.now();
    const sessions = Array.from(this.playerSessions.values());
    const idleSessions = sessions.filter(
      (s) => now - s.lastActivity.getTime() > this.SESSION_IDLE_TIMEOUT_MS,
    );

    return {
      activePlayers: this.playerSessions.size,
      activeConnections: this.activeConnections.size,
      activeServers: this.serverStates.size,
      idleSessions: idleSessions.length,
      maxSessions: this.MAX_SESSIONS,
      cleanupInterval: this.CLEANUP_INTERVAL_MS,
      sessionTimeout: this.SESSION_IDLE_TIMEOUT_MS,
      sessions: sessions.map((session) => ({
        userId: session.userId,
        connectedAt: session.connectedAt,
        lastActivity: session.lastActivity,
        currentServerId: session.currentServerId,
      })),
    };
  }

  public logStats(): void {
    const stats = this.getStats();
    this.logger.info(
      {
        activePlayers: stats.activePlayers,
        activeServers: stats.activeServers,
      },
      "GameStateManager Stats",
    );
  }
}

export default GameStateManager;
