/**
 * A3 — the socket event contract.
 *
 * Until now there was no event map anywhere: `Socket` was ungenericized on
 * both sides, so every event name was a free-form string checked by nobody.
 * An audit of the real code found **50 orphaned event names**:
 *
 *   - 10 client listeners waiting on events no server emits
 *     (`authenticated`, `hack:attempted`, `hack:successful`, `hack:blocked`,
 *     `hack:error`, `mission:updated`, `faction:event`, `process:failed`,
 *     `server:file_modified`, `error`) — several are near-misses for the real
 *     names (`hack:attempt`, `hack:detected`, `hack:result`), which is exactly
 *     the failure a typed map prevents
 *   - 37 server emits with no client listener
 *   - 2 client emits with no server listener (`join:room`, `leave:room`)
 *   - 1 server listener with no client emitter (`command:execute` — commands
 *     go over REST)
 *
 * WHAT THIS FILE IS FOR. It is deliberately a *description of what exists*,
 * not an aspiration. Adding an event here does not create it; the value is
 * that the names and payloads are written down once, so a rename in one file
 * cannot silently orphan a listener in another (CLAUDE.md bug shape #7).
 *
 * The maps are intentionally NOT applied as `Socket<…>` generics yet — doing
 * that in the same change would mix a mechanical retype with the two real bug
 * fixes it accompanies, and the orphan cleanup is a behaviour decision per
 * event (wire it up, or delete it). Applying them is the next step, and
 * `scripts/verify-phase7-a3-socket-contract.ts` guards the contract meanwhile.
 */

/** Sent by the server, listened for by the client. */
export interface ServerToClientEvents {
  // ── command ────────────────────────────────────────────────────────────
  /**
   * NOTE the payload type: `output` is `string | string[]`.
   *
   * That union is the U5 hazard. The client's `addOutputLine(id, text: string)`
   * takes a string, and the REST path normalises arrays at
   * `Terminal.svelte:881` — but the socket path has no such layer, so an
   * emitter sending an array put one straight into a string field.
   * `hackCommands.ts` did exactly that. Emitters must join before sending.
   */
  "command:result": (data: {
    success: boolean;
    output: string | string[];
    error?: string;
    timestamp: Date | string;
    terminalId?: string;
    soundEvent?: string;
  }) => void;

  // ── authentication ─────────────────────────────────────────────────────
  /**
   * UNREACHABLE. Emitted only in the `else` of
   * `typeof callback === "function"` — and **every** emitter of
   * `authenticated`/`authenticate:request` passes an ack: the client
   * (socket.ts, App.svelte) and all 13 harnesses. Verified by counting: 15
   * emit sites, 0 without a callback.
   *
   * The previous comment here claimed it was "kept because harnesses still
   * rely on it". That was false — I wrote it while fixing the handshake and
   * never checked. Flagged for deletion in the orphan audit.
   */
  "authentication:complete": (data: {
    success: boolean;
    userId?: string;
    username?: string;
    error?: string;
  }) => void;

  // ── notifications & messaging ──────────────────────────────────────────
  notification: (data: {
    type: string;
    title: string;
    message: string;
    severity?: string;
    priority?: string;
  }) => void;
  "message:new_mail": (data: Record<string, unknown>) => void;
  "moderation:flagged": (data: { type: string; id: string; reason: string }) => void;

  // ── wired 2026-09-24 (orphan audit group B) ────────────────────────────
  // Each of these was emitted by the server with no client listener. They
  // carried the only signal the player had for a honeypot, a rep change, a
  // kick, a refused connection, or a failed tab operation.
  "security:warning": (data: {
    type?: string;
    message: string;
    forumName?: string;
    severity?: string;
  }) => void;
  "reputation:changed": (data: {
    factionId: string;
    factionName: string;
    amount: number;
    reason?: string;
    source?: string;
  }) => void;
  "force:disconnect": (data: { reason?: string }) => void;
  "connection:refused": (data: { reason: string }) => void;
  "terminal:error": (data: { success: false; error: string }) => void;

  // ── hacking ────────────────────────────────────────────────────────────
  "hack:attempt": (data: Record<string, unknown>) => void;
  "hack:detected": (data: Record<string, unknown>) => void;
  "hack:result": (data: Record<string, unknown>) => void;

  // ── missions ───────────────────────────────────────────────────────────
  "mission:completed": (data: Record<string, unknown>) => void;
  "mission:failed": (data: { missionId: string; userId: string; reason: string }) => void;

  // ── world / forum ──────────────────────────────────────────────────────
  /**
   * ORPHANED BY ROOM, not by name. The server emits these and the client
   * listens for them, so a name-comparison audit — including the first
   * version of this file — scores them healthy. But both are addressed to
   * room `forum:<forumId>`, and **nothing ever joins that room**: the only
   * rooms joined anywhere are `user:<id>`, `player:<id>` and `server:<id>`.
   * No live forum update has ever reached a player.
   *
   * The lesson for this contract: matching event NAMES is not enough. An
   * event is only wired if the listener is in the room it is sent to.
   */
  "forum:new-post": (data: { postId: string; title: string; author: string }) => void;
  "forum:new-reply": (data: { postId: string; replyId: string; author: string }) => void;
  "server:discovered": (data: { count: number; subnet: string; servers: unknown[] }) => void;

  /**
   * The world feed — and the ONLY event channel eventService still has.
   *
   * `game:event` used to sit beside this and is now gone entirely (2026-09-24,
   * orphan audit). It had two client listeners on one name with incompatible
   * payloads, feeding a store no component reads and an empty
   * `showNotification`. Targeted events moved to `notification` via notifyUser
   * so they persist and replay; keyFragmentService's endgame announcement
   * moved here, where a global broadcast belongs.
   *
   * This one is now GATED ON `isGlobal`. It previously fired for every event
   * including targeted ones, so a breach or a tripped honeypot announced
   * itself to every connected player — and it dropped `description` and
   * `metadata`, so the one channel that did reach people carried the least.
   */
  /**
   * The authoritative player state, and the incremental updates to it.
   *
   * Both had ZERO listeners until 2026-09-25, and `broadcastStateDelta` had
   * zero CALLERS, so the channel was dead at both ends: the server computed a
   * five-query full state on every authenticate and discarded it, while the
   * client fell back to `/api/users/stats` and `/api/servers` — neither of
   * which is a mounted route (both 404).
   *
   * `state:delta` paths are dotted and must match what
   * `shared/utils/stateDelta.ts` walks. That agreement is the fragile part:
   * a renamed path does not throw, it just silently stops updating the UI.
   */
  "state:update": (data: { fullState: unknown; timestamp: Date | string }) => void;
  "state:delta": (data: {
    delta: { path: string; value: unknown; operation: "set" | "push" | "remove" | "update" };
    timestamp: Date | string;
  }) => void;

  "game:event:public": (data: {
    id?: string;
    type: string;
    title: string;
    description?: string;
    severity?: string;
    metadata?: Record<string, unknown>;
    timestamp: Date | string;
  }) => void;
}

/** Sent by the client, listened for by the server. */
export interface ClientToServerEvents {
  /**
   * The acknowledgement is what makes this work.
   *
   * `handleAuthentication` branches on `typeof callback === "function"`. The
   * client used to emit this with NO callback, taking the else branch, whose
   * `authentication:complete` reply nothing listened for. Declaring the ack in
   * the signature is precisely the kind of mistake this map exists to prevent.
   */
  authenticated: (
    ack?: (response: { success: boolean; userId?: string; username?: string; error?: string }) => void,
  ) => void;
  "authenticate:request": (
    ack?: (response: { success: boolean; userId?: string; username?: string; error?: string }) => void,
  ) => void;

  /**
   * Ask for a full `state:update`.
   *
   * Sent when a `state:delta` cannot be applied, which means the two sides
   * disagree about a path. Throttled on the client (one per 5s) AND rate
   * limited on the server, because the trigger condition repeats for every
   * subsequent delta — unthrottled it is a self-inflicted request storm.
   */
  "state:request": () => void;

  "terminal:create": (data: { terminalId?: string; label?: string }) => void;
  "terminal:switch": (data: { terminalId?: string }) => void;
  "typing:start": (data: Record<string, unknown>) => void;
  "typing:stop": (data: Record<string, unknown>) => void;
}

/** Event names that exist in code but have no counterpart. Kept as data so a
 *  harness can assert the list does not grow silently. */
export const KNOWN_ORPHANED_EVENTS = {
  /** Client listens; no server emits. Fix by wiring up or deleting. */
  clientListenersWithoutEmitter: [
    // These wait on events that ARE produced — on the internal service bus,
    // never bridged to a socket. Deleting them would discard a feature; the
    // fix is a bridge, which is a behaviour change. See PLAN.md A3.
    "hack:attempted", // hackService emits "hack:attempt" internally
    "hack:successful", // would carry the "your system was compromised" alert
    "hack:blocked",
    "hack:error",
  ],
  /**
   * Removed 2026-09-24: `faction:event`, `mission:updated`,
   * `server:file_modified`, `error`. No producer existed anywhere — not a
   * socket emit, not even an internal EventEmitter. Speculative handlers for
   * events that were never built.
   */
  deletedDeadListeners: [
    // Retired 2026-09-24 with the event-delivery repair: both producers moved
    // (targeted -> `notification`, global -> `game:event:public`), so the
    // listeners went with them rather than being left waiting on nothing.
    "game:event",
    "faction:event",
    "mission:updated",
    "server:file_modified",
    "error",
    // No producer in either process system — see the note in socket.ts.
    "process:failed",
  ],
  /** Client emits; no server listens. */
  clientEmitsWithoutListener: ["join:room", "leave:room"],
  /** Server listens; no client emits — commands go over REST. */
  serverListenersWithoutEmitter: ["command:execute"],
} as const;
