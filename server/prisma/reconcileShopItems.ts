/**
 * Retires the `seed_*` shop-item universe.
 *
 * The shop used to have two disjoint item sets: the in-memory `SHOP_CATALOG`
 * (synced to this table at boot, ids like `quantum_charge`) and rows seeded here
 * with ids like `seed_ram_module_mk1`. The shop listed only the catalog, so every
 * seeded row was invisible to `buy` and rejected by `sell`/`use`/`equip` — while
 * still appearing in the player's inventory panel, because that one path falls
 * back to the joined table row.
 *
 * The 9 hardware parts and 6 persona tokens now live in the catalog. This
 * repoints any inventory still holding an old row onto its catalog equivalent,
 * then deletes the orphans.
 *
 * Idempotent: after the first run there is nothing left to move.
 */
import { PrismaClient } from "@prisma/client";

/**
 * Old `seed_*` id → new catalog id.
 *
 * Keys are reproduced exactly as the old seed generated them:
 *   `seed_${name.toLowerCase().replace(/[^a-z0-9]/g, "_")}`
 */
const SEED_TO_CATALOG: Readonly<Record<string, string>> = {
  // Hardware
  seed_ram_module_mk1: "ram_module_mk1",
  seed_ram_module_mk2: "ram_module_mk2",
  seed_quantum_ram: "quantum_ram",
  seed_cpu_fan_upgrade: "cpu_fan_upgrade",
  seed_cpu_overclock_kit: "cpu_overclock_kit",
  seed_neural_coprocessor: "neural_coprocessor",
  seed_network_card_mk1: "network_card_mk1",
  seed_fiber_uplink: "fiber_uplink",
  seed_darknet_relay: "darknet_relay",

  // Persona tokens
  seed_commander_steele_s_briefing_token: "token_steele_briefing",
  seed_gh0st_s_dead_drop_token: "token_gh0st_deaddrop",
  seed_director_chen_s_business_card: "token_chen_card",
  seed_aida_signal_fragment: "token_aida_fragment",
  seed_envoy_s_cipher_token: "token_envoy_cipher",
  seed_architect_s_seal: "token_architect_seal",
};

export async function reconcileShopItems(
  prisma: PrismaClient = new PrismaClient(),
): Promise<{ moved: number; merged: number; deleted: number }> {
  let moved = 0;
  let merged = 0;

  for (const [oldId, newId] of Object.entries(SEED_TO_CATALOG)) {
    const rows = await prisma.inventoryItem.findMany({
      where: { shopItemId: oldId },
    });
    if (rows.length === 0) continue;

    // The catalog row must already exist — the boot sync creates it. If the
    // reconcile runs before a server has ever booted (fresh `db:reset`), skip
    // rather than orphan the FK.
    const target = await prisma.shopItem.findUnique({ where: { id: newId } });
    if (!target) continue;

    for (const row of rows) {
      // The player may already hold the catalog version; merge quantities
      // instead of creating a duplicate, since `InventoryItem` has no
      // @@unique([userId, shopItemId]) to stop one and every reader uses
      // findFirst, so a duplicate would silently hide stock.
      const existing = await prisma.inventoryItem.findFirst({
        where: { userId: row.userId, shopItemId: newId },
      });

      if (existing) {
        await prisma.inventoryItem.update({
          where: { id: existing.id },
          data: { quantity: { increment: row.quantity } },
        });
        await prisma.inventoryItem.delete({ where: { id: row.id } });
        merged++;
      } else {
        await prisma.inventoryItem.update({
          where: { id: row.id },
          data: { shopItemId: newId },
        });
        moved++;
      }
    }
  }

  // Drop every `seed_*` row nothing references any more.
  //
  // Deliberately NOT limited to the ids in the map above: the old seed also
  // wrote four software duplicates (Port Scanner Pro, Brute Force Toolkit,
  // Stealth Proxy, Cipher Toolkit) that were never moved because catalog
  // equivalents already exist. Deleting only mapped ids left those stranded —
  // caught by the G3 harness asserting no `seed_*` rows survive.
  //
  // The reference check matters: `InventoryItem.shopItemId` has no `onDelete`,
  // so it defaults to Restrict and a blind delete would throw on any row a
  // player still holds. Anything still referenced is left in place rather than
  // taking the process down.
  const remaining = await prisma.shopItem.findMany({
    where: { id: { startsWith: "seed_" } },
    select: { id: true, _count: { select: { inventoryItems: true } } },
  });
  const deletable = remaining
    .filter((r) => r._count.inventoryItems === 0)
    .map((r) => r.id);
  const stillHeld = remaining.filter((r) => r._count.inventoryItems > 0);

  if (stillHeld.length > 0) {
    console.log(
      `  [!] Shop reconcile: ${stillHeld.length} seed rows still referenced, left in place: ` +
        stillHeld.map((r) => r.id).join(", "),
    );
  }

  const { count: deleted } = await prisma.shopItem.deleteMany({
    where: { id: { in: deletable } },
  });

  console.log(
    `  [OK] Shop reconcile: ${moved} moved, ${merged} merged, ${deleted} seed rows removed`,
  );
  return { moved, merged, deleted };
}
