/**
 * A4 — command modules write the database only through services.
 *
 * Commands held 30 direct `db.client.<model>.<write>` calls. Each bypassed
 * whatever its model's owning service enforces, and reading them one by one
 * found real defects: a demoted admin keeping admin on live sockets, a
 * password reset leaving an attacker's session working, `admin mute` never
 * enforced, a spent item never reaching the client.
 *
 * Reported 0 on 2026-10-07 — falsely: it matched only `db.client.<model>`,
 * and four writes went through a `$transaction` callback's `tx`. MAX stays 0
 * once those are out: a command module that needs to write calls a service. Counted on comment-stripped source, so prose quoting
 * an old write does not count.
 *
 * Run: npx tsx scripts/verify-a4-command-writes.ts
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "./lib/strip-comments";

const MAX = 0;

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
// String-aware: the regex idiom swallowed 322 lines of this very directory.
const strip = stripComments;
const WRITE = /\b(?:db\.client|tx)\s*\.\s*([a-zA-Z]+)\s*\.\s*(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/g;

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
// And a chain split across lines — two bounty deletes hid that way, written
// `context.db.client.fileSystemNode` NEWLINE `.delete(...)`.
const chained = strip("await context.db.client.fileSystemNode\n  .delete({ where: { id } })\n  .catch(() => {});");
check("POSITIVE CONTROL: a write chained across lines is counted", [...chained.matchAll(WRITE)].length === 1);
// And through a transaction handle — four home-defense writes hid as
// `tx.playerProgress.updateMany` callbacks after this check reported 0.
const viaTx = strip("await context.db.client.$transaction(async (tx) => tx.playerProgress\n  .updateMany({}));");
check("POSITIVE CONTROL: a write through a transaction handle is counted", [...viaTx.matchAll(WRITE)].length === 1);
check(`at most ${MAX} direct writes remain (ratchet — only ever lower it)`, hits.length <= MAX, `${hits.length} found`);
check("the ratchet is tight (lower MAX to the current count)", hits.length === MAX,
  hits.length < MAX ? `${hits.length} < ${MAX}: lower MAX` : `${hits.length}`);
for (const h of hits) console.log(`        ${h}`);

// A4 part 2, READS: any database handle at all. The end state is no `db` on
// CommandContext, at which point the compiler enforces this; until then, a
// second ratchet. A bare `db.client` passed to a helper counts too.
const READS_MAX = 133;
const ANY = /\bdb\.client\b/g;
const any: Record<string, number> = {};
let total = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
  const n = [...strip(readFileSync(join(dir, f), "utf8")).matchAll(ANY)].length;
  if (n) { any[f] = n; total += n; }
}
const bare = strip("await shouldRequireToken(db.client, userId);\n// db.client.user.findMany()");
check("POSITIVE CONTROL: a bare handle counts, a comment does not", [...bare.matchAll(ANY)].length === 1);
check(`at most ${READS_MAX} database handles remain in command modules (ratchet)`, total <= READS_MAX, `${total} found`);
check("the read ratchet is tight", total === READS_MAX, total < READS_MAX ? `${total} < ${READS_MAX}: lower READS_MAX` : `${total}`);
for (const [f, n] of Object.entries(any).sort((a, b) => b[1] - a[1])) console.log(`        ${f}: ${n}`);
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exitCode = fail ? 1 : 0;
