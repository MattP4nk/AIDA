/**
 * Delete fixture users AND their home servers.
 *
 * Registration gives every account a home GameServer. `GameServer.owner` has
 * no onDelete, so deleting the user alone left the home behind with ownerId
 * null — 247 ownerless homes had piled up in the dev DB by 2026-10-09, each
 * holding an IP and a filesystem. The game itself never deletes users; only
 * harnesses do, so every harness deletes users through here (pinned by
 * scripts/verify-fixture-user-cleanup.ts).
 *
 * Scoped by id: only homes those users OWN are deleted (their nodes, links and
 * connections cascade). Like `user.deleteMany`, a missing id is not an error.
 */
import type { PrismaClient } from "@prisma/client";

export async function deleteFixtureUsers(prisma: PrismaClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  // Homes first: once the user is gone the owner link is null and the home is
  // indistinguishable from anyone else's orphan.
  await prisma.gameServer.deleteMany({ where: { isPlayerHome: true, ownerId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
