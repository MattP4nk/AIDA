/**
 * Scans never return another player's home (maintainer decision Q10, 2026-10-09).
 *
 * The player-home allocator gives each player their own /16 so that "scanning
 * from home never reveals another player's home" — but only 254 /16s exist,
 * the dev world passed that long ago (homes now share them at random), and
 * none of the scan paths filtered homes anyway:
 *
 *   HI-1  `scan <prefix>` (scanByPartialIp) listed every home under the prefix
 *   HI-2  the subnet sweep (discoverServers) listed homes in the /16
 *   HI-3  `scan` from a server listed its topology neighbours — and EVERY home
 *         has a WAN link to the Internet Exchange, so one scan there listed all
 *   HI-4  `hack <name>` resolved a home by its name, "<username>'s Terminal" —
 *         a username was enough, no IP needed
 *   HI-5  the allocator could hand out an address in the AIDA Training
 *         Network's 10.10.10.0/24
 *
 * Homes stay reachable by IP (bounties and intrusion alerts hand those out).
 * Your OWN home still shows. Each check has a positive control: a non-home
 * fixture beside the home, which must still be found.
 *
 * Fixtures live in 198.18.0.0/16 (RFC 2544 benchmarking — no game range uses
 * it), so the /16 sweep is not crowded out by the dev world's real homes.
 * Deleted by id in `finally`; links and discovered links cascade.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-home-isolation.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { deleteRegisteredUsers } from "./lib/fixture-users";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
async function register(username: string) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const j: any = await r.json();
  if (!j?.user?.id) throw new Error(`register ${username}: ${r.status}`);
  return j.user.id as string;
}

async function main() {
  console.log("\n=== Scans never return another player's home ===");
  const tag = `hi${Date.now().toString(36)}`;
  const me = await register(`${tag}m`);
  const them = await register(`${tag}t`);
  const third = 1 + Math.floor(Math.random() * 250);
  const ip = (n: number) => `198.18.${third}.${n}`;

  const serverIds: string[] = [];
  const mk = async (name: string, n: number, home: { ownerId: string | null } | null) => {
    const s = await prisma.gameServer.create({
      data: {
        name: `${tag}_${name}`, ipAddress: ip(n), type: home ? "player_home" : "corporate",
        isPlayerHome: !!home, ownerId: home?.ownerId ?? null, isPublic: true, isOnline: true, encryptionLevel: 0,
      },
    });
    serverIds.push(s.id);
    return s;
  };
  try {
    const theirHome = await mk("theirs", 10, { ownerId: them });
    const myHome = await mk("mine", 11, { ownerId: me });
    const orphanHome = await mk("orphan", 12, { ownerId: null });
    const plain = await mk("plain", 13, null);
    const hub = await mk("hub", 1, null);
    for (const s of [theirHome, myHome, orphanHome, plain]) {
      await prisma.serverLink.create({ data: { sourceId: s.id, targetId: hub.id, linkType: "wan" } });
    }

    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const servers = getService<any>(TOKENS.SERVER_SERVICE);
    const topo = getService<any>(TOKENS.NETWORK_TOPOLOGY_SERVICE);
    const ips = getService<any>(TOKENS.IP_SERVICE);
    const has = (list: any[], id: string) => list.some((s: any) => (s.id ?? s.server?.serverId) === id);

    console.log("\nHI-1 — `scan <prefix>`");
    const pre = await servers.scanByPartialIp(me, `198.18.${third}.`, 3);
    check("POSITIVE: a plain server under the prefix is found", has(pre, plain.id));
    check("another player's home is NOT (was: listed)", !has(pre, theirHome.id));
    check("nor an ownerless home", !has(pre, orphanHome.id));
    check("your own home still is", has(pre, myHome.id));

    console.log("\nHI-2 — the /16 subnet sweep");
    const sweep = await servers.discoverServers(me, 3, ip(200));
    check("POSITIVE: a plain server in the /16 is found", has(sweep, plain.id));
    check("another player's home is NOT (was: listed)", !has(sweep, theirHome.id));

    console.log("\nHI-3 — topology neighbours (every home links to the Internet Exchange)");
    const nb = await topo.discoverNeighbors(me, hub.id, 0);
    check("POSITIVE: a plain neighbour is found", has(nb, plain.id));
    check("another player's home is NOT (was: every home listed from the hub)", !has(nb, theirHome.id) && !has(nb, orphanHome.id));
    check("your own home still is", has(nb, myHome.id));
    const recorded = await prisma.discoveredLink.count({ where: { userId: me, link: { sourceId: theirHome.id } } });
    check("and no discovered-link row is written for it", recorded === 0, `${recorded}`);

    console.log("\nHI-4 — `hack <name>`");
    const byName = await servers.resolveByIpOrName(theirHome.name);
    check("a home does NOT resolve by name (was: by username alone)", byName === null, JSON.stringify(byName));
    const byIp = await servers.resolveByIpOrName(theirHome.ipAddress);
    check("it still resolves by IP", byIp?.server?.id === theirHome.id);
    check("POSITIVE: a plain server resolves by name", (await servers.resolveByIpOrName(plain.name))?.server?.id === plain.id);

    console.log("\nHI-5 — never a home in the Training Network");
    // The dev world has used every /16, so allocation takes the fallback; make
    // its first pick land in 10.10.10.0/24.
    const real = ips.generateUniqueIP.bind(ips);
    let calls = 0;
    ips.generateUniqueIP = async (zone: any) => (++calls === 1 ? "10.10.10.77" : real(zone));
    let got = "";
    try { got = await ips.generatePlayerHomeIP(); } finally { ips.generateUniqueIP = real; }
    check("PRECONDITION: allocation took the fallback (every /16 used)", calls >= 1,
      `${calls} fallback call(s) — if 0, the dev world has a free /16 and this check cannot reach the fallback`);
    check("a training-network pick is rejected, another one taken", calls >= 2 && !got.startsWith("10.10.10."), got);
  } finally {
    try { await prisma.gameServer.deleteMany({ where: { id: { in: serverIds } } }); }
    catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
