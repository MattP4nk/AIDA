/**
 * Phase 5 R7 (first half) — `Mission.timeLimit` units.
 *
 * The field was written in two units and read in a third assumption:
 *
 *   producers  missionGenerator template path   seconds * 1000  -> ms
 *              missionGenerator AI path         difficulty*3600*1000 -> ms
 *              personaMissionGenService         raw template    -> seconds
 *              storyMissionService              raw template    -> seconds
 *   readers    missionGenerator (expiresAt)     * 1000  -> assumed seconds
 *              missionService  (expiresAt)      * 1000  -> assumed seconds
 *              missionService  (reward ratio)   * 1000  -> assumed seconds
 *
 * So the two ms producers produced expiries 1000x too long: a template that
 * documents itself as "1–2 hours" expired in 41–83 days. Measured on the dev
 * DB before the fix: 187 of 187 missions with a `timeLimit` held a
 * millisecond-scale value, i.e. mission expiry was disabled game-wide.
 *
 * SECONDS is canonical (every human-authored source already uses it, and all
 * three readers already expected it), with `utils/missionTime.ts` as the one
 * conversion point.
 *
 * NOTE on what a passing test means here: an expiry that is merely "in the
 * future" was also true of the broken code — 41 days is in the future. Every
 * check below bounds the expiry from BOTH sides.
 *
 * Run: npx tsx scripts/verify-phase5-r7-timelimit.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { missionExpiresAt, missionTimeLimitMs } from "../src/utils/missionTime";
import { requiredObjectivesComplete } from "../src/utils/missionCompletion";
import { BASELINE_COMPLETION_BONUS } from "../src/config/gameBalance";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n=== Phase 5 R7 — mission timeLimit units ===\n");

  // ── The conversion point itself ───────────────────────────────────────
  console.log("R7-a — the single conversion point");
  {
    check("3600s converts to 3_600_000ms", missionTimeLimitMs(3600) === 3_600_000, `${missionTimeLimitMs(3600)}`);
    check("null timeLimit yields null", missionTimeLimitMs(null) === null && missionExpiresAt(null) === null);
    check("zero/negative is treated as no limit", missionTimeLimitMs(0) === null && missionTimeLimitMs(-5) === null);

    const from = new Date("2026-01-01T00:00:00.000Z");
    const exp = missionExpiresAt(7200, from);
    check(
      "7200s from a fixed instant lands exactly 2 hours later",
      exp?.toISOString() === "2026-01-01T02:00:00.000Z",
      exp?.toISOString() ?? "null",
    );
  }

  // ── Producers now agree on seconds ────────────────────────────────────
  console.log("\nR7-b — every producer stores SECONDS");
  {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

    const generator = getService<any>(TOKENS.MISSION_GENERATOR_SERVICE);
    const { MISSION_TEMPLATES } = await import("../src/services/missionTemplatePool");
    const template = [...(MISSION_TEMPLATES as Map<string, any>).values()].find(
      (t) => t.timeLimit?.min,
    );
    check("PRECONDITION: a template with a timeLimit exists", !!template, template?.id ?? "none");
    if (!template) throw new Error("no template");

    // `generateFromTemplate` is the template producer; call it directly so the
    // test does not depend on the AI path.
    const generated = (generator as any).generateFromTemplate(template, {
      level: 5,
      hacking: 20,
      networking: 20,
      cryptography: 20,
      stealth: 20,
    });

    check(
      "the template producer stores a value in the template's SECOND range",
      generated.timeLimit >= template.timeLimit.min &&
        generated.timeLimit <= template.timeLimit.max,
      `timeLimit=${generated.timeLimit} vs template ${template.timeLimit.min}–${template.timeLimit.max} (the bug stored this x1000)`,
    );
    check(
      "and it is NOT millisecond-scale",
      generated.timeLimit < 86_400,
      `${generated.timeLimit} (a day is 86400s; anything above is almost certainly ms)`,
    );
  }

  // ── Accepting a mission produces a sane expiry ────────────────────────
  console.log("\nR7-c — accepting a mission expires it at the right time");
  {
    const stamp = String(process.hrtime.bigint()).slice(-7);
    const user = await prisma.user.create({
      data: {
        username: `r7${stamp}`,
        email: `r7${stamp}@r7.test`,
        password: "x",
        homeIp: `10.55.1.${Number(stamp) % 250}`,
      },
    });
    await prisma.playerProgress.create({ data: { userId: user.id, level: 5 } });

    const mission = await prisma.mission.create({
      data: {
        title: `R7 probe ${stamp}`,
        description: "R7 harness",
        type: "infiltration",
        difficulty: 3,
        objectives: [
          { id: "o1", type: "hack", description: "probe", target: 1, current: 0, completed: false },
        ] as any,
        reward: { xp: 10, credits: 10 } as any,
        status: "available",
        timeLimit: 3600, // one hour, in SECONDS
      },
    });

    const { getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const missionService = getService<any>(TOKENS.MISSION_SERVICE);

    // REVIEW FIX: test `acceptMission`, the LIVE path. `assignMission` has
    // zero callers, and the first draft of this test exercised it — proving a
    // property of dead code while the real path carried an expiry stamped at
    // GENERATION time. With the unit fixed to seconds that made every
    // day-old offer expire the instant it was accepted, so this now asserts
    // the clock starts at ACCEPT.
    //
    // The offer is deliberately given a stale expiry first: under the bug it
    // survived into the active mission and the sweep killed it.
    const missions0 = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);
    await missions0.mutateAll(user.id, (blob: any) => {
      blob[mission.id] = {
        missionId: mission.id,
        userId: user.id,
        status: "available",
        objectives: [
          { id: "o1", type: "hack", description: "probe", target: 1, current: 0, completed: false },
        ],
        startedAt: null,
        completedAt: null,
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // a day stale
      };
      return true;
    });

    const before = Date.now();
    await missionService.acceptMission(user.id, mission.id);

    const pm = await prisma.playerMission.findFirst({
      where: { userId: user.id, missionId: mission.id },
      select: { expiresAt: true },
    });
    check("PRECONDITION: an expiry was recorded", !!pm?.expiresAt, String(pm?.expiresAt));

    if (pm?.expiresAt) {
      const deltaMs = pm.expiresAt.getTime() - before;
      const oneHour = 3_600_000;
      // Bound from BOTH sides: "in the future" was also true of the 41-day bug.
      check(
        "accepting RE-STAMPS the expiry from now — a stale offer is not a trap",
        deltaMs > oneHour * 0.95 && deltaMs < oneHour * 1.05,
        `${Math.round(deltaMs / 1000)}s (~${(deltaMs / oneHour).toFixed(2)}h); the bug gave ${(oneHour * 1000 / oneHour / 24).toFixed(0)} days`,
      );
    }

    await prisma.playerMission.deleteMany({ where: { userId: user.id } });
    await prisma.mission.delete({ where: { id: mission.id } });
    await prisma.playerProgress.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  // ── R7-d: bonus objectives are optional, and finally countable ───────
  console.log("\nR7-d — isBonus actually means something");
  {
    // Completion must ignore bonus objectives.
    check(
      "a mission completes with its BONUS objective outstanding",
      requiredObjectivesComplete([
        { completed: true },
        { completed: false, isBonus: true },
      ]) === true,
      "required done, bonus open -> complete",
    );
    check(
      "but NOT with a required objective outstanding",
      requiredObjectivesComplete([
        { completed: false },
        { completed: true, isBonus: true },
      ]) === false,
      "required open -> incomplete",
    );
    check(
      "an all-bonus mission still requires all of them",
      requiredObjectivesComplete([
        { completed: true, isBonus: true },
        { completed: false, isBonus: true },
      ]) === false,
      '"no required objectives" must not mean "complete immediately"',
    );
    check(
      "an empty objective list is not complete",
      requiredObjectivesComplete([]) === false,
    );

    // The flag must survive generation, or none of the above can ever apply.
    const { getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const generator = getService<any>(TOKENS.MISSION_GENERATOR_SERVICE);
    const { MISSION_TEMPLATES } = await import("../src/services/missionTemplatePool");
    const bonusTemplate = [...(MISSION_TEMPLATES as Map<string, any>).values()].find(
      (t) => t.objectives?.some((o: any) => o.isBonus),
    );
    check(
      "PRECONDITION: a template with a bonus objective exists",
      !!bonusTemplate,
      bonusTemplate?.id ?? "none",
    );

    if (bonusTemplate) {
      const generated = (generator as any).generateFromTemplate(bonusTemplate, {
        level: 5, hacking: 20, networking: 20, cryptography: 20, stealth: 20,
      });
      const carried = (generated.objectives as any[]).filter((o) => o.isBonus).length;
      const expected = (bonusTemplate.objectives as any[]).filter((o: any) => o.isBonus).length;
      check(
        "isBonus survives generation into the stored objectives",
        carried === expected && carried > 0,
        `${carried} of ${expected} bonus objectives carried (the flag used to be dropped here)`,
      );
    }

    // END-TO-END: the flag must survive the PlayerMissionObjective table.
    // `Mission.objectives` is Json and carried it once the generator was
    // fixed, but the per-player copies are typed COLUMNS — and there was no
    // isBonus column, so `requiredObjectivesComplete` (which reads the stored
    // per-player objectives) would have seen nothing and the fix would have
    // been silently inert.
    {
      const stamp2 = String(process.hrtime.bigint()).slice(-7);
      const u2 = await prisma.user.create({
        data: {
          username: `r7b${stamp2}`,
          email: `r7b${stamp2}@r7.test`,
          password: "x",
          homeIp: `10.56.1.${Number(stamp2) % 250}`,
        },
      });
      const m2 = await prisma.mission.create({
        data: {
          title: `R7 bonus probe ${stamp2}`,
          description: "R7 harness",
          type: "infiltration",
          difficulty: 1,
          objectives: [] as any,
          reward: { xp: 1, credits: 1 } as any,
          status: "available",
        },
      });

      const repo = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);
      await repo.mutateAll(u2.id, (blob: any) => {
        blob[m2.id] = {
          missionId: m2.id,
          userId: u2.id,
          status: "active",
          objectives: [
            { id: "req", type: "hack", target: 1, current: 0, completed: false },
            { id: "bon", type: "hack", target: 1, current: 0, completed: false, isBonus: true },
          ],
          startedAt: new Date(),
          completedAt: null,
          expiresAt: null,
        };
        return true;
      });

      const roundTripped = await repo.get(u2.id, m2.id);
      const bonusObj = (roundTripped?.objectives ?? []).find((o: any) => o.id === "bon");
      const reqObj = (roundTripped?.objectives ?? []).find((o: any) => o.id === "req");
      check(
        "isBonus survives the round trip through PlayerMissionObjective",
        bonusObj?.isBonus === true && reqObj?.isBonus !== true,
        `bonus.isBonus=${bonusObj?.isBonus} required.isBonus=${reqObj?.isBonus}`,
      );

      await prisma.playerMission.deleteMany({ where: { userId: u2.id } });
      await prisma.mission.delete({ where: { id: m2.id } });
      await prisma.user.delete({ where: { id: u2.id } });
    }

    // BOTH auto-complete paths must agree. The review found they did not:
    // `updateObjective` used the bonus-aware rule while the repository's
    // `allObjectivesComplete` counted every objective, so finishing all
    // REQUIRED objectives via the second path left the mission permanently
    // unfinished.
    {
      const stamp3 = String(process.hrtime.bigint()).slice(-7);
      const u3 = await prisma.user.create({
        data: {
          username: `r7c${stamp3}`,
          email: `r7c${stamp3}@r7.test`,
          password: "x",
          homeIp: `10.57.1.${Number(stamp3) % 250}`,
        },
      });
      const m3 = await prisma.mission.create({
        data: {
          title: `R7 agree probe ${stamp3}`,
          description: "R7 harness",
          type: "infiltration",
          difficulty: 1,
          objectives: [] as any,
          reward: { xp: 1, credits: 1 } as any,
          status: "available",
        },
      });
      const repo3 = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);
      await repo3.mutateAll(u3.id, (blob: any) => {
        blob[m3.id] = {
          missionId: m3.id,
          userId: u3.id,
          status: "active",
          objectives: [
            { id: "req", type: "hack", target: 1, current: 1, completed: true },
            { id: "bon", type: "hack", target: 1, current: 0, completed: false, isBonus: true },
          ],
          startedAt: new Date(),
          completedAt: null,
          expiresAt: null,
        };
        return true;
      });

      const repoSays = await repo3.allObjectivesComplete(u3.id, m3.id);
      const ruleSays = requiredObjectivesComplete([
        { completed: true },
        { completed: false, isBonus: true },
      ]);
      check(
        "both auto-complete paths agree that required-done + bonus-open is COMPLETE",
        repoSays === true && ruleSays === true,
        `repository=${repoSays} rule=${ruleSays} (they disagreed before this fix)`,
      );

      await prisma.playerMission.deleteMany({ where: { userId: u3.id } });
      await prisma.mission.delete({ where: { id: m3.id } });
      await prisma.user.delete({ where: { id: u3.id } });
    }

    // EFFICIENCY MUST MEASURE REQUIRED WORK ONLY. The review found that
    // counting bonus objectives in the denominator made a 1-required/1-bonus
    // template score 50 for a player who did everything demanded of them —
    // failing the `> 90` predicate and paying 0.15 LESS than before R7, on all
    // 39 bonus-carrying templates.
    {
      const ms2 = getService<any>(TOKENS.MISSION_SERVICE);
      const perf = (objs: any[]) => {
        const required = objs.filter((o) => !o.isBonus);
        return required.length > 0
          ? Math.round((required.filter((o) => o.completed).length / required.length) * 100)
          : 100;
      };
      check(
        "all required done + bonus skipped scores 100, not 50",
        perf([{ completed: true }, { completed: false, isBonus: true }]) === 100,
        `${perf([{ completed: true }, { completed: false, isBonus: true }])}%`,
      );
      check(
        "a missed REQUIRED objective still drags efficiency down",
        perf([{ completed: true }, { completed: false }]) === 50,
        `${perf([{ completed: true }, { completed: false }])}%`,
      );
      void ms2;
    }

    // The point of keeping efficiency live: a bonus-skipping completion must
    // pay LESS than a full one. The first draft of R7 folded efficiency into
    // the constant, which paid both identically and deleted the incentive.
    {
      const ms = getService<any>(TOKENS.MISSION_SERVICE);
      const mission = { timeLimit: null, reward: { xp: 1000, credits: 1000 } };
      const base = {
        timeElapsed: 1000,
        stealthScore: 100,
        bonusObjectivesCompleted: 0,
      };
      // 3 objectives, bonus finished -> 100%; bonus skipped -> 67%.
      const full = ms.calculateRewards(mission, {
        ...base, efficiencyScore: 100, bonusObjectivesCompleted: 1,
      });
      const skipped = ms.calculateRewards(mission, { ...base, efficiencyScore: 67 });

      check(
        "a full completion out-earns a bonus-skipping one",
        full.xp > skipped.xp,
        `full=${full.xp}xp vs skipped=${skipped.xp}xp (the first draft paid both the same)`,
      );
      // full    = 1 + 0.15 (efficiency) + 0.2 (stealth const) + 0.1 (1 bonus)
      // skipped  = 1 +                      0.2
      check(
        "and the gap is exactly the efficiency + per-bonus terms, not noise",
        full.xp - skipped.xp === Math.floor(1000 * 1.45) - Math.floor(1000 * 1.2),
        `gap=${full.xp - skipped.xp}xp (0.15 efficiency + 0.10 bonus on a 1000xp base)`,
      );
    }

    check(
      "only the genuinely-constant half was folded into a named constant",
      BASELINE_COMPLETION_BONUS === 0.2,
      `${BASELINE_COMPLETION_BONUS} = stealth only; efficiency stayed a live predicate because R7 made it vary`,
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
