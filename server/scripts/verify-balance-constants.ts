/**
 * gameBalance constants vs their hardcoded twins.
 *
 * Orphan audit: 15 of the 18 dead constants had a LIVE HARDCODED TWIN, so
 * editing gameBalance silently did nothing — CLAUDE.md bug shape #6. The fix
 * is unification, not deletion: deleting the constant would lose the ability
 * to tune the game.
 *
 * SAFETY PROPERTY: substitution must change no computed value. Every check
 * below asserts the constant still equals the literal it replaced, so a future
 * edit to gameBalance is a deliberate balance change rather than an accident
 * that silently diverges from a comment.
 *
 * Run: npx tsx scripts/verify-balance-constants.ts
 */
import "reflect-metadata";
import {
  BOUNTY_BASE_CREDITS, BOUNTY_CREDITS_PER_EVIDENCE, BOUNTY_BASE_REP,
  BOUNTY_EVIDENCE_THRESHOLD, BOUNTY_EXPIRATION_H,
  DUNGEON_TTL_DAYS, DUNGEON_REGEN_DELAY_MS,
  MISSION_EXPIRATION_INTERVAL_MS, DAILY_MISSIONS_PER_PLAYER,
  ARCHITECT_MIN_EVENTS, FACTION_LOW_RESOURCE_THRESHOLD,
  DETECTION_FLOOR, DETECTION_AGGRESSIVE_BONUS, DETECTION_STEALTH_REDUCTION,
  CRITICAL_EVIDENCE_THRESHOLD,
  AI_ACTIONS_PER_DAY, AI_LEADER_INTERVAL_H, AI_OTHER_INTERVAL_H,
} from "../src/config/gameBalance";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (rel: string) => strip(readFileSync(new URL(rel, import.meta.url).pathname, "utf8"));

async function main() {
  console.log("\n=== gameBalance constants unified with their twins ===");

  console.log("\nBC-1 — values are UNCHANGED (this must be behaviour-preserving)");
  for (const [name, actual, expected] of [
    ["BOUNTY_BASE_CREDITS", BOUNTY_BASE_CREDITS, 1000],
    ["BOUNTY_CREDITS_PER_EVIDENCE", BOUNTY_CREDITS_PER_EVIDENCE, 200],
    ["BOUNTY_BASE_REP", BOUNTY_BASE_REP, 5],
    ["BOUNTY_EVIDENCE_THRESHOLD - 1", BOUNTY_EVIDENCE_THRESHOLD - 1, 80],
    ["BOUNTY_EXPIRATION_H", BOUNTY_EXPIRATION_H, 48],
    ["DUNGEON_TTL_DAYS", DUNGEON_TTL_DAYS, 7],
    ["DUNGEON_REGEN_DELAY_MS", DUNGEON_REGEN_DELAY_MS, 30_000],
    ["MISSION_EXPIRATION_INTERVAL_MS", MISSION_EXPIRATION_INTERVAL_MS, 15 * 60 * 1000],
    ["DAILY_MISSIONS_PER_PLAYER", DAILY_MISSIONS_PER_PLAYER, 3],
    ["ARCHITECT_MIN_EVENTS", ARCHITECT_MIN_EVENTS, 5],
    ["FACTION_LOW_RESOURCE_THRESHOLD", FACTION_LOW_RESOURCE_THRESHOLD, 50],
    // A10 closing pass — each equals the literal it replaced.
    ["CRITICAL_EVIDENCE_THRESHOLD", CRITICAL_EVIDENCE_THRESHOLD, 80],
    ["BOUNTY_EVIDENCE_THRESHOLD", BOUNTY_EVIDENCE_THRESHOLD, 81],
    ["DETECTION_FLOOR", DETECTION_FLOOR, 0.05],
    ["DETECTION_AGGRESSIVE_BONUS", DETECTION_AGGRESSIVE_BONUS, 0.3],
    // 0.20, NOT the 8 the old _PCT constant claimed: the code's value wins.
    ["DETECTION_STEALTH_REDUCTION", DETECTION_STEALTH_REDUCTION, 0.2],
    ["AI_OTHER_INTERVAL_H", AI_OTHER_INTERVAL_H, 8],
    ["AI_LEADER_INTERVAL_H", AI_LEADER_INTERVAL_H, 4],
    ["AI_ACTIONS_PER_DAY", AI_ACTIONS_PER_DAY, 3],
  ] as const) {
    check(`${name} === ${expected}`, actual === expected, `${actual}`);
  }

  console.log("\nBC-2 — the reward formula is arithmetically identical");
  {
    // The whole point: same inputs, same outputs as the five bare literals.
    const oldWay = (ev: number) => ({
      credits: Math.floor(1000 + (ev - 80) * 200),
      rep: Math.floor(5 + (ev - 80)),
    });
    const newWay = (ev: number) => {
      const over = ev - (BOUNTY_EVIDENCE_THRESHOLD - 1);
      return {
        credits: Math.floor(BOUNTY_BASE_CREDITS + over * BOUNTY_CREDITS_PER_EVIDENCE),
        rep: Math.floor(BOUNTY_BASE_REP + over),
      };
    };
    let same = true;
    for (let ev = 0; ev <= 100; ev++) {
      const a = oldWay(ev), b = newWay(ev);
      if (a.credits !== b.credits || a.rep !== b.rep) { same = false; break; }
    }
    // Also pins the corrected comment: the old one claimed 81% -> 2000c/10rep.
    check("the documented 81%% figures match the code",
      newWay(81).credits === 1200 && newWay(81).rep === 6,
      `ev=81 -> ${newWay(81).credits}c/${newWay(81).rep}rep; the comment said 2000c/10rep`);
    check("identical across every evidence level 0-100", same,
      `e.g. ev=81 -> ${JSON.stringify(newWay(81))}, ev=100 -> ${JSON.stringify(newWay(100))}`);
  }

  console.log("\nBC-3 — the twins are gone from the services");
  {
    const hack = ["hackService", "hackCountermeasureService", "hackScoring", "hackSessionStore"].map((f) => read(`../src/services/${f}.ts`)).join("\n");
    const dungeon = read("../src/services/darknetDungeonService.ts");
    const mission = read("../src/services/missionService.ts");
    const gen = read("../src/services/missionGenerator.ts");
    const story = read("../src/services/storyProgressionService.ts");
    const sched = read("../src/services/aiSchedulerService.ts");

    check("bounty formula uses the constants", /BOUNTY_BASE_CREDITS \+ evidenceOverThreshold/.test(hack));
    check("no bare 1000 + (evidenceLevel - 80) remains", !/1000 \+ \(evidenceLevel - 80\)/.test(hack));
    check("bounty expiry uses BOUNTY_EXPIRATION_H", !/48 \* 60 \* 60 \* 1000/.test(hack));
    check("dungeon TTL uses the constant", /DUNGEON_TTL_DAYS \* 24/.test(dungeon) && !/7 \* 24 \* 60 \* 60 \* 1000/.test(dungeon));
    check("dungeon regen uses the constant", /DUNGEON_REGEN_DELAY_MS\)/.test(dungeon) && !/\}, 30_000\)/.test(dungeon));
    check("mission expiry uses the constant", /INTERVAL_MS = MISSION_EXPIRATION_INTERVAL_MS/.test(mission));
    check("daily missions uses the constant", /DAILY_MISSIONS_PER_PLAYER\)/.test(gen));
    check("architect min events uses the constant", /< ARCHITECT_MIN_EVENTS/.test(story));
    check("faction threshold uses the constant", /= FACTION_LOW_RESOURCE_THRESHOLD/.test(sched));
  }

  console.log("\nBC-4 — the last four: every twin now reads its constant");
  {
    const hack = ["hackService", "hackCountermeasureService", "hackScoring", "hackSessionStore"].map((f) => read(`../src/services/${f}.ts`)).join("\n");
    const mem = read("../src/services/memoryService.ts");
    check("no bare `evidenceLevel > 80` remains", !/evidenceLevel > 80\b/.test(hack));
    check(
      "all three critical-band gates use the constant",
      (hack.match(/evidenceLevel > CRITICAL_EVIDENCE_THRESHOLD/g) || []).length === 3,
    );
    check(
      "the bounty threshold is DERIVED from the band, so they cannot disagree",
      BOUNTY_EVIDENCE_THRESHOLD === CRITICAL_EVIDENCE_THRESHOLD + 1,
      "postBounty is only reachable inside the > CRITICAL block",
    );
    check(
      "the three detection floors use DETECTION_FLOOR",
      (hack.match(/Math\.max\(DETECTION_FLOOR,/g) || []).length === 3,
    );
    check(
      "the successRate clamp was NOT swept — same value, different concept",
      /successRate = Math\.max\(0\.05, Math\.min\(0\.95, successRate\)\)/.test(hack),
    );
    check(
      "applyPriority's caps read the constants",
      /Math\.max\(-DETECTION_STEALTH_REDUCTION, Math\.min\(DETECTION_AGGRESSIVE_BONUS, detMod\)\)/.test(mem) &&
        !/Math\.min\(0\.30?, detMod\)/.test(mem),
    );
  }

  console.log("\nBC-5 — AI scheduler env: validated, defaults from gameBalance (BEHAVIOURAL)");
  {
    // Spawn the real config module with controlled env. An empty string
    // counts as "set" to dotenv, so it is not overwritten from .env and
    // reaches getEnvNumber's default path.
    const probe = (env: Record<string, string>) => {
      const r = spawnSync(
        "node_modules/.bin/tsx",
        ["-e", `import("./src/config/environment").then((ns) => {
          // tsx -e evaluates as CJS, so the named exports arrive on .default.
          const m = ns.validateConfig ? ns : ns.default; m.validateConfig();
          console.log("CFG=" + JSON.stringify([m.config.AI_INTERVAL_HOURS,
            m.config.AI_FACTION_LEADER_INTERVAL_HOURS, m.config.AI_MAX_ACTIONS_PER_DAY])); })`],
        {
          cwd: new URL("..", import.meta.url).pathname,
          env: { ...process.env, NODE_ENV: "development", AI_INTERVAL_HOURS: "",
                 AI_FACTION_LEADER_INTERVAL_HOURS: "", AI_MAX_ACTIONS_PER_DAY: "", ...env },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      const out = `${r.stdout}${r.stderr}`;
      const m = out.match(/CFG=(\[[^\]]*\])/);
      return { ok: r.status === 0 && !!m, cfg: m ? (JSON.parse(m[1]!) as number[]) : null, out };
    };

    const unset = probe({});
    check(
      "unset -> the gameBalance defaults",
      JSON.stringify(unset.cfg) === JSON.stringify([AI_OTHER_INTERVAL_H, AI_LEADER_INTERVAL_H, AI_ACTIONS_PER_DAY]),
      unset.cfg ? JSON.stringify(unset.cfg) : unset.out.slice(-200),
    );

    // POSITIVE CONTROL: env is still authoritative, so a deployed .env keeps working.
    const set = probe({ AI_INTERVAL_HOURS: "6", AI_MAX_ACTIONS_PER_DAY: "0" });
    check("a valid env value still overrides the default", set.cfg?.[0] === 6 && set.cfg?.[2] === 0,
      set.cfg ? JSON.stringify(set.cfg) : set.out.slice(-200));

    const garbage = probe({ AI_INTERVAL_HOURS: "abc" });
    check(
      "garbage is REFUSED at boot (was NaN -> setInterval ~1ms)",
      !garbage.ok && /must be a finite number/.test(garbage.out),
    );

    const fraction = probe({ AI_FACTION_LEADER_INTERVAL_HOURS: "0.5" });
    check(
      "a sub-hour interval is REFUSED (truncates to 0 -> the same tight loop)",
      !fraction.ok && /AI_FACTION_LEADER_INTERVAL_HOURS must be a whole number of hours >= 1/.test(fraction.out),
    );

    const sched = read("../src/services/aiSchedulerService.ts");
    check("the scheduler no longer parses env itself", !/parseInt\(process\.env/.test(sched));
  }

  // ── The tap tiers exist in two places; make drift impossible to miss ──
  {
    const { TAP_ITEMS } = await import("../src/config/gameBalance");
    const { SHOP_CATALOG } = await import("../src/services/shopService");
    for (const [id, spec] of Object.entries(TAP_ITEMS)) {
      const row: any = (SHOP_CATALOG as any[]).find((i) => i.id === id);
      check(`${id} is in the catalog`, !!row, id);
      check(
        `${id} quality agrees between gameBalance and the catalog`,
        row?.effect?.tapQuality === spec.quality,
        `catalog=${row?.effect?.tapQuality} gameBalance=${spec.quality} — ` +
        "handleTap reads gameBalance, so a catalog-only edit silently does nothing",
      );
      check(
        `${id} duration agrees`,
        row?.effect?.tapDurationMinutes === spec.durationMinutes,
        `catalog=${row?.effect?.tapDurationMinutes} gameBalance=${spec.durationMinutes}`,
      );
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}
main().catch(e => { console.error("HARNESS ERROR:", e); process.exit(1); });
