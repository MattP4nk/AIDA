/**
 * A slow state refresh must not overwrite a newer one.
 *
 * REVIEW #2 (angle D): `scheduleSliceRefresh` removes its timer entry at the
 * START of the callback and fires `void this.refreshStateSlices(...)` without
 * awaiting, so any event arriving during the async database work immediately
 * arms a second timer. Both flushes push WHOLE-SLICE `set` deltas with no
 * sequence number, and `applyStateDelta` is unconditionally last-write-wins.
 *
 * So a slow flush that started first can land last and overwrite a newer one.
 * The client is then permanently wrong — `applied` is true for both, so no
 * resync is requested — until an unrelated change or a reconnect.
 *
 * THE TIMING IS FORCED, not hoped for: the first flush's inventory query is
 * stubbed to take 300ms while the second returns immediately. Without that
 * this test would pass or fail on machine speed, which is worse than no test.
 *
 * WRITTEN BEFORE THE FIX and confirmed red.
 *
 * SELF-CONTAINED: creates its own user, home server and session.
 *
 * Run: npx tsx scripts/verify-slice-refresh-order.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeIo() {
  const sent: Array<{ room: string; event: string; payload: any }> = [];
  return {
    sent,
    to(room: string) {
      return { emit: (event: string, payload: any) => sent.push({ room, event, payload }) };
    },
    emit() { /* global channel unused here */ },
  };
}

async function main() {
  console.log("\n=== State-slice refresh ordering ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const loggerMod: any = await import("../src/logger");
  const io = fakeIo();
  setupContainer(io as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const gsm = getService<any>(TOKENS.GAME_STATE_MANAGER);
  const shop = getService<any>(TOKENS.SHOP_SERVICE);

  const tag = `__slice_probe_${process.pid}`;
  let userId: string | null = null;
  let homeId: string | null = null;

  /** The last value the server pushed for a given delta path. */
  const lastDelta = (path: string) => {
    const deltas = io.sent
      .filter((s) => s.event === "state:delta" && s.payload?.delta?.path === path)
      .map((s) => s.payload.delta.value);
    return deltas.length ? deltas[deltas.length - 1] : undefined;
  };
  const lastCredits = () => lastDelta("player.credits");

  const realGetInventory = shop.getPlayerInventory.bind(shop);
  let slowNextCall = false;

  /**
   * A row shaped the way `toStateInventory` expects, tagged so the harness can
   * tell WHICH flush produced the surviving push.
   *
   * The first version of this test tried to invert `player.credits` and passed
   * against the buggy code: `refreshStateSlices` reads inventory BEFORE
   * credits, so stalling the inventory query delays the credits read past the
   * update rather than before it, and the stale value is never observed. A
   * test that cannot fail is worse than none — this one targets the slice
   * whose query the harness actually controls.
   */
  const row = (label: string) => [{
    itemId: label,
    quantity: 1,
    item: { name: label, category: "TOOL", description: label, effects: {} },
  }];

  try {
    const user = await prisma.user.create({
      data: {
        username: tag,
        email: `${tag}@probe.local`,
        password: "p",
        homeIp: `10.71.0.${process.pid % 250}`,
        progress: { create: { credits: 1000 } },
      },
    });
    userId = user.id;
    const home = await prisma.gameServer.create({
      data: {
        name: `${tag}_home`,
        ipAddress: `10.72.0.${process.pid % 250}`,
        type: "player_home",
        ownerId: user.id,
        isPlayerHome: true,
      },
    });
    homeId = home.id;
    await gsm.createSession(user.id, `socket_${process.pid}`, "127.0.0.1");

    // Force the inversion: the FIRST flush is slow and returns the OLD state;
    // every later call is instant and returns the NEW state.
    shop.getPlayerInventory = async (_uid: string) => {
      if (slowNextCall) {
        slowNextCall = false;
        await sleep(300);
        return row("STALE") as never;
      }
      return row("FRESH") as never;
    };

    console.log("\nSR-1 — a slow flush cannot overwrite a newer one");
    {
      io.sent.length = 0;
      slowNextCall = true;

      // Flush A: begins, and stalls inside its inventory query holding STALE.
      gsm.scheduleSliceRefresh(user.id, "inventory");
      await sleep(80); // let A's debounce fire and A begin

      // Flush B: scheduled while A is still in flight, and fast.
      gsm.scheduleSliceRefresh(user.id, "inventory");
      await sleep(700); // let both settle

      const last = lastDelta("inventory") as any[] | undefined;
      check(
        "PRECONDITION: inventory deltas were pushed",
        Array.isArray(last) && last.length > 0,
        "otherwise the ordering assertion below is vacuous",
      );
      check(
        "the LAST inventory push is the NEWER one",
        last?.[0]?.name === "FRESH",
        `last push = ${last?.[0]?.name} — a slow flush landing after a fast one leaves the ` +
        "client permanently stale, and `applied` is true either way so no resync fires",
      );
    }

    // ── Bound it from the other side ─────────────────────────────────
    console.log("\nSR-2 — ordinary refreshes still work");
    {
      io.sent.length = 0;
      await prisma.playerProgress.update({
        where: { userId: user.id },
        data: { credits: 3210 },
      });
      gsm.scheduleSliceRefresh(user.id, "credits");
      await sleep(300);
      check(
        "a single refresh still pushes the current value",
        lastCredits() === 3210,
        `${lastCredits()} — serialising must not mean dropping`,
      );
    }

    // ── A failed flush must not throw the work away ──────────────────
    console.log("\nSR-2b — a failed refresh keeps its slices");
    {
      // `flushSlices` deletes the pending set BEFORE awaiting, and
      // `refreshStateSlices` wraps its body in `safeExecute`, which swallows.
      // So a single transient query failure used to drop the slice for good:
      // the client stayed stale, `applied` was never false, and nothing asked
      // for a resync until a reconnect.
      io.sent.length = 0;
      let throwNext = true;
      shop.getPlayerInventory = async (_uid: string) => {
        if (throwNext) {
          throwNext = false;
          throw new Error("probe: simulated inventory query failure");
        }
        return row("RECOVERED") as never;
      };

      gsm.scheduleSliceRefresh(user.id, "inventory");
      await sleep(300);

      check(
        "PRECONDITION: the failing flush pushed nothing",
        lastDelta("inventory") === undefined,
        `${JSON.stringify(lastDelta("inventory"))} — if it pushed, the failure never happened`,
      );
      check(
        "the slice is put back rather than discarded",
        (gsm as any).pendingSlices.get(user.id)?.has("inventory") === true,
        `pending=${JSON.stringify([...((gsm as any).pendingSlices.get(user.id) ?? [])])}`,
      );

      // And the restored slice must actually be delivered by the next pass,
      // not merely sit in a map forever.
      gsm.scheduleSliceRefresh(user.id, "credits");
      await sleep(300);
      const recovered = lastDelta("inventory") as any[] | undefined;
      check(
        "and the next refresh delivers it",
        recovered?.[0]?.name === "RECOVERED",
        `${recovered?.[0]?.name ?? "never pushed"} — restoring it into a map nobody drains ` +
        "would be the same data loss with extra steps",
      );
    }

    // ── A burst must still coalesce ──────────────────────────────────
    console.log("\nSR-3 — bursts still collapse into one pass");
    {
      io.sent.length = 0;
      for (let i = 0; i < 6; i++) gsm.scheduleSliceRefresh(user.id, "inventory", "credits");
      await sleep(400);
      const invPushes = io.sent.filter(
        (s) => s.event === "state:delta" && s.payload?.delta?.path === "inventory",
      ).length;
      check(
        "six scheduled refreshes produce one inventory push",
        invPushes === 1,
        `${invPushes} — the debounce is what keeps a mission granting K items from ` +
        "issuing K queries",
      );
    }
  } finally {
    shop.getPlayerInventory = realGetInventory;
    if (userId) {
      await gsm.destroySession(userId).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch((e) => {
        console.error("CLEANUP FAILED (user):", e.message);
      });
    }
    if (homeId) {
      await prisma.gameServer.delete({ where: { id: homeId } }).catch((e) => {
        console.error("CLEANUP FAILED (server):", e.message);
      });
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
