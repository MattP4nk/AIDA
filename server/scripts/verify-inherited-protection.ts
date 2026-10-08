/**
 * Protection is INHERITED (maintainer decision 2026-10-08).
 *
 * `protect <dir>` told the player "Files inside cannot be deleted, moved, or
 * modified by attackers", while delete, move, write and the intruder file
 * listing read only the target node's own flag — so everything inside a
 * protected directory was fully exposed.
 *
 * In-process, against a fixture directory and file in a fixture player's own
 * home (deleted by id in `finally`). The owner is used as the actor because
 * delete and move refuse protected nodes for EVERYONE — so an owner refusal
 * isolates the protection check from permission and access-level checks.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-inherited-protection.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

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
  } finally {
    try { await prisma.fileSystemNode.deleteMany({ where: { id: { in: ids } } }); }
    catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
