/**
 * A4 reads — what the player-info commands may reveal, and to whom.
 *
 *   I-1  `share_intel server <id>` wrote ANY server's name, IP, security level
 *        and owner into faction knowledge — the file branch had been limited
 *        to readable files (S10), the server branch never was. Now: only a
 *        server the player knows (owns, or has a discovered link to).
 *   I-2  `report file` still resolves from the root of the absolute path
 *        (S10 scoping) now that the hand walk is fileService.resolvePath.
 *   I-3  `who` reads the current server from the game session, not from the
 *        newest connection row.
 *   I-4  registration refuses a username that differs from an existing one
 *        only by case — the by-name lookups in the game are case-insensitive,
 *        and were ambiguous while "Bob" and "bob" could both exist. (Email
 *        was already safe: normalizeEmail at the route.)
 *
 * Fixture faction (no members but the fixture, no AI persona), deleted by id.
 * Needs the dev server. Run: npx tsx scripts/verify-a4-intel.ts
 */
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// The server has no socket.io-client dependency; harnesses borrow the client's.
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
async function register(username: string, email = `${username}@fixture.invalid`) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email, password: randomUUID() + "Aa1!" }),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function main() {
  console.log("\n=== A4 reads — intel commands reveal only what the player has ===");
  const tag = `a4i${Date.now().toString(36)}`;
  const reg = await register(tag);
  check("PRECONDITION: fixture account", !!reg.json?.token, `${reg.status}`);
  const userId: string = reg.json.user.id;
  const { homeServerId } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { homeServerId: true } });
  const home = homeServerId!;
  const homeDir = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: home, name: tag, type: "directory" }, select: { id: true } });
  // share_intel is gated on Social Engineering 10.
  await prisma.playerProgress.update({ where: { userId }, data: { socialEng: 10 } });

  const faction = await prisma.faction.create({ data: { name: `fx-${tag}`, description: "harness fixture" } });
  await prisma.factionMember.create({ data: { userId, factionId: faction.id, rank: "operative" } });
  const nodeIds: string[] = [];
  // Owned like a real file: the permissions and creator registration gave the
  // player's own home directory (a bare row is unreadable even to its owner).
  const owned = await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: homeDir.id }, select: { permissions: true, createdBy: true } });
  const mk = async (parentId: string, name: string, type: "file" | "directory" = "file") => {
    const n = await prisma.fileSystemNode.create({
      data: { serverId: home, parentId, name, type, content: type === "file" ? "intel" : null, size: 5,
        permissions: owned.permissions ?? {}, createdBy: owned.createdBy ?? userId },
    });
    nodeIds.unshift(n.id);
    return n;
  };

  // A server this player has NOT found: not owned, no discovered link touching it.
  const links = await prisma.discoveredLink.findMany({ where: { userId }, select: { link: { select: { sourceId: true, targetId: true } } } });
  const known = new Set(links.flatMap((l) => [l.link.sourceId, l.link.targetId]));
  const unknown = await prisma.gameServer.findFirstOrThrow({
    where: { id: { notIn: [...known, home] }, NOT: { ownerId: userId } }, select: { id: true },
  });

  const s = ioClient(BASE, { auth: { token: reg.json.token }, transports: ["websocket"], reconnection: false });
  try {
    await new Promise<void>((res, rej) => {
      s.once("connect_error", rej);
      s.once("connect", () => s.emit("authenticate:request", (a: any) => (a?.success ? res() : rej(new Error(JSON.stringify(a))))));
    });
    const run = (command: string): Promise<string> => new Promise((res) => {
      const t = setTimeout(() => res("<timeout>"), 8000);
      s.once("command:result", (x: any) => { clearTimeout(t); res(Array.isArray(x?.output) ? x.output.join("\n") : String(x?.output ?? x?.error ?? "")); });
      s.emit("command:execute", { command, terminalId: "a4i" });
    });
    await run("connect home");

    console.log("\nI-1 — share_intel server");
    {
      const out = await run(`share_intel server ${unknown.id}`);
      const leaked = await prisma.factionKnowledge.findFirst({ where: { factionId: faction.id, assetId: unknown.id } });
      check("an UNKNOWN server is refused (was: name, IP and owner written to faction knowledge)",
        /not found/i.test(out) && !leaked, out.split("\n")[0]);
      const ok = await run(`share_intel server ${home}`);
      const stored = await prisma.factionKnowledge.findFirst({ where: { factionId: faction.id, assetId: home } });
      check("POSITIVE: a server you own is shared", /Intel shared/.test(ok) && !!stored, ok.split("\n").find((l) => l.trim()) ?? "");
    }

    console.log("\nI-2 — report file resolves from the root (S10 scoping kept)");
    {
      const sub = await mk(homeDir.id, "sub", "directory");
      await mk(sub.id, "deep.txt");
      await run("cd /");
      const bare = await run(`report file deep.txt to fx-${tag}`);
      check("a bare name that exists only in another directory is NOT found", /File not found/.test(bare), bare.split("\n")[0]);
      const full = await run(`report file /home/${tag}/sub/deep.txt to fx-${tag}`);
      check("POSITIVE: the absolute path reports it", /Intel submitted/.test(full), full.split("\n")[0]);
      const nope = await run(`report file /home/${tag}/nosuchdir/deep.txt to fx-${tag}`);
      check("a missing directory is a 'not found', not a re-scope", /File not found/.test(nope), nope.split("\n")[0]);
    }

    console.log("\nI-3 — who");
    {
      const out = await run("who");
      check("`who` answers from the session (connected to home)", !/not connected/i.test(out) && out !== "<timeout>", out.split("\n")[0]);
    }
  } finally {
    s.disconnect();
    try {
      await prisma.fileSystemNode.deleteMany({ where: { id: { in: nodeIds } } });
      await prisma.factionKnowledge.deleteMany({ where: { factionId: faction.id } });
      await prisma.factionMember.deleteMany({ where: { factionId: faction.id } });
      await prisma.faction.delete({ where: { id: faction.id } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }

  console.log("\nI-4 — registration is case-insensitively unique");
  {
    const a = await register(`${tag}Case`);
    check("PRECONDITION: the first spelling registers", a.status === 201, `${a.status}`);
    const b = await register(`${tag}case`, `${tag}other@fixture.invalid`);
    check("a username differing only by case is refused", b.status === 409, `${b.status}`);
    // CHARACTERIZATION, not a fix check: email case was never a gap — the
    // route's validator normalizeEmail()s it before AuthService sees it. This
    // would pass with or without A4; it pins the boundary that makes it so.
    const c = await register(`${tag}x2`, `${tag}Case@fixture.invalid`.toUpperCase());
    check("(characterization) an email differing only by case is refused at the route", c.status === 409, `${c.status}`);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
