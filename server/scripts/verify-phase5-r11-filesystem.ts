/**
 * Phase 5 R11 — filesystem semantics.
 *
 * All five plan claims verified against source; all five held.
 *
 *  R11-1  RECURSIVE COPY WAS BROKEN. `duplicateNode` recursed into children
 *         but passed `newName` — the TOP-LEVEL destination name — to every
 *         descendant. Before Phase 3's `@@unique([serverId, parentId, name])`
 *         that produced N identically-named siblings; after it, the second
 *         child raises P2002 and the copy dies half-written.
 *  R11-2  NO ANCESTOR-CYCLE CHECK. `mv /a /a/b` set `/a`'s parent to a node
 *         beneath it, orphaning the subtree from the root.
 *  R11-3  NO ANCESTOR PERMISSION CHECK. A file was readable through a
 *         directory the player could not read.
 *  R11-4  `rm -r` BYPASSED `isProtected`. It was checked on the target only,
 *         and the recursive delete is a DATABASE cascade — which consults no
 *         application flags, so protected descendants were destroyed.
 *  R11-5  The `faction` permission bit is never enforced (display only).
 *         REPORTED, NOT FIXED — enforcing it GRANTS access to faction members
 *         who currently fall through to `others`, which is a balance decision.
 *
 * Note on assertions: several of these fail "safely" in ways that look like
 * success — a partial copy returns an error, a protected file that is gone is
 * simply gone. Each check below names the state, and the copy checks count the
 * resulting tree rather than trusting the return value.
 *
 * Run: npx tsx scripts/verify-phase5-r11-filesystem.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const OPEN = { owner: 15, faction: 5, others: 5, requiredAccessLevel: 0 };

async function main() {
  console.log("\n=== Phase 5 R11 — filesystem semantics ===\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const fs = getService<any>(TOKENS.FILE_SERVICE);

  const stamp = String(process.hrtime.bigint()).slice(-7);
  const owner = await prisma.user.create({
    data: { username: `r11${stamp}`, email: `r11${stamp}@r11.test`, password: "x", homeIp: `10.33.1.${Number(stamp) % 250}` },
  });
  const server = await prisma.gameServer.create({
    data: { name: `R11 Host ${stamp}`, ipAddress: `10.33.9.${Number(stamp) % 250}`, type: "corporate", ownerId: owner.id },
  });
  const root = await prisma.fileSystemNode.create({
    data: { serverId: server.id, name: "/", type: "directory", permissions: OPEN as any, createdBy: owner.id },
  });

  const mkdir = async (parentId: string, name: string, perms: any = OPEN, isProtected = false) =>
    prisma.fileSystemNode.create({
      data: { serverId: server.id, parentId, name, type: "directory", permissions: perms as any, createdBy: owner.id, isProtected },
    });
  const mkfile = async (parentId: string, name: string, content = "x", perms: any = OPEN, isProtected = false) =>
    prisma.fileSystemNode.create({
      data: { serverId: server.id, parentId, name, type: "file", content, size: content.length, permissions: perms as any, createdBy: owner.id, isProtected },
    });

  try {
    // ── R11-1: recursive copy keeps each child's own name ────────────────
    console.log("R11-1 — recursive cp names children correctly");
    {
      const data = await mkdir(root.id, "data");
      await mkfile(data.id, "alpha.txt", "A");
      await mkfile(data.id, "beta.txt", "B");
      const nested = await mkdir(data.id, "nested");
      await mkfile(nested.id, "gamma.txt", "C");

      const res = await fs.copyNode(server.id, owner.id, "/data", "/backup");
      check("the copy reports success", res.success === true, res.message ?? res.error);

      const copyRoot = await prisma.fileSystemNode.findFirst({
        where: { serverId: server.id, parentId: root.id, name: "backup" },
      });
      check("the destination directory exists", !!copyRoot, copyRoot?.name ?? "missing");

      if (copyRoot) {
        const kids = await prisma.fileSystemNode.findMany({
          where: { serverId: server.id, parentId: copyRoot.id },
          select: { name: true, type: true },
        });
        const names = kids.map((k) => k.name).sort().join(",");
        check(
          "children keep THEIR OWN names, not the destination's",
          names === "alpha.txt,beta.txt,nested",
          `got [${names}] (the bug named every child "backup")`,
        );
        check(
          "all three children survived — no partial copy",
          kids.length === 3,
          `${kids.length} of 3 (the bug died on the 2nd via P2002)`,
        );

        const nestedCopy = kids.find((k) => k.name === "nested");
        if (nestedCopy) {
          const deep = await prisma.fileSystemNode.findMany({
            where: {
              serverId: server.id,
              parent: { name: "nested", parentId: copyRoot.id },
            },
            select: { name: true },
          });
          check(
            "the copy recursed into the nested directory too",
            deep.some((d) => d.name === "gamma.txt"),
            deep.map((d) => d.name).join(",") || "empty",
          );
        }
      }
    }

    // ── REVIEW: cp into the source's own subtree must not run away ───────
    //
    // R11 added the subtree guard to `mv` and not to `cp`, where the
    // consequence is worse: `duplicateNode` created the copy BEFORE reading
    // the child list, so the fresh copy appeared in its own children and the
    // recursion never terminated — rows created until the database or heap
    // died, request never returning. The pre-R11 naming bug had accidentally
    // capped it via P2002; fixing the naming removed that brake.
    //
    // The failure mode is a HANG, so this is time-boxed: a check that simply
    // awaits would hang the harness rather than report.
    console.log("REVIEW — cp refuses to copy a directory into itself");
    {
      const selfdir = await mkdir(root.id, "selfdir");
      await mkfile(selfdir.id, "one.txt", "1");
      await mkfile(selfdir.id, "two.txt", "2");

      const before = await prisma.fileSystemNode.count({ where: { serverId: server.id } });

      const raced = await Promise.race([
        fs.copyNode(server.id, owner.id, "/selfdir", "/selfdir/backup"),
        new Promise((r) => setTimeout(() => r({ __timedOut: true }), 8000)),
      ]) as any;

      check(
        "the copy RETURNS rather than recursing forever",
        raced?.__timedOut !== true,
        raced?.__timedOut ? "TIMED OUT — unbounded recursion" : "returned",
      );
      check(
        "and it is refused as an invalid copy",
        raced?.success === false && raced?.error === "INVALID_COPY",
        `success=${raced?.success} error=${raced?.error}`,
      );

      const after = await prisma.fileSystemNode.count({ where: { serverId: server.id } });
      check(
        "no runaway rows were created",
        after === before,
        `${before} -> ${after} nodes`,
      );

      // POSITIVE CONTROL: copying elsewhere still works.
      const ok = await fs.copyNode(server.id, owner.id, "/selfdir", "/selfdir-copy");
      check("POSITIVE CONTROL: a normal directory copy still succeeds", ok.success === true, ok.message ?? ok.error);
    }

    // ── R11-2: a directory cannot be moved into itself ───────────────────
    console.log("\nR11-2 — mv refuses to create a cycle");
    {
      const outer = await mkdir(root.id, "outer");
      const inner = await mkdir(outer.id, "inner");

      const res = await fs.moveNode(server.id, owner.id, "/outer", "/outer/inner/outer");
      check(
        "moving a directory into its own subtree is refused",
        res.success === false && res.error === "INVALID_MOVE",
        `success=${res.success} error=${res.error}`,
      );

      const still = await prisma.fileSystemNode.findUnique({
        where: { id: outer.id },
        select: { parentId: true },
      });
      check(
        "and the directory is left where it was",
        still?.parentId === root.id,
        `parentId=${still?.parentId === root.id ? "root (unchanged)" : "MOVED — subtree orphaned"}`,
      );

      // POSITIVE CONTROL: a legitimate move still works, or the check above
      // would pass against a `mv` that simply refuses everything.
      const ok = await fs.moveNode(server.id, owner.id, "/outer/inner", "/inner");
      check("POSITIVE CONTROL: a legitimate move still succeeds", ok.success === true, ok.message ?? ok.error);
      void inner;
    }

    // ── R11-4: rm -r cannot destroy protected descendants ────────────────
    console.log("\nR11-4 — rm -r respects protection on descendants");
    {
      const vault = await mkdir(root.id, "vault");
      await mkfile(vault.id, "ordinary.txt", "x");
      await mkfile(vault.id, "payload.enc", "secret", OPEN, true); // protected

      const res = await fs.deleteNode(server.id, owner.id, "/vault", true);
      check(
        "deleting a directory containing a protected file is refused",
        res.success === false && res.error === "PROTECTED",
        `success=${res.success} error=${res.error}`,
      );
      check(
        "and it names the file it is protecting",
        String(res.message ?? "").includes("payload.enc"),
        res.message ?? "",
      );

      const survived = await prisma.fileSystemNode.count({
        where: { serverId: server.id, name: "payload.enc" },
      });
      check(
        "the protected file still exists",
        survived === 1,
        survived === 1 ? "present" : "DESTROYED by the cascade",
      );

      // POSITIVE CONTROL: an unprotected tree still deletes.
      const plain = await mkdir(root.id, "plain");
      await mkfile(plain.id, "a.txt");
      const del = await fs.deleteNode(server.id, owner.id, "/plain", true);
      check("POSITIVE CONTROL: an unprotected tree still deletes", del.success === true, del.message ?? del.error);
    }

    // ── R11-3: ancestors gate reads ──────────────────────────────────────
    console.log("\nR11-3 — a restricted directory blocks reads through it");
    {
      // Directory requires hacked access; the file inside does not.
      const secure = await mkdir(root.id, "secure", { ...OPEN, requiredAccessLevel: 5 });
      await mkfile(secure.id, "plans.txt", "INVASION PLANS", OPEN);

      // A stranger with no access level on this server.
      const stranger = await prisma.user.create({
        data: { username: `r11s${stamp}`, email: `r11s${stamp}@r11.test`, password: "x", homeIp: `10.33.2.${Number(stamp) % 250}` },
      });

      const read = await fs.readFile(server.id, stranger.id, "/secure/plans.txt");
      check(
        "a permissive file inside a restricted directory is NOT readable",
        read.success === false && read.error === "PERMISSION_DENIED",
        `success=${read.success} error=${read.error} (the file's own bits said yes)`,
      );

      // POSITIVE CONTROL: the same file in an ordinary directory IS readable,
      // so the check above is not just "strangers can never read anything".
      const opendir = await mkdir(root.id, "public");
      await mkfile(opendir.id, "notes.txt", "hello", OPEN);
      const ok = await fs.readFile(server.id, stranger.id, "/public/notes.txt");
      check(
        "POSITIVE CONTROL: an ordinary path is still readable",
        ok.success === true && ok.data?.content === "hello",
        ok.success ? "readable" : `blocked: ${ok.error}`,
      );

      await prisma.user.delete({ where: { id: stranger.id } });
    }

    console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  } finally {
    await prisma.fileSystemNode.deleteMany({ where: { serverId: server.id } });
    await prisma.gameServer.deleteMany({ where: { id: server.id } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
  // FLUSH, THEN EXIT. Two failure modes to dodge at once:
  //
  //  - bare `process.exit()` truncates piped stdout, so the summary line is
  //    intermittently lost (found in O9);
  //  - bare `process.exitCode` never exits HERE, because this harness boots
  //    the DI container and several services start intervals that are not
  //    unref'd — the loop stays alive forever. That is exactly what happened:
  //    14/14 passed and the run still timed out.
  //
  // Draining stdout first, then exiting explicitly, satisfies both.
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(1);
});
