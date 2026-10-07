/**
 * Socket event-name contract check (A3).
 *
 * Static analysis, not a test: every event the CLIENT subscribes to must be
 * emitted somewhere on the server, and every event the server sends to a client
 * must have a subscriber. A mismatch is a dead listener or a message into the
 * void — both silent at runtime, which is why they accumulated.
 *
 * THE CRITICAL DISTINCTION: the server has ~98 `.emit(` calls but most are
 * EventEmitter service events (`this.emit("hack:detected", …)`) consumed
 * in-process, NOT socket emissions. Diffing all of them against the client's
 * listeners would report ~66 false positives and the check would be ignored.
 * Only emissions on a socket/io object count.
 *
 * Run: npx tsx scripts/check-socket-contract.ts
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = join(__dirname, "..");
const SERVER_SRC = join(ROOT, "server", "src");
const CLIENT_SRC = join(ROOT, "client", "src");

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(p);
  }
  return out;
}

interface Ref { event: string; where: string }

/**
 * Socket emissions only.
 *
 * Matches a `.emit("x:y", …)` whose receiver is a socket/io expression —
 * `io.to(room).emit`, `socket.emit`, `this.io.emit`, `client.emit`. Deliberately
 * excludes a bare `this.emit(` (EventEmitter) and `emitter.emit(`.
 */
const SOCKET_EMIT = /(?:\bio\b|\bsocket\b|\bclient\b|\bthis\.io\b)[^\n;]{0,120}?\.emit\(\s*["'`]([a-z_]+:[a-zA-Z_-]+)["'`]/g;
/** EventEmitter emissions — collected only so the report can explain exclusions. */
const SERVICE_EMIT = /\bthis\.emit\(\s*["'`]([a-z_]+:[a-zA-Z_-]+)["'`]/g;
/**
 * Listener registrations — `.on(` AND `.once(`.
 *
 * `.once(` was missing, and it is not a rare form here: the whole terminal tab
 * bar is wired with it (`terminalTabs.ts` registers `terminal:created`,
 * `terminal:closed`, `terminal:switched` and `terminal:list` that way, the
 * last being its boot path). The check reported all four as server events
 * nobody listens to — live code, called dead, for as long as this file has
 * existed. Anything request/response-shaped is a `once` by nature, so this was
 * guaranteed to misreport exactly the events that behave most like calls.
 */
const ON_HANDLER = /\.(?:on|once)\(\s*["'`]([a-z_]+:[a-zA-Z_-]+)["'`]/g;

// NOTE: the character class allows HYPHENS. It originally did not, which made the
// check silently blind to 12 real events — forum:new-post, story:key-fragment,
// server:subnet-scan and others. `server:subnet-scan` was emitted on the live
// subnet-sweep path with no client listener at all, and the check reported a
// clean bill of health because it never saw the name.

/**
 * Strip comments before matching.
 *
 * Without this the checker matches event names quoted in PROSE. It reported
 * `authentication:complete` as a live server emit when the only remaining
 * mention was the sentence explaining why the emit had been deleted — so
 * documenting a removal re-created the finding. CLAUDE.md lists this exact
 * trap ("strip comments before matching source in a harness"); the sibling
 * harness `verify-phase7-a3-socket-contract.ts` already did it and this did
 * not.
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function collect(files: string[], re: RegExp): Ref[] {
  const out: Ref[] = [];
  for (const f of files) {
    const src = stripComments(readFileSync(f, "utf8"));
    for (const m of src.matchAll(new RegExp(re.source, re.flags))) {
      out.push({ event: m[1]!, where: relative(ROOT, f) });
    }
  }
  return out;
}

const serverFiles = walk(SERVER_SRC, [".ts"]);
const clientFiles = walk(CLIENT_SRC, [".ts", ".svelte"]);

const serverSocketEmits = collect(serverFiles, SOCKET_EMIT);
const serverServiceEmits = collect(serverFiles, SERVICE_EMIT);
const serverOn = collect(serverFiles, ON_HANDLER);
const clientOn = collect(clientFiles, ON_HANDLER);
const clientEmits = collect(clientFiles, /\.emit\(\s*["'`]([a-z_]+:[a-zA-Z_-]+)["'`]/g);

// Guard against a silently-broken regex turning every check into a vacuous pass.
if (serverSocketEmits.length === 0) {
  throw new Error("matched 0 server socket emissions — the extraction is broken, not the code");
}
if (clientOn.length === 0) {
  throw new Error("matched 0 client listeners — the extraction is broken, not the code");
}

const set = (refs: Ref[]) => new Set(refs.map((r) => r.event));
const serverSocketEmitted = set(serverSocketEmits);
const serviceOnly = new Set([...set(serverServiceEmits)].filter((e) => !serverSocketEmitted.has(e)));
const clientListens = set(clientOn);
const serverListens = set(serverOn);
const clientSends = set(clientEmits);

/**
 * Events the server sends over a socket that the client never handles.
 * Not necessarily a bug — some are consumed by an admin page or reserved — so
 * this is reported, and only the client-side direction fails the build.
 */
const unheard = [...serverSocketEmitted].filter((e) => !clientListens.has(e)).sort();

/**
 * Client listeners with no server SOCKET emission.
 *
 * Split into two very different cases, because conflating them is misleading and
 * nearly caused working code to be deleted:
 *
 *  - `needsBridge` — the server DOES raise the event, on the EventEmitter bus,
 *    and nothing forwards it to the socket. Both halves exist; only the bridge in
 *    index.ts is missing (see how `hack:detected` is wired there). Cheap to fix.
 *  - `orphanListeners` — the server never raises it under this name at all.
 *    Usually name drift against an event it DOES emit differently.
 */
const allOrphans = [...clientListens].filter((e) => !serverSocketEmitted.has(e));
const needsBridge = allOrphans.filter((e) => serviceOnly.has(e)).sort();
const orphanListeners = allOrphans.filter((e) => !serviceOnly.has(e)).sort();

/** Client → server messages the server never subscribes to: goes nowhere. */
const orphanClientSends = [...clientSends].filter((e) => !serverListens.has(e)).sort();

const where = (refs: Ref[], event: string) =>
  [...new Set(refs.filter((r) => r.event === event).map((r) => r.where))].slice(0, 2).join(", ");

console.log("\n===== SOCKET CONTRACT =====");
console.log(
  `server: ${serverSocketEmitted.size} socket events, ${serviceOnly.size} EventEmitter-only (excluded)`,
);
console.log(`client: ${clientListens.size} listeners, ${clientSends.size} sends\n`);

let failed = 0;

if (needsBridge.length) {
  failed += needsBridge.length;
  console.log(
    `FAIL  ${needsBridge.length} client listener(s) whose server event exists but is NEVER BRIDGED to the socket:`,
  );
  for (const e of needsBridge) {
    console.log(`        ${e.padEnd(34)} raised in ${where(serverServiceEmits, e)}`);
  }
  console.log("        -> forward these in index.ts, as hack:detected already is");
}

if (orphanListeners.length) {
  failed += orphanListeners.length;
  console.log(
    `${needsBridge.length ? "\n" : ""}FAIL  ${orphanListeners.length} client listener(s) the server never emits under this name:`,
  );
  for (const e of orphanListeners) console.log(`        ${e.padEnd(34)} ${where(clientOn, e)}`);
}

if (!needsBridge.length && !orphanListeners.length) {
  console.log("PASS  every client listener has a server emission");
}

if (orphanClientSends.length) {
  failed += orphanClientSends.length;
  console.log(`\nFAIL  ${orphanClientSends.length} client send(s) the server never handles:`);
  for (const e of orphanClientSends) console.log(`        ${e.padEnd(34)} ${where(clientEmits, e)}`);
} else {
  console.log("PASS  every client send has a server handler");
}

if (unheard.length) {
  console.log(`\nnote: ${unheard.length} server socket event(s) with no client listener (not fatal):`);
  for (const e of unheard) console.log(`        ${e.padEnd(34)} ${where(serverSocketEmits, e)}`);
}

console.log(`\n${failed === 0 ? "contract OK" : `${failed} contract violation(s)`}`);
console.log("===========================");
if (failed) process.exitCode = 1;
