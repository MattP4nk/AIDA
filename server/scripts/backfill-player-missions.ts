/**
 * D3 pass 2 — backfill `PlayerProgress.missionProgress` into the
 * `PlayerMission` / `PlayerMissionObjective` tables.
 *
 * Idempotent: re-running upserts the same rows. The blob is NOT cleared — it
 * stays as a read-only fallback until the swap has been exercised, so this is
 * reversible. Clearing it is a separate, later decision.
 *
 * KNOWN DATA LOSS, deliberate and measured: 78 of 299 blob entries (26%) point
 * at Mission rows that no longer exist. Every one is `active`, none is
 * `completed`, and all of them are ALREADY non-functional — `completeMission`
 * calls `getMission` first and throws "Mission not found", so these can never
 * progress or complete. They are skipped and reported rather than silently
 * dropped; `PlayerMission.missionId` has a real FK precisely so this class of
 * stranded row cannot accumulate again.
 *
 * Run: npx tsx scripts/backfill-player-missions.ts [--verify-only]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const verifyOnly = process.argv.includes("--verify-only");

interface BlobObjective {
  id: string;
  type?: string;
  description?: string;
  target?: number | boolean | string;
  current?: number | boolean | string;
  completed?: boolean;
  metadata?: Record<string, unknown>;
}

interface BlobMission {
  missionId?: string;
  userId?: string;
  status?: string;
  objectives?: BlobObjective[];
  startedAt?: string | null;
  completedAt?: string | null;
  expiresAt?: string | null;
  storyArcId?: string | null;
  storyStep?: number | null;
  metadata?: Record<string, unknown>;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Split a polymorphic target/current pair into the typed columns. Which pair is
 * used is decided by the runtime type of TARGET, mirroring G1 — progress
 * semantics never come from `type`.
 */
function splitObjectiveValues(o: BlobObjective) {
  const t = o.target;
  if (typeof t === "number") {
    return {
      targetCount: t,
      currentCount: typeof o.current === "number" ? o.current : 0,
      targetFlag: null,
      currentFlag: false,
      targetText: null,
      currentText: null,
    };
  }
  if (typeof t === "boolean") {
    return {
      targetCount: null,
      currentCount: 0,
      targetFlag: t,
      currentFlag: o.current === true,
      targetText: null,
      currentText: null,
    };
  }
  // Defensive: zero string targets exist today.
  return {
    targetCount: null,
    currentCount: 0,
    targetFlag: null,
    currentFlag: false,
    targetText: t == null ? null : String(t),
    currentText: o.current == null ? null : String(o.current),
  };
}

async function main() {
  console.log(`\n=== D3 pass 2 backfill ${verifyOnly ? "(verify only)" : ""} ===\n`);

  const rows = await prisma.playerProgress.findMany({
    select: { userId: true, missionProgress: true },
  });
  if (rows.length === 0) throw new Error("no playerProgress rows — vacuous run");

  // Which mission ids actually exist, so orphans can be reported not crashed on.
  const liveMissionIds = new Set(
    (await prisma.mission.findMany({ select: { id: true } })).map((m) => m.id),
  );

  let entries = 0;
  let migrated = 0;
  let objectives = 0;
  let orphaned = 0;
  const orphanStatuses = new Map<string, number>();

  for (const row of rows) {
    const blob = (row.missionProgress as unknown as Record<string, BlobMission>) || {};

    for (const [missionId, pm] of Object.entries(blob)) {
      entries++;

      if (!liveMissionIds.has(missionId)) {
        orphaned++;
        const s = pm.status ?? "(none)";
        orphanStatuses.set(s, (orphanStatuses.get(s) ?? 0) + 1);
        continue;
      }

      if (verifyOnly) {
        migrated++;
        objectives += (pm.objectives ?? []).length;
        continue;
      }

      const playerMission = await prisma.playerMission.upsert({
        where: { userId_missionId: { userId: row.userId, missionId } },
        create: {
          userId: row.userId,
          missionId,
          status: pm.status ?? "available",
          startedAt: toDate(pm.startedAt),
          completedAt: toDate(pm.completedAt),
          expiresAt: toDate(pm.expiresAt),
          storyArcId: pm.storyArcId ?? null,
          storyStep: pm.storyStep ?? null,
          metadata: (pm.metadata ?? undefined) as never,
        },
        update: {
          status: pm.status ?? "available",
          startedAt: toDate(pm.startedAt),
          completedAt: toDate(pm.completedAt),
          expiresAt: toDate(pm.expiresAt),
          storyArcId: pm.storyArcId ?? null,
          storyStep: pm.storyStep ?? null,
          metadata: (pm.metadata ?? undefined) as never,
        },
        select: { id: true },
      });
      migrated++;

      const list = pm.objectives ?? [];
      for (let i = 0; i < list.length; i++) {
        const o = list[i]!;
        const vals = splitObjectiveValues(o);
        await prisma.playerMissionObjective.upsert({
          where: {
            playerMissionId_objectiveId: {
              playerMissionId: playerMission.id,
              objectiveId: o.id,
            },
          },
          create: {
            playerMissionId: playerMission.id,
            objectiveId: o.id,
            type: o.type ?? "unknown",
            description: o.description ?? null,
            completed: o.completed === true,
            metadata: (o.metadata ?? undefined) as never,
            position: i,
            ...vals,
          },
          update: {
            type: o.type ?? "unknown",
            description: o.description ?? null,
            completed: o.completed === true,
            metadata: (o.metadata ?? undefined) as never,
            position: i,
            ...vals,
          },
          select: { id: true },
        });
        objectives++;
      }
    }
  }

  console.log(`blob entries scanned : ${entries}`);
  console.log(`migrated             : ${migrated} missions, ${objectives} objectives`);
  console.log(`SKIPPED (orphaned)   : ${orphaned} — mission row no longer exists`);
  for (const [status, n] of orphanStatuses) {
    console.log(`                       ${n} with status "${status}"`);
  }

  if (verifyOnly) return;

  // ── Assertions ────────────────────────────────────────────────────────
  console.log("");
  const pmCount = await prisma.playerMission.count();
  const objCount = await prisma.playerMissionObjective.count();
  console.log(`[${pmCount === migrated ? "PASS" : "FAIL"}] PlayerMission rows match migrated count (${pmCount} vs ${migrated})`);
  console.log(`[${objCount === objectives ? "PASS" : "FAIL"}] objective rows match (${objCount} vs ${objectives})`);

  // Every migrated mission must round-trip its status and objective count.
  let mismatched = 0;
  for (const row of rows) {
    const blob = (row.missionProgress as unknown as Record<string, BlobMission>) || {};
    for (const [missionId, pm] of Object.entries(blob)) {
      if (!liveMissionIds.has(missionId)) continue;
      const stored = await prisma.playerMission.findUnique({
        where: { userId_missionId: { userId: row.userId, missionId } },
        select: { status: true, _count: { select: { objectives: true } } },
      });
      if (
        !stored ||
        stored.status !== (pm.status ?? "available") ||
        stored._count.objectives !== (pm.objectives ?? []).length
      ) {
        mismatched++;
      }
    }
  }
  console.log(`[${mismatched === 0 ? "PASS" : "FAIL"}] every migrated entry round-trips status + objective count (${mismatched} mismatched)`);

  // A count objective's progress must survive exactly.
  const sample = await prisma.playerMissionObjective.findFirst({
    where: { targetCount: { not: null }, currentCount: { gt: 0 } },
    select: { objectiveId: true, targetCount: true, currentCount: true, completed: true },
  });
  console.log(
    sample
      ? `[PASS] sample count objective preserved: ${sample.objectiveId} ${sample.currentCount}/${sample.targetCount} completed=${sample.completed}`
      : "[info] no in-progress count objective in the data to sample",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
