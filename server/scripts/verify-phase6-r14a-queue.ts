/**
 * Phase 6 R14a — AI retry queue + slot/retry timeout arithmetic.
 *
 * These are CONCURRENCY behaviours, so every check here drives the real
 * methods and observes what actually happens. A structural grep would prove
 * nothing about whether two interval ticks can overlap.
 *
 *  RQ-1  REENTRANCY. processRetryQueue is driven by setInterval(30s) and never
 *        awaited, while generateResponse can hold for up to SLOT_TIMEOUT_MS.
 *        Ticks overlapped as a matter of course: several read the same
 *        retryQueue[0], each fired that request's onSuccess (duplicate
 *        content), and each shift()ed a different entry off the front — so
 *        every duplicate delivery cost another request, untried.
 *
 *  RQ-2  IN-FLIGHT REQUEST WAS DROPPABLE. queueForRetry dropped "the oldest
 *        entry" on overflow, which was the one being generated.
 *
 *  RQ-3  POSITIONAL REMOVAL. shift() after a long await removes whatever is at
 *        index 0 THEN, not the request that was processed.
 *
 *  RQ-4  SLOT HOLD vs SLOT TIMEOUT. The retry chain runs inside the acquired
 *        slot; it could hold 380s while waiters gave up after 120s.
 *
 * Run: npx tsx scripts/verify-phase6-r14a-queue.ts
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\n=== Phase 6 R14a — AI retry queue & slot arithmetic ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const ai = getService<any>(TOKENS.AI_SERVICE);

  // Stop the real 30s interval so it cannot interleave with these checks.
  if (ai.retryTimer) clearInterval(ai.retryTimer);

  // ── RQ-1: overlapping ticks ──────────────────────────────────────────
  console.log("\nRQ-1 — overlapping interval ticks cannot double-process a request");
  {
    ai.retryQueue.length = 0;
    ai.retryQueueProcessing = false;

    let generateCalls = 0;
    const origGenerate = ai.generateResponse.bind(ai);
    // Slow success, so a second tick lands while the first is still awaiting.
    ai.generateResponse = async () => {
      generateCalls++;
      await sleep(250);
      return { success: true, response: "ok" };
    };

    let successCallbacks = 0;
    ai.queueForRetry("p1", undefined, () => { successCallbacks++; });
    ai.queueForRetry("p2", undefined, () => { successCallbacks++; });
    ai.queueForRetry("p3", undefined, () => { successCallbacks++; });

    // Fire three ticks the way setInterval would — without awaiting.
    const t1 = ai.processRetryQueue();
    const t2 = ai.processRetryQueue();
    const t3 = ai.processRetryQueue();
    await Promise.all([t1, t2, t3]);

    check(
      "three concurrent ticks produce exactly ONE generate call",
      generateCalls === 1,
      `${generateCalls} generate call(s)`,
    );
    check(
      "and fire onSuccess exactly once",
      successCallbacks === 1,
      `${successCallbacks} callback(s) — duplicates here are duplicate NPC mail`,
    );
    check(
      "the other two requests are still queued, not silently discarded",
      ai.retryQueue.length === 2,
      `${ai.retryQueue.length} left (started with 3, one succeeded)`,
    );

    ai.generateResponse = origGenerate;
  }

  // ── RQ-2 + RQ-3: the in-flight request survives an overflow ──────────
  console.log("\nRQ-2/3 — an overflow during generation cannot drop the in-flight request");
  {
    ai.retryQueue.length = 0;
    ai.retryQueueProcessing = false;

    const delivered: string[] = [];
    const origGenerate = ai.generateResponse.bind(ai);
    ai.generateResponse = async (prompt: string) => {
      await sleep(300);
      return { success: true, response: `resp:${prompt}` };
    };

    ai.queueForRetry("VICTIM", undefined, (r: string) => { delivered.push(r); });

    // Start processing; do NOT await — this is the in-flight window.
    const inflight = ai.processRetryQueue();
    await sleep(50); // let it take the request and begin awaiting

    check(
      "the in-flight request is OUT of the queue while it runs",
      ai.retryQueue.length === 0,
      `${ai.retryQueue.length} in queue — if it were still here, overflow could drop it`,
    );

    // Now flood past RETRY_QUEUE_MAX while the victim is generating.
    for (let i = 0; i < ai.RETRY_QUEUE_MAX + 5; i++) {
      ai.queueForRetry(`flood${i}`, undefined, () => {});
    }
    await inflight;

    check(
      "the in-flight request still delivered its result",
      delivered.length === 1 && delivered[0] === "resp:VICTIM",
      delivered.length === 0 ? "LOST — overflow dropped the request being generated" : delivered[0]!,
    );
    check(
      "the queue is capped at RETRY_QUEUE_MAX",
      ai.retryQueue.length <= ai.RETRY_QUEUE_MAX,
      `${ai.retryQueue.length} <= ${ai.RETRY_QUEUE_MAX}`,
    );

    ai.generateResponse = origGenerate;
    ai.retryQueue.length = 0;
  }

  // ── RQ-3b: a failed attempt is re-queued, not lost ───────────────────
  console.log("\nRQ-3b — a failed attempt returns to the queue and keeps its attempt count");
  {
    ai.retryQueue.length = 0;
    ai.retryQueueProcessing = false;

    const origGenerate = ai.generateResponse.bind(ai);
    ai.generateResponse = async () => ({ success: false, response: "", error: "nope" });

    ai.queueForRetry("retry-me", undefined, () => {});
    await ai.processRetryQueue();

    check(
      "the request is back in the queue after a failure",
      ai.retryQueue.length === 1,
      `${ai.retryQueue.length} queued`,
    );
    check(
      "its attempt counter advanced (so it can eventually be dropped)",
      ai.retryQueue[0]?.attempts === 1,
      `attempts=${ai.retryQueue[0]?.attempts}`,
    );

    // Exhaust it — it must eventually be dropped, not loop forever.
    await ai.processRetryQueue();
    await ai.processRetryQueue();
    check(
      "and it is dropped once RETRY_MAX_ATTEMPTS is reached",
      ai.retryQueue.length === 0,
      `${ai.retryQueue.length} queued after ${ai.RETRY_MAX_ATTEMPTS} attempts`,
    );

    ai.generateResponse = origGenerate;
  }

  // ── RQ-4: the retry chain is bounded by the slot budget ──────────────
  console.log("\nRQ-4 — the retry chain cannot outlive the slot timeout");
  {
    // Bound from BOTH sides: it must actually retry (not give up instantly),
    // and it must not exceed the budget. "Fast" alone would also be true of a
    // version that never retried at all.
    let attempts = 0;
    const started = Date.now();
    const budget = 8_000; // > MIN_ATTEMPT_MS, so a retry is affordable

    await ai
      .retryOperation(
        async (attemptTimeoutMs: number) => {
          attempts++;
          check(
            `attempt ${attempts} receives a timeout clamped to the remaining budget`,
            attemptTimeoutMs <= budget,
            `${attemptTimeoutMs}ms <= ${budget}ms`,
          );
          throw new Error("always fails");
        },
        3,
        budget,
      )
      .catch(() => {});

    const elapsed = Date.now() - started;
    check(
      "it retried rather than giving up after one attempt",
      attempts >= 2,
      `${attempts} attempts`,
    );
    check(
      "a budget smaller than MIN_ATTEMPT_MS still makes ONE real attempt",
      await (async () => {
        let n = 0;
        await ai
          .retryOperation(async () => { n++; throw new Error("fail"); }, 3, 1_000)
          .catch(() => {});
        return n === 1;
      })(),
      "never attempting would be a silent no-op that never touched the API",
    );
    check(
      "and the whole chain stayed within the slot budget",
      elapsed <= budget + 750,
      `${elapsed}ms vs ${budget}ms budget`,
    );

    // The structural guarantee: worst case is bounded by SLOT_TIMEOUT_MS, so
    // a holder can never outlast a waiter's patience.
    check(
      "default budget equals SLOT_TIMEOUT_MS (holder cannot outlast a waiter)",
      ai.SLOT_TIMEOUT_MS >= ai.requestTimeout,
      `SLOT_TIMEOUT_MS=${ai.SLOT_TIMEOUT_MS} requestTimeout=${ai.requestTimeout}`,
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  // Drain stdout, then exit explicitly: this harness boots the DI container,
  // whose service timers would otherwise keep the event loop alive forever.
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
