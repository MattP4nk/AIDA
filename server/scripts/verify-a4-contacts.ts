/**
 * A4 — `contact add/remove` through ChatService.
 *
 * socialCommands did a find-then-create: two concurrent adds both passed the
 * find, the loser hit `@@unique([userId, contactUserId])`, and the P2002
 * escaped as "Command execution failed". A player could add themselves.
 * `contact remove` reported "Removed" for someone who was never a contact.
 *
 * In-process: the database is the arbiter of the race.
 * Needs the dev server (registration). Run: npx tsx scripts/verify-a4-contacts.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
async function register(tag: string) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const j: any = await r.json();
  if (!j?.token) throw new Error(`register ${tag}: ${r.status}`);
  return { id: j.user.id as string, username: tag };
}

async function main() {
  console.log("\n=== A4 — contacts: no self-add, no race crash, honest remove ===");
  const tag = `a4c${Date.now().toString(36)}`;
  const me = await register(`${tag}m`);
  const them = await register(`${tag}t`);
  try {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const chat = getService<any>(TOKENS.CHAT_SERVICE);

    const self = await chat.addContact(me.id, me.username);
    check("adding yourself is refused", self.ok === false && /yourself/.test(self.message), self.message);
    check("and wrote nothing", (await prisma.contact.count({ where: { userId: me.id } })) === 0);

    const settled = await Promise.allSettled([chat.addContact(me.id, them.username), chat.addContact(me.id, them.username)]);
    const rejected = settled.filter((s) => s.status === "rejected");
    check("two concurrent adds: neither THROWS (was: P2002 → 'Command execution failed')", rejected.length === 0,
      rejected.map((r: any) => r.reason?.code ?? r.reason?.message).join(", "));
    const vals = settled.filter((s): s is PromiseFulfilledResult<any> => s.status === "fulfilled").map((s) => s.value);
    check("exactly one added, the other told it already exists",
      vals.filter((v) => v.ok).length === 1 && vals.some((v) => !v.ok && /already exists/.test(v.message)),
      vals.map((v) => v.message).join(" | "));
    check("one row", (await prisma.contact.count({ where: { userId: me.id } })) === 1);

    const removed = await chat.removeContact(me.id, them.username);
    check("POSITIVE: remove a real contact", removed.ok === true && (await prisma.contact.count({ where: { userId: me.id } })) === 0, removed.message);
    const again = await chat.removeContact(me.id, them.username);
    check("removing a non-contact says so (was: 'Removed')", again.ok === false && /not in your contacts/.test(again.message), again.message);
  } finally {
    try {
      await prisma.contact.deleteMany({ where: { userId: { in: [me.id, them.id] } } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
