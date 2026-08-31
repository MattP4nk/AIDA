/**
 * Resolve-or-create the User account that backs an AI persona or an NPC forum
 * handle.
 *
 * This exists because the same "get an account for this AI" logic was open-coded
 * in four places with four different answers for `homeIp` — and `User.homeIp` is
 * `@unique`:
 *
 *   messageService.getAIUserId       homeIp: "127.0.0.1"          <- BROKEN
 *   forumService (post path)         ipService.generateUniqueIP() <- correct
 *   forumService (reply path)        homeIp: "127.0.0.1"          <- BROKEN
 *   forumService (npc handle)        127.0.<rand>.<rand>          <- collision-prone
 *
 * The two hardcoded `127.0.0.1` sites could only ever create ONE account: the
 * first persona to need one succeeded and every persona after it failed on the
 * unique constraint, so `sendAIMessage` was a single call away from breaking for
 * all but one persona. The random variant merely made the collision unlikely
 * rather than impossible, with no retry.
 *
 * Synthetic accounts get an address from a reserved block that no player or
 * server can occupy, allocated deterministically and then linear-probed, so the
 * same persona keeps the same address across runs without ever colliding.
 */
import crypto from "crypto";
import { db } from "../database/client";

/**
 * Reserved prefix for synthetic identities. `0.0.0.0/16` is "this network" —
 * never routable, and visibly not a game address. `npcOwnership.ts` already
 * places its NPC owners at `0.0.0.1`–`0.0.0.5`, so this extends an existing
 * convention rather than inventing a second one.
 */
const SYNTHETIC_IP_PREFIX = "0.0";
/** Addresses available as `0.0.a.b`. Ample for personas + NPC handles. */
const SYNTHETIC_IP_SPACE = 256 * 256;
/** Skip `0.0.0.0`–`0.0.0.15`: 0.0.0.0 is the SYSTEM user and 1–5 are NPC owners. */
const SYNTHETIC_IP_RESERVED = 16;

/** Canonical email domains — these ARE the lookup keys, not the usernames. */
const AI_EMAIL_DOMAIN = "ai.aida.internal";
const NPC_EMAIL_DOMAIN = "npc.aida.internal";

/**
 * Allocate a unique address in the synthetic block.
 *
 * Deterministic start derived from `key`, then linear probing, so a given
 * persona is stable across runs but a collision still resolves instead of
 * throwing.
 */
async function allocateSyntheticIp(key: string): Promise<string> {
  const digest = crypto.createHash("sha256").update(key).digest();
  const start = digest.readUInt32BE(0) % SYNTHETIC_IP_SPACE;

  for (let probe = 0; probe < SYNTHETIC_IP_SPACE; probe++) {
    const slot = (start + probe) % SYNTHETIC_IP_SPACE;
    if (slot < SYNTHETIC_IP_RESERVED) continue;
    const ip = `${SYNTHETIC_IP_PREFIX}.${Math.floor(slot / 256)}.${slot % 256}`;
    const taken = await db.client.user.findUnique({
      where: { homeIp: ip },
      select: { id: true },
    });
    if (!taken) return ip;
  }

  throw new Error("Synthetic IP block exhausted");
}

/** Random password that cannot be a hash of any input — these never log in. */
function unusablePassword(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Repair legacy AI accounts that were created with `role: "player"`.
 *
 * The pre-existing forum path built persona accounts via
 * `ipService.generateUniqueIP()`, which allocated from the PLAYER range and left
 * the default role — so an AI persona had a player-looking home IP and was
 * counted as a player by `adminApi/stats.ts`. Idempotent, and only ever narrows
 * a role to "npc", so it cannot demote a real account: the only callers are the
 * AI/NPC resolvers, reached solely via persona ids and NPC handles.
 */
async function normalizeRole(user: { id: string; role: string }): Promise<string> {
  if (user.role !== "npc") {
    await db.client.user
      .update({ where: { id: user.id }, data: { role: "npc" } })
      .catch(() => {
        /* non-critical — the account is still usable */
      });
  }
  return user.id;
}

/**
 * The account for an AI persona, creating it if needed.
 *
 * Resolution order puts EMAIL before username, because email is derived from the
 * persona id and is therefore stable, whereas a persona's display name can be
 * edited. The legacy `ai_<personaId>` id form is still honoured first so existing
 * rows keep working.
 */
export async function resolveAiPersonaUserId(
  personaId: string,
  displayName?: string,
): Promise<string> {
  const legacyId = `ai_${personaId}`;
  const email = `${personaId}@${AI_EMAIL_DOMAIN}`;

  const byId = await db.client.user.findUnique({
    where: { id: legacyId },
    select: { id: true, role: true },
  });
  if (byId) return normalizeRole(byId);

  const byEmail = await db.client.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (byEmail) return normalizeRole(byEmail);

  const persona = await db.client.aIPersona.findUnique({
    where: { id: personaId },
    select: { name: true },
  });
  const username = displayName ?? persona?.name ?? `AI_${personaId.slice(0, 8)}`;

  // A row may exist under the display name from an earlier code path that keyed
  // on username rather than email.
  const byUsername = await db.client.user.findUnique({
    where: { username },
    select: { id: true, role: true },
  });
  if (byUsername) return normalizeRole(byUsername);

  return createSyntheticUser({
    id: legacyId,
    username,
    email,
    ipKey: personaId,
    role: "npc",
  });
}

/**
 * The account for an NPC forum handle (a throwaway in-world poster, not a
 * persona). Keyed on the handle, which is all the caller has.
 */
export async function resolveNpcHandleUserId(handle: string): Promise<string> {
  // Preserve the existing id convention so rows created before this helper keep
  // resolving to the same account.
  const legacyId = `npc_forum_${handle}`;
  const email = `${handle}@${NPC_EMAIL_DOMAIN}`;

  const byId = await db.client.user.findUnique({
    where: { id: legacyId },
    select: { id: true, role: true },
  });
  if (byId) return normalizeRole(byId);

  const byEmail = await db.client.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });
  if (byEmail) return normalizeRole(byEmail);

  const byUsername = await db.client.user.findUnique({
    where: { username: handle },
    select: { id: true, role: true },
  });
  if (byUsername) return normalizeRole(byUsername);

  return createSyntheticUser({
    id: legacyId,
    username: handle,
    email,
    ipKey: `handle:${handle}`,
    role: "npc",
  });
}

/**
 * Create a synthetic account, tolerating the race where a concurrent caller
 * created it first (unique violation on any of id/username/email/homeIp).
 */
async function createSyntheticUser(input: {
  id?: string;
  username: string;
  email: string;
  ipKey: string;
  role: string;
}): Promise<string> {
  try {
    const homeIp = await allocateSyntheticIp(input.ipKey);
    const created = await db.client.user.create({
      data: {
        ...(input.id ? { id: input.id } : {}),
        username: input.username,
        email: input.email,
        password: unusablePassword(),
        homeIp,
        role: input.role,
        isOnline: false,
      },
      select: { id: true },
    });
    return created.id;
  } catch (err) {
    // Lost a race, or one of the unique columns was already taken. Re-read
    // rather than surfacing a constraint error to the caller.
    const existing = await db.client.user.findFirst({
      where: {
        OR: [
          ...(input.id ? [{ id: input.id }] : []),
          { email: input.email },
          { username: input.username },
        ],
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    throw err;
  }
}
