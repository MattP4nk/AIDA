/**
 * A4 — a download records its provenance on the node it CREATED.
 *
 * Both download paths found the new node again by bare filename anywhere on
 * the home server (newest first) and replaced its whole metadata — although
 * `createFile` had just returned the id. That id is what matters downstream:
 * access keys granted by the download carry it as `sourceFileId`, and deleting
 * the file (or a bounty purge) revokes keys BY it. Tag the wrong node and the
 * key outlives the file that granted it.
 *
 * The two paths are now one helper, `saveDownload`, tested in-process here
 * with a TRAP: a same-named file elsewhere on the home whose createdAt is
 * newer — exactly what the name lookup would pick.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-a4-download.ts
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
  console.log("\n=== A4 — downloads tag the node they created ===");
  const tag = `a4d${Date.now().toString(36)}`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const reg: any = await r.json();
  check("PRECONDITION: fixture account", !!reg?.token, `${r.status}`);
  const userId: string = reg.user.id;
  const { homeServerId: home } = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { homeServerId: true } });
  const homeDir = await prisma.fileSystemNode.findFirstOrThrow({ where: { serverId: home!, name: tag, type: "directory" }, select: { id: true } });
  // A real server whose access key the downloaded content will contain (read only).
  const keyed = await prisma.gameServer.findFirstOrThrow({ where: { accessKey: { not: null }, isPlayerHome: false }, select: { id: true, accessKey: true } });
  const source = await prisma.gameServer.findFirstOrThrow({ where: { isPlayerHome: false, id: { not: keyed.id } }, select: { id: true } });

  const nodeIds: string[] = [];
  try {
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const { saveDownload } = await import("../src/services/commandModules/fileCommands");
    const fileService = getService<any>(TOKENS.FILE_SERVICE);
    const context: any = {
      fileService,
      services: { networkTopologyService: getService<any>(TOKENS.NETWORK_TOPOLOGY_SERVICE) },
    };

    // THE TRAP: same name, not in downloads, created "later".
    const trap = await prisma.fileSystemNode.create({
      data: { serverId: home!, parentId: homeDir.id, name: "loot.txt", type: "file", content: "mine", size: 4,
        metadata: { note: "player's own file" }, createdAt: new Date(Date.now() + 3_600_000) },
    });
    nodeIds.push(trap.id);

    const out = await saveDownload(context, {
      userId, homeServerId: home!, sourceServerId: source.id, sourcePath: "/srv/loot.txt", sourceFileId: "",
      filename: "loot.txt", content: `creds: ${keyed.accessKey}`, isEncrypted: false,
    });
    check("the download was saved", out.result.success === true, out.result.message);
    const created = out.result.data?.id as string;
    if (created) nodeIds.push(created);

    const node = await prisma.fileSystemNode.findUnique({ where: { id: created }, select: { metadata: true, parentId: true } });
    const meta = node?.metadata as any;
    check("the CREATED node carries the provenance",
      meta?.isDownloaded === true && meta?.sourceServerId === source.id && meta?.sourcePath === "/srv/loot.txt",
      JSON.stringify(meta));
    const trapAfter = await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: trap.id }, select: { metadata: true } });
    check("the same-named file elsewhere is untouched (the name lookup overwrote it)",
      JSON.stringify(trapAfter.metadata) === JSON.stringify({ note: "player's own file" }), JSON.stringify(trapAfter.metadata));
    const key = await prisma.serverAccessKey.findUnique({ where: { userId_serverId: { userId, serverId: keyed.id } } });
    // >= 1, not 1: seed.ts gives three Garrison servers the SAME key, by design.
    check("PRECONDITION: the content granted a key", !!key && out.accessKeysGranted.length >= 1, `${out.accessKeysGranted.length}`);
    check("the key is tied to the CREATED node, so deleting it revokes the key", key?.sourceFileId === created,
      key?.sourceFileId === trap.id ? "tied to the TRAP" : String(key?.sourceFileId));

    // markDownloaded MERGES: metadata a node already had survives.
    await fileService.markDownloaded(trap.id, { sourceServerId: source.id, sourcePath: "/x" });
    const merged = (await prisma.fileSystemNode.findUniqueOrThrow({ where: { id: trap.id }, select: { metadata: true } })).metadata as any;
    check("markDownloaded merges instead of replacing", merged?.note === "player's own file" && merged?.isDownloaded === true, JSON.stringify(merged));
  } finally {
    try {
      await prisma.serverAccessKey.deleteMany({ where: { userId } });
      await prisma.fileSystemNode.deleteMany({ where: { id: { in: nodeIds } } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
