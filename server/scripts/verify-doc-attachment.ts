/**
 * A doc comment documents the declaration directly below it — so it must be
 * directly ABOVE that declaration, not above another doc comment.
 *
 * Review finding (2026-10-08): inserting a new method between an existing
 * JSDoc block and the function it documented left the old block sitting on
 * the NEW method. `getServer`'s "@param serverId … @returns Server details"
 * showed up on `findBasicByIp(ipAddress)`, `hasItem`'s doc on `heldItems`,
 * `checkServerFragment`'s on `brickFragment` — and the real functions lost
 * theirs. The same shape had built up across the codebase: 29 cases, two of
 * them stale AND inverted (a "static is the fallback" doc on a function whose
 * static tier always runs first — CLAUDE.md bug shape #8).
 *
 * The signature of the defect is a JSDoc block immediately followed by
 * another JSDoc block. A group header that intentionally sits above
 * per-member docs is written as a plain `/*` or `//` comment instead.
 *
 * Run: npx tsx scripts/verify-doc-attachment.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

const DOC_ON_DOC = /\/\*\*(?:(?!\*\/)[\s\S])*?\*\/[ \t]*\n[ \t]*\/\*\*/g;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

console.log("\n=== Doc comments sit on the declaration they document ===");
const probe = "/**\n * Get server by ID\n */\n/** new method */\nfunction findBasicByIp() {}\n/** fine */\nfunction ok() {}\n";
check("POSITIVE CONTROL: a doc stacked on a doc is detected, a single doc is not",
  [...probe.matchAll(DOC_ON_DOC)].length === 1);

const root = new URL("../src", import.meta.url).pathname;
const files = walk(root);
check("PRECONDITION: the source tree was scanned", files.length > 100, `${files.length} files`);
const hits: string[] = [];
for (const f of files) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(DOC_ON_DOC)) {
    hits.push(`${f.slice(root.length + 1)}:${s.slice(0, m.index).split("\n").length}`);
  }
}
check("no doc comment is stacked on another (one has lost its declaration)", hits.length === 0, hits.slice(0, 5).join(", ") || "none");
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exitCode = fail ? 1 : 0;
