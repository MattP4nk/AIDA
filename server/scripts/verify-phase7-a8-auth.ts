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
 * The lockout is exercised IN-PROCESS on a private AuthService (see below):
 * over HTTP it cost ~40 requests per run against the global /api rate limiter
 * and locked every other harness out on the second suite run in a window.
 * Over HTTP this now makes ~18 requests and 2 failed logins.
 *
 * Run with --record to re-baseline (it was recorded against the pre-move
 * routes and proved the extraction 18/18 identical, commit 0f6b3a4).
 * Needs the dev server.
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
/**
 * A CSRF token for this JWT. EVERY state-changing request needs one — Bearer
 * included; only login/register are exempt. This harness first sent refresh
 * and logout WITHOUT one, so both were answered 403 "CSRF token required" in
 * the pre-move AND post-move runs: they matched because neither ran, and the
 * extraction's refresh/logout were never exercised. Caught writing a later
 * harness, 2026-10-07.
 */
async function csrfFor(token: string): Promise<string> {
  const r = await fetch(`${BASE.replace("/api/auth", "")}/api/csrf-token`, { headers: { Authorization: `Bearer ${token}` } });
  const j: any = await r.json().catch(() => null);
  if (!j?.csrfToken) throw new Error(`no CSRF token: ${r.status} ${JSON.stringify(j).slice(0, 100)}`);
  return j.csrfToken;
}

async function call(method: string, path: string, opts: { body?: unknown; token?: string } = {}) {
  const needsCsrf = method !== "GET" && !["/login", "/register"].includes(path) && !!opts.token;
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "a8-auth-characterization",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(needsCsrf ? { "X-CSRF-Token": await csrfFor(opts.token!) } : {}),
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

  // ── one wrong password, over HTTP (the 401 shape) ──────────────────
  // The LOCKOUT is driven in-process below, on a private AuthService. Doing it
  // over HTTP cost ~11 failed logins and ~40 requests per run against the
  // server's global /api rate limiter (RATE_LIMIT_MAX_REQUESTS per 15 min per
  // IP), so two suite runs inside one window locked out EVERY harness that
  // logs in — 9 of them failed with 429 the first time it happened.
  rec("wrong-password", await call("POST", "/login", { body: { username: u1.username, password: "nope" } }));
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
    for (let i = 0; i < 4 && !proven; i++) {
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
    check("PRECONDITION: a same-second pair actually occurred", !!proven, proven ?? "4 pairs, none landed in one second");
  }

  // ── LOCKOUT, in-process, on a PRIVATE AuthService ──────────────────
  // Its own lockout map and a documentation-range IP, so nothing here touches
  // the running server's state. Covers what HTTP never reached: the per-IP
  // lockout across usernames, and the window expiring.
  {
    await import("reflect-metadata");
    const { AuthService } = await import("../src/services/authService");
    const quiet: any = { info() {}, warn() {}, error() {}, debug() {} };
    const svc: any = new AuthService(quiet);
    const meta = { ip: null, userAgent: null, lockoutIp: "203.0.113.7" };
    const attempt = async (username: string) => {
      try { await svc.login({ username, password: "nope" }, meta); return "ok"; }
      catch (e: any) { return `${e.statusCode ?? e.status ?? "?"}:${e.code}`; }
    };
    const ghost = `${tag}_lock`;
    const ten: string[] = [];
    for (let i = 0; i < 10; i++) ten.push(await attempt(ghost));
    check("10 failures are each a 401", ten.every((r) => r === "401:AUTH_FAILED"), ten[0]);
    const locked = await attempt(ghost);
    check("the 11th is ACCOUNT_LOCKED (429)", locked === "429:ACCOUNT_LOCKED", locked);
    const other = await attempt(`${tag}_other`);
    check("the account lock does not lock a different username", other === "401:AUTH_FAILED", other);
    // A LOCKED attempt throws before its failure is recorded, so the 11th
    // above did not count: 10 + 1 (other) + 19 = 30 recorded failures, and
    // the lock applies to the attempt AFTER the 30th (count >= 30).
    for (let i = 0; i < 19; i++) await attempt(`${tag}_spray${i}`);
    const ipLocked = await attempt(`${tag}_fresh`);
    check("30 failures across usernames trip the per-IP lockout", ipLocked === "429:IP_LOCKED", ipLocked);
    // Expire the windows and the locks lift.
    for (const v of svc.loginAttempts.values()) v.firstAttempt -= 16 * 60 * 1000;
    const after = await attempt(ghost);
    check("after the 15-minute window both locks lift", after === "401:AUTH_FAILED", after);
    svc.loginAttempts.clear();
  }

  const snapshot = unTag(out);
  check("the run exercised every step", Object.keys(snapshot).length >= 17, `${Object.keys(snapshot).length} steps`);
  check("PRECONDITION: the happy path actually succeeded", (snapshot as any)["login"].status === 200 && !!login.rawToken);
  // The guard that was missing: a characterization of refresh/logout that
  // recorded a CSRF rejection is not a characterization of refresh/logout.
  check("PRECONDITION: refresh actually ran (not a CSRF 403)", (snapshot as any)["refresh"].status === 200,
    String((snapshot as any)["refresh"].status));
  check("PRECONDITION: logout actually ran (not a CSRF 403)", (snapshot as any)["logout"].status === 200,
    String((snapshot as any)["logout"].status));

  if (RECORD) {
    // Never record a broken run as the truth: a rate-limited or down server
    // produced a baseline full of 429s once, and it printed "recorded".
    if (fail > 0) {
      console.log("  NOT RECORDED — a check failed above; the baseline would encode that failure.");
    } else {
      writeFileSync(BASELINE, JSON.stringify(snapshot, null, 1) + "\n");
      console.log(`  recorded -> ${BASELINE}`);
    }
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
