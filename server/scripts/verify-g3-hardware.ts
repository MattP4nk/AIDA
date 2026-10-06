/**
 * G3 — hardware actually changes the rig.
 *
 * The whole point of this feature is that a bought part raises the resource
 * ceiling, so this harness asserts the NUMBERS, over the real socket path, not
 * that a command printed something hopeful. Before G3 every one of these
 * assertions failed: the parts were unbuyable, unequippable, capped at one, and
 * never reached `initComputerSpec` anyway.
 *
 * Every negative assertion carries a positive control — an assertion that passes
 * against empty output is not a test (PLAN.md "Method learnings" §2).
 */
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";

const BASE = "http://localhost:3001";
const prisma = new PrismaClient();
const stamp = process.env.G3_STAMP || String(process.hrtime.bigint()).slice(-8);
const USERNAME = `g3h${stamp}`;

const rows: Array<[string, boolean, string]> = [];
function check(name: string, ok: boolean, why: string) {
  rows.push([name, ok, why]);
}

function asText(o: unknown): string {
  return Array.isArray(o) ? o.join("\n") : String(o ?? "");
}

/** Pull "RAM  x / y" style totals out of the `specs` box. */
function parseSpecs(out: string): { cpu?: number; ram?: number; bw?: number } {
  const grab = (label: string) => {
    const m = out.match(new RegExp(`${label}\\s+(\\d+)\\s*/\\s*(\\d+)`));
    return m ? Number(m[2]) : undefined;
  };
  return { cpu: grab("CPU"), ram: grab("RAM"), bw: grab("NET") };
}

async function main() {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: USERNAME,
      email: `${USERNAME}@example.test`,
      password: "Passw0rd!g3h",
    }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`register failed ${res.status}: ${JSON.stringify(body)}`);
  const token = body.token ?? body.data?.token;
  const userId = body.user?.id ?? body.data?.user?.id;

  // Fund AND level the account.
  //
  // Level matters: tier-2 parts require level 10 and tier-3 level 25. The first
  // run of this harness left the player at level 1, so `buy ram_module_mk2` was
  // correctly refused and four assertions failed for a reason that had nothing
  // to do with supersession. Level 30 clears every tier.
  //
  // Level 30 also puts `Math.floor(level / 10) * N` at 3 steps, so the baseline
  // is not the stock 200/256/100 — which is why every assertion below is
  // expressed as a DELTA from the measured baseline rather than an absolute.
  await prisma.playerProgress.update({
    where: { userId },
    data: { credits: 50000, level: 30 },
  });

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

  async function run(cmd: string, args: string[] = [], waitMs = 5000): Promise<string> {
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
    console.log(`\n$ ${cmd} ${args.join(" ")}\n${out || "(no output)"}`);
    return out;
  }

  // ── Baseline ──
  const baseOut = await run("specs");
  const base = parseSpecs(baseOut);
  // POSITIVE CONTROL: if `specs` produced nothing parseable, every delta below
  // would compare undefined to undefined and "pass".
  check(
    "specs renders parseable totals",
    base.cpu !== undefined && base.ram !== undefined && base.bw !== undefined,
    `cpu=${base.cpu} ram=${base.ram} bw=${base.bw}`,
  );
  check(
    "no hardware installed at start",
    /none\s*—\s*stock|none — stock/.test(baseOut),
    baseOut.includes("stock") ? "all three channels stock" : "MISSING stock rows",
  );

  // ── Buy tier 1 RAM: +64 ──
  await run("buy", ["ram_module_mk1"], 6000);
  const t1Out = await run("specs");
  const t1 = parseSpecs(t1Out);
  check(
    "tier-1 RAM raises the RAM ceiling by 64",
    base.ram !== undefined && t1.ram === base.ram + 64,
    `${base.ram} -> ${t1.ram}`,
  );
  check(
    "specs names the installed part",
    /RAM Module Mk1/.test(t1Out),
    t1Out.match(/RAM\s+RAM Module Mk1[^\n]*/)?.[0]?.trim() ?? "NOT NAMED",
  );
  check(
    "other channels are untouched",
    t1.cpu === base.cpu && t1.bw === base.bw,
    `cpu ${base.cpu}->${t1.cpu}, bw ${base.bw}->${t1.bw}`,
  );

  // ── Buy tier 2 RAM: supersedes, +128 not +192, and trades in the Mk1 ──
  const creditsBefore = (await prisma.playerProgress.findUnique({
    where: { userId }, select: { credits: true },
  }))?.credits ?? 0;

  const buy2 = await run("buy", ["ram_module_mk2"], 6000);
  const t2Out = await run("specs");
  const t2 = parseSpecs(t2Out);

  check(
    "tier-2 SUPERSEDES tier-1 (not cumulative)",
    base.ram !== undefined && t2.ram === base.ram + 128,
    `${t2.ram} (expected ${base.ram !== undefined ? base.ram + 128 : "?"}, cumulative would be ${base.ram !== undefined ? base.ram + 192 : "?"})`,
  );
  check(
    "specs now names the Mk2",
    /RAM Module Mk2/.test(t2Out) && !/RAM Module Mk1/.test(t2Out),
    t2Out.match(/RAM\s+RAM Module Mk2[^\n]*/)?.[0]?.trim() ?? "NOT NAMED",
  );
  check(
    "purchase output reports the trade-in",
    /Traded in RAM Module Mk1/.test(buy2),
    buy2.match(/Traded in[^\n]*/)?.[0] ?? "NO TRADE-IN LINE",
  );

  // The superseded part is gone from inventory, and its 50% came back.
  const mk1Rows = await prisma.inventoryItem.count({
    where: { userId, shopItemId: "ram_module_mk1" },
  });
  check("superseded part removed from inventory", mk1Rows === 0, `${mk1Rows} rows`);

  const creditsAfter = (await prisma.playerProgress.findUnique({
    where: { userId }, select: { credits: true },
  }))?.credits ?? 0;
  // Mk2 costs 2000, Mk1 refunds 250 (half of 500) => net -1750.
  check(
    "trade-in refunds 50% of the superseded part",
    creditsBefore - creditsAfter === 1750,
    `${creditsBefore} -> ${creditsAfter} (net ${creditsBefore - creditsAfter}, expected 1750)`,
  );

  // ── A different channel stacks alongside RAM ──
  await run("buy", ["cpu_fan_upgrade"], 6000);
  const t3 = parseSpecs(await run("specs"));
  check(
    "a second channel adds on top (CPU +50, RAM kept)",
    base.cpu !== undefined && t3.cpu === base.cpu + 50 && t3.ram === t2.ram,
    `cpu ${base.cpu}->${t3.cpu}, ram held at ${t3.ram}`,
  );

  // ── Hardware is installed, NOT equipped ──
  const equipOut = await run("equip", ["ram_module_mk2"], 5000);
  check(
    "hardware cannot be equipped",
    /cannot be equipped|installed/i.test(equipOut),
    equipOut.split("\n")[0]?.slice(0, 70) ?? "(no output)",
  );

  // ── Persona tokens moved but stay reward-only ──
  const buyToken = await run("buy", ["token_steele_briefing"], 5000);
  check(
    "persona tokens cannot be bought",
    /has to be earned|cannot be bought/i.test(buyToken),
    buyToken.split("\n")[0]?.slice(0, 70) ?? "(no output)",
  );

  const tokenRow = await prisma.shopItem.findUnique({
    where: { id: "token_steele_briefing" },
  });
  check(
    "token row exists with itemType=token",
    tokenRow?.itemType === "token",
    `itemType=${tokenRow?.itemType}`,
  );
  check(
    "token kept its effect.personaName",
    (tokenRow?.effect as any)?.personaName === "Commander Steele",
    JSON.stringify(tokenRow?.effect ?? null),
  );
  check(
    "token is inactive (reward-only) in the table",
    tokenRow?.isActive === false,
    `isActive=${tokenRow?.isActive}`,
  );

  // ── The old seed universe is gone ──
  const seedRows = await prisma.shopItem.count({
    where: { id: { startsWith: "seed_" } },
  });
  check("no seed_* shop rows remain", seedRows === 0, `${seedRows} rows`);

  // ── The shop does not advertise reward-only items ──
  const shopOut = await run("shop", [], 6000);
  check(
    "shop lists items at all (positive control)",
    shopOut.length > 60,
    `${shopOut.length} chars`,
  );
  check(
    "shop does not list persona tokens",
    !/Briefing Token|Dead Drop Token|Architect's Seal/.test(shopOut),
    "no token names in listing",
  );

  socket.close();

  console.log("\n===== G3 HARDWARE =====");
  for (const [n, ok, why] of rows) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${n.padEnd(46)} ${why}`);
  }
  const failed = rows.filter(([, ok]) => !ok).length;
  console.log(`\n${rows.length - failed}/${rows.length} passed`);
  console.log("=======================");
  await prisma.$disconnect();
  if (failed) process.exitCode = 1;
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
