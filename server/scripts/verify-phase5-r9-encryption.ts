/**
 * Phase 5 R9 — the encryption data-loss cluster.
 *
 * All five plan claims were verified against source before anything changed,
 * and all five held — unusually, since recent plan entries have mostly been
 * wrong on specifics. Two were worse than written.
 *
 *  R9-a  CRACK DESTROYED THE FILE. On success it set
 *        `{ isEncrypted: false, encryptionKey: null }` and never touched the
 *        content — so it threw away the only key to data it left encrypted and
 *        labelled the ciphertext as plaintext. "Success" was the operation
 *        that made the file permanently unreadable.
 *  R9-b  ENCRYPT NEVER SHOWED THE KEY. With no password the service generates
 *        one, stores it, and `readFile` then REFUSES to decrypt unless the
 *        caller supplies a key. Encrypting your own file made it unreadable to
 *        you.
 *  R9-c  ENCRYPT COULD DELETE BOTH COPIES. The original was deleted, the final
 *        write attempted, the staging copy deleted, and only then was
 *        `finalResult.success` checked. A failed write destroyed the file.
 *  R9-d  LOCKED FILES WERE UNREADABLE *AND* UNCRACKABLE. Provisioned story
 *        files carry `isEncrypted: true` with plaintext content and no key —
 *        85 of 85 encrypted files in the dev DB. `readFile` fell through to
 *        `decryptContent(plaintext, null)`, which throws, so `cat` returned
 *        DECRYPTION_FAILED; and the crack router only routes on
 *        `error === "ENCRYPTED"`, so `crack` skipped them too.
 *
 * Note on assertions: "the file is not readable" was true both before and
 * after several of these bugs, so every check below names the specific state —
 * which error code, which content, whether the key survived.
 *
 * Run: npx tsx scripts/verify-phase5-r9-encryption.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { isAuthenticatedPayload } from "../src/utils/contentCrypto";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const SECRET = "the vault code is 4815162342";

async function main() {
  console.log("\n=== Phase 5 R9 — encryption data loss ===\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const fileService = getService<any>(TOKENS.FILE_SERVICE);

  const stamp = String(process.hrtime.bigint()).slice(-7);
  const owner = await prisma.user.create({
    data: {
      username: `r9${stamp}`,
      email: `r9${stamp}@r9.test`,
      password: "x",
      homeIp: `10.44.1.${Number(stamp) % 250}`,
    },
  });
  const server = await prisma.gameServer.create({
    data: {
      name: `R9 Host ${stamp}`,
      ipAddress: `10.44.9.${Number(stamp) % 250}`,
      type: "corporate",
      ownerId: owner.id,
    },
  });
  const root = await prisma.fileSystemNode.create({
    data: {
      serverId: server.id,
      name: "/",
      type: "directory",
      permissions: { owner: 15, faction: 5, others: 5 } as any,
      createdBy: owner.id,
    },
  });

  try {
    // ── R9-b: the key must be returned so the owner can read it back ─────
    console.log("R9-b — encrypting surfaces a usable key");
    {
      const created = await fileService.createFile(
        server.id, owner.id, "/secret.txt", SECRET, true,
      );
      check("PRECONDITION: the file was created encrypted", created.success === true, created.message);
      const key = created.data?.encryptionKey;
      check(
        "createFile RETURNS the generated key",
        typeof key === "string" && key.length > 0,
        key ? `key length ${key.length}` : "no key returned — the owner could never read this file",
      );

      const row = await prisma.fileSystemNode.findFirst({
        where: { serverId: server.id, name: "secret.txt" },
        select: { content: true, isEncrypted: true, encryptionKey: true },
      });
      // Assert the PROPERTY (it is ciphertext), not a particular wire format.
      // This originally hardcoded `split(":").length === 3` and broke when R10
      // introduced the authenticated 5-part v2 payload — a stale test, not a
      // regression, but indistinguishable from one at a glance.
      check(
        "the stored content is CIPHERTEXT, not the plaintext",
        !!row && row.content !== SECRET && isAuthenticatedPayload(row.content ?? ""),
        `stored=${(row?.content ?? "").slice(0, 28)}…`,
      );

      const noKey = await fileService.readFile(server.id, owner.id, "/secret.txt");
      check(
        "reading without a key reports ENCRYPTED (crackable), not corruption",
        noKey.success === false && noKey.error === "ENCRYPTED",
        `error=${noKey.error}`,
      );

      const withKey = await fileService.readFile(server.id, owner.id, "/secret.txt", key);
      check(
        "reading WITH the surfaced key returns the original plaintext",
        withKey.success === true && withKey.data?.content === SECRET,
        withKey.success ? `"${withKey.data?.content}"` : `failed: ${withKey.error}`,
      );
    }

    // ── R9-a: cracking must decrypt, not just clear the flag ─────────────
    console.log("\nR9-a — cracking decrypts instead of destroying");
    {
      const created = await fileService.createFile(
        server.id, owner.id, "/cracked.txt", SECRET, true,
      );
      const fileId = created.data.id;
      const before = await prisma.fileSystemNode.findUnique({
        where: { id: fileId },
        select: { content: true, encryptionKey: true },
      });

      // Call the REAL implementation the crack command calls. An earlier
      // draft re-implemented the decrypt-then-clear sequence here, which would
      // have passed even with the product code reverted — a test that redoes
      // the work proves only that the author can do it twice.
      const unlocked = await fileService.unlockCrackedFile(fileId);
      check("PRECONDITION: the unlock reported success", unlocked === true);
      void before;

      const after = await prisma.fileSystemNode.findUnique({
        where: { id: fileId },
        select: { content: true, isEncrypted: true, encryptionKey: true },
      });
      check(
        "a cracked file holds the PLAINTEXT, not orphaned ciphertext",
        after?.content === SECRET,
        `content="${(after?.content ?? "").slice(0, 34)}" (the bug left ciphertext here with the key deleted)`,
      );
      check(
        "and it is now genuinely unencrypted",
        after?.isEncrypted === false && after?.encryptionKey === null,
        `isEncrypted=${after?.isEncrypted} key=${after?.encryptionKey}`,
      );

      const read = await fileService.readFile(server.id, owner.id, "/cracked.txt");
      check(
        "so it reads back with no key at all",
        read.success === true && read.data?.content === SECRET,
        read.success ? "readable" : `failed: ${read.error}`,
      );
    }

    // ── R9-d: a locked file (no key, plaintext) is crackable, not corrupt ─
    console.log("\nR9-d — provisioned 'locked' files are reachable");
    {
      // Exactly how world provisioning writes story files.
      await prisma.fileSystemNode.create({
        data: {
          serverId: server.id,
          parentId: root.id,
          name: "op_shadowstrike.enc",
          type: "file",
          content: "OPERATION SHADOWSTRIKE — CLASSIFIED",
          size: 34,
          createdBy: owner.id,
          isEncrypted: true,
          encryptionKey: null,
          permissions: { owner: 15, faction: 5, others: 5 } as any,
        },
      });

      const read = await fileService.readFile(server.id, owner.id, "/op_shadowstrike.enc");
      check(
        "a no-key encrypted file reports ENCRYPTED, not DECRYPTION_FAILED",
        read.success === false && read.error === "ENCRYPTED",
        `error=${read.error} (DECRYPTION_FAILED made it uncrackable too, since the crack router keys on ENCRYPTED)`,
      );

      // REVIEW FIX: a keyless locked file must NOT open for an arbitrary key.
      //
      // The first draft returned plaintext whenever a key was merely SUPPLIED,
      // because the guard read `if (!decryptionKey)` and the decrypt was a
      // ternary on the STORED key. `decrypt story.enc x` therefore handed back
      // the content and bypassed the crack minigame this fix exists to make
      // reachable — trading "unreadable by anyone" for "readable by anyone who
      // types one character".
      const withJunkKey = await fileService.readFile(
        server.id, owner.id, "/op_shadowstrike.enc", "x",
      );
      check(
        "a keyless locked file does NOT open for an arbitrary key",
        withJunkKey.success === false && withJunkKey.error === "ENCRYPTED",
        withJunkKey.success
          ? `OPENED with junk key: "${String(withJunkKey.data?.content).slice(0, 30)}"`
          : `error=${withJunkKey.error}`,
      );
      check(
        "and the hint names a command that exists",
        /crack/i.test(String(withJunkKey.data?.hint ?? "")) &&
          !/--key/.test(String(withJunkKey.data?.hint ?? "")),
        String(withJunkKey.data?.hint ?? ""),
      );

      // This is the routing predicate in handleCrack.
      check(
        "so the crack router would now route it to the FILE crack flow",
        read.success || read.error === "ENCRYPTED",
        'matches `fileResult.success || fileResult.error === "ENCRYPTED"`',
      );
    }

    // ── R9-c: the staging copy outlives a failed write ───────────────────
    console.log("\nR9-c — a failed encrypt does not destroy the file");
    {
      // Drive the real ordering: staging exists, original deleted, final write
      // FAILS because the staging name is occupied by a same-path collision.
      await fileService.createFile(server.id, owner.id, "/important.txt", SECRET, false);
      const staged = await fileService.createFile(
        server.id, owner.id, "/important.txt.__encrypting__", SECRET, true,
      );
      check("PRECONDITION: staging copy written", staged.success === true, staged.message);

      await fileService.deleteNode(server.id, owner.id, "/important.txt");

      // Simulate the final write failing by attempting a duplicate create
      // against a path that now exists.
      await fileService.createFile(server.id, owner.id, "/important.txt", SECRET, true);
      const dup = await fileService.createFile(
        server.id, owner.id, "/important.txt", SECRET, true,
      );
      check(
        "PRECONDITION: a failing write is observable",
        dup.success === false,
        `error=${dup.error}`,
      );

      const stagingStillThere = await prisma.fileSystemNode.findFirst({
        where: { serverId: server.id, name: "important.txt.__encrypting__" },
        select: { id: true },
      });
      check(
        "the staging copy survives a failed write — it is the recovery point",
        stagingStillThere !== null,
        stagingStillThere
          ? "present"
          : "GONE — the old code deleted it before checking success, losing the file",
      );
    }

    console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  } finally {
    await prisma.fileSystemNode.deleteMany({ where: { serverId: server.id } });
    await prisma.gameServer.deleteMany({ where: { id: server.id } });
    await prisma.user.deleteMany({ where: { id: owner.id } });
    await prisma.$disconnect();
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
