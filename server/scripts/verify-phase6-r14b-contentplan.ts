/**
 * Phase 6 R14b — validateContentPlan bounds and null-safety.
 *
 * The whole path check was `typeof d.path === "string" && d.path.startsWith("/")`:
 * no length bound, no depth bound, no `..` rejection — despite
 * `utils/pathSanitizer.ts` existing and being used by fileService (9x
 * isPathSafe) and commandModules/helpers.ts. It simply was not applied on the
 * AI path. Arrays were unbounded too: only per-item CONTENT was capped
 * (`slice(0, 3000)`), so a model returning 100k entries passed through whole
 * and `applyContentPlanViaPrisma`'s `ensureDir` would upsert its way through
 * every segment of every one.
 *
 * And a null element threw a TypeError OUT of the validator rather than
 * returning null, so a malformed plan crashed its caller instead of being
 * rejected.
 *
 * Run: npx tsx scripts/verify-phase6-r14b-contentplan.ts
 */
import { validateContentPlan, validateForumPosts } from "../src/utils/aiOutputValidator";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const file = (path: string) => ({ path, content: "some content" });

async function main() {
  console.log("\n=== Phase 6 R14b — content plan validation ===");

  // ── Positive control FIRST: a normal plan must survive ───────────────
  console.log("\nR14b-1 — a legitimate plan is unaffected");
  {
    const ok = validateContentPlan({
      directories: [{ path: "/var/log" }, { path: "/home/operator/docs" }],
      files: [file("/var/log/auth.log"), file("/home/operator/docs/notes.txt")],
    });
    check("it validates", !!ok, ok ? "accepted" : "REJECTED — the bounds are too tight");
    check("both directories survive", ok?.directories.length === 2, `${ok?.directories.length}`);
    check("both files survive", ok?.files.length === 2, `${ok?.files.length}`);
    check(
      "paths are preserved verbatim",
      ok?.files[0]?.path === "/var/log/auth.log",
      ok?.files[0]?.path,
    );
  }

  // ── Traversal ────────────────────────────────────────────────────────
  console.log("\nR14b-2 — traversal and malformed paths are rejected");
  {
    for (const bad of [
      "/../../etc/passwd",
      "/var/../../../root/.ssh/id_rsa",
      "/var/log/../../..",
      "/tmp/\0null",
      "//evil",
      "relative/no/leading/slash",
    ]) {
      const r = validateContentPlan({ directories: [], files: [file(bad)] });
      check(`rejected: ${JSON.stringify(bad)}`, r === null || r.files.length === 0,
        r ? `${r.files.length} file(s) accepted` : "plan rejected");
    }
    check(
      "a path with a literal '..' segment does not reach the writer",
      validateContentPlan({ directories: [{ path: "/a/../b" }], files: [] }) === null,
      "the parentId-keyed FS made this a directory NAMED '..' — storage luck, not validation",
    );
  }

  // ── Bounds ───────────────────────────────────────────────────────────
  console.log("\nR14b-3 — arrays, depth and length are bounded");
  {
    const huge = validateContentPlan({
      directories: Array.from({ length: 10_000 }, (_, i) => ({ path: `/d${i}` })),
      files: Array.from({ length: 10_000 }, (_, i) => file(`/f${i}.txt`)),
    });
    check("10k directories are capped", (huge?.directories.length ?? 0) <= 100, `${huge?.directories.length}`);
    check("10k files are capped", (huge?.files.length ?? 0) <= 100, `${huge?.files.length}`);
    check("but the plan is still usable, not discarded", !!huge && huge.files.length > 0);

    const deep = validateContentPlan({ directories: [], files: [file("/" + "a/".repeat(50) + "f.txt")] });
    check("an absurdly deep path is rejected", deep === null,
      "ensureDir upserts once per segment");

    const long = validateContentPlan({ directories: [], files: [file("/" + "x".repeat(600))] });
    check("an over-long path is rejected", long === null, "no length bound existed at all");

    const depth8 = validateContentPlan({ directories: [], files: [file("/a/b/c/d/e/f/g/h")] });
    check(
      "a path at the depth limit is still ACCEPTED",
      !!depth8 && depth8.files.length === 1,
      "deepest seeded path is 3 segments — the cap must not bite real content",
    );
  }

  // ── Null elements ────────────────────────────────────────────────────
  console.log("\nR14b-4 — null elements are rejected, not thrown on");
  {
    for (const [label, plan] of [
      ["null in directories", { directories: [null], files: [file("/ok.txt")] }],
      ["null in files", { directories: [], files: [null] }],
      ["undefined in files", { directories: [], files: [undefined] }],
      ["mixed null and valid", { directories: [null, { path: "/real" }], files: [file("/ok.txt")] }],
    ] as const) {
      let threw = false;
      let result: any = undefined;
      try {
        result = validateContentPlan(plan as any);
      } catch {
        threw = true;
      }
      check(`${label}: returns instead of throwing`, !threw,
        threw ? "TypeError escaped the validator and crashed the caller" : "clean return");
      if (label === "mixed null and valid") {
        check("  and the valid entry survives", result?.directories.length === 1, `${result?.directories.length}`);
      }
    }
  }

  // ── The sibling validator ────────────────────────────────────────────
  console.log("\nR14b-5 — validateForumPosts has the same guard");
  {
    let threw = false;
    try {
      validateForumPosts([null, { authorHandle: "a", title: "abc", content: "0123456789x" }] as any);
    } catch {
      threw = true;
    }
    check("a null post does not throw out of the validator", !threw);

    const ok = validateForumPosts([
      { authorHandle: "ghost", title: "hello", content: "0123456789 body text" },
    ] as any);
    check("POSITIVE CONTROL: a valid post still validates", !!ok && ok.length === 1,
      ok ? `${ok.length}` : "REJECTED");
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
