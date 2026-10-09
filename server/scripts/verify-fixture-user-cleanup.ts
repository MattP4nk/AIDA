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
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-fixture-user-cleanup.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { deleteFixtureUsers } from "./lib/delete-fixture-user";

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

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
