/**
 * Shutdown unsubscribes only what it subscribed.
 *
 * REVIEW #2 (angles C and G): `gameStateManager.stop()` tore its delta bridge
 * down with `removeAllListeners(<event>)` on three DI singletons it does not
 * own — the progress repository, the mission repository and shopService. That
 * removes EVERY listener for those event names, not the ones the bridge added.
 *
 * Nothing else subscribes to them today, so it is latent. The failure mode is
 * what makes it worth fixing now: the next subscriber — an achievements
 * tracker, a leaderboard cache, an analytics sink — works in dev and is
 * silently unsubscribed the first time `gracefulShutdown` reaches the
 * GAME_STATE_MANAGER row. It fails with no error, only during shutdown, and
 * reads as "the event isn't emitted".
 *
 * WRITTEN BEFORE THE FIX and confirmed red.
 *
 * Run: npx tsx scripts/verify-bridge-teardown.ts
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

async function main() {
  console.log("\n=== Delta-bridge teardown ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const gsm = getService<any>(TOKENS.GAME_STATE_MANAGER);
  const progressRepo = getService<any>(TOKENS.PLAYER_PROGRESS_REPOSITORY);
  const missionRepo = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);
  const shop = getService<any>(TOKENS.SHOP_SERVICE);

  // A stand-in for the next service that subscribes to these buses.
  let foreignFired = 0;
  const foreign = () => { foreignFired++; };

  console.log("\nBT-1 — a foreign subscriber survives shutdown");
  {
    const bridgeProgress = progressRepo.listenerCount("progress:changed");
    const bridgeMissions = missionRepo.listenerCount("missions:changed");
    const bridgeShop = shop.listenerCount("purchase:complete");
    check(
      "PRECONDITION: the bridge is subscribed to all three buses",
      bridgeProgress > 0 && bridgeMissions > 0 && bridgeShop > 0,
      `progress=${bridgeProgress} missions=${bridgeMissions} shop=${bridgeShop}`,
    );

    progressRepo.on("progress:changed", foreign);
    missionRepo.on("missions:changed", foreign);
    shop.on("purchase:complete", foreign);

    gsm.stop();

    check(
      "the foreign progress listener is still registered",
      progressRepo.listenerCount("progress:changed") === 1,
      `${progressRepo.listenerCount("progress:changed")} listeners left — ` +
      "removeAllListeners takes every subscriber, not just the bridge's",
    );
    check(
      "the foreign mission listener is still registered",
      missionRepo.listenerCount("missions:changed") === 1,
      `${missionRepo.listenerCount("missions:changed")}`,
    );
    check(
      "the foreign shop listener is still registered",
      shop.listenerCount("purchase:complete") === 1,
      `${shop.listenerCount("purchase:complete")}`,
    );

    // Registered is not the same as working.
    foreignFired = 0;
    progressRepo.emit("progress:changed", { userId: "probe" });
    missionRepo.emit("missions:changed", { userId: "probe" });
    shop.emit("purchase:complete", { userId: "probe" });
    check(
      "and all three still FIRE",
      foreignFired === 3,
      `${foreignFired}/3 — listenerCount alone would not catch a detached handler`,
    );
  }

  console.log("\nBT-2 — but the bridge's own subscriptions ARE gone");
  {
    check(
      "the bridge no longer listens for progress changes",
      progressRepo.listenerCount("progress:changed") === 1,
      "exactly the foreign one remains, so stop() removed its own and nothing else",
    );
    check(
      "nor for mission changes",
      missionRepo.listenerCount("missions:changed") === 1,
    );
    check(
      "nor for shop events",
      shop.listenerCount("purchase:complete") === 1,
    );
  }

  console.log("\nBT-3 — the teardown is scoped, not blanket");
  {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../src/services/gameStateManager.ts", import.meta.url).pathname,
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    check(
      "stop() does not call removeAllListeners",
      !/removeAllListeners/.test(src),
      "it removes every subscriber for an event name from a singleton it does not own",
    );
    check(
      "it calls off() with the handler it registered",
      /\.off\(/.test(src),
      "holding the reference is what makes the teardown scoped",
    );
  }

  console.log("\nBT-4 — ending a session releases session drains only");
  {
    // `destroySession` releases the passive resource drains a player holds.
    // The first version called a `releaseAllFor` that did
    // `passiveConsumers.delete(userId)` — which also wiped BACKDOOR drains.
    // Nothing re-registers those at login (only `installBackdoor` does), so a
    // single logout silently refunded the cost of every backdoor the player
    // owned, permanently. A tab close must not be a free upgrade.
    const memory = getService<any>(TOKENS.MEMORY_SERVICE);
    const probe = `__drain_probe_${process.pid}`;

    memory.registerTerminal(probe, "t1", "Terminal 1");
    memory.registerConnection(probe, "srv1", "Target");
    memory.registerBackdoor(probe, "srv2", "Owned Box");

    const types = () =>
      memory.getPassiveConsumers(probe).map((c: any) => c.type).sort();
    check(
      "PRECONDITION: all three drains are registered",
      types().join(",") === "backdoor,connection,terminal",
      types().join(",") || "(none)",
    );

    memory.releaseSessionConsumersFor(probe);

    check(
      "the connection drain is released",
      !types().includes("connection"),
      types().join(",") || "(none)",
    );
    check(
      "the terminal drain is released",
      !types().includes("terminal"),
      types().join(",") || "(none)",
    );
    check(
      "but the BACKDOOR drain survives",
      types().includes("backdoor"),
      `${types().join(",") || "(none)"} — nothing re-registers it at login, so dropping ` +
      "it here refunds its cost forever",
    );

    memory.unregisterBackdoor(probe, "srv2");
    check(
      "and its own release path still works",
      memory.getPassiveConsumers(probe).length === 0,
      `${memory.getPassiveConsumers(probe).length} left — otherwise the drain is unreleasable`,
    );
  }

  console.log("\nBT-5 — EVERY path that deactivates a backdoor releases its drain");
  {
    // The sibling-path trap, and the reason BT-4 alone is not enough.
    //
    // Narrowing session teardown to session-scoped consumers was correct, and
    // it removed the thing that had been reclaiming backdoor drains by
    // accident. The explicit release only existed on the path a PLAYER
    // triggers (`removeBackdoor`); both EXPIRY paths deactivated the row and
    // released nothing — and `cleanupExpired` did not even select
    // `installerId`, so it could not have. A player who let backdoors expire
    // paid their CPU/RAM/BW until the process restarted, with no process in
    // `ps` to kill.
    //
    // COUNTED, not matched: a single `.test()` would have passed on the one
    // path that was already correct, which is exactly how this was missed.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(
      new URL("../src/services/backdoorService.ts", import.meta.url).pathname,
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    // MATCH ANY WRITE TO `isActive`, not the literal `isActive: false`.
    //
    // The first version of this check counted `/isActive: false/` and reported
    // a clean 4-for-4 while MISSING a fifth site that deactivates with
    // `isActive: !discovered` — the discovery-on-use path. Counting instead of
    // matching was the lesson from the previous round, and it was still the
    // wrong pattern: a counting check is only as good as what it counts, and
    // "every spelling of this write" is the property, not "this spelling".
    const deactivations = (src.match(/isActive: (?!true\b)/g) ?? []).length;
    const releases = (src.match(/releaseBackdoorDrain\(/g) ?? []).length;
    check(
      "PRECONDITION: the file has deactivation sites to check",
      deactivations > 0,
      `${deactivations} — a zero here would make the comparison vacuous`,
    );
    check(
      "PRECONDITION: the pattern sees the NEGATED spelling too",
      /isActive: !discovered/.test(src),
      "the literal-only pattern scored this file 4-for-4 while a fifth site leaked",
    );
    check(
      "every deactivation site has a matching drain release",
      // -1: the helper's own definition is one of the `releaseBackdoorDrain(`
      // matches and is not a call site.
      releases - 1 >= deactivations,
      `${releases - 1} release calls for ${deactivations} deactivations — the expiry ` +
      "and discovery paths used to deactivate and release nothing",
    );
    check(
      "and cleanupExpired selects installerId, so it CAN release",
      /select: \{ id: true, serverId: true, installerId: true \}/.test(src),
      "without it that path cannot identify whose resources to free, which is how " +
      "the gap stayed invisible",
    );
  }

  console.log("\nBT-6 — a server deleted out from under a backdoor releases its drain");
  {
    // BEHAVIOURAL. `Backdoor.server` is `onDelete: Cascade`, so deleting a
    // GameServer takes its backdoor rows with it — and once they are gone
    // nothing can say whose resources they were costing. `removeBackdoor`
    // answers "No backdoor installed on this server" because the row really
    // is absent, while the consumer keeps charging until the process restarts.
    //
    // The path that bites players is a darknet dungeon reaching its TTL and
    // regenerating the whole network under them.
    const memory = getService<any>(TOKENS.MEMORY_SERVICE);
    const backdoors = getService<any>(TOKENS.BACKDOOR_SERVICE);
    const tag = `__bdoor_del_${process.pid}`;
    let userId: string | null = null;
    let serverId: string | null = null;

    try {
      const user = await prisma.user.create({
        data: {
          username: tag,
          email: `${tag}@probe.local`,
          password: "p",
          homeIp: `10.81.0.${process.pid % 250}`,
        },
      });
      userId = user.id;
      const srv = await prisma.gameServer.create({
        data: {
          name: `${tag}_target`,
          ipAddress: `10.82.0.${process.pid % 250}`,
          type: "corporate",
        },
      });
      serverId = srv.id;
      await prisma.backdoor.create({
        data: { installerId: user.id, serverId: srv.id, accessLevel: 3 },
      });
      memory.registerBackdoor(user.id, srv.id, srv.name);

      check(
        "PRECONDITION: the drain is registered and the row exists",
        memory.getPassiveConsumers(user.id).some((c: any) => c.type === "backdoor") &&
          (await prisma.backdoor.count({ where: { serverId: srv.id } })) === 1,
        `${memory.getPassiveConsumers(user.id).length} consumers`,
      );

      await backdoors.releaseDrainsForServers([srv.id]);

      check(
        "releaseDrainsForServers frees it BEFORE the cascade removes the row",
        !memory.getPassiveConsumers(user.id).some((c: any) => c.type === "backdoor"),
        `${JSON.stringify(memory.getPassiveConsumers(user.id).map((c: any) => c.type))} — ` +
        "after the delete there is no row left to identify the owner from",
      );

      // The ordering is the whole point: prove it cannot work afterwards.
      memory.registerBackdoor(user.id, srv.id, srv.name);
      await prisma.gameServer.delete({ where: { id: srv.id } });
      serverId = null;
      check(
        "PRECONDITION: the cascade really removed the backdoor row",
        (await prisma.backdoor.count({ where: { serverId: srv.id } })) === 0,
        "if the row survived, the ordering argument would not hold",
      );
      await backdoors.releaseDrainsForServers([srv.id]);
      check(
        "NEGATIVE CONTROL: calling it AFTER the delete cannot free anything",
        memory.getPassiveConsumers(user.id).some((c: any) => c.type === "backdoor"),
        "which is why every caller must release before deleting, not after",
      );
      memory.unregisterBackdoor(user.id, srv.id);
    } finally {
      if (serverId) {
        await prisma.gameServer.delete({ where: { id: serverId } }).catch((e) => {
          console.error("CLEANUP FAILED (server):", e.message);
        });
      }
      if (userId) {
        await prisma.user.delete({ where: { id: userId } }).catch((e) => {
          console.error("CLEANUP FAILED (user):", e.message);
        });
      }
    }

    // And every deletion path must actually call it.
    const { readFileSync } = await import("node:fs");
    const read = (rel: string) =>
      readFileSync(new URL(rel, import.meta.url).pathname, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const callers = [
      ["serverService", "../src/services/serverService.ts"],
      ["darknetDungeonService", "../src/services/darknetDungeonService.ts"],
      ["adminApi/servers", "../src/routes/adminApi/servers.ts"],
    ] as const;
    for (const [name, rel] of callers) {
      const src = read(rel);
      check(
        `${name} releases drains before deleting servers`,
        /releaseDrainsForServers\(/.test(src),
        "a deletion path that skips this orphans the drain permanently",
      );
    }
  }

  progressRepo.off("progress:changed", foreign);
  missionRepo.off("missions:changed", foreign);
  shop.off("purchase:complete", foreign);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
