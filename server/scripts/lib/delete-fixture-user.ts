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
  const homes = (await prisma.gameServer.findMany({
    where: { isPlayerHome: true, ownerId: { in: ids } },
    select: { id: true },
  })).map((h) => h.id);
  // Rows that RESTRICT deleting the users or their homes (required relations
  // with no onDelete): hack logs — by attacker, target or target SERVER —
  // posts, message reports, and contacts pointing AT a fixture. They are
  // fixture data too. Without this, a fixture that ever hacked or was hacked
  // could not be deleted at all (55 tutorial probes, 2026-10-09). They go
  // BEFORE the homes: a hack log on a home blocks deleting the home.
  await prisma.hackLog.deleteMany({
    where: { OR: [{ attackerId: { in: ids } }, { targetId: { in: ids } }, { targetServerId: { in: homes } }] },
  });
  await prisma.contact.deleteMany({ where: { contactUserId: { in: ids } } });
  // The fixtures' private mission OFFERS. Offers are per player (one Mission
  // row each); deleting the user cascaded only its copies and left the rows —
  // two per fresh account. A mission is theirs if every player copy belongs
  // to them and it is not world content (no faction, no story arc).
  const offers = await prisma.mission.findMany({
    where: {
      factionId: null,
      storyArcId: null,
      playerCopies: { some: { userId: { in: ids } }, every: { userId: { in: ids } } },
    },
    select: { id: true },
  });
  await prisma.mission.deleteMany({ where: { id: { in: offers.map((o) => o.id) } } });
  await prisma.post.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.messageReport.deleteMany({ where: { reporterId: { in: ids } } });
  // Homes before users: once the user is gone the owner link is null and the
  // home is indistinguishable from anyone else's orphan.
  await prisma.gameServer.deleteMany({ where: { id: { in: homes } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}
