/**
 * A9 review fix — censorship must survive encryption.
 *
 * `messageService.sendMessage` computed `filteredContent` (and, after A9,
 * refused to send if the filter failed) and then, in the `options.encrypt`
 * branch, encrypted `options.content` — the RAW original. The filtered text
 * was discarded, so every encrypted message stored and delivered uncensored
 * text and the whole A9 hardening was a no-op for any player with enough
 * cryptography skill to encrypt.
 *
 * The test sends the same censored phrase twice, once plain and once
 * encrypted, and decrypts the second. Both must come back redacted.
 *
 * Run: npx tsx scripts/verify-phase4-a9-encrypted-censorship.ts
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

async function main() {
  console.log("\n=== A9 — censorship applies to ENCRYPTED messages ===\n");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod = await import("../src/logger");

  // `setupContainer` needs a real io/prisma/logger. Nothing here emits, so a
  // detached Socket.IO server with no HTTP listener is enough.
  const io = new SocketIOServer();
  setupContainer(io as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const messageService = getService<any>(TOKENS.MESSAGE_SERVICE);
  const encryption = getService<any>(TOKENS.MESSAGE_ENCRYPTION_SERVICE);

  // IMPORTANT — which rule this test can use.
  //
  // `filterText` skips any rule whose `factionId` does not match the caller's
  // context (`censorshipService.ts:128`), and every story rule in the seeded
  // set (AIDA, DarkNet, fragment, Project Echo...) carries a `factionId`.
  // `messageService` calls the filter with `{ userId }` only — no factionId,
  // no serverId — so NONE of those rules can ever apply to a private message.
  // That is a real gap, reported separately; it is not what this test is for.
  //
  // The SSN rule is the one seeded rule with `factionId: null`, so it is the
  // only one that reaches the message path at all. Using it keeps this test
  // about the encryption bypass rather than about rule scoping.
  const rule = await prisma.censorshipRule.findFirst({
    where: { isActive: true, factionId: null },
  });
  check(
    "PRECONDITION: an UNSCOPED censorship rule exists (faction-scoped ones cannot reach this path)",
    !!rule,
    rule?.pattern ?? "none",
  );
  if (!rule) throw new Error("no unscoped rule to test against");

  const stamp = String(process.hrtime.bigint()).slice(-7);
  const mk = async (tag: string) => {
    const u = await prisma.user.create({
      data: {
        username: `a9${tag}${stamp}`,
        email: `a9${tag}${stamp}@t.test`,
        password: "x",
        homeIp: `10.99.${tag === "s" ? 1 : 2}.${Number(stamp) % 250}`,
      },
    });
    await prisma.playerProgress.create({
      // cryptography 50 -> maxEncryptionLevel 5, so `encrypt: true` really encrypts.
      data: { userId: u.id, cryptography: 50 },
    });
    return u;
  };
  const sender = await mk("s");
  const recipient = await mk("r");

  // Matches the unscoped rule \b\d{3}-\d{2}-\d{4}\b -> [FILTERED].
  const PHRASE = "my number is 123-45-6789 ok";

  // ── Control: an UNENCRYPTED message is redacted (proves the rule bites) ──
  const plain = await messageService.sendPrivateMessage(sender.id, recipient.id, {
    subject: "plain",
    content: PHRASE,
    messageType: "private",
  });
  check("PRECONDITION: the plain message sent", plain?.success === true, plain?.message ?? "");

  const plainRow = await prisma.message.findFirst({
    where: { senderId: sender.id, subject: "plain" },
    orderBy: { timestamp: "desc" },
  });
  check(
    "CONTROL: an unencrypted message is redacted",
    !!plainRow && plainRow.content.includes("[FILTERED]") && !/123-45-6789/.test(plainRow.content),
    plainRow?.content ?? "no row",
  );

  // ── The fix: an ENCRYPTED message must be redacted too ─────────────────
  const enc = await messageService.sendPrivateMessage(sender.id, recipient.id, {
    subject: "encrypted",
    content: PHRASE,
    messageType: "private",
    encrypt: true,
  });
  check("PRECONDITION: the encrypted message sent", enc?.success === true, enc?.message ?? "");

  const encRow = await prisma.message.findFirst({
    where: { senderId: sender.id, subject: "encrypted" },
    orderBy: { timestamp: "desc" },
  });
  check(
    "PRECONDITION: it was actually encrypted",
    !!encRow && encRow.isEncrypted === true && !!encRow.encryptionKey,
    `isEncrypted=${encRow?.isEncrypted} level=${encRow?.encryptionLevel}`,
  );
  if (!encRow) throw new Error("no encrypted row");

  // The stored ciphertext obviously should not contain the phrase, but that
  // is true even of the BUGGY version — ciphertext hides everything. The
  // question is what it decrypts to.
  const dec = await encryption.decryptMessage(
    encRow.content,
    encRow.encryptionKey ?? undefined,
    recipient.id,
    encRow.id,
  );
  const plaintext = String(dec?.data?.content ?? dec?.data ?? dec?.message ?? "");

  check(
    "PRECONDITION: the message decrypts",
    plaintext.length > 0 && /my number is/i.test(plaintext),
    plaintext.slice(0, 80),
  );
  check(
    "an ENCRYPTED message decrypts to the CENSORED text",
    plaintext.includes("[FILTERED]") && !/123-45-6789/.test(plaintext),
    `decrypted="${plaintext.slice(0, 80)}" (the bug decrypted to the raw phrase)`,
  );

  // Cleanup
  await prisma.message.deleteMany({ where: { senderId: sender.id } });
  await prisma.playerProgress.deleteMany({ where: { userId: { in: [sender.id, recipient.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [sender.id, recipient.id] } } });

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  await prisma.$disconnect();
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("HARNESS ERROR:", e);
  await prisma.$disconnect();
  process.exit(1);
});
