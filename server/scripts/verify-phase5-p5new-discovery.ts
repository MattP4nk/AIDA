/**
 * Phase 5 P5-NEW — does subnet discovery actually reach a client?
 *
 * The plan's entry says `discoverServers()` is reachable only from the dead
 * no-resource fallback of `handleSubnetSweep`, so `server:discovered` never
 * arrives. Re-deriving it from the current source gives a DIFFERENT map:
 *
 *   - `handleSubnetSweep` never calls `discoverServers` in either branch; both
 *     call `scanByPartialIp`.
 *   - `discoverServers` has exactly one caller, `legacyScan`, which is reached
 *     only when `memoryService` is absent (or topology returns nothing).
 *     `spawnBackgroundProcess` returns null ONLY when memoryService is missing,
 *     and MEMORY_SERVICE is registered unconditionally — so `legacyScan` is
 *     unreachable and `discoverServers` is dead code.
 *   - The `server:discovered` emit was already moved onto `scanByPartialIp`
 *     (the live path) in a75383d, which the plan entry predates.
 *
 * So the entry's conclusion needs testing, not its diagnosis. This drives a
 * REAL sweep over a real socket and waits for the event.
 *
 * The negative control matters here: a sweep that emits nothing and a sweep
 * that fails to run at all both produce "no event", so the test asserts the
 * command was accepted and the background process completed first.
 *
 * Run: npx tsx scripts/verify-phase5-p5new-discovery.ts   (server must be up)
 */
import "reflect-metadata";
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3001";
const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function register(tag: string) {
  const u = `${tag}${String(process.hrtime.bigint()).slice(-7)}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, email: `${u}@p5.test`, password: "Passw0rd!p5" }),
  });
  const b: any = await res.json();
  const token = b.token ?? b.data?.token;
  const userId = b.user?.id ?? b.data?.user?.id;
  if (!token) throw new Error(`register failed: ${JSON.stringify(b)}`);
  return { username: u, token, userId };
}

function open(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
    });
    const watchdog = setTimeout(() => { socket.close(); reject(new Error("connect timeout")); }, 9000);
    socket.on("connect", () => { clearTimeout(watchdog); resolve(socket); });
    socket.on("connect_error", (e: Error) => { clearTimeout(watchdog); socket.close(); reject(e); });
  });
}

/**
 * Remove a probe account AND the home server registration created for it.
 *
 * Deleting only the user left the server behind holding its IP forever. Over
 * many runs that consumed the entire address window this harness scans, and
 * the harness then failed with "no free IP" on a codebase that was fine —
 * a self-inflicted failure that looks exactly like a real one.
 */
async function cleanupProbeAccount(userId: string): Promise<void> {
  try {
    const home = await prisma.gameServer.findFirst({
      where: { ownerId: userId, isPlayerHome: true },
      select: { id: true },
    });
    await prisma.user.deleteMany({ where: { id: userId } });
    if (home) await prisma.gameServer.delete({ where: { id: home.id } });
  } catch (err) {
    // Loud: a swallowed cleanup leaves a fixture the NEXT run reads as real.
    console.error("CLEANUP FAILED (probe account):", (err as Error).message);
  }
}

async function main() {
  console.log("\n=== P5-NEW — subnet discovery reaches the client ===\n");

  // Pick a subnet that actually has seeded servers, rather than assuming
  // 10.10.10 — an assumption that would make a real failure look like a
  // missing-servers problem.
  const sample = await prisma.gameServer.findMany({
    where: { isOnline: true, isPlayerHome: false },
    select: { ipAddress: true, encryptionLevel: true },
    take: 500,
  });
  const byPrefix = new Map<string, number>();
  for (const s of sample) {
    const prefix = s.ipAddress.split(".").slice(0, 3).join(".");
    byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
  }
  const [prefix, count] = [...byPrefix.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  check("PRECONDITION: a seeded subnet with servers exists", count > 0, `${prefix}.x has ${count} servers`);
  if (!count) throw new Error("no servers to sweep");

  const acct = await register("p5");
  const socket = await open(acct.token);

  // `player:<id>` is joined inside the `authenticated` handler; without this
  // the emit has no room to land in and the test would fail for the wrong
  // reason.
  await new Promise((r) => { socket.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });

  const discovered: any[] = [];
  const results: string[] = [];
  const errors: string[] = [];
  socket.on("server:discovered", (d: any) => discovered.push(d));
  socket.on("command:result", (r: any) =>
    results.push(Array.isArray(r?.output) ? r.output.join("\n") : String(r?.output ?? "")),
  );
  socket.on("command:error", (r: any) => errors.push(String(r?.error ?? "")));

  socket.emit("command:execute", {
    command: "scan",
    args: [prefix],
    terminalCols: 100,
  });

  // The sweep spawns a background process with an ETA, so the event arrives
  // well after the command is acknowledged.
  await sleep(2000);
  const ack = results.join(" | ");
  check(
    "PRECONDITION: the scan command was accepted (not rejected on resources)",
    errors.length === 0 && /scan|ETA|PID/i.test(ack),
    errors.length ? `ERR: ${errors.join(",")}` : ack.slice(0, 90),
  );

  // Wait out the background process. Poll rather than sleeping blind so a fast
  // machine does not pad the run.
  for (let i = 0; i < 60 && discovered.length === 0; i++) await sleep(1000);

  check(
    "a real subnet sweep delivers server:discovered to the client",
    discovered.length > 0,
    discovered.length
      ? `${discovered.length} event(s), first: count=${discovered[0]?.count} subnet=${discovered[0]?.subnet}`
      : "no event after 60s — the producer is still disconnected from the live path",
  );

  if (discovered[0]) {
    const d = discovered[0];
    // The client reads count/subnet/servers and renders a notification from
    // them; a shape change here silently degrades to "Discovered 0 servers".
    check(
      "the payload carries the shape the client actually reads",
      typeof d.count === "number" && typeof d.subnet === "string" && Array.isArray(d.servers),
      `count=${typeof d.count} subnet=${typeof d.subnet} servers=${Array.isArray(d.servers)}`,
    );
    check(
      "count is non-zero, so the client does not early-return",
      d.count > 0,
      `count=${d.count} (client handler does \`if (count <= 0) return\`)`,
    );
    check(
      "servers[] is capped at 5 and carries ip/name for the notification",
      d.servers.length > 0 && d.servers.length <= 5 && d.servers.every((s: any) => s.ipAddress || s.name),
      `${d.servers.length} entries`,
    );
  }

  // The background process really did run, rather than the event arriving from
  // some other path.
  check(
    "the sweep also returned its result table to the client",
    results.some((r) => /SUBNET|sweep|IP ADDRESS|No servers/i.test(r)),
    results.length ? `${results.length} command:result messages` : "none",
  );

  socket.close();

  // ── Part 2: topology-empty fallback ───────────────────────────────────
  //
  // The synchronous branch of the adjacency scan falls back to legacy subnet
  // discovery when topology returns nothing — and that branch is unreachable,
  // because `spawnBackgroundProcess` returns null only when `memoryService` is
  // absent and MEMORY_SERVICE is registered unconditionally. So a player on a
  // server with no links was told "No unknown servers found" while the
  // fallback meant to rescue them sat in dead code.
  //
  // Construct exactly that: a player whose current server sits in a POPULATED
  // subnet but has no topology links. A player home is normally alone in its
  // own /16 (homes get random 10.x.y.z), so the subnet is re-pointed at one
  // that actually has neighbours — otherwise the fallback would run and still
  // legitimately find nothing, and the test could not tell that apart from the
  // fallback never running.
  console.log("\nP5-NEW part 2 — topology-empty falls back to subnet discovery");
  {
    const acct2 = await register("p5b");
    const home = await prisma.gameServer.findFirst({
      where: { ownerId: acct2.userId, isPlayerHome: true },
      select: { id: true, ipAddress: true },
    });
    check("PRECONDITION: the new player has a home server", !!home, home?.ipAddress ?? "none");
    if (!home) throw new Error("no home server");

    // Move it into the populated subnet found above.
    // Scan the whole usable range, not a 50-address window. The original
    // 200-249 window filled up — partly with this harness's OWN leaked home
    // servers (one per run, see the cleanup below) and partly with dungeon
    // content that legitimately moved in — and then the harness failed with
    // "no free IP" on a codebase that was perfectly fine.
    let placedIp: string | null = null;
    for (let host = 2; host < 255 && !placedIp; host++) {
      const candidate = `${prefix}.${host}`;
      const taken = await prisma.gameServer.findUnique({ where: { ipAddress: candidate } });
      if (!taken) placedIp = candidate;
    }
    if (!placedIp) throw new Error("no free IP in the populated subnet");
    await prisma.gameServer.update({ where: { id: home.id }, data: { ipAddress: placedIp } });
    await prisma.user.update({ where: { id: acct2.userId }, data: { homeIp: placedIp } });

    // Connect and authenticate FIRST. `gameStateManager.createSession` calls
    // `networkTopologyService.createHomeLink` as a "fallback if registration
    // missed it", so it RE-CREATES the home link. Stripping links before
    // authenticating — which is what the first version of this test did —
    // gets them silently restored, and the scan then legitimately finds a
    // neighbour. The system self-heals the exact state the test is trying to
    // construct, so the strip has to happen after the healing step.
    const s2 = await open(acct2.token);
    await new Promise((r) => { s2.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });

    const removed = await prisma.serverLink.deleteMany({
      where: { OR: [{ sourceId: home.id }, { targetId: home.id }] },
    });

    // An empty `serverLink` table is NOT the same as an empty adjacency
    // result: `getAdjacentServers` reads through a 30s per-server cache
    // (ADJ_CACHE_TTL). Asserting the DB alone is asserting the wrong thing.
    const dbLinks = await prisma.serverLink.count({
      where: { OR: [{ sourceId: home.id }, { targetId: home.id }] },
    });
    check(
      "PRECONDITION: the home server now has no topology links",
      dbLinks === 0 && removed.count > 0,
      `${removed.count} link(s) removed, ${dbLinks} remain`,
    );
    console.log("    (waiting out the 30s adjacency cache...)");
    await sleep(32_000);

    const disc2: any[] = [];
    const out2: string[] = [];
    s2.on("server:discovered", (d: any) => disc2.push(d));
    s2.on("command:result", (r: any) =>
      out2.push(Array.isArray(r?.output) ? r.output.join("\n") : String(r?.output ?? "")),
    );

    s2.emit("command:execute", { command: "scan", args: [], terminalCols: 100 });

    for (let i = 0; i < 60 && disc2.length === 0; i++) await sleep(1000);

    const text = out2.join("\n");
    check(
      "the topology-empty scan falls back to legacy subnet discovery",
      /Subnet Scan:/i.test(text),
      text.includes("No unknown servers found")
        ? 'got "No unknown servers found" — the fallback did not run'
        : text.split("\n").find((l) => /Subnet Scan:/i.test(l)) ?? text.slice(0, 80),
    );
    check(
      "and it emits server:discovered, which was dead code before",
      disc2.length > 0 && disc2[0]?.count > 0,
      disc2.length ? `count=${disc2[0]?.count} subnet=${disc2[0]?.subnet}` : "no event",
    );

    s2.close();

    // Delete the home server TOO, not just the user. Deleting only the user
    // left its server behind holding an address forever — that is what
    // exhausted the 50-address scan window above, a harness degrading the
    // database a little on every run until it failed because of it.
    await cleanupProbeAccount(acct2.userId);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
