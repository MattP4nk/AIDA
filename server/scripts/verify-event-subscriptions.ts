/**
 * Event subscriptions + the delivery layer they depend on.
 *
 * Orphan audit: the audit filed this as "event subscriptions are dead on both
 * ends". Reading the code found something larger — NO GameEvent had ever
 * reached a player, in either direction:
 *
 *   - 3 writers (hackService.sendSecurityAlert, fileService honeypot x2) called
 *     `prisma.gameEvent.create` DIRECTLY, skipping createEvent and therefore
 *     broadcastEvent. 30 of the 34 rows in the dev database are theirs.
 *   - 2 producers that DID broadcast (storyProgression's weight>=7 beats, all
 *     four createSystemAlert callers) are global with `affectedUsers: []`, and
 *     the global branch of getEventRecipients was a stub whose body added
 *     exactly the affectedUsers the next line already added. Empty in, empty
 *     out.
 *   - Subscriptions were the only other way to become a recipient, and had no
 *     acquisition path: no /api/events route is mounted, no socket handler, no
 *     command, no item. 0 rows.
 *   - Even a delivered event died at the client: two `game:event` listeners
 *     with incompatible payloads, a `gameEvents` store with no consumer, an
 *     empty `game:event:public` stub, and `showNotification` — 12 call sites —
 *     was an EMPTY METHOD.
 *
 * The maintainer chose a shop item as the acquisition path, with quality
 * tiering the item. So this harness has to prove two different things: that
 * the delivery layer works at all, and that a tap actually buys reach.
 *
 * SELF-CONTAINED: creates its own users, faction, server and subscriptions,
 * and deletes them.
 *
 * Run: npx tsx scripts/verify-event-subscriptions.ts
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

/** Captures both channels so delivery is asserted, never assumed. */
function fakeIo() {
  const direct: Array<{ room: string; event: string; payload: any }> = [];
  const broadcast: Array<{ event: string; payload: any }> = [];
  return {
    direct,
    broadcast,
    // `notifyUser` reads this to decide whether a delivery counts as seen.
    // Empty here: no probe socket is connected, so nothing is marked read and
    // the rows stay replayable, which is what this harness asserts on.
    sockets: { adapter: { rooms: new Map<string, Set<string>>() } },
    to(room: string) {
      return { emit: (event: string, payload: any) => direct.push({ room, event, payload }) };
    },
    emit(event: string, payload: any) { broadcast.push({ event, payload }); },
  };
}

async function main() {
  console.log("\n=== Event subscriptions ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const loggerMod: any = await import("../src/logger");
  const io = fakeIo();
  setupContainer(io as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const events = getService<any>(TOKENS.EVENT_SERVICE);
  const { interceptChance } = await import("../src/utils/eventIntercept");
  const { EventType, EventSeverity } = await import("../../shared/types");
  const { TAP_ALL_EVENTS, TAP_ITEMS, MAX_ACTIVE_TAPS } = await import("../src/config/gameBalance");

  const tag = `__tap_probe_${process.pid}`;
  const created: { users: string[]; servers: string[]; events: string[] } =
    { users: [], servers: [], events: [] };

  /** Every event this run creates, so cleanup can delete BY ID.
   *  A title+time filter would take real rows the dev server wrote meanwhile. */
  const track = async (p: Promise<any>) => {
    const ev = await p;
    if (ev?.id) created.events.push(ev.id);
    return ev;
  };

  try {
    const watcher = await prisma.user.create({
      data: { username: tag, email: `${tag}@probe.local`, password: "p", homeIp: `10.7.0.${process.pid % 250}` },
    });
    const victim = await prisma.user.create({
      data: { username: `${tag}_v`, email: `${tag}_v@probe.local`, password: "p", homeIp: `10.8.0.${process.pid % 250}` },
    });
    const bystander = await prisma.user.create({
      data: { username: `${tag}_b`, email: `${tag}_b@probe.local`, password: "p", homeIp: `10.9.0.${process.pid % 250}` },
    });
    created.users.push(watcher.id, victim.id, bystander.id);

    const server = await prisma.gameServer.create({
      data: {
        name: `${tag}_srv`,
        ipAddress: `10.77.0.${process.pid % 250}`,
        type: "corporate",
        ownerId: victim.id,
      },
    });
    created.servers.push(server.id);

    // ── The quality dial, before anything touches the database ───────
    console.log("\nES-1 — quality is a real dial (it used to be almost inert)");
    {
      check(
        "a cheap tap still hears CRITICAL",
        interceptChance(TAP_ITEMS.basic_tap.quality, "critical") === 1,
        "the loud events are deterministic at every tier, so a breach is never silently dropped",
      );
      check(
        "but misses most INFO",
        interceptChance(TAP_ITEMS.basic_tap.quality, "info") < 0.5,
        `${interceptChance(30, "info")}`,
      );
      check(
        "the top tier hears nearly everything",
        interceptChance(TAP_ITEMS.quantum_tap.quality, "info") >= 0.9,
        `${interceptChance(90, "info")}`,
      );
      check(
        "monotonic in quality",
        [30, 60, 90].every((q, i, a) =>
          i === 0 || interceptChance(q, "info") >= interceptChance(a[i - 1]!, "info")),
        "a more expensive tap must never be worse",
      );
      check(
        "the tiers are DISTINGUISHABLE for warnings",
        interceptChance(30, "warning") !== interceptChance(90, "warning"),
        "the old rule fired only for INFO below quality 30, so 30 and 100 behaved identically",
      );
      check(
        "quality 0 hears nothing",
        interceptChance(0, "critical") === 0,
        "bounds the dial from the other side",
      );
      check(
        "an unknown severity is treated as the QUIETEST case",
        interceptChance(50, "not-a-severity") < 1,
        "defaulting to always-deliver would make an unrecognised event the easiest to intercept",
      );
      check(
        "out-of-range quality is clamped, not trusted",
        interceptChance(10_000, "info") === 1 && interceptChance(-5, "critical") === 0,
      );
    }

    // ── Targeted delivery works at all ───────────────────────────────
    console.log("\nES-2 — a targeted event reaches the user it names");
    {
      io.direct.length = 0; io.broadcast.length = 0;
      const before = await prisma.notification.count({ where: { userId: victim.id } });

      await track(events.createEvent(
        EventType.HONEYPOT_TRIGGERED,
        "Honeypot Alert",
        "Intruder accessed decoy file 'payroll.db'.",
        { serverId: server.id, attackerId: watcher.id },
        EventSeverity.WARNING,
        [victim.id],
        false,
      ));

      check(
        "the named user is notified",
        io.direct.some((d) => d.room === `player:${victim.id}` && d.event === "notification"),
        io.direct.map((d) => `${d.event}@${d.room}`).join(", ") || "(nothing)",
      );
      check(
        "and it PERSISTS, so a reload does not lose it",
        (await prisma.notification.count({ where: { userId: victim.id } })) === before + 1,
        "targeted events go through notifyUser; they used to be a bare emit into a store with no consumer",
      );
      check(
        "a targeted event is NOT announced to everyone",
        io.broadcast.length === 0,
        `${io.broadcast.length} global emits — the public channel used to fire for EVERY event, ` +
        "so a breach or a tripped honeypot told every connected player",
      );
    }

    // ── Global delivery works, and stays transient ───────────────────
    console.log("\nES-3 — a global event reaches everyone, without a row each");
    {
      io.direct.length = 0; io.broadcast.length = 0;
      const notifsBefore = await prisma.notification.count();

      await track(events.createSystemAlert("World Event", "The net trembles.", EventSeverity.CRITICAL));

      check(
        "it goes out on the public channel",
        io.broadcast.some((b) => b.event === "game:event:public"),
        io.broadcast.map((b) => b.event).join(", ") || "(nothing) — global events reached NOBODY before this",
      );
      const payload = io.broadcast.find((b) => b.event === "game:event:public")?.payload;
      check(
        "carrying the description",
        !!payload?.description,
        "the old 4-field payload dropped description and metadata — the one channel that reached people carried the least",
      );
      check(
        "and no per-user rows are written for a broadcast",
        (await prisma.notification.count()) === notifsBefore,
        "matches the rule notifyUser set: global is transient, targeted persists",
      );
    }

    // ── A tap buys reach it did not have ─────────────────────────────
    console.log("\nES-4 — a tap makes a third party a recipient");
    {
      // PRECONDITION: without a tap, the bystander hears nothing.
      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HACK_DETECTED, "Breach", "Intrusion detected.",
        { serverId: server.id }, EventSeverity.CRITICAL, [victim.id], false,
      ));
      check(
        "PRECONDITION: an untapped bystander is not a recipient",
        !io.direct.some((d) => d.room === `player:${bystander.id}`),
        "otherwise the next check passes for the wrong reason",
      );

      await events.createSubscription(
        bystander.id, TAP_ALL_EVENTS, "bug", server.id,
        TAP_ITEMS.quantum_tap.quality, TAP_ITEMS.quantum_tap.durationMinutes,
      );

      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HACK_DETECTED, "Breach", "Intrusion detected.",
        { serverId: server.id }, EventSeverity.CRITICAL, [victim.id], false,
      ));
      check(
        "the tapper now receives the target's event",
        io.direct.some((d) => d.room === `player:${bystander.id}`),
        "createSubscription had zero callers and no way to reach it",
      );
      check(
        "and the original recipient still does",
        io.direct.some((d) => d.room === `player:${victim.id}`),
        "a tap must add a recipient, never replace one",
      );

      // The tap is TARGETED: an event about something else must not leak.
      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HACK_DETECTED, "Elsewhere", "Different server.",
        { serverId: "some-other-server-id" }, EventSeverity.CRITICAL, [victim.id], false,
      ));
      check(
        "a tap on server A does not deliver events about server B",
        !io.direct.some((d) => d.room === `player:${bystander.id}`),
        "the targetId match is the whole point of a targeted tap",
      );
    }

    // ── The wildcard, and the guards around it ───────────────────────
    console.log("\nES-5 — subscription bookkeeping");
    {
      const subs = events.getUserSubscriptions(bystander.id);
      check("the tap is listed for its owner", subs.length === 1, `${subs.length}`);
      check(
        "it is a wildcard, so one tap covers the target's events",
        subs[0]?.eventType === TAP_ALL_EVENTS,
        "requiring a type per tap would mean one row per EventType for one item",
      );
      check(
        "another player does not see it",
        events.getUserSubscriptions(watcher.id).length === 0,
      );

      // Re-tapping the same target must not leak rows.
      const rowsBefore = await prisma.eventSubscription.count({
        where: { userId: bystander.id, isActive: true },
      });
      await events.createSubscription(
        bystander.id, TAP_ALL_EVENTS, "bug", server.id, 60, 60,
      );
      check(
        "re-tapping the same target replaces rather than accumulates",
        (await prisma.eventSubscription.count({ where: { userId: bystander.id, isActive: true } })) === rowsBefore,
        "the Map collapses duplicates at startup, so this leaked invisibly",
      );

      // Quality must be clamped in the ROW, not just in memory.
      await events.createSubscription(watcher.id, TAP_ALL_EVENTS, "bug", server.id, 5000, 60);
      const row = await prisma.eventSubscription.findFirst({
        where: { userId: watcher.id, isActive: true }, orderBy: { createdAt: "desc" },
      });
      check(
        "quality is clamped in the persisted row too",
        (row?.quality ?? 999) <= 100,
        `${row?.quality} — the row was written unclamped while the in-memory copy was clamped, ` +
        "so a restart resurrected an uncapped tap",
      );

      // The cap.
      let capped = false;
      try {
        for (let i = 0; i < MAX_ACTIVE_TAPS + 2; i++) {
          await events.createSubscription(
            bystander.id, TAP_ALL_EVENTS, "bug", `probe-target-${i}`, 30, 60,
          );
        }
      } catch { capped = true; }
      check(
        `no more than ${MAX_ACTIVE_TAPS} taps at once`,
        capped && events.getUserSubscriptions(bystander.id).length <= MAX_ACTIVE_TAPS,
        `${events.getUserSubscriptions(bystander.id).length} active — getEventRecipients walks this map on every event`,
      );

      const removed = await events.removeSubscription(bystander.id, TAP_ALL_EVENTS, server.id);
      check("a tap can be pulled", removed === true, String(removed));
      check(
        "and stops delivering",
        !events.getUserSubscriptions(bystander.id).some((s: any) => s.targetId === server.id),
      );
    }

    // ── Expiry ───────────────────────────────────────────────────────
    console.log("\nES-6 — an expired tap stops working");
    {
      await events.createSubscription(watcher.id, TAP_ALL_EVENTS, "bug", server.id, 90, 60);
      const subs = events.getUserSubscriptions(watcher.id);
      const live = subs.find((s: any) => s.targetId === server.id);
      check("PRECONDITION: the tap is live", !!live);

      live.expiresAt = new Date(Date.now() - 1000); // wind it past its end

      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HACK_DETECTED, "Breach", "After expiry.",
        { serverId: server.id }, EventSeverity.CRITICAL, [victim.id], false,
      ));
      check(
        "an expired tap delivers nothing",
        !io.direct.some((d) => d.room === `player:${watcher.id}`),
        "taps are timed; this is what the player paid for rather than a permanent unlock",
      );
      check(
        "and the sweep reclaims it",
        events.cleanupExpiredSubscriptions() >= 1,
      );
    }

    // ── The short-circuit that voided two of three target kinds ──────
    console.log("\nES-9 — a tap matches on ANY target field, not just the first");
    {
      // The matcher was `metadata.serverId || metadata.factionId ||
      // metadata.targetUserId`. Nearly every live event carries a serverId, so
      // the chain always resolved to it and a player or faction tap could
      // never equal it. ES-4 above only ever tested a SERVER tap, which is why
      // 45 green checks said nothing about this.
      const other = await prisma.user.findFirst({
        where: { id: { notIn: [watcher.id, victim.id, bystander.id] } },
        select: { id: true },
      });

      await events.createSubscription(watcher.id, TAP_ALL_EVENTS, "bug", victim.id, 90, 60);
      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HACK_DETECTED, "Breach", "Targeted at a player.",
        // serverId FIRST in the object, exactly as the live producers build it.
        { serverId: server.id, targetUserId: victim.id },
        EventSeverity.CRITICAL, [], false,
      ));
      check(
        "a PLAYER tap delivers even when the event also names a server",
        io.direct.some((d) => d.room === `player:${watcher.id}`),
        "the old short-circuit stopped at serverId and never compared the user id",
      );

      // And it must still be targeted, not a firehose.
      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HACK_DETECTED, "Elsewhere", "About someone else.",
        { serverId: server.id, targetUserId: other?.id ?? "nobody" },
        EventSeverity.CRITICAL, [], false,
      ));
      check(
        "and does NOT deliver events about a different player",
        !io.direct.some((d) => d.room === `player:${watcher.id}`),
        "matching any candidate must not degrade into matching everything",
      );

      check(
        "the aggressor's id is NOT a match candidate",
        !read("../src/services/eventService.ts").includes("metadata.attackerId"),
        "a tap watches what happens TO a target; matching attackerId would let it shadow their offensive moves",
      );

      await events.removeSubscription(watcher.id, TAP_ALL_EVENTS, victim.id);

      // KNOWN GAP, stated loudly rather than left for someone to discover.
      // GAP NOW CLOSED (2026-09-25). This used to assert that no live
      // producer keyed an event to a player, which was true and was the reason
      // a player tap delivered nothing. Both producers now name their subject.
      check(
        "the honeypot names its victim, so a player tap has something to match",
        /targetUserId: ownerId/.test(read("../src/services/fileService.ts")),
        "the only targeted producer; without this a player tap matched nothing in practice",
      );
      check(
        "a declared war raises a faction event, so a faction tap does too",
        /createFactionWarEvent\(/.test(read("../src/services/architectInterventionExecutor.ts")),
        "createFactionWarEvent was a dead factory and factionId appeared in no live metadata",
      );

      // ── And the tapper must not be handed identities ───────────────
      await events.createSubscription(bystander.id, TAP_ALL_EVENTS, "bug", server.id, 90, 60);
      io.direct.length = 0;
      await track(events.createEvent(
        EventType.HONEYPOT_TRIGGERED, "Honeypot Alert", "Decoy read.",
        { serverId: server.id, targetUserId: victim.id, attackerId: watcher.id, fileName: "payroll.db" },
        EventSeverity.WARNING, [victim.id], false,
      ));

      const toOwner = io.direct.find((d) => d.room === `player:${victim.id}`);
      const toTapper = io.direct.find((d) => d.room === `player:${bystander.id}`);
      check("the named owner is notified", !!toOwner);
      check("and so is the tapper", !!toTapper, "otherwise the redaction check below is vacuous");
      check(
        "the OWNER sees the intruder's id",
        JSON.stringify(toOwner?.payload).includes(watcher.id),
        "it is their server; they are entitled to the full record",
      );
      check(
        "the TAPPER does NOT",
        !JSON.stringify(toTapper?.payload).includes(watcher.id),
        "a tap must not be a cheaper deanonymiser than the 10000-credit alias reveal",
      );
      check(
        "but the tapper still learns the honeypot fired",
        typeof toTapper?.payload?.message === "string" && toTapper.payload.message.length > 0,
        "scrubbing the whole payload would make the tap worthless again",
      );
      check(
        "the tapper gets a SUMMARY, not the record's own text",
        toTapper?.payload?.message !== toOwner?.payload?.message &&
          toTapper?.payload?.title !== toOwner?.payload?.title,
        "the decoy filename lives in `description`, so scrubbing only `data` left it in the prose",
      );
      check(
        "and the decoy FILENAME never reaches the tapper",
        !JSON.stringify(toTapper?.payload).includes("payroll.db"),
        "enumerating a victim's decoys from their own alarm system was the whole exploit",
      );
      await events.removeSubscription(bystander.id, TAP_ALL_EVENTS, server.id);
    }

    // ── Access control on the tap ────────────────────────────────────
    console.log("\nES-10 — a tap only reaches targets you have found");
    {
      const { getService: gs2 } = await import("../src/di/container");
      const processor = gs2<any>(TOKENS.COMMAND_PROCESSOR);
      void processor;

      const net = read("../src/services/commandModules/networkCommands.ts");
      // A4 moved the rule into networkTopologyService.playerKnowsServer, so
      // it is tested BEHAVIOURALLY here, against fixtures; only the call
      // sites stay structural (labelled).
      const topo = gs2<any>(TOKENS.NETWORK_TOPOLOGY_SERVICE);
      check("ownership counts as knowing", (await topo.playerKnowsServer(victim.id, server.id)) === true);
      check(
        "server targets are gated on discovery",
        (await topo.playerKnowsServer(watcher.id, server.id)) === false,
        "a bare findFirst on ipAddress let anyone tap any home server they had never scanned",
      );
      const other = await prisma.gameServer.create({
        data: { name: `${tag}_srv2`, ipAddress: `10.79.0.${process.pid % 250}`, type: "corporate" },
      });
      created.servers.push(other.id); // links and discoveries cascade from it
      const link = await prisma.serverLink.create({ data: { sourceId: other.id, targetId: server.id } });
      await prisma.discoveredLink.create({ data: { userId: watcher.id, linkId: link.id, source: "scan" } });
      check(
        "discovery means a DiscoveredLink, the same notion netmap uses",
        (await topo.playerKnowsServer(watcher.id, server.id)) === true,
      );
      check(
        "(structural) tap gates server targets through it",
        /topology\(\)\.playerKnowsServer\(context\.userId, server\.id, server\.ownerId\)/.test(net),
      );
      check(
        "(structural) and player targets on their home server",
        /topology\(\)\.playerKnowsServer\(context\.userId, user\.homeServerId, user\.id\)/.test(net),
        "a username from the leaderboard was otherwise enough to surveil anyone",
      );
      check(
        "factions are deliberately NOT gated",
        !/playerKnowsServer\([^)]*faction/.test(net),
        "they are public entities and their events are world news",
      );
      check(
        "'not found' and 'not discovered' give the SAME message",
        (net.match(/No known server, faction or player matching/g) || []).length === 2,
        "two different errors are an existence oracle — tap.remove costs nothing, so it " +
        "would let anyone sweep IPs to map real servers without scanning",
      );
    }

    // ── The public broadcast must not carry identifiers ──────────────
    console.log("\nES-11 — a global broadcast carries no player ids");
    {
      io.direct.length = 0; io.broadcast.length = 0;
      await track(events.createEvent(
        EventType.WORLD_EVENT,
        "[Story] Someone stole a fragment",
        "A player stole an AIDA fragment from another player.",
        { storyType: "fragment_stolen", actorId: watcher.id, actorType: "player", weight: 8, choice: "keep" },
        EventSeverity.CRITICAL,
        [],
        true,
      ));
      const payload = io.broadcast.find((b) => b.event === "game:event:public")?.payload;
      check("PRECONDITION: it was broadcast", !!payload, "otherwise the leak check is vacuous");
      check(
        "the actor's user id is NOT in the payload",
        !JSON.stringify(payload).includes(watcher.id),
        "the summaries are deliberately anonymised and the game SELLS aliases at 10000 credits — " +
        "shipping the id beside the summary handed identity out for free",
      );
      check(
        "but non-identifying metadata survives",
        payload?.metadata?.choice === "keep" && payload?.metadata?.weight === 8,
        "scrubbing everything would have made the payload useless again",
      );
      check(
        "and the description still comes through",
        !!payload?.description,
      );
    }

    // ── Concurrency, driven for real ────────────────────────────────
    console.log("\nES-12 — one item cannot be spent twice");
    {
      // BEHAVIOURAL, not structural. The previous consume was a
      // findFirst-then-write with two awaits between them, and restoring it
      // tripped no check at all — the harness only asserted which METHOD was
      // called. That is the same gap that let the whole review happen.
      const shop = getService<any>(TOKENS.SHOP_SERVICE);
      await prisma.inventoryItem.deleteMany({
        where: { userId: watcher.id, shopItemId: "basic_tap" },
      });
      await prisma.inventoryItem.create({
        data: { userId: watcher.id, shopItemId: "basic_tap", quantity: 1 },
      });

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          shop.removeItemFromInventory(watcher.id, "basic_tap", 1),
        ),
      );
      const wins = results.filter(Boolean).length;
      check(
        "exactly ONE of five concurrent consumes succeeds",
        wins === 1,
        `${wins} succeeded — five concurrent taps for one item was the exploit`,
      );

      const left = await prisma.inventoryItem.findFirst({
        where: { userId: watcher.id, shopItemId: "basic_tap" },
        select: { quantity: true },
      });
      check(
        "and the stock never goes negative",
        (left?.quantity ?? 0) >= 0,
        `${left ? left.quantity : "row deleted"}`,
      );

      await prisma.inventoryItem.deleteMany({
        where: { userId: watcher.id, shopItemId: "basic_tap" },
      });
    }

    // ── A failed re-tap must not cost the player the tap they had ────
    console.log("\nES-13 — a failed write rolls back to the PREVIOUS tap");
    {
      // The reservation that makes the cap race-free claims the Map key before
      // the awaits. Re-tapping the same (user, type, target) reuses that key,
      // so rolling back with a plain `delete` destroyed the player's existing
      // working subscription whenever the re-tap's insert failed — a database
      // blip took away a tap they had already paid for.
      await events.createSubscription(watcher.id, TAP_ALL_EVENTS, "bug", server.id, 42, 60);
      const before = events
        .getUserSubscriptions(watcher.id)
        .find((s: any) => s.targetId === server.id);
      check(
        "PRECONDITION: the player holds a tap on this target",
        before?.quality === 42,
        `quality=${before?.quality} — without it the rollback has nothing to restore`,
      );

      // The SERVICE's client, not this harness's own `new PrismaClient()`.
      // Patching the wrong instance is exactly the "assert the state the code
      // READS" trap — the first version of this did, and the insert sailed
      // through while the check reported a rollback failure.
      const { prisma: svcPrisma } = await import("../src/database/client");
      const realCreate = svcPrisma.eventSubscription.create.bind(
        svcPrisma.eventSubscription,
      );
      (svcPrisma.eventSubscription as any).create = async () => {
        throw new Error("probe: simulated insert failure");
      };
      let threw = false;
      try {
        await events.createSubscription(watcher.id, TAP_ALL_EVENTS, "bug", server.id, 99, 60);
      } catch {
        threw = true;
      } finally {
        (svcPrisma.eventSubscription as any).create = realCreate;
      }

      check(
        "the re-tap reports failure, so the caller still refunds the item",
        threw,
        "a silent success here is the free-tap bug the reservation exists to prevent",
      );
      const after = events
        .getUserSubscriptions(watcher.id)
        .find((s: any) => s.targetId === server.id);
      check(
        "and the ORIGINAL tap survives the rollback",
        after?.quality === 42,
        `quality=${after?.quality ?? "gone"} — deleting by map key took away a working ` +
        "subscription the player had already paid for",
      );

      await events.removeSubscription(watcher.id, TAP_ALL_EVENTS, server.id);
    }

    // ── The honeypot, driven end to end ──────────────────────────────
    console.log("\nES-8 — tripping a decoy actually alerts its owner");
    {
      // The fix that mattered most, so it gets a BEHAVIOURAL check rather
      // than a grep: fileService writes no socket event of any kind, so the
      // GameEvent row was the owner's only signal, and it was never broadcast.
      const home = await prisma.gameServer.create({
        data: {
          name: `${tag}_home`,
          ipAddress: `10.78.0.${process.pid % 250}`,
          type: "player_home",
          ownerId: victim.id,
          isPlayerHome: true,
        },
      });
      created.servers.push(home.id);

      // A real filesystem, not a bare node: without the root directory the
      // path never resolves and every check below would fail for a reason
      // unrelated to honeypots.
      const fileService = getService<any>(TOKENS.FILE_SERVICE);
      await fileService.initializeFileSystem(home.id, victim.id);
      const root = await prisma.fileSystemNode.findFirst({
        where: { serverId: home.id, parentId: null },
        select: { id: true },
      });
      // PermissionLevel is a numeric BITMASK (READ=1 … FULL=15), not "rwx",
      // and canReadAncestors walks up — so the root has to allow it as well
      // or the read fails before it ever reaches the decoy.
      const open = { owner: 15, faction: 15, others: 15 };
      if (root) {
        await prisma.fileSystemNode.update({ where: { id: root.id }, data: { permissions: open } });
      }
      const decoy = await prisma.fileSystemNode.create({
        data: {
          serverId: home.id,
          parentId: root?.id ?? null,
          name: "payroll.db",
          type: "file",
          content: "bait",
          permissions: open,
          metadata: { isDecoy: true },
        },
      });

      io.direct.length = 0;
      io.broadcast.length = 0;
      const notifsBefore = await prisma.notification.count({ where: { userId: victim.id } });

      const res = await fileService.readFile(home.id, watcher.id, "/payroll.db");
      check(
        "PRECONDITION: the intruder can read the decoy",
        res?.success === true,
        res?.message ?? res?.error ?? "read failed — the alert below would be vacuous",
      );
      check(
        "the owner is alerted",
        io.direct.some((d) => d.room === `player:${victim.id}` && d.event === "notification"),
        "both honeypot writers used prisma.gameEvent.create directly, so nothing was ever sent",
      );
      check(
        "and the alert survives a reload",
        (await prisma.notification.count({ where: { userId: victim.id } })) > notifsBefore,
      );
      check(
        "the intruder is NOT told they tripped it",
        !io.direct.some((d) => d.room === `player:${watcher.id}`),
        "a honeypot that announces itself to the attacker is worse than none",
      );
      check(
        "nor is it broadcast to everyone",
        io.broadcast.length === 0,
        `${io.broadcast.length} — before the isGlobal gate this told every connected player`,
      );

      // Track the event for by-id cleanup.
      const raised = await prisma.gameEvent.findFirst({
        where: { type: "honeypot_triggered", affectedUsers: { has: victim.id } },
        orderBy: { timestamp: "desc" },
        select: { id: true },
      });
      if (raised) created.events.push(raised.id);
      await prisma.fileSystemNode.delete({ where: { id: decoy.id } }).catch(() => {});
    }

    // ── The structural repairs, asserted as properties ───────────────
    console.log("\nES-7 — the delivery path that made all of this invisible");
    {
      const ev = read("../src/services/eventService.ts");
      check(
        "the stub global branch is gone",
        !/Would query for online users/.test(ev),
        "its body added exactly the affectedUsers the next line already added",
      );
      check(
        "the public emit is gated on isGlobal",
        /if \(event\.isGlobal\)[\s\S]{0,160}?game:event:public/.test(ev),
        "it used to fire for every event, targeted ones included",
      );

      const fs = read("../src/services/fileService.ts");
      check(
        "the honeypot writers no longer bypass createEvent",
        !/gameEvent\.create/.test(fs) && /alertHoneypot/.test(fs),
        "this file has no emit of any kind, so the row was the owner's ONLY signal",
      );

      const hs = ["hackService", "hackCountermeasureService", "hackScoring", "hackSessionStore"].map((f) => read(`../src/services/${f}.ts`)).join("\n");
      check(
        "KNOWN EXCEPTION: hackService keeps its direct write",
        /gameEvent\.create/.test(hs),
        "it is an audit record; notifyServerOwner is the player channel and routing both would double-notify",
      );

      const sock = read("../../client/src/services/socket.ts");
      check(
        "showNotification is no longer an empty method",
        /getNotifService\(\)[\s\S]{0,120}?ns\?\.add/.test(sock),
        "12 call sites fired into an empty body; 7 had no other notification",
      );
      check(
        "only ONE listener remains for the world feed",
        (sock.match(/this\.on\("game:event/g) || []).length === 1,
        "there were two on `game:event` with incompatible payload shapes",
      );
      check(
        "and `game:event` has no emitter or listener left anywhere",
        !/["']game:event["']/.test(sock) && !/["']game:event["']/.test(read("../src/services/keyFragmentService.ts")),
        "both producers moved: targeted to notifyUser, global to the public channel",
      );

      const shop = read("../src/services/shopService.ts");
      check(
        "the taps use `effect`, not the inert `effects`",
        /id: "basic_tap"[\s\S]{0,400}?effect: \{ tapQuality/.test(shop),
        "`effects` is the stat bag nothing applies — a tap there would sell, install and do nothing",
      );
      check(
        "all three tiers are in the catalog",
        Object.keys(TAP_ITEMS).every((id) => new RegExp(`id: "${id}"`).test(shop)),
      );

      const net = read("../src/services/commandModules/networkCommands.ts");
      // ORDER INVERTED 2026-09-25, and the old assertion encoded the old
      // design. Subscribe-first protected the item from a cap rejection but
      // left the consume as a check-then-act, so five concurrent commands
      // placed five taps for one item. Consuming first through an atomic
      // guard makes the database the arbiter; the refund is what keeps the
      // cap rejection from costing 18000 credits.
      check(
        "the tap consumes through shopService, not raw Prisma",
        /removeItemFromInventory\(/.test(net) && !/inventoryItem\.delete\(/.test(net),
        "the raw write emitted no item:removed, making it the one inventory mutation with no state:delta",
      );
      check(
        "it consumes BEFORE subscribing",
        net.indexOf("removeItemFromInventory(") < net.indexOf("createSubscription("),
        "the atomic decrement is the thing that stops concurrent commands",
      );
      // Assert the PROPERTY, not the call's formatting. The first version
      // matched a single-line `addItemToInventory(a, b, 1)` and went red the
      // moment the call was wrapped across lines to branch on its result —
      // a check that tested layout rather than behaviour.
      check(
        "and refunds if the subscription is rejected",
        /addItemToInventory\(/.test(net),
        "otherwise hitting the cap silently costs the player the item",
      );
      check(
        "branching on the RETURN VALUE, not on a rejection",
        /const refunded = await/.test(net) && /if \(!refunded\)/.test(net),
        "addItemToInventory swallows its own errors and returns false, so the earlier " +
        "`.catch(...)` could never fire — a guard that guards nothing",
      );
      check(
        "a failed refund is REPORTED, not swallowed",
        /Tap refund FAILED/.test(net),
        "a swallowed refund is a silently stolen item",
      );
      check(
        "it spends the CHEAPEST tap held",
        /TAP_ITEMS\[a\.shopItemId[\s\S]{0,120}?TAP_ITEMS\[b\.shopItemId/.test(net),
        "burning an 18000-credit quantum tap because it sorted first is a silent loss",
      );
    }
  } finally {
    await prisma.eventSubscription.deleteMany({ where: { userId: { in: created.users } } });
    await prisma.notification.deleteMany({ where: { userId: { in: created.users } } });
    for (const id of created.servers) {
      await prisma.gameServer.delete({ where: { id } });
    }
    for (const id of created.users) {
      await prisma.user.delete({ where: { id } });
    }
    // BY ID. A title+timestamp filter would have deleted whatever the running
    // dev server happened to write in the same window.
    await prisma.gameEvent.deleteMany({ where: { id: { in: created.events } } });
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
