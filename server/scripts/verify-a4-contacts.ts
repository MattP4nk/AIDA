/**
 * Contacts are a MUTUAL relationship (maintainer decision Q5, 2026-10-08).
 *
 * `contact add` wrote a row with status "pending" and nothing ever changed
 * it: no accept flow, so every contact read "(pending)" forever. Now:
 * add → request (the other player is notified) → accept/decline; accepting
 * makes it mutual; the chat contact list shows ACCEPTED contacts only;
 * remove ends it from both sides.
 *
 * Earlier fixes on the same path, kept and re-checked (A4, 2026-10-07/08):
 * no self-add; two concurrent adds do not throw P2002 as "Command execution
 * failed"; by-name lookups are case-insensitive; remove says when there was
 * nothing to remove.
 *
 * In-process: the database is the arbiter of the races.
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
  console.log("\n=== Contacts: request, accept, mutual ===");
  const tag = `a4c${Date.now().toString(36)}`;
  const me = await register(`${tag}m`);
  const them = await register(`${tag}t`);
  const third = await register(`${tag}x`);
  const fourth = await register(`${tag}y`);
  const everyone = [me, them, third, fourth].map((u) => u.id);
  try {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const chat = getService<any>(TOKENS.CHAT_SERVICE);
    const chatNames = async (id: string) => ((await chat.getChatContacts(id)).data?.contacts ?? []).map((c: any) => c.username as string);

    console.log("\nC-1 — kept: no self-add, no race crash");
    const self = await chat.addContact(me.id, me.username);
    check("adding yourself is refused", self.ok === false && /yourself/.test(self.message), self.message);
    const settled = await Promise.allSettled([chat.addContact(me.id, them.username), chat.addContact(me.id, them.username)]);
    const rejected = settled.filter((s) => s.status === "rejected");
    check("two concurrent adds: neither THROWS (was: P2002 → 'Command execution failed')", rejected.length === 0,
      rejected.map((r: any) => r.reason?.code ?? r.reason?.message).join(", "));
    const vals = settled.filter((s): s is PromiseFulfilledResult<any> => s.status === "fulfilled").map((s) => s.value);
    check("exactly one request sent, the other told so",
      vals.filter((v) => v.ok).length === 1 && vals.some((v) => !v.ok && /already sent/.test(v.message)),
      vals.map((v) => v.message).join(" | "));
    const shouty = await chat.addContact(me.id, them.username.toUpperCase());
    check("a differently-cased name finds the same user", shouty.ok === false && /already sent/.test(shouty.message), shouty.message);

    console.log("\nC-2 — a request is a REQUEST, until accepted");
    const mine = await chat.listContacts(me.id);
    const theirs = await chat.listContacts(them.id);
    check("my side lists it as outgoing (pending)", mine.outgoing.includes(them.username) && !mine.accepted.includes(them.username));
    check("their side lists it as INCOMING", theirs.incoming.includes(me.username));
    const notified = await prisma.notification.count({ where: { userId: them.id, type: "contact_request" } });
    check("they were notified", notified === 1, `${notified}`);
    check("a pending request is NOT in the chat contact list", !(await chatNames(me.id)).includes(them.username));

    console.log("\nC-3 — accept makes it mutual");
    const acc = await chat.acceptContact(them.id, me.username);
    check("accept succeeds", acc.ok === true, acc.message);
    const m2 = await chat.listContacts(me.id), t2 = await chat.listContacts(them.id);
    check("both sides list each other as ACCEPTED (was: '(pending)' forever)",
      m2.accepted.includes(them.username) && t2.accepted.includes(me.username) && m2.outgoing.length === 0 && t2.incoming.length === 0);
    check("and both see each other in chat", (await chatNames(me.id)).includes(them.username) && (await chatNames(them.id)).includes(me.username));
    const twice = await chat.acceptContact(them.id, me.username);
    check("accepting again is refused (nothing pending)", twice.ok === false && /No pending request/.test(twice.message), twice.message);
    check("the requester was told", (await prisma.notification.count({ where: { userId: me.id, type: "contact_accepted" } })) === 1);

    console.log("\nC-4 — decline");
    await chat.addContact(third.id, me.username);
    const dec = await chat.declineContact(me.id, third.username);
    check("decline succeeds and deletes the request", dec.ok === true &&
      (await prisma.contact.count({ where: { userId: third.id, contactUserId: me.id } })) === 0, dec.message);
    const decAgain = await chat.declineContact(me.id, third.username);
    check("declining nothing says so", decAgain.ok === false && /No pending request/.test(decAgain.message), decAgain.message);

    console.log("\nC-5 — two people adding each other become mutual");
    await chat.addContact(me.id, fourth.username);
    const cross = await chat.addContact(fourth.id, me.username);
    const m3 = await chat.listContacts(me.id);
    check("the second add ACCEPTS the first (not two dangling requests)",
      cross.ok === true && m3.accepted.includes(fourth.username) && !m3.outgoing.includes(fourth.username), cross.message);

    console.log("\nC-6 — remove ends it from both sides");
    const removed = await chat.removeContact(me.id, them.username.toUpperCase());
    const rows = await prisma.contact.count({ where: { OR: [{ userId: me.id, contactUserId: them.id }, { userId: them.id, contactUserId: me.id }] } });
    check("both rows are gone", removed.ok === true && rows === 0, `${removed.message} / ${rows} rows`);
    const again = await chat.removeContact(me.id, them.username);
    check("removing a non-contact says so", again.ok === false && /not in your contacts/.test(again.message), again.message);
  } finally {
    try {
      await prisma.contact.deleteMany({ where: { OR: [{ userId: { in: everyone } }, { contactUserId: { in: everyone } }] } });
      await prisma.notification.deleteMany({ where: { userId: { in: everyone }, type: { in: ["contact_request", "contact_accepted"] } } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
