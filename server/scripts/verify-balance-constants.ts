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
  DETECTION_FLOOR_PCT, DETECTION_AGGRESSIVE_BONUS_PCT,
} from "../src/config/gameBalance";
import { readFileSync } from "node:fs";

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
    const hack = read("../src/services/hackService.ts");
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

  console.log("\nBC-4 — what was deliberately NOT substituted");
  {
    const hack = read("../src/services/hackService.ts");
    check(
      "the three `> 80` gates are untouched",
      (hack.match(/evidenceLevel > 80/g) || []).length === 3,
      "they gate the CRITICAL-EVIDENCE band (lockdown, alert severity, rep penalty), " +
        "not bounties — a BOUNTY_* name would mislabel two of three",
    );
    check(
      "DETECTION_*_PCT still unsubstituted, and the unit gap is why",
      DETECTION_FLOOR_PCT === 5 && DETECTION_AGGRESSIVE_BONUS_PCT === 30,
      "constants are PERCENT, the twins are FRACTIONS (0.05 / 0.30) — and one of " +
        "the three 0.05 sites clamps successRate, a different concept sharing a value",
    );
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
