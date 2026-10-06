/**
 * Phase 6 U3 + agent prompt budget.
 *
 *  U3      The valid `accessMethod` set existed only as a COMMENT on
 *          schema.prisma:228. No Prisma enum, no constant, no validator — so
 *          contentDraftService took it from a draft payload and
 *          routes/adminApi/servers.ts took it straight off req.body. The read
 *          side already fails closed (S11), which turned a typo into an
 *          unreachable server: safe, but silent and indistinguishable from a
 *          topology bug.
 *
 *  BUDGET  runAgentLoop's conversationHistory is append-only. Per-tool-result
 *          truncation capped each addition at 4000 chars, but nothing capped
 *          the total, and the whole transcript is resent every round.
 *
 * Run: npx tsx scripts/verify-phase6-u3-budget.ts
 */
import {
  ACCESS_METHODS,
  isAccessMethod,
  normalizeAccessMethod,
  DEFAULT_ACCESS_METHOD,
} from "../src/utils/accessMethod";
import { budgetConversation } from "../src/services/aiAgentTools";
import { readFileSync } from "node:fs";

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
  console.log("\n=== Phase 6 U3 + prompt budget ===");

  // ── U3: the allow-list matches the switch that reads it ──────────────
  console.log("\nU3-1 — the constant agrees with the schema and the read side");
  {
    const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url).pathname, "utf8");
    const line = schema.split("\n").find((l) => l.includes("accessMethod String")) ?? "";
    for (const m of ACCESS_METHODS) {
      check(`schema comment still lists "${m}"`, line.includes(`"${m}"`), line.trim().slice(0, 90));
    }

    // The fail-closed switch is the consumer; every value we accept must have
    // a branch there, or we would be writing values the game then denies.
    const topo = read("../src/services/networkTopologyService.ts");
    for (const m of ACCESS_METHODS) {
      check(`the access switch handles "${m}"`, topo.includes(`"${m}"`), "");
    }
  }

  // ── U3: normalization ────────────────────────────────────────────────
  console.log("\nU3-2 — untrusted values are normalized or rejected");
  {
    check("a valid value passes", normalizeAccessMethod("keycard") === "keycard");
    check('whitespace is tolerated ("keycard ")', normalizeAccessMethod("keycard ") === "keycard",
      "the fail-closed reader would have made this server permanently unreachable");
    check('case is tolerated ("Hackable")', normalizeAccessMethod("Hackable") === "hackable");
    for (const bad of ["hack_only", "", "open-ish", null, undefined, 7, {}]) {
      check(`rejected: ${JSON.stringify(bad)}`, normalizeAccessMethod(bad as any) === null);
    }
    check("isAccessMethod agrees", isAccessMethod("open") && !isAccessMethod("nope"));
    check("the default is itself valid", isAccessMethod(DEFAULT_ACCESS_METHOD), DEFAULT_ACCESS_METHOD);
  }

  // ── U3: the write sites ──────────────────────────────────────────────
  console.log("\nU3-3 — every write path validates");
  {
    const admin = read("../src/routes/adminApi/servers.ts");
    const draft = read("../src/services/contentDraftService.ts");

    check("admin create validates", /resolvedAccessMethod/.test(admin));
    check("admin create rejects with 400", /Invalid accessMethod/.test(admin));
    check("admin update validates", /if \(accessMethod !== undefined\) \{[\s\S]{0,300}?normalizeAccessMethod/.test(admin));
    check(
      "no raw assignment survives on the admin paths",
      !/accessMethod: accessMethod \?\? "hackable"/.test(admin) &&
        !/data\.accessMethod = accessMethod;/.test(admin),
      "both took req.body verbatim",
    );
    check("draft approval normalizes", /normalizeAccessMethod\(payload\.accessMethod\)/.test(draft));
    check(
      "and no longer stores payload.accessMethod raw",
      !/accessMethod: payload\.accessMethod \|\| "hackable"/.test(draft),
    );

    const topo = read("../src/services/networkTopologyService.ts");
    check(
      "the stale comment about serverContentService is gone",
      !/serverContentService` write it from AI-generated content/.test(topo),
      "that file contains no accessMethod write",
    );
    const content = read("../src/services/serverContentService.ts");
    check(
      "PRECONDITION for that correction: serverContentService really has no write",
      !/accessMethod:/.test(content),
      "verified rather than assumed",
    );
  }

  // ── Prompt budget ────────────────────────────────────────────────────
  console.log("\nBUDGET-1 — the agent transcript is bounded");
  {
    const task = "ORIGINAL TASK: catalogue the faction servers.";
    const short = task + "\nround 1 result";
    check(
      "a normal conversation is untouched",
      budgetConversation(short, task) === short,
      "the budget must not disturb ordinary loops",
    );

    const huge = task + "\n" + "x".repeat(200_000) + "\nMOST RECENT ROUND";
    const trimmed = budgetConversation(huge, task, 5_000);
    check("an oversized conversation is trimmed", trimmed.length <= 5_000, `${trimmed.length} chars`);
    check(
      "the ORIGINAL TASK survives at the head",
      trimmed.startsWith("ORIGINAL TASK"),
      "dropping it is how an agent forgets the question and answers the last tool result",
    );
    check(
      "the most recent round survives at the tail",
      trimmed.includes("MOST RECENT ROUND"),
      "that is the state it is reasoning over",
    );
    check(
      "the elision is visible to the model, not silent",
      /elided/.test(trimmed),
      "a silent cut invites the model to invent what it thinks it forgot",
    );

    const loop = read("../src/services/aiAgentTools.ts");
    check(
      "the budget is applied at the generate call",
      /budgetConversation\(conversationHistory, userPrompt\)/.test(loop),
      "defining it without calling it would be the usual failure",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
