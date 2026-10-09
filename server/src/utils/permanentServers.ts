/**
 * Servers that will still exist tomorrow: the only safe place to put
 * something a player must come back to — a respawned key fragment, a
 * mission's target.
 *
 * Not a home, not the hidden AIDA server, online, not tutorial, and not in a
 * darknet dungeon: dungeon servers are deleted when the dungeon expires,
 * which stranded a fragment for good (review 2026-10-09) and would make a
 * mission impossible.
 */
import type { Prisma, PrismaClient } from "@prisma/client";

export async function permanentServerWhere(prisma: PrismaClient): Promise<Prisma.GameServerWhereInput> {
  const dungeonNetworks = (await prisma.darkNetInstance.findMany({ select: { networkId: true } }))
    .map((d) => d.networkId);
  return {
    isPlayerHome: false,
    isAidaHomeServer: false,
    isOnline: true,
    type: { not: "tutorial" },
    OR: [{ networkId: null }, { networkId: { notIn: dungeonNetworks } }],
  };
}
