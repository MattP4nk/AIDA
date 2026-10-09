/**
 * A4 — the id a listing SHOWS is an id the next command ACCEPTS.
 *
 * Listings shorten 25-char cuids — `stories` prints 16 chars, `admin reports`
 * 8 — while `story <id>`, `story abandon <id>` and `admin resolve mail <id>`
 * did `findUnique` on the full id. What the player was shown could never be
 * found (bounties had the same defect; verify-a4-bounty covers them). And
 * `story <full id>` opened ANY player's arc: only abandon checked ownership.
 *
 *   D-1  `story <prefix>` opens your arc (end to end, over a socket)
 *   D-2  another player's arc is "not found", by full id or prefix
 *   D-3  `story abandon <prefix>` abandons it
 *   D-4  a mail report resolves by the 8-char prefix `admin reports` shows
 *   D-5  a prefix shorter than 8, or matching two rows, is refused
 *
 * Fixtures: a private faction; story arcs, a message and a report owned by
 * fixture accounts; all deleted by id in `finally`. The persona an arc names
 * is an EXISTING one, referenced read-only (the FK needs a row).
 *
 * Needs the dev server. Run: npx tsx scripts/verify-a4-display-ids.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// The server has no socket.io-client dependency; harnesses borrow the client's.
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { deleteRegisteredUsers } from "./lib/fixture-users";

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

async function main() {
  console.log("\n=== A4 — displayed ids resolve ===");
  const tag = `a4x${Date.now().toString(36)}`;
  const me = await register(`${tag}m`);
  const other = await register(`${tag}o`);
  const persona = await prisma.aIPersona.findFirstOrThrow({ select: { id: true } });
  const faction = await prisma.faction.create({ data: { name: `fx-${tag}`, description: "harness fixture" } });
  const arcIds: string[] = [];
  const mkArc = async (userId: string, title: string) => {
    const a = await prisma.storyArc.create({
      data: { title, description: "fixture", factionId: faction.id, issuedBy: persona.id, assignedTo: userId, totalSteps: 1 },
    });
    arcIds.push(a.id);
    return a;
  };
  let messageId: string | null = null;
  const reportIds: string[] = [];

  const s = ioClient(BASE, { auth: { token: me.token }, transports: ["websocket"], reconnection: false });
  try {
    const mine = await mkArc(me.id, `MINE ${tag}`);
    const theirs = await mkArc(other.id, `THEIRS ${tag}`);
    await new Promise<void>((res, rej) => {
      s.once("connect_error", rej);
      s.once("connect", () => s.emit("authenticate:request", (a: any) => (a?.success ? res() : rej(new Error(JSON.stringify(a))))));
    });
    const run = (command: string): Promise<string> => new Promise((res) => {
      const t = setTimeout(() => res("<timeout>"), 8000);
      s.once("command:result", (x: any) => { clearTimeout(t); res(Array.isArray(x?.output) ? x.output.join("\n") : String(x?.output ?? x?.error ?? "")); });
      s.emit("command:execute", { command, terminalId: "a4x" });
    });

    console.log("\nD-1 — `story <prefix>` opens your arc");
    const shown = mine.id.substring(0, 16);
    const list = await run("stories");
    check("PRECONDITION: `stories` shows the 16-char prefix", list.includes(shown), list.includes(shown) ? shown : list.split("\n")[0]);
    const view = await run(`story ${shown}`);
    check("`story <shown prefix>` opens it (was: Story arc not found)", view.includes(`MINE ${tag}`.toUpperCase()), view.split("\n").find((l) => l.trim()) ?? "");

    console.log("\nD-2 — another player's arc stays private");
    const peekFull = await run(`story ${theirs.id}`);
    check("by FULL id: not found (was: shown — only abandon checked ownership)",
      /not found/i.test(peekFull) && !peekFull.includes(`THEIRS ${tag}`.toUpperCase()), peekFull.split("\n")[0]);
    const peekPrefix = await run(`story ${theirs.id.substring(0, 16)}`);
    check("by prefix: not found", /not found/i.test(peekPrefix), peekPrefix.split("\n")[0]);

    console.log("\nD-3 — `story abandon <prefix>`");
    const ab = await run(`story abandon ${shown}`);
    const after = await prisma.storyArc.findUniqueOrThrow({ where: { id: mine.id }, select: { status: true } });
    check("abandons it", /abandoned/i.test(ab) && after.status === "abandoned", `${ab.split("\n")[0]} / ${after.status}`);
    const theirsAfter = await prisma.storyArc.findUniqueOrThrow({ where: { id: theirs.id }, select: { status: true } });
    check("and the other player's arc is untouched", theirsAfter.status === "active", theirsAfter.status);

    console.log("\nD-4/D-5 — mail reports by the 8-char prefix, in-process");
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const messages = getService<any>(TOKENS.MESSAGE_SERVICE);
    const msg = await prisma.message.create({ data: { senderId: other.id, recipientId: me.id, subject: "fixture", content: "x" } });
    messageId = msg.id;
    const rep = await prisma.messageReport.create({ data: { reporterId: me.id, messageId: msg.id, reason: "fixture" } });
    reportIds.push(rep.id);
    const tooShort = await messages.resolveMessageReport(me.id, rep.id.substring(0, 6), "dismiss");
    check("a 6-char prefix is refused (below the minimum)", tooShort.success === false, tooShort.message);
    const r = await messages.resolveMessageReport(me.id, rep.id.substring(0, 8), "dismiss");
    const repAfter = await prisma.messageReport.findUniqueOrThrow({ where: { id: rep.id }, select: { status: true } });
    check("the 8-char prefix `admin reports` shows resolves it (was: Report not found)",
      r.success === true && repAfter.status === "dismissed" && r.report?.id === rep.id, `${r.message} / ${repAfter.status}`);

    // D-5 — ambiguity, on the shared helper itself. Testing it through the
    // DB needs two cuids sharing 8+ chars, which consecutive fixtures often
    // do not (7 on one run) — a check that mostly skips is not a check.
    const { resolveIdOrPrefix } = await import("../src/utils/idPrefix");
    const rows = [{ id: "abcdefgh111" }, { id: "abcdefgh222" }];
    const lookup = (input: string) => resolveIdOrPrefix(
      input,
      async (id) => rows.find((r) => r.id === id) ?? null,
      async (prefix) => rows.filter((r) => r.id.startsWith(prefix)).slice(0, 2),
    );
    const amb = await lookup("abcdefgh");
    check("a prefix matching two rows is refused as ambiguous", !amb.ok && amb.reason === "ambiguous");
    const uniq = await lookup("abcdefgh1");
    check("POSITIVE: one more char makes it unique", uniq.ok && uniq.row.id === "abcdefgh111");
    const short = await lookup("abcdefg");
    check("below 8 chars is not found, even when unique", !short.ok && short.reason === "not_found");
    const exact = await lookup("abcdefgh222");
    check("an exact id always wins", exact.ok && exact.row.id === "abcdefgh222");
  } finally {
    s.disconnect();
    try {
      await prisma.messageReport.deleteMany({ where: { id: { in: reportIds } } });
      if (messageId) await prisma.message.deleteMany({ where: { id: messageId } });
      await prisma.storyArc.deleteMany({ where: { id: { in: arcIds } } });
      await prisma.faction.delete({ where: { id: faction.id } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
