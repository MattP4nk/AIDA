/**
 * Protection is INHERITED (maintainer decision 2026-10-08).
 *
 * `protect <dir>` told the player "Files inside cannot be deleted, moved, or
 * modified by attackers", while delete, move, write and the intruder file
 * listing read only the target node's own flag — so everything inside a
 * protected directory was fully exposed.
 *
 * In-process, against a fixture directory and file in a fixture player's own
 * home, and a fixture world server built by the real provisioner (both
 * deleted by id in `finally`). The owner is used as the actor because
 * delete and move refuse protected nodes for EVERYONE — so an owner refusal
 * isolates the protection check from permission and access-level checks.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-inherited-protection.ts
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

async function main() {
  console.log("\n=== Inherited protection ===");
  const tag = `ip${Date.now().toString(36)}`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const userId: string = ((await r.json()) as any).user.id;
  const { homeServerId } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { homeServerId: true } });
  const serverId = homeServerId!;
  const home = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId, name: tag, type: "directory" } });

  const ids: string[] = [];
  let worldId: string | null = null;
  const mk = async (parentId: string, name: string, type: "file" | "directory", isProtected = false) => {
    const n = await prisma.fileSystemNode.create({
      data: { serverId, parentId, name, type, content: type === "file" ? "x" : null, size: 1, isProtected,
        permissions: home.permissions ?? {}, createdBy: userId },
    });
    ids.unshift(n.id);
    return n;
  };
  try {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const fs = getService<any>(TOKENS.FILE_SERVICE);

    const vault = await mk(home.id, "vaultx", "directory", true);
    const sub = await mk(vault.id, "deeper", "directory");
    const file = await mk(sub.id, "plans.txt", "file");
    const loose = await mk(home.id, "loose.txt", "file");
    const p = `/home/${tag}/vaultx/deeper/plans.txt`;

    const guard = await fs.protectingNode(file.id);
    check("a file two levels inside a protected directory is protected by it", guard?.id === vault.id, guard?.name ?? "none");
    check("POSITIVE: a file outside is not", (await fs.protectingNode(loose.id)) === null);
    const set = await fs.effectivelyProtectedIds(serverId);
    check("the bulk set agrees (intruder file listing)", set.has(file.id) && set.has(sub.id) && !set.has(loose.id));

    // Move FIRST: tested after a delete, a broken delete would make move look
    // refused for the wrong reason ("source not found").
    const mv = await fs.moveNode(serverId, userId, p, `/home/${tag}/plans.txt`);
    check("move is refused (was: moved out)", mv.success === false && mv.error === "PROTECTED", mv.message);
    const del = await fs.deleteNode(serverId, userId, p);
    check("delete is refused, naming the protecting directory (was: deleted)",
      del.success === false && del.error === "PROTECTED" && /vaultx/.test(del.message), del.message);
    check("and the file is still there", !!(await prisma.fileSystemNode.findUnique({ where: { id: file.id } })));

    // POSITIVE: unprotect the directory and the same delete goes through.
    await prisma.fileSystemNode.update({ where: { id: vault.id }, data: { isProtected: false } });
    const del2 = await fs.deleteNode(serverId, userId, p);
    check("POSITIVE: with the directory unprotected, the delete goes through", del2.success === true, del2.message);

    // The skeleton (2026-10-09). Provisioning protects `/`, /bin and /etc so
    // they cannot be removed; inheriting THAT made every file on 492 world
    // servers protected — nothing writable for anyone. A fixture server built
    // by the real provisioner, so the flags are the ones the world has.
    const world = await prisma.gameServer.create({ data: { name: `${tag}_world`, ipAddress: await freeIp(prisma), type: "corporate", ownerId: userId } });
    worldId = world.id;
    await fs.initializeFileSystem(world.id, userId);
    const wroot = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: world.id, parentId: null } });
    const etc = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: world.id, parentId: wroot.id, name: "etc" } });
    const tmp = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: world.id, parentId: wroot.id, name: "tmp" } });
    check("PRECONDITION: the provisioner protects the root and /etc", wroot.isProtected && etc.isProtected);
    const inTmp = await prisma.fileSystemNode.create({ data: { serverId: world.id, parentId: tmp.id, name: "note.txt", type: "file", content: "x", size: 1, permissions: home.permissions ?? {}, createdBy: userId } });
    const inEtc = await prisma.fileSystemNode.create({ data: { serverId: world.id, parentId: etc.id, name: "app.conf", type: "file", content: "x", size: 1, permissions: home.permissions ?? {}, createdBy: userId } });
    check("a file under a protected ROOT is not protected by it (was: every file on the server)", (await fs.protectingNode(inTmp.id)) === null);
    check("nor one under a protected /etc", (await fs.protectingNode(inEtc.id)) === null);
    check("POSITIVE: the skeleton directory itself still is", (await fs.protectingNode(etc.id))?.id === etc.id);
    const wset = await fs.effectivelyProtectedIds(world.id);
    check("the bulk set agrees", wset.has(wroot.id) && wset.has(etc.id) && !wset.has(inTmp.id) && !wset.has(inEtc.id));
    const delTmp = await fs.deleteNode(world.id, userId, "/tmp/note.txt");
    check("so it can be deleted (was: 'protected by /')", delTmp.success === true, delTmp.message);
  } finally {
    try {
      await prisma.fileSystemNode.deleteMany({ where: { id: { in: ids } } });
      // The world fixture's nodes go with it: fileSystemNode.server cascades.
      if (worldId) await prisma.gameServer.delete({ where: { id: worldId } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
