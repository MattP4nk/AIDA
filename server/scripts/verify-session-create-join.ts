/**
 * Concurrent session creation for one user JOINS instead of failing.
 *
 * Every page load authenticates twice — SocketService on `connect`, App.svelte
 * with `authenticate:request` — about 2ms apart, and two tabs opened together
 * race the same way. gameStateManager.createSession used a timestamp lock that
 * threw "Session creation already in progress" at the second caller, so a
 * user who WAS authenticating was told it failed, and App.svelte's terminal
 * init then timed out on an empty tab list. Found driving the real client in
 * a browser: a fresh account sat on "Initializing AIDA Terminal..." forever.
 *
 * Now a concurrent caller awaits the creation already running and gets the
 * same session.
 *
 * Run: npx tsx scripts/verify-session-create-join.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

async function main() {
  console.log("\n=== Concurrent createSession joins the one in flight ===");
  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const gsm = getService<any>(TOKENS.GAME_STATE_MANAGER);
  const auth = getService<any>(TOKENS.AUTH_SERVICE);

  // A real, fully provisioned account — through the same AuthService the
  // register route uses. Password is random and never printed.
  const tag = `scj${Date.now().toString(36)}`;
  const { user } = await auth.register(
    { username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" },
    { ip: null, userAgent: "verify-session-create-join", lockoutIp: "203.0.113.9" },
  );
  check("PRECONDITION: fixture account registered", !!user?.id, user?.username);

  try {
    const [a, b] = await Promise.allSettled([
      gsm.createSession(user.id, "sock-A", "127.0.0.1"),
      gsm.createSession(user.id, "sock-B", "127.0.0.1"),
    ]);
    check("both concurrent calls succeed", a.status === "fulfilled" && b.status === "fulfilled",
      [a, b].map((r) => r.status === "rejected" ? (r.reason as Error).message : "ok").join(" / "));
    check("and they get the SAME session",
      a.status === "fulfilled" && b.status === "fulfilled" && a.value === b.value);
    check("the lock is released afterwards", !gsm.sessionCreations.has(user.id));

    // POSITIVE CONTROL: a later, sequential call still runs normally.
    const c = await gsm.createSession(user.id, "sock-C", "127.0.0.1");
    check("a later sequential call still creates a session", !!c && c.userId === user.id);
  } finally {
    await gsm.destroySession(user.id).catch((err: Error) => { fail++; console.log(`  [FAIL] cleanup — ${err.message}`); });
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
