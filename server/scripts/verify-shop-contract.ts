/**
 * Guards every place where code names a shop item by a string that must resolve.
 *
 * This bug class cost the game two features and a help page:
 *   - `crack.protected` searched inventory for a name CONTAINING "quantum charge"
 *     while the item is "Quantum Decryptor Charge" — unusable by everyone.
 *   - the darknet `rare_script` reward looked up the ID "zero_day_exploit" as a
 *     NAME (the row is "Zero-Day Exploit") — it silently paid credits only.
 *   - every example item id in the shop help was invented, so `man buy` taught a
 *     command that answers "Script not found in store catalog".
 *
 * Each was invisible because a failed lookup is indistinguishable from "player
 * doesn't have one". Static checks are the only thing that catches them.
 */
import "reflect-metadata";
import { readFileSync } from "fs";
import { join } from "path";
import { HACK_TOOL_ITEMS, QUANTUM_CHARGE_ITEM_ID, HARDWARE_SPECS } from "../src/config/gameBalance";

const rows: Array<[string, boolean, string]> = [];

// ── Build the id set from the catalog SOURCE ──
// Parsed from source rather than imported, because importing shopService pulls
// in the DI container and a Prisma client. The catalog is a plain literal, so a
// parse is honest here — but guard the count, or a regex that silently matches
// nothing turns every check below into a vacuous pass.
const shopSrc = readFileSync(
  join(__dirname, "..", "src", "services", "shopService.ts"),
  "utf8",
);
const catStart = shopSrc.indexOf("const SHOP_CATALOG");
if (catStart < 0) throw new Error("SHOP_CATALOG not found");
const catEnd = shopSrc.indexOf("\n];", catStart);
if (catEnd < 0) throw new Error("could not find the end of SHOP_CATALOG");
const catalogBlock = shopSrc.slice(catStart, catEnd);

const CATALOG_IDS = new Set(
  [...catalogBlock.matchAll(/^\s{4}id: "([a-z_0-9]+)",/gm)].map((m) => m[1]!),
);
const CATALOG_NAMES = new Set(
  [...catalogBlock.matchAll(/^\s{4}name: "([^"]+)",/gm)].map((m) => m[1]!),
);
if (CATALOG_IDS.size === 0) {
  throw new Error("extracted 0 catalog ids — the extraction is broken, not the code");
}
if (CATALOG_IDS.size !== CATALOG_NAMES.size) {
  throw new Error(
    `catalog parse mismatch: ${CATALOG_IDS.size} ids vs ${CATALOG_NAMES.size} names`,
  );
}

// ── 1. Every example item id in the shop help resolves ──
const shopCmdSrc = readFileSync(
  join(__dirname, "..", "src", "services", "commandModules", "shopCommands.ts"),
  "utf8",
);
// Examples look like `buy basic_scanner`, `sell quantum_charge 3`, `unequip TOOL`.
// Slot names and bare verbs are not item ids, so only check the second token when
// it is lower_snake_case.
const SLOT_WORDS = new Set(["TOOL", "SOFTWARE", "EXPLOIT", "DEFENSE", "UPGRADE"]);
const exampleArrays = [...shopCmdSrc.matchAll(/examples: \[([^\]]*)\]/g)];
const badExamples: string[] = [];
let exampleIdsChecked = 0;
for (const arr of exampleArrays) {
  for (const ex of [...arr[1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!)) {
    const parts = ex.split(/\s+/);
    const arg = parts[1];
    if (!arg || SLOT_WORDS.has(arg) || !/^[a-z][a-z_0-9]*$/.test(arg)) continue;
    exampleIdsChecked++;
    if (!CATALOG_IDS.has(arg)) badExamples.push(ex);
  }
}
if (exampleIdsChecked === 0) {
  throw new Error("checked 0 example ids — the example regex is broken");
}
rows.push([
  "shop help examples name real catalog ids",
  badExamples.length === 0,
  badExamples.length
    ? `unresolvable: ${badExamples.join(", ")}`
    : `${exampleIdsChecked} example ids all resolve`,
]);

// ── 2. HACK_TOOL_ITEMS all resolve ──
const badTools = Object.entries(HACK_TOOL_ITEMS).filter(
  ([, id]) => !CATALOG_IDS.has(id),
);
rows.push([
  "HACK_TOOL_ITEMS map to catalog ids",
  badTools.length === 0,
  badTools.length
    ? `unresolvable: ${badTools.map(([k, v]) => `${k}->${v}`).join(", ")}`
    : `${Object.keys(HACK_TOOL_ITEMS).length} tools all resolve`,
]);

// ── 3. The quantum charge id resolves (S1) ──
rows.push([
  "QUANTUM_CHARGE_ITEM_ID resolves",
  CATALOG_IDS.has(QUANTUM_CHARGE_ITEM_ID),
  CATALOG_IDS.has(QUANTUM_CHARGE_ITEM_ID)
    ? QUANTUM_CHARGE_ITEM_ID
    : `missing: ${QUANTUM_CHARGE_ITEM_ID}`,
]);

// ── 4. Nothing matches an item by name substring any more (S1's bug class) ──
const serverSrcFiles = [
  join(__dirname, "..", "src", "services", "commandModules", "hackCommands.ts"),
];
const substringMatchers: string[] = [];
for (const f of serverSrcFiles) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/shopItem\??\.name\??\.[a-zA-Z]*\(?\)?\.?includes\(/g)) {
    substringMatchers.push(`${f.split("/").pop()}: ${m[0]}`);
  }
}
rows.push([
  "no item lookup by name substring",
  substringMatchers.length === 0,
  substringMatchers.length ? substringMatchers.join(", ") : "none found",
]);

// ── 5. Darknet reward ids resolve (S15) ──
const dungeonSrc = readFileSync(
  join(__dirname, "..", "src", "services", "darknetDungeonService.ts"),
  "utf8",
);
const rewardIds = [...dungeonSrc.matchAll(/scriptItemId: "([a-z_0-9]+)"/g)].map(
  (m) => m[1]!,
);
if (rewardIds.length === 0) {
  throw new Error("found 0 scriptItemId rewards — the extraction is broken");
}
const badRewards = rewardIds.filter((id) => !CATALOG_IDS.has(id));
rows.push([
  "darknet script rewards resolve",
  badRewards.length === 0,
  badRewards.length ? `unresolvable: ${badRewards.join(", ")}` : `${rewardIds.length} checked`,
]);

// ── 6. HARDWARE_SPECS <-> catalog HARDWARE entries, both directions (G3) ──
// The old table was keyed by item NAME and matched nothing purchasable. Keyed by
// id now, so assert the two agree or the same silence returns.
const hardwareIds = new Set(Object.keys(HARDWARE_SPECS));
const catalogHardwareIds = new Set(
  [...catalogBlock.matchAll(
    /id: "([a-z_0-9]+)",[\s\S]{0,400}?category: ItemCategory\.HARDWARE,/g,
  )].map((m) => m[1]!),
);
if (catalogHardwareIds.size === 0) {
  throw new Error("extracted 0 HARDWARE catalog entries — the extraction is broken");
}
const specNotInCatalog = [...hardwareIds].filter((id) => !CATALOG_IDS.has(id));
const catalogNotInSpec = [...catalogHardwareIds].filter((id) => !hardwareIds.has(id));
rows.push([
  "HARDWARE_SPECS ids exist in the catalog",
  specNotInCatalog.length === 0,
  specNotInCatalog.length ? `missing: ${specNotInCatalog.join(", ")}` : `${hardwareIds.size} parts`,
]);
rows.push([
  "every HARDWARE catalog item has a spec",
  catalogNotInSpec.length === 0,
  catalogNotInSpec.length
    ? `no spec (would apply nothing): ${catalogNotInSpec.join(", ")}`
    : `${catalogHardwareIds.size} parts`,
]);

// ── 7. Supersession is well-formed: one part per (channel, tier) ──
const seenTier = new Map<string, string>();
const tierClashes: string[] = [];
for (const [id, spec] of Object.entries(HARDWARE_SPECS)) {
  const key = `${spec.channel}:${spec.tier}`;
  const prev = seenTier.get(key);
  if (prev) tierClashes.push(`${key} = ${prev} and ${id}`);
  else seenTier.set(key, id);
}
rows.push([
  "one hardware part per channel+tier",
  tierClashes.length === 0,
  tierClashes.length ? tierClashes.join("; ") : `${seenTier.size} distinct slots`,
]);

// ── 8. Persona tokens survived the move from the seed ──
// `effect.personaName` is what tokenConsumption matches on, and the sync did not
// write the `effect` column at all until G3. Losing it silently breaks the only
// working item effect in the game.
const tokenBlocks = [...catalogBlock.matchAll(
  /id: "([a-z_0-9]+)",[\s\S]{0,900}?category: ItemCategory\.TOKEN,([\s\S]{0,900}?)\n  \},/g,
)];
if (tokenBlocks.length === 0) {
  throw new Error("extracted 0 TOKEN catalog entries — the extraction is broken");
}
const tokenProblems: string[] = [];
for (const [, id, body] of tokenBlocks) {
  if (!/personaName: "/.test(body!)) tokenProblems.push(`${id}: no effect.personaName`);
  if (!/purchasable: false/.test(body!)) tokenProblems.push(`${id}: not reward-only`);
}
rows.push([
  "persona tokens keep effect + reward-only",
  tokenProblems.length === 0,
  tokenProblems.length ? tokenProblems.join("; ") : `${tokenBlocks.length} tokens intact`,
]);

// ── 9. The sync writes the effect column at all ──
rows.push([
  "catalog sync persists the effect column",
  /effect: \(item\.effect \?\?/.test(shopSrc),
  /effect: \(item\.effect \?\?/.test(shopSrc)
    ? "written"
    : "syncCatalogToDatabase drops effect — tokens would break",
]);

console.log("\n===== SHOP CONTRACT =====");
for (const [n, ok, why] of rows) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${n.padEnd(42)} ${why}`);
}
const failed = rows.filter(([, ok]) => !ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
console.log("=========================");
if (failed) process.exitCode = 1;
