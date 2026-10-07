/**
 * Phase 5 R5 — the arity/`any` cluster.
 *
 * Every bug here shared one shape: a wrong call that could not fail loudly,
 * because an `any` stopped the compiler seeing it AND an enclosing
 * catch/fallback stopped the runtime reporting it. So each check below must
 * distinguish "the fixed code ran" from "the broken code failed quietly" —
 * asserting merely that nothing threw would have passed before the fix too.
 *
 *  R5-a  hackService.triggerCounterMeasures passed THREE args to the
 *        four-parameter initiateTrace. `initiateTrace` catches its own errors
 *        and returns { success:false }, so no trace row was ever written while
 *        the very next line still pushed "trace_active".
 *  R5-b  epochSchedulerService called `executor.executeSingle`, a method that
 *        has never existed. The TypeError was eaten by a safeExecute fallback,
 *        so every epoch-scheduled Architect intervention reported "failed".
 *  R5-c  personaMissionGenService read `progress.totalXP` — the column is
 *        `experience` — behind an `as any`, so every faction's estimated
 *        player level was 1 regardless of its members.
 *  R5-d  regression guard: no `getService<any>` may come back.
 *
 * Run: npx tsx scripts/verify-phase5-r5.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n=== Phase 5 R5 — arity and `any` cluster ===\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const stamp = String(process.hrtime.bigint()).slice(-7);

  // ── R5-a: the trace is actually created ────────────────────────────────
  console.log("R5-a — counter-measures really initiate a trace");
  {
    const hackService = getService<any>(TOKENS.HACK_SERVICE);

    const victim = await prisma.user.create({
      data: { username: `r5v${stamp}`, email: `r5v${stamp}@r5.test`, password: "x", homeIp: `10.77.1.${Number(stamp) % 250}` },
    });
    const attacker = await prisma.user.create({
      data: { username: `r5a${stamp}`, email: `r5a${stamp}@r5.test`, password: "x", homeIp: `10.77.2.${Number(stamp) % 250}` },
    });
    const server = await prisma.gameServer.create({
      data: {
        name: `R5 Target ${stamp}`,
        ipAddress: `10.77.9.${Number(stamp) % 250}`,
        type: "corporate",
        ownerId: victim.id,
        securityLevel: 5,
        firewallLevel: 5,
      },
    });

    const before = await prisma.activeTrace.count({ where: { targetId: attacker.id } });
    check("PRECONDITION: no trace exists for the attacker yet", before === 0, `${before} rows`);

    // Drive the private method directly. evidenceLevel > 80 is the branch that
    // reaches the trace call.
    const measures: string[] = await (hackService as any).countermeasures.triggerCounterMeasures(
      server.id,
      95,
      victim.id,
      attacker.id,
    );

    const traces = await prisma.activeTrace.findMany({ where: { targetId: attacker.id } });
    check(
      "a trace row is actually created",
      traces.length === 1,
      `${traces.length} rows (the bug created none while still reporting success)`,
    );
    if (traces[0]) {
      check(
        "initiatedBy is the server OWNER, not the serverId",
        traces[0].initiatedBy === victim.id,
        `initiatedBy=${traces[0].initiatedBy} expected=${victim.id}`,
      );
      check(
        "serverId is the server, not the evidence NUMBER",
        traces[0].serverId === server.id,
        `serverId=${traces[0].serverId}`,
      );
      check(
        "evidenceLevel survived instead of arriving undefined",
        traces[0].evidenceLevel === 95,
        `evidenceLevel=${traces[0].evidenceLevel}`,
      );
    }
    check(
      '"trace_active" is reported only because it is now true',
      measures.includes("trace_active"),
      measures.join(","),
    );

    await prisma.activeTrace.deleteMany({ where: { targetId: attacker.id } });
    await prisma.gameServer.delete({ where: { id: server.id } });
    await prisma.user.deleteMany({ where: { id: { in: [victim.id, attacker.id] } } });
  }

  // ── R5-b: the Architect executor method exists and runs ────────────────
  console.log("\nR5-b — epoch-scheduled Architect interventions reach the executor");
  {
    const executor = getService<any>(TOKENS.ARCHITECT_INTERVENTION_EXECUTOR);
    check(
      "the executor exposes execute(), and never had executeSingle()",
      typeof executor.execute === "function" && typeof executor.executeSingle === "undefined",
      `execute=${typeof executor.execute} executeSingle=${typeof executor.executeSingle}`,
    );

    // Feed an intervention type that has no handler. That returns a real
    // { success:false, error:"Unknown intervention type: ..." } WITHOUT any
    // side effects — and it is distinguishable from the old behaviour, where
    // the missing method threw and the safeExecute fallback answered with the
    // literal interventionType "failed" and no error field.
    const scheduler = getService<any>(TOKENS.EPOCH_SCHEDULER_SERVICE);
    const result = await (scheduler as any).handleArchitectIntervention({
      type: "__r5_probe_unknown_type__",
      reasoning: "R5 harness probe",
    });

    check(
      "the call reaches the executor rather than the fallback",
      result?.interventionType === "__r5_probe_unknown_type__",
      `interventionType=${result?.interventionType} (the bug answered "failed")`,
    );
    check(
      "and it returns the executor's real verdict",
      result?.success === false && typeof result?.error === "string" && /Unknown intervention type/i.test(result.error),
      `success=${result?.success} error=${result?.error ?? "(none)"}`,
    );
  }

  // ── R5-c: faction level estimate reflects real experience ──────────────
  console.log("\nR5-c — estimateFactionPlayerLevel reads `experience`, not `totalXP`");
  {
    const gen = getService<any>(TOKENS.PERSONA_MISSION_GEN_SERVICE);

    const faction = await prisma.faction.create({
      data: { name: `R5 Faction ${stamp}`, shortName: `r5f${stamp}`.slice(0, 20), description: "R5 harness" },
    });
    // 40_000 experience -> floor(sqrt(400)) + 1 = 21 on the canonical curve.
    const members = [];
    for (let i = 0; i < 3; i++) {
      const u = await prisma.user.create({
        data: { username: `r5m${i}${stamp}`, email: `r5m${i}${stamp}@r5.test`, password: "x", homeIp: `10.78.${i}.${Number(stamp) % 250}` },
      });
      await prisma.playerProgress.create({ data: { userId: u.id, experience: 40_000, level: 21 } });
      await prisma.factionMember.create({ data: { userId: u.id, factionId: faction.id, rank: "member" } });
      members.push(u.id);
    }

    const level = await gen.estimateFactionPlayerLevel(faction.id);
    check(
      "the estimate reflects member experience",
      level === 21,
      `got ${level} (the bug always produced 1; an empty faction would give 10)`,
    );

    await prisma.factionMember.deleteMany({ where: { factionId: faction.id } });
    await prisma.playerProgress.deleteMany({ where: { userId: { in: members } } });
    await prisma.user.deleteMany({ where: { id: { in: members } } });
    await prisma.faction.delete({ where: { id: faction.id } });
  }

  // ── R5-d: the pattern must not come back ───────────────────────────────
  console.log("\nR5-d — regression guard");
  {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!entry.endsWith(".ts")) continue;
        const text = readFileSync(full, "utf8");
        // Real call sites only — the two explanatory comments naming the
        // pattern are the reason this matches on `(` rather than the bare
        // string.
        for (const m of text.matchAll(/getService<any>\s*\(/g)) {
          const line = text.slice(0, m.index).split("\n").length;
          offenders.push(`${full.replace(/.*\/server\//, "")}:${line}`);
        }
      }
    };
    walk(new URL("../src", import.meta.url).pathname);
    check(
      "no getService<any> call sites remain",
      offenders.length === 0,
      offenders.length ? offenders.join(", ") : "0 of the original 51",
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
