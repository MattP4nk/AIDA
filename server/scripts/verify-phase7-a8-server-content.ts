/**
 * Server content survives being moved out of its service module.
 *
 * A8: `serverContentService.ts` opened with ~1,450 lines of module-scope
 * content — rosters, static templates, role/faction generators, AI prompts and
 * their random pickers — ahead of the class. They move to
 * `serverContentTemplates.ts` and `serverContentPrompts.ts`.
 *
 * A move like this cannot break the build and can still be wrong: a dropped
 * template, a branch lost in a merge, a string reflowed. `tsc` sees well-typed
 * code either way, and the golden master drives commands, not provisioning.
 * So this fingerprints both the DATA and the OUTPUT of every moved function on
 * a fixed matrix of inputs, and the move must leave it byte-identical.
 *
 * The generators are random and date-stamped, so the fingerprint runs with
 * `Math.random` replaced by a seeded PRNG — RESET PER CASE, so a result does
 * not depend on how many calls came before it — and `Date` frozen at a fixed
 * instant. That covers ContentEncoder too, which draws from both.
 *
 * Symbols are resolved from whichever module exports them, so the same
 * harness reads the code before and after the move.
 *
 * Run with --record BEFORE the move, then plain afterwards.
 * Run: npx tsx scripts/verify-phase7-a8-server-content.ts
 */
import "reflect-metadata";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const RECORD = process.argv.includes("--record");
const BASELINE = new URL("./a8-server-content.baseline.json", import.meta.url).pathname;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Stable JSON: key order normalised, Sets as sorted arrays. */
function stable(v: unknown): unknown {
  if (v instanceof Set) return [...v].map(stable).sort();
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as any)[k])]));
  }
  return v;
}
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(stable(v))).digest("hex").slice(0, 16);

// ── Determinism ─────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (key: string) => [...key].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);
const RealDate = Date;
const FIXED = RealDate.UTC(2026, 0, 15, 12);
class FrozenDate extends RealDate {
  constructor(...a: any[]) { if (a.length === 0) super(FIXED); else super(...(a as [any])); }
  static now() { return FIXED; }
}
/**
 * Run `fn` deterministically: seeded randomness, frozen clock.
 *
 * Restores what was active BEFORE it, not the originals — calls nest (a
 * fixture is built inside a case), and restoring `realRandom` on the inner
 * exit put the rest of the outer case back on true randomness. The
 * determinism precondition below caught exactly that.
 */
function det<T>(key: string, fn: () => T): T {
  const prevRandom = Math.random;
  const prevDate = (globalThis as any).Date;
  Math.random = mulberry32(seedOf(key));
  (globalThis as any).Date = FrozenDate;
  try { return fn(); } finally { Math.random = prevRandom; (globalThis as any).Date = prevDate; }
}

async function main() {
  console.log("\n=== A8 — server content moved byte-for-byte ===");

  // Resolve each symbol from whichever module exports it (new modules first).
  const candidates = [
    "../src/services/serverContentTemplates",
    "../src/services/serverContentPrompts",
    "../src/services/serverContentService",
  ];
  const mods: any[] = [];
  for (const c of candidates) {
    try { mods.push(await import(c)); } catch (e: any) {
      if (!String(e?.message ?? e).includes("Cannot find module")) throw e;
    }
  }
  const need = [
    "EMPLOYEE_ROSTERS", "STATIC_CONTENT", "DEFAULT_CONTENT", "LORE_SYSTEM_PROMPT", "AMBIENT_SYSTEM_PROMPT",
    "MISSION_FILES_SYSTEM_PROMPT", "PROVISIONED_OBJECTIVE_TYPES", "getEmployeeRoster", "generateFactionSecrets",
    "generateRoleContent", "generateEncodedFiles", "pickLoreQuote", "pickPieceHint", "pickFactionHiddenHint",
    "pickFactionTopic", "pickFactionFileNames", "pickFactionMundaneTheme", "pickIndependentTheme", "pickAmbientNews",
    "pickEasterEgg", "resolveFactionKey", "buildLorePrompt", "buildAmbientPrompt", "buildMissionFilesPrompt",
  ];
  const S: Record<string, any> = {};
  for (const n of need) S[n] = mods.find((m) => m[n] !== undefined)?.[n];
  const missing = need.filter((n) => S[n] === undefined);
  check("every moved symbol resolves", missing.length === 0, missing.length ? `missing: ${missing.join(", ")}` : `${need.length} symbols`);
  if (missing.length) throw new Error("cannot fingerprint without every symbol");

  // ── Input matrix ───────────────────────────────────────────────────────
  const FACTIONS = ["garrison", "dothackers", "cybercorp", "darknet", null, "nonexistent"] as const;
  const ROLES = ["database", "dns", "email", "firewall", "gateway", "router", "workstation", "unknown_role"];
  const peers = [
    { name: "core-db", ip: "10.1.0.5", role: "database" },
    { name: "edge-gw", ip: "10.1.0.1", role: "gateway" },
    { name: "mail-01", ip: "10.1.0.9", role: "email" },
  ];
  const ctxFor = (role: string, faction: string | null, withNet = true) => det(`ctx|${role}|${faction}|${withNet}`, () => ({
    server: { name: `srv-${role}`, ip: "10.1.0.42", type: "corporate", role, securityLevel: 3 },
    network: withNet ? { name: "Fixture Net", zone: "corporate", factionName: faction ? `${faction} inc` : null, factionShortName: faction } : null,
    linkedServers: peers.slice(0, 2),
    allNetworkServers: peers,
    employeeRoster: S.getEmployeeRoster(faction),
    secrets: S.generateFactionSecrets(faction, peers),
    existingDirs: ["/home", "/etc"],
  }));

  const out: Record<string, string> = {};
  const rec = (key: string, fn: () => unknown) => { out[key] = hash(det(key, fn)); };

  // Data
  for (const n of ["EMPLOYEE_ROSTERS", "STATIC_CONTENT", "DEFAULT_CONTENT", "LORE_SYSTEM_PROMPT",
    "AMBIENT_SYSTEM_PROMPT", "MISSION_FILES_SYSTEM_PROMPT", "PROVISIONED_OBJECTIVE_TYPES"]) {
    out[`data|${n}`] = hash(S[n]);
  }
  // Functions
  for (const f of FACTIONS) {
    rec(`getEmployeeRoster|${f}`, () => S.getEmployeeRoster(f));
    rec(`generateFactionSecrets|${f}`, () => S.generateFactionSecrets(f, peers));
    rec(`generateEncodedFiles|${f}`, () => S.generateEncodedFiles(ctxFor("database", f)));
    const key = f ?? "none";
    rec(`pickFactionHiddenHint|${key}`, () => S.pickFactionHiddenHint(key));
    rec(`pickFactionTopic|${key}`, () => S.pickFactionTopic(key));
    rec(`pickFactionFileNames|${key}`, () => S.pickFactionFileNames(key));
    rec(`pickFactionMundaneTheme|${key}`, () => S.pickFactionMundaneTheme(key));
    rec(`resolveFactionKey|${f}`, () => S.resolveFactionKey(ctxFor("router", f)));
    for (const role of ROLES) {
      rec(`generateRoleContent|${role}|${f}`, () => S.generateRoleContent(ctxFor(role, f)));
      rec(`buildLorePrompt|${role}|${f}`, () => S.buildLorePrompt(ctxFor(role, f)));
      rec(`buildAmbientPrompt|${role}|${f}`, () => S.buildAmbientPrompt(ctxFor(role, f)));
    }
  }
  rec("resolveFactionKey|no-network", () => S.resolveFactionKey(ctxFor("router", null, false)));
  rec("resolveFactionKey|null-ctx", () => S.resolveFactionKey(null));
  rec("generateRoleContent|no-network", () => S.generateRoleContent(ctxFor("gateway", null, false)));
  for (const n of ["pickLoreQuote", "pickPieceHint", "pickIndependentTheme", "pickAmbientNews", "pickEasterEgg"]) {
    for (let i = 0; i < 5; i++) rec(`${n}|${i}`, () => S[n]());
  }
  rec("buildMissionFilesPrompt", () => S.buildMissionFilesPrompt("Exfil", "Steal the ledger", ["download_file", "delete_logs"], "corporate", "fin-01"));

  // Vacuity guards: a fingerprint of nothing matches nothing-after-the-move.
  check("the matrix is substantial", Object.keys(out).length > 150, `${Object.keys(out).length} cases`);
  check("PRECONDITION: determinism holds (same key twice, same hash)",
    hash(det("probe", () => S.generateRoleContent(ctxFor("dns", "garrison")))) ===
    hash(det("probe", () => S.generateRoleContent(ctxFor("dns", "garrison")))));
  check("PRECONDITION: the seed actually varies output (randomness is not ignored)",
    new Set(Array.from({ length: 5 }, (_, i) => hash(det(`v${i}`, () => S.generateFactionSecrets("cybercorp", peers))))).size > 1);

  if (RECORD) {
    writeFileSync(BASELINE, JSON.stringify(out, null, 1) + "\n");
    console.log(`  recorded ${Object.keys(out).length} cases -> ${BASELINE}`);
  } else {
    check("baseline exists", existsSync(BASELINE));
    const base = JSON.parse(readFileSync(BASELINE, "utf8")) as Record<string, string>;
    const keys = new Set([...Object.keys(base), ...Object.keys(out)]);
    const diff = [...keys].filter((k) => base[k] !== out[k]);
    check("same case set", Object.keys(base).length === Object.keys(out).length, `${Object.keys(base).length} vs ${Object.keys(out).length}`);
    check("every case byte-identical to the baseline", diff.length === 0,
      diff.length ? `${diff.length} differ: ${diff.slice(0, 4).join(", ")}` : `${keys.size} identical`);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
