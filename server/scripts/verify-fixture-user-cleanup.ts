/**
 * Harnesses delete fixture users WITH their home servers (found 2026-10-09).
 *
 * Registration gives every account a home GameServer, and `GameServer.owner`
 * has no onDelete — so `prisma.user.delete` in ~25 harnesses left each home
 * behind, ownerless, holding an IP and a filesystem: 247 of them in the dev DB.
 * The game never deletes users; harnesses go through
 * scripts/lib/delete-fixture-user.ts.
 *
 *   FU-1  the helper removes the user AND their home (nodes cascade)
 *   FU-2  and nobody else's home
 *   FU-3  no harness deletes users any other way — matched as CALLS in the
 *         parsed file, so a comment or a string (verify-a4-command-writes
 *         keeps probe source in strings) cannot match; shown to match first
 *   FU-4  every suite harness that REGISTERS accounts deletes them: 28 never
 *         did (review 2026-10-09). scripts/lib/fixture-users.ts records every
 *         registration through the route; an in-process AuthService.register
 *         is recorded with trackFixtureUser. The harness calls
 *         deleteRegisteredUsers in its cleanup.
 *   FU-5  the recorder itself: a registration through `fetch` is recorded,
 *         and deleteRegisteredUsers removes the account and its home
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-fixture-user-cleanup.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { stripComments } from "./lib/strip-comments";
import { deleteFixtureUsers } from "./lib/delete-fixture-user";
import { deleteRegisteredUsers, registeredUserIds } from "./lib/fixture-users";

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
  if (!j?.user?.id) throw new Error(`register ${username}: ${r.status}`);
  return j.user.id as string;
}

async function main() {
  console.log("\n=== Fixture users go with their homes ===");
  const tag = `fu${Date.now().toString(36)}`;
  try {
    const doomed = await register(`${tag}d`);
    const kept = await register(`${tag}k`);
    const homeOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { homeServerId: true } })).homeServerId!;
    const doomedHome = await homeOf(doomed);
    const keptHome = await homeOf(kept);

    console.log("\nFU-1 / FU-2 — the helper");
    const nodes = await prisma.fileSystemNode.count({ where: { serverId: doomedHome } });
    check("PRECONDITION: the home exists with a filesystem", nodes > 0, `${nodes} nodes`);
    await deleteFixtureUsers(prisma, [doomed]);
    check("the user is gone", (await prisma.user.findUnique({ where: { id: doomed } })) === null);
    check("and so is their home (was: left ownerless)", (await prisma.gameServer.findUnique({ where: { id: doomedHome } })) === null);
    check("and its filesystem", (await prisma.fileSystemNode.count({ where: { serverId: doomedHome } })) === 0);
    check("another player's home is untouched", (await prisma.gameServer.findUnique({ where: { id: keptHome } }))?.ownerId === kept);

    console.log("\nFU-1b — a fixture that hacked, was added as a contact, or posted");
    // Required relations with no onDelete RESTRICT a user delete: hack logs
    // (either side), posts, message reports, and contacts pointing at the user.
    // A message report needs a message, so it is covered by the code, not here.
    const busy = await register(`${tag}b`);
    const busyHome = await homeOf(busy);
    // Both directions: busy hacked kept's home, and was hacked (its home is a
    // target — that row blocks deleting the HOME, not just the user).
    await prisma.hackLog.create({ data: { attackerId: busy, targetId: kept, targetServerId: keptHome, method: "bruteforce", stealthLevel: 0, success: false, detected: false, accessLevel: 0, evidenceLeft: 0 } });
    await prisma.hackLog.create({ data: { attackerId: kept, targetId: busy, targetServerId: busyHome, method: "bruteforce", stealthLevel: 0, success: false, detected: false, accessLevel: 0, evidenceLeft: 0 } });
    await prisma.contact.create({ data: { userId: kept, contactUserId: busy, handle: `${tag}b`, status: "accepted" } });
    const forum = await prisma.forum.findFirst({ select: { id: true } });
    check("PRECONDITION: a forum exists to post in", !!forum);
    if (forum) await prisma.post.create({ data: { forumId: forum.id, authorId: busy, authorHandle: `${tag}b`, title: "fixture", content: "fixture" } });
    // Its private mission offer, and a world mission (with a faction) it holds
    // a copy of: the offer goes, the world mission stays.
    const offer = await prisma.mission.create({ data: { title: `${tag} offer`, description: "fixture", type: "recon" } });
    await prisma.playerMission.create({ data: { userId: busy, missionId: offer.id } });
    // An offer generated for it but never registered: no copy, only its creator.
    const unregistered = await prisma.mission.create({ data: { title: `${tag} unregistered`, description: "fixture", type: "recon", createdBy: busy } });
    const anyFaction = await prisma.faction.findFirst({ select: { id: true } });
    const world = anyFaction ? await prisma.mission.create({ data: { title: `${tag} world`, description: "fixture", type: "recon", factionId: anyFaction.id } }) : null;
    if (world) await prisma.playerMission.create({ data: { userId: busy, missionId: world.id } });
    check("PRECONDITION: a faction exists for the world-mission control", !!world);
    let deleted = true;
    try { await deleteFixtureUsers(prisma, [busy]); } catch { deleted = false; }
    check("its private mission offer goes with it (was: left behind, two per fresh account)",
      (await prisma.mission.findUnique({ where: { id: offer.id } })) === null);
    check("and an offer made for it but never registered (no copy, only its creator)",
      (await prisma.mission.findUnique({ where: { id: unregistered.id } })) === null);
    check("POSITIVE: a world mission it held a copy of stays",
      !!world && (await prisma.mission.findUnique({ where: { id: world.id } })) !== null);
    if (world) await prisma.mission.delete({ where: { id: world.id } });
    check("it can be deleted (was: RESTRICT on hack_logs — 55 tutorial probes could not be)",
      deleted && (await prisma.user.findUnique({ where: { id: busy } })) === null && (await prisma.gameServer.findUnique({ where: { id: busyHome } })) === null);
    check("and the other player's contact row pointing at it went with it",
      (await prisma.contact.count({ where: { userId: kept, contactUserId: busy } })) === 0);
    await deleteFixtureUsers(prisma, [kept]);

    console.log("\nFU-3 — every harness uses it");
    /** Calls of the form `<anything>.user.delete(…)` / `.deleteMany(…)`. */
    const userDeletes = (source: string): number => {
      const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      let n = 0;
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          /^delete(Many)?$/.test(node.expression.name.text) &&
          ts.isPropertyAccessExpression(node.expression.expression) && node.expression.expression.name.text === "user") n++;
        ts.forEachChild(node, visit);
      };
      visit(sf);
      return n;
    };
    check("PRECONDITION: the matcher finds a direct delete, split across lines",
      userDeletes("await prisma.user\n  .deleteMany({ where: {} });") === 1);
    check("PRECONDITION: and ignores one in a comment or a string",
      userDeletes("// prisma.user.delete()\nconst s = 'db.user.delete()';") === 0);
    const offenders = readdirSync("scripts").filter((f) => f.endsWith(".ts"))
      .filter((f) => userDeletes(readFileSync(`scripts/${f}`, "utf8")) > 0);
    check("no harness deletes users directly", offenders.length === 0, offenders.join(", "));

    console.log("\nFU-4 — every harness that registers accounts deletes them");
    /** Code (not comments) that registers through the API, and code that deletes what it registered. */
    // Both ways a harness makes an account: the HTTP route (any spelling of
    // its URL — a8-auth posts "/register" to an auth base URL) and
    // AuthService.register in-process. The first pass matched only
    // "/api/auth/register" and missed both of those (review 2026-10-09).
    const viaHttp = (src: string) => /auth\/register|["'`]\/register["'`]/.test(src);
    const inProcess = (src: string) => /\bauth\w*\s*\.\s*register\s*\(/i.test(src);
    const registers = (src: string) => viaHttp(src) || inProcess(src);
    const deletes = (src: string) => /\b(deleteRegisteredUsers|deleteFixtureUsers)\(/.test(src);
    check("PRECONDITION: the matchers see every form, and not in a comment",
      registers("fetch(`${BASE}/api/auth/register`)") && registers('call("POST", "/register")') &&
      inProcess("await auth.register({ username })") && deletes("await deleteRegisteredUsers(prisma)") &&
      !deletes(stripComments("// await deleteRegisteredUsers(prisma)\n")));
    const leakers = readdirSync("scripts").filter((f) => /^verify-.*\.ts$/.test(f)).filter((f) => {
      const src = stripComments(readFileSync(`scripts/${f}`, "utf8"));
      return registers(src) && !deletes(src);
    });
    check("no suite harness leaves its registered accounts behind (was: 28 did)", leakers.length === 0, leakers.join(", "));
    // The fetch recorder cannot see an in-process registration: it must be
    // tracked by hand (trackFixtureUser) or it survives the run.
    const untracked = readdirSync("scripts").filter((f) => /^verify-.*\.ts$/.test(f)).filter((f) => {
      const src = stripComments(readFileSync(`scripts/${f}`, "utf8"));
      return inProcess(src) && !/\btrackFixtureUser\(|\bdeleteFixtureUsers\(/.test(src);
    });
    check("every in-process registration is tracked for cleanup", untracked.length === 0, untracked.join(", "));

    console.log("\nFU-5 — the recorder");
    const before = registeredUserIds().length;
    const recorded = await register(`${tag}r`);
    check("a registration through fetch is recorded", registeredUserIds().length === before + 1 && registeredUserIds().includes(recorded));
    const recordedHome = await homeOf(recorded);
    await deleteRegisteredUsers(prisma);
    check("deleteRegisteredUsers removes the account and its home",
      (await prisma.user.findUnique({ where: { id: recorded } })) === null && (await prisma.gameServer.findUnique({ where: { id: recordedHome } })) === null);
  } finally {
    // Whatever failed above, nothing registered here survives the run.
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
