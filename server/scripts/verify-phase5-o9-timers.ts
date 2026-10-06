/**
 * Phase 5 O9 — every recurring timer is stopped on shutdown.
 *
 * What the harm actually is, having read `lifecycle.ts` rather than assuming:
 * `gracefulShutdown` ends with an explicit `process.exit()`, so an unstopped
 * interval does NOT hang exit — the plan's framing. The real cost is that it
 * keeps firing while the server tears down, and `db.disconnect()` sits near the
 * end of that sequence. A tick landing after it rejects, and an unhandled
 * rejection re-enters the shutdown handler that is already running.
 *
 * This is a STRUCTURAL check, and deliberately so. Driving a real SIGTERM is
 * not available in this environment, and asserting "the process exited" would
 * prove nothing anyway: it exits explicitly either way. What can be checked,
 * and is what actually regresses, is that every service owning a recurring
 * timer either unrefs it or is stopped by name in the shutdown sequence — and
 * that the method `lifecycle` calls actually exists on the class.
 *
 * Run: npx tsx scripts/verify-phase5-o9-timers.ts
 */
import "reflect-metadata";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const SRC = new URL("../src", import.meta.url).pathname;
const lifecycle = readFileSync(join(SRC, "lifecycle.ts"), "utf8");

/** Every .ts under src/. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

async function main() {
  console.log("\n=== Phase 5 O9 — timer shutdown ===\n");

  const files = walk(SRC);

  // ── Inventory every recurring timer ───────────────────────────────────
  const owners = files.filter((f) => /setInterval\(/.test(readFileSync(f, "utf8")));
  check(
    "PRECONDITION: recurring timers were found to audit",
    owners.length > 0,
    `${owners.length} files own a setInterval`,
  );

  // ── Each must be unref'd or named in the shutdown sequence ────────────
  console.log("\nevery timer owner is unref'd or stopped on shutdown");
  {
    const unaccounted: string[] = [];
    for (const f of owners) {
      const src = readFileSync(f, "utf8");
      const base = f.split("/").pop()!.replace(".ts", "");

      // `unref()` means the timer cannot hold the loop and is harmless at exit.
      const unrefs = /\.unref\??\.?\(\)/.test(src);

      // Or it is handed to the shutdown-timer registry, which `lifecycle`
      // clears wholesale — the route for intervals with no owning service.
      const registered = /registerShutdownTimer\(/.test(src);

      // Otherwise the class must be reachable from the shutdown sequence. The
      // sequence names services by DI token, so match on the PascalCase class
      // name appearing in a token value, or the file being referenced directly.
      const cls = base.charAt(0).toUpperCase() + base.slice(1);
      const stopped =
        lifecycle.includes(cls) ||
        lifecycle.includes(base) ||
        // Token constants are SCREAMING_SNAKE of the class name.
        lifecycle.includes(
          base.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase(),
        );

      if (!unrefs && !registered && !stopped) unaccounted.push(base);
    }

    check(
      "no timer owner is both un-unref'd AND absent from shutdown",
      unaccounted.length === 0,
      unaccounted.length
        ? `unaccounted: ${unaccounted.join(", ")}`
        : `all ${owners.length} accounted for`,
    );
  }

  // ── The methods shutdown calls must exist ─────────────────────────────
  console.log("\nshutdown calls methods that actually exist");
  {
    // Parse the O9 table out of lifecycle rather than restating it here — a
    // hardcoded copy would drift from the thing it is checking.
    const rows = [...lifecycle.matchAll(/\["([A-Z_]+)",\s*"[^"]+",\s*"(\w+)"\]/g)]
      .map((m) => ({ token: m[1]!, method: m[2]! }));
    check(
      "PRECONDITION: the shutdown table was parsed",
      rows.length >= 6,
      `${rows.length} entries`,
    );

    const tokens = readFileSync(join(SRC, "di/tokens.ts"), "utf8");
    const missing: string[] = [];
    for (const { token, method } of rows) {
      const tm = tokens.match(new RegExp(`export const ${token}\\s*=\\s*"([^"]+)"`));
      if (!tm) { missing.push(`${token} (no such token)`); continue; }
      const cls = tm[1]!;
      // Find the class file and confirm the method is declared on it.
      const file = files.find((f) =>
        new RegExp(`class ${cls}\\b`).test(readFileSync(f, "utf8")),
      );
      if (!file) { missing.push(`${cls} (no class file)`); continue; }
      const src = readFileSync(file, "utf8");
      if (!new RegExp(`\\b(public\\s+)?(async\\s+)?${method}\\s*\\(`).test(src)) {
        missing.push(`${cls}.${method}()`);
      }
    }
    check(
      "every (token, method) pair in the shutdown table resolves",
      missing.length === 0,
      missing.length ? `missing: ${missing.join(", ")}` : `${rows.length} pairs resolve`,
    );
  }

  // ── The specific services the plan named ──────────────────────────────
  console.log("\nthe four services O9 named are covered");
  {
    for (const [label, needle] of [
      ["TraceService", "TRACE_SERVICE"],
      ["CommandProcessor", "COMMAND_PROCESSOR"],
      ["Epoch scheduler (Architect driver)", "EPOCH_SCHEDULER_SERVICE"],
    ] as const) {
      check(`${label} is stopped on shutdown`, lifecycle.includes(needle), needle);
    }

    // The plan's "Architect" and "dungeon expiry" timers are NOT in the
    // services their names suggest — both are inline `setInterval`s in
    // index.ts that captured no handle, so they could not be stopped even in
    // principle. That is why the shutdown-timer registry exists.
    const index = readFileSync(join(SRC, "index.ts"), "utf8");
    const wrapped = [...index.matchAll(/registerShutdownTimer\(setInterval\(/g)].length;
    const total = [...index.matchAll(/setInterval\(/g)].length;
    // ASSERT THE INVARIANT, NOT A COUNT. This used to require exactly 2 and
    // broke the moment a third sweep was added (notification retention) — a
    // correct change failing a check that had hard-coded the world as it was.
    // What matters is that EVERY inline timer is registered, which stays true
    // however many there are.
    check(
      "every inline setInterval in index.ts is shutdown-registered",
      total > 0 && wrapped === total,
      `${wrapped}/${total} registered — an unregistered one holds no handle and ` +
      "cannot be stopped even in principle, while its callback touches the database " +
      "that gracefulShutdown disconnects",
    );
    check(
      "and shutdown clears the registry",
      lifecycle.includes("clearShutdownTimers"),
      "lifecycle calls clearShutdownTimers()",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
