/**
 * Protected directories need a won `breach` (maintainer decision Q9, 2026-10-09).
 *
 * `protect` promised "Protected dirs require memory_trace minigame to access".
 * Nothing implemented it: `canRead` ignores `isProtected`, so an intruder on
 * another player's home could ls, cd and cat inside a protected directory.
 * Now, on another player's HOME, opening a protected directory takes a won
 * memory trace, and the win lasts until the intruder leaves the server.
 *
 *   BR-1  the gate: ls, cd, cat, cp and `report file` all refuse
 *   BR-2  cp of an unprotected PARENT no longer smuggles the contents out —
 *         nor files the player cannot `cat` (the recursive copy checked only
 *         the top, and the copier OWNED the copies, protection stripped)
 *   BR-3  breach: nested directories outermost first; the challenge reaches
 *         the client WITHOUT its solution and is solvable from what is shown
 *   BR-4  a win opens it; leaving the server closes it again
 *   BR-5  not gated: the owner, world servers, sweep only when locked
 *   BR-6  no existence oracle: a missing path inside a locked directory is
 *         refused exactly like a real one (was: "not found" vs "PROTECTED")
 *   BR-7  the break tools — crack.protected, crack.storm, fragment.crack,
 *         crack — refuse before a breach (was: crack.protected on the vault
 *         stripped its protection with no breach); past the lock after one.
 *         collar.shield and `report file` use the same lockedPathRefusal and
 *         are covered by the source check in BR-7 rather than driven here
 *   BR-8  `protect` on a skeleton directory protects its contents (was: by
 *         a NAME rule, `protect /data` protected nothing inside), and on a
 *         provisioned node-only /etc it switches ON instead of off
 *
 * Fixtures: a fixture owner's home gets fixture directories (deleted by id in
 * `finally`, deepest first); the intruder's connection rows and a fixture
 * world server are deleted by id too.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-breach.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { freeIp } from "./lib/free-ip";
import { readdirSync, readFileSync } from "node:fs";
import { stripComments } from "./lib/strip-comments";
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
  if (!j?.user?.id) throw new Error(`register ${username}: ${r.status}`);
  return j.user.id as string;
}

/** Solve a memory_trace dump from its displayed text alone, as a player would. */
function solve(challenge: any): string | null {
  const rows = (challenge.displayText as string[])
    .map((l) => l.match(/^\s+0x([0-9A-F]{6})\s+((?:[0-9A-F]{2}\s*){16})$/))
    .filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ addr: parseInt(m[1]!, 16), bytes: m[2]!.trim().split(/\s+/) }));
  const len = challenge.difficulty <= 3 ? 4 : challenge.difficulty <= 6 ? 5 : 6;
  const xorHint = (challenge.hints as string[]).join(" ").match(/XOR to 0x([0-9A-F]{2})/)?.[1];
  const candidates = rows
    .filter((r) => r.addr % 0x20 === 0 && r.bytes[4] === "DE" && r.bytes[5] === "AD")
    .map((r) => ({ addr: r.addr, token: r.bytes.slice(8, 8 + len) }))
    .filter((c) => !xorHint || c.token.reduce((a, b) => a ^ parseInt(b, 16), 0) === parseInt(xorHint, 16));
  if (candidates.length !== 1) return null;
  const c = candidates[0]!;
  return `0x${c.addr.toString(16).toUpperCase().padStart(6, "0")} ${c.token.join("")}`;
}

async function main() {
  console.log("\n=== Protected directories need a breach ===");
  const tag = `br${Date.now().toString(36)}`;
  const owner = await register(`${tag}o`);
  const intruder = await register(`${tag}i`);
  const { homeServerId } = await prisma.user.findUniqueOrThrow({ where: { id: owner }, select: { homeServerId: true } });
  const home = homeServerId!;
  const ownerDir = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: home, name: `${tag}o`, type: "directory" } });
  const base = `/home/${tag}o`;

  const nodeIds: string[] = []; // deepest last; deleted in reverse
  const connIds: string[] = [];
  let worldId: string | null = null;
  let etcWas: { id: string; isProtected: boolean } | null = null;
  let dataWas: { id: string; isProtected: boolean; protectsContents: boolean } | null = null;
  const readable = { owner: 15, faction: 0, others: 5 };
  const mk = async (serverId: string, parentId: string, name: string, type: "file" | "directory", extra: Record<string, unknown> = {}) => {
    const n = await prisma.fileSystemNode.create({
      data: { serverId, parentId, name, type, content: type === "file" ? `secret ${name}` : null, size: 1,
        permissions: readable, createdBy: owner, ...extra },
    });
    nodeIds.push(n.id);
    return n;
  };
  const connect = async () => {
    await prisma.serverConnection.updateMany({ where: { id: { in: connIds } }, data: { isActive: false } });
    const c = await prisma.serverConnection.create({ data: { userId: intruder, serverId: home, isActive: true } });
    connIds.push(c.id);
  };

  try {
    const box = await mk(home, ownerDir.id, "box", "directory");
    const vault = await mk(home, box.id, "vault", "directory", { isProtected: true });
    const plan = await mk(home, vault.id, "plan.txt", "file");
    const inner = await mk(home, vault.id, "inner", "directory", { isProtected: true });
    await mk(home, inner.id, "deep.txt", "file");
    const pub = await mk(home, ownerDir.id, "pub", "directory", { permissions: { owner: 15, faction: 0, others: 15 } });
    await mk(home, pub.id, "loose.txt", "file");
    const shut = await mk(home, ownerDir.id, "shut", "directory");
    await mk(home, shut.id, "private.txt", "file", { permissions: { owner: 15, faction: 0, others: 0 } });
    await prisma.playerProgress.update({ where: { userId: owner }, data: { homeVault: 1 } }); // d=5: XOR hint
    await connect();

    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const fs = getService<any>(TOKENS.FILE_SERVICE);
    const { FileAccessCommandsModule } = await import("../src/services/commandModules/fileAccessCommands");
    const mod: any = new FileAccessCommandsModule();
    const session = { currentServerId: home, currentDirectory: `${base}/box` };
    const emitted: any[] = [];
    const ctx = (userId: string): any => ({
      userId, fileService: fs, playerProgress: getService<any>(TOKENS.PLAYER_PROGRESS_REPOSITORY),
      gameStateManager: { getSession: () => session },
      io: { to: () => ({ emit: (_e: string, p: any) => emitted.push(p) }) },
    });
    const run = (userId: string, command: string, ...args: string[]) => mod.execute({ command, args }, ctx(userId));
    const locked = (r: any) => r.success === false && r.error === "PROTECTED_LOCKED";

    console.log("\nBR-1 — the gate");
    const ls = await fs.listDirectory(home, intruder, `${base}/box/vault`);
    check("ls of a protected directory is refused (was: listed)", locked(ls), ls.message);
    check("and says how through", /breach .*\/box\/vault/.test(ls.message), ls.message);
    check("cd into it is refused", locked(await fs.statPath(home, intruder, `${base}/box/vault`)));
    check("cat of a file inside is refused (was: read)", locked(await fs.readFile(home, intruder, `${base}/box/vault/plan.txt`)));
    check("cp of a file inside is refused", locked(await fs.copyNode(home, intruder, `${base}/box/vault/plan.txt`, `${base}/pub/stolen.txt`)));
    check("`report file` cannot see it", (await fs.canUserReadFile(intruder, plan.id, home)) === false);
    const parent = await fs.listDirectory(home, intruder, `${base}/box`);
    check("POSITIVE: the directory itself still shows in its parent, marked",
      parent.success && parent.data.entries.some((e: any) => e.name === "vault" && e.isProtected), parent.message);
    check("POSITIVE: a file outside reads fine", (await fs.readFile(home, intruder, `${base}/pub/loose.txt`)).success === true);

    console.log("\nBR-6 — no existence oracle");
    const realCat = await fs.readFile(home, intruder, `${base}/box/vault/plan.txt`);
    const ghostCat = await fs.readFile(home, intruder, `${base}/box/vault/nope.txt`);
    check("a MISSING file inside reads exactly like a real one (was: 'File not found' vs 'PROTECTED')",
      locked(ghostCat) && ghostCat.message === realCat.message, ghostCat.message);
    const ghostLs = await fs.listDirectory(home, intruder, `${base}/box/vault/nodir/deeper`);
    check("and a missing directory two levels in", locked(ghostLs), ghostLs.message);

    console.log("\nBR-7 — the break tools need a breach first");
    const hc = await import("../src/services/commandModules/hackCommands");
    const fc = await import("../src/services/commandModules/fragmentCommands");
    const hack: any = new hc.HackCommandsModule();
    const fragCmds: any = new fc.FragmentCommandsModule();
    // fragment.crack is hidden from players holding no fragment (execute
    // answers "Command not found"), so its handler is called directly.
    const toolOut = async (m: any, command: string, args: string[]) => String((await (command === "fragment.crack"
      ? m.handleFragmentCrack({ command, args }, ctx(intruder))
      : m.execute({ command, args }, ctx(intruder)))).output);
    const breachFirst = /Breach it first: 'breach \/home\/[^/]+\/box\/vault'/;
    for (const [m, command, args] of [
      [hack, "crack.protected", ["vault"]],
      [hack, "crack.storm", ["vault"]],
      [fragCmds, "fragment.crack", ["vault", "--confirm"]],
      [hack, "crack.protected", ["vault/plan.txt"]],
    ] as Array<[any, string, string[]]>) {
      const out = await toolOut(m, command, args);
      check(`\`${command} ${args[0]}\` is refused before a breach`, breachFirst.test(out), out.split("\n")[0]);
    }
    const crackOut = await hack.handleCrackFile({ command: "crack", args: ["vault/plan.txt"] }, ctx(intruder), home, `${base}/box/vault/plan.txt`, "plan.txt");
    check("`crack` on a file inside is refused", breachFirst.test(String(crackOut.output)), String(crackOut.output));
    check("and the protection is still there", (await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: vault.id } })).isProtected === true);
    // Every command that looks a path up on the current server checks the lock
    // FIRST, in the same function. Calls, not words (comments stripped).
    const lookupsWithoutLock: string[] = [];
    for (const f of readdirSync("src/services/commandModules").filter((f) => f.endsWith(".ts"))) {
      const src = stripComments(readFileSync(`src/services/commandModules/${f}`, "utf8"));
      const fns = src.split(/\n  (?:private |public )?async \w+\(/);
      for (const fn of fns) {
        const at = fn.indexOf("context.fileService.resolvePath(");
        if (at < 0) continue;
        const before = fn.slice(0, at);
        if (!/lockedPathRefusal\(|lockOnPath\(/.test(before)) lookupsWithoutLock.push(f);
      }
    }
    check("PRECONDITION: the source check sees the lookups", readFileSync("src/services/commandModules/hackCommands.ts", "utf8").includes("context.fileService.resolvePath("));
    check("every command path lookup checks the lock first", lookupsWithoutLock.length === 0, lookupsWithoutLock.join(", "));

    console.log("\nBR-2 — no copying around it");
    const cpBox = await fs.copyNode(home, intruder, `${base}/box`, `${base}/pub/boxcopy`);
    check("cp of an unprotected parent is refused (was: copied the vault out, unprotected, owned by the copier)",
      locked(cpBox), cpBox.message);
    const cpShut = await fs.copyNode(home, intruder, `${base}/shut`, `${base}/pub/shutcopy`);
    check("nor a directory holding a file you cannot cat (was: copied)", cpShut.success === false && cpShut.error === "PERMISSION_DENIED", cpShut.message);
    check("POSITIVE: the private file really is unreadable to cat", (await fs.readFile(home, intruder, `${base}/shut/private.txt`)).success === false);
    const copies = await prisma.fileSystemNode.count({ where: { parentId: pub.id, name: { in: ["boxcopy", "shutcopy", "stolen.txt"] } } });
    check("nothing was written", copies === 0, `${copies}`);

    console.log("\nBR-3 — breach");
    const nested = await run(intruder, "breach", "vault/inner");
    check("a nested directory names the outer one to breach first", nested.success === false && /\/box\/vault'/.test(String(nested.output)), String(nested.output));
    const start = await run(intruder, "breach", "vault");
    const shown = start.data?.challenge;
    check("breach starts a memory trace panel", start.success && start.data?.fileAccessType === "breach" && shown?.type === "memory_trace");
    check("the client is NOT sent the solution", !!shown && !("solution" in shown));
    check("the dump tells the player the right submit command",
      /breach\.extract/.test(String(start.output)) && !/memory\.extract/.test(String(start.output)));
    const wrong = await run(intruder, "breach.extract", "0x000000", "00");
    check("a wrong answer costs an attempt", wrong.success === false && /attempt/.test(String(wrong.output)), String(wrong.output));
    const answer = solve(shown);
    check("PRECONDITION: solvable from the shown text alone", !!answer, answer ?? "no unique answer");

    console.log("\nBR-4 — a win opens it until you leave");
    const won = await run(intruder, "breach.extract", ...(answer ?? "x y").split(" "));
    check("the right answer wins", won.success === true && won.data?.fileAccessResolved === true, String(won.output));
    const open = await fs.listDirectory(home, intruder, `${base}/box/vault`);
    check("now ls works", open.success === true && open.data.entries.some((e: any) => e.name === "plan.txt"), open.message);
    check("and cat", (await fs.readFile(home, intruder, `${base}/box/vault/plan.txt`)).success === true);
    const innerLs = await fs.listDirectory(home, intruder, `${base}/box/vault/inner`);
    check("a protected directory INSIDE still needs its own breach", locked(innerLs) && /inner/.test(innerLs.message), innerLs.message);
    const afterBreach = await toolOut(hack, "crack.protected", ["vault"]);
    check("POSITIVE: after the breach the break tool gets past the lock", !/Breach it first/.test(afterBreach), afterBreach.split("\n")[0]);
    await connect(); // left and came back
    check("leaving the server closes it again", locked(await fs.listDirectory(home, intruder, `${base}/box/vault`)));

    console.log("\nBR-5 — not gated");
    check("the owner", (await fs.listDirectory(home, owner, `${base}/box/vault`)).success === true);
    const ownerBreach = await run(owner, "breach", "vault");
    check("and `breach` tells the owner there is nothing to do", ownerBreach.success === true && /nothing to breach/.test(String(ownerBreach.output)));
    // The skeleton: provisioning protects /etc so it cannot be removed — that
    // must not make every home's /etc a breach (FileSystemNode.protectsContents).
    const etc = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: home, name: "etc", parent: { parentId: null } } });
    etcWas = { id: etc.id, isProtected: etc.isProtected };
    // As provisioning does it: node-only protection.
    await prisma.fileSystemNode.update({ where: { id: etc.id }, data: { isProtected: true, protectsContents: false } });
    await mk(home, etc.id, "motd", "file");
    check("a protected skeleton directory (/etc) is not a lock", (await fs.listDirectory(home, intruder, "/etc")).success === true &&
      (await fs.readFile(home, intruder, "/etc/motd")).success === true);

    console.log("\nBR-8 — `protect` on a skeleton directory");
    const dc = await import("../src/services/commandModules/defenseCommands");
    const defense: any = new dc.DefenseCommandsModule();
    const ownerCtx = { ...ctx(owner), gameStateManager: { getSession: () => ({ homeServerId: home, currentServerId: home, currentDirectory: "/" }) } };
    const data = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: home, name: "data", parent: { parentId: null } } });
    dataWas = { id: data.id, isProtected: data.isProtected, protectsContents: data.protectsContents };
    await mk(home, data.id, "ledger.txt", "file");
    await defense.execute({ command: "protect", args: ["/data"] }, ownerCtx);
    const dataLs = await fs.listDirectory(home, intruder, "/data");
    check("`protect /data` locks its contents (was: a name rule exempted /data — nothing protected)", locked(dataLs), dataLs.message);
    check("and protects what is inside", (await fs.protectingNode((await prisma.fileSystemNode.findFirstOrThrow({ where: { parentId: data.id, name: "ledger.txt" } })).id))?.id === data.id);
    await defense.execute({ command: "protect", args: ["/etc"] }, ownerCtx);
    const etcAfter = await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: etc.id } });
    check("`protect /etc` on provisioned node-only protection switches it ON (not off)", etcAfter.isProtected && etcAfter.protectsContents);

    const world = await prisma.gameServer.create({ data: { name: `${tag}_world`, ipAddress: await freeIp(prisma), type: "corporate" } });
    worldId = world.id;
    const wroot = await mk(world.id, null as any, "/", "directory");
    const wdir = await mk(world.id, wroot.id, "classified", "directory", { isProtected: true });
    await mk(world.id, wdir.id, "memo.txt", "file");
    check("a world server's protected directory stays readable", (await fs.readFile(world.id, intruder, "/classified/memo.txt")).success === true);
    emitted.length = 0;
    await mod.executeSweep(ctx(intruder), home, `${base}/box/vault`, 0);
    check("sweep inside a locked directory is refused", emitted.some((p) => p.success === false && /breach/.test(p.output)), JSON.stringify(emitted[0]?.output));
  } finally {
    try {
      for (const id of [...nodeIds].reverse()) await prisma.fileSystemNode.delete({ where: { id } });
      await prisma.serverConnection.deleteMany({ where: { id: { in: connIds } } });
      if (worldId) await prisma.gameServer.delete({ where: { id: worldId } });
      if (etcWas) await prisma.fileSystemNode.update({ where: { id: etcWas.id }, data: { isProtected: etcWas.isProtected, protectsContents: true } });
      if (dataWas) await prisma.fileSystemNode.update({ where: { id: dataWas.id }, data: { isProtected: dataWas.isProtected, protectsContents: dataWas.protectsContents } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
