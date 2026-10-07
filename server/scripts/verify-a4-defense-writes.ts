/**
 * A4 — defenseCommands' writes, through fileService.
 *
 *   D-1  `safevault move` into a vault already holding that name hit
 *        `@@unique([serverId, parentId, name])`; the P2002 escaped as
 *        "Command execution failed". Same for `retrieve`.
 *   D-2  `safevault retrieve` un-hid EVERY file, dotfiles included, though
 *        createFile hides a dotfile at birth.
 *   D-3  the move told the player the file was "now encrypted" — nothing sets
 *        isEncrypted.
 *   D-4  `honeypot refresh` replaces old decoys and leaves a REAL file holding
 *        a decoy name alone (fileService.redeployDecoys).
 *   D-5  `protect` still toggles (positive control for setNodeFlags).
 *   D-6  `upgrade` charged inside a transaction the command module opened,
 *        writing player_progress through `tx`; `spendCredits` is silent under
 *        a transaction and nothing announced after commit, so the client never
 *        saw its balance drop. Now playerProgressRepository.purchaseHomeDefense.
 *
 * Over a real socket for the commands; fixtures are the fixture player's own
 * home files, deleted by id in `finally`.
 *
 * Needs the dev server. Run: npx tsx scripts/verify-a4-defense-writes.ts
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

async function main() {
  console.log("\n=== A4 — defense writes through fileService ===");
  const tag = `a4v${Date.now().toString(36)}`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const reg: any = await r.json();
  check("PRECONDITION: fixture account", !!reg?.token, `${r.status}`);
  const userId: string = reg.user.id;
  const { homeServerId } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { homeServerId: true } });
  const serverId = homeServerId!;
  const homeDir = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId, name: tag, type: "directory" }, select: { id: true } });
  // Skill gates (skillRequirements.ts): protect networking 15, safevault cryptography 20, honeypot stealth 25.
  await prisma.playerProgress.update({
    where: { userId }, data: { homeVault: 1, homeHoneypot: true, networking: 15, cryptography: 20, stealth: 25 },
  });

  const ids: string[] = [];
  const mk = async (parentId: string, name: string, extra: Record<string, unknown> = {}) => {
    const n = await prisma.fileSystemNode.create({
      data: { serverId, parentId, name, type: extra.type === "directory" ? "directory" : "file", content: "x", size: 1, ...extra },
    });
    ids.unshift(n.id); // children before parents when deleting
    return n;
  };
  const downloads = (await prisma.fileSystemNode.findFirst({ where: { serverId, parentId: homeDir.id, name: "downloads" } }))
    ?? (await mk(homeDir.id, "downloads", { type: "directory" }));
  const vault = await mk(homeDir.id, ".vault", { type: "directory", isHidden: true, isProtected: true });

  const s = ioClient(BASE, { auth: { token: reg.token }, transports: ["websocket"], reconnection: false });
  try {
    await new Promise<void>((res, rej) => {
      s.once("connect_error", rej);
      s.once("connect", () => s.emit("authenticate:request", (a: any) => (a?.success ? res() : rej(new Error(JSON.stringify(a))))));
    });
    const run = (command: string): Promise<string> => new Promise((res) => {
      const t = setTimeout(() => res("<timeout>"), 8000);
      s.once("command:result", (x: any) => { clearTimeout(t); res(Array.isArray(x?.output) ? x.output.join("\n") : String(x?.output ?? x?.error ?? "")); });
      s.emit("command:execute", { command, terminalId: "a4v" });
    });
    await run("connect home");

    console.log("\nD-1/D-3 — safevault move");
    {
      const a = await mk(downloads.id, "plans.txt");
      const moved = await run("safevault move plans.txt");
      const row = await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: a.id } });
      check("POSITIVE: a file moves into the vault, protected and hidden",
        row.parentId === vault.id && row.isProtected && row.isHidden, moved.split("\n")[0]);
      check("the message no longer claims encryption nothing applied", !/encrypted/i.test(moved) && /protected and hidden/.test(moved));
      const b = await mk(downloads.id, "plans.txt"); // same name again
      const clash = await run("safevault move plans.txt");
      const rowB = await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: b.id } });
      check("a name clash is reported (was: 'Command execution failed')", /already holds a file named/.test(clash), clash.split("\n")[0]);
      check("and the file stays where it was", rowB.parentId === downloads.id && !rowB.isProtected);
      const back = await run("safevault retrieve plans.txt");
      check("retrieving onto a taken name is reported too", /already holds a file named/.test(back), back.split("\n")[0]);
    }

    console.log("\nD-2 — safevault retrieve keeps a dotfile hidden");
    {
      const dot = await mk(vault.id, ".ssh_key", { isHidden: true, isProtected: true });
      const out = await run("safevault retrieve .ssh_key");
      const row = await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: dot.id } });
      check("PRECONDITION: retrieved", row.parentId === downloads.id && !row.isProtected, out.split("\n")[0]);
      check("a dotfile comes back still hidden (was: every file un-hidden)", row.isHidden === true);
    }

    console.log("\nD-4 — honeypot refresh");
    {
      const old = await mk(downloads.id, "zz_old_decoy.txt", { metadata: { isDecoy: true } });
      // A REAL file under EVERY decoy name, so whichever names are drawn collide.
      const names = ["credentials_backup.txt", "server_access_keys.enc", "financial_report_Q4.pdf", "admin_passwords.db",
        "classified_intel.dat", "network_map_internal.svg", "employee_database.csv"];
      const real = [];
      for (const n of names) real.push(await mk(downloads.id, n, { content: "REAL LOOT", metadata: { isDownloaded: true } }));
      const out = await run("honeypot refresh");
      check("the refresh succeeds despite every name colliding", /refreshed/.test(out), out.split("\n")[0]);
      check("the old decoy is gone", !(await prisma.fileSystemNode.findUnique({ where: { id: old.id } })));
      const realAfter = await prisma.fileSystemNode.findMany({ where: { id: { in: real.map((x) => x.id) } }, select: { content: true } });
      check("every real file is untouched", realAfter.length === names.length && realAfter.every((x) => x.content === "REAL LOOT"), `${realAfter.length}`);
      // POSITIVE: with the names free, decoys are actually created.
      await prisma.fileSystemNode.deleteMany({ where: { id: { in: real.map((x) => x.id) } } });
      await run("honeypot refresh");
      const decoys = await prisma.fileSystemNode.findMany({
        where: { parentId: downloads.id, metadata: { path: ["isDecoy"], equals: true } }, select: { id: true },
      });
      ids.unshift(...decoys.map((d) => d.id));
      check("POSITIVE: with the names free, 3-5 decoys are deployed", decoys.length >= 3 && decoys.length <= 5, `${decoys.length}`);
    }

    console.log("\nD-5 — protect toggles");
    {
      const dir = await mk(homeDir.id, "secrets", { type: "directory" });
      await run(`protect /home/${tag}/secrets`);
      const on = (await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: dir.id } })).isProtected;
      await run(`protect /home/${tag}/secrets`);
      const off = (await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: dir.id } })).isProtected;
      check("protect on, then off", on === true && off === false, `${on} → ${off}`);
    }

    console.log("\nD-6 — a defense purchase reaches the client, and charges once");
    {
      await prisma.playerProgress.update({ where: { userId }, data: { credits: 10_000, homeIds: 0, homeFirewall: 0 } });
      const deltas: Array<{ path: string; value: unknown }> = [];
      s.on("state:delta", (d: any) => deltas.push({ path: d?.delta?.path, value: d?.delta?.value }));
      const out = await run("upgrade ids 1");
      check("PRECONDITION: the upgrade ran", /IDS upgraded to Level 1/.test(out), out.split("\n")[0]);
      for (let i = 0; i < 20 && !deltas.some((d) => d.path === "player.credits"); i++) await new Promise((r) => setTimeout(r, 100));
      const pushed = deltas.find((d) => d.path === "player.credits");
      check("the new balance is PUSHED (spendCredits is silent under a transaction; nothing announced it)",
        pushed?.value === 8_500, pushed ? `pushed ${pushed.value}` : `deltas: ${deltas.map((d) => d.path).join(", ") || "none"}`);

      const { setupContainer, getService } = await import("../src/di/container");
      const TOKENS = await import("../src/di/tokens");
      const { Server: SocketIOServer } = await import("socket.io");
      const loggerMod: any = await import("../src/logger");
      setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
      const repo = getService<any>(TOKENS.PLAYER_PROGRESS_REPOSITORY);
      const [a1, a2] = await Promise.all([
        repo.purchaseHomeDefense(userId, "firewall", 1, 2000),
        repo.purchaseHomeDefense(userId, "firewall", 1, 2000),
      ]);
      const after = await prisma.playerProgress.findUniqueOrThrow({ where: { userId }, select: { credits: true, homeFirewall: true } });
      check("two concurrent purchases: one applies, one is refused as already owned",
        [a1, a2].filter((x: any) => x.ok).length === 1 && [a1, a2].some((x: any) => x.reason === "ALREADY_OWNED"),
        [a1, a2].map((x: any) => x.ok ? "ok" : x.reason).join(" | "));
      check("and the player is charged ONCE", after.credits === 6_500 && after.homeFirewall === 1, `${after.credits}c, L${after.homeFirewall}`);
      const poor = await repo.purchaseHomeDefense(userId, "vault", 3, 20_000);
      const unchanged = await prisma.playerProgress.findUniqueOrThrow({ where: { userId }, select: { credits: true, homeVault: true } });
      check("an unaffordable purchase charges nothing and applies nothing",
        poor.ok === false && poor.reason === "INSUFFICIENT" && unchanged.credits === 6_500 && unchanged.homeVault === 1,
        `${poor.reason}; ${unchanged.credits}c, vault L${unchanged.homeVault}`);
    }
  } finally {
    s.disconnect();
    try {
      await prisma.fileSystemNode.deleteMany({ where: { id: { in: ids } } });
      await prisma.playerProgress.update({ where: { userId }, data: { homeVault: 0, homeHoneypot: false, homeIds: 0, homeFirewall: 0 } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
