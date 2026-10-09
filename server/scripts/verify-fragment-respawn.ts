/**
 * A bricked fragment respawns (maintainer decision Q1, 2026-10-08).
 *
 * The world holds exactly the 9 fragments the endgame needs, and a failed
 * `fragment.crack` destroyed one "forever". Now it respawns after
 * FRAGMENT_RESPAWN_MS at a DIFFERENT non-home server of security 7+ that no
 * other fragment is sourced at. Found on the way (2026-10-09): a bricked
 * fragment had no holder, so reading files on its source server RE-CLAIMED
 * it (claims checked the holder, never the status) and it counted toward the
 * endgame while every fragment power refused it as bricked.
 *
 *   FR-1  brick: status, brickedAt, holder cleared, `fragment:bricked` emitted
 *   FR-2  a bricked fragment cannot be claimed (was: re-claimed)
 *   FR-3  respawn: never the old server, never a server another fragment uses
 *   FR-4  the cooldown: not before FRAGMENT_RESPAWN_MS, yes after
 *   FR-5  a respawned fragment is claimable again, at its new server
 *   FR-6  only PERMANENT servers are candidates: never a darknet dungeon
 *         server (deleted when the dungeon expires), an offline server, the
 *         hidden AIDA server or a tutorial server (review 2026-10-09)
 *   FR-7  a STRANDED fragment — active, unheld, its source server deleted —
 *         is moved by the hourly pass (was: claimable by no one, forever)
 *
 * PRIVATE fixtures only: fragments of a type no game listing recognises, on
 * fixture servers, and every respawn call is scoped to them — the real 9 are
 * asserted byte-identical at the end. Deleted by id in `finally`.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-fragment-respawn.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { freeIp } from "./lib/free-ip";
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
  console.log("\n=== Bricked fragments respawn ===");
  const tag = `fr${Date.now().toString(36)}`;
  const cracker = await register(`${tag}c`);
  const finder = await register(`${tag}f`);
  const world = () => prisma.keyFragment.findMany({ where: { keyType: { in: ["sword", "key", "collar"] } }, orderBy: { id: "asc" } });
  const worldBefore = JSON.stringify(await world());

  const serverIds: string[] = [];
  const fragIds: string[] = [];
  let networkId: string | null = null;
  const mkServer = async (name: string, securityLevel: number, extra: Record<string, unknown> = {}) => {
    const s = await prisma.gameServer.create({ data: { name: `${tag}_${name}`, ipAddress: await freeIp(prisma), type: "corporate", securityLevel, ...extra } });
    serverIds.push(s.id);
    return s;
  };
  const mkFrag = async (n: number, sourceId: string, holder: string | null) => {
    const f = await prisma.keyFragment.create({
      data: { keyType: `harness-${tag}`, fragmentNum: n, name: `fixture ${n}`, description: "fixture", hint: "fixture",
        sourceType: "server", sourceId, heldByUserId: holder, heldSince: holder ? new Date() : null, status: "active" },
    });
    fragIds.push(f.id);
    return f;
  };
  try {
    const origin = await mkServer("origin", 9);
    const free = await mkServer("free", 9);
    const occupied = await mkServer("occupied", 9);
    const lowSec = await mkServer("lowsec", 3);
    const pool = [origin.id, free.id, occupied.id, lowSec.id];
    await mkFrag(2, occupied.id, null); // another fragment lives on `occupied`
    const frag = await mkFrag(1, origin.id, cracker);

    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const frags = getService<any>(TOKENS.KEY_FRAGMENT_SERVICE);
    const { FRAGMENT_RESPAWN_MS } = await import("../src/config/gameBalance");
    const events: Array<[string, any]> = [];
    frags.on("fragment:bricked", (d: any) => events.push(["bricked", d]));
    frags.on("fragment:respawned", (d: any) => events.push(["respawned", d]));

    console.log("\nFR-1 — brick");
    const bricked = await frags.brickFragment(frag.id, cracker);
    const b = await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } });
    check("bricked, unheld, timestamped", bricked === true && b.status === "bricked" && b.heldByUserId === null && !!b.brickedAt);
    check("a story event is emitted (was: none)", events.some(([k, d]) => k === "bricked" && d.fragmentId === frag.id && d.userId === cracker));

    console.log("\nFR-2 — a bricked fragment cannot be claimed");
    const claim = await frags.checkServerFragment(finder, origin.id);
    const afterClaim = await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } });
    check("reading its source server does NOT re-claim it (was: re-claimed, counted toward the endgame)",
      claim.claimed === false && afterClaim.heldByUserId === null && afterClaim.status === "bricked", JSON.stringify(claim));

    console.log("\nFR-4 — the cooldown");
    const t0 = afterClaim.brickedAt!.getTime();
    const early = await frags.respawnDueFragments(new Date(t0 + FRAGMENT_RESPAWN_MS - 60_000), { fragmentIds: [frag.id], serverIds: pool });
    check("not before the cooldown", early === 0 && (await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } })).status === "bricked");
    const late = await frags.respawnDueFragments(new Date(t0 + FRAGMENT_RESPAWN_MS + 60_000), { fragmentIds: [frag.id], serverIds: pool });
    const r = await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } });
    check("after the cooldown, it respawns", late === 1 && r.status === "active" && r.brickedAt === null && r.heldByUserId === null);

    console.log("\nFR-3 — where it respawns");
    check("at the one eligible server: not its origin, not one another fragment uses, not low-security",
      r.sourceId === free.id, r.sourceId === origin.id ? "ORIGIN" : r.sourceId === occupied.id ? "OCCUPIED" : r.sourceId === lowSec.id ? "LOW SECURITY" : r.sourceId);
    check("and announces it", events.some(([k, d]) => k === "respawned" && d.fragmentId === frag.id && d.toServerId === free.id && d.fromServerId === origin.id));

    console.log("\nFR-5 — claimable again, at its new server");
    const old = await frags.checkServerFragment(finder, origin.id);
    check("not at the old one", old.claimed === false);
    const fresh = await frags.checkServerFragment(finder, free.id);
    check("POSITIVE: claimed at the new one", fresh.claimed === true &&
      (await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } })).heldByUserId === finder);

    console.log("\nFR-6 — only permanent servers");
    // A fixture dungeon: its own network and a `conquered` instance, a status
    // no scheduled dungeon query selects, so the dev server leaves it alone.
    const net = await prisma.network.create({ data: { name: `${tag}_dungeon`, zone: "darknet", isHidden: true } });
    networkId = net.id;
    await prisma.darkNetInstance.create({ data: { name: `${tag}_dungeon`, networkId: net.id, gatewayIp: "0.0.0.0", passkey: "x", rewardType: "credits_cache", status: "conquered" } });
    const excluded = [
      await mkServer("dungeon", 9, { networkId: net.id }),
      await mkServer("offline", 9, { isOnline: false }),
      await mkServer("aida", 9, { isAidaHomeServer: true }),
      await mkServer("tutorial", 9, { type: "tutorial" }),
    ];
    const keep = await mkServer("permanent", 9);
    const pool2 = [...excluded.map((x) => x.id), keep.id];
    const landed = new Set<string>();
    for (let i = 0; i < 6; i++) { // random choice: give each excluded server several chances
      const g = await mkFrag(10 + i, origin.id, null);
      await prisma.keyFragment.update({ where: { id: g.id }, data: { status: "bricked", brickedAt: new Date(0) } });
      await frags.respawnDueFragments(new Date(), { fragmentIds: [g.id], serverIds: pool2 });
      landed.add((await prisma.keyFragment.findUniqueOrThrow({ where: { id: g.id } })).sourceId);
      await prisma.keyFragment.update({ where: { id: g.id }, data: { sourceId: origin.id } }); // free `keep` for the next one
    }
    check("6 respawns all landed on the one permanent server (never dungeon/offline/AIDA/tutorial)",
      landed.size === 1 && landed.has(keep.id), [...landed].map((id) => excluded.find((x) => x.id === id)?.name ?? (id === keep.id ? "permanent" : id)).join(", "));

    console.log("\nFR-7 — a stranded fragment is recovered");
    const doomed = await mkServer("doomed", 9);
    const strandedFrag = await mkFrag(20, doomed.id, null);
    const safeFrag = await mkFrag(21, lowSec.id, null); // POSITIVE: its server exists
    await prisma.gameServer.delete({ where: { id: doomed.id } });
    const moved = await frags.respawnDueFragments(new Date(), { fragmentIds: [strandedFrag.id, safeFrag.id], serverIds: [keep.id] });
    const sf = await prisma.keyFragment.findUniqueOrThrow({ where: { id: strandedFrag.id } });
    check("the stranded fragment moves to a live server (was: left pointing at a deleted one)", moved === 1 && sf.sourceId === keep.id && sf.status === "active", `${moved} moved -> ${sf.sourceId === keep.id ? "permanent" : sf.sourceId}`);
    check("POSITIVE: an unheld fragment whose server exists stays put", (await prisma.keyFragment.findUniqueOrThrow({ where: { id: safeFrag.id } })).sourceId === lowSec.id);

    check("the world's real fragments are byte-identical", JSON.stringify(await world()) === worldBefore);
  } finally {
    try {
      await prisma.keyFragmentDiscovery.deleteMany({ where: { fragmentId: { in: fragIds } } });
      await prisma.keyFragment.deleteMany({ where: { id: { in: fragIds } } });
      await prisma.gameServer.deleteMany({ where: { id: { in: serverIds } } });
      // The instance cascades with its network.
      if (networkId) await prisma.network.delete({ where: { id: networkId } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
