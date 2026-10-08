/**
 * A failed `fragment.crack` bricks only a fragment the cracker STILL holds.
 *
 * Review finding (2026-10-08): `fragment.crack` reads the player's held
 * fragments, rolls, then bricks its pick by id alone. If the fragment was
 * stolen or traded in between, the next holder's fragment was destroyed by
 * someone else's failed roll — and with exactly 9 fragments in the world,
 * any brick locks the endgame (PLAN Q1).
 *
 * In-process, against a PRIVATE fixture fragment of a type no game listing
 * recognises (never one of the world's 9), deleted by id in `finally`.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-brick-guard.ts
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
  console.log("\n=== fragment.crack bricks only what you still hold ===");
  const tag = `bg${Date.now().toString(36)}`;
  const cracker = await register(`${tag}c`);
  const thief = await register(`${tag}t`);
  const worldBefore = await prisma.keyFragment.findMany({ where: { keyType: { in: ["sword", "key", "collar"] } }, orderBy: { id: "asc" } });

  const frag = await prisma.keyFragment.create({
    data: {
      keyType: `harness-${tag}`, fragmentNum: 1, name: "fixture", description: "fixture", hint: "fixture",
      sourceType: "harness", sourceId: tag, heldByUserId: cracker, heldSince: new Date(), status: "active",
    },
  });
  try {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const frags = getService<any>(TOKENS.KEY_FRAGMENT_SERVICE);

    // The window: the cracker picked it, then it changed hands.
    await prisma.keyFragment.update({ where: { id: frag.id }, data: { heldByUserId: thief } });
    const lost = await frags.brickFragment(frag.id, cracker);
    const afterTheft = await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } });
    check("a fragment that changed hands is NOT bricked by the old holder's roll",
      lost === false && afterTheft.status === "active" && afterTheft.heldByUserId === thief,
      `${lost} / ${afterTheft.status} / held by ${afterTheft.heldByUserId === thief ? "thief" : afterTheft.heldByUserId}`);

    // POSITIVE: the holder's own failed roll still bricks it.
    const own = await frags.brickFragment(frag.id, thief);
    const afterOwn = await prisma.keyFragment.findUniqueOrThrow({ where: { id: frag.id } });
    check("POSITIVE: the current holder's failed roll bricks it", own === true && afterOwn.status === "bricked" && afterOwn.heldByUserId === null);
    const twice = await frags.brickFragment(frag.id, thief);
    check("an already-bricked fragment is not 'bricked' again", twice === false);

    const worldAfter = await prisma.keyFragment.findMany({ where: { keyType: { in: ["sword", "key", "collar"] } }, orderBy: { id: "asc" } });
    check("the world's real fragments are byte-identical", JSON.stringify(worldBefore) === JSON.stringify(worldAfter), `${worldAfter.length} fragments`);
  } finally {
    try { await prisma.keyFragment.delete({ where: { id: frag.id } }); }
    catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
