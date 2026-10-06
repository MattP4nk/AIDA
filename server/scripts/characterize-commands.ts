/**
 * Phase 7 — CHARACTERIZATION HARNESS (golden master).
 *
 * Phase 7 is "behaviour-preserving by definition", but before this file there
 * was nothing capable of noticing if that were false:
 *
 *   - zero harnesses called `executeCommand` (verified repo-wide)
 *   - the socket-contract check PLAN.md says Phase 2 delivered does not exist
 *   - no cycle-detection tooling is installed
 *   - VERIFY.md is a MANUAL playthrough, and says so in its own header
 *
 * So the only regression detector for a week of refactoring was a person
 * playing the game. This pins the observable output of real commands and
 * diffs it against a recorded baseline.
 *
 * USAGE
 *   npx tsx scripts/characterize-commands.ts --record   # write the baseline
 *   npx tsx scripts/characterize-commands.ts            # compare against it
 *
 * Record BEFORE a refactor, compare AFTER. A diff is either a regression or a
 * deliberate change you must re-record on purpose — never a surprise.
 *
 * READ-ONLY BY CONSTRUCTION. Every command below only reads. That is not
 * fastidiousness: R12-e in Phase 5 called a state-mutating service method
 * against ambient data and completed the world's only epoch. A harness that
 * corrupts the state it measures is worse than no harness.
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const prisma = new PrismaClient();
const BASELINE = new URL("./characterize-commands.baseline.json", import.meta.url).pathname;
const RECORD = process.argv.includes("--record");

/**
 * One representative command per module, chosen to be read-only.
 * `label` names the module so a diff points at what moved.
 */
/**
 * `shapeOnly` pins the contract (success / output type / data keys) but NOT the
 * rendered text, for commands whose output is legitimately world-dependent.
 *
 * `leaderboard` ranks other players' live state — including online status,
 * which THIS HARNESS perturbs by creating a session. Pinning its text made the
 * suite alternate 22/23 across runs. A golden master that cries wolf gets
 * ignored, which is the same as not having one; the fix is to characterize
 * only what the refactor could actually break.
 */
const CASES: Array<{ module: string; input: string; shapeOnly?: boolean }> = [
  { module: "systemCommands", input: "pwd" },
  { module: "systemCommands", input: "ls" },
  { module: "helpCommands", input: "help" },
  { module: "helpCommands", input: "stats" },
  { module: "playerInfoCommands", input: "status" },
  { module: "playerInfoCommands", input: "skills" },
  { module: "playerInfoCommands", input: "leaderboard", shapeOnly: true },
  { module: "processCommands", input: "ps" },
  { module: "processCommands", input: "specs" },
  { module: "networkCommands", input: "servers" },
  { module: "missionCommands", input: "missions" },
  { module: "shopCommands", input: "shop" },
  { module: "socialCommands", input: "inbox" },
  { module: "factionCommands", input: "faction list" },
  { module: "defenseCommands", input: "defenses" },
  { module: "fragmentCommands", input: "fragments" },
  { module: "aliasCommands", input: "alias info" },
  { module: "mathCommands", input: "calc 2+2" },
  { module: "hackCommands", input: "hack" }, // bare: usage text, no target
  { module: "fileCommands", input: "download" }, // bare: usage text
  { module: "fileAccessCommands", input: "sweep" }, // bare: usage text
  // Error paths are behaviour too, and are the cheapest thing to break.
  { module: "unknown", input: "definitely_not_a_command" },
  { module: "systemCommands", input: "cd /nonexistent-dir-xyz" },
];

/**
 * Strip everything that legitimately varies between runs. If this over-strips
 * the harness goes blind; if it under-strips it cries wolf. Each rule below
 * exists for an observed source of churn.
 */
function normalize(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\b[0-9a-f]{25,}\b/gi, "<id>") // cuid
      .replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "<ip>")
      .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<ts>")
      // Bare calendar dates too. `stats` prints "Recent Activity" as
      // `YYYY-MM-DD  N commands`, which the ISO rule above does not match
      // because there is no `T`. The baseline recorded 2026-09-25 and went
      // red on 2026-09-26 and every day after — a golden master that fails on
      // the calendar is the "cries wolf" failure this comment warns about,
      // and it was indistinguishable from a real regression.
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "<date>")
      .replace(/\b\d+\s?ms\b/gi, "<ms>")
      .replace(/\b\d+(\.\d+)?\s?(s|sec|seconds|m|min|h|hours|d|days)\b/gi, "<dur>")
      .replace(/\b\d{1,3}%/g, "<pct>");
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      if (k === "timestamp" || k === "executionTime") continue; // pure noise
      out[k] = normalize((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

async function main() {
  console.log("\n=== Phase 7 — command characterization ===");
  console.log(RECORD ? "MODE: recording baseline\n" : "MODE: comparing against baseline\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const processor = getService<any>(TOKENS.COMMAND_PROCESSOR);
  if (!processor) throw new Error("COMMAND_PROCESSOR did not resolve");

  // Use an EXISTING player rather than creating one: creating a user seeds a
  // home server, filesystem and tutorial mission, which is a mutation.
  const user = await prisma.user.findFirst({
    where: { role: "player" },
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true, homeServerId: true },
  });
  if (!user) {
    console.log("  [SKIP] no player in this database — seed one first");
    await prisma.$disconnect();
    process.stdout.write("", () => process.exit(0));
    return;
  }
  console.log(`  subject: ${user.username} (home=${user.homeServerId ?? "none"})`);

  // A SESSION IS REQUIRED, and discovering that is the whole reason this
  // harness has a negative control.
  //
  // The first version drove executeCommand with no session. `validateCommand`
  // rejects before dispatch with "No active session", so all 23 cases recorded
  // the SAME validation error, zero commands actually ran, and the baseline was
  // stable across runs for the worst possible reason. It passed a two-run
  // determinism check and still proved nothing — a characterization harness
  // that characterizes nothing. Only patching a real handler and seeing the
  // suite stay green exposed it.
  const gsm = getService<any>(TOKENS.GAME_STATE_MANAGER);
  await gsm.createSession(user.id, `characterize_${process.pid}`, "127.0.0.1");
  const session = gsm.getSession(user.id);
  if (!session) throw new Error("session creation failed — cases would all be vacuous again");

  // And a SERVER CONNECTION: validateCommand's second gate is "Must be
  // connected to a server to execute this command", which rejected all 23
  // cases even with a session. Found the same way — the vacuity guard below
  // refused to record a run in which nothing succeeded.
  //
  // Uses the real connect path rather than poking `session.currentServerId`,
  // so the harness exercises the state the code actually produces.
  // `destroySession` disconnects again, so this leaves nothing behind.
  if (user.homeServerId) {
    await gsm.connectPlayerToServer(user.id, user.homeServerId);
  }
  const ready = gsm.getSession(user.id);
  console.log(
    `  session established (cwd=${ready?.currentDirectory ?? "?"}, server=${ready?.currentServerId ? "connected" : "NONE"})\n`,
  );

  const results: Record<string, unknown> = {};
  for (const [i, c] of CASES.entries()) {
    const key = `${String(i).padStart(2, "0")}:${c.module}:${c.input}`;
    try {
      const parsed = processor.parseCommand(user.id, c.input, user.homeServerId ?? undefined);
      const res = await processor.executeCommand(
        user.id,
        parsed,
        user.homeServerId ?? undefined,
        undefined,
        80,
        "player",
      );
      results[key] = normalize({
        success: res?.success,
        output: c.shapeOnly ? "<world-dependent>" : res?.output,
        error: c.shapeOnly ? (res?.error ? "<error>" : undefined) : res?.error,
        exitCode: res?.exitCode,
        // Shape of `data`, not its values — values are world state, and would
        // make this a test of the database rather than of the code.
        dataKeys: res?.data && typeof res.data === "object" ? Object.keys(res.data).sort() : null,
        outputType: Array.isArray(res?.output) ? "array" : typeof res?.output,
      });
    } catch (err) {
      // A throw is observable behaviour too — pin it rather than dying.
      results[key] = { threw: String(err instanceof Error ? err.message : err) };
    }
  }

  // PRECONDITION on the results themselves: if nothing succeeded, the run is
  // vacuous and must not be recorded or compared as if it meant something.
  const succeeded = Object.values(results).filter(
    (r: any) => r && typeof r === "object" && r.success === true,
  ).length;
  console.log(`  ${succeeded}/${CASES.length} commands executed successfully`);
  if (succeeded === 0) {
    console.log("  [FAIL] NO command succeeded — the run is vacuous (session? permissions?)");
    console.log("\n=== 0 PASS / 1 FAIL ===");
    await gsm.destroySession(user.id).catch(() => {});
    await prisma.$disconnect();
    process.stdout.write("", () => process.exit(1));
    return;
  }

  if (RECORD) {
    writeFileSync(BASELINE, JSON.stringify(results, null, 2));
    console.log(`  recorded ${Object.keys(results).length} cases -> ${BASELINE}`);
    console.log("\n=== BASELINE RECORDED ===");
  } else if (!existsSync(BASELINE)) {
    console.log("  [FAIL] no baseline. Run with --record BEFORE refactoring.");
    console.log("\n=== 0 PASS / 1 FAIL ===");
    await gsm.destroySession(user.id).catch(() => {});
    await prisma.$disconnect();
    process.stdout.write("", () => process.exit(1));
    return;
  } else {
    // Re-normalise the stored baseline with the CURRENT rules. A rule added
    // after a baseline was recorded (the `<date>` one) would otherwise force a
    // re-record — and a re-record erases the evidence that nothing else moved,
    // which is the whole point of having the master.
    const baseline = normalize(
      JSON.parse(readFileSync(BASELINE, "utf8")),
    ) as Record<string, unknown>;
    let pass = 0;
    let fail = 0;

    const allKeys = [...new Set([...Object.keys(baseline), ...Object.keys(results)])].sort();
    for (const k of allKeys) {
      const a = JSON.stringify(baseline[k]);
      const b = JSON.stringify(results[k]);
      if (a === b) {
        pass++;
      } else {
        fail++;
        console.log(`  [FAIL] ${k}`);
        if (!(k in baseline)) console.log("         (new case — re-record if intended)");
        else if (!(k in results)) console.log("         (case disappeared)");
        else {
          console.log(`         was: ${a?.slice(0, 220)}`);
          console.log(`         now: ${b?.slice(0, 220)}`);
        }
      }
    }
    if (fail === 0) console.log(`  all ${pass} command behaviours unchanged`);
    console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
    await gsm.destroySession(user.id).catch(() => {});
    await prisma.$disconnect();
    process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
    return;
  }

  await gsm.destroySession(user.id).catch(() => {});
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
