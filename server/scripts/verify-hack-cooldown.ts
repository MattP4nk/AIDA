/**
 * Hacking skill now reduces the hack cooldown.
 *
 * `getHackCooldown(skill)` sat in gameBalance with ZERO callers while
 * `hackService.COOLDOWN_SECONDS` ran a flat 30s for everyone — and the comment
 * on that field said "use getHackCooldown(skill) for skill-scaled value", an
 * instruction to a future reader that nobody followed. Investing in hacking
 * bought nothing here.
 *
 * Its sibling `getTraceDuration` was deliberately NOT wired: it is inverted
 * relative to the live trace semantics (see the note on the function).
 *
 * Run: npx tsx scripts/verify-hack-cooldown.ts
 */
import "reflect-metadata";
import {
  getHackCooldown,
  HACK_COOLDOWN_BASE_S,
  HACK_COOLDOWN_MIN_S,
} from "../src/config/gameBalance";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("\n=== Hack cooldown scales with skill ===");

  check("skill 0 pays the base cooldown", getHackCooldown(0) === HACK_COOLDOWN_BASE_S, `${getHackCooldown(0)}s`);
  check("skill reduces it", getHackCooldown(50) < getHackCooldown(0), `${getHackCooldown(50)}s < ${getHackCooldown(0)}s`);
  check("monotonically", getHackCooldown(100) < getHackCooldown(50));
  check(
    "and it never drops below the floor",
    getHackCooldown(100000) === HACK_COOLDOWN_MIN_S,
    `${getHackCooldown(100000)}s — an unbounded reduction would mean no cooldown at all`,
  );

  const hs = strip(["hackService", "hackCountermeasureService", "hackScoring", "hackSessionStore"].map((f) => readFileSync(new URL(`../src/services/${f}.ts`, import.meta.url).pathname, "utf8")).join("\n"));
  check("applyCooldown consults it", /getHackCooldown\(progress\?\.hacking \?\? 0\)/.test(hs));
  check(
    "an explicit duration still overrides (hackCommands passes 15)",
    /durationSeconds !== undefined/.test(hs),
    "the short post-minigame cooldown must not become skill-scaled",
  );
  check(
    "all internal callers await it",
    (hs.match(/await this\.applyCooldown\(/g) || []).length === 2,
    "it became async; a missed await would set the cooldown after the check that reads it",
  );

  const gb = strip(readFileSync(new URL("../src/config/gameBalance.ts", import.meta.url).pathname, "utf8"));
  check(
    "getTraceDuration remains unwired",
    !/getTraceDuration\(/.test(strip(readFileSync(new URL("../src/services/traceService.ts", import.meta.url).pathname, "utf8"))),
    "it is inverted: it would make stealth get you caught SOONER",
  );
  check("and gameBalance still exports it for a future sign fix", /export function getTraceDuration/.test(gb));

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
