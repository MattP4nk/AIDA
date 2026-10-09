/**
 * After a suite run: no account created during the run may still exist.
 *
 * The per-harness rule (verify-fixture-user-cleanup FU-4) is structural — it
 * sees that a harness CALLS a cleanup, not that the cleanup covers every
 * account it made. verify-phase5-p5new-discovery called one and still leaked
 * an account per run, under an email domain (`@p5.test`) a fixture count by
 * `@fixture.invalid` never sees (2026-10-09). This checks the outcome instead:
 * every user created since the suite started must be gone.
 *
 * Run by scripts/run-verify.sh with the suite's start time. Read-only.
 *   npx tsx scripts/check-fixture-leaks.ts <ISO start time>
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<number> {
  const since = new Date(process.argv[2] ?? "");
  if (Number.isNaN(since.getTime())) {
    console.log("usage: npx tsx scripts/check-fixture-leaks.ts <ISO start time>");
    return 2;
  }
  const left = await prisma.user.findMany({
    where: { createdAt: { gte: since } },
    select: { username: true, email: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  for (const u of left) console.log(`  [FAIL] left behind: ${u.username} <${u.email}> created ${u.createdAt.toISOString()}`);
  console.log(`\n=== ${left.length === 0 ? 1 : 0} PASS / ${left.length === 0 ? 0 : 1} FAIL === (${left.length} account(s) created since ${since.toISOString()} still exist)`);
  return left.length === 0 ? 0 : 1;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
