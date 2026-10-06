/**
 * The authoritative-state push channel.
 *
 * Orphan audit: `state:update` and `state:delta` were emitted with ZERO client
 * listeners, and `broadcastStateDelta` had zero CALLERS, so the channel was
 * dead at both ends. On every authenticate the server ran a five-way parallel
 * query batch and threw the result away, while the client's own fallback
 * (`loadInitialGameData`) called `/api/users/stats` and `/api/servers` —
 * verified 404 by curl against the running dev server, because neither route
 * is mounted. Components that needed a number ran a COMMAND to get it.
 *
 * The maintainer chose to build it out rather than delete it. That makes this
 * harness's job specific: the danger is not "does an event fire" but "do the
 * two sides agree what a path MEANS". A disagreement there does not throw —
 * it shows up as a UI that is quietly stale, which is indistinguishable from
 * the bug we started with. So the core check applies the REAL client applier
 * (shared/utils/stateDelta.ts) to the REAL server delta and compares the
 * result against the database.
 *
 * SELF-CONTAINED: creates its own user and session, and deletes them.
 *
 * Run: npx tsx scripts/verify-state-push.ts
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

function fakeIo() {
  const sent: Array<{ room: string; event: string; payload: any }> = [];
  return {
    sent,
    to(room: string) {
      return { emit: (event: string, payload: any) => sent.push({ room, event, payload }) };
    },
    emit() { /* global channel, not under test here */ },
  };
}
/** Deltas addressed to one user, in order. */
const deltasFor = (io: ReturnType<typeof fakeIo>, userId: string) =>
  io.sent.filter((s) => s.event === "state:delta" && s.room === `user:${userId}`)
    .map((s) => s.payload.delta);

async function main() {
  console.log("\n=== Authoritative state push ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const loggerMod: any = await import("../src/logger");
  const io = fakeIo();
  setupContainer(io as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const gsm = getService<any>(TOKENS.GAME_STATE_MANAGER);
  const progressRepo = getService<any>(TOKENS.PLAYER_PROGRESS_REPOSITORY);
  const shopService = getService<any>(TOKENS.SHOP_SERVICE);
  const { applyStateDelta } = await import("../../shared/utils/stateDelta");

  const tag = `__state_probe_${process.pid}`;
  let userId: string | null = null;
  let homeServerId: string | null = null;

  try {
    // ── The applier's semantics, before anything touches a socket ────
    console.log("\nSP-1 — the delta applier");
    {
      const base = { player: { credits: 100, skills: { hacking: 5 } }, inventory: [{ id: "a", n: 1 }] };

      check(
        "set walks a nested path",
        applyStateDelta(base, { path: "player.credits", value: 250 }).next.player.credits === 250,
      );
      check(
        "and does not mutate the input",
        base.player.credits === 100,
        "the store holds the old object; mutating it in place would skip Svelte's change detection",
      );
      check(
        "untouched branches keep their IDENTITY",
        applyStateDelta(base, { path: "player.credits", value: 250 }).next.inventory === base.inventory,
        "otherwise every delta re-renders every derived subscriber",
      );
      check(
        "a deep skill path resolves",
        applyStateDelta(base, { path: "player.skills.hacking", value: 42 }).next.player.skills.hacking === 42,
      );
      check(
        "push appends to an array",
        applyStateDelta(base, { path: "inventory", value: { id: "b" }, operation: "push" }).next.inventory.length === 2,
      );
      check(
        "update patches an element by id",
        applyStateDelta(base, { path: "inventory", value: { id: "a", n: 9 }, operation: "update" }).next.inventory[0].n === 9,
      );
      check(
        "remove drops an element by id",
        applyStateDelta(base, { path: "inventory", value: "a", operation: "remove" }).next.inventory.length === 0,
      );

      // The failure path is the one that matters: it drives the resync.
      check(
        "an unwalkable path reports NOT applied",
        applyStateDelta(base, { path: "player.nope.deeper", value: 1 }).applied === false,
        "silently dropping it is exactly how a UI goes stale and looks like a server bug",
      );
      check(
        "a delta before any state is NOT applied",
        applyStateDelta(null, { path: "player.credits", value: 1 }).applied === false,
        "half-building a state object from deltas would be worse than having none",
      );
      check(
        "and an unappliable delta returns the ORIGINAL object",
        applyStateDelta(base, { path: "player.nope.deeper", value: 1 }).next === base,
      );
      check(
        "push onto a non-array is refused rather than coerced",
        applyStateDelta(base, { path: "player.credits", value: 1, operation: "push" }).applied === false,
      );
    }

    // ── A real mutation produces a real delta ────────────────────────
    console.log("\nSP-2 — a credit change reaches the socket");
    const user = await prisma.user.create({
      data: {
        username: tag, email: `${tag}@probe.local`, password: "p",
        homeIp: `10.55.0.${process.pid % 250}`,
        progress: { create: { credits: 500, experience: 0, hacking: 10 } },
      },
    });
    userId = user.id;
    // createSession requires a home server (it throws otherwise), so the
    // fixture builds one rather than borrowing an existing player's.
    const home = await prisma.gameServer.create({
      data: {
        name: `${tag}_home`,
        ipAddress: `10.55.1.${process.pid % 250}`,
        type: "player_home",
        ownerId: user.id,
        isPlayerHome: true,
      },
    });
    homeServerId = home.id;
    await gsm.createSession(user.id, `socket_${process.pid}`, "127.0.0.1");
    {
      io.sent.length = 0;
      await progressRepo.addCredits(user.id, 250);

      const deltas = deltasFor(io, user.id);
      check(
        "addCredits emits a state:delta",
        deltas.length >= 1,
        `${deltas.length} — broadcastStateDelta had ZERO callers before this`,
      );
      const credit = deltas.find((d: any) => d.path === "player.credits");
      check("on the player.credits path", !!credit, credit?.path ?? deltas.map((d: any) => d.path).join(","));
      check(
        "carrying the NEW balance, not the increment",
        credit?.value === 750,
        `${credit?.value} (500 + 250)`,
      );
    }

    // ── The round trip — the check this harness exists for ───────────
    console.log("\nSP-3 — server delta + client applier = the database");
    {
      io.sent.length = 0;
      await gsm.broadcastStateUpdate(user.id);
      const full = io.sent.find((s) => s.event === "state:update")?.payload?.fullState;
      check(
        "a full state is pushed",
        !!full?.player,
        "this ran on every login and was discarded — nothing listened",
      );
      check("with the current balance", full?.player?.credits === 750, `${full?.player?.credits}`);

      io.sent.length = 0;
      await progressRepo.spendCredits(user.id, 100);
      await progressRepo.addSkill(user.id, "hacking", 7);

      // Apply the server's own deltas with the client's own applier.
      let clientState = full;
      let allApplied = true;
      for (const d of deltasFor(io, user.id)) {
        const r = applyStateDelta(clientState, d);
        if (!r.applied) allApplied = false;
        clientState = r.next;
      }
      // NOTE, learned from this harness's own negative control: `applied` is
      // NOT sufficient. Renaming the server path to `player.skill_hacking`
      // still walks `player` and sets a leaf, so every delta reported applied
      // while the value landed somewhere nothing reads — client=10, db=17, no
      // error anywhere. Only the comparison against the database below catches
      // it, which is why that is the check this file exists for.
      check("every delta the server sent is applicable", allApplied, "necessary, but not sufficient — see the note above");

      const row = await prisma.playerProgress.findUnique({ where: { userId: user.id } });
      check(
        "credits agree with the database",
        clientState.player.credits === row?.credits,
        `client=${clientState.player.credits} db=${row?.credits}`,
      );
      check(
        "skills agree with the database",
        clientState.player.skills.hacking === row?.hacking,
        `client=${clientState.player.skills.hacking} db=${row?.hacking} — the path is player.skills.<name>, and the two sides having different ideas of that path is the whole risk`,
      );
    }

    // ── Transactions must not announce uncommitted values ────────────
    console.log("\nSP-4 — a rolled-back transaction announces nothing");
    {
      io.sent.length = 0;
      const before = (await prisma.playerProgress.findUnique({ where: { userId: user.id } }))?.credits;
      await prisma.$transaction(async (tx) => {
        await progressRepo.addCredits(user.id, 9999, tx);
        throw new Error("probe rollback");
      }).catch(() => {});

      check(
        "the rollback left the balance alone",
        (await prisma.playerProgress.findUnique({ where: { userId: user.id } }))?.credits === before,
        "PRECONDITION",
      );
      check(
        "and NO delta was broadcast",
        deltasFor(io, user.id).length === 0,
        "the tx path reads through the same transaction, so it observes uncommitted state — " +
        "announcing it would push a balance that never existed",
      );
    }

    // ── The dead shop bus now drives something ───────────────────────
    console.log("\nSP-5 — shopService's five orphan events are subscribed");
    {
      io.sent.length = 0;
      shopService.emit("purchase:complete", { userId: user.id, itemId: "x", quantity: 1 });
      await new Promise((r) => setTimeout(r, 150));

      const inv = deltasFor(io, user.id).find((d: any) => d.path === "inventory");
      check(
        "a purchase refreshes the inventory slice",
        !!inv,
        "these five events had NO subscribers anywhere — the emit calls went nowhere",
      );
      check("and the slice is an array", Array.isArray(inv?.value), typeof inv?.value);

      io.sent.length = 0;
      shopService.emit("purchase:complete", { itemId: "x" });
      await new Promise((r) => setTimeout(r, 100));
      check(
        "an event with no userId is ignored, not broadcast",
        io.sent.length === 0,
        `${io.sent.length}`,
      );
    }

    // ── Nothing is pushed to a player who is not connected ───────────
    console.log("\nSP-6 — no session, no push");
    {
      await gsm.destroySession(user.id);
      io.sent.length = 0;
      await progressRepo.addCredits(user.id, 5);
      check(
        "a sessionless player gets no delta",
        deltasFor(io, user.id).length === 0,
        "broadcastStateDelta returns early without a session; bounds the emitter from the other side",
      );
    }

    // ── The check that the first version of this harness lacked ──────
    console.log("\nSP-9 — a PURCHASE moves the client's credit balance");
    {
      // WHY THIS EXISTS. SP-4 proved the transaction guard suppresses an
      // announcement, and passed. It never asked whether a purchase still
      // updates credits — and it did not: both money paths run under `tx`, so
      // `announce` correctly stayed silent, and the shop bridge only refreshed
      // `inventory`. Five of eight review angles found it; this harness found
      // none of it, because it tested the MECHANISM and not the OUTCOME.
      // SP-6 destroyed the session deliberately, and basic_tap gates on
      // level 4 / networking 20. Rebuild both, or this section fails for
      // reasons that have nothing to do with credit deltas.
      await gsm.createSession(user.id, `socket_${process.pid}b`, "127.0.0.1");
      await prisma.playerProgress.update({
        where: { userId: user.id },
        data: { credits: 50_000, level: 30, networking: 80, cryptography: 80 },
      });
      io.sent.length = 0;
      await gsm.broadcastStateUpdate(user.id);
      let clientState = io.sent.find((s) => s.event === "state:update")?.payload?.fullState;
      const before = clientState?.player?.credits;
      check("PRECONDITION: the client sees the starting balance", before === 50_000, `${before}`);

      io.sent.length = 0;
      const buy = await shopService.purchaseItem(user.id, "basic_tap", 1);
      check("PRECONDITION: the purchase succeeds", buy?.success === true, buy?.message ?? "");

      // The bridge debounces, so give it the beat it asks for.
      await new Promise((r) => setTimeout(r, 250));

      let applied = 0;
      for (const d of deltasFor(io, user.id)) {
        const r = applyStateDelta(clientState, d);
        if (r.applied) applied++;
        clientState = r.next;
      }
      check("deltas arrived and applied", applied > 0, `${applied}`);

      const row = await prisma.playerProgress.findUnique({ where: { userId: user.id } });
      check(
        "THE CLIENT'S CREDITS CHANGED",
        clientState.player.credits !== before,
        `${before} -> ${clientState.player.credits} — ShopDialog dropped its own re-poll on the claim that this happens`,
      );
      check(
        "and they agree with the database",
        clientState.player.credits === row?.credits,
        `client=${clientState.player.credits} db=${row?.credits}`,
      );

      // The inventory slice must keep the shape the full state uses.
      const invDelta = deltasFor(io, user.id).find((d: any) => d.path === "inventory");
      check(
        "the inventory delta uses the SAME shape as state:update",
        Array.isArray(invDelta?.value) &&
          (invDelta.value.length === 0 ||
            ("id" in invDelta.value[0] && "name" in invDelta.value[0])),
        "the raw rows carry {itemId, item} and would silently replace {id, name} mid-session",
      );
      check(
        "and the tap is in it",
        Array.isArray(invDelta?.value) && invDelta.value.some((i: any) => i.id === "basic_tap"),
      );

      // Debounce: one logical purchase must not issue the refresh twice.
      const invCount = deltasFor(io, user.id).filter((d: any) => d.path === "inventory").length;
      check(
        "the refresh is coalesced, not run per event",
        invCount === 1,
        `${invCount} inventory deltas — a purchase emits purchase:complete AND item:added`,
      );
    }

    // ── use <tap> must not eat the item ──────────────────────────────
    console.log("\nSP-10 — `use` refuses a tap instead of destroying it");
    {
      const held = await prisma.inventoryItem.count({
        where: { userId: user.id, shopItemId: "basic_tap" },
      });
      check("PRECONDITION: the player holds a tap", held === 1, `${held}`);

      const used = await shopService.useItem(user.id, "basic_tap");
      check(
        "the command is refused",
        used?.success === false,
        `${used?.message} — useItem deletes any isConsumable item and returns success`,
      );
      check("and points at the right command", /tap </.test(used?.message ?? ""), used?.message);
      check(
        "THE ITEM SURVIVES",
        (await prisma.inventoryItem.count({ where: { userId: user.id, shopItemId: "basic_tap" } })) === 1,
        "an 18000-credit quantum_tap was destroyed by the most natural verb",
      );
    }

    // ── The fifth slice ──────────────────────────────────────────────
    console.log("\nSP-11 — a mission change pushes a delta");
    {
      // `missions` was one of two slices that only arrived in the login
      // snapshot, while the client already exported a `playerMissions` derived
      // store — the exact trap ShopDialog fell into with credits.
      const missionRepo = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);
      io.sent.length = 0;
      await gsm.broadcastStateUpdate(user.id);
      let clientState = io.sent.find((s) => s.event === "state:update")?.payload?.fullState;
      check("PRECONDITION: a full state is available", !!clientState, "");

      const mission = await prisma.mission.findFirst({ select: { id: true } });
      check("PRECONDITION: a mission template exists", !!mission, "seeded catalog");

      if (mission) {
        io.sent.length = 0;
        await missionRepo.put(user.id, mission.id, {
          missionId: mission.id,
          status: "active",
          startedAt: new Date(),
          objectives: [],
        });
        await new Promise((r) => setTimeout(r, 250));

        const missionDelta = deltasFor(io, user.id).find((d: any) => d.path === "missions");
        check(
          "accepting a mission emits a missions delta",
          !!missionDelta,
          "PlayerMissionRepository is the sole owner of mission state; one subscription covers " +
          "missionService, tutorialService, storyMissionService and missionGenerator alike",
        );
        check("and it is an array", Array.isArray(missionDelta?.value), typeof missionDelta?.value);
        check(
          "using the SAME shape as state:update",
          Array.isArray(missionDelta?.value) &&
            (missionDelta.value.length === 0 || "id" in missionDelta.value[0]),
          "two producers for one path is what broke the inventory slice",
        );

        const r = applyStateDelta(clientState, missionDelta);
        check("the client can apply it", r.applied === true);

        await prisma.playerMission.deleteMany({ where: { userId: user.id, missionId: mission.id } });
      }
    }

    // ── The delta channel can express more than `set` ────────────────
    console.log("\nSP-12 — operation is a parameter, not a constant");
    {
      const gsmSrc = read("../src/services/gameStateManager.ts");
      check(
        "broadcastStateDelta takes an operation",
        /operation: StateDelta\["operation"\] = "set"/.test(gsmSrc),
        "it was hardcoded to `set`, leaving push/remove/update implemented, declared in the " +
        "wire contract, and unreachable — bug shape #4",
      );
      check(
        "and passes it through rather than overwriting it",
        /const delta: StateDelta = \{ path, value, operation \};/.test(gsmSrc),
      );
    }

    // ── Both ends are actually wired ─────────────────────────────────
    console.log("\nSP-7 — the wiring, end to end");
    {
      const sock = read("../../client/src/services/socket.ts");
      check(
        "the client listens for state:update",
        /this\.on\("state:update"/.test(sock),
        "zero listeners before this; the login batch was computed and discarded",
      );
      check("and for state:delta", /this\.on\("state:delta"/.test(sock));
      check(
        "an unappliable delta triggers a resync",
        /if \(missed\) this\.requestStateResync\(\)/.test(sock),
        "dropping it silently is how the view drifts without any error",
      );
      check(
        "and the resync is THROTTLED",
        /now - this\.lastResyncAt < 5000/.test(sock),
        "the trigger repeats for every subsequent delta — unthrottled it is a self-inflicted request storm",
      );

      const handlers = read("../src/sockets/handlers.ts");
      check(
        "the server answers state:request",
        /socket\.on\("state:request"/.test(handlers) && /broadcastStateUpdate/.test(handlers),
      );
      check(
        "rate-limited on the server too",
        /socket\.on\("state:request"[\s\S]{0,160}?generalRateLimit\(\)/.test(handlers),
        "client-side throttling protects a cooperative client only",
      );

      const gs = read("../../client/src/stores/gameState.ts");
      check(
        "the 404 REST calls are gone",
        !/getUserStats\(\)/.test(gs) && !/getKnownServers\(\)/.test(gs),
        "both returned 404 and both swallowed it, so the failure was completely silent",
      );

      const shop = read("../../client/src/components/ShopDialog.svelte");
      check(
        "ShopDialog no longer polls `status` on open",
        !/loadPlayerData/.test(shop),
        "it re-ran a COMMAND on every open to work around having no push channel",
      );
      check(
        "it subscribes to the pushed store instead",
        /playerCredits as storeCredits/.test(shop) && /\$: playerCredits = \$storeCredits/.test(shop),
      );

      const repo = read("../src/repositories/playerProgressRepository.ts");
      check(
        "the repository announces but does not emit sockets",
        /this\.emit\("progress:changed"/.test(repo) && !/socket/i.test(repo),
        "its own docstring says it deliberately does no I/O beyond the database — an in-process event keeps that true",
      );
      check(
        "and suppresses the announcement inside a transaction",
        /if \(tx\) return;/.test(repo),
      );
    }
  } finally {
    if (userId) {
      await gsm.destroySession(userId).catch(() => {});
      await prisma.user.delete({ where: { id: userId } });
    }
    if (homeServerId) {
      await prisma.gameServer.delete({ where: { id: homeServerId } });
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
