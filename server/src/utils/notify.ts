/**
 * The one place a player notification is sent.
 *
 * ORPHAN AUDIT 2026-09-24: the `Notification` model is fully specced — five
 * indexes, read/dismiss/expiry columns, a `User` back-relation — and was
 * **never written or read**. Delivery was socket-only and the client store is
 * in-memory (`client/src/services/notifications.ts`), so **nothing survived a
 * reload**. A player who refreshed lost every alert they had not already seen,
 * including security warnings and bounty notices.
 *
 * Verified before wiring that no other persistence existed: zero
 * `prisma.notification` / `db.client.notification` references repo-wide.
 *
 * Seven emit sites across three services each hand-rolled their own payload,
 * so there was nowhere to add persistence without adding it seven times. This
 * is that place. Emitting directly still works and is not forbidden — but a
 * new site that uses this one gets durability for free, which is the only
 * reliable way a convention like this survives.
 */
import type { Server as SocketIOServer } from "socket.io";
import { db } from "../database/client";
import logger from "../logger";
import { NOTIFICATION_RETENTION_DAYS } from "../config/gameBalance";

/**
 * How long to wait for the client to confirm a live notification.
 *
 * Same value the replay path uses in `sockets/handlers.ts`; both are the same
 * question asked of the same client listener.
 */
const NOTIFICATION_ACK_TIMEOUT_MS = 10_000;

/** Priorities the client actually understands (R13 aligned these). */
export type NotifyPriority = "low" | "normal" | "high" | "critical";

export interface NotifyInput {
  /** Short machine-ish kind: "levelup", "security_alert", "bounty", … */
  type: string;
  title?: string;
  message: string;
  /** Grouping for later filtering: game | social | security | mission | faction */
  category?: string;
  priority?: NotifyPriority;
  /** Legacy field several call sites already send; mapped onto priority. */
  severity?: string;
  data?: Record<string, unknown>;
  /** Omit for notifications that should persist indefinitely. */
  expiresAt?: Date;
}

/**
 * `severity` predates `priority` and is still what several emitters send.
 *
 * Mapped rather than passed through: the schema comment on `priority` still
 * lists `"urgent"`, a value R13 removed from the client because the server
 * never sent it and it matched no sound, colour or CSS rule. Anything
 * unrecognised lands on "normal" rather than inventing a fifth level.
 */
function toPriority(input: NotifyInput): NotifyPriority {
  if (input.priority) return input.priority;
  switch ((input.severity ?? "").toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
    case "warning":
      return "high";
    case "low":
      return "low";
    default:
      return "normal";
  }
}

/**
 * Persist a notification and deliver it to every socket the user has open.
 *
 * Persistence failures do NOT block delivery: a player seeing the alert now
 * matters more than it surviving a reload, and the reverse ordering would let
 * a database blip swallow a security warning.
 */
export async function notifyUser(
  io: SocketIOServer | null | undefined,
  userId: string,
  input: NotifyInput,
): Promise<void> {
  const priority = toPriority(input);
  const room = `player:${userId}`;

  let id: string | undefined;
  try {
    const row = await db.client.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title ?? input.type,
        message: input.message,
        category: input.category ?? "game",
        priority,
        data: (input.data ?? {}) as never,
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      },
      select: { id: true },
    });
    id = row.id;
  } catch (err) {
    logger.error({ err, userId, type: input.type }, "Failed to persist notification");
  }

  // Producer data is spread FIRST so it cannot shadow the envelope. The client
  // keys off exactly the fields it would overwrite — `id` drives dedupe,
  // `timestamp` the replay clock, `priority` the sound and colour — and the
  // payload is not a controlled vocabulary: `eventService.broadcastEvent`
  // forwards arbitrary `event.metadata` straight in.
  const payload = {
    ...(input.data ?? {}),
    id,
    type: input.type,
    title: input.title ?? input.type,
    message: input.message,
    category: input.category ?? "game",
    priority,
    severity: input.severity,
    timestamp: new Date(),
  };

  const target = io?.to(room) as
    | (ReturnType<NonNullable<typeof io>["to"]> & {
        timeout?: (ms: number) => { emit: (...a: unknown[]) => void };
      })
    | undefined;

  // ACKNOWLEDGED, same contract as the replay path in handlers.ts.
  //
  // A live delivery is what finally marks a notification read — without that,
  // only replayed rows ever are, `purgeOldNotifications` deliberately never
  // touches unread rows, and `getPendingNotifications` takes 50, so an online
  // player's backlog grows forever and replays the same stale alerts.
  //
  // But "read" has to mean the CLIENT CONFIRMED IT, not "a socket was in the
  // room". Socket.IO keeps a socket in its rooms until `disconnect` fires,
  // which is pingInterval + pingTimeout — around 45s — after the connection
  // actually dies. Deciding on room membership meant a sleeping laptop had its
  // security alerts written `isRead: true` and emitted into a dead socket:
  // never seen, never replayed, then purged. That is precisely the failure the
  // replay path was fixed to avoid, so the two now agree.
  //
  // Nothing acked => nothing marked => it replays on the next connect. A
  // duplicate is recoverable; a silently dropped alert is not.
  if (id && typeof target?.timeout === "function") {
    target
      .timeout(NOTIFICATION_ACK_TIMEOUT_MS)
      .emit("notification", payload, (_err: unknown, responses?: unknown[]) => {
        // Broadcast acks resolve with the responses received SO FAR even on
        // timeout, so `_err` being set does not mean nobody answered — only
        // that not every socket did. One confirmation is enough.
        if (responses && responses.length > 0) void markNotificationsRead(userId, [id!]);
      });
    return;
  }

  // No ack available (no io, or a stub without `timeout`): deliver anyway and
  // leave the row pending. Delivery matters more than bookkeeping, and an
  // unread row is the recoverable side of the trade.
  target?.emit("notification", payload);
}

/**
 * Notifications a reconnecting player has not seen yet.
 *
 * This is the half that makes persistence worth anything — writing rows nobody
 * ever reads would be the same dead feature in a new place.
 */
export async function getPendingNotifications(userId: string, limit = 50) {
  try {
    return await db.client.notification.findMany({
      where: {
        userId,
        isRead: false,
        isDismissed: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  } catch (err) {
    logger.error({ err, userId }, "Failed to load pending notifications");
    return [];
  }
}

/**
 * Delete notifications that are read, dismissed, or expired and older than the
 * retention window.
 *
 * REVIEW 2026-09-25: nothing ever deleted a row, no call site set `expiresAt`,
 * and the only reader takes 50 at a time — so a table with five indexes and a
 * text column grew forever while 99.9% of it was never read again. Every
 * level-up, reward, drop, bounty and security alert added one permanently.
 *
 * UNREAD ROWS ARE NEVER TOUCHED regardless of age. The whole point of this
 * model is that an alert survives until the player actually sees it; a purge
 * that could delete an unseen security warning would reintroduce the bug the
 * persistence work exists to fix.
 */
export async function purgeOldNotifications(
  retentionDays = NOTIFICATION_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  try {
    const res = await db.client.notification.deleteMany({
      where: {
        // EVERY branch requires the row to have been seen. The third used to
        // be a bare `expiresAt < now`, which deleted UNREAD expired rows and
        // so contradicted this function's own docstring and the comment at its
        // call site. Latent only because nothing sets `expiresAt` yet — and
        // `expiresAt` is a public field on NotifyInput, so the first producer
        // to use it would have silently armed this to destroy unseen alerts.
        // It also bought nothing: getPendingNotifications already refuses to
        // replay an expired row.
        OR: [
          { isRead: true, createdAt: { lt: cutoff } },
          { isDismissed: true, createdAt: { lt: cutoff } },
          { isRead: true, expiresAt: { lt: new Date() } },
          { isDismissed: true, expiresAt: { lt: new Date() } },
        ],
      },
    });
    if (res.count > 0) logger.info({ purged: res.count }, "Purged old notifications");
    return res.count;
  } catch (err) {
    logger.error({ err }, "Failed to purge notifications");
    return 0;
  }
}

/** Mark notifications read once the client has them. */
export async function markNotificationsRead(userId: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  try {
    const res = await db.client.notification.updateMany({
      where: { userId, id: { in: ids } },
      data: { isRead: true, readAt: new Date() },
    });
    return res.count;
  } catch (err) {
    logger.error({ err, userId }, "Failed to mark notifications read");
    return 0;
  }
}
