/**
 * The mission template pool survives being moved out of its service module.
 *
 * A8 extracts a 1,900-line literal array out of `missionTemplatePool.ts`
 * (2,199 lines, 86% of which is that array). Nine modules import from here —
 * missionGenerator, missionService, storyMissionService, personaActionService,
 * personaMissionGenService, missionIntegration, shopService and two utils — so
 * the thing that must not change is the DATA, not the file layout.
 *
 * A move like this cannot break the build and can still be wrong: one dropped
 * entry, one `id` altered by a bad merge, one field silently lost to a
 * reformat. `tsc` sees a well-typed array either way, and the golden master
 * drives commands rather than the template catalogue.
 *
 * So this fingerprints the RESOLVED output — every template id, every field of
 * every template, and the derived query helpers — and the extraction must
 * leave the fingerprint byte-identical. It imports the module's public surface
 * exactly as the nine consumers do, so it is checking what they will see.
 *
 * Run with --record BEFORE the move, then plain afterwards.
 * Run: npx tsx scripts/verify-phase7-a8-templates.ts
 */
import "reflect-metadata";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RECORD = process.argv.includes("--record");
const BASELINE = new URL("./a8-templates.baseline.json", import.meta.url).pathname;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

/**
 * Stable hash of a value, key order normalised.
 *
 * Key ORDER must not count: moving an object literal between files can change
 * nothing semantically while reordering nothing — but a reformat that sorts
 * keys would show as a false failure, and a check that cries wolf gets
 * re-recorded rather than read.
 */
function stableHash(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      return Object.keys(o).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = norm(o[k]);
        return acc;
      }, {});
    }
    return x;
  };
  return createHash("sha256").update(JSON.stringify(norm(v))).digest("hex").slice(0, 16);
}

interface Fingerprint {
  count: number;
  /** id -> hash of the whole template. Catches a changed field anywhere. */
  byId: Record<string, string>;
  /** Derived views, so a helper that stops filtering correctly is caught too. */
  tierCounts: Record<string, number>;
  tierDefinitions: string;
}

async function main() {
  console.log("\n=== A8 — mission template pool extraction ===");

  const mod = await import("../src/services/missionTemplatePool");
  const { MISSION_TEMPLATES, TIER_DEFINITIONS, getTemplatesByTier } = mod as any;

  const ids = [...MISSION_TEMPLATES.keys()].sort();
  const byId: Record<string, string> = {};
  for (const id of ids) byId[id] = stableHash(MISSION_TEMPLATES.get(id));

  const tierCounts: Record<string, number> = {};
  for (let tier = 1; tier <= 5; tier++) {
    tierCounts[String(tier)] = getTemplatesByTier(tier).length;
  }

  const fp: Fingerprint = {
    count: MISSION_TEMPLATES.size,
    byId,
    tierCounts,
    tierDefinitions: stableHash(TIER_DEFINITIONS),
  };

  // ── Non-vacuity, before anything is compared ─────────────────────
  console.log("\nTP-0 — the fingerprint is real");
  check(
    "templates were loaded",
    fp.count > 20,
    `${fp.count} — an empty or tiny map would make every comparison below pass`,
  );
  check(
    "every tier resolves at least one template",
    Object.values(fp.tierCounts).every((n) => n > 0),
    JSON.stringify(fp.tierCounts),
  );
  check(
    "ids are unique and non-empty",
    ids.length === fp.count && ids.every((i) => typeof i === "string" && i.length > 0),
    `${ids.length} ids for ${fp.count} entries — a duplicate id silently drops a template`,
  );

  if (RECORD) {
    writeFileSync(BASELINE, JSON.stringify(fp, null, 2));
    console.log(`\n  recorded ${fp.count} templates -> ${BASELINE}`);
    console.log("\n=== BASELINE RECORDED ===");
    process.stdout.write("", () => process.exit(0));
    return;
  }

  if (!existsSync(BASELINE)) {
    console.log("  [FAIL] no baseline. Run with --record BEFORE the extraction.");
    console.log("\n=== 0 PASS / 1 FAIL ===");
    process.stdout.write("", () => process.exit(1));
    return;
  }

  const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Fingerprint;

  console.log("\nTP-1 — no template was lost, added or altered");
  {
    check("the count is unchanged", fp.count === base.count, `${fp.count} vs ${base.count}`);

    const baseIds = Object.keys(base.byId);
    const lost = baseIds.filter((i) => !(i in fp.byId));
    const added = Object.keys(fp.byId).filter((i) => !(i in base.byId));
    check("no id disappeared", lost.length === 0, lost.slice(0, 5).join(", ") || "none");
    check("no id appeared", added.length === 0, added.slice(0, 5).join(", ") || "none");

    const changed = baseIds.filter((i) => i in fp.byId && fp.byId[i] !== base.byId[i]);
    check(
      "every surviving template is field-for-field identical",
      changed.length === 0,
      changed.length
        ? `${changed.length} changed: ${changed.slice(0, 5).join(", ")}`
        : `${baseIds.length} templates hashed equal`,
    );
  }

  console.log("\nTP-2 — the derived query surface is unchanged");
  {
    check(
      "per-tier counts match",
      JSON.stringify(fp.tierCounts) === JSON.stringify(base.tierCounts),
      `${JSON.stringify(fp.tierCounts)} vs ${JSON.stringify(base.tierCounts)}`,
    );
    check(
      "TIER_DEFINITIONS is unchanged",
      fp.tierDefinitions === base.tierDefinitions,
      "the tier table drives generation difficulty, not just display",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
