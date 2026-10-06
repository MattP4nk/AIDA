/**
 * Phase 5 R4 — trace completion is reachable, and `trace.evade` matters.
 *
 * Four defects, found by reading the progress loop after R5 made traces exist
 * at all:
 *
 *  R4-a  COMPLETION WAS UNREACHABLE. `progress` is `elapsed / totalDuration`,
 *        so `progress >= 100` is true at exactly the instant `now >= expiresAt`
 *        — and an expiry check above it `continue`d first. Every trace ended
 *        "expired" and `trace:completed` had never fired.
 *  R4-b  THE RESOURCE DRAIN LEAKED. An active trace is a passive consumer
 *        (cpu 15 / ram 16 / bw 5). `unregisterActiveTrace` had ZERO callers in
 *        the entire codebase, so the drain outlived every trace.
 *  R4-c  THE DRAIN WAS KEYED WRONG. `registerActiveTrace(userId, traceId, ...)`
 *        was passed `serverId`. Both strings, so nothing complained — but the
 *        consumer was keyed `trace:<serverId>` and unregister looks up
 *        `trace:<traceId>`, so the release could never have matched even once
 *        it had a caller.
 *  R4-d  Evading now actually frees the resources.
 *
 * Note on what "passes" means here. A trace ending "expired" and a trace
 * ending "completed" both *end* — so asserting "the trace is no longer active"
 * would have passed before the fix. Every check below names the terminal state.
 *
 * Run: npx tsx scripts/verify-phase5-r4-traces.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n=== Phase 5 R4 — trace completion and evasion ===\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const traceService = getService<any>(TOKENS.TRACE_SERVICE);
  const memoryService = getService<any>(TOKENS.MEMORY_SERVICE);

  const stamp = String(process.hrtime.bigint()).slice(-7);
  const mk = async (tag: string, n: number) =>
    prisma.user.create({
      data: {
        username: `r4${tag}${stamp}`,
        email: `r4${tag}${stamp}@r4.test`,
        password: "x",
        homeIp: `10.66.${n}.${Number(stamp) % 250}`,
      },
    });

  let evaderId: string | null = null;
  const hacker = await mk("h", 1);
  const owner = await mk("o", 2);
  const server = await prisma.gameServer.create({
    data: {
      name: `R4 Target ${stamp}`,
      ipAddress: `10.66.9.${Number(stamp) % 250}`,
      type: "corporate",
      ownerId: owner.id,
    },
  });
  await prisma.playerProgress.create({
    // stealth 100 -> base evade chance 0.7; at progress 0 the penalty is 0, so
    // evasion is overwhelmingly likely. The retry loop below removes the rest
    // of the flake without weakening the assertion.
    data: { userId: hacker.id, stealth: 100, experience: 0 },
  });

  const cleanup = async () => {
    const ids = [hacker.id, owner.id, ...(evaderId ? [evaderId] : [])];
    await prisma.activeTrace.deleteMany({ where: { targetId: { in: ids } } });
    await prisma.gameServer.deleteMany({ where: { id: server.id } });
    await prisma.playerProgress.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  };

  try {
    // ── R4-a: a trace that runs its full duration COMPLETES ──────────────
    console.log("R4-a — a trace at full duration completes (it used to expire)");
    {
      const res = await traceService.initiateTrace(hacker.id, owner.id, server.id, 95);
      check("PRECONDITION: the trace was created", res?.success === true, res?.error ?? "ok");
      const traceId = res.trace.id;

      // Backdate it past its own expiry, which is the exact condition that
      // used to route it to "expired" before completion could be considered.
      await prisma.activeTrace.update({
        where: { id: traceId },
        data: {
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      let completedEvent: any = null;
      traceService.once("trace:completed", (e: any) => { completedEvent = e; });

      const result = await traceService.progressTraces();
      const row = await prisma.activeTrace.findUnique({ where: { id: traceId } });

      check(
        'the terminal status is "completed", NOT "expired"',
        row?.status === "completed",
        `status=${row?.status} (every trace used to land on "expired")`,
      );
      check("progress is recorded as 100", row?.progress === 100, `progress=${row?.progress}`);
      check("completedAt is stamped", row?.completedAt != null, `completedAt=${row?.completedAt}`);
      check(
        "it is reported in `completed`, not `expired`",
        result.completed.includes(traceId) && !result.expired.includes(traceId),
        `completed=${result.completed.length} expired=${result.expired.length}`,
      );
      check(
        "trace:completed actually fires",
        completedEvent?.traceId === traceId && completedEvent?.initiatedBy === owner.id,
        completedEvent ? `targetId=${completedEvent.targetId}` : "no event — it had never fired before",
      );

      await prisma.activeTrace.deleteMany({ where: { id: traceId } });
    }

    // ── R4-b/c: completion releases the drain, keyed correctly ───────────
    console.log("\nR4-b/c — completing a trace releases the resource drain");
    {
      const res = await traceService.initiateTrace(hacker.id, owner.id, server.id, 95);
      const traceId = res.trace.id;

      // Register the drain the way hackService now does — by TRACE id.
      memoryService.registerActiveTrace(hacker.id, traceId, "R4 harness trace");

      const usedBefore = memoryService
        .getPassiveConsumers(hacker.id)
        .filter((c: any) => c.type === "active_trace").length;
      check(
        "PRECONDITION: the trace registers a passive consumer",
        usedBefore === 1,
        `${usedBefore} active_trace consumers`,
      );

      await prisma.activeTrace.update({
        where: { id: traceId },
        data: {
          createdAt: new Date(Date.now() - 60 * 60 * 1000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await traceService.progressTraces();

      const usedAfter = memoryService
        .getPassiveConsumers(hacker.id)
        .filter((c: any) => c.type === "active_trace").length;
      check(
        "the drain is released when the trace completes",
        usedAfter === 0,
        `${usedAfter} active_trace consumers remain (unregisterActiveTrace had ZERO callers before)`,
      );

      await prisma.activeTrace.deleteMany({ where: { id: traceId } });
    }

    // ── R4-d: evading frees the resources ────────────────────────────────
    console.log("\nR4-d — evading a trace frees the resources");
    {
      // ISOLATION: its own player. Sharing `hacker` with R4-b/c meant a leaked
      // consumer there showed up as a failure HERE — which is exactly what the
      // negative-control run produced, giving R4-d a verdict that was really
      // about the previous block. A cascading failure is a misleading failure.
      const evader = await mk("e", 3);
      await prisma.playerProgress.create({
        data: { userId: evader.id, stealth: 100, experience: 0 },
      });
      evaderId = evader.id;

      let evadedTraceId: string | null = null;

      // stealth 100 at progress 0 gives a 0.7 chance; retry so a losing roll
      // is not reported as a broken release path. Each attempt costs stealth,
      // so top it back up between tries to keep the odds constant.
      for (let attempt = 0; attempt < 12 && !evadedTraceId; attempt++) {
        await prisma.playerProgress.update({
          where: { userId: evader.id },
          data: { stealth: 100 },
        });
        const res = await traceService.initiateTrace(evader.id, owner.id, server.id, 95);
        if (!res?.success) break;
        const traceId = res.trace.id;
        memoryService.registerActiveTrace(evader.id, traceId, "R4 harness trace");

        const out = await traceService.evadeTrace(evader.id, traceId);
        if (out?.evaded) {
          evadedTraceId = traceId;
        } else {
          await prisma.activeTrace.deleteMany({ where: { id: traceId } });
          memoryService.unregisterActiveTrace(evader.id, traceId);
        }
      }

      check(
        "PRECONDITION: a high-stealth player can evade a fresh trace",
        evadedTraceId !== null,
        evadedTraceId ? `traceId=${evadedTraceId}` : "no successful evasion in 12 attempts",
      );

      if (evadedTraceId) {
        const row = await prisma.activeTrace.findUnique({ where: { id: evadedTraceId } });
        check('the trace status is "evaded"', row?.status === "evaded", `status=${row?.status}`);

        const remaining = memoryService
          .getPassiveConsumers(evader.id)
          .filter((c: any) => c.type === "active_trace").length;
        check(
          "evading RELEASES the drain — this is what makes trace.evade matter",
          remaining === 0,
          `${remaining} active_trace consumers remain (before R4, evading changed a column and nothing else)`,
        );

        // And it must stay out of the progress loop.
        const before = await prisma.activeTrace.findUnique({ where: { id: evadedTraceId } });
        await traceService.progressTraces();
        const after = await prisma.activeTrace.findUnique({ where: { id: evadedTraceId } });
        check(
          "an evaded trace is not resurrected by the progress loop",
          after?.status === "evaded" && after?.progress === before?.progress,
          `status=${after?.status} progress=${after?.progress}`,
        );
      }
    }

    console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
