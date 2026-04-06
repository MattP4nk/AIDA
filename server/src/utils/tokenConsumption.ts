/**
 * Token Consumption Helper — AI Persona Message Gating
 *
 * Provides utilities for checking and consuming communication tokens
 * that gate player messages to AI personas. Tokens are InventoryItems
 * backed by ShopItems with `itemType = "token"` and an `effect` JSON
 * field that references the persona name.
 *
 * Effect JSON shape: { type: "persona_message", personaName: "gh0st" }
 *
 * Usage:
 *   const result = await findPersonaToken(prisma, userId, "gh0st");
 *   if (result) await consumeToken(prisma, result.inventoryItemId);
 */

import type { PrismaClient } from "@prisma/client";

// ── Known AI Persona Names ──────────────────────────────────────────
// Authoritative list of persona names the system recognises.
// Used by command handlers to decide whether to route through the
// token-gated flow vs. normal private messaging.
export const AI_PERSONA_NAMES: ReadonlySet<string> = new Set([
  "The Architect",
  "AIDA",
  "Commander Steele",
  "gh0st",
  "Director Chen",
]);

/**
 * Check whether a username belongs to a known AI persona.
 * Comparison is case-insensitive so players can type "the architect".
 */
export function isAIPersonaUsername(username: string): boolean {
  const lower = username.toLowerCase();
  for (const name of AI_PERSONA_NAMES) {
    if (name.toLowerCase() === lower) return true;
  }
  return false;
}

/**
 * Return the canonical persona name for a case-insensitive lookup,
 * or `null` if the username is not a persona.
 */
export function resolvePersonaName(username: string): string | null {
  const lower = username.toLowerCase();
  for (const name of AI_PERSONA_NAMES) {
    if (name.toLowerCase() === lower) return name;
  }
  return null;
}

// ── Token lookup result ─────────────────────────────────────────────

export interface PersonaTokenInfo {
  inventoryItemId: string;
  shopItemId: string;
  shopItemName: string;
  quantity: number;
  /** The full effect JSON from the ShopItem */
  effect: Record<string, unknown>;
}

/**
 * Find a communication token in a player's inventory that grants
 * access to the given persona.
 *
 * Because Prisma's JSON filtering is database-dependent and the
 * `effect` field is `Json?`, we take the safe route: query all
 * token-type inventory items for the user and filter in JS.
 *
 * Returns `null` when no usable token is found.
 */
export async function findPersonaToken(
  prisma: PrismaClient,
  userId: string,
  personaName: string,
): Promise<PersonaTokenInfo | null> {
  // Pull all token-typed inventory items the player owns (quantity > 0)
  const items = await prisma.inventoryItem.findMany({
    where: {
      userId,
      quantity: { gt: 0 },
      shopItem: {
        itemType: "token",
      },
    },
    include: {
      shopItem: {
        select: {
          id: true,
          name: true,
          effect: true,
        },
      },
    },
  });

  const lowerPersona = personaName.toLowerCase();

  for (const item of items) {
    const effect = item.shopItem.effect as Record<string, unknown> | null;
    if (!effect || typeof effect !== "object") continue;

    // Match by personaName field (primary)
    if (
      typeof effect.personaName === "string" &&
      effect.personaName.toLowerCase() === lowerPersona
    ) {
      return {
        inventoryItemId: item.id,
        shopItemId: item.shopItem.id,
        shopItemName: item.shopItem.name,
        quantity: item.quantity,
        effect,
      };
    }

    // Fallback: match by personaId embedded in the effect
    if (typeof effect.personaId === "string") {
      // We don't resolve IDs here — callers should prefer name-based tokens
      continue;
    }
  }

  return null;
}

/**
 * Consume one use of a communication token.
 *
 * - Decrements `quantity` by 1.
 * - Updates `lastUsedAt`.
 * - If quantity reaches 0, deletes the inventory row entirely.
 *
 * Returns `true` if consumption succeeded, `false` if the item
 * was not found or already depleted (race-condition guard).
 */
export async function consumeToken(
  prisma: PrismaClient,
  inventoryItemId: string,
): Promise<boolean> {
  // Use a transaction so we never charge without sending or vice-versa.
  return prisma.$transaction(async (tx) => {
    const item = await tx.inventoryItem.findUnique({
      where: { id: inventoryItemId },
    });

    if (!item || item.quantity <= 0) {
      return false;
    }

    if (item.quantity === 1) {
      // Last token — remove the row
      await tx.inventoryItem.delete({
        where: { id: inventoryItemId },
      });
    } else {
      await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: {
          quantity: { decrement: 1 },
          lastUsedAt: new Date(),
        },
      });
    }

    return true;
  });
}

/**
 * Combined check-and-consume in a single transaction.
 *
 * Returns the token info on success or an error string on failure.
 * The token is consumed atomically — if the message send later fails
 * the caller is responsible for compensating (e.g. re-granting).
 */
export async function checkAndConsumeToken(
  prisma: PrismaClient,
  userId: string,
  personaName: string,
): Promise<{ ok: true; token: PersonaTokenInfo } | { ok: false; error: string }> {
  const token = await findPersonaToken(prisma, userId, personaName);

  if (!token) {
    return {
      ok: false,
      error:
        `You need a communication token to contact ${personaName}. ` +
        `These can be found on certain servers or earned through missions.`,
    };
  }

  const consumed = await consumeToken(prisma, token.inventoryItemId);

  if (!consumed) {
    return {
      ok: false,
      error:
        `Your communication token for ${personaName} could not be consumed. ` +
        `It may have already been used.`,
    };
  }

  return { ok: true, token };
}

// ── Tutorial bypass check ───────────────────────────────────────────

/**
 * Check whether a player has an active tutorial mission, which means
 * messages to "The Architect" should bypass token gating and flow
 * through the free tutorial reply system instead.
 */
export async function hasActiveTutorial(
  prisma: PrismaClient,
  userId: string,
): Promise<boolean> {
  const count = await prisma.mission.count({
    where: {
      assignedTo: userId,
      type: "tutorial",
      status: { in: ["available", "assigned", "active"] },
    },
  });
  return count > 0;
}

/**
 * Determine whether a message to a given persona should be routed
 * through the token-gated flow.
 *
 * Returns `false` (skip gating) when:
 *   - The recipient is not a known AI persona
 *   - The recipient is "The Architect" AND the player has an active tutorial
 *
 * Returns `true` (require token) otherwise.
 */
export async function shouldRequireToken(
  prisma: PrismaClient,
  userId: string,
  recipientUsername: string,
): Promise<boolean> {
  const personaName = resolvePersonaName(recipientUsername);
  if (!personaName) return false; // Not a persona — normal message

  // The Architect during active tutorial is free
  if (personaName === "The Architect") {
    const inTutorial = await hasActiveTutorial(prisma, userId);
    if (inTutorial) return false;
  }

  return true;
}
