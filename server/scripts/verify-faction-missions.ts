/**
 * Faction missions can be claimed (maintainer decision Q8, 2026-10-08).
 *
 * `faction missions` listed missions nobody could accept: accepting needs a
 * per-player offer and the only code that creates one for an existing
 * mission, `assignMission`, had no callers. The listing also printed the LAST
 * four id characters (no resolver matches a suffix), told players to type
 * `mission accept` (the DETAIL command), and included any player's private
 * generated offer that carried the faction's id.
 *
 *   FM-1  the listing shows only claimable missions — not someone's offer
 *   FM-2  `accept <shown id>` claims and starts it (end to end, over a socket)
 *   FM-3  two members claiming one mission at once: exactly one gets it
 *         (`assignMission` was a check-then-act)
 *   FM-4  an accept REFUSED (the active-mission cap) releases the claim
 *         (was: claimed first, so the mission stayed assigned, unaccepted,
 *         and vanished from every member's list — review 2026-10-09)
 *   FM-5  a claim whose follow-up write fails is released too (was: assigned
 *         to a player with no copy of it, for good)
 *
 * Fixtures: a private faction with fixture members and missions, deleted by
 * id in `finally` (missions cascade to player-mission rows).
 *
 * Needs the dev server. Run: npx tsx scripts/verify-faction-missions.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// The server has no socket.io-client dependency; harnesses borrow the client's.
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
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
  if (!j?.token) throw new Error(`register ${username}: ${r.status}`);
  return { id: j.user.id as string, token: j.token as string };
}

async function main() {
  console.log("\n=== Faction missions are claimable ===");
  const tag = `fm${Date.now().toString(36)}`;
  const a = await register(`${tag}a`);
  const b = await register(`${tag}b`);
  const c = await register(`${tag}c`);
  const faction = await prisma.faction.create({ data: { name: `fx-${tag}`, description: "harness fixture" } });
  const missionIds: string[] = [];
  const mkMission = async (title: string) => {
    const m = await prisma.mission.create({
      data: { title, description: "fixture", type: "recon", factionId: faction.id, status: "available", objectives: [], reward: { credits: 10 } },
    });
    missionIds.push(m.id);
    return m;
  };
  let s: ReturnType<typeof ioClient> | null = null;
  try {
    for (const u of [a, b]) await prisma.factionMember.create({ data: { userId: u.id, factionId: faction.id } });

    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const missions = getService<any>(TOKENS.MISSION_SERVICE);
    const repo = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);

    const open = await mkMission(`OPEN ${tag}`);
    const raced = await mkMission(`RACED ${tag}`);
    // Someone's private generated offer that happens to carry the faction id.
    const privateOffer = await mkMission(`PRIVATE ${tag}`);
    await repo.put(c.id, privateOffer.id, { missionId: privateOffer.id, userId: c.id, status: "available", objectives: [], startedAt: null, completedAt: null, expiresAt: null });

    console.log("\nFM-1 — the listing shows only claimable missions");
    const claimable = (await missions.listClaimableFactionMissions(faction.id)).map((m: any) => m.id);
    check("a free faction mission is claimable", claimable.includes(open.id));
    check("another player's private offer is NOT (was: listed to the whole faction)", !claimable.includes(privateOffer.id));

    console.log("\nFM-2 — `accept <shown id>` claims and starts it");
    s = ioClient(BASE, { auth: { token: a.token }, transports: ["websocket"], reconnection: false });
    const sock = s;
    await new Promise<void>((res, rej) => {
      sock.once("connect_error", rej);
      sock.once("connect", () => sock.emit("authenticate:request", (x: any) => (x?.success ? res() : rej(new Error(JSON.stringify(x))))));
    });
    const run = (command: string): Promise<string> => new Promise((res) => {
      const t = setTimeout(() => res("<timeout>"), 8000);
      sock.once("command:result", (x: any) => { clearTimeout(t); res(Array.isArray(x?.output) ? x.output.join("\n") : String(x?.output ?? x?.error ?? "")); });
      sock.emit("command:execute", { command, terminalId: "fm" });
    });
    const list = await run("faction missions");
    const shown = open.id.substring(0, 16);
    check("PRECONDITION: the listing shows the 16-char prefix and the right command",
      list.includes(shown) && /accept <id>/.test(list) && !/mission accept/.test(list), list.split("\n").find((l) => /accept/.test(l)) ?? "");
    check("and not the private offer", !list.includes(privateOffer.id.substring(0, 16)));
    const acc = await run(`accept ${shown}`);
    const pm = await repo.get(a.id, open.id);
    const row = await prisma.mission.findUniqueOrThrow({ where: { id: open.id }, select: { status: true, assignedTo: true } });
    check("`accept <shown id>` claims and starts it (was: Mission not assigned to player)",
      /MISSION ACCEPTED/.test(acc) && pm?.status === "active" && row.assignedTo === a.id, acc.split("\n").find((l) => l.trim()) ?? "");
    const after = (await missions.listClaimableFactionMissions(faction.id)).map((m: any) => m.id);
    check("and it leaves the faction's list", !after.includes(open.id));

    console.log("\nFM-3 — two members claim one mission at once: exactly one gets it");
    // DETERMINISTIC race: a two-party barrier inside getMission makes BOTH
    // claims read "available" before EITHER writes. Without it, whether two
    // Promise.all calls interleave is luck — and an earlier version of this
    // check passed with the atomic guard removed.
    const realGet = missions.getMission.bind(missions);
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((r) => { release = r; });
    missions.getMission = async (id: string) => {
      const m = await realGet(id);
      if (id === raced.id && ++arrived === 2) release();
      if (id === raced.id) await barrier;
      return m;
    };
    let ra: any, rb: any;
    try {
      [ra, rb] = await Promise.all([
        missions.claimFactionMission(a.id, faction.id, raced.id),
        missions.claimFactionMission(b.id, faction.id, raced.id),
      ]);
    } finally {
      missions.getMission = realGet;
    }
    check("PRECONDITION: both claims reached the check before either wrote", arrived === 2, `${arrived}`);
    const winner = ra.ok ? a.id : b.id;
    const racedRow = await prisma.mission.findUniqueOrThrow({ where: { id: raced.id }, select: { assignedTo: true } });
    const holders = [await repo.has(a.id, raced.id), await repo.has(b.id, raced.id)].filter(Boolean).length;
    check("one claim succeeds, one is refused", [ra, rb].filter((r: any) => r.ok).length === 1,
      [ra, rb].map((r: any) => r.ok ? "ok" : r.error).join(" | "));
    check("and only the winner holds it", racedRow.assignedTo === winner && holders === 1, `${holders} holder(s)`);

    const { MAX_ACTIVE_MISSIONS } = await import("../src/config/gameBalance");
    const isFree = async (id: string) => {
      const row = await prisma.mission.findUniqueOrThrow({ where: { id }, select: { status: true, assignedTo: true } });
      return row.status === "available" && row.assignedTo === null &&
        (await missions.listClaimableFactionMissions(faction.id)).some((m: any) => m.id === id);
    };

    console.log("\nFM-4 — a refused accept releases the claim");
    for (let i = 0; i < MAX_ACTIVE_MISSIONS; i++) {
      const busy = await mkMission(`BUSY ${i} ${tag}`);
      await repo.put(b.id, busy.id, { missionId: busy.id, userId: b.id, status: "active", objectives: [], startedAt: new Date(), completedAt: null, expiresAt: null });
    }
    const capped = await mkMission(`CAPPED ${tag}`);
    const refused = await missions.acceptFactionMission(b.id, faction.id, capped.id);
    check("PRECONDITION: the accept is refused by the cap", refused.ok === false && /limit/i.test(refused.error), refused.ok ? "accepted" : refused.error);
    check("the mission is free again — available, unassigned, listed (was: stuck assigned to them)", await isFree(capped.id));
    check("and they hold no copy of it", !(await repo.has(b.id, capped.id)));

    console.log("\nFM-5 — a failed write releases the claim");
    const broken = await mkMission(`BROKEN ${tag}`);
    const store = (missions as any).playerMissions;
    const realPut = store.put.bind(store);
    store.put = async () => { throw new Error("injected write failure"); };
    let threw = false;
    try { await missions.assignMission(a.id, broken.id); } catch { threw = true; } finally { store.put = realPut; }
    check("PRECONDITION: the claim's write failed", threw);
    check("the mission is free again (was: assigned to a player with no copy)", await isFree(broken.id));
  } finally {
    s?.disconnect();
    try {
      await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
      await prisma.factionMember.deleteMany({ where: { factionId: faction.id } });
      await prisma.faction.delete({ where: { id: faction.id } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
