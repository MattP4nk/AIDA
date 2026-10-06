/**
 * Phase 6 R14c — an AI outage is visible.
 *
 * This is the phase GATE: "AI outage is visible in logs and on the health
 * endpoint". Before this, all three legs failed:
 *
 *   - `safeAI` hardcoded `silent: true` and `SafeAIConfig` had no `silent`
 *     field, so no caller could opt out. Every AI failure logged at `debug`
 *     and lost its error code; at default log level, nothing.
 *   - A served fallback was unmarked and uncounted. `aiFallbacks` returns
 *     plain strings, so a total outage looked from outside exactly like a
 *     working game with duller prose.
 *   - `getMetrics()` / `checkHealth()` existed on AIService with zero callers
 *     outside a manual script, and `/health` reported the database only.
 *
 * Run: npx tsx scripts/verify-phase6-r14c-observability.ts
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
const read = (rel: string) =>
  strip(readFileSync(new URL(rel, import.meta.url).pathname, "utf8"));

async function main() {
  console.log("\n=== Phase 6 R14c — AI outage observability ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const ai = getService<any>(TOKENS.AI_SERVICE);
  const { safeAI } = await import("../src/utils/safeExecute");

  // ── A served fallback is counted and logged ──────────────────────────
  console.log("\nR14c-1 — a served fallback is counted and warned");
  {
    const before = ai.getMetrics().fallbacksServed;
    const warnings: string[] = [];
    const logger: any = {
      error: () => {},
      debug: () => {},
      warn: (_o: any, msg: string) => warnings.push(msg),
    };

    // Simulate a total outage: generateOrThrow always throws.
    const deadAI: any = {
      generateOrThrow: async () => { throw new Error("connect ECONNREFUSED"); },
      noteFallbackServed: (ctx: string) => ai.noteFallbackServed(ctx),
    };

    const result = await safeAI({
      aiService: deadAI,
      prompt: "anything",
      validate: (p: any) => p,
      fallback: { canned: true },
      context: "r14c probe",
      logger,
    });

    check("the caller still gets its fallback (game keeps working)",
      JSON.stringify(result) === JSON.stringify({ canned: true }), JSON.stringify(result));
    check(
      "the fallback counter advanced",
      ai.getMetrics().fallbacksServed === before + 1,
      `${before} -> ${ai.getMetrics().fallbacksServed}`,
    );
    check(
      "a WARN was emitted naming the degradation",
      warnings.some((m) => /fallback/i.test(m)),
      warnings.join(" | ") || "no warn emitted",
    );
    check(
      "and the context is recorded for the health endpoint",
      ai.getMetrics().lastFallback?.context === "r14c probe",
      JSON.stringify(ai.getMetrics().lastFallback),
    );
  }

  // ── A SUCCESS must not look like a fallback ──────────────────────────
  console.log("\nR14c-2 — a successful call does NOT count as degraded");
  {
    const before = ai.getMetrics().fallbacksServed;
    const liveAI: any = {
      generateOrThrow: async () => ({ response: '{"ok":true}' }),
      noteFallbackServed: (ctx: string) => ai.noteFallbackServed(ctx),
    };
    const result = await safeAI({
      aiService: liveAI,
      prompt: "anything",
      validate: (p: any) => (p && p.ok ? p : null),
      fallback: { canned: true },
      context: "r14c success probe",
      logger: { error: () => {}, debug: () => {}, warn: () => {} } as any,
    });
    check("the real result is returned", JSON.stringify(result) === '{"ok":true}', JSON.stringify(result));
    check(
      "the counter did NOT advance",
      ai.getMetrics().fallbacksServed === before,
      `${before} -> ${ai.getMetrics().fallbacksServed} — a counter that always rises measures nothing`,
    );
  }

  // ── silent is configurable ───────────────────────────────────────────
  console.log("\nR14c-3 — per-attempt silence is configurable, not hardcoded");
  {
    const src = read("../src/utils/safeExecute.ts");
    check("SafeAIConfig exposes `silent`", /silent\?: boolean;/.test(src));
    check(
      "safeAI honours the caller's choice",
      /silent: config\.silent \?\? true/.test(src),
      "was `silent: true` hardcoded — no caller could change it",
    );
    check(
      "the fallback signal is NOT gated on `silent`",
      /if \(result === resolvedFallback\)[\s\S]{0,300}?noteFallbackServed/.test(src),
      "the health endpoint must not depend on log settings",
    );
  }

  // ── The health endpoint ──────────────────────────────────────────────
  console.log("\nR14c-4 — /health reports AI, not just the database");
  {
    const src = read("../src/routes/admin.ts");
    check("it calls checkHealth()", /aiService\.checkHealth\(\)/.test(src),
      "previously getMetrics/checkHealth had zero callers outside a script");
    check("it includes the metrics", /aiService\.getMetrics\(\)/.test(src));
    check("the response carries an `ai` block", /\bai,\s*\}\);/.test(src));
    check(
      "an AI outage reports 'degraded' rather than flipping the status to unhealthy",
      /ai\.status === "connected" \? "healthy" : "degraded"/.test(src),
      "the game is playable without AI — that is what fallbacks are for",
    );
    check(
      "only the database decides 200 vs 503",
      /res\.status\(dbHealth \? 200 : 503\)/.test(src),
      "an AI outage must not make an orchestrator kill a serving process",
    );

    const metrics = ai.getMetrics();
    for (const key of ["fallbacksServed", "lastFallback", "queueDepth", "activeRequests", "failedRequests"]) {
      check(`getMetrics() exposes ${key}`, key in metrics, JSON.stringify(metrics[key]));
    }
  }

  // ── The endpoint, actually served over HTTP ──────────────────────────
  console.log("\nR14c-5 — the endpoint really serves the AI block");
  {
    // Structural checks above prove the code exists; this proves it RESPONDS.
    // The route is mounted unconditionally (middleware/setup.ts `app.use(adminRoutes)`
    // — only the static admin PANEL is dev-gated), so it is reachable in production.
    const express = (await import("express")).default;
    const app = express();
    app.use((await import("../src/routes/admin")).default);

    const server = app.listen(0);
    try {
      const port = (server.address() as any).port;
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      const body: any = await res.json();

      check("GET /health responds", res.status === 200 || res.status === 503, `HTTP ${res.status}`);
      check("the body carries an `ai` object", !!body.ai && typeof body.ai === "object",
        JSON.stringify(body.ai)?.slice(0, 120));
      check(
        "it reports an AI status an operator can act on",
        ["connected", "unreachable", "unavailable", "unknown"].includes(body.ai?.status),
        `status=${body.ai?.status}`,
      );
      check(
        "and it surfaces the fallback counter",
        typeof body.ai?.fallbacksServed === "number",
        `fallbacksServed=${body.ai?.fallbacksServed}`,
      );
      check(
        "overall status reflects AI degradation",
        body.ai?.status === "connected" ? body.status === "healthy" : body.status === "degraded",
        `status=${body.status} ai=${body.ai?.status}`,
      );
    } finally {
      server.close();
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
