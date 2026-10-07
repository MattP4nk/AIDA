/**
 * Moderator actions take effect NOW, everywhere the account is signed in.
 *
 * A4 moved adminCommands' direct writes into AccountAdminService. Reading them
 * found four defects, each about state OUTSIDE the row that was written:
 *
 *   1. role is cached in the 60s auth cache (HTTP) and on every live socket
 *      (`socket.data.user.role`, set at auth, never refreshed). A demotion —
 *      in game or via the admin panel — wrote only the row, so a demoted admin
 *      kept their powers until the cache expired or they reconnected.
 *   2. `admin resetpw` (the compromised-account response) deactivated DB
 *      sessions but left the auth cache and every live socket working.
 *   3. `admin mute` wrote `mutedUntil` and nothing ever read it.
 *   4. the admin panel's role change wrote no audit record.
 *
 * 1 and 2 are about state INSIDE THE SERVER PROCESS, so they are tested end to
 * end against the running dev server — real HTTP, real sockets — not
 * in-process, where invalidating the harness's own cache would prove nothing.
 * Fixture accounts are demoted to player in `finally` (CLAUDE.md: never leave
 * test accounts holding elevated roles).
 *
 * Needs the dev server. ~25 HTTP requests (shared /api rate limit).
 * Run: npx tsx scripts/verify-account-admin.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
// The server has no socket.io-client dependency; harnesses borrow the client's.
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
type Socket = ReturnType<typeof ioClient>;
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function csrfFor(token: string): Promise<string> {
  const r = await fetch(`${BASE}/api/csrf-token`, { headers: { Authorization: `Bearer ${token}` } });
  const j: any = await r.json().catch(() => null);
  if (!j?.csrfToken) throw new Error(`no CSRF token: ${r.status}`);
  return j.csrfToken;
}
/** Every state-changing request needs a CSRF token, Bearer included. */
async function api(method: string, path: string, token: string, body?: unknown) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(method !== "GET" ? { "X-CSRF-Token": await csrfFor(token) } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function register(tag: string) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const j: any = await r.json();
  if (!j?.token) throw new Error(`register ${tag}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  return { id: j.user.id as string, token: j.token as string, username: tag };
}
/** Connect AND create the game session — commands need both. */
function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
    s.once("connect_error", reject);
    s.once("connect", () => {
      s.emit("authenticate:request", (res: any) => {
        if (res?.success) resolve(s);
        else reject(new Error(`socket auth: ${JSON.stringify(res)}`));
      });
    });
  });
}
function runSocketCommand(s: Socket, command: string): Promise<any> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ output: "<timeout>" }), 8000);
    s.once("command:result", (r) => { clearTimeout(t); resolve(r); });
    s.emit("command:execute", { command, terminalId: "acct-admin" });
  });
}
const text = (r: any) => (Array.isArray(r?.output) ? r.output.join("\n") : String(r?.output ?? r?.error ?? ""));

async function main() {
  console.log("\n=== Moderator actions take effect immediately ===");
  const tag = `aa${Date.now().toString(36)}`;
  const actor = await register(`${tag}a`);
  const httpTarget = await register(`${tag}h`);
  const sockTarget = await register(`${tag}s`);
  const resetTarget = await register(`${tag}r`);
  const fixtures = [actor, httpTarget, sockTarget, resetTarget];
  const sockets: Socket[] = [];
  try {
    // Fixture setup: elevated roles, written directly before any of them has
    // touched an authenticated route, so no cache holds a stale role yet.
    await prisma.user.updateMany({ where: { id: { in: [actor.id, httpTarget.id, sockTarget.id] } }, data: { role: "admin" } });

    console.log("\nAA-1 — demotion over HTTP is immediate (auth cache)");
    {
      const warm = await api("GET", "/api/admin/players", httpTarget.token);
      check("PRECONDITION: the target is admin over HTTP (and is now cached)", warm.status === 200, `${warm.status}`);
      const demote = await api("PUT", `/api/admin/players/${httpTarget.id}/role`, actor.token, { role: "player" });
      check("the admin panel demotes them", demote.status === 200, `${demote.status}`);
      const after = await api("GET", "/api/admin/players", httpTarget.token);
      check("their very next admin request is refused (was: admin for up to 60s)", after.status === 403, `${after.status}`);
      const audit = await prisma.auditLog.findFirst({
        where: { userId: actor.id, action: "admin_setrole", resourceId: httpTarget.id }, select: { metadata: true },
      });
      check("the panel's role change is audited (it wrote none)", (audit?.metadata as any)?.via === "admin-panel",
        JSON.stringify(audit?.metadata ?? null));
    }

    console.log("\nAA-2 — demotion reaches a LIVE socket (socket.data.user.role)");
    {
      const s = await connect(sockTarget.token); sockets.push(s);
      const before = await runSocketCommand(s, "admin status");
      // POSITIVE: the real status panel, not merely "no ACCESS DENIED" — that
      // weaker form passed on "No active session".
      check("PRECONDITION: on the socket they are admin", /AIDA SYSTEM STATUS/.test(text(before)), text(before).split("\n")[0]);
      const demote = await api("PUT", `/api/admin/players/${sockTarget.id}/role`, actor.token, { role: "player" });
      check("demoted", demote.status === 200);
      const after = await runSocketCommand(s, "admin status");
      check("the SAME open socket is refused at once (was: admin until reconnect)", /ACCESS DENIED/.test(text(after)),
        text(after).split("\n")[0]);
      check("and stays connected — a demotion is not a kick", s.connected);
    }

    console.log("\nAA-3 — `admin resetpw` signs the account out everywhere");
    {
      const warm = await api("GET", "/api/admin/players", resetTarget.token);
      check("PRECONDITION: the target's token works (and is now cached)", warm.status === 403, `${warm.status} (authenticated, not admin)`);
      const s = await connect(resetTarget.token); sockets.push(s);
      let disconnected = false;
      s.on("disconnect", () => { disconnected = true; });
      // Commands need a game session, so the admin acts from a real socket —
      // as they would in the terminal.
      const adminSock = await connect(actor.token); sockets.push(adminSock);
      const reset = await runSocketCommand(adminSock, `admin resetpw ${resetTarget.username}`);
      check("the reset ran", /Temporary password/.test(text(reset)),
        text(reset).replace(/Temporary password: \S+/, "Temporary password: <redacted>").split("\n")[0]);
      for (let i = 0; i < 20 && !disconnected; i++) await sleep(100);
      check("their live socket was closed (it stayed open)", disconnected);
      const after = await api("GET", "/api/admin/players", resetTarget.token);
      check("their old token is refused immediately (was: 60s grace)", after.status === 401, `${after.status}`);
    }

    console.log("\nAA-4 — `admin mute` is enforced (in-process: mutedUntil is not cached)");
    {
      const { setupContainer, getService } = await import("../src/di/container");
      const TOKENS = await import("../src/di/tokens");
      const { Server: SocketIOServer } = await import("socket.io");
      const loggerMod: any = await import("../src/logger");
      setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
      const accounts = getService<any>(TOKENS.ACCOUNT_ADMIN_SERVICE);
      const messages = getService<any>(TOKENS.MESSAGE_SERVICE);
      const forums = getService<any>(TOKENS.FORUM_SERVICE);
      const muted = httpTarget; // a player now
      await accounts.mute(muted.id, new Date(Date.now() + 5 * 60_000));
      const m = await messages.sendPrivateMessage(muted.id, actor.id, { subject: "fixture", content: "hello" });
      check("a muted player's private message is refused", m.success === false && m.error === "MUTED", m.error ?? "sent");
      // A MEMBER, so createPost gets past its membership check and the mute
      // check is what refuses. Without this the post fails on membership and
      // a check accepting that would pass with no mute enforcement at all.
      const forum = await prisma.forum.findFirst({ where: { isActive: true }, select: { id: true } });
      const member = await prisma.forumMember.create({ data: { userId: muted.id, forumId: forum!.id, handle: `${tag}mh` } });
      let postErr = "";
      try {
        await forums.createPost(muted.id, forum!.id, "t", "body", []);
      } catch (e: any) { postErr = e.message; }
      finally { await prisma.forumMember.delete({ where: { id: member.id } }); }
      check("and so is a forum post, by the MUTE (not membership)", /muted until/i.test(postErr), postErr.slice(0, 60) || "posted");
      await accounts.unmute(muted.id);
      // POSITIVE: the message must actually go through. The first version
      // asserted only "not refused as MUTED" — and passed while the call was
      // failing outright on a wrong argument shape.
      const m2 = await messages.sendPrivateMessage(muted.id, actor.id, { subject: "fixture", content: "hello again" });
      check("after unmute the same message SENDS", m2.success === true, m2.error ?? m2.message ?? "sent");
    }
  } finally {
    for (const s of sockets) s.disconnect();
    // Never leave a fixture holding an elevated role.
    try {
      await prisma.user.updateMany({ where: { id: { in: fixtures.map((f) => f.id) } }, data: { role: "player", mutedUntil: null } });
    } catch (err) { fail++; console.log(`  [FAIL] fixture demotion — ${(err as Error).message}`); }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch(async (e) => { console.error(e); process.exit(1); });
