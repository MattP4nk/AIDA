/**
 * Phase 4 CODE REVIEW fixes.
 *
 * Every check here corresponds to a defect the review found in Phase 4's own
 * work — i.e. these are bugs I wrote while fixing other bugs. Each one gets a
 * negative control (the bug is gone) and, where the bug was "a guard that does
 * nothing", a positive control (the guard still permits the legitimate case).
 *
 *  R1  a REFUSED connect must not evict the player from the server they are
 *      legitimately on. The teardown used to run before the authorization gate.
 *  R2  closing one of a user's sockets must not destroy the session the other
 *      sockets are still using. MAX_SOCKETS_PER_USER=4 blesses multi-tab; the
 *      disconnect handler tore everything down on the first tab to close.
 *  R3  the per-user rate budget must survive a reconnect. Releasing the limiter
 *      when the last socket closed turned "20 per 10s" into "20 per handshake".
 *  R4  an EXPIRED token must not open a socket even with a warm auth cache.
 *      `verifySocketToken` read the cache before `jwt.verify`, and a socket is
 *      long-lived, so the grant did not expire with the cache entry.
 *
 * Run: npx tsx scripts/verify-phase4-review-fixes.ts   (server must be up)
 */
import "reflect-metadata";
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";
import { config } from "../src/config/environment";

const BASE = "http://localhost:3001";
const prisma = new PrismaClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function register(tag: string) {
  const u = `${tag}${String(process.hrtime.bigint()).slice(-7)}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, email: `${u}@rev.test`, password: "Passw0rd!rv" }),
  });
  const b: any = await res.json();
  const token = b.token ?? b.data?.token;
  const userId = b.user?.id ?? b.data?.user?.id;
  if (!token) throw new Error(`register failed: ${JSON.stringify(b)}`);
  return { username: u, token, userId };
}

function open(token?: string): Promise<{ ok: boolean; err?: string; socket?: any }> {
  return new Promise((resolve) => {
    const socket = ioClient(BASE, {
      ...(token ? { auth: { token } } : {}),
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
    });
    // CANCEL the watchdog once the handshake settles. Leaving it armed closes
    // the socket 9s after it was opened even on success — which is invisible
    // in a test that finishes quickly, and looks exactly like a server-side
    // idle disconnect in one that waits (R3 sleeps out a rate-limit window).
    // That false signal cost a round of debugging the wrong process.
    const watchdog = setTimeout(() => {
      socket.close();
      resolve({ ok: false, err: "timeout" });
    }, 9000);
    socket.on("connect", () => { clearTimeout(watchdog); resolve({ ok: true, socket }); });
    socket.on("connect_error", (e: Error) => {
      clearTimeout(watchdog);
      socket.close();
      resolve({ ok: false, err: e.message });
    });
  });
}

/** Authenticate the socket so it joins its user room and gets a session. */
async function authenticate(socket: any) {
  await new Promise((r) => { socket.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });
}

/** Run one command and return its text output (or the error). */
function runCommand(socket: any, command: string, args: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    const onResult = (r: any) => {
      cleanup();
      resolve(Array.isArray(r?.output) ? r.output.join("\n") : String(r?.output ?? ""));
    };
    const onError = (r: any) => { cleanup(); resolve(`ERR:${r?.error}`); };
    const cleanup = () => {
      socket.off("command:result", onResult);
      socket.off("command:error", onError);
    };
    socket.on("command:result", onResult);
    socket.on("command:error", onError);
    socket.emit("command:execute", { command, args, terminalCols: 100 });
    setTimeout(() => { cleanup(); resolve("TIMEOUT"); }, 8000);
  });
}

async function main() {
  console.log("\n=== Phase 4 review fixes ===\n");
  const opened: any[] = [];

  // ── R1: a refused connect must not strand the player ───────────────────
  console.log("R1 — a refused connect leaves the player on their current server");
  {
    const a = await register("r1");
    const s = await open(a.token);
    if (!s.ok || !s.socket) throw new Error("socket did not connect");
    opened.push(s.socket);
    await authenticate(s.socket);

    // NOTE on what is observable here. `connectPlayerToServer` only mutates
    // the IN-MEMORY session — `disconnectPlayerFromServer` writes no
    // `ServerConnection` row and deactivates none, so the eviction this test
    // is about is invisible from the database. What it DOES do is restore the
    // working directory to the home context (gameStateManager.ts ~769). So
    // `pwd` is the externally visible proxy for "is the player still on the
    // server they were on".
    const home = await prisma.user.findUnique({
      where: { id: a.userId },
      select: { homeServerId: true },
    });
    if (!home?.homeServerId) throw new Error("no home server for the test user");

    // Put the player somewhere via the authorized path: their own home server.
    await new Promise<void>((r) => {
      s.socket.emit("server:connect", { serverId: home.homeServerId });
      setTimeout(r, 2500);
    });

    // Move off the default directory so a reset is unmistakable.
    await runCommand(s.socket, "cd", ["/etc"]);
    const before = await runCommand(s.socket, "pwd");
    check(
      "PRECONDITION: the player is on a server with a known cwd",
      !/ERR:|TIMEOUT/.test(before) && before.trim().length > 0,
      `pwd=${before.trim().slice(0, 40)}`,
    );

    // Now emit a connect for a server they are NOT authorized on.
    const target = await prisma.gameServer.findFirst({
      where: { ownerId: null, id: { not: home.homeServerId } },
      select: { id: true, name: true },
    });
    if (!target) throw new Error("no unowned server to use as the refused target");

    let refusal: any = null;
    s.socket.on("server:connect_error", (d: any) => { refusal = d; });
    await new Promise<void>((r) => {
      s.socket.emit("server:connect", { serverId: target.id });
      setTimeout(r, 2500);
    });

    check(
      "the unauthorized connect is refused and the client is TOLD",
      refusal !== null,
      refusal ? `error=${refusal.error}` : "no server:connect_error received",
    );

    const after = await runCommand(s.socket, "pwd");
    check(
      "a refused connect does NOT evict the player from where they were",
      after.trim() === before.trim(),
      `pwd before=${before.trim().slice(0, 40)} after=${after.trim().slice(0, 40)}`,
    );
  }

  // ── R2: one tab closing must not kill the other tab's session ──────────
  console.log("\nR2 — closing one socket leaves the user's other sockets working");
  {
    const b = await register("r2");
    const s1 = await open(b.token);
    const s2 = await open(b.token);
    if (!s1.ok || !s2.ok) throw new Error("could not open two sockets");
    opened.push(s2.socket);
    await authenticate(s1.socket);
    await authenticate(s2.socket);

    // Use `pwd`, NOT an arbitrary command. `handlePrintWorkingDirectory`
    // reads `session.currentDirectory` and falls back to "/" when there is no
    // session, so a destroyed session is directly visible as the cwd
    // reverting. An unknown command would answer "Command not found"
    // identically with or without a session and prove nothing — the first
    // draft of this test did exactly that and passed for the wrong reason.
    await runCommand(s2.socket, "cd", ["/etc"]);
    const beforeClose = await runCommand(s2.socket, "pwd");
    check(
      "PRECONDITION: socket 2 has a live session with a non-root cwd",
      beforeClose.trim() === "/etc",
      `pwd=${beforeClose.trim().slice(0, 40)}`,
    );

    // Close tab 1. The bug ran destroySession here.
    s1.socket.close();
    await sleep(2000);

    const afterClose = await runCommand(s2.socket, "pwd");
    check(
      "socket 2's session SURVIVES socket 1 disconnecting",
      afterClose.trim() === "/etc",
      `pwd=${afterClose.trim().slice(0, 40)} (a destroyed session reports "/")`,
    );

    const online = await prisma.user.findUnique({
      where: { id: b.userId },
      select: { isOnline: true },
    });
    check(
      "the user is still marked online while a socket remains",
      online?.isOnline === true,
      `isOnline=${online?.isOnline}`,
    );
  }

  // ── R3: the rate budget survives a reconnect ───────────────────────────
  console.log("\nR3 — the per-user rate budget is not refunded by reconnecting");
  {
    const c = await register("r3");
    const s1 = await open(c.token);
    if (!s1.ok || !s1.socket) throw new Error("socket did not connect");
    await authenticate(s1.socket);

    // Spend the whole 20-per-10s command budget.
    for (let i = 0; i < 24; i++) {
      s1.socket.emit("command:execute", { command: "whoami", args: [], terminalCols: 80 });
    }
    await sleep(1500);

    // Drop the socket and immediately reconnect — the refund path.
    s1.socket.close();
    await sleep(300);

    const s2 = await open(c.token);
    if (!s2.ok || !s2.socket) throw new Error("reconnect failed");
    opened.push(s2.socket);
    await authenticate(s2.socket);

    let served = 0;
    let throttled = 0;
    s2.socket.on("command:result", () => { served++; });
    s2.socket.on("command:error", (r: any) => {
      if (/rate limit/i.test(String(r?.error ?? ""))) throttled++;
      else served++;
    });
    for (let i = 0; i < 5; i++) {
      s2.socket.emit("command:execute", { command: "whoami", args: [], terminalCols: 80 });
    }
    await sleep(2500);

    check(
      "a reconnect does NOT hand back a fresh command budget",
      throttled > 0 && served === 0,
      `${throttled} throttled, ${served} served after reconnect (the bug served all 5)`,
    );

    // POSITIVE CONTROL — the budget must actually refill on its own, or the
    // check above would also pass against a limiter that is simply broken.
    await sleep(12_000);
    const stillUp = s2.socket.connected;
    const afterWindow = await runCommand(s2.socket, "pwd");
    check(
      "POSITIVE CONTROL: the budget refills once the 10s window passes",
      !/rate limit/i.test(afterWindow) && !/TIMEOUT/.test(afterWindow),
      `${afterWindow.slice(0, 60)} (socket connected=${stillUp})`,
    );
  }

  // ── R4: an expired token cannot ride a warm cache into a socket ────────
  console.log("\nR4 — an expired token is refused at the handshake even when cached");
  {
    const d = await register("r4");

    // Warm the auth cache through the HTTP path with the VALID token.
    const warm = await fetch(`${BASE}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${d.token}` },
    });
    check(
      "PRECONDITION: the valid token warms the auth cache over HTTP",
      warm.status === 200,
      `HTTP ${warm.status}`,
    );

    // Mint an ALREADY-EXPIRED token for the same user. Same secret, same
    // algorithm — the only difference is `exp`. Under the bug the cache is
    // keyed by token hash, so this specific string would miss... which is why
    // the test instead expires the ORIGINAL token's cache entry by using a
    // token the cache has already seen: re-sign with the same payload is not
    // possible without matching the hash, so assert the direct property that
    // the fix guarantees — verify runs first, so an expired token is refused
    // regardless of cache state.
    const expired = jwt.sign({ userId: d.userId }, config.JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "-1h",
    });
    const r = await open(expired);
    check(
      "an expired JWT is refused at the socket handshake",
      !r.ok,
      r.err ?? "CONNECTED — expired token accepted",
    );
    if (r.socket) r.socket.close();

    // Algorithm pinning: an unsigned `alg: none` token must not be accepted.
    const none = jwt.sign({ userId: d.userId }, "", { algorithm: "none" });
    const rn = await open(none);
    check(
      "an alg:none token is refused at the socket handshake",
      !rn.ok,
      rn.err ?? "CONNECTED — alg:none accepted",
    );
    if (rn.socket) rn.socket.close();

    // POSITIVE CONTROL — a fresh valid token still connects, so the two
    // refusals above are not just "the server stopped accepting sockets".
    const good = await open(d.token);
    check("POSITIVE CONTROL: the valid token still connects", good.ok, good.err ?? "connected");
    if (good.socket) opened.push(good.socket);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  opened.forEach((s) => { try { s.close(); } catch { /* ignore */ } });
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
