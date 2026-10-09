/**
 * Session lifetime and logout — maintainer decisions of 2026-10-08.
 *
 *   SP-1  A DB session expires exactly when its token does. The session was a
 *         hardcoded 24h beside a token lifetime from `JWT_EXPIRES_IN`; they
 *         agreed only while the config said "24h". Tested in-process with
 *         JWT_EXPIRES_IN=2h, because under the default the old code passes
 *         too (a check that cannot fail proves nothing).
 *   SP-2  Logout marks a player offline only when nothing else of theirs is
 *         connected. It was unconditional, so logging out of one tab told
 *         everyone a player with other live tabs was offline.
 *
 * Needs the dev server (SP-2). Run: npx tsx scripts/verify-session-policy.ts
 */
import "reflect-metadata";
process.env.JWT_EXPIRES_IN = "2h"; // before ANY import reads config
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
// The server has no socket.io-client dependency; harnesses borrow the client's.
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { deleteRegisteredUsers, trackFixtureUser } from "./lib/fixture-users";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
async function register(username: string) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const j: any = await r.json();
  if (!j?.token) throw new Error(`register ${username}: ${r.status}`);
  return { id: j.user.id as string, token: j.token as string };
}
async function logout(token: string) {
  const c = await fetch(`${BASE}/api/csrf-token`, { headers: { Authorization: `Bearer ${token}` } });
  const csrf = ((await c.json()) as any).csrfToken;
  const r = await fetch(`${BASE}/api/auth/logout`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "X-CSRF-Token": csrf, "Content-Type": "application/json" },
  });
  return r.status;
}
const online = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { isOnline: true } })).isOnline;

async function main() {
  console.log("\n=== Session lifetime and logout ===");
  const tag = `sp${Date.now().toString(36)}`;

  console.log("\nSP-1 — the session expires with its token (in-process, JWT_EXPIRES_IN=2h)");
  {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const auth = getService<any>(TOKENS.AUTH_SERVICE);
    const meta = { ip: null, userAgent: "harness", lockoutIp: "127.0.0.1" };
    const out = await auth.register({ username: `${tag}x`, email: `${tag}x@fixture.invalid`, password: randomUUID() + "Aa1!" }, meta);
    trackFixtureUser(out.user.id); // in-process: the fetch recorder never sees it
    const exp = (jwt.decode(out.token) as { exp: number }).exp * 1000;
    const session = await prisma.userSession.findFirstOrThrow({ where: { token: out.token }, select: { expiresAt: true } });
    const hours = (session.expiresAt.getTime() - Date.now()) / 3_600_000;
    check("PRECONDITION: the token itself lives 2h", Math.abs((exp - Date.now()) / 3_600_000 - 2) < 0.05);
    check("the DB session expires when the token does (was: always 24h)",
      Math.abs(session.expiresAt.getTime() - exp) < 1000, `session ${hours.toFixed(2)}h`);
  }

  console.log("\nSP-2 — logout leaves a player with another live tab ONLINE");
  {
    const a = await register(`${tag}a`);
    const s = ioClient(BASE, { auth: { token: a.token }, transports: ["websocket"], reconnection: false });
    await new Promise<void>((res, rej) => {
      s.once("connect_error", rej);
      s.once("connect", () => s.emit("authenticate:request", (x: any) => (x?.success ? res() : rej(new Error(JSON.stringify(x))))));
    });
    // The open socket is "another tab"; this HTTP logout is the tab closing.
    check("PRECONDITION: online while the socket is open", (await online(a.id)) === true);
    const st = await logout(a.token);
    check("PRECONDITION: logout succeeded", st === 200, `${st}`);
    check("still ONLINE after logout while another tab is connected (was: offline)", (await online(a.id)) === true);
    s.disconnect();
    for (let i = 0; i < 30 && (await online(a.id)); i++) await new Promise((r) => setTimeout(r, 100));
    check("POSITIVE: offline once the last socket closes", (await online(a.id)) === false);

    const b = await register(`${tag}b`);
    check("PRECONDITION: a fresh account is online", (await online(b.id)) === true);
    await logout(b.token);
    check("POSITIVE: logout with no live socket marks offline", (await online(b.id)) === false);
  }

  await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch(async (e) => {
  console.error(e);
  await deleteRegisteredUsers(prisma).catch((err: unknown) => console.error("cleanup — fixture users:", err));
  process.exit(1);
});
