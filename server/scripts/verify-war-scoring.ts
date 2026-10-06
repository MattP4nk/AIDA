/**
 * War scoring cannot be farmed.
 *
 * REVIEW #2 (angle E): `recordHackForWar` awarded WAR_POINTS_PER_HACK on every
 * successful hack against any enemy-faction server, with no per-server dedupe,
 * no per-player cap and no diminishing returns. The only limiter was the
 * generic hack cooldown, `max(10, 30 - hacking * 0.3)` seconds — so one player
 * re-hacking the weakest enemy server manages ~6 hacks/minute, 3,600
 * points/hour, against a war whose outcome `forceCeasefire` decides purely by
 * `attackerScore >= defenderScore`. One account overnight settles a
 * fourteen-day war the defending faction never got to contest.
 *
 * WRITTEN BEFORE THE FIX and confirmed red, per the method adopted after
 * review #2 found half the previous round's fixes were themselves defective.
 *
 * ON THE DEDUPE STORE: `HackLog` has the right columns but is written
 * FIRE-AND-FORGET one step earlier in the same pipeline, so whether the
 * current hack is present when scoring runs is a race. Deriving the rule from
 * it would be the "assert the state the code READS, not the state you can see"
 * trap. The window is kept in memory instead — exact, race-free, and honest
 * about the one thing it loses (see DR-4).
 *
 * SELF-CONTAINED: builds its own factions, war, servers and player.
 *
 * Run: npx tsx scripts/verify-war-scoring.ts
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
  console.log("\n=== War scoring ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const warfare = getService<any>(TOKENS.WARFARE_SERVICE);
  const { WAR_POINTS_PER_HACK, WAR_MAX_POINTS_PER_PLAYER } =
    await import("../src/config/gameBalance");

  const tag = `__warscore_${process.pid}`;
  let aId: string | null = null;
  let bId: string | null = null;
  let warId: string | null = null;
  let userId: string | null = null;
  const servers: string[] = [];

  const score = async () =>
    (await prisma.factionWar.findUnique({ where: { id: warId! } }))?.attackerScore ?? 0;

  try {
    const a = await prisma.faction.create({
      data: { name: `${tag}_A`, shortName: `${tag}A`.slice(0, 20), description: "probe" },
    });
    const b = await prisma.faction.create({
      data: { name: `${tag}_B`, shortName: `${tag}B`.slice(0, 20), description: "probe" },
    });
    aId = a.id; bId = b.id;

    const war = await prisma.factionWar.create({
      data: {
        attackerFactionId: a.id,
        defenderFactionId: b.id,
        status: "active",
        declaredBy: "probe",
      },
    });
    warId = war.id;

    const user = await prisma.user.create({
      data: {
        username: tag, email: `${tag}@probe.local`, password: "p",
        homeIp: `10.44.0.${process.pid % 250}`,
        progress: { create: {} },
      },
    });
    userId = user.id;
    await prisma.factionMember.create({ data: { userId: user.id, factionId: a.id } });

    const mkServer = async (n: number) => {
      const s = await prisma.gameServer.create({
        data: {
          name: `${tag}_t${n}`,
          ipAddress: `10.45.${n}.${process.pid % 250}`,
          type: "corporate",
          factionId: b.id,
        },
      });
      servers.push(s.id);
      return s.id;
    };
    const target = await mkServer(0);

    // ── The reported exploit ─────────────────────────────────────────
    console.log("\nWS-1 — the same server cannot be farmed");
    {
      const before = await score();
      const first = await warfare.recordHackForWar(user.id, target);
      check("the first hack scores", !!first, first ? `+${WAR_POINTS_PER_HACK}` : "null");
      const afterFirst = await score();
      check(
        "PRECONDITION: the score moved",
        afterFirst === before + WAR_POINTS_PER_HACK,
        `${before} -> ${afterFirst}`,
      );

      for (let i = 0; i < 9; i++) await warfare.recordHackForWar(user.id, target);
      const afterSpam = await score();
      check(
        "nine more hacks on the SAME server add nothing",
        afterSpam === afterFirst,
        `${afterFirst} -> ${afterSpam} — at a 10s cooldown this is 90 seconds of farming`,
      );
    }

    // ── Rotating across servers must not restore the exploit ─────────
    console.log("\nWS-2 — a per-player cap bounds one account's influence");
    {
      // Each distinct server scores once, so without a cap a player simply
      // rotates targets. The cap is what stops one account deciding a war.
      for (let i = 1; i <= 40; i++) {
        await warfare.recordHackForWar(user.id, await mkServer(i));
      }
      const capped = await score();
      check(
        `one player contributes at most ${WAR_MAX_POINTS_PER_PLAYER}`,
        capped <= WAR_MAX_POINTS_PER_PLAYER,
        `${capped} after 41 distinct targets — forceCeasefire decides the war on this number`,
      );
      check(
        "and the cap is actually reached, so the check is not vacuous",
        capped === WAR_MAX_POINTS_PER_PLAYER,
        `${capped}/${WAR_MAX_POINTS_PER_PLAYER}`,
      );
    }

    // ── Bound it from the other side ─────────────────────────────────
    console.log("\nWS-3 — legitimate scoring still works");
    {
      const other = await prisma.user.create({
        data: {
          username: `${tag}_2`, email: `${tag}_2@probe.local`, password: "p",
          homeIp: `10.46.0.${process.pid % 250}`, progress: { create: {} },
        },
      });
      await prisma.factionMember.create({ data: { userId: other.id, factionId: a.id } });
      try {
        const before = await score();
        const res = await warfare.recordHackForWar(other.id, servers[0]!);
        check(
          "a DIFFERENT player still scores the same server",
          !!res && (await score()) === before + WAR_POINTS_PER_HACK,
          "the cooldown is per player, not global — otherwise one farmer freezes the war",
        );
      } finally {
        await prisma.factionMember.deleteMany({ where: { userId: other.id } });
        await prisma.user.delete({ where: { id: other.id } });
      }

      const neutral = await prisma.gameServer.create({
        data: {
          name: `${tag}_neutral`,
          ipAddress: `10.47.0.${process.pid % 250}`,
          type: "corporate",
        },
      });
      servers.push(neutral.id);
      check(
        "an unaligned server still scores nothing",
        (await warfare.recordHackForWar(user.id, neutral.id)) === null,
      );
    }

    // ── The cap must survive concurrency ─────────────────────────────
    console.log("\nWS-5 — concurrent hacks cannot overshoot the cap");
    {
      // The cap was a check-then-act: `warContributed` was read, then an
      // `await updateWarScore` ran, then the map was written. Five hacks
      // resolving in the same tick all read the same pre-write total and all
      // awarded — the exact uncapped account the cap exists to prevent, just
      // harder to hit by hand.
      //
      // Each call is given the WHOLE cap as its award, so correct behaviour is
      // "one of these five lands" and the buggy one is "all five land".
      const racer = await prisma.user.create({
        data: {
          username: `${tag}_r`, email: `${tag}_r@probe.local`, password: "p",
          homeIp: `10.48.0.${process.pid % 250}`, progress: { create: {} },
        },
      });
      await prisma.factionMember.create({ data: { userId: racer.id, factionId: a.id } });
      try {
        const targets: string[] = [];
        for (let i = 100; i < 105; i++) targets.push(await mkServer(i));

        const before = await score();
        const results = await Promise.all(
          targets.map((t) =>
            warfare.recordHackForWar(racer.id, t, WAR_MAX_POINTS_PER_PLAYER),
          ),
        );
        const gained = (await score()) - before;

        check(
          "PRECONDITION: at least one concurrent hack scored",
          results.some((r) => r !== null) && gained > 0,
          `${results.filter(Boolean).length}/5 scored, +${gained} — otherwise the cap ` +
          "assertion below passes because nothing happened at all",
        );
        check(
          `five simultaneous hacks award at most ${WAR_MAX_POINTS_PER_PLAYER}`,
          gained <= WAR_MAX_POINTS_PER_PLAYER,
          `+${gained} vs cap ${WAR_MAX_POINTS_PER_PLAYER} — reserving the contribution ` +
          "before the await is what makes the cap real",
        );
      } finally {
        await prisma.factionMember.deleteMany({ where: { userId: racer.id } });
        await prisma.user.delete({ where: { id: racer.id } }).catch((e) => {
          console.error("CLEANUP FAILED (racer):", e.message);
        });
      }
    }

    // ── State the limitation rather than hiding it ───────────────────
    console.log("\nWS-4 — the known limit of an in-memory window");
    {
      const { readFileSync } = await import("node:fs");
      const raw = readFileSync(
        new URL("../src/services/warfareService.ts", import.meta.url).pathname,
        "utf8",
      );
      // Normalise comment continuations before matching. The first version of
      // this check used a plain regex and went red because the phrase happened
      // to wrap across two comment lines — testing layout, not content, which
      // is the same brittleness that bit the tap-refund check.
      const prose = raw.replace(/\n\s*\*\s?/g, " ").replace(/\s+/g, " ");
      check(
        "the restart caveat is documented where the map is declared",
        /rebuilt empty on restart/i.test(prose),
        "a process restart clears the window — a real limit, and not one to discover later",
      );
      // Named specifically: warfareService has three `unref` calls, so matching
      // the bare word would have passed on the war monitor's timer instead.
      check(
        "the SWEEP timer is unref'd so it cannot hold the process open",
        /warSweepInterval as NodeJS\.Timeout[\s\S]{0,60}?unref/.test(raw),
        "a per-(war,player,server) map with no eviction is a slow leak",
      );
      check(
        "and contributions are pruned by WAR STATUS, not by age",
        /sweepWarScoreWindows/.test(raw) && /status: "active"/.test(raw),
        "ageing contributions out would restore the rotation exploit the cap exists to stop",
      );

      // BEHAVIOURAL, not a grep: the sweep is armed in the CONSTRUCTOR, so it
      // outlives anything `startWarMonitor` set up. `stopWarMonitor` is the
      // only shutdown hook this service has, and lifecycle.ts calls it before
      // `prisma.$disconnect()` — a sweep that fires afterwards throws from
      // inside a timer callback, where nothing is left to catch it.
      check(
        "PRECONDITION: the sweep timer is armed",
        (warfare as any).warSweepInterval !== undefined,
        "otherwise the next check passes because it was never set",
      );
      warfare.stopWarMonitor();
      check(
        "stopWarMonitor clears the SWEEP timer, not just the war monitor",
        (warfare as any).warSweepInterval === undefined,
        "it is armed in the constructor, so startWarMonitor's teardown does not cover it",
      );
    }
  } finally {
    if (userId) await prisma.factionMember.deleteMany({ where: { userId } });
    for (const id of servers) {
      await prisma.gameServer.delete({ where: { id } }).catch((e) => {
        console.error(`CLEANUP FAILED (server ${id}):`, e.message);
      });
    }
    // Reported, never swallowed: a fixture left behind is read as real state
    // by the NEXT run, and these rows are a faction, a war and a player.
    const drop = async (what: string, fn: () => Promise<unknown>) => {
      await fn().catch((e) => console.error(`CLEANUP FAILED (${what}):`, e.message));
    };
    if (warId) await drop("war", () => prisma.factionWar.delete({ where: { id: warId! } }));
    if (userId) await drop("user", () => prisma.user.delete({ where: { id: userId! } }));
    if (aId) await drop("faction A", () => prisma.faction.delete({ where: { id: aId! } }));
    if (bId) await drop("faction B", () => prisma.faction.delete({ where: { id: bId! } }));
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
