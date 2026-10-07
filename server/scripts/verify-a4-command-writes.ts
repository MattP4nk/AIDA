/**
 * A4 — command modules write the database only through services.
 *
 * Commands held 30 direct `db.client.<model>.<write>` calls. Each bypassed
 * whatever its model's owning service enforces, and reading them one by one
 * found real defects: a demoted admin keeping admin on live sockets, a
 * password reset leaving an attacker's session working, `admin mute` never
 * enforced, a spent item never reaching the client.
 *
 * A RATCHET: the count may only go down. Lower MAX as each batch lands; the
 * goal is 0. Counted on comment-stripped source, so prose quoting an old
 * write does not count.
 *
 * Run: npx tsx scripts/verify-a4-command-writes.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments";

const MAX = 13;

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
// String-aware: the regex idiom swallowed 322 lines of this very directory.
const strip = stripComments;
const WRITE = /\bdb\.client\.([a-zA-Z]+)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;

const dir = new URL("../src/services/commandModules", import.meta.url).pathname;
const hits: string[] = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
  for (const m of strip(readFileSync(join(dir, f), "utf8")).matchAll(WRITE)) hits.push(`${f}: ${m[1]}.${m[2]}`);
}

console.log("\n=== A4 — direct database writes in command modules ===");
// POSITIVE CONTROL: the pattern sees a write in the form it counts, and not in a comment.
const probe = strip('await context.db.client.user.update({});\n// db.client.user.delete()');
check("POSITIVE CONTROL: the pattern counts code and skips comments", [...probe.matchAll(WRITE)].length === 1);
// The trap that hid two writes: `/*` inside a STRING is not a comment.
const trap = strip('const p = "x/*/proof.log";\nawait context.db.client.bounty.update({});\n/* real */');
check("POSITIVE CONTROL: a '/*' inside a string does not swallow code", [...trap.matchAll(WRITE)].length === 1);
check(`at most ${MAX} direct writes remain (ratchet — only ever lower it)`, hits.length <= MAX, `${hits.length} found`);
check("the ratchet is tight (lower MAX to the current count)", hits.length === MAX,
  hits.length < MAX ? `${hits.length} < ${MAX}: lower MAX` : `${hits.length}`);
for (const h of hits) console.log(`        ${h}`);
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exitCode = fail ? 1 : 0;
