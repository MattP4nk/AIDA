/**
 * One-time migration: moves inventory/equipment data from JSON fields
 * on PlayerProgress to the InventoryItem table.
 *
 * Safe to run multiple times — uses upsert to avoid duplicates.
 *
 * Usage: npx tsx scripts/migrate-inventory-to-table.ts [--dry-run]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  console.log(`\n=== Inventory Migration ${DRY_RUN ? "(DRY RUN)" : ""} ===\n`);

  const allProgress = await prisma.playerProgress.findMany({
    include: { user: { select: { username: true } } },
  });

  let totalMigrated = 0;
  let totalEquipped = 0;
  let playersProcessed = 0;

  for (const progress of allProgress) {
    const userId = progress.userId;
    const username = (progress as any).user?.username ?? userId;

    // Extract inventory from missionProgress JSON
    const missionData = (progress.missionProgress as any) || {};
    const jsonInventory: Record<string, { quantity?: number; acquiredAt?: string }> =
      missionData?.inventory || {};

    // Extract equipment from equipment JSON
    const jsonEquipment: Record<string, string> =
      (progress.equipment as Record<string, string>) || {};

    const invEntries = Object.entries(jsonInventory);
    const eqEntries = Object.entries(jsonEquipment);

    if (invEntries.length === 0 && eqEntries.length === 0) continue;

    playersProcessed++;
    console.log(`\n[${username}] ${invEntries.length} inventory items, ${eqEntries.length} equipped slots`);

    // Migrate inventory items
    for (const [itemId, data] of invEntries) {
      const quantity = data?.quantity ?? 1;
      const acquiredAt = data?.acquiredAt ? new Date(data.acquiredAt) : new Date();

      // Check if this item is equipped
      const equippedSlot = Object.entries(jsonEquipment).find(
        ([, eqItemId]) => eqItemId === itemId,
      );

      console.log(
        `  ${DRY_RUN ? "[DRY]" : "  →"} ${itemId}: qty=${quantity}${equippedSlot ? ` (equipped: ${equippedSlot[0]})` : ""}`,
      );

      if (!DRY_RUN) {
        // Upsert: create if missing, update if exists
        const existing = await prisma.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId },
        });

        if (existing) {
          await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: {
              quantity: Math.max(existing.quantity, quantity),
              isEquipped: !!equippedSlot,
              slot: equippedSlot ? equippedSlot[0] : existing.slot,
            },
          });
        } else {
          await prisma.inventoryItem.create({
            data: {
              userId,
              shopItemId: itemId,
              quantity,
              isEquipped: !!equippedSlot,
              slot: equippedSlot ? equippedSlot[0] : null,
              acquiredAt,
              source: "migration",
            },
          });
        }

        totalMigrated++;
        if (equippedSlot) totalEquipped++;
      }
    }

    // Handle equipment entries not in inventory (edge case: equipped but not in inventory JSON)
    for (const [slot, itemId] of eqEntries) {
      if (jsonInventory[itemId]) continue; // Already handled above

      console.log(`  ${DRY_RUN ? "[DRY]" : "  →"} ${itemId}: equipped-only (slot: ${slot})`);

      if (!DRY_RUN) {
        const existing = await prisma.inventoryItem.findFirst({
          where: { userId, shopItemId: itemId },
        });

        if (existing) {
          await prisma.inventoryItem.update({
            where: { id: existing.id },
            data: { isEquipped: true, slot },
          });
        } else {
          await prisma.inventoryItem.create({
            data: {
              userId,
              shopItemId: itemId,
              quantity: 1,
              isEquipped: true,
              slot,
              source: "migration",
            },
          });
        }

        totalMigrated++;
        totalEquipped++;
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Players processed: ${playersProcessed}`);
  console.log(`Items migrated: ${totalMigrated}`);
  console.log(`Items equipped: ${totalEquipped}`);

  if (DRY_RUN) {
    console.log(`\nThis was a dry run. Run without --dry-run to execute.`);
  } else {
    console.log(`\nMigration complete. JSON fields can now be ignored by code.`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
