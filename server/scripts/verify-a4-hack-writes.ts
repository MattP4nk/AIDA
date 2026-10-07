/**
 * A4 — hackCommands' writes, through their services.
 *
 * `crack.protected` consumed its Quantum Decryptor Charge with a direct
 * inventoryItem delete/decrement: a find-then-act a concurrent command could
 * interleave with, and — the visible part — no `item:removed`, the event that
 * makes gameStateManager push the inventory slice. The player spent the charge
 * and their client kept showing it. It now goes through
 * shopService.removeItemFromInventory (atomic, emits). The protection change
 * goes through fileService.setNodeFlags.
 *
 * End to end over a real socket against the dev server: the bug is the
 * missing PUSH, which only a connected client can observe.
 *
 * Needs the dev server. Run: npx tsx scripts/verify-a4-hack-writes.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// The server has no socket.io-client dependency; harnesses borrow the client's.
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\n=== A4 — crack.protected spends its charge through the shop ===");
  const tag = `a4h${Date.now().toString(36)}`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const reg: any = await r.json();
  check("PRECONDITION: fixture account", !!reg?.token, `${r.status}`);
  const userId: string = reg.user.id;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { homeServerId: true } });
  const home = await prisma.fileSystemNode.findFirstOrThrow({
    where: { serverId: user.homeServerId!, name: tag, type: "directory" }, select: { id: true },
  });

  // crack.protected is skill-gated (cryptography 40); a new player has 5.
  await prisma.playerProgress.update({ where: { userId }, data: { cryptography: 40 } });
  // Fixtures: ONE charge, and a protected file in the player's home dir.
  const item = await prisma.inventoryItem.create({ data: { userId, shopItemId: "quantum_charge", quantity: 1 } });
  const file = await prisma.fileSystemNode.create({
    data: { serverId: user.homeServerId!, parentId: home.id, name: "locked.dat", type: "file", content: "x", size: 1, isProtected: true },
  });

  const s = ioClient(BASE, { auth: { token: reg.token }, transports: ["websocket"], reconnection: false });
  try {
    await new Promise<void>((res, rej) => {
      s.once("connect_error", rej);
      s.once("connect", () => s.emit("authenticate:request", (a: any) => (a?.success ? res() : rej(new Error(JSON.stringify(a))))));
    });
    const run = (command: string): Promise<string> => new Promise((res) => {
      const t = setTimeout(() => res("<timeout>"), 8000);
      s.once("command:result", (x: any) => { clearTimeout(t); res(Array.isArray(x?.output) ? x.output.join("\n") : String(x?.output ?? "")); });
      s.emit("command:execute", { command, terminalId: "a4" });
    });
    // A fresh session is on no server; crack.protected acts on the current one.
    const conn = await run("connect home");
    check("PRECONDITION: connected to the home server", !/not connected|error|denied/i.test(conn), conn.split("\n")[0]);
    const deltas: string[] = [];
    s.on("state:delta", (d: any) => deltas.push(d?.delta?.path));
    await sleep(300);
    deltas.length = 0; // ignore anything from the login itself

    const result: any = await new Promise((res) => {
      const t = setTimeout(() => res({ output: "<timeout>" }), 8000);
      s.once("command:result", (x) => { clearTimeout(t); res(x); });
      s.emit("command:execute", { command: `crack.protected /home/${tag}/locked.dat`, terminalId: "a4" });
    });
    const out = Array.isArray(result?.output) ? result.output.join("\n") : String(result?.output ?? "");
    check("the command succeeded", /Protection layer dissolved/.test(out), out.split("\n")[0]);
    for (let i = 0; i < 20 && !deltas.includes("inventory"); i++) await sleep(100);

    const left = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    check("the charge was spent", !left || left.quantity === 0, left ? `quantity ${left.quantity}` : "row removed");
    const after = await prisma.fileSystemNode.findUnique({ where: { id: file.id }, select: { isProtected: true } });
    check("the file is no longer protected", after?.isProtected === false);
    check("the client was PUSHED its new inventory (it never was)", deltas.includes("inventory"),
      deltas.length ? `deltas: ${[...new Set(deltas)].join(", ")}` : "no state:delta at all");
  } finally {
    s.disconnect();
    try {
      await prisma.fileSystemNode.deleteMany({ where: { id: file.id } });
      await prisma.inventoryItem.deleteMany({ where: { id: item.id } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
