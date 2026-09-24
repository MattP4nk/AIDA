/**
 * R10 — the one implementation of content encryption.
 *
 * `fileService` and `messageEncryptionService` each carried a byte-identical
 * copy of this: same `aes-256-cbc`, same `scryptSync`, same
 * `salt:iv:ciphertext` wire format, same bugs available in two places.
 *
 * Two things changed here beyond deduplication.
 *
 * ── scrypt is now ASYNCHRONOUS ────────────────────────────────────────────
 * `crypto.scryptSync` is deliberately expensive — that is the point of a KDF —
 * and it runs on the main thread. Measured on this machine: **35.9 ms per
 * call**, during which the event loop is completely blocked. On a multiplayer
 * server every file read, file write, message send and message read froze
 * every other player for that window. `crypto.scrypt` does the same work on
 * libuv's threadpool, so the cost is paid by one request instead of all of
 * them.
 *
 * ── AES-256-GCM, with the old format still readable ───────────────────────
 * CBC is unauthenticated: it will happily "decrypt" tampered ciphertext into
 * garbage, and a padding error is the only signal anything was wrong. GCM
 * authenticates, so tampering is detected and reported rather than returned.
 *
 * Existing rows must keep working, so the format is versioned:
 *
 *   legacy (3 parts)  salt : iv : ciphertext                 — AES-256-CBC
 *   v2     (5 parts)  "v2" : salt : iv : authTag : ciphertext — AES-256-GCM
 *
 * Decryption dispatches on shape; encryption only ever writes v2. Nothing
 * needs migrating, and a legacy value re-encrypted for any reason comes back
 * as v2.
 */
import crypto from "crypto";
import { promisify } from "util";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Marks the authenticated format. Legacy payloads carry no prefix. */
const V2 = "v2";
const LEGACY_ALGORITHM = "aes-256-cbc";
const V2_ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** GCM's standard nonce length. NOT 16 — CBC's IV size is a different thing. */
const GCM_IV_BYTES = 12;

/** Thrown when authenticated decryption fails, i.e. wrong key OR tampering. */
export class ContentDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentDecryptionError";
  }
}

/**
 * Encrypt `content` under `key`, returning a self-describing v2 payload.
 */
export async function encryptContent(
  content: string,
  key: string,
): Promise<string> {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(GCM_IV_BYTES);
  const keyBuffer = await scrypt(key, salt, KEY_BYTES);

  const cipher = crypto.createCipheriv(V2_ALGORITHM, keyBuffer, iv);
  let encrypted = cipher.update(content, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return [
    V2,
    salt.toString("hex"),
    iv.toString("hex"),
    tag.toString("hex"),
    encrypted,
  ].join(":");
}

/**
 * Decrypt a payload in either format.
 *
 * Throws `ContentDecryptionError` on a wrong key, a tampered payload, or an
 * unrecognised shape — callers already treat a throw as "cannot decrypt", and
 * distinguishing "wrong key" from "tampered" is not something GCM lets us do
 * anyway.
 */
export async function decryptContent(
  payload: string,
  key: string,
): Promise<string> {
  const parts = payload.split(":");

  if (parts[0] === V2) {
    if (parts.length !== 5) {
      throw new ContentDecryptionError("Malformed v2 encrypted payload");
    }
    const salt = Buffer.from(parts[1]!, "hex");
    const iv = Buffer.from(parts[2]!, "hex");
    const tag = Buffer.from(parts[3]!, "hex");
    const keyBuffer = await scrypt(key, salt, KEY_BYTES);

    const decipher = crypto.createDecipheriv(V2_ALGORITHM, keyBuffer, iv);
    decipher.setAuthTag(tag);
    try {
      let decrypted = decipher.update(parts[4]!, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch {
      // GCM's final() is where authentication is checked.
      throw new ContentDecryptionError(
        "Decryption failed — wrong key or the content has been tampered with",
      );
    }
  }

  // Legacy, unauthenticated. Kept readable so existing rows survive; never
  // produced by `encryptContent`.
  if (parts.length !== 3) {
    throw new ContentDecryptionError("Invalid encrypted content format");
  }
  const salt = Buffer.from(parts[0]!, "hex");
  const iv = Buffer.from(parts[1]!, "hex");
  const keyBuffer = await scrypt(key, salt, KEY_BYTES);

  const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, keyBuffer, iv);
  try {
    let decrypted = decipher.update(parts[2]!, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    throw new ContentDecryptionError("Decryption failed — invalid key");
  }
}

/** True when a payload is in the authenticated v2 format. */
export function isAuthenticatedPayload(payload: string): boolean {
  return payload.startsWith(`${V2}:`);
}

