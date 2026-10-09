/**
 * After a suite run: no account created during the run may still exist.
 *
 * The per-harness rule (verify-fixture-user-cleanup FU-4) is structural — it
 * sees that a harness CALLS a cleanup, not that the cleanup covers every
 * account it made. verify-phase5-p5new-discovery called one and still leaked
 * an account per run, under an email domain (`@p5.test`) a fixture count by
 * `@fixture.invalid` never sees (2026-10-09). This checks the outcome instead:
 * every user created since the suite started must be gone — and so must
 * everything content generation made for them (`generatedForUserId`).
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

  // And nothing GENERATED for an account that no longer exists: a mission
  // target server or planted file whose `generatedForUserId` is gone means a
  // cleanup removed the account but not what was made for it.
  const userIds = new Set((await prisma.user.findMany({ select: { id: true } })).map((u) => u.id));
  const servers = (await prisma.gameServer.findMany({ where: { generatedForUserId: { not: null } }, select: { name: true, generatedForUserId: true } }))
    .filter((s) => !userIds.has(s.generatedForUserId!));
  const files = (await prisma.fileSystemNode.findMany({ where: { generatedForUserId: { not: null } }, select: { name: true, generatedForUserId: true } }))
    .filter((f) => !userIds.has(f.generatedForUserId!));
  for (const s of servers) console.log(`  [FAIL] server made for a deleted account: ${s.name}`);
  if (files.length) console.log(`  [FAIL] ${files.length} file(s) planted for deleted accounts`);

  const failed = (left.length > 0 ? 1 : 0) + (servers.length + files.length > 0 ? 1 : 0);
  console.log(`\n=== ${2 - failed} PASS / ${failed} FAIL === (${left.length} account(s) created since ${since.toISOString()} still exist; ${servers.length} server(s) and ${files.length} file(s) made for deleted accounts)`);
  return failed === 0 ? 0 : 1;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
