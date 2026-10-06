/**
 * Phase 3 step 1 — schema gate.
 *
 * Proves the schema work is ENFORCED, not merely declared:
 *   D9  Mission indexes exist and the headline query actually uses one
 *   D10 the four missing FKs reject an orphan (negative) while a valid row
 *       still inserts (positive control)
 *   R8  `skillPoints: { increment }` alongside `experience` — the exact
 *       darknetDungeonService statement — now COMMITS BOTH instead of throwing
 *   K   knowledge tables exist and their unique + cascade behave
 *
 * Every negative assertion is paired with a positive control, because
 * "the write failed" passes trivially against a broken setup.
 *
 * Run: npx tsx scripts/verify-phase3-schema.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * Runs `fn` and reports whether it threw, as `<code>: <first non-empty line>`.
 *
 * NOTE: do NOT use `message.split("\n")[0]` here. Prisma error messages START
 * with a newline, so that yields an EMPTY string and every error reads as
 * falsy — which made this harness report a FAIL for an FK that psql proved
 * rejects correctly.
 */
async function threw(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    const raw = e instanceof Error ? e.message : String(e);
    const line = raw.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "(no message)";
    return `${code ? code + ": " : ""}${line}`;
  }
}

async function main() {
  console.log("\n=== Phase 3 step 1 — schema gate ===\n");

  // ---------------------------------------------------------------- D9
  console.log("D9 — Mission indexes");
  const idx = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'missions'
  `;
  const names = idx.map((r) => r.indexname);
  if (names.length === 0) throw new Error("index probe returned 0 rows — vacuous");
  for (const want of [
    "missions_assigned_to_type_status_idx",
    "missions_status_difficulty_idx",
    "missions_faction_id_status_idx",
  ]) {
    check(`index ${want}`, names.includes(want));
  }

  // The headline D9 query (missionService.ts:1431). An index that exists but is
  // never chosen is not a fix — ask the planner. Small tables are seq-scanned by
  // choice, so disable seqscan to prove the index is USABLE for this predicate.
  const plan = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
    return tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(
      `EXPLAIN SELECT * FROM missions
       WHERE status = 'available' AND difficulty BETWEEN 1 AND 5
       ORDER BY difficulty ASC`,
    );
  });
  const planText = plan.map((r) => r["QUERY PLAN"]).join(" ");
  if (!planText) throw new Error("EXPLAIN returned 0 rows — vacuous");
  check(
    "planner uses missions_status_difficulty_idx for the D9 headline query",
    planText.includes("missions_status_difficulty_idx"),
    planText.replace(/\s+/g, " ").slice(0, 120),
  );

  // ---------------------------------------------------------------- D10
  console.log("\nD10 — missing foreign keys");
  const fks = await prisma.$queryRaw<{ conname: string; confdeltype: string }[]>`
    SELECT conname, confdeltype FROM pg_constraint
    WHERE contype = 'f' AND conrelid::regclass::text IN
      ('server_access_keys','server_connections','discovered_links','bounties')
  `;
  if (fks.length === 0) throw new Error("FK probe returned 0 rows — vacuous");
  const fkMap = new Map(fks.map((f) => [f.conname, f.confdeltype]));
  check("server_access_keys.user_id FK (cascade)", fkMap.get("server_access_keys_user_id_fkey") === "c");
  check("server_connections.user_id FK (cascade)", fkMap.get("server_connections_user_id_fkey") === "c");
  check("discovered_links.user_id FK (cascade)", fkMap.get("discovered_links_user_id_fkey") === "c");
  check("bounties.target_user_id FK (cascade)", fkMap.get("bounties_target_user_id_fkey") === "c");
  check("bounties.claimed_by_user_id FK (set null)", fkMap.get("bounties_claimed_by_user_id_fkey") === "n");
  check("bounties.issued_by_faction_id FK (cascade)", fkMap.get("bounties_issued_by_faction_id_fkey") === "c");
  check("bounties.server_id FK (set null)", fkMap.get("bounties_server_id_fkey") === "n");

  const anyServer = await prisma.gameServer.findFirst({ select: { id: true } });
  const anyUser = await prisma.user.findFirst({ select: { id: true } });
  if (!anyServer || !anyUser) throw new Error("no server/user in DB — cannot run FK tests");

  // NEGATIVE then POSITIVE CONTROL, both rolled back.
  const negErr = await threw(() =>
    prisma.serverConnection.create({
      data: { id: "vp3_neg", userId: "NO_SUCH_USER", serverId: anyServer.id },
    }),
  );
  check(
    "orphan ServerConnection rejected (P2003)",
    negErr !== null && negErr.startsWith("P2003"),
    negErr ?? "NO ERROR THROWN",
  );

  const posErr = await threw(async () => {
    await prisma.serverConnection.create({
      data: { id: "vp3_pos", userId: anyUser.id, serverId: anyServer.id },
    });
    await prisma.serverConnection.delete({ where: { id: "vp3_pos" } });
  });
  check("valid ServerConnection still inserts (positive control)", posErr === null, posErr ?? "");

  // ---------------------------------------------------------------- R8
  console.log("\nR8 — skillPoints column");
  // Exactly the shape darknetDungeonService.ts uses for `intel_package`:
  // skillPoints spread into the SAME `data` object as experience, so the old
  // failure took the XP down with it.
  const victim = await prisma.playerProgress.findFirst({
    select: { userId: true, experience: true, skillPoints: true },
  });
  if (!victim) throw new Error("no playerProgress rows — cannot run R8 test");

  const r8Err = await threw(() =>
    prisma.playerProgress.update({
      where: { userId: victim.userId },
      data: {
        experience: { increment: 5000 },
        skillPoints: { increment: 2 },
      },
    }),
  );
  check("intel_package reward statement does not throw", r8Err === null, r8Err ?? "");

  const after = await prisma.playerProgress.findUniqueOrThrow({
    where: { userId: victim.userId },
    select: { experience: true, skillPoints: true },
  });
  check(
    "XP was actually granted (it used to be lost with the throw)",
    after.experience === victim.experience + 5000,
    `${victim.experience} -> ${after.experience}`,
  );
  check(
    "skill points were actually granted",
    after.skillPoints === victim.skillPoints + 2,
    `${victim.skillPoints} -> ${after.skillPoints}`,
  );
  // Restore.
  await prisma.playerProgress.update({
    where: { userId: victim.userId },
    data: { experience: victim.experience, skillPoints: victim.skillPoints },
  });

  // ---------------------------------------------------------------- K
  console.log("\nK — knowledge tables");
  const topic = await prisma.knowledgeTopic.create({
    data: {
      slug: `vp3.test.${Date.now()}`,
      label: "ENTITY",
      category: "entity",
      tier: 1,
      patterns: ["AIDA"],
    },
  });
  await prisma.playerKnowledge.create({
    data: { userId: anyUser.id, topicId: topic.id, level: 1, source: "verify" },
  });
  const dupErr = await threw(() =>
    prisma.playerKnowledge.create({
      data: { userId: anyUser.id, topicId: topic.id, level: 2, source: "verify" },
    }),
  );
  check("PlayerKnowledge (userId, topicId) unique rejects a second row", dupErr !== null, dupErr ?? "no error thrown");

  // Deleting the topic must cascade the player's row away.
  await prisma.knowledgeTopic.delete({ where: { id: topic.id } });
  const orphaned = await prisma.playerKnowledge.count({ where: { topicId: topic.id } });
  check("deleting a topic cascades its PlayerKnowledge rows", orphaned === 0, `${orphaned} left`);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
