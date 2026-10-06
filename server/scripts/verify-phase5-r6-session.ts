/**
 * Phase 5 R6 — session/socket binding.
 *
 * Verified against source before changing anything, and the plan's three
 * claims did not survive contact intact:
 *
 *  claim 1 "call the socket-aware handleDisconnect(socketId)" — WRONG, and
 *          acting on it would have been a regression. That method only
 *          resolved userId from `activeConnections` and called
 *          `destroySession`, which the socket layer already does, minus the
 *          `isLastSocket` guard added in Phase 4. Calling it would have
 *          destroyed a session the user's other tabs were still using. The
 *          method was removed instead.
 *  claim 2 "rebind session.socketId on re-auth" — CONFIRMED. `socketId` was
 *          written once at session creation and never again.
 *  claim 3 "rejoin rooms" — CONFIRMED. The reuse branch of
 *          `handleAuthentication` joined only `user:`/`player:`, never
 *          `server:<currentServerId>`.
 *
 * What makes 2 and 3 bite NOW is Phase 4: sessions deliberately survive while
 * the user has other sockets, so `session.socketId` can name a CLOSED socket
 * while the player is still playing — and room ops did
 * `io.sockets.sockets.get(deadId)`, got `undefined`, and silently did nothing.
 *
 * Membership of a socket.io room is not observable from the client, so every
 * check below emits into the room and asserts on delivery. "The socket did not
 * receive it" is also what a broken emit looks like, so each block pairs the
 * assertion with a positive control on a socket that must receive.
 *
 * Run: npx tsx scripts/verify-phase5-r6-session.ts   (server must be up)
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
    body: JSON.stringify({ username: u, email: `${u}@r6.test`, password: "Passw0rd!r6" }),
  });
  const b: any = await res.json();
  const token = b.token ?? b.data?.token;
  const userId = b.user?.id ?? b.data?.user?.id;
  if (!token) throw new Error(`register failed: ${JSON.stringify(b)}`);
  return { username: u, token, userId };
}

function open(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(BASE, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: 8000,
    });
    const watchdog = setTimeout(() => { socket.close(); reject(new Error("connect timeout")); }, 9000);
    socket.on("connect", () => { clearTimeout(watchdog); resolve(socket); });
    socket.on("connect_error", (e: Error) => { clearTimeout(watchdog); socket.close(); reject(e); });
  });
}

const authenticate = (s: any) =>
  new Promise((r) => { s.emit("authenticated", (a: any) => r(a)); setTimeout(r, 4000); });

/** Run a command and return its output text. */
function run(socket: any, command: string, args: string[] = []): Promise<string> {
  return new Promise((resolve) => {
    const onResult = (r: any) => { cleanup(); resolve(Array.isArray(r?.output) ? r.output.join("\n") : String(r?.output ?? "")); };
    const onError = (r: any) => { cleanup(); resolve(`ERR:${r?.error}`); };
    const cleanup = () => { socket.off("command:result", onResult); socket.off("command:error", onError); };
    socket.on("command:result", onResult);
    socket.on("command:error", onError);
    socket.emit("command:execute", { command, args, terminalCols: 100 });
    setTimeout(() => { cleanup(); resolve("TIMEOUT"); }, 10000);
  });
}

async function main() {
  console.log("\n=== Phase 5 R6 — session/socket binding ===\n");
  const opened: any[] = [];
  const acct = await register("r6");

  try {
    // Put the player on their home server so there is a `server:<id>` room
    // to be in at all.
    const home = await prisma.gameServer.findFirst({
      where: { ownerId: acct.userId, isPlayerHome: true },
      select: { id: true },
    });
    if (!home) throw new Error("no home server");

    const s1 = await open(acct.token);
    opened.push(s1);
    await authenticate(s1);
    await new Promise<void>((r) => { s1.emit("server:connect", { serverId: home.id }); setTimeout(r, 2500); });

    // OBSERVABLE, verified in source rather than assumed.
    //
    // `connectPlayerToServer` does `socketsJoin(server:<id>)` and THEN
    // `io.to(server:<id>).emit("server:user_connected")`. `io.to(room)` does
    // not exclude the sender, so every one of the connecting player's sockets
    // that is a member receives it. That makes room membership observable
    // from the client, which it otherwise is not.
    //
    // (The disconnect side is NOT usable for this: `socketsLeave` runs BEFORE
    // its broadcast, so the leaving player's own sockets are already out of
    // the room. Assuming otherwise cost this harness a rewrite.)

    // ── R6-a: a SECOND socket is bound and joins the server room ─────────
    console.log("R6-a — a second socket joins the server room");
    {
      const s2 = await open(acct.token);
      opened.push(s2);
      await authenticate(s2);

      const got1: any[] = [];
      const got2: any[] = [];
      s1.on("server:user_connected", (d: any) => got1.push(d));
      s2.on("server:user_connected", (d: any) => got2.push(d));

      await run(s1, "disconnect");
      await sleep(1000);
      await new Promise<void>((r) => { s1.emit("server:connect", { serverId: home.id }); setTimeout(r, 3000); });

      check(
        "POSITIVE CONTROL: the connecting socket receives the room broadcast",
        got1.length > 0,
        `${got1.length} event(s)`,
      );
      check(
        "the SECOND socket receives it too — it is in the room",
        got2.length > 0,
        got2.length
          ? `${got2.length} event(s)`
          : "0 — the second socket never joined server:<id>; this is R6 claim 3",
      );
    }

    // ── R6-b: the binding follows the surviving socket ───────────────────
    console.log("\nR6-b — the session rebinds when the bound socket closes");
    {
      const acct2 = await register("r6b");
      const homeB = await prisma.gameServer.findFirst({
        where: { ownerId: acct2.userId, isPlayerHome: true },
        select: { id: true },
      });
      if (!homeB) throw new Error("no home server for r6b");

      // `a` authenticates first, so it is the socket the session is bound to.
      const a = await open(acct2.token);
      await authenticate(a);
      const b = await open(acct2.token);
      opened.push(b);
      await authenticate(b);

      a.close();
      await sleep(2000);

      // The session must survive (Phase 4) AND its socketId must now name
      // `b`. If it still named the closed `a`, room ops would resolve to
      // undefined and silently do nothing.
      await run(b, "cd", ["/etc"]);
      const pwd = await run(b, "pwd");
      check(
        "PRECONDITION: the surviving socket still has a live session",
        pwd.trim() === "/etc",
        `pwd=${pwd.trim()} (a destroyed session reports "/")`,
      );

      const seen: any[] = [];
      b.on("server:user_connected", (d: any) => seen.push(d));
      await new Promise<void>((r) => { b.emit("server:connect", { serverId: homeB.id }); setTimeout(r, 3000); });

      check(
        "the surviving socket joins the server room after the rebind",
        seen.length > 0,
        seen.length
          ? `${seen.length} event(s)`
          : "0 — room ops were still aimed at the closed socket; this is R6 claim 2",
      );

      await prisma.user.deleteMany({ where: { id: acct2.userId } });
    }

    console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  } finally {
    opened.forEach((s) => { try { s.close(); } catch { /* ignore */ } });
    await prisma.user.deleteMany({ where: { id: acct.userId } });
    await prisma.$disconnect();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
