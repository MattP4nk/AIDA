/**
 * One rule for discovering a link, applied by every writer.
 *
 * REVIEW #2 (angle E) reported this as "traceroute defeats the tap access
 * gate". Reading the code, the gate is not the defect — `traceroute` costs
 * networking 15, an active connection, a resource check, and a real
 * topological route, so "you traced a route to it" is legitimate discovery and
 * the gate's hint ("Try 'scan' first") was merely incomplete.
 *
 * The real defect is underneath, and it has nothing to do with taps: TWO
 * writers populate `discovered_links` with DIFFERENT rules.
 *
 *   - `discoverNeighbors` (scan) refuses a non-public server, a `hidden` link
 *     below networking 30, and a `vpn` link below networking 15.
 *   - `discoverPath` (traceroute) applied NONE of them and upserted every hop.
 *
 * So `scan` refusing a hidden link at networking 15 meant nothing: the same
 * link was obtainable by tracerouting through it. That undermines the whole
 * link-type progression, and it would still be true if the tap feature did not
 * exist.
 *
 * WRITTEN BEFORE THE FIX and confirmed red, per the method this pass adopted
 * after review #2 found that half the previous round's fixes were defective.
 *
 * SELF-CONTAINED: builds its own servers, links and player.
 *
 * Run: npx tsx scripts/verify-discovery-rules.ts
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
  console.log("\n=== Discovery rules ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const topo = getService<any>(TOKENS.NETWORK_TOPOLOGY_SERVICE);

  const tag = `__disc_probe_${process.pid}`;
  const madeServers: string[] = [];
  const madeLinks: string[] = [];
  let userId: string | null = null;

  /** Fresh link + fresh target, so each case is independent. */
  async function scenario(
    label: string,
    linkType: string,
    targetIsPublic: boolean,
    fromId: string,
  ) {
    const target = await prisma.gameServer.create({
      data: {
        name: `${tag}_${label}`,
        ipAddress: `10.90.${madeServers.length}.${process.pid % 250}`,
        type: "corporate",
        isPublic: targetIsPublic,
      },
    });
    madeServers.push(target.id);
    const link = await prisma.serverLink.create({
      data: { sourceId: fromId, targetId: target.id, linkType },
    });
    madeLinks.push(link.id);
    return { target, link };
  }

  const discovered = (linkId: string) =>
    prisma.discoveredLink.count({ where: { userId: userId!, linkId } });

  try {
    const user = await prisma.user.create({
      data: {
        username: tag,
        email: `${tag}@probe.local`,
        password: "p",
        homeIp: `10.91.0.${process.pid % 250}`,
        progress: { create: { networking: 10 } },
      },
    });
    userId = user.id;

    const origin = await prisma.gameServer.create({
      data: {
        name: `${tag}_origin`,
        ipAddress: `10.92.0.${process.pid % 250}`,
        type: "corporate",
        isPublic: true,
      },
    });
    madeServers.push(origin.id);

    // ── The three rules scan enforces, applied to traceroute ─────────
    console.log("\nDR-1 — traceroute obeys the same rules as scan");
    {
      const hidden = await scenario("hidden", "hidden", true, origin.id);
      await topo.discoverPath(user.id, [{ serverId: origin.id }, { serverId: hidden.target.id }]);
      check(
        "a HIDDEN link is not discovered below networking 30",
        (await discovered(hidden.link.id)) === 0,
        "scan refuses this at networking 15; traceroute handed it over anyway",
      );

      const vpn = await scenario("vpn", "vpn", true, origin.id);
      await topo.discoverPath(user.id, [{ serverId: origin.id }, { serverId: vpn.target.id }]);
      check(
        "a VPN link is not discovered below networking 15",
        (await discovered(vpn.link.id)) === 0,
        "the player is at networking 10",
      );

      const priv = await scenario("private", "lan", false, origin.id);
      await topo.discoverPath(user.id, [{ serverId: origin.id }, { serverId: priv.target.id }]);
      check(
        "a PRIVATE server is not discovered by routing through it",
        (await discovered(priv.link.id)) === 0,
        "isPublic:false means the IP must come from files or intel, not from a route",
      );
    }

    // ── Without this, the checks above pass for the wrong reason ─────
    console.log("\nDR-2 — POSITIVE CONTROLS: legitimate discovery still works");
    {
      const plain = await scenario("lan", "lan", true, origin.id);
      await topo.discoverPath(user.id, [{ serverId: origin.id }, { serverId: plain.target.id }]);
      check(
        "an ordinary public LAN link IS discovered",
        (await discovered(plain.link.id)) === 1,
        "otherwise DR-1 would pass simply because discoverPath stopped working",
      );

      await prisma.playerProgress.update({
        where: { userId: user.id },
        data: { networking: 40 },
      });
      const hidden2 = await scenario("hidden_skilled", "hidden", true, origin.id);
      await topo.discoverPath(user.id, [{ serverId: origin.id }, { serverId: hidden2.target.id }]);
      check(
        "and a HIDDEN link IS discovered once the skill is there",
        (await discovered(hidden2.link.id)) === 1,
        "the rule is a skill gate, not a blanket refusal",
      );
    }

    // ── The rule must have exactly one definition ────────────────────
    console.log("\nDR-3 — one predicate, both callers");
    {
      const { readFileSync } = await import("node:fs");
      const src = readFileSync(
        new URL("../src/services/networkTopologyService.ts", import.meta.url).pathname,
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

      const predicateHits = (src.match(/canDiscoverLink\(/g) || []).length;
      check(
        "both discovery paths call one shared predicate",
        predicateHits >= 3,
        `${predicateHits} references (1 definition + 2 callers) — two copies of a rule ` +
        "is how they drifted in the first place",
      );
      check(
        "and the thresholds appear once, not per caller",
        (src.match(/linkType === "hidden"/g) || []).length === 1,
        "a second copy is a second thing to forget",
      );
    }
  } finally {
    if (userId) {
      await prisma.discoveredLink.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch((e) => {
        console.error("CLEANUP FAILED (user):", e.message);
      });
    }
    for (const id of madeLinks) {
      await prisma.serverLink.delete({ where: { id } }).catch(() => {});
    }
    for (const id of madeServers) {
      await prisma.gameServer.delete({ where: { id } }).catch((e) => {
        console.error(`CLEANUP FAILED (server ${id}):`, e.message);
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
