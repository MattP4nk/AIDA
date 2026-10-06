/**
 * S3 + S9 — socket authentication, per-user limits, caps, and real ban enforcement.
 *
 * S9 was three separate holes:
 *   - authentication ran as `socket.use()`, i.e. per PACKET, so a tokenless
 *     socket completed the handshake and stayed connected indefinitely with its
 *     packets merely rejected;
 *   - the rate limiters were closures created per SOCKET, so a second tab
 *     bought a second full allowance and every published limit really meant
 *     "N x however many sockets you open";
 *   - nothing capped how many sockets that was.
 *
 * S3: ban/kick broadcast `force:disconnect` to EVERY client (so the whole
 * server learned who was banned and why) and only ASKED the client to hang up.
 *
 * Every refusal is paired with a positive control, because "the socket did not
 * connect" also passes against a server that is simply down.
 *
 * Run: npx tsx scripts/verify-phase4-s3-s9-sockets.ts   (server must be up)
 */
import "reflect-metadata";
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";

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
    body: JSON.stringify({ username: u, email: `${u}@s9.test`, password: "Passw0rd!s9" }),
  });
  const b: any = await res.json();
  const token = b.token ?? b.data?.token;
  const userId = b.user?.id ?? b.data?.user?.id;
  if (!token) throw new Error(`register failed: ${JSON.stringify(b)}`);
  return { username: u, token, userId };
}

/** Open a socket; resolve with how the server answered. */
function open(token?: string): Promise<{ ok: boolean; err?: string; socket?: any }> {
  return new Promise((resolve) => {
    const socket = ioClient(BASE, {
      ...(token ? { auth: { token } } : {}),
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
    });
    const done = (r: { ok: boolean; err?: string; socket?: any }) => resolve(r);
    socket.on("connect", () => done({ ok: true, socket }));
    socket.on("connect_error", (e: Error) => { socket.close(); done({ ok: false, err: e.message }); });
    setTimeout(() => { socket.close(); done({ ok: false, err: "timeout" }); }, 9000);
  });
}

async function main() {
  console.log("\n=== S3 + S9 — socket auth, limits, caps, ban enforcement ===\n");
  const opened: any[] = [];

  // ── S9: connection-level authentication ────────────────────────────────
  console.log("S9 — handshake authentication");
  {
    const none = await open(undefined);
    check("a socket with NO token is refused at the handshake", !none.ok, none.err ?? "connected!");

    const bogus = await open("not-a-real-jwt");
    check("a socket with an INVALID token is refused at the handshake", !bogus.ok, bogus.err ?? "connected!");

    // POSITIVE CONTROL — without this, the two refusals above pass against a
    // server that simply is not accepting sockets at all.
    const a = await register("s9a");
    const good = await open(a.token);
    check("POSITIVE CONTROL: a valid token still connects", good.ok, good.err ?? "connected");
    if (good.socket) opened.push(good.socket);
  }

  // ── S9: concurrency cap per user ───────────────────────────────────────
  console.log("\nS9 — concurrent socket cap per user");
  {
    const b = await register("s9b");
    const sockets: any[] = [];
    let refusedAt = 0;
    // MAX_SOCKETS_PER_USER is 4; open more and the extras must be closed.
    for (let i = 1; i <= 7; i++) {
      const r = await open(b.token);
      if (r.ok && r.socket) {
        sockets.push(r.socket);
        // The server may accept the handshake and then close over the cap;
        // give it a moment and check the socket survived.
        await sleep(250);
        if (r.socket.disconnected && !refusedAt) refusedAt = i;
      } else if (!refusedAt) {
        refusedAt = i;
      }
    }
    const live = sockets.filter((s) => s.connected).length;
    check(
      "a user cannot hold more than the per-user socket cap",
      live <= 4,
      `${live} live sockets after opening 7 (cap 4, first refusal at #${refusedAt || "none"})`,
    );
    sockets.forEach((s) => s.close());
  }

  // ── S9: the rate limit is per USER, not per socket ─────────────────────
  console.log("\nS9 — rate limit is shared across a user's sockets");
  {
    const c = await register("s9c");
    const s1 = await open(c.token);
    const s2 = await open(c.token);
    if (!s1.ok || !s2.ok) throw new Error("could not open two sockets for the limiter test");
    opened.push(s1.socket, s2.socket);
    for (const s of [s1.socket, s2.socket]) {
      await new Promise((r) => { s.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });
    }

    // The command budget is 20 per 10s PER USER. Spend it all on socket 1,
    // then socket 2 must already be out — under the old per-socket limiters it
    // would have had a full fresh 20.
    // Count results and rate-limit rejections SEPARATELY. Counting both as
    // "answered" was a harness bug that made a fully rate-limited socket look
    // completely unthrottled.
    let served = 0;
    let throttled = 0;
    s2.socket.on("command:result", () => { served++; });
    s2.socket.on("command:error", (r: any) => {
      if (/rate limit/i.test(String(r?.error ?? ""))) throttled++;
      else served++;
    });

    // Spend the user's whole 20-per-10s command budget on socket 1.
    for (let i = 0; i < 24; i++) s1.socket.emit("command:execute", { command: "whoami", args: [], terminalCols: 80 });
    await sleep(1500);

    served = 0; throttled = 0;
    for (let i = 0; i < 5; i++) s2.socket.emit("command:execute", { command: "whoami", args: [], terminalCols: 80 });
    await sleep(2500);

    check(
      "socket 2 is rate-limited by socket 1's spending (shared per-user budget)",
      throttled > 0 && served === 0,
      `${throttled} throttled, ${served} served on the second socket (per-socket limiters would serve all 5)`,
    );
  }

  // ── S3: ban actually closes the sockets ────────────────────────────────
  console.log("\nS3 — ban enforcement");
  {
    const victim = await register("s3v");
    const v = await open(victim.token);
    if (!v.ok || !v.socket) throw new Error("victim socket did not connect");
    await new Promise((r) => { v.socket.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });

    // A bystander must NOT receive the ban reason — that was the broadcast leak.
    const bystanderAcct = await register("s3by");
    const by = await open(bystanderAcct.token);
    if (!by.ok || !by.socket) throw new Error("bystander socket did not connect");
    opened.push(by.socket);
    const bystanderSaw: any[] = [];
    by.socket.on("force:disconnect", (d: any) => bystanderSaw.push(d));

    check("PRECONDITION: victim socket is connected before the ban", v.socket.connected);

    // Do NOT pre-ban via Prisma here. An earlier draft did, and the admin
    // command then short-circuited with "already banned" and never reached the
    // socket-closing code — so the assertion below failed for a reason that had
    // nothing to do with S3. The admin command must perform the ban itself.

    // Drive the real admin path over an admin socket instead of poking internals.
    const admin = await register("s3adm");
    await prisma.user.update({ where: { id: admin.userId }, data: { role: "admin" } });
    const adm = await open(admin.token);
    if (!adm.ok || !adm.socket) throw new Error("admin socket did not connect");
    opened.push(adm.socket);
    await new Promise((r) => { adm.socket.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });
    // Capture the admin command's own output: if the ban is refused (for
    // example because this socket authenticated BEFORE the role was granted,
    // so socket.data.user still says "player"), the socket-close assertion
    // below would fail for a reason that has nothing to do with S3.
    const admOut: string[] = [];
    adm.socket.on("command:result", (r: any) =>
      admOut.push(Array.isArray(r?.output) ? r.output.join("\n") : String(r?.output ?? "")),
    );
    adm.socket.on("command:error", (r: any) => admOut.push(`ERR:${r?.error}`));
    adm.socket.emit("command:execute", {
      command: "admin",
      args: ["ban", victim.username, "review", "test"],
      terminalCols: 100,
    });
    await sleep(3000);
    const banOutput = admOut.join(" | ").slice(0, 160);
    check(
      "PRECONDITION: the admin ban command was accepted",
      !/not recognized|permission|denied|unknown command|ERR:/i.test(banOutput),
      banOutput || "(no output)",
    );

    check(
      "the banned user's live socket is CLOSED server-side",
      v.socket.disconnected,
      v.socket.connected ? `still connected — ban was only a suggestion (admin said: ${banOutput.slice(0, 80)})` : "disconnected",
    );
    check(
      "the ban reason is NOT broadcast to other players",
      bystanderSaw.length === 0,
      `bystander received ${bystanderSaw.length} force:disconnect events`,
    );
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
