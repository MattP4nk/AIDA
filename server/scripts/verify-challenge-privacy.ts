/**
 * A minigame's ANSWER never reaches the client (found 2026-10-09).
 *
 * Every command that started a minigame sent the whole challenge object to the
 * client: `solution`, plus answer-bearing `metadata` (crack's `bestStrategy`,
 * sweep's hidden file ids). The answer sat in the browser's network tab.
 * utils/publicChallenge.ts is a whitelist; this proves each path uses it.
 *
 *   CP-1  sweep        CP-2  crack        CP-3  crack.storm
 *   CP-4  hack layers: the NEXT challenge after a solved layer
 *   CP-5  the two paths not driven here (hack start runs inside a background
 *         process; connect needs the full connection flow) — checked in source
 *
 * Where the stored answer can be read back (sweep: a real `sweep.reveal`;
 * hack: the live session) the server is also shown to KEEP it — stripping it
 * from the stored session would pass "not sent" and break the game. crack and
 * storm keep theirs in module-private maps and are not read back here.
 *
 * Fixtures: nodes in fixture users' own homes, deleted by id in `finally`;
 * the hack session is dropped WITHOUT resolving it (resolution runs the
 * post-hack pipeline, which writes shared state) and its row deleted by id.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-challenge-privacy.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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

const ALLOWED = new Set(["type", "difficulty", "displayText", "hints", "timeLimit", "maxAttempts"]);
function privateCheck(label: string, sent: any) {
  const keys = sent ? Object.keys(sent) : [];
  const extra = keys.filter((k) => !ALLOWED.has(k));
  check(`${label}: PRECONDITION a challenge was sent`, !!sent && Array.isArray(sent.displayText));
  check(`${label}: no answer in what the client gets (was: solution${label === "crack" ? " + metadata.bestStrategy" : ""})`,
    !!sent && extra.length === 0, extra.join(", ") || "whitelisted fields only");
}

async function main() {
  console.log("\n=== Minigame answers stay on the server ===");
  const tag = `cp${Date.now().toString(36)}`;
  const me = await register(`${tag}m`);
  const target = await register(`${tag}t`);
  const { homeServerId } = await prisma.user.findUniqueOrThrow({ where: { id: me }, select: { homeServerId: true } });
  const home = homeServerId!;
  const myDir = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: home, name: `${tag}m`, type: "directory" } });
  const base = `/home/${tag}m`;
  const nodeIds: string[] = [];
  const mk = async (name: string, extra: Record<string, unknown>) => {
    const n = await prisma.fileSystemNode.create({
      data: { serverId: home, parentId: myDir.id, name, type: "file", content: "x".repeat(600), size: 600,
        permissions: { owner: 15, faction: 0, others: 0 }, createdBy: me, ...extra },
    });
    nodeIds.push(n.id);
    return n;
  };
  let hackSessionId: string | null = null;
  let hackService: any = null;

  try {
    await mk(".hidden_cfg", { isHidden: true });
    await mk("locked.dat", { isEncrypted: true, encryptionKey: "hunter2" });
    await mk("vaulted.dat", { isProtected: true });

    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const fs = getService<any>(TOKENS.FILE_SERVICE);
    const progress = getService<any>(TOKENS.PLAYER_PROGRESS_REPOSITORY);
    const emitted: any[] = [];
    const session = { currentServerId: home, currentDirectory: base, homeServerId: home };
    const ctx: any = {
      userId: me, fileService: fs, playerProgress: progress,
      gameStateManager: { getSession: () => session },
      io: { to: () => ({ emit: (_e: string, p: any) => emitted.push(p) }) },
    };
    const lastSent = () => emitted.filter((p) => p?.data?.challenge).pop()?.data?.challenge;

    console.log("\nCP-1 — sweep");
    const fac = await import("../src/services/commandModules/fileAccessCommands");
    const files: any = new fac.FileAccessCommandsModule();
    await files.executeSweep(ctx, home, base, 0);
    const sweepSent = lastSent();
    privateCheck("sweep", sweepSent);
    const reveal = await files.execute({ command: "sweep.reveal", args: [".hidden_cfg"] }, ctx);
    check("sweep: and the stored session still validates the right answer", reveal.success === true, String(reveal.output));

    console.log("\nCP-2 — crack");
    const hc = await import("../src/services/commandModules/hackCommands");
    const hack: any = new hc.HackCommandsModule();
    emitted.length = 0;
    await hack.handleCrackFile({ command: "crack", args: ["locked.dat"] }, ctx, home, `${base}/locked.dat`, "locked.dat");
    const crackSent = lastSent();
    check("crack: metadata.bestStrategy (the answer) is not sent", !!crackSent && !("metadata" in crackSent));
    privateCheck("crack", crackSent);

    console.log("\nCP-3 — crack.storm");
    emitted.length = 0;
    await hack.handleCrackStorm({ command: "crack.storm", args: ["vaulted.dat"] }, ctx);
    privateCheck("storm", lastSent());

    console.log("\nCP-4 — hack layers");
    await prisma.playerProgress.update({ where: { userId: target }, data: { homeVault: 1 } }); // >= 2 layers
    await prisma.playerProgress.update({ where: { userId: me }, data: { hacking: 60 } });
    const { homeServerId: targetHome } = await prisma.user.findUniqueOrThrow({ where: { id: target }, select: { homeServerId: true } });
    hackService = getService<any>(TOKENS.HACK_SERVICE);
    const started = await hackService.initiateHackSession(me, target, targetHome, "bruteforce", []);
    check("PRECONDITION: a hack session started", started.success === true, started.error ?? "");
    const live = hackService.getActiveSession(me);
    hackSessionId = live?.id ?? null;
    check("PRECONDITION: it has a second layer", (live?.layers?.length ?? 0) >= 2, `${live?.layers?.length ?? 0} layer(s)`);
    const first = live.layers[0];
    const submitCmd: Record<string, string> = { cipher: "crack.submit", port_sequence: "firewall.knock", memory_trace: "memory.extract" };
    const r = await hack.execute({ command: submitCmd[first.type], args: first.solution.split(" ") }, ctx);
    const next = r.data?.nextChallenge;
    privateCheck("hack next layer", next);
    check("hack: the server still holds the next layer's answer", typeof live.layers[1]?.solution === "string" && live.layers[1].solution.length > 0);

    console.log("\nCP-5 — the paths not driven here, in source");
    const hackSrc = stripComments(readFileSync("src/services/commandModules/hackCommands.ts", "utf8"));
    const netSrc = stripComments(readFileSync("src/services/commandModules/networkCommands.ts", "utf8"));
    check("hack start wraps its challenge", /challenge:\s*result\.challenge\s*&&\s*publicChallenge\(result\.challenge\)/.test(hackSrc));
    check("connect wraps its challenge", /connectionChallenge:\s*publicChallenge\(challenge\)/.test(netSrc));
    const raw = [hackSrc, netSrc].flatMap((s) => s.match(/\b(nextChallenge|connectionChallenge):\s*(?!publicChallenge\()[a-z][\w.]*/g) ?? []);
    check("no other client-bound challenge key is assigned a raw value", raw.length === 0, raw.join(" | "));
  } finally {
    try {
      if (hackService) {
        // Drop the session WITHOUT resolving it — see the header.
        const timer = hackService.sessionTimers?.get?.(me);
        if (timer) clearTimeout(timer);
        hackService.sessionTimers?.delete?.(me);
        hackService.activeHacks?.delete?.(me);
      }
      if (hackSessionId) await prisma.hackSession.deleteMany({ where: { id: hackSessionId } });
      await prisma.fileSystemNode.deleteMany({ where: { id: { in: nodeIds } } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
