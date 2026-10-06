/**
 * D6 — two players cracking the same key fragment must not BOTH win.
 *
 * Fragment contention is a designed interaction (PLAN.md decision 4 lists key
 * fragments as "contested by design"), so this is a real path, not a
 * theoretical one. Before the fix, `changeFragmentOwnership` read the row with
 * `findUnique` under a comment claiming that gave "serializable reads" — it
 * did not, the default isolation is READ COMMITTED and a plain SELECT takes no
 * row lock. Both claimants passed validation, both ran the update, one won the
 * row, and BOTH were told `{ claimed: true }`, both got a discovery record, and
 * both had `updatePlayerCounters` inflate their `StoryProgress.swordFragments`.
 *
 * This drives the real service (not raw SQL), so it exercises the code path
 * players hit.
 *
 * Run with the server STOPPED or RUNNING — it talks to the DB directly.
 *   npx tsx scripts/verify-phase3-d6-fragment-race.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { KeyFragmentService } from "../src/services/keyFragmentService";

const prisma = new PrismaClient();
const logger = pino({ level: "silent" });
// The service only ever calls io.to(room).emit(event, payload).
const io = { to: () => ({ emit: () => {} }) } as any;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function makePlayer(tag: string) {
  const id = `d6_${tag}_${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      id,
      username: id,
      email: `${id}@d6.test`,
      password: "x",
      homeIp: `0.9.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`,
      role: "npc", // keeps them out of player stats
      progress: { create: {} },
      storyProgress: { create: {} },
    },
  });
  return user.id;
}

async function main() {
  console.log("\n=== D6 — concurrent fragment claim ===\n");

  const service = new KeyFragmentService(logger as any, prisma, io);

  const fragment = await prisma.keyFragment.findFirst({ select: { id: true, name: true, heldByUserId: true } });
  if (!fragment) throw new Error("no KeyFragment rows — cannot run D6 test (vacuous)");
  const originalHolder = fragment.heldByUserId;

  const a = await makePlayer("a");
  const b = await makePlayer("b");

  try {
    // ── RACE ────────────────────────────────────────────────────────────
    await prisma.keyFragment.update({
      where: { id: fragment.id },
      data: { heldByUserId: null, heldSince: null },
    });

    const [ra, rb] = await Promise.all([
      service.claimFragment(a, fragment.id, "crack"),
      service.claimFragment(b, fragment.id, "crack"),
    ]);

    const winners = [ra, rb].filter((r) => r?.claimed === true).length;
    check("exactly ONE claimant is told claimed:true", winners === 1, `${winners} winners (a=${ra?.claimed}, b=${rb?.claimed})`);

    const held = await prisma.keyFragment.findUniqueOrThrow({
      where: { id: fragment.id },
      select: { heldByUserId: true },
    });
    check("the DB row has exactly one holder", held.heldByUserId === a || held.heldByUserId === b, `holder=${held.heldByUserId}`);

    const winnerId = ra?.claimed ? a : b;
    const loserId = ra?.claimed ? b : a;
    check("the winner reported is the holder in the DB", held.heldByUserId === winnerId);

    const discoveries = await prisma.keyFragmentDiscovery.count({
      where: { fragmentId: fragment.id, userId: { in: [a, b] } },
    });
    check("only the winner gets a discovery record", discoveries === 1, `${discoveries} records`);

    const loserProgress = await prisma.storyProgress.findUnique({
      where: { userId: loserId },
      select: { swordFragments: true, collarFragments: true, keyFragments: true },
    });
    const loserTotal =
      (loserProgress?.swordFragments ?? 0) + (loserProgress?.collarFragments ?? 0) + (loserProgress?.keyFragments ?? 0);
    check("the LOSER's fragment counters were not inflated", loserTotal === 0, `total=${loserTotal}`);

    const winnerProgress = await prisma.storyProgress.findUnique({
      where: { userId: winnerId },
      select: { swordFragments: true, collarFragments: true, keyFragments: true },
    });
    const winnerTotal =
      (winnerProgress?.swordFragments ?? 0) + (winnerProgress?.collarFragments ?? 0) + (winnerProgress?.keyFragments ?? 0);
    // POSITIVE CONTROL: "nobody got counters" would pass the assertion above
    // trivially. The winner MUST have been credited.
    check("POSITIVE CONTROL: the winner WAS credited", winnerTotal === 1, `total=${winnerTotal}`);

    // ── POSITIVE CONTROL: an uncontested claim still works ──────────────
    await prisma.keyFragmentDiscovery.deleteMany({ where: { fragmentId: fragment.id, userId: { in: [a, b] } } });
    await prisma.keyFragment.update({ where: { id: fragment.id }, data: { heldByUserId: null, heldSince: null } });
    const solo = await service.claimFragment(a, fragment.id, "crack");
    check("POSITIVE CONTROL: an uncontested claim still succeeds", solo?.claimed === true, JSON.stringify(solo?.claimed));

    // ── The second claimant now gets the ACCURATE message, not a generic one ──
    const second = await service.claimFragment(b, fragment.id, "crack");
    check(
      "a claim on a held fragment names the current holder",
      second?.claimed === false && typeof second?.currentHolder === "string",
      `currentHolder=${second?.currentHolder}`,
    );
  } finally {
    // Restore the fragment and remove the test players.
    await prisma.keyFragmentDiscovery.deleteMany({ where: { userId: { in: [a, b] } } });
    await prisma.keyFragment.update({
      where: { id: fragment.id },
      data: { heldByUserId: originalHolder, heldSince: originalHolder ? new Date() : null },
    });
    await prisma.user.deleteMany({ where: { id: { in: [a, b] } } });
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
