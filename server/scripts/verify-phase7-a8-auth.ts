/**
 * Phase 7 A8 — the auth API behaves identically after moving into AuthService.
 *
 * `routes/auth.ts` held the whole auth domain inside HTTP handlers — register
 * alone was a 250-line provisioning pipeline (user, progress, home server,
 * filesystem, faction standings, topology link, session, audit). A8 moves it
 * into `services/authService.ts` and leaves the routes as thin adapters.
 *
 * Security-critical and NOT covered by the golden master (which drives
 * commands, not HTTP). So this characterizes the API end to end against the
 * running dev server: every step's status, error code, message and cookie
 * attributes, across register / duplicate / wrong-password-to-lockout /
 * login / email login / verify / refresh / stale token / logout / no token /
 * garbage token, PLUS the database rows registration and the session
 * lifecycle leave behind. Tokens, ids, IPs and timestamps are normalised out.
 *
 * Run with --record BEFORE the move, then plain afterwards.
 * Needs the dev server. Uses 10 failed logins per run: the per-IP lockout
 * trips at 30 and lives in the server's memory, so do not run it three times
 * against one server process without a restart.
 *
 * Run: npx tsx scripts/verify-phase7-a8-auth.ts
 */
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001/api/auth";
const RECORD = process.argv.includes("--record");
const BASELINE = new URL("./a8-auth.baseline.json", import.meta.url).pathname;

let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

/** Status + body shape + cookie attributes, with volatile values removed. */
async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "a8-auth-characterization",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const json: any = await r.json().catch(() => null);
  const cookies = r.headers.getSetCookie().map((c) =>
    c.split(";").map((p, i) => (i === 0 ? p.split("=")[0] + "=<v>" : p.trim()))
      .filter((p) => !/^expires=/i.test(p)).sort().join("; "));
  const scrub = (v: any): any => {
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k,
        ["token", "id", "homeIp", "createdAt", "lastLogin", "timestamp", "requestId"].includes(k)
          ? (v[k] == null ? v[k] : `<${typeof v[k]}>`) : scrub(v[k])]));
    }
    return v;
  };
  return { status: r.status, body: scrub(json), cookies, rawToken: json?.token as string | undefined };
}

async function main() {
  console.log("\n=== A8 — auth API characterization ===");
  const tag = `a8a${Date.now().toString(36)}`;
  const out: Record<string, unknown> = {};
  const rec = (k: string, v: { status: number; body: unknown; cookies: string[] }) =>
    (out[k] = { status: v.status, body: v.body, cookies: v.cookies });
  // Names that differ per run are replaced in the RECORD so runs compare.
  const unTag = (v: unknown) => JSON.parse(JSON.stringify(v).split(tag).join("<tag>"));

  // ── register + duplicate ───────────────────────────────────────────
  const u1 = { username: `${tag}_1`, email: `${tag}_1@fixture.invalid`, password: "Fixture-Pass-123!" };
  const u2 = { username: `${tag}_2`, email: `${tag}_2@fixture.invalid`, password: "Fixture-Pass-456!" };
  rec("register", await call("POST", "/register", { body: u1 }));
  rec("register-duplicate", await call("POST", "/register", { body: u1 }));
  rec("register-invalid", await call("POST", "/register", { body: { username: "x", email: "bad", password: "1" } }));

  // ── wrong password until the per-account lockout ───────────────────
  const wrong: number[] = [];
  for (let i = 0; i < 10; i++) wrong.push((await call("POST", "/login", { body: { username: u1.username, password: "nope" } })).status);
  out["wrong-password-x10"] = wrong;
  rec("login-after-lockout", await call("POST", "/login", { body: { username: u1.username, password: u1.password } }));
  rec("login-unknown-user", await call("POST", "/login", { body: { username: `${tag}_ghost`, password: "x" } }));

  // ── the happy path on a second account ─────────────────────────────
  rec("register-2", await call("POST", "/register", { body: u2 }));
  const login = await call("POST", "/login", { body: { username: u2.username, password: u2.password } });
  rec("login", login);
  rec("login-by-email", await call("POST", "/login", { body: { username: u2.email, password: u2.password } }));
  const t1 = login.rawToken!;
  rec("verify", await call("GET", "/verify", { token: t1 }));
  const refreshed = await call("POST", "/refresh", { token: t1 });
  rec("refresh", refreshed);
  rec("verify-stale-after-refresh", await call("GET", "/verify", { token: t1 }));
  const t2 = refreshed.rawToken!;
  rec("verify-refreshed", await call("GET", "/verify", { token: t2 }));
  rec("logout", await call("POST", "/logout", { token: t2 }));
  rec("verify-after-logout", await call("GET", "/verify", { token: t2 }));
  rec("verify-no-token", await call("GET", "/verify"));
  rec("verify-garbage", await call("GET", "/verify", { token: "not.a.jwt" }));

  // ── what the database was left holding ─────────────────────────────
  const user = await prisma.user.findUnique({ where: { username: u2.username },
    select: { id: true, isActive: true, isOnline: true, role: true, homeServerId: true } });
  check("PRECONDITION: the second account exists", !!user);
  if (user) {
    const progress = await prisma.playerProgress.findUnique({ where: { userId: user.id } });
    const server = await prisma.gameServer.findUnique({ where: { id: user.homeServerId! } });
    const nodes = await prisma.fileSystemNode.findMany({ where: { serverId: user.homeServerId! },
      select: { name: true, type: true, permissions: true, createdBy: true, isProtected: true, isHidden: true, size: true } });
    const sessions = await prisma.userSession.findMany({ where: { userId: user.id }, select: { isActive: true, userAgent: true } });
    const audit = await prisma.auditLog.findMany({ where: { userId: user.id }, select: { action: true, resource: true, userAgent: true } });
    const p = progress as any;
    out["db"] = {
      user: { isActive: user.isActive, isOnline: user.isOnline, role: user.role, hasHomeServer: !!user.homeServerId },
      progress: p && Object.fromEntries(["discoveryLevel", "credits", "level", "experience", "hacking", "networking",
        "cryptography", "stealth", "socialEng", "forensics", "missionProgress", "achievements"].map((k) => [k, p[k]])),
      server: server && { name: server.name, type: server.type, isPlayerHome: server.isPlayerHome, ownerIsUser: server.ownerId === user.id,
        encryptionLevel: server.encryptionLevel, isOnline: server.isOnline, maxConnections: server.maxConnections,
        accessRules: JSON.parse(JSON.stringify(server.accessRules).split(user.id).join("<user>")) },
      nodes: nodes.map((n) => ({ ...n, createdBy: n.createdBy === user.id ? "<user>" : n.createdBy })).sort((a, b) => a.name.localeCompare(b.name)),
      sessions: sessions.map((s) => `${s.isActive}|${s.userAgent}`).sort(),
      audit: audit.map((a) => `${a.action}|${a.resource}|${a.userAgent}`).sort(),
      standings: await prisma.factionStanding?.count?.({ where: { userId: user.id } }).catch(() => "n/a"),
    };
  }

  // ── REGRESSION: two tokens for one user in the SAME second ─────────
  // Not part of the snapshot: this proves the jwtid fix deterministically.
  // A pair only counts once both tokens' `iat` match — the exact collision
  // condition — so a pass cannot be timing luck.
  {
    const iat = (t?: string) => (t ? JSON.parse(Buffer.from(t.split(".")[1]!, "base64url").toString()).iat : null);
    let proven: string | null = null;
    for (let i = 0; i < 8 && !proven; i++) {
      const [a, b] = await Promise.all([
        call("POST", "/login", { body: { username: u2.username, password: u2.password } }),
        call("POST", "/login", { body: { username: u2.username, password: u2.password } }),
      ]);
      if (iat(a.rawToken) !== null && iat(a.rawToken) === iat(b.rawToken)) {
        proven = `${a.status}/${b.status}, tokens ${a.rawToken === b.rawToken ? "IDENTICAL" : "distinct"}`;
        check("two logins in the SAME second both succeed with distinct tokens",
          a.status === 200 && b.status === 200 && a.rawToken !== b.rawToken, proven);
      } else if (a.status !== 200 || b.status !== 200) {
        // A collision 409 has no token, so iat cannot match; that IS the bug.
        proven = `${a.status}/${b.status}`;
        check("two logins in the SAME second both succeed with distinct tokens", false, `${proven} — ${JSON.stringify(a.status !== 200 ? a.body : b.body).slice(0, 120)}`);
      }
    }
    check("PRECONDITION: a same-second pair actually occurred", !!proven, proven ?? "8 pairs, none landed in one second");
  }

  const snapshot = unTag(out);
  check("the run exercised every step", Object.keys(snapshot).length >= 18, `${Object.keys(snapshot).length} steps`);
  check("PRECONDITION: the lockout actually tripped", (snapshot as any)["login-after-lockout"].status === 429);
  check("PRECONDITION: the happy path actually succeeded", (snapshot as any)["login"].status === 200 && !!login.rawToken);

  if (RECORD) {
    writeFileSync(BASELINE, JSON.stringify(snapshot, null, 1) + "\n");
    console.log(`  recorded -> ${BASELINE}`);
  } else {
    check("baseline exists", existsSync(BASELINE));
    const base = JSON.parse(readFileSync(BASELINE, "utf8"));
    const keys = [...new Set([...Object.keys(base), ...Object.keys(snapshot)])];
    const diff = keys.filter((k) => JSON.stringify(base[k]) !== JSON.stringify((snapshot as any)[k]));
    check("every step and every DB effect identical to the baseline", diff.length === 0,
      diff.length ? `differs: ${diff.join(", ")}` : `${keys.length} identical`);
    for (const k of diff.slice(0, 3)) {
      const was = base[k], now = (snapshot as any)[k];
      const fields = was && now && typeof was === "object" && !Array.isArray(was)
        ? [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((f) => JSON.stringify(was[f]) !== JSON.stringify(now[f]))
        : [null];
      for (const f of fields) {
        const w = f === null ? was : was[f], n = f === null ? now : now[f];
        console.log(`    ${k}${f ? "." + f : ""}\n      was: ${JSON.stringify(w).slice(0, 400)}\n      now: ${JSON.stringify(n).slice(0, 400)}`);
      }
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
