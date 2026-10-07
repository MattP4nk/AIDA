/**
 * Phase 7 A10 — `renice` changes detection, not only cost and speed.
 *
 * `reniceProcess` recomputed the full priority adjustment (CPU, duration,
 * detection) but wrote back only CPU and duration. hackCommands reads
 * `proc.detectionModifier` when a hack prep completes, so on a running prep:
 *
 *   renice -10  -> double speed, NO detection penalty   (an exploit)
 *   renice  10  -> +50% duration, NONE of the -20%       (a trap)
 *
 * Found while unifying the detection caps with gameBalance: a zero-caller
 * `getDetectionModifierForPriority` duplicated the caps, and asking "what was
 * it for?" led here. Behavioural: drives the real MemoryService.
 *
 * Run: npx tsx scripts/verify-phase7-a10-renice-detection.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { DETECTION_AGGRESSIVE_BONUS, DETECTION_STEALTH_REDUCTION } from "../src/config/gameBalance";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const close = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;

async function main() {
  console.log("\n=== Phase 7 A10 — renice moves the detection modifier ===");
  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const mem = getService<any>(TOKENS.MEMORY_SERVICE);

  // A synthetic user that exists only in MemoryService's in-memory maps.
  const userId = `a10-renice-${Date.now()}`;
  const proc = mem.spawnGameProcess(userId, "sess", "hack_prep", 5, "10.0.0.1", "srv", undefined, undefined, 0);
  check("a hack prep spawned at normal priority", !!proc && close(proc.detectionModifier, 0),
    proc ? `detMod=${proc.detectionModifier}` : "spawn refused");
  if (!proc) throw new Error("cannot continue without a process");

  const toStealth = mem.reniceProcess(userId, proc.pid, 10);
  // POSITIVE CONTROL: the renice itself happened — cost moved — so a stale
  // detection modifier below cannot be blamed on a refused renice.
  check("renice 10 succeeded and changed CPU cost", toStealth.success && toStealth.cpuDelta < 0,
    JSON.stringify(toStealth));
  check("renice 10 applies the stealth reduction", close(proc.detectionModifier, -DETECTION_STEALTH_REDUCTION),
    `detMod=${proc.detectionModifier}`);

  const toAggressive = mem.reniceProcess(userId, proc.pid, -10);
  check("renice -10 succeeded", toAggressive.success, JSON.stringify(toAggressive));
  check("renice -10 applies the aggressive penalty", close(proc.detectionModifier, DETECTION_AGGRESSIVE_BONUS),
    `detMod=${proc.detectionModifier}`);

  // Same object hackCommands reads on completion — not a copy.
  const live = mem.gameProcesses.get(userId)?.get(proc.pid);
  check("the live process map holds the updated value", close(live?.detectionModifier, DETECTION_AGGRESSIVE_BONUS));

  mem.gameProcesses.delete(userId);
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  // setupContainer leaves timers open; flush, then exit, or run-verify's
  // timeout kills this and scores it a failure.
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
