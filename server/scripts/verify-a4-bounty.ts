/**
 * A4 — bounty claim and completion, through BountyService.
 *
 * They were direct `db.client` writes in playerInfoCommands. Reading them
 * found a feature that could never have worked, and would have paid wrongly
 * if it had:
 *
 *   B-1  UNCLAIMABLE: `bounties` shows a 16-char id prefix; `bounty claim`
 *        looked it up with findUnique on the full 25-char cuid.
 *   B-2  CLAIM RACE: check-then-write; two hunters both "won".
 *   B-3  DOUBLE PAYOUT: completion was check-then-write, then paid.
 *   B-4  STALE PROOF: any access to the target's home EVER satisfied "hack
 *        the target's home" — including access from before the bounty.
 *   B-5  EXPIRED: claim ignored expiresAt.
 *   B-6  POST DEDUPE: nothing writes status "expired", so the first bounty
 *        to lapse blocked that faction from ever posting on that player again.
 *   B-7  PURGE: stolen files and the keys they granted are removed, the
 *        target is told durably, and failures are no longer swallowed.
 *
 * B-1 runs over a real socket (the bug is in what the player is SHOWN vs what
 * the command accepts). The races run in-process: the database is the
 * arbiter, so concurrency inside one process is the real race.
 *
 * Private fixtures throughout: a fixture FACTION with no members and no AI
 * persona, so postBounty notifies no real player and posts on no real forum.
 * Everything is deleted by id in `finally`.
 *
 * Needs the dev server (B-1, and registration). Run: npx tsx scripts/verify-a4-bounty.ts
 */
import "reflect-metadata";
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

async function register(tag: string) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const j: any = await r.json();
  if (!j?.token) throw new Error(`register ${tag}: ${r.status} ${JSON.stringify(j).slice(0, 120)}`);
  return { id: j.user.id as string, token: j.token as string };
}
const credits = async (userId: string) =>
  (await prisma.playerProgress.findUniqueOrThrow({ where: { userId }, select: { credits: true } })).credits;

async function main() {
  console.log("\n=== A4 — bounties: claimable, race-free, paid once ===");
  const tag = `a4b${Date.now().toString(36)}`;
  const hunterA = await register(`${tag}a`);
  const hunterB = await register(`${tag}b`);
  const target = await register(`${tag}t`);
  const { homeServerId: home } = await prisma.user.findUniqueOrThrow({ where: { id: target.id }, select: { homeServerId: true } });
  const homeDir = await prisma.fileSystemNode.findFirstOrThrow({
    where: { serverId: home!, name: `${tag}t`, type: "directory" }, select: { id: true },
  });
  const keyServer = await prisma.gameServer.findFirstOrThrow({ where: { isPlayerHome: false }, select: { id: true } });

  const faction = await prisma.faction.create({ data: { name: `fx-${tag}`, description: "harness fixture" } });
  const bountyIds: string[] = [];
  const connIds: string[] = [];
  let socket: ReturnType<typeof ioClient> | null = null;
  const mk = async (extra: Record<string, unknown> = {}) => {
    const b = await prisma.bounty.create({
      data: {
        targetUserId: target.id, targetUsername: `${tag}t`, issuedByFactionId: faction.id,
        reason: "harness fixture", rewardCredits: 1000, rewardReputation: 5, status: "active",
        expiresAt: new Date(Date.now() + 3_600_000), ...extra,
      },
    });
    bountyIds.push(b.id);
    return b;
  };
  const access = async (userId: string, connectedAt: Date) => {
    const c = await prisma.serverConnection.create({
      data: { userId, serverId: home!, isActive: false, accessLevel: 3, connectedAt },
    });
    connIds.push(c.id);
  };

  try {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const bounties = getService<any>(TOKENS.BOUNTY_SERVICE);

    console.log("\nB-1 — the id the listing SHOWS can be claimed (end to end)");
    {
      const b = await mk();
      const shown = b.id.substring(0, 16);
      socket = ioClient(BASE, { auth: { token: hunterA.token }, transports: ["websocket"], reconnection: false });
      const s = socket;
      await new Promise<void>((res, rej) => {
        s.once("connect_error", rej);
        s.once("connect", () => s.emit("authenticate:request", (a: any) => (a?.success ? res() : rej(new Error(JSON.stringify(a))))));
      });
      const run = (command: string): Promise<string> => new Promise((res) => {
        const t = setTimeout(() => res("<timeout>"), 8000);
        s.once("command:result", (x: any) => { clearTimeout(t); res(Array.isArray(x?.output) ? x.output.join("\n") : String(x?.output ?? x?.error ?? "")); });
        s.emit("command:execute", { command, terminalId: "a4b" });
      });
      const list = await run("bounties");
      check("PRECONDITION: `bounties` shows the 16-char id", list.includes(shown), list.includes(shown) ? shown : list.split("\n")[0]);
      const claim = await run(`bounty claim ${shown}`);
      check("`bounty claim <shown id>` claims it (was: Bounty not found)", /BOUNTY CLAIMED/.test(claim), claim.split("\n").find((l) => l.trim()) ?? "");
      const row = await prisma.bounty.findUniqueOrThrow({ where: { id: b.id } });
      check("and the row records the claim", row.status === "claimed" && row.claimedByUserId === hunterA.id, `${row.status}/${row.claimedByUserId === hunterA.id}`);
      check("the claim text no longer sends the hunter after a proof.log that nothing checks", !/proof\.log/.test(claim));
    }

    console.log("\nB-2 — two hunters claiming at once: exactly one wins");
    for (let round = 0; round < 5; round++) {
      const b = await mk();
      const [ra, rb] = await Promise.all([bounties.claim(b.id, hunterA.id), bounties.claim(b.id, hunterB.id)]);
      const winners = [ra, rb].filter((r: any) => r.ok).length;
      const row = await prisma.bounty.findUniqueOrThrow({ where: { id: b.id } });
      const winnerId = ra.ok ? hunterA.id : hunterB.id;
      const loser = ra.ok ? rb : ra;
      check(`round ${round + 1}: one winner, and the row names THAT winner`,
        winners === 1 && row.claimedByUserId === winnerId && /already claimed/.test(loser.error ?? ""),
        `${winners} winner(s); loser: ${loser.error ?? "<won too>"}`);
    }

    console.log("\nB-3 + B-7 — completing twice at once pays ONCE; the stolen file and its key are purged");
    {
      const stolen = await prisma.fileSystemNode.create({
        data: { serverId: home!, parentId: homeDir.id, name: "loot.dat", type: "file", content: "k", size: 1,
          metadata: { isDownloaded: true, sourceServerId: keyServer.id } },
      });
      const key = await prisma.serverAccessKey.create({
        data: { userId: target.id, serverId: keyServer.id, keyValue: "fx", source: "file_download", sourceFileId: stolen.id },
      });
      const b = await mk({ stolenFileIds: [stolen.id] });
      const claimed = await bounties.claim(b.id, hunterA.id);
      check("PRECONDITION: claimed", claimed.ok === true, claimed.error ?? "");
      await access(hunterA.id, new Date());
      const before = await credits(hunterA.id);
      const notesBefore = await prisma.notification.count({ where: { userId: target.id, type: "security_alert" } });
      const [r1, r2] = await Promise.all([bounties.complete(b.id, hunterA.id), bounties.complete(b.id, hunterA.id)]);
      const oks = [r1, r2].filter((r: any) => r.ok).length;
      const delta = (await credits(hunterA.id)) - before;
      check("exactly one completion succeeded", oks === 1, `${oks}; ${[r1, r2].map((r: any) => r.error ?? "ok").join(" | ")}`);
      check("credits paid exactly once", delta === 1000, `+${delta}`);
      const standing = await prisma.factionStanding.findUnique({ where: { userId_factionId: { userId: hunterA.id, factionId: faction.id } } });
      check("reputation paid exactly once", standing?.reputation === 5, `${standing?.reputation}`);
      check("the stolen file is gone", !(await prisma.fileSystemNode.findUnique({ where: { id: stolen.id } })));
      check("and the key it granted is revoked", !(await prisma.serverAccessKey.findUnique({ where: { id: key.id } })));
      const win: any = r1.ok ? r1 : r2;
      check("the hunter's report counts them", win.filesDeleted === 1 && win.keysRevoked === 1, `${win.filesDeleted} file / ${win.keysRevoked} key`);
      const notesAfter = await prisma.notification.count({ where: { userId: target.id, type: "security_alert" } });
      check("the target is told DURABLY (a notification row, not a socket-only emit)", notesAfter === notesBefore + 1, `${notesBefore} → ${notesAfter}`);
    }

    console.log("\nB-4 — access from BEFORE the bounty does not complete it");
    {
      const posted = new Date(Date.now() - 60_000);
      const b = await mk({ createdAt: posted });
      await bounties.claim(b.id, hunterB.id);
      await access(hunterB.id, new Date(posted.getTime() - 86_400_000)); // a day before posting
      const stale = await bounties.complete(b.id, hunterB.id);
      check("stale access is refused", stale.ok === false && /since this bounty was posted/.test(stale.error), stale.error ?? "COMPLETED");
      // POSITIVE: the same hunter, after a fresh hack, completes it.
      await access(hunterB.id, new Date());
      const fresh = await bounties.complete(b.id, hunterB.id);
      check("POSITIVE: fresh access completes it", fresh.ok === true, fresh.error ?? "");
    }

    console.log("\nB-5 — an expired bounty cannot be claimed; nor your own");
    {
      const b = await mk({ expiresAt: new Date(Date.now() - 1000) });
      const r = await bounties.claim(b.id, hunterA.id);
      const row = await prisma.bounty.findUniqueOrThrow({ where: { id: b.id } });
      check("expired claim refused, row untouched", r.ok === false && /expired/.test(r.error) && row.claimedByUserId === null && row.status === "active", r.error ?? "CLAIMED");
      const own = await bounties.claim((await mk()).id, target.id);
      check("self-claim refused", own.ok === false && /yourself/.test(own.error), own.error ?? "CLAIMED");
    }

    console.log("\nB-6 — a lapsed bounty does not block the faction from posting again");
    {
      // Clear the board for this (target, faction) pair, then leave ONE lapsed
      // bounty still marked active — the state nothing ever cleans up.
      await prisma.bounty.updateMany({ where: { id: { in: bountyIds }, status: "active" }, data: { status: "completed" } });
      await mk({ expiresAt: new Date(Date.now() - 1000) });
      const hcs = getService<any>(TOKENS.HACK_COUNTERMEASURE_SERVICE);
      await hcs.postBounty(target.id, faction.id, "fixture-server", keyServer.id, 90);
      const posted = await prisma.bounty.findMany({ where: { issuedByFactionId: faction.id, id: { notIn: bountyIds } }, select: { id: true } });
      bountyIds.push(...posted.map((p) => p.id));
      check("a new bounty was posted", posted.length === 1, `${posted.length}`);
      // POSITIVE: a LIVE one still dedupes.
      await hcs.postBounty(target.id, faction.id, "fixture-server", keyServer.id, 90);
      const again = await prisma.bounty.count({ where: { issuedByFactionId: faction.id, id: { notIn: bountyIds } } });
      check("POSITIVE: while it is live, a second is not posted", again === 0, `${again}`);
    }
  } finally {
    socket?.disconnect();
    try {
      await prisma.bounty.deleteMany({ where: { id: { in: bountyIds } } });
      await prisma.serverConnection.deleteMany({ where: { id: { in: connIds } } });
      await prisma.factionStanding.deleteMany({ where: { factionId: faction.id } });
      await prisma.faction.delete({ where: { id: faction.id } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
