/**
 * Phase 7 A5 — import-cycle detector and budget.
 *
 * PLAN.md claims a "48-module cycle" and that a fix "closes 36 cycles". Those
 * numbers were UNVERIFIABLE: no madge, no dpdm, nothing in any package.json or
 * eslint config. A number nobody can reproduce is not a measurement, and you
 * cannot reduce what you cannot count — so this counts it.
 *
 * Method: parse every static import in `server/src`, build the module graph,
 * and find strongly connected components with Tarjan's algorithm. An SCC of
 * size > 1 is a set of modules that mutually depend on each other.
 *
 * TYPE-ONLY IMPORTS ARE EXCLUDED, deliberately. `import type` is erased at
 * compile time and creates no runtime edge, so it cannot participate in a
 * require cycle. Counting them would overstate the problem and reward
 * churn that changes nothing — which matters here, because converting value
 * imports to type imports is exactly the A5 fix.
 *
 * Dynamic `await import()` is also excluded: deferring the edge to call time
 * is the codebase's existing cycle-breaking device (CLAUDE.md records the
 * `import type` corollary for precisely this).
 *
 * Run: npx tsx scripts/verify-phase7-a5-cycles.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const SRC = new URL("../src", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Resolve a relative specifier to a real file path, or null if external. */
function resolveSpec(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // node_modules / shared barrel
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, join(base, "index.ts")]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

/** Static, VALUE-level imports only. */
function valueImports(file: string): string[] {
  const src = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  // `import ... from "x"` but NOT `import type ... from "x"`.
  for (const m of src.matchAll(/^\s*import\s+(?!type\b)([\s\S]*?)\s+from\s+["']([^"']+)["']/gm)) {
    const clause = m[1] ?? "";
    const spec = m[2]!;
    // `import { type A, type B } from "x"` is also fully erased.
    const names = clause.replace(/[{}]/g, "").split(",").map((n) => n.trim()).filter(Boolean);
    const allTypeOnly = names.length > 0 && names.every((n) => n.startsWith("type "));
    if (allTypeOnly) continue;
    const r = resolveSpec(file, spec);
    if (r) out.push(r);
  }
  // Bare side-effect imports create an edge too.
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) {
    const r = resolveSpec(file, m[1]!);
    if (r) out.push(r);
  }
  return out;
}

/** Tarjan's SCC. Returns components of size > 1. */
function findCycles(graph: Map<string, string[]>): string[][] {
  let idx = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const comps: string[][] = [];

  function strongconnect(v: string) {
    index.set(v, idx); low.set(v, idx); idx++;
    stack.push(v); onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string;
      do { w = stack.pop()!; onStack.delete(w); comp.push(w); } while (w !== v);
      if (comp.length > 1) comps.push(comp);
    }
  }
  for (const v of graph.keys()) if (!index.has(v)) strongconnect(v);
  return comps;
}

async function main() {
  console.log("\n=== Phase 7 A5 — import cycles ===");

  const files = walk(SRC);
  const graph = new Map<string, string[]>();
  for (const f of files) graph.set(f, valueImports(f));

  const comps = findCycles(graph).sort((a, b) => b.length - a.length);
  const inCycles = new Set(comps.flat());
  const rel = (p: string) => p.slice(SRC.length + 1);

  console.log(`\n  modules scanned:      ${files.length}`);
  console.log(`  cyclic components:    ${comps.length}`);
  console.log(`  modules in a cycle:   ${inCycles.size}`);
  if (comps.length) {
    console.log(`  largest component:    ${comps[0]!.length} modules`);
    for (const c of comps.slice(0, 3)) {
      console.log(`    - ${c.length}: ${c.map(rel).join(", ")}`);
    }
  }

  // A BUDGET, not a target of zero. Cycles here are structural and Phase 7
  // reduces them over several items; the point is that the number cannot grow
  // unnoticed, and that it is now a real measurement rather than folklore.
  const BUDGET = 40;
  console.log("");
  check(
    `modules in a cycle are within budget (${BUDGET})`,
    inCycles.size <= BUDGET,
    `${inCycles.size} in cycles across ${comps.length} component(s)`,
  );

  // Positive control: the detector must be able to find a cycle at all. A
  // clean report from a broken parser is the failure mode that matters.
  {
    const a = "/virtual/a.ts", b = "/virtual/b.ts";
    const synthetic = new Map<string, string[]>([[a, [b]], [b, [a]]]);
    check(
      "POSITIVE CONTROL: the detector finds a synthetic 2-cycle",
      findCycles(synthetic).length === 1,
      "a zero-cycle report is meaningless if the algorithm cannot detect one",
    );
  }

  // The A5 mechanical items, asserted as properties rather than counts.
  console.log("");
  const iface = readFileSync(join(SRC, "services/commandModules/interface.ts"), "utf8");
  check(
    "commandModules/interface.ts has no value imports",
    !/^import\s+(?!type\b)/m.test(iface),
    "it is a type declaration module; a value import there pulls the whole barrel in",
  );

  const all = files.map((f) => readFileSync(f, "utf8")).join("\n");
  const dynTokens = (all.match(/await import\(\s*["'][^"']*di\/tokens["']\s*\)/g) || []).length;
  check(
    "no dynamic `await import(di/tokens)` remains",
    dynTokens === 0,
    `${dynTokens} left — tokens.ts has zero imports and 60 plain-string exports, so there is no cycle to defer`,
  );

  const rawGetService = (all.match(/getService<[^>]*>\(\s*["'][A-Za-z]/g) || []).length;
  check(
    "no raw-string getService calls remain",
    rawGetService === 0,
    `${rawGetService} left — a typo'd string resolves to undefined at runtime instead of failing to compile`,
  );

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
