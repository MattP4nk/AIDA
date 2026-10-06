/**
 * Socket group B — events the server sent and the client ignored.
 *
 * Orphan audit: 37 server emits had no client listener. Eleven were classed
 * MISSING FEATURE — the player should react and cannot. These six are wired:
 * each carried the ONLY signal for something the player needs to know, and
 * was discarded on arrival.
 *
 * Run: npx tsx scripts/verify-socket-group-b.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ROOT = new URL("../..", import.meta.url).pathname;
function walk(d: string, exts: string[]): string[] {
  const o: string[] = [];
  for (const e of readdirSync(d)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = join(d, e);
    if (statSync(p).isDirectory()) o.push(...walk(p, exts));
    else if (exts.some(x => p.endsWith(x))) o.push(p);
  }
  return o;
}
const read = (rel: string, exts: string[]) =>
  walk(join(ROOT, rel), exts).map(f => strip(readFileSync(f, "utf8"))).join("\n");

const WIRED = [
  ["security:warning", "honeypot tripped — the register path said only 'Successfully registered'"],
  ["reputation:changed", "every faction standing change, including rivalry spillover"],
  ["moderation:flagged", "why the author's content vanished"],
  ["force:disconnect", "the admin's reason for a kick or ban"],
  ["connection:refused", "why the UI froze at the socket cap"],
  ["terminal:error", "a failed tab op that otherwise looks ignored"],
] as const;

async function main() {
  console.log("\n=== Socket group B — wired listeners ===");
  const serverSrc = read("server/src", [".ts"]);
  const clientSrc = read("client/src", [".ts", ".svelte"]);
  const contract = readFileSync(join(ROOT, "shared/types/socketEvents.ts"), "utf8");

  console.log("\nGB-1 — each wired event now has BOTH ends");
  for (const [ev, why] of WIRED) {
    const emitted = new RegExp(`emit\\(\\s*["'\`]${ev.replace(":", "\\:")}["'\`]`).test(serverSrc);
    const heard = new RegExp(`on\\(\\s*["'\`]${ev.replace(":", "\\:")}["'\`]`).test(clientSrc);
    check(`${ev}: emitted AND listened`, emitted && heard, emitted ? (heard ? why : "NO LISTENER") : "NOT EMITTED");
  }

  console.log("\nGB-2 — the listeners do something a player can perceive");
  {
    check(
      "the two disconnect events surface an error, not a notification",
      /on\("force:disconnect"[\s\S]{0,400}?socketError\.set/.test(clientSrc) &&
        /on\("connection:refused"[\s\S]{0,300}?socketError\.set/.test(clientSrc),
      "the socket is closing — a toast the user never sees would be useless",
    );
    check(
      "security:warning is high or critical priority",
      /on\("security:warning"[\s\S]{0,500}?priority: data\.severity === "critical" \? "critical" : "high"/.test(clientSrc),
      "a honeypot warning at normal priority is a honeypot warning nobody reads",
    );
    check(
      "reputation:changed ignores a zero delta",
      /on\("reputation:changed"[\s\S]{0,400}?if \(amount === 0\) return;/.test(clientSrc),
      "otherwise every no-op rep write becomes a notification",
    );
    check(
      "moderation:flagged passes the server's reason through",
      /on\("moderation:flagged"[\s\S]{0,400}?data\.reason/.test(clientSrc),
      "the reason is the entire point — the content already vanished",
    );
  }

  console.log("\nGB-3 — the contract records them");
  for (const [ev] of WIRED) {
    if (ev === "moderation:flagged") continue; // already declared in A3
    check(`${ev} declared in ServerToClientEvents`, contract.includes(`"${ev}"`), "");
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}
main().catch(e => { console.error("HARNESS ERROR:", e); process.exit(1); });
