/**
 * Active-mission cap.
 *
 * `MAX_ACTIVE_MISSIONS = 5` sat in gameBalance with no consumer AND no
 * hardcoded twin — so unlike the other 17 dead constants, nothing anywhere
 * limited how many missions a player could hold. Verified no competing
 * implementation existed before wiring.
 *
 * SELF-CONTAINED: creates its own user and missions, deletes both.
 *
 * Run: npx tsx scripts/verify-mission-cap.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { MAX_ACTIVE_MISSIONS } from "../src/config/gameBalance";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

async function main() {
  console.log("\n=== Active-mission cap ===");
  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const missions = getService<any>(TOKENS.MISSION_SERVICE);
  const repo = getService<any>(TOKENS.PLAYER_MISSION_REPOSITORY);

  const tag = `__cap_probe_${process.pid}`;
  let userId: string | null = null;
  const missionIds: string[] = [];

  try {
    const user = await prisma.user.create({
      data: {
        username: tag, email: `${tag}@probe.local`, password: "probe",
        homeIp: `10.1.0.${process.pid % 250}`,
        progress: { create: { level: 50 } },
      },
    });
    userId = user.id;

    // Offer the player MAX+2 missions, all "available" to them.
    for (let i = 0; i < MAX_ACTIVE_MISSIONS + 2; i++) {
      const m = await prisma.mission.create({
        data: {
          title: `${tag}_m${i}`, description: "probe", type: "side",
          difficulty: 1, reward: { xp: 1, credits: 1 }, status: "available",
          objectives: [], createdBy: user.id, assignedTo: user.id,
        },
      });
      missionIds.push(m.id);
      await repo.mutate(user.id, m.id, () => ({
        missionId: m.id, status: "available", objectives: [], startedAt: null,
      }));
    }

    console.log(`\nMC-1 — the first ${MAX_ACTIVE_MISSIONS} are accepted`);
    {
      let accepted = 0;
      for (let i = 0; i < MAX_ACTIVE_MISSIONS; i++) {
        try { await missions.acceptMission(user.id, missionIds[i]!); accepted++; } catch { /* counted below */ }
      }
      check(`all ${MAX_ACTIVE_MISSIONS} accepted`, accepted === MAX_ACTIVE_MISSIONS, `${accepted}`);
      const held = await repo.list(user.id);
      check(
        "and they are active",
        held.filter((m: any) => m.status === "active").length === MAX_ACTIVE_MISSIONS,
        `${held.filter((m: any) => m.status === "active").length} active`,
      );
    }

    console.log("\nMC-2 — the next one is refused");
    {
      let msg = "";
      try { await missions.acceptMission(user.id, missionIds[MAX_ACTIVE_MISSIONS]!); }
      catch (e) { msg = e instanceof Error ? e.message : String(e); }
      check("it throws", msg !== "", msg.slice(0, 80));
      check("with a message naming the limit", msg.includes(String(MAX_ACTIVE_MISSIONS)), msg.slice(0, 80));
      check(
        "and telling the player how to proceed",
        /complete or abandon/i.test(msg),
        "a bare 'limit reached' leaves them stuck",
      );

      // The refusal must NOT consume the offer.
      const stored = await repo.get(user.id, missionIds[MAX_ACTIVE_MISSIONS]!);
      check(
        "the refused offer is STILL available, not consumed",
        stored?.status === "available",
        `status=${stored?.status} — checking inside the mutate would have claimed it`,
      );
      const active = (await repo.list(user.id)).filter((m: any) => m.status === "active").length;
      check("and the active count did not move", active === MAX_ACTIVE_MISSIONS, `${active}`);
    }

    console.log("\nMC-3 — freeing a slot lets another in");
    {
      await missions.abandonMission(user.id, missionIds[0]!);
      const afterAbandon = (await repo.list(user.id)).filter((m: any) => m.status === "active").length;
      check("abandoning frees a slot", afterAbandon === MAX_ACTIVE_MISSIONS - 1, `${afterAbandon} active`);

      let ok = true;
      try { await missions.acceptMission(user.id, missionIds[MAX_ACTIVE_MISSIONS]!); }
      catch { ok = false; }
      check("the previously-refused mission is now accepted", ok,
        "a cap that never releases would be worse than no cap");
    }
  } finally {
    if (userId) {
      await prisma.playerMissionObjective.deleteMany({ where: { playerMission: { userId } } }).catch(() => {});
      await prisma.playerMission.deleteMany({ where: { userId } }).catch(() => {});
      await prisma.mission.deleteMany({ where: { id: { in: missionIds } } }).catch(() => {});
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}
main().catch((e) => { console.error("HARNESS ERROR:", e); process.exit(1); });
