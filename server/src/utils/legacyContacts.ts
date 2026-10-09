/**
 * Contacts made before contact requests existed (maintainer decision Q5,
 * 2026-10-08) become ACCEPTED.
 *
 * Before Q5, `contact add` wrote every row as "pending" and nothing could ever
 * accept one, while the chat contact list showed every row whatever its status.
 * Q5 made pending mean "a request awaiting the other player", and the chat
 * list shows accepted contacts only — so on deploy every existing contact
 * would vanish from chat, and the other side would see an incoming request it
 * was never notified of (review 2026-10-09).
 *
 * One-sided on purpose: it restores exactly what each owner had (their list),
 * and gives the other player nothing they did not choose. A one-sided accepted
 * row is a state the new flow handles: if the other player adds back, it is an
 * ordinary request.
 *
 * Legacy = not accepted, created before `before`. On a deploy, run it before
 * the new code serves requests with the default `before` (now): every
 * non-accepted row then predates requests.
 */
import type { PrismaClient } from "@prisma/client";

export async function migrateLegacyContacts(
  prisma: PrismaClient,
  opts: { before: Date; dryRun?: boolean; ids?: string[] },
): Promise<{ legacy: number; updated: number }> {
  const where = {
    status: { not: "accepted" },
    createdAt: { lt: opts.before },
    ...(opts.ids ? { id: { in: opts.ids } } : {}),
  };
  const legacy = await prisma.contact.count({ where });
  if (opts.dryRun) return { legacy, updated: 0 };
  const { count } = await prisma.contact.updateMany({ where, data: { status: "accepted" } });
  return { legacy, updated: count };
}
