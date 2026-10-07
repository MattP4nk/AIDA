/**
 * Phase 7 A8 — Terminal.svelte's handleSubmit, decomposed.
 *
 * handleSubmit was 292 lines. The store-only and pure parts moved to
 * client/src/services/commandResult.ts — dialog routing (five near-identical
 * `if` blocks), challenge state from an HTTP result (~70 lines), and the
 * suggested-command fallback — leaving 155 lines that assign component state,
 * where Svelte tracks it.
 *
 * The client has no test runner, and the golden master drives server
 * commands. So this drives the extracted module directly (it takes its stores
 * as a parameter precisely so it can run without a browser), and proves
 * applyChallengeState is the original block moved verbatim.
 *
 * Run: npx tsx scripts/verify-phase7-a8-terminal-submit.ts
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
/** Just enough of svelte/store: applyChallengeState only calls set/update. */
function store<T>(v: T) {
  let value = v;
  return { set: (n: T) => { value = n; }, update: (f: (x: T) => T) => { value = f(value); }, subscribe: () => () => {}, get: () => value };
}

async function main() {
  console.log("\n=== A8 — Terminal handleSubmit decomposition ===");
  // Load the module the way Vite does: BUNDLED, with shared/types inlined.
  // Imported directly, Node treats shared/types/index.ts as CommonJS (no
  // package.json there) and its `export * from "./game"` hides ReservedPID
  // from an ESM importer — a harness-only interop gap; the app bundles fine.
  const { build } = await import("esbuild");
  const root = new URL("../..", import.meta.url).pathname;
  const bundled = await build({
    stdin: {
      contents: 'export * from "./client/src/services/commandResult.ts"; export { ReservedPID } from "./shared/types/index.ts";',
      resolveDir: root, loader: "ts",
    },
    bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent",
  });
  const code = bundled.outputFiles[0]!.text;
  const M: any = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  const { ReservedPID } = M;

  console.log("\nTS-1 — dialog routing: every alias, case-insensitive, args only where they were passed");
  {
    const cases: Array<[string, string | null, boolean]> = [
      ["shop", "shop", false], ["SHOP", "shop", false],
      ["inventory", "equipment", false], ["equipment", "equipment", false], ["gear", "equipment", false], ["scripts", "equipment", false],
      ["msg alice hi", "chat", true], ["message", "chat", true], ["chat", "chat", true], ["dm bob", "chat", true],
      ["mail", "mail", false], ["inbox", "mail", false], ["messages", "mail", false],
      ["forum list", "forum", true], ["forums", "forum", true],
      ["scan", null, false], ["connect 10.0.0.1", null, false], ["shopping", null, false], ["  mail  ", "mail", false],
    ];
    const bad = cases.filter(([cmd, dialog, passes]) => {
      const r = M.resolveDialogCommand(cmd);
      if (dialog === null) return r !== null;
      return !r || r.dialog !== dialog || (passes ? JSON.stringify(r.data?.command) !== JSON.stringify(cmd.trim().split(/\s+/)) : r.data !== undefined);
    });
    check(`all ${cases.length} routes behave as the five original if-blocks did`, bad.length === 0, bad.map((b) => b[0]).join(", "));
  }

  console.log("\nTS-2 — challenge state from an HTTP result");
  {
    const mk = () => ({ activeProcesses: store<any[]>([]), activeConnectionSession: store<any>(null), activeHackSession: store<any>(null), activeFileChallenge: store<any>(null) });
    let s = mk();
    M.applyChallengeState({ connectionSessionId: "c1", connectionChallenge: { kind: "x" }, targetIp: "10.0.0.5" }, s as any);
    check("connection start: session set, ProcessBar entry with the default 45s eta",
      s.activeConnectionSession.get()?.sessionId === "c1" &&
      s.activeProcesses.get().some((p) => p.pid === ReservedPID.CONNECTION_CHALLENGE && p.eta === 45));
    check("a connection start is NOT mistaken for a hack start", s.activeHackSession.get() === null);
    M.applyChallengeState({ connectionResolved: true }, s as any);
    check("connection resolved: session and process cleared",
      s.activeConnectionSession.get() === null && s.activeProcesses.get().length === 0);

    s = mk();
    M.applyChallengeState({ sessionId: "h1", targetIp: "10.0.0.6", totalLayers: 3, challenge: { q: 1 } }, s as any);
    check("hack start: layer 0 of 3", s.activeHackSession.get()?.currentLayer === 0 && s.activeHackSession.get()?.totalLayers === 3);
    M.applyChallengeState({ nextChallenge: { q: 2 } }, s as any);
    check("next layer advances and swaps the challenge",
      s.activeHackSession.get()?.currentLayer === 1 && s.activeHackSession.get()?.challenge?.q === 2);
    M.applyChallengeState({ hackResolved: true }, s as any);
    check("hack resolved: cleared", s.activeHackSession.get() === null && s.activeProcesses.get().length === 0);
    M.applyChallengeState({ nextChallenge: { q: 9 } }, s as any);
    check("a stray nextChallenge with no session stays null", s.activeHackSession.get() === null);

    s = mk();
    M.applyChallengeState({ fileAccessSessionId: "f1", fileAccessType: "sweep", targetFile: "a.txt" }, s as any);
    check("file challenge start", s.activeFileChallenge.get()?.type === "sweep" &&
      s.activeProcesses.get().some((p) => p.pid === ReservedPID.FILE_CHALLENGE && p.description === "sweep challenge"));
    M.applyChallengeState({ fileAccessResolved: true }, s as any);
    check("file challenge resolved", s.activeFileChallenge.get() === null && s.activeProcesses.get().length === 0);
    M.applyChallengeState(undefined, s as any);
    check("no data is a no-op", s.activeProcesses.get().length === 0);
  }

  console.log("\nTS-3 — suggested command");
  {
    const known = ["scan", "connect", "crack"];
    check("the server's suggestion wins", M.extractSuggestedCommand({ suggestedCommand: "scan", output: "Try: crack x" }, known) === "scan");
    check("regex fallback, known first word", M.extractSuggestedCommand({ output: "Done.\nTry: connect 10.0.0.1" }, known) === "connect 10.0.0.1");
    check("regex fallback over array output", M.extractSuggestedCommand({ output: ["a", "Use: crack file.enc"] }, known) === "crack file.enc");
    check("an unknown first word is refused (file content like 'report to...')",
      M.extractSuggestedCommand({ output: "Submit: report to the admin" }, known) === null);
    check("no match leaves the suggestion alone (null)", M.extractSuggestedCommand({ output: "nothing here" }, known) === null);
  }

  console.log("\nTS-4 — applyChallengeState is the original block, moved verbatim");
  {
    const root = new URL("../..", import.meta.url).pathname;
    let orig = "";
    try {
      orig = execSync("git show 027963f:client/src/components/Terminal.svelte", { cwd: root, encoding: "utf8" });
    } catch { /* reported below */ }
    check("PRECONDITION: the pre-split Terminal.svelte is readable from git", orig.length > 0);
    const a = orig.indexOf("// Handle challenge starts from HTTP results (connection/hack)");
    const b = orig.indexOf("// Display command result (with typewriter if enabled)");
    const norm = (t: string) => t
      .replace(/^\s*const \{ activeProcesses \} = await import\("\.\.\/services\/socket"\);\n/gm, "")
      .replace(/result\.data/g, "data")
      .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
    const before = norm(orig.slice(a, b));
    const src = readFileSync(new URL("../../client/src/services/commandResult.ts", import.meta.url).pathname, "utf8");
    const s0 = src.indexOf("// Handle challenge starts from HTTP results (connection/hack)");
    const s1 = src.indexOf("\n}\n", s0);
    const after = norm(src.slice(s0, s1));
    check("identical after removing the five redundant dynamic imports and renaming result.data -> data",
      a > 0 && before === after, before === after ? `${before.split("\n").length} lines` : "differs");
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
