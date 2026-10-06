/**
 * Notification persistence — wiring a model that was written and read by nobody.
 *
 * Orphan audit: `Notification` is fully specced — five indexes, read/dismiss/
 * expiry columns, a `User` back-relation — and had **zero** `prisma.notification`
 * references repo-wide. Delivery was socket-only and the client store is in
 * memory, so a refresh discarded every unseen alert, security warnings included.
 *
 * The lens this batch is using — "is this functionality we lose by deleting?" —
 * says wire it: nothing else provides durability, so deleting the model would
 * not remove a redundant path, it would ratify a missing one.
 *
 * WHAT THIS HARNESS IS ACTUALLY FOR. Writing rows is the easy half and proves
 * nothing; the failure mode is persistence that is never read back, which is
 * the same dead feature in a new place. So every check below drives the round
 * trip — persist, re-query as a reconnecting client would, mark read, re-query
 * again — rather than asserting a row exists.
 *
 * SELF-CONTAINED: creates its own user and deletes it.
 *
 * Run: npx tsx scripts/verify-notification-persistence.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) =>
  strip(readFileSync(new URL(rel, import.meta.url).pathname, "utf8"));

/**
 * Records what was emitted, so delivery can be asserted and not assumed.
 *
 * MODELS THE ACK, because that is the contract under test. `notifyUser` emits
 * with `.timeout(...)` and marks the row read only when the client answers,
 * so a fake that only implements `emit` would silently exercise the fallback
 * path and every ack assertion below would be vacuous.
 *
 * `acks: false` is the half-dead socket: the frame is delivered to the room
 * (Socket.IO does not know the client is gone) and no confirmation comes back.
 */
function fakeIo({ acks = false }: { acks?: boolean } = {}) {
  const sent: Array<{ room: string; event: string; payload: any }> = [];
  const mk = (room: string) => ({
    emit: (event: string, payload: any) => { sent.push({ room, event, payload }); },
    timeout: (_ms: number) => ({
      emit: (
        event: string,
        payload: any,
        cb?: (err: unknown, responses?: unknown[]) => void,
      ) => {
        sent.push({ room, event, payload });
        // Broadcast-ack semantics: on timeout the callback still receives the
        // responses collected so far, which is why notifyUser keys off the
        // response array rather than the error.
        if (acks) cb?.(null, [undefined]);
        else cb?.(new Error("operation has timed out"), []);
      },
    }),
  });
  return { sent, to: mk };
}

/** Poll rather than sleep a fixed amount: the mark-read write is async. */
async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 3000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function main() {
  console.log("\n=== Notification persistence ===");

  const { notifyUser, getPendingNotifications, markNotificationsRead } =
    await import("../src/utils/notify");

  const tag = `__notif_probe_${process.pid}`;
  let userId: string | null = null;
  let otherId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: {
        username: tag,
        email: `${tag}@probe.local`,
        password: "probe",
        homeIp: `10.1.0.${process.pid % 250}`,
      },
    });
    userId = user.id;
    const other = await prisma.user.create({
      data: {
        username: `${tag}_other`,
        email: `${tag}_other@probe.local`,
        password: "probe",
        homeIp: `10.2.0.${process.pid % 250}`,
      },
    });
    otherId = other.id;

    // ── It is delivered AND stored, not one or the other ─────────────
    console.log("\nNP-1 — a notification is both delivered and persisted");
    {
      const io = fakeIo();
      await notifyUser(io as any, user.id, {
        type: "security_alert",
        category: "security",
        title: "Security Alert",
        message: "probe intrusion",
        severity: "critical",
      });

      check(
        "it reaches the socket room",
        io.sent.length === 1 && io.sent[0]!.room === `player:${user.id}`,
        io.sent[0]?.room ?? "(nothing emitted)",
      );
      check(
        "under the event name the client listens for",
        io.sent[0]?.event === "notification",
        io.sent[0]?.event ?? "-",
      );

      const rows = await prisma.notification.findMany({ where: { userId: user.id } });
      check(
        "and a row now exists",
        rows.length === 1,
        `${rows.length} — the table had 0 rows repo-wide before this was wired`,
      );
      check(
        "carrying the message, not a placeholder",
        rows[0]?.message === "probe intrusion",
        rows[0]?.message ?? "-",
      );
      check(
        "severity is mapped to a priority the client understands",
        rows[0]?.priority === "critical",
        `${rows[0]?.priority} — the schema comment still advertises the removed "urgent"`,
      );
      check(
        "the emitted payload carries the row id",
        !!rows[0]?.id && io.sent[0]?.payload?.id === rows[0]!.id,
        "without it the client cannot dedupe a replay against the live emit",
      );
    }

    // ── The half that makes persistence worth anything ───────────────
    console.log("\nNP-2 — a reconnecting player gets it back");
    {
      const pending = await getPendingNotifications(user.id);
      check(
        "the unseen notification is replayed",
        pending.length === 1 && pending[0]!.message === "probe intrusion",
        `${pending.length} pending — this is the read side that was missing entirely`,
      );

      const marked = await markNotificationsRead(user.id, pending.map((n) => n.id));
      check("marking read reports the count", marked === 1, String(marked));

      const again = await getPendingNotifications(user.id);
      check(
        "and a SECOND reconnect does not replay it again",
        again.length === 0,
        `${again.length} — an unbounded replay would resend every alert on every refresh`,
      );
    }

    // ── Bounded from the other side ──────────────────────────────────
    console.log("\nNP-3 — the query is bounded on every axis that can leak");
    {
      await notifyUser(fakeIo() as any, user.id, {
        type: "expired_probe",
        message: "should not replay",
        expiresAt: new Date(Date.now() - 60_000),
      });
      const afterExpired = await getPendingNotifications(user.id);
      check(
        "an expired notification is not replayed",
        afterExpired.length === 0,
        `${afterExpired.length} — expiresAt exists in the schema and had no reader`,
      );

      await notifyUser(fakeIo() as any, user.id, { type: "live_probe", message: "should replay" });
      const live = await getPendingNotifications(user.id);
      check(
        "POSITIVE CONTROL: a live one still is",
        live.length === 1 && live[0]!.type === "live_probe",
        "otherwise the expiry check above would pass for the wrong reason",
      );

      await prisma.notification.updateMany({
        where: { userId: user.id, type: "live_probe" },
        data: { isDismissed: true },
      });
      check(
        "a dismissed notification is not replayed",
        (await getPendingNotifications(user.id)).length === 0,
        "isDismissed also had no reader",
      );

      await notifyUser(fakeIo() as any, user.id, { type: "leak_probe", message: "mine" });
      check(
        "another player's notifications are not visible",
        (await getPendingNotifications(other.id)).length === 0,
        "the userId filter is the only thing between players' alerts",
      );
      check(
        "NEGATIVE CONTROL: a user with none gets an empty list, not an error",
        Array.isArray(await getPendingNotifications(other.id)),
      );

      const capped = await getPendingNotifications(user.id, 0);
      check(
        "the limit is honoured",
        capped.length === 0,
        `${capped.length} — an unbounded findMany on reconnect is a slow-loris vector`,
      );
    }

    // ── A row nobody can ever mark read is a row nobody can purge ────
    console.log("\nNP-3b — only a CONFIRMED live delivery counts as seen");
    {
      await prisma.notification.deleteMany({ where: { userId: user.id } });

      // The half-dead socket. Socket.IO keeps a socket in its rooms for
      // ~45s after the connection really dies, so the frame goes out and
      // nothing comes back. This is the case that decides the whole design:
      // keying off room membership marked these read and destroyed them.
      const deaf = fakeIo({ acks: false });
      await notifyUser(deaf as any, user.id, {
        type: "unacked_probe",
        message: "emitted into a sleeping laptop",
      });
      check(
        "PRECONDITION: the frame WAS emitted to the room",
        deaf.sent.some((s) => s.payload?.type === "unacked_probe"),
        "otherwise 'stays unread' passes because nothing was ever sent",
      );
      const unacked = await prisma.notification.findFirst({
        where: { userId: user.id, type: "unacked_probe" },
        select: { isRead: true },
      });
      check(
        "an UNACKNOWLEDGED delivery stays unread",
        unacked?.isRead === false,
        `isRead=${unacked?.isRead} — a socket still listed in the room is not a client ` +
        "that received anything; marking it read loses the alert for good",
      );

      // The live client: it answers, so it has the alert.
      const live = fakeIo({ acks: true });
      await notifyUser(live as any, user.id, {
        type: "acked_probe",
        message: "delivered and confirmed",
      });
      const marked = await waitFor(async () =>
        (await prisma.notification.findFirst({
          where: { userId: user.id, type: "acked_probe" },
          select: { isRead: true },
        }))?.isRead === true,
      );
      check(
        "an ACKNOWLEDGED delivery is marked read",
        marked,
        "unread rows are never purged and getPendingNotifications takes 50, so without " +
        "this a long-lived account replays the same stale backlog forever",
      );
      const acked = await prisma.notification.findFirst({
        where: { userId: user.id, type: "acked_probe" },
        select: { readAt: true },
      });
      check(
        "with readAt set, so the purge window has something to measure",
        acked?.readAt instanceof Date,
        `${acked?.readAt}`,
      );
      check(
        "and exactly the unconfirmed one is left to replay",
        (await getPendingNotifications(user.id)).map((n) => n.type).join(",") === "unacked_probe",
        (await getPendingNotifications(user.id)).map((n) => n.type).join(",") || "(none)",
      );

      await prisma.notification.deleteMany({ where: { userId: user.id } });
    }

    // ── Failure of the durable half must not eat the alert ───────────
    console.log("\nNP-4 — a database failure still delivers");
    {
      const io = fakeIo();
      // A userId with no User row: the FK rejects the insert, exactly as a
      // transient database fault would from notifyUser's point of view.
      await notifyUser(io as any, "no-such-user-id", {
        type: "security_alert",
        message: "must still arrive",
      });
      check(
        "the socket emit happens even though the write failed",
        io.sent.length === 1,
        "the reverse ordering would let a database blip swallow a security warning",
      );
      check(
        "and the payload has no id, so the client will not dedupe against one",
        io.sent[0]?.payload?.id === undefined,
      );
    }

    // ── The replay is actually installed on the live path ────────────
    console.log("\nNP-5 — the replay is wired into authentication");
    {
      const h = read("../src/sockets/handlers.ts");
      check(
        "handlers.ts replays on authenticate",
        /getPendingNotifications\(userId\)/.test(h),
        "persistence with no reader is the same dead feature in a new place",
      );

      // SUPERSEDED by NP-8. This used to assert only that the emit came before
      // the mark-read, which was satisfied by code that marked everything read
      // regardless of delivery. Ordering was never the property that mattered;
      // acknowledgement is. Kept as the ordering half, with NP-8 carrying the
      // real contract.
      const emitIdx = h.indexOf('.emit(\n                  "notification"');
      const markIdx = h.indexOf("markNotificationsRead(userId, acked)");
      check(
        "the emit still precedes the mark-read",
        emitIdx !== -1 && markIdx !== -1 && emitIdx < markIdx,
        "necessary but far from sufficient — see NP-8",
      );
      check(
        "the replay cannot break authentication",
        /Notification replay failed/.test(h),
        "it runs after the state broadcast and inside its own catch",
      );
    }

    // ── The replay contract, as PROPERTIES of the live code ──────────
    console.log("\nNP-8 — replay is acknowledged, ordered, and typed");
    {
      const h = read("../src/sockets/handlers.ts");
      check(
        "rows are marked read ONLY for acknowledged emits",
        /const acked = delivered\.filter/.test(h) && /markNotificationsRead\(userId, acked\)/.test(h),
        "socket.emit does not throw and does not confirm delivery, so the previous guard " +
        "('if the emit throws they stay pending') could never fire — a half-dead socket " +
        "destroyed the whole backlog",
      );
      check(
        "the emit carries an ack callback with a timeout",
        /\.timeout\(NOTIFICATION_ACK_TIMEOUT_MS\)/.test(h),
      );
      check(
        "an unacknowledged replay is reported, not silently dropped",
        /were not acknowledged; they stay pending/.test(h),
        "a skip must be loud",
      );
      check(
        "replay emits OLDEST first",
        /\[\.\.\.pending\]\.reverse\(\)/.test(h),
        "the query orders newest-first and the client PREPENDS, so emitting in query order " +
        "rendered the backlog upside down and evicted the newest alerts at the 50 cap",
      );
      check(
        "and carries the persisted category",
        /category: n\.category,/.test(h),
        "it was written to the row and dropped from every payload, so the client's " +
        "`data.category === \"security\"` branch was unreachable and alerts were filed as game messages",
      );

      const sock = read("../../client/src/services/socket.ts");
      check(
        "the client sends the ack",
        /ack\?: \(\) => void/.test(sock) && /ack\?\.\(\);/.test(sock),
      );
      check(
        "AFTER storing it, not on arrival",
        sock.indexOf("ns.add(") < sock.indexOf("ack?.();"),
        "acking on receipt would confirm a frame, not a notification the player can see",
      );
    }

    // ── The fixes review #2 forced ───────────────────────────────────
    console.log("\nNP-9 — regressions found by review #2");
    {
      const h = read("../src/sockets/handlers.ts");
      check(
        "the replay does NOT block the auth path",
        /void Promise\.all\(/.test(h),
        "awaiting 50 ten-second acks stalled every login for a client that could not ack, forever",
      );
      // AUTH IS LIMITED, BUT NOT FROM THE SHARED BUDGET.
      //
      // Three revisions of this: unlimited (a loop costs ~8 queries an emit
      // and ends in a broadcast to every socket), then limited on
      // `generalRateLimit` (the budget typing indicators also spend, so
      // ordinary play could exhaust it and the next reconnect produced a live
      // socket in no rooms with no state), now limited on its own.
      //
      // The checks assert the PROPERTY — limited, and not from the shared
      // budget — rather than the shape of the implementation, because the
      // previous version of this check encoded the mechanism and went red the
      // moment the mechanism changed.
      const authBlock = h.slice(
        h.indexOf('socket.on("authenticated"'),
        h.indexOf('socket.on("server:connect"'),
      );
      check(
        "POSITIVE CONTROL: that slice really is the two auth handlers",
        /handleAuthentication/.test(authBlock) &&
          /authenticate:request/.test(authBlock) &&
          authBlock.length > 0,
        `${authBlock.length} chars — a slice that missed would make the next checks vacuous`,
      );
      // COUNT, do not merely match. `.test()` passed with the limit removed
      // from `authenticated` because `authenticate:request` still had one —
      // a check that cannot distinguish "both guarded" from "one guarded" is
      // blind to the half of the bug that matters, and its negative control
      // stayed green. There are two entry points; both must be guarded.
      const guards = (authBlock.match(/authRateLimit\(\)/g) ?? []).length;
      const handlers = (authBlock.match(/handleAuthentication\(/g) ?? []).length;
      check(
        "PRECONDITION: there are exactly two authentication entry points",
        handlers === 2,
        `${handlers} — if this ever changes, the count below needs changing with it`,
      );
      check(
        "BOTH of them are rate limited",
        guards === handlers,
        `${guards} guards for ${handlers} handlers — unlimited, each emit costs a session ` +
        "create, five state queries, the notification replay and a broadcast to every socket",
      );
      check(
        "but NOT from the budget typing indicators spend",
        !/generalRateLimit/.test(authBlock),
        "a player who typed a long mail and then reconnected got a live socket that " +
        "never ran handleAuthentication — no rooms, no state, no notifications",
      );
      check(
        "and a refusal answers the ack",
        /refuseAuth/.test(authBlock) && /success: false/.test(h),
        "returning silently leaves a promise Socket.IO never settles; the client only " +
        "retries on the next `connect`",
      );
      check(
        "NEGATIVE CONTROL: the shared budget still limits other handlers",
        /generalRateLimit\(\)/.test(h),
        "otherwise 'not from the shared budget' passes because the symbol was renamed",
      );
      check(
        "the auth budget is its own limiter, not an alias of general",
        /auth: createSocketRateLimiter\(/.test(h) &&
          !/const authRateLimit = limiters\.general/.test(h),
        "aliasing would reintroduce the starvation this split exists to fix",
      );

      // STRUCTURAL, and saying so. The behaviour — a budget surviving the idle
      // sweep — needs LIMITER_IDLE_MS (60s) of real wall clock to observe, and
      // a harness that sleeps a minute is a harness nobody runs. What IS
      // checkable is the property the behaviour rests on: every consultation
      // goes through `limitersFor`, so the map entry is both the single source
      // of the budget and the thing whose `lastUsed` gets stamped.
      //
      // Capturing `limiters.command` into a const looks equivalent and is not:
      // the closure outlives its swept map entry, the next socket builds a
      // second budget, and every published limit silently becomes per-tab.
      check(
        "limiters are resolved per event, not captured once",
        /limitersFor\(userId\)\[kind\]\(\)/.test(h),
        "a captured closure keeps working after the idle sweep deletes its entry",
      );
      check(
        "no limiter is bound to a const at connection time",
        !/const \w+RateLimit = limiters\./.test(h),
        "that is the capture that turns a per-user budget back into a per-socket one",
      );
      check(
        "POSITIVE CONTROL: the file still consults limiters",
        (h.match(/RateLimit\(\)/g) ?? []).length > 5,
        `${(h.match(/RateLimit\(\)/g) ?? []).length} consultations — a zero would make ` +
        "both checks above pass against a file that rate-limits nothing",
      );
      check(
        "the replay envelope wins over persisted data",
        h.indexOf("...((n.data as Record<string, unknown>) ?? {})") < h.indexOf("id: n.id,"),
        "storyProgressionService writes a `category` key into metadata, so the collision is live",
      );

      // BEHAVIOURAL: the purge must not touch an unread expired row.
      const probe = await prisma.user.create({
        data: {
          username: `${tag}_purge`,
          email: `${tag}_purge@probe.local`,
          password: "p",
          homeIp: `10.3.0.${process.pid % 250}`,
        },
      });
      try {
        await prisma.notification.create({
          data: {
            userId: probe.id,
            type: "security_alert",
            title: "t",
            message: "unread and expired",
            category: "security",
            priority: "critical",
            isRead: false,
            expiresAt: new Date(Date.now() - 86_400_000),
          },
        });
        const { purgeOldNotifications } = await import("../src/utils/notify");
        await purgeOldNotifications(0);
        check(
          "an UNREAD expired notification SURVIVES the purge",
          (await prisma.notification.count({ where: { userId: probe.id } })) === 1,
          "the docstring and the call site both promise unread rows are never touched — " +
          "the expiresAt branch used to ignore that",
        );
        await prisma.notification.updateMany({
          where: { userId: probe.id },
          data: { isRead: true },
        });
        await purgeOldNotifications(0);
        check(
          "POSITIVE CONTROL: once read, it IS purged",
          (await prisma.notification.count({ where: { userId: probe.id } })) === 0,
          "otherwise the check above passes because the purge does nothing at all",
        );
      } finally {
        await prisma.notification.deleteMany({ where: { userId: probe.id } });
        await prisma.user.delete({ where: { id: probe.id } });
      }
    }

    // ── Emitters go through the chokepoint ───────────────────────────
    console.log("\nNP-6 — the per-user emitters use the chokepoint");
    {
      for (const f of ["missionService", "hackService"]) {
        const src = read(`../src/services/${f}.ts`);
        const raw = (src.match(/emit\(\s*"notification"/g) || []).length;
        check(
          `${f} has no hand-rolled notification emit left`,
          raw === 0,
          `${raw} — each one is a site where persistence would have to be added again`,
        );
        check(`${f} calls notifyUser`, /notifyUser\(/.test(src));
      }

      // Honest about the exception rather than silently excluding it.
      const epoch = read("../src/services/epochSchedulerService.ts");
      check(
        "KNOWN EXCEPTION: the world-event broadcast stays transient",
        /io\.emit\(\s*"notification"/.test(epoch),
        "a global io.emit would need one row per user for a transient announcement",
      );
    }

    // ── The client can render a replay without lying about it ────────
    console.log("\nNP-7 — the client handles a replayed notification");
    {
      const ns = read("../../client/src/services/notifications.ts");
      check(
        "add() accepts an explicit timestamp",
        /timestamp: opts\?\.timestamp \?\? new Date\(\)/.test(ns),
        "unconditional new Date() showed a three-hour-old alert as if it just fired",
      );
      check(
        "add() can be silent",
        /if \(!opts\?\.silent\)/.test(ns),
        "a 50-item backlog otherwise plays 50 overlapping alert tones",
      );
      check(
        "add() dedupes on id",
        /current\.some\(\(n\) => n\.id === newNotification\.id\)/.test(ns),
        "replay can race a live emit of the same row",
      );

      const sock = read("../../client/src/services/socket.ts");
      check(
        "the listener uses the SERVER's priority",
        /data\.priority \?\?/.test(sock),
        "re-deriving it client-side discarded it: everything non-critical became high",
      );
      check(
        "and marks replayed notifications silent",
        /silent: data\.replayed === true/.test(sock),
      );
    }
  } finally {
    for (const id of [userId, otherId]) {
      if (!id) continue;
      await prisma.notification.deleteMany({ where: { userId: id } }).catch(() => {});
      await prisma.user.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
