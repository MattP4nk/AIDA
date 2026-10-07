/**
 * Phase 7 A9 — content plans: one implementation, and system content has no owner.
 *
 * `applyContentPlan` dispatched over two implementations; the FileService one
 * had zero callers and was deleted (superseded — see the comment on
 * applyContentPlan). Checking whether the survivor did everything the deleted
 * one did turned up the real defect:
 *
 *   for `ownerId === "system"` it wrote `createdBy = user.findFirst().id` —
 *   whichever user Postgres returned first, no orderBy. `createdBy` is what
 *   fileService grants OWNER access on: canRead returns before the hack-depth
 *   `requiredAccessLevel` gate, canWrite bypasses isProtected at root. So that
 *   arbitrary user owned every new system file. All 1,770 existing system
 *   files carry `createdBy = null`; that is now what new ones get too.
 *
 * BEHAVIOURAL: applies a real plan to PRIVATE fixture servers (never to an
 * existing one), reads the rows back, deletes every fixture by id.
 *
 * Run: npx tsx scripts/verify-phase7-a9-content-plan.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("\n=== Phase 7 A9 — content plan ownership ===");
  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const svc = getService<any>(TOKENS.SERVER_CONTENT_SERVICE);

  const tag = `a9fx${Date.now()}`;
  const ids: { servers: string[]; user?: string } = { servers: [] };
  const plan = {
    directories: [{ path: `/${tag}` }],
    files: [{ path: `/${tag}/note.txt`, content: "fixture" }, { path: `/${tag}/locked.enc`, content: "secret", isEncrypted: true }],
  };

  try {
    // PRECONDITION for the negative control to mean anything: the old code's
    // `findFirst()` would have returned SOMEONE, so a null below is the fix,
    // not an empty users table.
    const anyone = await prisma.user.findFirst({ select: { id: true } });
    check("PRECONDITION: findFirst() returns a user (the old code would have used it)", !!anyone);

    const mkServer = async (n: string, ownerId: string | null, withRoot = true) => {
      const s = await prisma.gameServer.create({
        data: { name: `${tag}-${n}`, ipAddress: `${tag}-${n}`, type: "corporate", ownerId },
      });
      ids.servers.push(s.id);
      if (withRoot) {
        await prisma.fileSystemNode.create({ data: { serverId: s.id, name: "/", type: "directory", parentId: null } });
      }
      return s;
    };
    const owner = await prisma.user.create({
      data: { username: `${tag}_o`, email: `${tag}_o@fixture.invalid`, password: "x", homeIp: `${tag}-o` },
    });
    ids.user = owner.id;

    // Root-less servers, so the initializer runs instead of returning on
    // `hasRoot`. With DI up this goes through fileService.initializeFileSystem,
    // which already validated the owner and used null.
    console.log("\nA9-0 — base filesystem, DI path (initializeFileSystem): NO owner");
    const bare = await mkServer("bare", null, false);
    await svc.ensureBaseFilesystem(bare.id, "system");
    const baseNodes = await prisma.fileSystemNode.findMany({ where: { serverId: bare.id }, select: { name: true, createdBy: true } });
    check("the initializer ran (root + standard dirs)", baseNodes.length > 1, `${baseNodes.length} nodes`);
    check("every base node has createdBy = null", baseNodes.length > 0 && baseNodes.every((n) => n.createdBy === null),
      JSON.stringify(baseNodes.filter((n) => n.createdBy !== null).map((n) => n.name)));

    // The SECOND copy of the findFirst() pick, in ensureBaseFilesystem's
    // FALLBACK — the harness's structural check found it after the first was
    // fixed. A9-0 cannot reach it: with DI up, the function delegates and
    // returns first. A negative control proved that by staying green with the
    // bug restored. So force the fallback: make FILE_SERVICE unresolvable for
    // one call, then put the real instance back.
    console.log("\nA9-0b — base filesystem, FALLBACK path: NO owner");
    {
      const { container } = await import("../src/di/container");
      const realFs = container.resolve<any>(TOKENS.FILE_SERVICE);
      const fb = await mkServer("fallback", null, false);
      container.register(TOKENS.FILE_SERVICE, { useFactory: () => { throw new Error("simulated: FileService unavailable"); } });
      try {
        await svc.ensureBaseFilesystem(fb.id, "system");
      } finally {
        container.registerInstance(TOKENS.FILE_SERVICE, realFs);
      }
      const fbNodes = await prisma.fileSystemNode.findMany({ where: { serverId: fb.id }, select: { id: true, parentId: true, createdBy: true } });
      // PROOF THE FALLBACK RAN: only it gives the root a deterministic id.
      check("PRECONDITION: the fallback ran (root id is root_<serverId>)",
        fbNodes.some((n) => n.parentId === null && n.id === `root_${fb.id}`), `${fbNodes.length} nodes`);
      check("every fallback node has createdBy = null", fbNodes.length > 1 && fbNodes.every((n) => n.createdBy === null),
        JSON.stringify(fbNodes.filter((n) => n.createdBy !== null).length) + " owned");
      check("the real FileService is back in DI", container.resolve<any>(TOKENS.FILE_SERVICE) === realFs);
    }

    console.log("\nA9-1 — system content is written with NO owner");
    const sysServer = await mkServer("sys", null);
    await svc.applyContentPlan(sysServer.id, "system", plan);
    const sysNodes = await prisma.fileSystemNode.findMany({
      where: { serverId: sysServer.id, parentId: { not: null } },
      select: { name: true, createdBy: true, isEncrypted: true, encryptionKey: true, content: true },
    });
    check("the plan was applied (dir + 2 files)", sysNodes.length === 3, `${sysNodes.length} nodes`);
    check("every system node has createdBy = null", sysNodes.length > 0 && sysNodes.every((n) => n.createdBy === null),
      JSON.stringify(sysNodes.map((n) => [n.name, n.createdBy])));

    // The deleted FileService variant really encrypted; this path writes the
    // keyless LOCKED shape fileService.readFile is built around (R9). Pin it,
    // so nobody "restores" real encryption here and breaks crack.
    const locked = sysNodes.find((n) => n.name === "locked.enc");
    check("an encrypted file is the LOCKED shape: flagged, no key", !!locked && locked.isEncrypted && locked.encryptionKey === null,
      JSON.stringify(locked && { isEncrypted: locked.isEncrypted, key: locked.encryptionKey }));

    console.log("\nA9-2 — POSITIVE CONTROL: a real owner is still recorded");
    const ownedServer = await mkServer("own", owner.id);
    await svc.applyContentPlan(ownedServer.id, owner.id, plan);
    const ownedNodes = await prisma.fileSystemNode.findMany({
      where: { serverId: ownedServer.id, parentId: { not: null } },
      select: { createdBy: true },
    });
    check("every node on an owned server belongs to its owner",
      ownedNodes.length === 3 && ownedNodes.every((n) => n.createdBy === owner.id), `${ownedNodes.length} nodes`);
    const bareOwned = await mkServer("bareown", owner.id, false);
    await svc.ensureBaseFilesystem(bareOwned.id, owner.id);
    const baseOwned = await prisma.fileSystemNode.findMany({ where: { serverId: bareOwned.id }, select: { createdBy: true } });
    check("an owned server's base filesystem belongs to its owner",
      baseOwned.length > 1 && baseOwned.every((n) => n.createdBy === owner.id), `${baseOwned.length} nodes`);
  } finally {
    for (const sid of ids.servers) {
      try {
        // Children before parents: delete by depth, deepest first.
        await prisma.fileSystemNode.deleteMany({ where: { serverId: sid, parentId: { not: null }, type: "file" } });
        await prisma.fileSystemNode.deleteMany({ where: { serverId: sid, parentId: { not: null } } });
        await prisma.fileSystemNode.deleteMany({ where: { serverId: sid } });
        await prisma.gameServer.delete({ where: { id: sid } });
      } catch (err) { fail++; console.log(`  [FAIL] cleanup of server ${sid} — ${(err as Error).message}`); }
    }
    if (ids.user) {
      try { await prisma.user.delete({ where: { id: ids.user } }); }
      catch (err) { fail++; console.log(`  [FAIL] cleanup of user — ${(err as Error).message}`); }
    }
  }

  // STRUCTURAL, labelled as such: `report file` runs inside the command
  // pipeline with faction context. This pins that the stored preview is
  // conditional on the lock, not that the command reaches it.
  console.log("\nA9-3 — `report file` does not store a LOCKED file's plaintext (structural)");
  {
    const src = strip(readFileSync(new URL("../src/services/commandModules/playerInfoCommands.ts", import.meta.url).pathname, "utf8"));
    check("contentPreview is empty for encrypted files",
      /contentPreview: file\.isEncrypted \? "" : file\.content\?\.substring\(0, 100\)/.test(src));
  }

  console.log("\nA9-4 — one implementation");
  {
    const src = strip(readFileSync(new URL("../src/services/serverContentService.ts", import.meta.url).pathname, "utf8"));
    check("no second content-plan implementation remains", !/applyContentPlanVia(FileService|Prisma)/.test(src));
    check("and no findFirst()-picked owner", !/user\.findFirst\(\{\s*select: \{ id: true \},?\s*\}\)/.test(src));
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  // setupContainer leaves timers open; flush, then exit.
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
