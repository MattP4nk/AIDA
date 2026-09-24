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
   * Emitted ONLY when the client authenticates without an acknowledgement
   * callback. The real client now always passes one, so this is the legacy
   * branch — kept because harnesses and any older client still rely on it.
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

  // ── hacking ────────────────────────────────────────────────────────────
  "hack:attempt": (data: Record<string, unknown>) => void;
  "hack:detected": (data: Record<string, unknown>) => void;
  "hack:result": (data: Record<string, unknown>) => void;

  // ── missions ───────────────────────────────────────────────────────────
  "mission:completed": (data: Record<string, unknown>) => void;
  "mission:failed": (data: { missionId: string; userId: string; reason: string }) => void;

  // ── world / forum ──────────────────────────────────────────────────────
  "forum:new-post": (data: { postId: string; title: string; author: string }) => void;
  "forum:new-reply": (data: { postId: string; replyId: string; author: string }) => void;
  "server:discovered": (data: { count: number; subnet: string; servers: unknown[] }) => void;
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
    "process:failed", // processStateService.ts:189, internal only
  ],
  /**
   * Removed 2026-09-24: `faction:event`, `mission:updated`,
   * `server:file_modified`, `error`. No producer existed anywhere — not a
   * socket emit, not even an internal EventEmitter. Speculative handlers for
   * events that were never built.
   */
  deletedDeadListeners: [
    "faction:event",
    "mission:updated",
    "server:file_modified",
    "error",
  ],
  /** Client emits; no server listens. */
  clientEmitsWithoutListener: ["join:room", "leave:room"],
  /** Server listens; no client emits — commands go over REST. */
  serverListenersWithoutEmitter: ["command:execute"],
} as const;
