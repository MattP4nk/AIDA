/**
 * One-time data repair for the D10 connection leak (Phase 3 step 2).
 *
 * `connect <ip>` never deactivated the ServerConnection row for the server
 * being left, so active rows accumulated forever. Measured before the code fix:
 * 95 of 95 rows active, `disconnectedAt` null on every one, every player
 * holding 3 simultaneously-"active" servers.
 *
 * The session model is one server at a time (`session.currentServerId` is
 * singular), so the repair is: keep the most recent active row per user,
 * deactivate the rest, then re-derive every server's `currentConnections`.
 *
 * Deactivating does NOT erase "previously hacked" history — the three call
 * sites that check it (`networkTopologyService` :732/:754,
 * `playerInfoCommands` :984) filter on `accessLevel > 0` WITHOUT `isActive`,
 * which this script asserts before and after.
 *
 * Idempotent. Run: npx tsx scripts/fix-dangling-connections.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = {
    active: await prisma.serverConnection.count({ where: { isActive: true } }),
    total: await prisma.serverConnection.count(),
    hackedHistory: await prisma.serverConnection.count({ where: { accessLevel: { gt: 0 } } }),
  };
  console.log(`BEFORE: ${before.active} active / ${before.total} total, ${before.hackedHistory} rows with accessLevel > 0`);

  // Most recent active row per user wins.
  const active = await prisma.serverConnection.findMany({
    where: { isActive: true },
    select: { id: true, userId: true, connectedAt: true },
    orderBy: [{ userId: "asc" }, { connectedAt: "desc" }, { id: "desc" }],
  });

  const keep = new Set<string>();
  const seen = new Set<string>();
  for (const row of active) {
    if (!seen.has(row.userId)) {
      seen.add(row.userId);
      keep.add(row.id);
    }
  }
  const staleIds = active.filter((r) => !keep.has(r.id)).map((r) => r.id);

  if (staleIds.length > 0) {
    const res = await prisma.serverConnection.updateMany({
      where: { id: { in: staleIds } },
      data: { isActive: false, disconnectedAt: new Date() },
    });
    console.log(`Deactivated ${res.count} stale rows (kept 1 per user for ${seen.size} users)`);
  } else {
    console.log("No stale rows — nothing to deactivate");
  }

  // Re-derive currentConnections on every server.
  const servers = await prisma.gameServer.findMany({ select: { id: true, currentConnections: true } });
  let resynced = 0;
  for (const s of servers) {
    const count = await prisma.serverConnection.count({
      where: { serverId: s.id, isActive: true },
    });
    if (count !== s.currentConnections) {
      await prisma.gameServer.update({ where: { id: s.id }, data: { currentConnections: count } });
      resynced++;
    }
  }
  console.log(`Resynced currentConnections on ${resynced} of ${servers.length} servers`);

  // ── Assertions ──────────────────────────────────────────────────────────
  const multi = await prisma.serverConnection.groupBy({
    by: ["userId"],
    where: { isActive: true },
    _count: { _all: true },
  });
  const offenders = multi.filter((m) => m._count._all > 1);
  console.log(`[${offenders.length === 0 ? "PASS" : "FAIL"}] no user holds more than one active connection (${offenders.length} offenders)`);

  let drifted = 0;
  for (const s of await prisma.gameServer.findMany({ select: { id: true, currentConnections: true } })) {
    const count = await prisma.serverConnection.count({ where: { serverId: s.id, isActive: true } });
    if (count !== s.currentConnections) drifted++;
  }
  console.log(`[${drifted === 0 ? "PASS" : "FAIL"}] currentConnections matches the rows on every server (${drifted} drifted)`);

  const hackedAfter = await prisma.serverConnection.count({ where: { accessLevel: { gt: 0 } } });
  console.log(
    `[${hackedAfter === before.hackedHistory ? "PASS" : "FAIL"}] previously-hacked history preserved ` +
      `(${before.hackedHistory} -> ${hackedAfter})`,
  );

  const after = await prisma.serverConnection.count({ where: { isActive: true } });
  console.log(`AFTER: ${after} active / ${before.total} total`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
