/**
 * PlayerProgressRepository — D4 / D5 / D8 primitives, under REAL concurrency.
 *
 * Each race runs the operation N times with `Promise.all` against one row and
 * asserts the invariant the audit says is currently breakable. Every negative
 * assertion is paired with a positive control, because "nothing happened" would
 * satisfy most of these trivially.
 *
 * Run: npx tsx scripts/verify-phase3-progress-repo.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import { PlayerProgressRepository, levelForExperience } from "../src/repositories/playerProgressRepository";

const prisma = new PrismaClient();
const repo = new PlayerProgressRepository(pino({ level: "silent" }) as any, prisma);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function makePlayer(tag: string, progress: Record<string, number> = {}) {
  const id = `ppr_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await prisma.user.create({
    data: {
      id,
      username: id,
      email: `${id}@ppr.test`,
      password: "x",
      homeIp: `0.8.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`,
      role: "npc",
      progress: { create: progress },
    },
  });
  return id;
}

async function read(userId: string) {
  return prisma.playerProgress.findUniqueOrThrow({ where: { userId } });
}

const created: string[] = [];
async function player(tag: string, progress: Record<string, number> = {}) {
  const id = await makePlayer(tag, progress);
  created.push(id);
  return id;
}

async function main() {
  console.log("\n=== PlayerProgressRepository — D4/D5/D8 ===\n");

  // ── D4: concurrent spend must not overdraw ────────────────────────────
  console.log("D4 — credit double-spend");
  {
    // The audit's exact scenario: 1000 credits, a 600-credit item, two buyers.
    const u = await player("d4", { credits: 1000 });
    const results = await Promise.all([
      repo.spendCredits(u, 600),
      repo.spendCredits(u, 600),
    ]);
    const okCount = results.filter((r) => r.ok).length;
    const after = await read(u);
    check("exactly ONE of two concurrent 600-credit spends succeeds", okCount === 1, `${okCount} succeeded`);
    check("balance did not go negative", after.credits >= 0, `credits=${after.credits}`);
    check("balance is exactly 400", after.credits === 400, `credits=${after.credits}`);
    const refused = results.find((r) => !r.ok);
    check("the refusal reports the real shortfall", refused?.shortfall === 200, `shortfall=${refused?.shortfall}`);
  }
  {
    // Harder: 10 concurrent spends of 100 against a balance of 550.
    const u = await player("d4b", { credits: 550 });
    const results = await Promise.all(Array.from({ length: 10 }, () => repo.spendCredits(u, 100)));
    const okCount = results.filter((r) => r.ok).length;
    const after = await read(u);
    check("10 concurrent 100c spends against 550c: exactly 5 succeed", okCount === 5, `${okCount} succeeded`);
    check("balance lands on 50, not negative", after.credits === 50, `credits=${after.credits}`);
  }
  {
    // POSITIVE CONTROL — an affordable spend must still go through.
    const u = await player("d4c", { credits: 1000 });
    const r = await repo.spendCredits(u, 250);
    const after = await read(u);
    check("POSITIVE CONTROL: an affordable spend succeeds", r.ok && after.credits === 750, `credits=${after.credits}`);
  }

  // ── D5: concurrent grants must not lose each other ────────────────────
  console.log("\nD5 — lost updates on concurrent grants");
  {
    const u = await player("d5", { credits: 0, experience: 0 });
    await Promise.all([
      ...Array.from({ length: 10 }, () => repo.addCredits(u, 100)),
      ...Array.from({ length: 10 }, () => repo.addExperience(u, 50)),
    ]);
    const after = await read(u);
    check("20 interleaved grants: all 10 credit awards landed", after.credits === 1000, `credits=${after.credits}`);
    check("20 interleaved grants: all 10 XP awards landed", after.experience === 500, `xp=${after.experience}`);
  }
  {
    // The level column must track experience — it was previously raised by ONE
    // code path (missionService.grantRewards) and never by hack/dungeon XP.
    const u = await player("d5b", { experience: 0 });
    const r = await repo.addExperience(u, 400); // level 3 at 400xp
    const after = await read(u);
    check("addExperience raises level to match XP", after.level === levelForExperience(400), `level=${after.level} (expected ${levelForExperience(400)})`);
    check("addExperience reports leveledUp", r.leveledUp && r.previousLevel === 1, `leveledUp=${r.leveledUp} prev=${r.previousLevel}`);
  }
  {
    // Level must be MONOTONIC under concurrency — never lowered by a racing grant.
    const u = await player("d5c", { experience: 0 });
    await Promise.all(Array.from({ length: 12 }, () => repo.addExperience(u, 100)));
    const after = await read(u);
    check("12 concurrent XP grants all land", after.experience === 1200, `xp=${after.experience}`);
    check("level matches final XP after the race", after.level === levelForExperience(after.experience), `level=${after.level} expected=${levelForExperience(after.experience)}`);
  }
  {
    // A grant that does NOT cross a threshold must not report a level-up.
    const u = await player("d5d", { experience: 0 });
    const r = await repo.addExperience(u, 10);
    check("POSITIVE CONTROL: a sub-threshold grant reports no level-up", r.leveledUp === false && r.level === 1, `level=${r.level}`);
  }

  // ── D8: skill caps ────────────────────────────────────────────────────
  console.log("\nD8 — skill caps");
  {
    // The audit's scenario: two completions at 99 both compute min(gain, 1).
    const u = await player("d8", { hacking: 99 });
    await Promise.all([repo.addSkill(u, "hacking", 5), repo.addSkill(u, "hacking", 5)]);
    const after = await read(u);
    check("two concurrent skill gains at 99 cannot exceed 100", after.hacking === 100, `hacking=${after.hacking}`);
  }
  {
    // The uncapped sites: fragmentCommands +20, hackCommands +25/+15.
    const u = await player("d8b", { hacking: 90, cryptography: 90 });
    await Promise.all(Array.from({ length: 8 }, () => repo.addSkill(u, "hacking", 20)));
    await repo.addSkills(u, { cryptography: 25, hacking: 15 });
    const after = await read(u);
    check("an uncapped-style +20 loop still stops at 100", after.hacking === 100, `hacking=${after.hacking}`);
    check("addSkills clamps every column it touches", after.cryptography === 100, `crypto=${after.cryptography}`);
  }
  {
    // traceService decrements stealth with no floor today.
    const u = await player("d8c", { stealth: 3 });
    const v = await repo.addSkill(u, "stealth", -10);
    const after = await read(u);
    check("a decrement past zero floors at 0, not negative", after.stealth === 0 && v === 0, `stealth=${after.stealth}`);
  }
  {
    // POSITIVE CONTROL — a normal gain below the cap must apply in full.
    const u = await player("d8d", { hacking: 10 });
    const v = await repo.addSkill(u, "hacking", 7);
    check("POSITIVE CONTROL: a normal gain applies in full", v === 17, `hacking=${v}`);
    // socialEng exercises the one field whose column name differs from its
    // Prisma field (social_engineering) — a mapping typo would only show here.
    const v2 = await repo.addSkill(u, "socialEng", 4);
    const after = await read(u);
    check("socialEng maps to social_engineering correctly", v2 === 9 && after.socialEng === 9, `socialEng=${after.socialEng}`);
  }

  // ── Counters and guards ───────────────────────────────────────────────
  console.log("\nCounters & guards");
  {
    const u = await player("ctr");
    await Promise.all(Array.from({ length: 20 }, () => repo.incrementCounter(u, "commandsExecuted")));
    await repo.incrementCounters(u, { successfulHacks: 3, filesAccessed: 2 });
    const after = await read(u);
    check("20 concurrent counter bumps all land", after.commandsExecuted === 20, `n=${after.commandsExecuted}`);
    check("incrementCounters applies every field", after.successfulHacks === 3 && after.filesAccessed === 2);
  }
  {
    // Persona/NPC accounts legitimately have no PlayerProgress row. These must
    // be silent no-ops, not P2025 — that throw used to log a Prisma error on
    // every persona mail delivered.
    const orphan = `ppr_norow_${Date.now()}`;
    await prisma.user.create({
      data: {
        id: orphan, username: orphan, email: `${orphan}@ppr.test`, password: "x",
        homeIp: `0.8.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`, role: "npc",
      },
    });
    created.push(orphan);
    let threw = false;
    try {
      await repo.incrementCounter(orphan, "messagesSent");
      await repo.addCredits(orphan, 10);
      await repo.addExperience(orphan, 10);
      await repo.addSkill(orphan, "hacking", 1);
    } catch { threw = true; }
    check("every op is a silent no-op when the player has no progress row", !threw);
  }
  {
    // NEGATIVE must throw — it would be a credit-minting hole.
    let rejected = 0;
    for (const fn of [
      () => repo.addCredits("x", -100),
      () => repo.spendCredits("x", -100),
      () => repo.addExperience("x", -1),
    ]) {
      try { await fn(); } catch { rejected++; }
    }
    check("NEGATIVE amounts are rejected", rejected === 3, `${rejected}/3 rejected`);

    // ZERO and FRACTIONAL must NOT throw — corrected after code review. Every
    // call site this replaced issued a relative Prisma update where 0 was a
    // harmless no-op, and several pass data-driven amounts: a zero-reward
    // bounty is claimed BEFORE the grant, and darknet reward amounts come from
    // AI-authored JSON. Throwing there burns the bounty / silently pays nothing.
    const u = await player("amt", { credits: 500, experience: 0 });
    let tolerated = true;
    try {
      await repo.addCredits(u, 0);
      await repo.addExperience(u, 0);
      await repo.addCredits(u, 2.7);          // truncates to 2
      await repo.spendCredits(u, 0);
    } catch { tolerated = false; }
    const after = await read(u);
    check("ZERO and FRACTIONAL are tolerated, not thrown", tolerated);
    check("a fractional grant truncates rather than throwing", after.credits === 502, `credits=${after.credits}`);
    check("a zero grant leaves experience untouched", after.experience === 0, `xp=${after.experience}`);
  }

  // ── NEGATIVE CONTROLS ─────────────────────────────────────────────────
  // Everything above is worthless if `Promise.all` does not actually interleave
  // here — Node's event loop plus Prisma's pool could serialise the operations
  // and every invariant would hold for the wrong reason. So: run the OLD
  // patterns and assert they still BREAK. If these two report "safe", the races
  // are not reproducible in this harness and no PASS above means anything.
  console.log("\nNEGATIVE CONTROLS — the old patterns must still break here");
  {
    // D4 as it was written: read, compare in JS, then decrement.
    const u = await player("neg_d4", { credits: 1000 });
    const oldSpend = async (amount: number) => {
      const p = await prisma.playerProgress.findUnique({ where: { userId: u }, select: { credits: true } });
      if (!p || p.credits < amount) return false;
      await prisma.playerProgress.update({ where: { userId: u }, data: { credits: { decrement: amount } } });
      return true;
    };
    const res = await Promise.all([oldSpend(600), oldSpend(600)]);
    const after = await read(u);
    check(
      "NEGATIVE CONTROL: the old read-then-spend DOES overdraw here",
      res.filter(Boolean).length === 2 && after.credits < 0,
      `${res.filter(Boolean).length} succeeded, credits=${after.credits}`,
    );
  }
  {
    // D8 as it was written: headroom computed in JS from an earlier read.
    const u = await player("neg_d8", { hacking: 99 });
    const oldGain = async (gain: number) => {
      const p = await prisma.playerProgress.findUnique({ where: { userId: u }, select: { hacking: true } });
      if (!p) return;
      await prisma.playerProgress.update({
        where: { userId: u },
        data: { hacking: { increment: Math.min(gain, 100 - p.hacking) } },
      });
    };
    await Promise.all([oldGain(5), oldGain(5)]);
    const after = await read(u);
    check(
      "NEGATIVE CONTROL: the old JS-computed cap DOES exceed 100 here",
      after.hacking > 100,
      `hacking=${after.hacking}`,
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (created.length) await prisma.user.deleteMany({ where: { id: { in: created } } });
    await prisma.$disconnect();
  });
