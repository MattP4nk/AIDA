/**
 * Progress backup — wiring a subsystem that had no reachable entry point.
 *
 * Orphan audit: `createBackup`, `createBackupForAll`, `deleteOldBackups` and
 * `restoreBackup` all had ZERO callers and `ProgressBackup` had 0 rows, so
 * there was **no recovery path for player progress at all**.
 *
 * Checked against the lens the previous two items failed: nothing else in the
 * codebase provides backup or restore, so unlike the IP cluster (superseded by
 * topology) and `getTraceDuration` (inverted), there is no live implementation
 * to contradict. This one is a genuine absence.
 *
 * The harness drives a real round trip — take a snapshot, corrupt the row,
 * restore, confirm recovery. A backup that cannot restore is worse than none,
 * because it looks like insurance.
 *
 * SELF-CONTAINED: creates its own user and deletes it.
 *
 * Run: npx tsx scripts/verify-progress-backup.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("\n=== Progress backup ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const progress = getService<any>(TOKENS.PROGRESS_SERVICE);

  const tag = `__backup_probe_${process.pid}`;
  let userId: string | null = null;

  try {
    const user = await prisma.user.create({
      data: {
        username: tag,
        email: `${tag}@probe.local`,
        password: "probe",
        homeIp: "10.0.0." + (process.pid % 250),
        isOnline: true,
        progress: { create: { credits: 12345, experience: 999, hacking: 42 } },
      },
      include: { progress: true },
    });
    userId = user.id;

    // ── A snapshot can be taken at all ───────────────────────────────
    console.log("\nPB-1 — a backup can be created");
    {
      const before = await prisma.progressBackup.count({ where: { userId: user.id } });
      const backup = await progress.createBackup(user.id, "probe");
      check("createBackup returns a row", !!backup?.id, backup?.id ?? "null");
      check(
        "and it is persisted",
        (await prisma.progressBackup.count({ where: { userId: user.id } })) === before + 1,
        "the table had 0 rows repo-wide before this was wired",
      );
      check("with the reason recorded", backup?.reason === "probe", backup?.reason);
    }

    // ── The round trip actually recovers data ────────────────────────
    console.log("\nPB-2 — restore recovers corrupted progress");
    {
      const backup = await progress.createBackup(user.id, "pre-corruption");
      // Corrupt it the way a bug would: plausible values, not nulls.
      await prisma.playerProgress.update({
        where: { userId: user.id },
        data: { credits: 0, experience: 0, hacking: 0 },
      });
      const corrupted = await prisma.playerProgress.findUnique({ where: { userId: user.id } });
      check("PRECONDITION: progress is corrupted", corrupted?.credits === 0, `credits=${corrupted?.credits}`);

      const ok = await progress.restoreBackup(user.id, backup.id);
      check("restoreBackup reports success", ok === true, String(ok));

      const restored = await prisma.playerProgress.findUnique({ where: { userId: user.id } });
      check(
        "credits are recovered",
        restored?.credits === 12345,
        `${restored?.credits} (expected 12345)`,
      );
      check("experience is recovered", restored?.experience === 999, `${restored?.experience}`);
      check(
        "and skills are recovered",
        restored?.hacking === 42,
        `${restored?.hacking} — a partial restore would be the dangerous outcome`,
      );
    }

    // ── Pruning is bounded ───────────────────────────────────────────
    console.log("\nPB-3 — history is pruned, so backups cannot grow without bound");
    {
      for (let i = 0; i < 8; i++) await progress.createBackup(user.id, `bulk-${i}`);
      const before = await prisma.progressBackup.count({ where: { userId: user.id } });
      // createBackup ALREADY self-prunes to 5 on every call (:357) — learned
      // from this harness. So the cap holds even without the scheduled prune.
      check("createBackup self-prunes, so the cap already holds", before === 5, `${before} backups after 10 creates`);

      await progress.deleteOldBackups(user.id, 5);
      const after = await prisma.progressBackup.count({ where: { userId: user.id } });
      check("pruned to the keep-count", after === 5, `${before} -> ${after}`);

      // Bound from the other side: it must keep the NEWEST, not the oldest.
      const kept = await prisma.progressBackup.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        select: { reason: true },
      });
      check(
        "and it keeps the most RECENT",
        kept[0]?.reason === "bulk-7",
        `newest kept = ${kept[0]?.reason} — pruning the wrong end would discard the useful ones`,
      );
    }

    // ── The scheduler is wired, and torn down ────────────────────────
    console.log("\nPB-4 — the scheduled job is wired and stoppable");
    {
      const src = strip(readFileSync(new URL("../src/services/progressService.ts", import.meta.url).pathname, "utf8"));
      check("start() schedules a backup", /this\.backupInterval = setInterval/.test(src));
      check(
        "the job prunes as well as creates",
        /createBackupForAll\(\)[\s\S]{0,300}?deleteOldBackups\(/.test(src),
        "creating without pruning trades a missing feature for a disk leak",
      );
      check(
        "it is reentrancy-guarded",
        /if \(this\.isBackingUp\)/.test(src),
        "a full snapshot of every online player can outrun an hourly tick",
      );
      check(
        "stop() clears it",
        /if \(this\.backupInterval\)[\s\S]{0,120}?clearInterval\(this\.backupInterval\)/.test(src),
        "two timers were found today with a stop method nobody called",
      );
    }
  } finally {
    if (userId) {
      await prisma.progressBackup.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
