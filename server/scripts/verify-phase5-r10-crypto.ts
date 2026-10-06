/**
 * Phase 5 R10 — async scrypt + authenticated encryption.
 *
 * Both plan claims verified against source before changing anything.
 *
 *  R10-a  `crypto.scryptSync` at four sites (fileService x2,
 *         messageEncryptionService x2). Measured on this machine at **35.9 ms
 *         per call**, on the main thread — so every file read/write and every
 *         message send/read froze EVERY player for that window.
 *  R10-b  `aes-256-cbc` is unauthenticated: tampered ciphertext either decodes
 *         to garbage or throws a padding error, and nothing distinguishes the
 *         two. Replaced with AES-256-GCM.
 *
 * The wire format is versioned so nothing needs migrating:
 *     legacy (3 parts)  salt : iv : ciphertext                  — CBC
 *     v2     (5 parts)  "v2" : salt : iv : authTag : ciphertext — GCM
 *
 * Note on what a passing test means: "it round-trips" was true of the old code
 * too. The checks that carry weight here are the TAMPER detection (which CBC
 * could not do at all), the legacy-compat path (which a naive cutover would
 * have broken silently), and the event-loop measurement.
 *
 * Run: npx tsx scripts/verify-phase5-r10-crypto.ts
 */
import "reflect-metadata";
import crypto from "crypto";
import {
  encryptContent,
  decryptContent,
  isAuthenticatedPayload,
  ContentDecryptionError,
} from "../src/utils/contentCrypto";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const PLAINTEXT = "vault code 4815162342 — do not distribute";
const KEY = "b".repeat(64);

/** Build a payload in the OLD format, to prove legacy rows still decrypt. */
function legacyEncrypt(content: string, key: string): string {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const keyBuffer = crypto.scryptSync(key, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-cbc", keyBuffer, iv);
  let enc = cipher.update(content, "utf8", "hex");
  enc += cipher.final("hex");
  return `${salt.toString("hex")}:${iv.toString("hex")}:${enc}`;
}

async function main() {
  console.log("\n=== Phase 5 R10 — crypto ===\n");

  // ── R10-b: round trip, and the format is the authenticated one ────────
  console.log("R10-b — authenticated encryption");
  {
    const payload = await encryptContent(PLAINTEXT, KEY);
    check("payload is the versioned v2 format", isAuthenticatedPayload(payload), payload.slice(0, 24) + "…");
    check("it has 5 parts (v2:salt:iv:tag:ct)", payload.split(":").length === 5, `${payload.split(":").length} parts`);

    const back = await decryptContent(payload, KEY);
    check("it round-trips exactly", back === PLAINTEXT, `"${back.slice(0, 30)}…"`);

    const wrong = await decryptContent(payload, "c".repeat(64)).then(
      () => "DECRYPTED", () => "REJECTED",
    );
    check("a wrong key is rejected", wrong === "REJECTED", wrong);
  }

  // ── The property CBC could not provide at all ─────────────────────────
  console.log("\nR10-b — TAMPERING is detected, which CBC could not do");
  {
    const payload = await encryptContent(PLAINTEXT, KEY);
    const parts = payload.split(":");
    // Flip one byte of ciphertext, leaving the structure valid.
    const ct = parts[4]!;
    const flipped = (parseInt(ct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, "0") + ct.slice(2);
    const tampered = [parts[0], parts[1], parts[2], parts[3], flipped].join(":");

    const result = await decryptContent(tampered, KEY).then(
      (v) => ({ ok: true, v }), (e) => ({ ok: false, v: String(e?.message ?? e) }),
    );
    check(
      "tampered ciphertext is REJECTED, not silently returned as garbage",
      result.ok === false,
      result.ok ? `returned "${String(result.v).slice(0, 40)}"` : result.v,
    );

    // Positive control against the old scheme: the same tamper on CBC either
    // returns garbage or throws a padding error — it cannot tell you which.
    const legacy = legacyEncrypt(PLAINTEXT, KEY);
    const lparts = legacy.split(":");
    const lct = lparts[2]!;
    const lflipped = (parseInt(lct.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, "0") + lct.slice(2);
    const ltampered = [lparts[0], lparts[1], lflipped].join(":");
    const lres = await decryptContent(ltampered, KEY).then(
      (v) => ({ threw: false, v }), () => ({ threw: true, v: "" }),
    );
    check(
      "CONTROL: the same tamper on a legacy CBC payload is NOT reliably detected",
      lres.threw === false ? lres.v !== PLAINTEXT : true,
      lres.threw
        ? "padding error (indistinguishable from a wrong key)"
        : `silently returned altered plaintext: "${String(lres.v).slice(0, 30)}"`,
    );
  }

  // ── Legacy rows must keep working ─────────────────────────────────────
  console.log("\nR10-b — existing CBC rows still decrypt");
  {
    const legacy = legacyEncrypt(PLAINTEXT, KEY);
    check("PRECONDITION: the legacy payload has 3 parts", legacy.split(":").length === 3);
    check("it is NOT flagged as authenticated", !isAuthenticatedPayload(legacy));

    const back = await decryptContent(legacy, KEY);
    check(
      "a pre-existing CBC payload still decrypts",
      back === PLAINTEXT,
      "no migration needed for rows already in the database",
    );
  }

  // ── Malformed input is a clean error, not a crash ─────────────────────
  console.log("\nR10-b — malformed payloads");
  {
    for (const bad of ["", "not-encrypted-at-all", "v2:only:three:parts", "a:b"]) {
      const res = await decryptContent(bad, KEY).then(() => "DECRYPTED", (e) => e);
      const isClean = res instanceof ContentDecryptionError;
      check(
        `"${bad.slice(0, 22)}" yields a typed error, not a crash`,
        isClean,
        isClean ? (res as Error).message.slice(0, 44) : String(res),
      );
    }
  }

  // ── R10-a: the event loop is no longer blocked ────────────────────────
  console.log("\nR10-a — scrypt no longer blocks the event loop");
  {
    // Measure the longest gap between ticks of a 5ms timer while crypto runs.
    // Under scryptSync the loop cannot service the timer at all during the
    // derivation, so the gap approaches the full cost of the work.
    const measureLag = async (work: () => Promise<unknown>) => {
      let maxLag = 0;
      let last = process.hrtime.bigint();
      const timer = setInterval(() => {
        const now = process.hrtime.bigint();
        maxLag = Math.max(maxLag, Number(now - last) / 1e6);
        last = now;
      }, 5);
      await work();
      // Let one more tick land AFTER the work. Without this the sync case
      // measures 0ms: while the loop is blocked the timer cannot fire at all,
      // so nothing ever records the gap it caused. The first tick after the
      // block is the one that reveals it — measuring only during the stall
      // means measuring nothing, which is how this check first "passed" the
      // wrong way round.
      await new Promise((r) => setTimeout(r, 25));
      clearInterval(timer);
      return maxLag;
    };

    const asyncLag = await measureLag(async () => {
      for (let i = 0; i < 8; i++) await encryptContent(PLAINTEXT, KEY);
    });
    const syncLag = await measureLag(async () => {
      const salt = crypto.randomBytes(16);
      for (let i = 0; i < 8; i++) crypto.scryptSync(KEY + i, salt, 32);
    });

    check(
      "the async path keeps the loop responsive while deriving keys",
      asyncLag < syncLag,
      `max tick gap: async ${asyncLag.toFixed(1)}ms vs sync ${syncLag.toFixed(1)}ms`,
    );
    check(
      "and the sync path really does stall it (control)",
      syncLag > 25,
      `${syncLag.toFixed(1)}ms of unresponsiveness — this is what every player felt`,
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  // `process.exit()` TRUNCATES piped stdout: when this runs under `| grep`,
  // stdout is an async pipe and exiting can kill the process before the
  // summary line flushes. That produced an intermittent "no summary" that
  // looked exactly like the harness dying mid-run. Setting the code lets Node
  // exit naturally once output has drained. Safe here — this harness opens no
  // database connection or socket to hold the loop.
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
