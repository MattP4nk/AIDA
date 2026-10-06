/**
 * Faction wars — wiring an unreachable feature.
 *
 * Orphan audit finding: `warfareService.declareWar` had ZERO callers, so
 * `startWarMonitor` ran and the `war` command read rows nothing could ever
 * create. `FactionWar`: 0 rows. Four methods were unreachable together —
 * declare, surrender, score, and the reputation multiplier — which is why the
 * feature was invisible rather than merely buggy.
 *
 * Wired so far:
 *   - `declare_war` Architect intervention -> warfareService.declareWar.
 *     Chosen over a player command because the third parameter is documented
 *     `declaredBy // AI persona ID`: wars were designed as AI world events.
 *   - `getReputationMultiplier` -> `reputationEngine.applyReputationChange`,
 *     the single chokepoint every reputation change flows through. Returns
 *     1.0 with no war, so it is a no-op until a war exists.
 *
 * SELF-CONTAINED: builds its own factions, declares its own war, and deletes
 * both. The R12-e lesson — a harness that mutates ambient state corrupts the
 * data it measures.
 *
 * Run: npx tsx scripts/verify-faction-wars.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("\n=== Faction wars ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const executor = getService<any>(TOKENS.ARCHITECT_INTERVENTION_EXECUTOR);
  const warfare = getService<any>(TOKENS.WARFARE_SERVICE);

  const tag = `__war_probe_${process.pid}`;
  let aId: string | null = null;
  let bId: string | null = null;
  let warId: string | null = null;

  try {
    const a = await prisma.faction.create({
      data: { name: `${tag}_A`, shortName: `${tag}A`.slice(0, 20), description: "probe" },
    });
    const b = await prisma.faction.create({
      data: { name: `${tag}_B`, shortName: `${tag}B`.slice(0, 20), description: "probe" },
    });
    aId = a.id; bId = b.id;

    // ── The war can now be started at all ────────────────────────────
    console.log("\nFW-1 — the Architect can declare a war");
    {
      const before = await prisma.factionWar.count();
      const res = await executor.execute({
        type: "declare_war",
        targetId: b.id,
        data: { attackerFactionId: a.id },
        reasoning: "probe",
      });
      check("the intervention succeeds", res?.success === true, res?.error ?? "ok");
      check(
        "a FactionWar row now exists",
        (await prisma.factionWar.count()) === before + 1,
        "declareWar had zero callers — the table could never gain a row",
      );
      const war = await prisma.factionWar.findFirst({
        where: { attackerFactionId: a.id, defenderFactionId: b.id },
      });
      warId = war?.id ?? null;
      check("it is active and correctly sided", war?.status === "active", `status=${war?.status}`);
    }

    // ── Its own guards still hold through the new path ───────────────
    console.log("\nFW-2 — declareWar's existing guards are not bypassed");
    {
      const dup = await executor.execute({
        type: "declare_war",
        targetId: b.id,
        data: { attackerFactionId: a.id },
        reasoning: "probe duplicate",
      });
      check("a duplicate war is refused", dup?.success === false, dup?.error ?? "(accepted!)");

      const self = await executor.execute({
        type: "declare_war",
        targetId: a.id,
        data: { attackerFactionId: a.id },
        reasoning: "probe self",
      });
      check("self-war is refused", self?.success === false, self?.error ?? "(accepted!)");

      const missing = await executor.execute({
        type: "declare_war",
        targetId: b.id,
        data: {},
        reasoning: "probe missing attacker",
      });
      check("a missing attacker is refused", missing?.success === false, missing?.error ?? "(accepted!)");
    }

    // ── The war now has an effect ────────────────────────────────────
    console.log("\nFW-3 — an active war changes reputation stakes");
    {
      const mult = await warfare.getReputationMultiplier(a.id);
      check("the belligerent has a non-default multiplier", mult !== 1.0, `${mult}x`);

      const neutral = await prisma.faction.findFirst({
        where: { id: { notIn: [a.id, b.id] } },
        select: { id: true },
      });
      if (neutral) {
        check(
          "a faction NOT at war is unaffected",
          (await warfare.getReputationMultiplier(neutral.id)) === 1.0,
          "1.0 — so wiring this is a no-op outside wartime",
        );
      }

      const rep = strip(readFileSync(new URL("../src/services/reputationEngine.ts", import.meta.url).pathname, "utf8"));
      check(
        "applyReputationChange consults the multiplier",
        /getReputationMultiplier\(factionId\)/.test(rep),
        "the single chokepoint all reputation flows through",
      );
      check(
        "and applies the scaled amount, not the raw one",
        /addReputation\(userId, factionId, effectiveAmount\)/.test(rep),
        "computing a multiplier and then ignoring it is the classic half-fix",
      );
    }

    // ── Scoring now has a producer ───────────────────────────────────
    console.log("\nFW-4 — a war hack moves the score");
    {
      // This check used to assert the GAP ("nothing calls updateWarScore
      // yet"). Closing the gap would have left it green and vacuous, because
      // it grepped for `updateWarScore(` and the producer calls
      // `recordHackForWar`. A check that encodes a limitation has to be
      // rewritten when the limitation goes, not merely re-run.
      const src = strip(readFileSync(new URL("../src/services/hackService.ts", import.meta.url).pathname, "utf8"));
      check(
        "hackService reports successful hacks to warfareService",
        /recordHackForWar\(attackerId, targetServerId\)/.test(src),
        "updateWarScore had NO producer: every declared war sat 0-0 and the monitor " +
        "resolved on elapsed time rather than on anything either side did",
      );
      check(
        "and only on success",
        /if \(result\.success\) \{[\s\S]{0,400}?recordHackForWar/.test(src),
        "a failed hack must not advance a war",
      );

      // BEHAVIOURAL: drive it through the real service.
      const probeServer = await prisma.gameServer.create({
        data: {
          name: `${tag}_target`,
          ipAddress: `10.66.0.${process.pid % 250}`,
          type: "corporate",
          factionId: b.id,
        },
      });
      const member = await prisma.factionMember.create({
        data: { userId: (await prisma.user.findFirst({ select: { id: true } }))!.id, factionId: a.id },
      });
      try {
        const before = await prisma.factionWar.findUnique({ where: { id: warId! } });
        const scored = await warfare.recordHackForWar(member.userId, probeServer.id);
        check("the hack is attributed to a war", !!scored, scored ? scored.warId : "null");
        const after = await prisma.factionWar.findUnique({ where: { id: warId! } });
        check(
          "and the attacker's score went UP",
          (after?.attackerScore ?? 0) > (before?.attackerScore ?? 0),
          `${before?.attackerScore} -> ${after?.attackerScore}`,
        );

        // Bound it from the other side: a hack with no war must score nothing.
        const neutralServer = await prisma.gameServer.create({
          data: {
            name: `${tag}_neutral`,
            ipAddress: `10.66.1.${process.pid % 250}`,
            type: "corporate",
          },
        });
        check(
          "a hack on an unaligned server scores nothing",
          (await warfare.recordHackForWar(member.userId, neutralServer.id)) === null,
          "otherwise every hack in the game would feed whatever war happened to be open",
        );
        await prisma.gameServer.delete({ where: { id: neutralServer.id } });
      } finally {
        await prisma.factionMember.delete({ where: { id: member.id } });
        await prisma.gameServer.delete({ where: { id: probeServer.id } });
      }
    }
  } finally {
    if (warId) await prisma.factionWar.delete({ where: { id: warId } }).catch(() => {});
    await prisma.factionWar.deleteMany({
      where: { OR: [{ attackerFactionId: aId ?? "" }, { defenderFactionId: bId ?? "" }] },
    }).catch(() => {});
    if (aId) await prisma.faction.delete({ where: { id: aId } }).catch(() => {});
    if (bId) await prisma.faction.delete({ where: { id: bId } }).catch(() => {});
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
