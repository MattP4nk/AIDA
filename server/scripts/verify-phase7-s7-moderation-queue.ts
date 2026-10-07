/**
 * Phase 7 S7 — a queued moderation re-check cannot be silently lost.
 *
 * `moderationGate` fails OPEN on `unavailable`: the content is published and a
 * re-check is queued, and the whole policy rests on that re-check actually
 * running. It rides the shared AI retry queue — seven callers, 20 slots — and
 * every way out of that queue except success was a permanent fail-open:
 *
 *   - overflow evicted the OLDEST entry, so a burst of NPC mail or ambient
 *     prose could drop a moderation re-check. The failure modes are
 *     correlated: `unavailable` happens during an AI outage, which is exactly
 *     when the queue fills with everything else that just failed.
 *   - the 10-minute age purge discarded entries with no log and no counter.
 *   - the callback's `await onVerdict(...)` sat inside a bare `catch {}`, so a
 *     correct UNSAFE verdict whose hide/notify action threw vanished silently.
 *
 * These are BEHAVIOURAL checks against the real queue — they call the real
 * public API and read the real metrics. A structural grep would pass against
 * code where the eviction loop never runs.
 *
 * Run: npx tsx scripts/verify-phase7-s7-moderation-queue.ts
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
  console.log("\n=== Phase 7 S7 — moderation re-checks survive the shared queue ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const ai = getService<any>(TOKENS.AI_SERVICE);

  // Stop the 30s interval: a tick mid-harness would call the live AI and
  // mutate the queue underneath these assertions.
  ai.stopRetryQueue();

  const q = (): any[] => ai.retryQueue;
  const reset = () => { ai.retryQueue = []; };
  const MAX: number = ai.RETRY_QUEUE_MAX;

  // ── 1. A critical entry is not evicted by ordinary queue pressure ────
  console.log("\nS7-1 — overflow drops ordinary work, not the moderation re-check");
  {
    reset();
    // The critical entry goes in FIRST, so plain FIFO would evict it first.
    ai.queueForRetry("moderate me", "sys", () => {}, undefined, true);
    for (let i = 0; i < MAX * 2; i++) ai.queueForRetry(`filler ${i}`, "sys", () => {});

    const criticals = q().filter((r) => r.critical);
    check(
      "the critical entry survived 2x queue capacity of ordinary work",
      criticals.length === 1,
      `${criticals.length} critical of ${q().length} queued (max ${MAX})`,
    );
    check("the queue still respects its cap", q().length <= MAX, `${q().length} <= ${MAX}`);

    // POSITIVE CONTROL: the filler is genuinely being evicted, so the check
    // above is not passing merely because nothing overflowed.
    check(
      "ordinary entries were in fact evicted",
      ai.getMetrics().retryQueueDropped > 0 && q().length === MAX,
      `queue full at ${q().length}`,
    );
  }

  // ── 2. Abandoning a critical entry is counted, not just logged ───────
  console.log("\nS7-2 — an abandoned re-check increments a counter");
  {
    reset();
    const before = ai.getMetrics().moderationRechecksAbandoned;
    ai.queueForRetry("too old", "sys", () => {}, undefined, true);
    // Age it past RETRY_MAX_AGE_MS so the purge at the top of the tick takes it.
    q()[0].createdAt = Date.now() - (ai.RETRY_MAX_AGE_MS + 1000);
    await ai.processRetryQueue();

    const after = ai.getMetrics().moderationRechecksAbandoned;
    check("the age purge counted the abandoned re-check", after === before + 1, `${before} -> ${after}`);
    check("and removed it from the queue", q().length === 0, `${q().length} left`);
  }

  // ── 3. The purge does NOT count ordinary work as a lost re-check ─────
  console.log("\nS7-3 — the counter means moderation specifically");
  {
    reset();
    const before = ai.getMetrics().moderationRechecksAbandoned;
    ai.queueForRetry("ordinary", "sys", () => {});
    q()[0].createdAt = Date.now() - (ai.RETRY_MAX_AGE_MS + 1000);
    await ai.processRetryQueue();
    check(
      "an expired ordinary entry did not inflate the moderation counter",
      ai.getMetrics().moderationRechecksAbandoned === before,
      `stayed ${before}`,
    );
  }

  // ── 4. A failing hide/notify action is surfaced, not swallowed ───────
  console.log("\nS7-4 — enforcement failure on an UNSAFE verdict is logged loudly");
  {
    const errors: string[] = [];
    const realLogger = ai.logger;
    ai.logger = {
      ...realLogger,
      info: () => {}, debug: () => {}, warn: () => {},
      error: (_o: any, msg?: string) => errors.push(typeof _o === "string" ? _o : (msg ?? "")),
    };

    reset();
    ai.queueModerationRecheck("some content", () => {
      throw new Error("hide action blew up");
    });
    // queueModerationRecheck defers through a dynamic import.
    await new Promise((r) => setTimeout(r, 50));
    check("the re-check was queued as critical", q().length === 1 && q()[0].critical === true);

    // Drive the callback directly with an UNSAFE verdict; the enforcement throws.
    await q()[0].onSuccess('{"safe": false, "reason": "hate speech"}');

    check(
      "the failed hide was reported at error level",
      errors.some((m) => m.includes("hide/notify action FAILED")),
      errors.length ? errors[errors.length - 1]! : "nothing logged",
    );

    ai.logger = realLogger;
    reset();
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  // Force the exit after flushing. `setupContainer` boots services that hold
  // timers and sockets open, so the event loop never drains on its own and
  // run-verify.sh would kill this at its 300s timeout and score it a failure.
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
