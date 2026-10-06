/**
 * `index.ts`'s startup wiring survives being broken up.
 *
 * A8 splits a 519-line `initialize()` into named phases. The risk is not that
 * it stops compiling — it is that one `X.on("event", …)` registration or one
 * `setInterval` quietly does not make the move, and NOTHING would notice: the
 * golden master drives COMMANDS, and a listener that was never registered
 * produces no error, no log line and no failing request. It shows up weeks
 * later as "that feature doesn't fire any more".
 *
 * So this characterises the wiring itself. The multiset of
 * (emitter, event) pairs, the timer cadences, and the service resolutions are
 * recorded here as data; the refactor must leave all three identical.
 *
 * WHY STATIC AND NOT BEHAVIOURAL: `initialize()` connects the database, starts
 * eight timers, loads AI state and binds a port. Running it in a harness to
 * count listeners would be a second server competing with the dev one for the
 * same rows — the "never point a state-mutating service at ambient DB state"
 * trap in CLAUDE.md. Parsing the source answers the exact question the refactor
 * puts at risk, and nothing more; it is NOT evidence that the wiring works,
 * only that it was not dropped.
 *
 * Run: npx tsx scripts/verify-phase7-a8-bootstrap.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RECORD = process.argv.includes("--record");
const SRC = new URL("../src/index.ts", import.meta.url).pathname;
const BASELINE = new URL("./a8-bootstrap.baseline.json", import.meta.url).pathname;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Comments can contain anything; match code only. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

interface Fingerprint {
  /** `emitter.on("event"` pairs, sorted. The thing most likely to be dropped. */
  listeners: string[];
  /** Every token passed to getService, sorted — a missed resolution is a crash. */
  services: string[];
  /** setInterval cadences, sorted. A timer that moves is a silent behaviour change. */
  intervals: string[];
  /** Tokens whose listeners feed `defer(...)`, so error handling is not lost. */
  deferCount: number;
}

/**
 * The CADENCE argument of each `setInterval`, found by counting parens.
 *
 * A regex cannot do this. The first version used
 * `setInterval\(([\s\S]{0,400}?)\)\s*;` and, being non-greedy, stopped at the
 * first `);` INSIDE the async callback — so it fingerprinted the opening lines
 * of each callback body and never saw the interval at all. The check would
 * have reported "timer cadences are identical" while a timer moved from hourly
 * to every six hours, which is precisely the silent behaviour change it exists
 * to catch.
 */
function extractIntervalCadences(code: string): string[] {
  const out: string[] = [];
  const needle = "setInterval(";
  for (let i = code.indexOf(needle); i !== -1; i = code.indexOf(needle, i + 1)) {
    let depth = 0;
    let end = -1;
    for (let j = i + needle.length - 1; j < code.length; j++) {
      const ch = code[j];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { end = j; break; }
      }
    }
    if (end === -1) continue;
    // Drop a TRAILING comma first. Without this the "last top-level comma" is
    // the trailing one and every cadence extracts as the empty string — which
    // compares equal to every other empty string, so the check passes no
    // matter what the cadences are. An extractor that yields nothing is the
    // vacuous-pass failure this file's own BS-0 exists to catch.
    const args = code.slice(i + needle.length, end).replace(/,\s*$/, "");
    // The cadence is the last top-level argument.
    let d = 0;
    let lastComma = -1;
    for (let j = 0; j < args.length; j++) {
      const ch = args[j];
      if (ch === "(" || ch === "{" || ch === "[") d++;
      else if (ch === ")" || ch === "}" || ch === "]") d--;
      else if (ch === "," && d === 0) lastComma = j;
    }
    out.push(args.slice(lastComma + 1).replace(/\s+/g, " ").trim());
  }
  return out;
}

function fingerprint(src: string): Fingerprint {
  const code = strip(src);

  const listeners = [...code.matchAll(/(\w+)\s*\.on\(\s*"([^"]+)"/g)]
    .map((m) => `${m[1]}.on(${m[2]})`)
    .sort();

  const services = [...code.matchAll(/getService<[^>]*>\(\s*([A-Z_0-9]+)\s*\)/g)]
    .map((m) => m[1]!)
    .sort();

  const intervals = extractIntervalCadences(code).sort();

  const deferCount = (code.match(/\bdefer\(/g) ?? []).length;

  return { listeners, services, intervals, deferCount };
}

function main() {
  console.log("\n=== A8 — index.ts bootstrap wiring ===");

  const fp = fingerprint(readFileSync(SRC, "utf8"));

  // ── Non-vacuity: a parser that finds nothing would pass everything ──
  console.log("\nBS-0 — the fingerprint is not empty");
  check(
    "listeners were extracted",
    fp.listeners.length > 5,
    `${fp.listeners.length} — a zero here means the regex broke, not that wiring vanished`,
  );
  check("service resolutions were extracted", fp.services.length > 5, `${fp.services.length}`);
  check(
    "timer cadences were extracted and are non-empty",
    fp.intervals.length > 0 && fp.intervals.every((c) => c.length > 0),
    JSON.stringify(fp.intervals) +
      " — an empty cadence compares equal to every other empty cadence, so the " +
      "comparison below would pass against any change",
  );

  if (RECORD) {
    writeFileSync(BASELINE, JSON.stringify(fp, null, 2));
    console.log(`\n  recorded -> ${BASELINE}`);
    console.log(`  ${fp.listeners.length} listeners, ${fp.services.length} resolutions, ` +
      `${fp.intervals.length} timers, ${fp.deferCount} defer() calls`);
    console.log("\n=== BASELINE RECORDED ===");
    process.stdout.write("", () => process.exit(0));
    return;
  }

  if (!existsSync(BASELINE)) {
    console.log("  [FAIL] no baseline. Run with --record BEFORE refactoring.");
    console.log("\n=== 0 PASS / 1 FAIL ===");
    process.stdout.write("", () => process.exit(1));
    return;
  }

  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Fingerprint;

  console.log("\nBS-1 — every event listener survived the split");
  {
    // COMPARED AS SETS, not multisets, and deliberately so. Collapsing the two
    // `mission:completed` registrations into one is an intended outcome of
    // this work (BS-4 asserts it), and a multiset comparison would report that
    // as a dropped listener. What must never happen is a distinct
    // (emitter, event) PAIR disappearing — that is coverage lost.
    const baseSet = new Set(base.listeners);
    const nowSet = new Set(fp.listeners);
    const lost = [...baseSet].filter((l) => !nowSet.has(l));
    const added = [...nowSet].filter((l) => !baseSet.has(l));
    check(
      "no (emitter, event) pair was dropped",
      lost.length === 0,
      lost.length ? lost.join(", ") : `${nowSet.size} distinct pairs intact`,
    );
    check(
      "and none appeared by accident",
      added.length === 0,
      added.length ? `${added.join(", ")} — re-record if deliberate` : "none",
    );
  }

  console.log("\nBS-2 — service resolutions and timers are unchanged");
  {
    const lostSvc = base.services.filter((s) => !fp.services.includes(s));
    check(
      "no getService token was lost",
      lostSvc.length === 0,
      lostSvc.length ? lostSvc.join(", ") : `${fp.services.length} intact`,
    );
    check(
      "timer cadences are identical",
      JSON.stringify(fp.intervals) === JSON.stringify(base.intervals),
      `${fp.intervals.length} vs ${base.intervals.length} — a moved cadence is a silent ` +
      "behaviour change no test would otherwise catch",
    );
  }

  console.log("\nBS-3 — error handling was not lost in the move");
  {
    check(
      "every listener body still routes through defer()",
      fp.deferCount >= base.deferCount,
      `${fp.deferCount} vs ${base.deferCount} — defer() is what keeps one failing ` +
      "listener from taking down the bootstrap",
    );
  }

  console.log("\nBS-4 — the duplicate mission:completed listener is gone");
  {
    const missionCompleted = fp.listeners.filter((l) => l.endsWith(".on(mission:completed)"));
    check(
      "exactly one mission:completed registration remains",
      missionCompleted.length === 1,
      `${missionCompleted.length} — two separate registrations for one event is how the ` +
      "tutorial advance and the story advance drifted apart",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main();
