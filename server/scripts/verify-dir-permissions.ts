/**
 * `ls` and `cd` honour a directory's own permission and its ancestors'
 * (found 2026-10-09).
 *
 * R11 made `cat` check every directory above a file. The other two read paths
 * did less: `listDirectory` checked only each CHILD — never the directory
 * being listed — and `statPath` (cd) checked the target but not the
 * directories above it. So, for a restricted /vault (requiredAccessLevel 5):
 *
 *   DP-1  `ls /vault` listed it although `cd /vault` was refused
 *   DP-2  `cd /vault/open` and `ls /vault/open` walked into an unrestricted
 *         directory THROUGH the restricted one
 *   DP-3  POSITIVE: whoever may open /vault still can (the owner); an
 *         unrestricted directory stays open to everyone
 *
 * Fixture world server built by the real provisioner, deleted by id in
 * `finally` (its nodes cascade).
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-dir-permissions.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { freeIp } from "./lib/free-ip";

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
  console.log("\n=== ls and cd honour directory permissions ===");
  const tag = `dp${Date.now().toString(36)}`;
  const owner = await register(`${tag}o`);
  const visitor = await register(`${tag}v`);
  let worldId: string | null = null;
  try {
    const world = await prisma.gameServer.create({ data: { name: `${tag}_world`, ipAddress: await freeIp(prisma), type: "corporate", ownerId: owner } });
    worldId = world.id;
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const fs = getService<any>(TOKENS.FILE_SERVICE);
    await fs.initializeFileSystem(world.id, owner);
    const root = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: world.id, parentId: null } });
    const mkDir = (parentId: string, name: string, requiredAccessLevel: number) => prisma.fileSystemNode.create({
      data: { serverId: world.id, parentId, name, type: "directory", size: 0, createdBy: owner,
        permissions: { owner: 15, faction: 5, others: 5, requiredAccessLevel } },
    });
    const vault = await mkDir(root.id, "vault", 5);
    const open = await mkDir(vault.id, "open", 0);
    await prisma.fileSystemNode.create({ data: { serverId: world.id, parentId: open.id, name: "memo.txt", type: "file", content: "x", size: 1, createdBy: owner,
      permissions: { owner: 15, faction: 5, others: 5, requiredAccessLevel: 0 } } });
    await mkDir(root.id, "public", 0);
    const denied = (r: any) => r.success === false && r.error === "PERMISSION_DENIED";

    console.log("\nDP-1 — the directory's own permission");
    check("PRECONDITION: `cd /vault` is refused", denied(await fs.statPath(world.id, visitor, "/vault")));
    const ls = await fs.listDirectory(world.id, visitor, "/vault");
    check("`ls /vault` is refused too (was: listed)", denied(ls), ls.message);

    console.log("\nDP-2 — through a restricted directory");
    const cd = await fs.statPath(world.id, visitor, "/vault/open");
    check("`cd /vault/open` is refused (was: entered through /vault)", denied(cd), cd.message);
    check("`ls /vault/open` is refused", denied(await fs.listDirectory(world.id, visitor, "/vault/open")));
    check("PRECONDITION: `cat` already refused it (R11)", denied(await fs.readFile(world.id, visitor, "/vault/open/memo.txt")));

    console.log("\nDP-3 — not over-blocking");
    check("POSITIVE: the owner lists /vault/open", (await fs.listDirectory(world.id, owner, "/vault/open")).success === true);
    check("POSITIVE: the owner enters it", (await fs.statPath(world.id, owner, "/vault/open")).success === true);
    check("POSITIVE: an unrestricted directory is open to the visitor",
      (await fs.listDirectory(world.id, visitor, "/public")).success === true && (await fs.statPath(world.id, visitor, "/public")).success === true);
    check("POSITIVE: and so is the root", (await fs.listDirectory(world.id, visitor, "/")).success === true);
  } finally {
    try { if (worldId) await prisma.gameServer.delete({ where: { id: worldId } }); }
    catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
