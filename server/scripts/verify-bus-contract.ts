/**
 * The in-process event bus contract — the twin of check-socket-contract.ts.
 *
 * Services extend EventEmitter and `this.emit("x", ...)`; consumers subscribe
 * with `.on` / `.once` or gameStateManager's `subscribe(emitter, "x", ...)`.
 * dynamicContentService additionally registers hooks that fire only when
 * something calls `processEvent("x", ...)`.
 *
 * An audit on 2026-10-07 found 25 emitted-but-unheard bus events and 3 hooks
 * nothing fed. Triage: 7 were heard all along (the first scan knew only
 * `.on(`), 16 were dead or redundant emits — deleted — and 4 were real
 * missing consumers — wired: a discovered backdoor now logs on the server it
 * was found on, a conquered vault marks DarkNet servers, a file honeypot
 * writes its trap log, and story posts reach the story ledger.
 *
 * FAILS on any gap; there is no allowlist. A gap is either a dead emit to
 * delete or a missing consumer to wire — see CLAUDE.md §1b.
 *
 * LIMITATION, stated rather than hidden: matching is by EVENT NAME. It cannot
 * tell that a listener sits on the wrong emitter (the hackService split moved
 * `bounty:posted` to hackService.countermeasures). For index.ts that is
 * covered by verify-phase7-a8-bootstrap, which snapshots (emitter, event)
 * pairs.
 *
 * Run: npx tsx scripts/verify-bus-contract.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripComments } from "./lib/strip-comments";

const SRC = new URL("../src", import.meta.url).pathname;
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
/**
 * Strip comments — block, whole-line AND trailing. CLAUDE.md's usual idiom
 * drops only lines that START with `//`, so `f(); // this.emit("x")` would
 * still count; this harness's own positive control caught that. A `//` right
 * after `:` or a quote is left alone so "http://..." strings survive.
 */
// Parser-based: the regex idioms are not string-aware (see lib/strip-comments.ts).
const strip = (s: string) => stripComments(s);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : e.endsWith(".ts") ? [p] : [];
  });
}

const EVT = String.raw`[a-z_]+(?::[a-zA-Z_-]+)?`;
/** Receivers that are sockets, not the service bus. */
const SOCKETISH = /(?:^|\.)(socket|io|client|s|sock|ioClient)$/;

interface Extracted { emits: Map<string, Set<string>>; listens: Map<string, Set<string>>; hooks: Set<string>; forwards: Set<string> }

/** Pure extraction over (file, source) pairs, so a positive control can feed it synthetic code. */
function extract(files: Array<[string, string]>): Extracted {
  const out: Extracted = { emits: new Map(), listens: new Map(), hooks: new Set(), forwards: new Set() };
  const add = (m: Map<string, Set<string>>, k: string, v: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(v);
  for (const [file, raw] of files) {
    if (file.includes("sockets/")) continue; // socket handlers: covered by the socket contract
    const s = strip(raw);
    for (const m of s.matchAll(new RegExp(String.raw`\bthis\.emit\(\s*"(${EVT})"`, "g"))) add(out.emits, m[1]!, file);
    // receiver.on("x") / .once("x")
    for (const m of s.matchAll(new RegExp(String.raw`([\w.!?]+)\.(?:on|once)\(\s*"(${EVT})"`, "g"))) {
      if (!SOCKETISH.test(m[1]!)) add(out.listens, m[2]!, file);
    }
    // subscribe(emitter, "x", ...)
    for (const m of s.matchAll(new RegExp(String.raw`\bsubscribe\(\s*[\w.!?]+\s*,\s*"(${EVT})"`, "g"))) add(out.listens, m[1]!, file);
    // for (const v of ["a", "b"]) { ... .on(v ...) / subscribe(e, v ...) }
    for (const m of s.matchAll(/for\s*\(\s*const\s+(\w+)\s+of\s+\[([^\]]*)\]\s*\)\s*\{([\s\S]{0,400}?)\n\s*\}/g)) {
      const v = m[1]!, body = m[3]!;
      const usesVar = new RegExp(String.raw`(?:\.(?:on|once)\(\s*${v}\b|\bsubscribe\(\s*[\w.!?]+\s*,\s*${v}\b)`).test(body);
      if (!usesVar) continue;
      for (const e of m[2]!.matchAll(new RegExp(String.raw`"(${EVT})"`, "g"))) add(out.listens, e[1]!, file);
    }
    for (const m of s.matchAll(new RegExp(String.raw`registerHook\(\{\s*event:\s*"(${EVT})"`, "g"))) out.hooks.add(m[1]!);
    for (const m of s.matchAll(new RegExp(String.raw`\bprocessEvent\(\s*"(${EVT})"`, "g"))) out.forwards.add(m[1]!);
  }
  return out;
}

async function main() {
  console.log("\n=== The in-process event bus contract ===");

  // ── Positive control: the extractor sees every form it claims to ──
  const ctl = extract([
    ["a.ts", 'class A { f() { this.emit("x:one", {}); this.emit("x:two", {}); this.emit("x:three", {}); } }'],
    ["b.ts", 'svc.on("x:one", h);\nthis.subscribe(svc, "x:two", h);\nfor (const evt of ["x:three"]) {\n  this.subscribe(svc, evt, h);\n}\nsocket.on("x:four", h);'],
    ["c.ts", 'this.registerHook({ event: "h:one", generator }); dc.processEvent("h:one", d); // this.emit("x:ghost")'],
  ]);
  check("POSITIVE CONTROL: .on, subscribe() and loop-over-literals are all seen",
    ["x:one", "x:two", "x:three"].every((e) => ctl.listens.has(e)), [...ctl.listens.keys()].join(", "));
  check("POSITIVE CONTROL: a socket listener is NOT counted as a bus listener", !ctl.listens.has("x:four"));
  check("POSITIVE CONTROL: an emit inside a comment is not counted", !ctl.emits.has("x:ghost"));
  check("POSITIVE CONTROL: hooks and forwards are paired", ctl.hooks.has("h:one") && ctl.forwards.has("h:one"));

  const files = walk(SRC).map((f) => [relative(SRC, f), readFileSync(f, "utf8")] as [string, string]);
  const x = extract(files);

  // Vacuity guards — a broken extractor reports a clean contract.
  check("PRECONDITION: bus emits were found", x.emits.size > 15, `${x.emits.size} events`);
  check("PRECONDITION: bus listeners were found", x.listens.size > 15, `${x.listens.size} events`);
  check("PRECONDITION: dynamic-content hooks were found", x.hooks.size > 10, `${x.hooks.size} hooks`);

  const where = (m: Map<string, Set<string>>, e: string) => [...(m.get(e) ?? [])].join(", ");
  const unheard = [...x.emits.keys()].filter((e) => !x.listens.has(e)).sort();
  const unsourced = [...x.listens.keys()].filter((e) => !x.emits.has(e)).sort();
  const unfed = [...x.hooks].filter((e) => !x.forwards.has(e)).sort();
  const hookless = [...x.forwards].filter((e) => !x.hooks.has(e)).sort();

  check("every bus emit has a listener", unheard.length === 0,
    unheard.map((e) => `${e} (${where(x.emits, e)})`).join("; ") || `${x.emits.size} heard`);
  check("every bus listener has an emitter", unsourced.length === 0,
    unsourced.map((e) => `${e} (${where(x.listens, e)})`).join("; ") || `${x.listens.size} sourced`);
  check("every dynamic-content hook is fed by processEvent", unfed.length === 0, unfed.join(", ") || `${x.hooks.size} fed`);
  check("every processEvent call has a hook to fire", hookless.length === 0, hookless.join(", ") || `${x.forwards.size} hooked`);

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
