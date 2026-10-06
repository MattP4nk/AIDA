/**
 * Phase 6 S5c — AI-authored mission rewards are bounded.
 *
 * The exploit this closes: `Mission.reward` is a Json column written from AI
 * output, and the path had four casts and no schema —
 *   aiOutputValidator `data: i.data` (only `type` allow-listed)
 *   -> architectInterventionExecutor `data.reward as Record<string, unknown>`
 *   -> createMission `reward: data.reward as any`
 *   -> calculateRewards `mission.reward as unknown as MissionRewards`
 *   -> grantRewards `if (rewards.credits > 0) addCredits(...)`
 * so `data.reward = { credits: 1e9 }` was stored and granted in full.
 *
 * Reachable because AI output is player-influenced: the agent loop reads
 * player-authored files and forum posts unsanitized (S5a/S6c).
 *
 * Run: npx tsx scripts/verify-phase6-s5c-rewards.ts
 */
import "reflect-metadata";
import {
  boundMissionRewards,
  boundMissionRewardsWithReport,
  boundMissionDifficulty,
  MAX_MISSION_CREDITS,
  MAX_MISSION_XP,
} from "../src/utils/missionRewards";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n=== Phase 6 S5c — mission reward bounds ===");

  // ── The headline exploit ─────────────────────────────────────────────
  console.log("\nS5c-1 — the 1e9 payload");
  {
    const evil = boundMissionRewards({ credits: 1e9, xp: 1e9 });
    check("a billion credits is clamped", evil.credits === MAX_MISSION_CREDITS, `${evil.credits}`);
    check("a billion xp is clamped", evil.xp === MAX_MISSION_XP, `${evil.xp}`);

    // Type confusion: the payout multiplies, and JS coerces strings.
    const stringy = boundMissionRewards({ credits: "1000000000", xp: "1000000000" });
    check(
      "a STRING billion is clamped too",
      stringy.credits === MAX_MISSION_CREDITS && stringy.xp === MAX_MISSION_XP,
      `credits=${stringy.credits} — "1e9" * multiplier would have coerced numerically`,
    );
    check(
      "and the clamp is reported, not silent",
      boundMissionRewardsWithReport({ credits: 1e9, xp: 1 }).clamped.includes("credits"),
      "an unreported clamp hides that the AI is producing garbage",
    );

    // REVIEW-FOUND BLIND SPOT: the first reporter gated on Number.isFinite(raw),
    // so the MOST malformed blobs — the likeliest AI garbage — were silently
    // zeroed and reported as "not clamped". It also inspected only xp/credits.
    const junk = boundMissionRewardsWithReport({
      credits: "a lot",
      xp: { base: 5000 },
      reputation: 1e9,
      skillPoints: 1e9,
    });
    check(
      "non-numeric credits/xp are reported, not silently zeroed",
      junk.clamped.includes("credits") && junk.clamped.includes("xp"),
      `clamped=[${junk.clamped}] — these became 0 with no warning at all`,
    );
    check(
      "reputation and skillPoints are reported too",
      junk.clamped.includes("reputation") && junk.clamped.includes("skillPoints"),
      "four of six fields had no diagnostic",
    );
    check(
      "a clean reward reports nothing",
      boundMissionRewardsWithReport({ credits: 100, xp: 50 }).clamped.length === 0,
      "a reporter that always fires measures nothing",
    );
  }

  // ── Legitimate content must be untouched (bound from the other side) ──
  console.log("\nS5c-2 — the richest legitimate mission is NOT altered");
  {
    // missionTemplatePool.ts:1559-1561 — credits {base:50000, perLevel:1000},
    // xp {base:10000, perLevel:100}. At an implausible level 200:
    const richest = { credits: 50_000 + 1_000 * 200, xp: 10_000 + 100 * 200, reputation: 50, skillPoints: 5 };
    const bounded = boundMissionRewards(richest);
    check(
      "credits pass through unchanged",
      bounded.credits === richest.credits,
      `${bounded.credits} === ${richest.credits}`,
    );
    check("xp passes through unchanged", bounded.xp === richest.xp, `${bounded.xp}`);
    check("reputation and skillPoints survive", bounded.reputation === 50 && bounded.skillPoints === 5);
    check(
      "no clamp is reported for legitimate values",
      boundMissionRewardsWithReport(richest).clamped.length === 0,
      "a cap that fires on real content would silently nerf the endgame",
    );

    // And after the maximum ~2.35x multiplier it is still under the ceiling.
    const granted = boundMissionRewards({
      credits: Math.floor(richest.credits * 2.35),
      xp: Math.floor(richest.xp * 2.35),
    });
    check(
      "even after the max multiplier it stays under the cap",
      granted.credits === Math.floor(richest.credits * 2.35),
      `${granted.credits} < ${MAX_MISSION_CREDITS}`,
    );
  }

  // ── Malformed input must not become NaN or a crash ───────────────────
  console.log("\nS5c-3 — malformed blobs normalise instead of propagating");
  {
    for (const [label, raw] of [
      ["undefined", undefined],
      ["null", null],
      ["a string", "not an object"],
      ["NaN", { credits: NaN, xp: NaN }],
      ["Infinity", { credits: Infinity, xp: Infinity }],
      ["negative", { credits: -500, xp: -1 }],
      ["an object", { credits: { nested: true }, xp: [] }],
    ] as const) {
      const b = boundMissionRewards(raw);
      check(
        `${label} yields a valid, finite, non-negative reward`,
        Number.isFinite(b.credits) && Number.isFinite(b.xp) && b.credits >= 0 && b.xp >= 0,
        `credits=${b.credits} xp=${b.xp}`,
      );
    }
    check(
      "arrays are bounded",
      boundMissionRewards({ items: new Array(10_000).fill("x") }).items.length <= 25,
      `${boundMissionRewards({ items: new Array(10_000).fill("x") }).items.length} items`,
    );
    check(
      "non-string array entries are dropped",
      boundMissionRewards({ items: [1, null, "real", {}] }).items.length === 1,
      "a null item would crash the consumer",
    );
  }

  // ── The two field names in play ──────────────────────────────────────
  console.log("\nS5c-4 — both reward shapes are honoured");
  {
    // missionService.MissionRewards calls it `xp`; shared/types/mission.ts
    // calls it `experience`. Zeroing one would silently delete rewards.
    check(
      "`experience` is accepted as an alias for `xp`",
      boundMissionRewards({ experience: 500 }).xp === 500,
      "shared/types/mission.ts uses `experience`",
    );
    check("`xp` still wins when both are present", boundMissionRewards({ xp: 10, experience: 99 }).xp === 10);
  }

  // ── Difficulty ───────────────────────────────────────────────────────
  console.log("\nS5c-5 — difficulty is clamped to the 1-10 scale");
  {
    check("999 clamps to 10", boundMissionDifficulty(999) === 10, `${boundMissionDifficulty(999)}`);
    check("-5 clamps to 1", boundMissionDifficulty(-5) === 1, `${boundMissionDifficulty(-5)}`);
    check("garbage falls back to 3", boundMissionDifficulty("abc") === 3, `${boundMissionDifficulty("abc")}`);
    check("a legitimate 4 is untouched", boundMissionDifficulty(4) === 4);
  }

  // ── Every layer is actually wired (structure, comment-stripped) ───────
  console.log("\nS5c-6 — all three layers call the bound");
  {
    const { readFileSync } = await import("node:fs");
    const strip = (s: string) =>
      s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const exec = strip(readFileSync(new URL("../src/services/architectInterventionExecutor.ts", import.meta.url).pathname, "utf8"));
    const ms = strip(readFileSync(new URL("../src/services/missionService.ts", import.meta.url).pathname, "utf8"));

    check("AI entry point bounds the proposal", /boundMissionRewardsWithReport\(proposedReward\)/.test(exec));
    check("and no longer casts reward to any", !/reward: reward as any/.test(exec));
    check("createMission bounds at the write", /reward: boundMissionRewards\(data\.reward\)/.test(ms));
    check(
      "calculateRewards bounds BEFORE multiplying",
      /const baseRewards: MissionRewards = boundMissionRewards\(mission\.reward\)/.test(ms),
      "the multiplier coerces strings, so the cast had to go",
    );
    check(
      "and bounds the granted amount after the multiplier",
      /const finalRewards: MissionRewards = boundMissionRewards\(\{/.test(ms),
      "clamping only the stored value leaves the payout ~2.35x unbounded",
    );
    check(
      "the old unchecked cast is gone from the payout path",
      !/mission\.reward as unknown as MissionRewards/.test(ms),
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
