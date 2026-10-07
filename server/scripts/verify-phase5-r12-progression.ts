/**
 * Phase 5 R12 (pass 1 of 2) — progression.
 *
 * R12 lists ELEVEN sub-items. This pass verified all eleven against source and
 * fixes the four that were both confirmed and self-contained; the rest are
 * recorded in PLAN.md for pass 2 rather than half-done here.
 *
 *  R12-a  DOUBLE XP ON EVERY HACK. `resolveHackSession` calls
 *         `updateHackStatistics` AND `awardExperience`, and both granted
 *         `success ? 50 : 10` — once unmultiplied, once multiplied — so every
 *         hack paid twice and a level-up could emit `player:levelup` twice for
 *         one action.
 *  R12-b  `mission:failed` HAD NO EMITTER. `index.ts` has always listened for
 *         it, to advance the story arc and write a ledger entry, but nothing
 *         emitted it: failing or abandoning a mission had no narrative
 *         consequence at all. Same shape as R4's traces.
 *  R12-c  `startTutorial` WAS A CHECK-THEN-ACT. `count()` then create, with no
 *         lock, so two concurrent calls both create a first tutorial mission.
 *  R12-d  RELATIVE PATHS USED THE WRONG DIRECTORY. `getServerContext` read the
 *         legacy top-level `session.currentDirectory` rather than the ACTIVE
 *         terminal's, so with two tabs open in different directories a command
 *         in one could resolve against the other's.
 *
 * Run: npx tsx scripts/verify-phase5-r12-progression.ts
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

async function main() {
  console.log("\n=== Phase 5 R12 (pass 1) — progression ===\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const stamp = String(process.hrtime.bigint()).slice(-7);

  // ── R12-a: exactly ONE experience award per hack ──────────────────────
  console.log("R12-a — a hack awards experience once, not twice");
  {
    // Structural, deliberately: driving a full hack needs a live session, a
    // target server and a minigame. What regressed is that TWO methods in one
    // resolution both granted XP, and that is visible where it lives.
    const src = ["hackService", "hackCountermeasureService", "hackScoring", "hackSessionStore"].map((f) => readFileSync(new URL(`../src/services/${f}.ts`, import.meta.url).pathname, "utf8")).join("\n");

    const statsFn = src.slice(
      src.indexOf("private async updateHackStatistics("),
      src.indexOf("private async awardExperience("),
    );
    check(
      "updateHackStatistics no longer grants experience",
      !/addExperience\(/.test(statsFn),
      /addExperience\(/.test(statsFn)
        ? "still calls addExperience — the double award is back"
        : "statistics only",
    );
    // Match the CALL, not the word: the first version of this check matched
    // the explanatory comment directly above the removed code, which mentions
    // `player:levelup` by name. Third time this session a substring assertion
    // has fired on prose I had just written.
    const emitsLevelup = /this\.emit\(\s*["']player:levelup["']/.test(statsFn);
    check(
      "and it no longer emits player:levelup",
      !emitsLevelup,
      emitsLevelup ? "still emits" : "no emit call (the comment naming it does not count)",
    );

    const awardFn = src.slice(src.indexOf("private async awardExperience("));
    check(
      "POSITIVE CONTROL: awardExperience still grants it",
      /addExperience\(/.test(awardFn) && /player:levelup/.test(awardFn),
      "the surviving award path is intact",
    );
  }

  // ── R12-b: mission:failed actually fires ──────────────────────────────
  console.log("\nR12-b — mission:failed reaches its listener");
  {
    const missionService = getService<any>(TOKENS.MISSION_SERVICE);
    const missions = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);

    const user = await prisma.user.create({
      data: { username: `r12${stamp}`, email: `r12${stamp}@r12.test`, password: "x", homeIp: `10.22.1.${Number(stamp) % 250}` },
    });
    await prisma.playerProgress.create({ data: { userId: user.id, level: 3 } });
    const mission = await prisma.mission.create({
      data: {
        title: `R12 probe ${stamp}`,
        description: "R12 harness",
        type: "infiltration",
        difficulty: 1,
        objectives: [{ id: "o1", type: "hack", description: "probe", target: 1, current: 0, completed: false }] as any,
        reward: { xp: 10, credits: 10 } as any,
        status: "available",
      },
    });
    await missions.mutateAll(user.id, (blob: any) => {
      blob[mission.id] = {
        missionId: mission.id, userId: user.id, status: "active",
        objectives: [{ id: "o1", type: "hack", target: 1, current: 0, completed: false }],
        startedAt: new Date(), completedAt: null, expiresAt: null,
      };
      return true;
    });

    const events: any[] = [];
    missionService.on("mission:failed", (d: any) => events.push(d));

    await missionService.abandonMission(user.id, mission.id);

    check(
      "abandoning a mission emits mission:failed",
      events.length === 1,
      events.length ? `reason=${events[0]?.reason}` : "no event — the listener is still starved",
    );
    check(
      "and the payload carries what the listener reads",
      events[0]?.missionId === mission.id && events[0]?.userId === user.id,
      `missionId=${events[0]?.missionId === mission.id} userId=${events[0]?.userId === user.id}`,
    );

    await prisma.playerMission.deleteMany({ where: { userId: user.id } });
    await prisma.mission.delete({ where: { id: mission.id } });
    await prisma.playerProgress.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  // ── R12-c: concurrent startTutorial creates one tutorial ──────────────
  console.log("\nR12-c — concurrent startTutorial does not double-create");
  {
    const tutorial = getService<any>(TOKENS.TUTORIAL_SERVICE);
    const user = await prisma.user.create({
      data: { username: `r12t${stamp}`, email: `r12t${stamp}@r12.test`, password: "x", homeIp: `10.22.2.${Number(stamp) % 250}` },
    });
    await prisma.playerProgress.create({ data: { userId: user.id, level: 1 } });

    // Fire concurrently — this is the race, not a sequence.
    await Promise.all([
      tutorial.startTutorial(user.id),
      tutorial.startTutorial(user.id),
      tutorial.startTutorial(user.id),
    ]);

    const created = await prisma.mission.count({
      where: { assignedTo: user.id, type: "tutorial" },
    });
    check(
      "three concurrent starts create at most one tutorial mission",
      created <= 1,
      `${created} tutorial missions (unguarded, each caller that wins the count creates one)`,
    );

    await prisma.mission.deleteMany({ where: { assignedTo: user.id } });
    await prisma.playerMission.deleteMany({ where: { userId: user.id } });
    await prisma.playerProgress.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  // ── R12-d: the per-tab cwd fix is WITHDRAWN, and these say why ─────────
  //
  // The original check here was `/activeTerminalId/.test(src)` — purely
  // structural. It passed against a helper that had zero callers and would
  // have resolved paths against a directory nothing maintains, so it
  // certified a fix that could not work. These check the PRECONDITION that
  // makes the naive fix wrong. When someone makes `cd` maintain the
  // per-terminal directory, this flips to failing — which is the signal that
  // the real per-tab fix has become safe to do.
  console.log("\nR12-d — per-tab cwd: precondition for the real fix (withdrawn)");
  {
    // Match CODE, not prose. A bare substring test against the file kept
    // matching the very comments explaining the fix — this is the fourth time
    // that trap has fired in this phase, so the guard strips comments first.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const helpers = stripComments(
      readFileSync(new URL("../src/services/commandModules/helpers.ts", import.meta.url).pathname, "utf8"),
    );
    const sysCmds = stripComments(
      readFileSync(new URL("../src/services/commandModules/systemCommands.ts", import.meta.url).pathname, "utf8"),
    );

    check(
      "the helper does not resolve against the per-terminal directory",
      !/activeTerminalId/.test(helpers) && !/terminals\?\.find/.test(helpers),
      "that field is never updated by cd, so preferring it ignores every cd",
    );

    // The decisive precondition: nothing maintains terminal.currentDirectory
    // after session setup. Verified against cd itself, which is the only
    // command that changes the working directory.
    const cdWritesTerminal = /(activeTerminal|terminal)\.currentDirectory\s*=/.test(sysCmds);
    check(
      "cd still writes only the legacy session field",
      !cdWritesTerminal,
      "so terminal.currentDirectory holds the connect-time home directory",
    );

    check(
      "the helper reads the legacy field it can actually trust",
      /session\.currentDirectory \|\| "\/"/.test(helpers),
      "shared cwd across tabs — the known limitation, filed in PLAN.md",
    );
  }

  // ── R12-e: advancing the LAST epoch must not strand the world ────────
  //
  // SELF-CONTAINED, and it must stay that way. The first version of this
  // block read whatever epochs the dev database happened to hold and then
  // called handleAdvanceEpoch() on them — a STATE-MUTATING service method
  // aimed at live data. That is how the negative control earlier in this
  // phase completed the world's only epoch and genuinely stranded it. A
  // harness that needs ambient state it did not create will eventually
  // either corrupt that state or fail for reasons that have nothing to do
  // with the code under test (this one later crashed outright on an empty
  // table, taking the whole run's summary with it).
  //
  // So: build a private fixture, assert against it, delete exactly it. And
  // if real active epochs exist, SKIP LOUDLY rather than touch them.
  console.log("\nR12-e — epoch advance refuses to retire the last epoch");
  {
    const scheduler = getService<any>(TOKENS.EPOCH_SCHEDULER_SERVICE);

    // The fixture is given a LOWER `order` than any real epoch, because
    // handleAdvanceEpoch selects the current epoch as the lowest-order
    // ACTIVE row and its successor as a DRAFT with a higher order. So a
    // fixture at order -1000 is the one picked, the seeded "Genesis" epoch
    // (order 0, active — recreated by storyProgressionService on every DI
    // boot, so "no epochs exist" is not a state that survives) is never a
    // candidate successor because it is active rather than draft, and real
    // world state is only ever READ.
    const FIXTURE_ORDER = -1000;

    // Snapshot everything else, so the test can prove it touched nothing.
    const othersBefore = await prisma.narrativeEpoch.findMany({
      orderBy: { order: "asc" },
      select: { id: true, status: true, endedAt: true },
    });

    const draftSuccessors = await prisma.narrativeEpoch.count({
      where: { status: "draft", order: { gt: FIXTURE_ORDER } },
    });

    if (draftSuccessors > 0) {
      // Loud skip, never a silent pass: a draft exists, so the no-successor
      // condition this test exercises cannot be set up without mutating it.
      console.log(
        `  [SKIP] ${draftSuccessors} draft epoch(s) exist — cannot stage the ` +
          `"no successor" case without touching real rows.`,
      );
    } else {
      let fixtureId: string | null = null;
      try {
        const fixture = await prisma.narrativeEpoch.create({
          data: {
            epochNum: -(990_000 + (process.pid % 1000)),
            order: FIXTURE_ORDER,
            title: `__r12e_fixture_${process.pid}`,
            description: "R12-e harness fixture — safe to delete",
            summary: "R12-e harness fixture. Required field (no default in schema).",
            status: "active",
            startedAt: new Date(),
          },
        });
        fixtureId = fixture.id;

        // Bound the setup from both sides: our fixture must be the row the
        // service will actually pick, and there must be no successor.
        const picked = await prisma.narrativeEpoch.findFirst({
          where: { status: "active" },
          orderBy: { order: "asc" },
          select: { id: true },
        });
        check(
          "PRECONDITION: the service will select OUR fixture as the current epoch",
          picked?.id === fixture.id,
          picked?.id === fixture.id ? "fixture is lowest-order active" : "a real epoch would be picked",
        );

        const result = await (scheduler as any).handleAdvanceEpoch();
        check(
          "it reports that it did not advance",
          result?.advanced === false,
          `advanced=${result?.advanced} reason=${result?.reason}`,
        );

        const after = await prisma.narrativeEpoch.findUnique({ where: { id: fixture.id } });
        check(
          "the last epoch was NOT retired",
          after?.status === "active" && after?.endedAt == null,
          after?.status === "completed"
            ? "STRANDED — every future advance would now throw"
            : `status=${after?.status} endedAt=${after?.endedAt ?? "null"}`,
        );

        // The safety assertion: real world state is untouched.
        const othersAfter = await prisma.narrativeEpoch.findMany({
          where: { id: { in: othersBefore.map((e) => e.id) } },
          orderBy: { order: "asc" },
          select: { id: true, status: true, endedAt: true },
        });
        check(
          "and no pre-existing epoch was modified",
          JSON.stringify(othersBefore) === JSON.stringify(othersAfter),
          `${othersBefore.length} pre-existing epoch(s) unchanged`,
        );
      } finally {
        if (fixtureId) {
          // Delete by id, and REPORT failure. A swallowed cleanup error
          // leaves a fixture behind that the next run reads as real state.
          try {
            await prisma.narrativeEpoch.delete({ where: { id: fixtureId } });
          } catch (e) {
            console.log(`  [FAIL] fixture cleanup left epoch ${fixtureId} behind — ${e}`);
            fail++;
          }
        }
      }
    }
  }

  // ── R12-f: tutorial missions cannot be abandoned ─────────────────────
  console.log("\nR12-f — tutorial missions cannot be abandoned");
  {
    const missionService = getService<any>(TOKENS.MISSION_SERVICE);
    const missions = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);

    const user = await prisma.user.create({
      data: { username: `r12u${stamp}`, email: `r12u${stamp}@r12.test`, password: "x", homeIp: `10.22.3.${Number(stamp) % 250}` },
    });
    await prisma.playerProgress.create({ data: { userId: user.id, level: 1 } });
    const tut = await prisma.mission.create({
      data: {
        title: `R12 tutorial ${stamp}`, description: "t", type: "tutorial", difficulty: 1,
        objectives: [{ id: "o1", type: "hack", description: "t", target: 1, current: 0, completed: false }] as any,
        reward: { xp: 1, credits: 1 } as any, status: "available", assignedTo: user.id,
      },
    });
    await missions.mutateAll(user.id, (blob: any) => {
      blob[tut.id] = {
        missionId: tut.id, userId: user.id, status: "active",
        objectives: [{ id: "o1", type: "hack", target: 1, current: 0, completed: false }],
        startedAt: new Date(), completedAt: null, expiresAt: null,
      };
      return true;
    });

    const refused = await missionService
      .abandonMission(user.id, tut.id)
      .then(() => false)
      .catch((e: Error) => /tutorial/i.test(e.message));
    check(
      "abandoning a tutorial mission is refused with a reason",
      refused === true,
      refused ? "refused" : "ALLOWED — the tutorial chain would stall with no way to resume",
    );

    const still = await missions.get(user.id, tut.id);
    check(
      "and the mission is still active",
      still?.status === "active",
      `status=${still?.status}`,
    );

    await prisma.playerMission.deleteMany({ where: { userId: user.id } });
    await prisma.mission.delete({ where: { id: tut.id } });
    await prisma.playerProgress.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }

  // ── R12-g: download reports its failures ─────────────────────────────
  console.log("\nR12-g — a failed download is reported, not silent");
  {
    const src = readFileSync(
      new URL("../src/services/commandModules/fileCommands.ts", import.meta.url).pathname,
      "utf8",
    );
    check(
      "the download path emits on !result.success",
      /if \(!result\.success && context\.io\)/.test(src),
      "createFile returns {success:false} for FILE_EXISTS rather than throwing, so the catch never fired",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  await prisma.$disconnect();
  // Drain, then exit explicitly: this harness boots the DI container, whose
  // non-unref'd service timers would otherwise keep the loop alive forever
  // (see O9/R11).
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(1);
});
