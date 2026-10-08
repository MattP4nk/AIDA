/**
 * The comment stripper every source-matching harness relies on.
 *
 * A harness that matches source must not match the comment that explains a
 * fix (CLAUDE.md §2) — and must not lose CODE either. The regex idiom the
 * harnesses used, `.replace(/\/\*[\s\S]*?\*\//g, "")…`, is not string-aware:
 * a "/*" inside a string swallowed everything to the next "*\/" (138 real
 * lines of playerInfoCommands, 2026-10-07). All harnesses now use
 * scripts/lib/strip-comments.ts. This pins what it must and must not remove,
 * for .ts and for .svelte (whose markup is not TypeScript).
 *
 * Run: npx tsx scripts/verify-strip-comments.ts
 */
import { stripComments } from "./lib/strip-comments";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

console.log("\n=== stripComments ===");
{
  const ts = 'const p = "x/*/proof.log";\nawait run(p); // tail\n/* block */\nconst t = `a ${b /* in tpl */} c`;\nconst u = "http://x";\n';
  const out = stripComments(ts);
  check("TS: a '/*' inside a string keeps the code after it", out.includes("await run(p);"));
  check("TS: line, block and template-interpolation comments are removed",
    !out.includes("tail") && !out.includes("block") && !out.includes("in tpl"));
  check("TS: '//' inside a string is not a comment", out.includes('"http://x"'));
  check("TS: line count is preserved", out.split("\n").length === ts.split("\n").length);
}
{
  const sv = '<script lang="ts">\n  const a = "<!-- not a comment -->"; // gone\n  /* also gone */\n  socket.on("x", f);\n</script>\n<a href="http://example.com">link</a>\n<p>docs at http://example.com/help for more</p>\n<!-- markup comment -->\n<p>{a}</p>\n';
  const out = stripComments(sv, "Comp.svelte");
  check("Svelte: script code survives", out.includes('socket.on("x", f);'));
  check("Svelte: script comments are removed", !out.includes("gone"));
  check("Svelte: '<!--' inside a script STRING is untouched", out.includes('"<!-- not a comment -->"'));
  check("Svelte: markup '//' (a URL) is not a comment",
    out.includes('href="http://example.com">link</a>') && out.includes("docs at http://example.com/help for more</p>"));
  check("Svelte: markup HTML comments are removed", !out.includes("markup comment"));
  check("Svelte: line count is preserved", out.split("\n").length === sv.split("\n").length);
  // NEGATIVE CONTROL: parsed as TypeScript, a BARE URL in markup text reads
  // as a label plus a `//` comment. (A quoted one, in an attribute, is a
  // string literal and survives either way — the first version of this
  // control used that, and failed, which is how the premise was caught.)
  const asTs = stripComments(sv, "Comp.ts");
  check("CONTROL: treating .svelte as .ts DOES blank a bare markup URL (why the mode exists)",
    !asTs.includes("docs at http://example.com/help for more</p>"));
}
console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
process.exitCode = fail ? 1 : 0;
