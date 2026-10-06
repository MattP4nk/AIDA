/**
 * Phase 7 A3 — socket contract check.
 *
 * The command golden master (`characterize-commands.ts`) pins command OUTPUT.
 * It cannot see socket events at all, so this is the second half of the net:
 * it reads the real emit/listen sites out of the source and asserts the
 * contract in `shared/types/socketEvents.ts` still describes them.
 *
 * Two real bugs are pinned here as regressions:
 *
 *  A3-1  HANDSHAKE. The client emitted `authenticated` with no acknowledgement
 *        callback, so `handleAuthentication` took its else-branch and replied
 *        with `authentication:complete` — an event nothing in the client
 *        listens for. The client listened for `authenticated`, which the
 *        server never emits. The success signal was never delivered; the
 *        handshake only appeared to work because the server's side effects
 *        happen regardless.
 *
 *  A3-2  ARRAY OUTPUT (U5). `command:result.output` is `string | string[]`.
 *        The REST path normalises arrays (Terminal.svelte), the socket path
 *        does not — so `hackCommands` put an array into a field the client
 *        reads as a string.
 *
 * Run: npx tsx scripts/verify-phase7-a3-socket-contract.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  KNOWN_ORPHANED_EVENTS,
} from "../../shared/types/socketEvents";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

const ROOT = new URL("../..", import.meta.url).pathname;

function readAll(rel: string, exts: string[]): string {
  return walk(join(ROOT, rel), exts).map((f) => strip(readFileSync(f, "utf8"))).join("\n");
}

async function main() {
  console.log("\n=== Phase 7 A3 — socket contract ===");

  const serverSrc = readAll("server/src", [".ts"]);
  const clientSrc = readAll("client/src", [".ts", ".svelte"]);

  // ── A3-1: the handshake ──────────────────────────────────────────────
  console.log("\nA3-1 — the authentication handshake completes");
  {
    // WHITESPACE-TOLERANT ON BOTH SIDES OF THE EVENT NAME.
    //
    // These were `/emit\("authenticated",\s*\(/` and
    // `/emit\("authenticated"\)\s*;/`, which require `emit(` and the event
    // name to be ADJACENT. Wrapping the call across lines — which prettier
    // does the moment the argument list grows — turned the first red and the
    // second vacuously green, while the code was correct in both cases. That
    // is testing layout, not the contract.
    check(
      "the client emits `authenticated` WITH an acknowledgement",
      /emit\(\s*"authenticated"\s*,\s*\(/.test(clientSrc),
      "without one the server replies on a channel nobody listens to",
    );
    check(
      "and no longer emits it bare",
      !/emit\(\s*"authenticated"\s*\)/.test(clientSrc),
      "`emit(\"authenticated\")` with no callback was the bug",
    );
    check(
      "the dead `authenticated` LISTENER is gone from the client",
      !/\bon\("authenticated"/.test(clientSrc),
      "the server never emits it — it could never fire",
    );
    // Positive control: the server really does branch on the callback, so the
    // assertions above are about a live mechanism, not a dead one.
    check(
      "POSITIVE CONTROL: the server still branches on the ack",
      /typeof callback === "function"/.test(serverSrc) &&
        /emit\("authentication:complete"/.test(serverSrc),
      "both branches exist, so passing the ack is what selects the good one",
    );
  }

  // ── A3-2: no array reaches a string field over the socket ────────────
  console.log("\nA3-2 — command:result.output is a string on the socket path");
  {
    // Find every socket emit of command:result and check none passes a bare
    // array literal or an un-joined array-typed value.
    const emits = serverSrc.match(/emit\("command:result",\s*\{[\s\S]{0,400}?\}\)/g) || [];
    check(
      "PRECONDITION: command:result emits were found",
      emits.length > 0,
      `${emits.length} emit site(s) — zero would make the next check vacuous`,
    );
    // Match an array LITERAL only. The first version was `output:\s*[^,]*\[`,
    // which matched a `[` inside a string — `output: "[System] ..."` — and
    // reported two false positives. Verified the remaining variable-valued
    // emits are strings: buildAnalysisReport(): string and render(): string.
    const ARRAY_OUTPUT = /output:\s*\[/;
    check(
      "POSITIVE CONTROL: the pattern matches a real array emit",
      ARRAY_OUTPUT.test('emit("command:result", { output: ["a","b"] })'),
      "a zero-match result is meaningless unless the pattern can match",
    );
    const arrayLiteral = emits.filter((e) => ARRAY_OUTPUT.test(e) && !/join\(/.test(e));
    check(
      "no emit sends a bare array as `output`",
      arrayLiteral.length === 0,
      arrayLiteral.length ? arrayLiteral[0]!.slice(0, 120) : "all normalised",
    );
    check(
      "hackCommands joins its array before emitting",
      /Array\.isArray\(result\.output\)[\s\S]{0,80}?join\("\\n"\)/.test(serverSrc),
      "this was the one instance on the socket path",
    );
    check(
      "the REST path still normalises too (unchanged)",
      /Array\.isArray\(result\.output\)\s*\?\s*result\.output\.join/.test(clientSrc),
      "Terminal.svelte — why the REST instance never showed the bug",
    );
  }

  // ── A3-3: the contract describes reality ─────────────────────────────
  console.log("\nA3-3 — the contract matches the code");
  {
    const contract = readFileSync(join(ROOT, "shared/types/socketEvents.ts"), "utf8");
    check("ServerToClientEvents exists", /export interface ServerToClientEvents/.test(contract));
    check("ClientToServerEvents exists", /export interface ClientToServerEvents/.test(contract));
    check(
      "the ack is part of the declared `authenticated` signature",
      /authenticated:\s*\(\s*\n?\s*ack\?/.test(contract),
      "declaring it is what makes omitting it a mistake",
    );

    // Every event the contract declares must actually exist in the code —
    // otherwise the contract is fiction rather than description.
    const declared = [...contract.matchAll(/^\s{2}"([a-z]+:[a-z_-]+)":/gim)].map((m) => m[1]!);
    const missing = declared.filter(
      (e) => !serverSrc.includes(`"${e}"`) && !clientSrc.includes(`"${e}"`),
    );
    check(
      "every declared event appears in the source",
      missing.length === 0,
      missing.length ? `absent: ${missing.join(", ")}` : `${declared.length} events checked`,
    );
  }

  // ── A3-4: the orphan list must not grow silently ─────────────────────
  console.log("\nA3-4 — known orphans are still orphans, and no worse");
  {
    // Each recorded orphan should STILL have no counterpart. If one gains an
    // emitter it has been fixed and should leave the list; the check tells us.
    // Count SOCKET emits only. `this.emit(...)` is the internal EventEmitter
    // bus, and conflating the two mislabelled `process:failed` as "fixed":
    // processStateService really does emit it — on the service bus, never
    // bridged to a socket — which is exactly why the client listener is dead.
    // An event can be emitted and orphaned at the same time.
    const socketEmits = serverSrc.replace(/this\.emit\(/g, "__internalEmit(");
    const stillOrphaned = KNOWN_ORPHANED_EVENTS.clientListenersWithoutEmitter.filter(
      (e) => !new RegExp(`emit\\(\\s*["'\`]${e.replace(/[:]/g, "\\:")}["'\`]`).test(socketEmits),
    );
    check(
      "recorded client-listener orphans are unchanged",
      stillOrphaned.length === KNOWN_ORPHANED_EVENTS.clientListenersWithoutEmitter.length,
      `${stillOrphaned.length}/${KNOWN_ORPHANED_EVENTS.clientListenersWithoutEmitter.length} still orphaned` +
        " — a drop means one was wired up and should leave the list",
    );
    // `process:failed` USED to be the subtlest orphan — emitted on the
    // internal bus and never bridged. It is gone entirely now:
    // processStateService (its only producer, 11 methods with zero callers)
    // was deleted in A10, and the live process system (memoryService) never
    // sets a "failed" status at all. This check flipped from "documented
    // orphan" to "must not come back", which is exactly what should happen
    // when a recorded fact stops being true.
    check(
      "`process:failed` no longer exists on either side",
      !/process:failed/.test(serverSrc) && !/process:failed/.test(clientSrc),
      "producer and listener both removed",
    );
    // REPLACED 2026-10-06. This used to assert that `hack:attempted` was
    // listed as a known orphan — so fixing the orphan turned the check red.
    // That is the third time in this phase a check has encoded a LIMITATION
    // and expired the moment the limitation did. The orphan lists are now
    // empty, so the durable form is a RATCHET: assert they stay empty.
    check(
      "no client listener is left without a server emitter",
      KNOWN_ORPHANED_EVENTS.clientListenersWithoutEmitter.length === 0,
      `${KNOWN_ORPHANED_EVENTS.clientListenersWithoutEmitter.join(", ") || "none"} — ` +
      "an entry here is a half-built feature, and this list is the only thing that notices",
    );
    check(
      "no client send is left without a server handler",
      KNOWN_ORPHANED_EVENTS.clientEmitsWithoutListener.length === 0,
      KNOWN_ORPHANED_EVENTS.clientEmitsWithoutListener.join(", ") || "none",
    );
    check(
      "the victim hack alerts are bridged, and gated on detection",
      /emit\("hack:attempted"/.test(serverSrc) &&
        /emit\("hack:successful"/.test(serverSrc) &&
        /emit\("hack:blocked"/.test(serverSrc) &&
        /data\.detected/.test(serverSrc),
      "bridging without the `detected` gate would tell victims about hacks their " +
      "defences never noticed, making stealth skill worthless",
    );
    check(
      "the bridge emits LITERAL event names, not a computed one",
      !/\.emit\(\s*\w+\s*\?\s*"hack:/.test(serverSrc),
      "a ternary event name is invisible to the contract checker and to grep — " +
      "it reported these as orphaned listeners while the emit sat right there",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
