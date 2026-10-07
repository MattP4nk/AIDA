/**
 * Phase 7 S7 — unreviewed content always ends up in front of a human.
 *
 * `moderationGate` fails OPEN on `unavailable`: the content is published and a
 * re-check is queued. That re-check rides the shared AI retry queue — seven
 * callers, 20 slots — and every way out of it except success used to be a
 * permanent, silent fail-open: overflow evicted the oldest entry regardless of
 * kind, the 10-minute age purge had no log or counter, an illegible answer just
 * returned, a restart dropped the in-memory queue, and a correct UNSAFE verdict
 * whose hide threw was swallowed by a bare `catch {}`.
 *
 * Maintainer decision (2026-10-07): an abandoned re-check goes to the ADMIN
 * REVIEW QUEUE. It is filed as a SYSTEM report into the queues admins already
 * read — `admin reports mail` (MessageReport) and `forum reports`
 * (PostReport) — so no new UI is needed and nothing new must be remembered.
 *
 * Behavioural throughout: the real queue, the real gate, and a DB round-trip
 * read back through the same service methods the admin commands call.
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
const tick = () => new Promise((r) => setImmediate(r));

async function main() {
  console.log("\n=== Phase 7 S7 — abandoned moderation re-checks reach admin review ===");

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
  const reset = () => { ai.retryQueue = []; ai.inFlightRetry = null; };
  const MAX: number = ai.RETRY_QUEUE_MAX;
  const spy = () => {
    const calls: string[] = [];
    return { calls, fn: async (reason: string) => { calls.push(reason); } };
  };

  // ── 1. A critical entry is not evicted by ordinary queue pressure ────
  console.log("\nS7-1 — overflow drops ordinary work, not the moderation re-check");
  {
    reset();
    const esc = spy();
    // The critical entry goes in FIRST, so plain FIFO would evict it first.
    ai.queueForRetry("moderate me", "sys", () => {}, undefined, esc.fn);
    for (let i = 0; i < MAX * 2; i++) ai.queueForRetry(`filler ${i}`, "sys", () => {});
    await tick();

    const criticals = q().filter((r) => r.critical);
    check("the critical entry survived 2x queue capacity of ordinary work", criticals.length === 1,
      `${criticals.length} critical of ${q().length} queued (max ${MAX})`);
    check("the queue still respects its cap", q().length <= MAX, `${q().length} <= ${MAX}`);
    // POSITIVE CONTROL: filler was genuinely evicted, so the check above is
    // not passing merely because nothing overflowed.
    check("ordinary entries were in fact evicted", ai.getMetrics().retryQueueDropped > 0 && q().length === MAX);
    check("nothing was escalated — the critical entry was never dropped", esc.calls.length === 0);
  }

  // ── 2. Every queue-side drop path escalates ──────────────────────────
  console.log("\nS7-2 — the age purge escalates and counts");
  {
    reset();
    const esc = spy();
    const before = ai.getMetrics().moderationRechecksAbandoned;
    ai.queueForRetry("too old", "sys", () => {}, undefined, esc.fn);
    q()[0].createdAt = Date.now() - (ai.RETRY_MAX_AGE_MS + 1000);
    await ai.processRetryQueue();
    await tick();

    check("counted", ai.getMetrics().moderationRechecksAbandoned === before + 1);
    check("escalated with the reason", esc.calls.length === 1 && esc.calls[0] === "exceeded max age",
      JSON.stringify(esc.calls));
    check("and removed from the queue", q().length === 0);
  }

  console.log("\nS7-3 — ordinary work is neither counted nor escalated");
  {
    reset();
    const before = ai.getMetrics().moderationRechecksAbandoned;
    ai.queueForRetry("ordinary", "sys", () => {});
    q()[0].createdAt = Date.now() - (ai.RETRY_MAX_AGE_MS + 1000);
    await ai.processRetryQueue();
    check("the moderation counter did not move", ai.getMetrics().moderationRechecksAbandoned === before);
  }

  // ── 3. Callback-side give-ups escalate ───────────────────────────────
  console.log("\nS7-4 — an illegible re-check answer escalates");
  {
    reset();
    const esc = spy();
    ai.queueModerationRecheck("some content", () => {}, esc.fn);
    await new Promise((r) => setTimeout(r, 50)); // deferred through a dynamic import
    check("queued as critical", q().length === 1 && q()[0].critical === true);
    await q()[0].onSuccess('{"safe": "maybe"}');
    check("escalated as illegible", esc.calls.some((c) => c.includes("illegible")), JSON.stringify(esc.calls));
  }

  console.log("\nS7-5 — UNSAFE verdict whose hide throws: logged loudly AND escalated");
  {
    const errors: string[] = [];
    const realLogger = ai.logger;
    ai.logger = {
      ...realLogger, info: () => {}, debug: () => {}, warn: () => {},
      error: (_o: any, msg?: string) => errors.push(typeof _o === "string" ? _o : (msg ?? "")),
    };
    reset();
    const esc = spy();
    ai.queueModerationRecheck("some content", () => { throw new Error("hide action blew up"); }, esc.fn);
    await new Promise((r) => setTimeout(r, 50));
    await q()[0].onSuccess('{"safe": false, "reason": "hate speech"}');
    ai.logger = realLogger;

    check("reported at error level", errors.some((m) => m.includes("hide/notify action FAILED")));
    check("escalated, naming the verdict", esc.calls.some((c) => c.includes("judged unsafe (hate speech)")),
      JSON.stringify(esc.calls));
  }

  // ── 4. Graceful shutdown escalates what has not run ──────────────────
  console.log("\nS7-6 — shutdown escalates queued AND in-flight re-checks, keeps ordinary work");
  {
    reset();
    const esc = spy();
    ai.queueForRetry("pending A", "sys", () => {}, undefined, esc.fn);
    ai.queueForRetry("ordinary", "sys", () => {});
    ai.queueForRetry("pending B", "sys", () => {}, undefined, esc.fn);
    // Simulate one taken out of the queue mid-attempt.
    ai.inFlightRetry = { id: "inflight", prompt: "x", onSuccess: () => {}, attempts: 1,
      createdAt: Date.now(), critical: true, onAbandoned: esc.fn };

    const n = await ai.escalatePendingModeration();
    check("three re-checks escalated (two queued + one in flight)", n === 3 && esc.calls.length === 3,
      `n=${n}, calls=${esc.calls.length}`);
    check("each names the shutdown", esc.calls.every((c) => c.includes("shut down")));
    check("ordinary work is left alone", q().length === 1 && !q()[0].critical);
  }

  // ── 5. An escalation that itself fails is still counted ──────────────
  console.log("\nS7-7 — a failed escalation is counted, not swallowed");
  {
    reset();
    const realLogger = ai.logger;
    ai.logger = { ...realLogger, error: () => {}, warn: () => {} };
    const before = ai.getMetrics().moderationEscalationsFailed;
    ai.queueForRetry("x", "sys", () => {}, undefined, async () => { throw new Error("db down"); });
    q()[0].createdAt = Date.now() - (ai.RETRY_MAX_AGE_MS + 1000);
    await ai.processRetryQueue();
    await tick();
    ai.logger = realLogger;
    check("moderationEscalationsFailed incremented",
      ai.getMetrics().moderationEscalationsFailed === before + 1,
      `${before} -> ${ai.getMetrics().moderationEscalationsFailed}`);
  }

  // ── 6. The gate wires escalation into every path ─────────────────────
  console.log("\nS7-8 — the gate: abandoned re-check and failed hide both escalate");
  {
    const { moderateBeforePublish } = await import("../src/utils/moderationGate");
    const quiet: any = { warn: () => {}, error: () => {}, info: () => {}, debug: () => {} };
    const realModerate = ai.moderateForDelivery;
    const realQueue = ai.queueModerationRecheck;
    try {
      // unavailable -> the gate hands the queue an escalation path
      let captured: ((r: string) => Promise<void>) | undefined;
      ai.moderateForDelivery = async () => ({ verdict: "unavailable", reason: "timeout" });
      ai.queueModerationRecheck = (_c: string, _v: unknown, onAbandoned: any) => { captured = onAbandoned; };
      const esc1 = spy();
      const r1 = await moderateBeforePublish("hello", quiet, async () => {}, esc1.fn);
      check("unavailable still publishes", r1.verdict === "unavailable");
      check("the gate passed the queue an escalation path", typeof captured === "function");
      await captured?.("queue full");
      check("which files for review, naming why", esc1.calls.length === 1 &&
        esc1.calls[0]!.includes("queue full") && esc1.calls[0]!.includes("published without review"),
        JSON.stringify(esc1.calls));

      // unsafe + failing hide -> escalate
      ai.moderateForDelivery = async () => ({ verdict: "unsafe", reason: "spam" });
      const esc2 = spy();
      const r2 = await moderateBeforePublish("buy now", quiet, async () => { throw new Error("P2025"); }, esc2.fn);
      check("unsafe still suppresses delivery", r2.verdict === "unsafe");
      check("a failed hide is filed for review", esc2.calls.some((c) => c.includes("hiding it failed")),
        JSON.stringify(esc2.calls));

      // POSITIVE CONTROL: safe content is never filed.
      ai.moderateForDelivery = async () => ({ verdict: "safe" });
      const esc3 = spy();
      await moderateBeforePublish("hi", quiet, async () => {}, esc3.fn);
      check("safe content is not escalated", esc3.calls.length === 0);
    } finally {
      ai.moderateForDelivery = realModerate;
      ai.queueModerationRecheck = realQueue;
    }
  }

  // ── 7. Round trip: the report is visible where admins actually look ──
  console.log("\nS7-9 — filed reports appear in the real admin queues, from SYSTEM");
  {
    const messages = getService<any>(TOKENS.MESSAGE_SERVICE);
    const forums = getService<any>(TOKENS.FORUM_SERVICE);
    const tag = `s7esc${Date.now()}`;
    const ids: { users: string[]; message?: string; forum?: string; post?: string } = { users: [] };
    try {
      const mkUser = (n: string, role = "player") => prisma.user.create({
        data: { username: `${tag}_${n}`, email: `${tag}_${n}@fixture.invalid`, password: "x", homeIp: `${tag}-${n}`, role },
      });
      const [a, b, mod] = await Promise.all([mkUser("a"), mkUser("b"), mkUser("mod", "moderator")]);
      ids.users.push(a.id, b.id, mod.id);
      const msg = await prisma.message.create({ data: { senderId: a.id, recipientId: b.id, subject: "fixture", content: "fixture" } });
      ids.message = msg.id;
      const forum = await prisma.forum.create({
        data: { name: tag, url: `${tag}.onion`, description: "fixture", category: "tech", securityLevel: 1 },
      });
      ids.forum = forum.id;
      const post = await prisma.post.create({
        data: { forumId: forum.id, authorId: a.id, authorHandle: "fx", title: "fixture", content: "fixture" },
      });
      ids.post = post.id;

      await messages.fileModerationEscalation(msg.id, "test escalation");
      const mailQueue = await messages.getMessageReports("pending");
      const mine = mailQueue.reports.find((r: any) => r.messageId === msg.id);
      check("message report is in `admin reports mail`", !!mine);
      check("filed by SYSTEM", mine?.reporter?.username === "SYSTEM", mine?.reporter?.username);
      check("reason is marked automated", mine?.reason === "[auto-moderation] test escalation", mine?.reason);

      await forums.fileModerationEscalation({ forumId: forum.id, postId: post.id }, "test escalation");
      const sys = await forums.getSystemReports(mod.id);
      const mineP = sys.reports.find((r: any) => r.postId === post.id);
      check("post report is in system-wide `forum reports`", !!mineP);
      check("filed by SYSTEM", mineP?.reporter?.username === "SYSTEM", mineP?.reporter?.username);
    } finally {
      // Delete by id only. Reports cascade with their message/post.
      const cleanup: Array<[string, () => Promise<unknown>]> = [
        ["post", () => (ids.post ? prisma.post.delete({ where: { id: ids.post } }) : Promise.resolve())],
        ["forum", () => (ids.forum ? prisma.forum.delete({ where: { id: ids.forum } }) : Promise.resolve())],
        ["message", () => (ids.message ? prisma.message.delete({ where: { id: ids.message } }) : Promise.resolve())],
        ["users", () => prisma.user.deleteMany({ where: { id: { in: ids.users } } })],
      ];
      for (const [what, run] of cleanup) {
        try { await run(); } catch (err) { fail++; console.log(`  [FAIL] cleanup of ${what} — ${(err as Error).message}`); }
      }
    }
  }

  // ── 8. Shutdown wiring ───────────────────────────────────────────────
  // STRUCTURAL, by necessity: a harness cannot run a real graceful shutdown.
  // S7-6 proves escalatePendingModeration works; this proves lifecycle calls
  // it, and — the property that matters — while the database is still up.
  console.log("\nS7-10 — lifecycle escalates pending re-checks BEFORE the DB disconnects");
  {
    const { readFileSync } = await import("node:fs");
    const life = readFileSync(new URL("../src/lifecycle.ts", import.meta.url).pathname, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const call = life.indexOf("await aiService.escalatePendingModeration()");
    const disconnect = life.indexOf("await db.disconnect()");
    check("PRECONDITION: the disconnect was found", disconnect > 0);
    check("shutdown awaits the escalation", call > 0);
    check("and does so before db.disconnect()", call > 0 && call < disconnect, `call@${call} disconnect@${disconnect}`);
  }

  reset();
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  // setupContainer leaves timers open; flush, then exit, or run-verify's
  // timeout kills this and scores it a failure.
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
