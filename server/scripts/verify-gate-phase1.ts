/**
 * Phase 1 exit gate — the three legs the tutorial harness does not cover.
 *
 *   1. accept a generated mission → complete it with the correct target
 *   2. buy an item → see it in `scripts` (and in the resource economy)
 *   3. hack a server whose encryption actually matters (G4)
 *
 * Drives the real socket path, like verify-tutorial-altpath.ts. Every negative
 * assertion carries a positive control: an assertion that passes against empty
 * output is not a test (see PLAN.md "Method learnings" §2).
 */
import "reflect-metadata";
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3001";
const prisma = new PrismaClient();

// D3 pass 2: mission state lives in PlayerMission/PlayerMissionObjective now.
// This harness used to seed and read `playerProgress.missionProgress` directly
// — reaching behind the app's own API — so a storage change broke it for
// reasons unrelated to the behaviour it asserts. It goes through the
// repository now, the same way the game does.
let _missionRepo: any = null;
function missionRepo() {
  if (!_missionRepo) {
    const { PlayerMissionRepository } = require("../src/repositories/playerMissionRepository");
    const pino = require("pino");
    _missionRepo = new PlayerMissionRepository(pino({ level: "silent" }), prisma);
  }
  return _missionRepo;
}

/** The old blob shape (missionId -> mission), rebuilt from the repository so
 *  the assertions below did not have to change. Deliberately NOT a repository
 *  method: the game has no use for it, and API added for a test is API. */
async function missionMap(userId: string): Promise<Record<string, any>> {
  const out: Record<string, any> = {};
  for (const m of await missionRepo().list(userId)) out[m.missionId] = m;
  return out;
}
const stamp = process.env.GATE_STAMP || String(process.hrtime.bigint()).slice(-8);
const USERNAME = `gate${stamp}`;

const rows: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, why: string) {
  rows.push([name, ok, why]);
}

// Container is set up ONCE, up front. It previously lived inside the
// mission-objectives branch, so skipping that branch left leg 3 resolving
// services from an uninitialised container.
let TOKENS: typeof import("../src/di/tokens");
let getService: typeof import("../src/di/container").getService;
async function initContainer() {
  const container = await import("../src/di/container");
  TOKENS = await import("../src/di/tokens");
  getService = container.getService;
  const pino = (await import("pino")).default;
  const { Server: SocketIOServer } = await import("socket.io");
  container.setupContainer(new SocketIOServer(), prisma as any, pino({ level: "warn" }) as any);
}

function asText(o: unknown): string {
  return Array.isArray(o) ? o.join("\n") : String(o ?? "");
}

async function main() {
  await initContainer();

  // ── register + authenticate ──
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: USERNAME,
      email: `${USERNAME}@example.test`,
      password: "Passw0rd!gate",
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`register failed ${res.status}: ${JSON.stringify(body)}`);
  const token = body.token ?? body.data?.token;
  const userId = body.user?.id ?? body.data?.user?.id;

  const socket = ioClient(BASE, { auth: { token }, transports: ["websocket"] });
  await new Promise<void>((r, j) => {
    socket.on("connect", () => r());
    socket.on("connect_error", (e: Error) => j(new Error(`connect_error: ${e.message}`)));
    setTimeout(() => j(new Error("socket connect timeout")), 15000);
  });
  const ack: any = await new Promise((r, j) => {
    socket.emit("authenticated", (a: any) => r(a));
    setTimeout(() => j(new Error("auth ack timeout")), 15000);
  });
  if (!ack?.success) throw new Error(`auth failed: ${JSON.stringify(ack)}`);

  const inbox: string[] = [];
  socket.on("command:result", (r: any) => inbox.push(asText(r?.output)));
  socket.on("command:error", (r: any) => inbox.push(`ERROR: ${r?.error}`));

  async function run(cmd: string, args: string[] = [], waitMs = 4000, quiet = false): Promise<string> {
    const before = inbox.length;
    socket.emit("command:execute", { command: cmd, args, terminalCols: 100 });
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (inbox.length > before) {
        await new Promise((r) => setTimeout(r, 400));
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const out = inbox.slice(before).join("\n---\n");
    if (!quiet) console.log(`\n$ ${cmd} ${args.join(" ")}\n${out || "(no output)"}`);
    return out;
  }

  // ════════════════════════════════════════════════════════════════
  // LEG 2 (first — it needs credits, which registration grants)
  // buy an item → see it in `scripts`
  // ════════════════════════════════════════════════════════════════
  console.log("\n########## LEG: buy an item → see it in scripts ##########");

  const startCredits = (await prisma.playerProgress.findUnique({
    where: { userId },
    select: { credits: true },
  }))?.credits ?? 0;

  const shopOut = await run("shop", [], 6000);
  // Positive control: the shop must actually list something, else "item absent
  // from inventory" below would pass vacuously.
  check("shop lists items", /\d+\s*cr|credits|price/i.test(shopOut) && shopOut.length > 40, `${shopOut.length} chars`);

  // Pick a real, affordable, level-1 item straight from the DB so the test does
  // not depend on parsing the shop's box drawing.
  const affordable = await prisma.shopItem.findFirst({
    where: { price: { lte: Math.max(1, startCredits) }, level: { lte: 1 } },
    orderBy: { price: "asc" },
    select: { id: true, name: true, price: true, category: true },
  });
  if (!affordable) throw new Error(`no affordable level-1 shop item (credits=${startCredits})`);
  console.log(`\n[target item] ${affordable.name} (${affordable.id}) ${affordable.price}cr — credits ${startCredits}`);

  const invBefore = await prisma.inventoryItem.count({ where: { userId } });
  const buyOut = await run("buy", [affordable.id], 8000);
  const invAfter = await prisma.inventoryItem.count({ where: { userId } });
  const creditsAfter = (await prisma.playerProgress.findUnique({
    where: { userId },
    select: { credits: true },
  }))?.credits ?? 0;

  check("buy succeeds", invAfter > invBefore, `inventory rows ${invBefore} → ${invAfter}`);
  check(
    "credits were deducted",
    creditsAfter === startCredits - affordable.price,
    `${startCredits} → ${creditsAfter} (expected −${affordable.price})`,
  );
  check("buy did not error", !/ERROR:|failed|cannot|insufficient/i.test(buyOut), buyOut.slice(0, 70).replace(/\n/g, " "));

  // The G3 bug was that granted items were filtered out of the inventory view.
  const scriptsOut = await run("scripts", [], 6000);
  check(
    "purchased item appears in scripts",
    scriptsOut.includes(affordable.name),
    `looking for "${affordable.name}"`,
  );

  // ════════════════════════════════════════════════════════════════
  // LEG 1: accept a generated mission → complete it with the correct target
  // ════════════════════════════════════════════════════════════════
  console.log("\n########## LEG: accept a mission → complete it ##########");

  // Generation can involve AI template work on first call — allow for it.
  const missionsOut = await run("missions", [], 45000);
  check("missions list renders", missionsOut.length > 40 && !/ERROR:/i.test(missionsOut), `${missionsOut.length} chars`);

  // Seed an offer into the PLAYER'S OWN blob, exactly as missionGenerator does
  // (missionGenerator.ts:178-205). This is deliberate, not a shortcut:
  //
  //  - Offers are per-player. A Mission row with `assignedTo: null` is NOT
  //    acceptable by design — `acceptMission` requires the player to already
  //    hold it. An earlier version of this harness picked a raw row and then
  //    reported a code bug that was really a harness bug.
  //  - M2 (AI-bound provisioning with an all-or-nothing write-back) means the
  //    generator does not reliably deliver offers yet, so waiting on it would
  //    make every crediting assertion below untestable. MISSIONS_ARCHITECTURE.md
  //    §8 says to verify Tier 1 against a directly-seeded mission for exactly
  //    this reason.
  const template = await prisma.mission.findFirst({
    where: { type: { not: "tutorial" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, objectives: true },
  });

  let available: { id: string; title: string; objectives: unknown } | null = null;
  if (template) {
    const seeded = await prisma.mission.create({
      data: {
        title: `[gate] ${template.title}`,
        description: "Seeded by verify-gate-phase1 to test accept + crediting.",
        type: "hack",
        difficulty: 1,
        reward: { xp: 10, credits: 10 } as any,
        objectives: template.objectives as any,
        status: "available",
      },
      select: { id: true, title: true, objectives: true },
    });

    // Mirror it into the player's blob as an offer, with progress initialised
    // the way the generator does (typed by each objective's target).
    await missionRepo().put(userId, seeded.id, {
      missionId: seeded.id,
      userId,
      status: "available",
      objectives: (seeded.objectives as any[]).map((o) => ({
        ...o,
        current: typeof o.target === "number" ? 0 : typeof o.target === "boolean" ? false : "",
        completed: false,
      })),
      startedAt: null,
      completedAt: null,
      expiresAt: null,
    });
    available = seeded;
  }

  if (!available) {
    check("a seedable mission template exists", false, "no non-tutorial Mission row to copy objectives from");
  } else {
    console.log(`\n[seeded offer] ${available.title} (${available.id})`);

    // Accept it the way a player does — by id, through the command.
    const acceptOut = await run("accept", [available.id], 15000);

    const mp = await missionMap(userId);
    const entry = mp[available.id];

    check("accept did not error", !/ERROR:|cannot|not assigned|Failed to accept/i.test(acceptOut), acceptOut.slice(0, 60).replace(/\n/g, " "));
    check("accept registers mission progress", !!entry, `missionProgress has ${Object.keys(mp).length} entries`);
    check("accepted mission is active", entry?.status === "active", `status=${entry?.status}`);

    const objs: any[] = Array.isArray(entry?.objectives) ? entry.objectives : [];
    check("mission has objectives", objs.length > 0, `${objs.length} objectives`);

    if (objs.length > 0) {
      const missionService = getService<import("../src/services/missionService").MissionService>(
        TOKENS.MISSION_SERVICE,
      );
      const obj = objs[0];
      const target = obj.target;
      const done = typeof target === "number" ? target : true;
      await missionService.updateObjective(userId, available.id, obj.id, done as any);

      const afterOne = await missionMap(userId);
      const o1 = afterOne[available.id]?.objectives?.find((o: any) => o.id === obj.id);
      check(
        "objective completes at its target",
        o1?.completed === true,
        `target=${JSON.stringify(target)} current=${JSON.stringify(o1?.current)} completed=${o1?.completed}`,
      );

      // G1: a later smaller report must not un-complete it.
      await missionService.updateObjective(userId, available.id, obj.id, (typeof target === "number" ? 0 : false) as any);
      const afterTwo = await missionMap(userId);
      const o2 = afterTwo[available.id]?.objectives?.find((o: any) => o.id === obj.id);
      check("completion is sticky (G1)", o2?.completed === true, `after a 0/false report: completed=${o2?.completed}`);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // LEG 3: hack a server whose encryption actually matters (G4)
  // ════════════════════════════════════════════════════════════════
  console.log("\n########## LEG: encryption actually gates access (G4) ##########");

  const enc = await prisma.gameServer.findFirst({
    where: { encryptionLevel: { gte: 4 } },
    select: { id: true, name: true, ipAddress: true, encryptionLevel: true },
    orderBy: { encryptionLevel: "desc" },
  });
  const plain = await prisma.gameServer.findFirst({
    where: { encryptionLevel: 0, isPlayerHome: false },
    select: { id: true, name: true, ipAddress: true, encryptionLevel: true },
  });
  if (!enc || !plain) throw new Error("need one high-encryption and one enc-0 server");

  const level = (await prisma.playerProgress.findUnique({ where: { userId }, select: { level: true } }))?.level ?? 1;
  const required = Math.max(1, enc.encryptionLevel * 2);
  console.log(`\n[encrypted target] ${enc.name} ${enc.ipAddress} enc=${enc.encryptionLevel} → requires level ${required}; player is level ${level}`);

  const serverService = getService<import("../src/services/serverService").default>(
    TOKENS.SERVER_SERVICE,
  );

  const gateHigh = await serverService.canAccessServer(userId, enc.id);
  const gateLow = await serverService.canAccessServer(userId, plain.id);

  // G4: the gate must REFUSE a level-1 player on an enc-5 server...
  check(
    "encryption gate refuses under-level player",
    gateHigh?.canAccess === false,
    `enc=${enc.encryptionLevel} needs level ${required}, player ${level} → canAccess=${gateHigh?.canAccess} (${gateHigh?.reason})`,
  );
  // ...and positive control: it must NOT refuse on an unencrypted server, or the
  // assertion above would pass simply because the gate refuses everything.
  check(
    "unencrypted server is not gated (control)",
    gateLow?.canAccess === true,
    `enc=0 → canAccess=${gateLow?.canAccess} (${gateLow?.reason})`,
  );

  // Owner bypass — the regression G4 nearly shipped (players locked out of home).
  const home = await prisma.gameServer.findFirst({
    where: { ownerId: userId },
    select: { id: true, ipAddress: true, encryptionLevel: true },
  });
  if (home) {
    const gateHome = await serverService.canAccessServer(userId, home.id);
    check(
      "owner can always reach own home server",
      gateHome?.canAccess === true,
      `home enc=${home.encryptionLevel} → canAccess=${gateHome?.canAccess} (${gateHome?.reason})`,
    );
  }

  // ── results ──
  console.log("\n\n================ PHASE 1 GATE RESULTS ================");
  for (const [n, ok, why] of rows) console.log(`${ok ? "PASS" : "FAIL"}  ${n.padEnd(42)} ${why}`);
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  console.log("=====================================================");
  if (failed > 0) process.exitCode = 1;

  socket.close();
}

main()
  .catch((e) => {
    console.error("\nHARNESS ERROR:", e?.stack ?? e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
