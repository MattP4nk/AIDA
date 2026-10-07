/**
 * Phase 7 A9 — `probe` and `whois`: one report each, printed by both paths.
 *
 * Both commands run either as a background process (result emitted later over
 * the socket) or, with no memoryService, instantly — and each wrote its whole
 * report out twice, once per path. `whois`'s profile panel (~115 lines each,
 * AUDIT_2026-08-30) is now `formatWhois`; `probe`'s is `buildProbeOutput`.
 *
 * The probe report (~70 lines building `probeRows`) was written out twice in
 * networkCommands.ts, verbatim: once for the background-process path, whose
 * result arrives later over the socket, and once for the instant fallback used
 * when there is no memoryService. Proven identical (whitespace-normalised)
 * before extraction into `buildProbeOutput`.
 *
 * PERMANENT CHECK: for real servers and a real player, the background path's
 * emitted output equals the fallback's returned output — the property the
 * duplication put at risk, held from now on.
 *
 * The golden master does NOT cover `probe`, so it says nothing about this
 * change. For the one-time OLD-vs-NEW differential:
 *   npx tsx scripts/verify-phase7-a9-two-paths.ts --record <file>   (old code)
 *   npx tsx scripts/verify-phase7-a9-two-paths.ts --compare <file>  (new code)
 * Not a tracked baseline on purpose: probe output reads live state (online,
 * connections, access), so a committed snapshot would rot into a flaky test.
 *
 * Read-only: probe, canAccessServer and the topology lookup write nothing, so
 * reading existing servers is safe (CLAUDE.md §2 forbids MUTATING ambient state).
 *
 * whois is fed SYNTHETIC player details through a stubbed presence service, so
 * its input is fully deterministic and covers the achievements and zero-hacks
 * branches regardless of who happens to be online.
 *
 * Run: npx tsx scripts/verify-phase7-a9-two-paths.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync } from "node:fs";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

async function main() {
  console.log("\n=== Phase 7 A9 — probe & whois: one report, two paths ===");
  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const { NetworkCommandsModule } = await import("../src/services/commandModules/networkCommands");
  const mod: any = new NetworkCommandsModule();

  // Deterministic sample: servers with a network (exercises Network/Zone) and
  // without; a player at networking >= 30 (exercises Linked Servers) and below.
  const withNet = await prisma.gameServer.findMany({ where: { networkId: { not: null } }, orderBy: { id: "asc" }, take: 3, select: { ipAddress: true } });
  const noNet = await prisma.gameServer.findMany({ where: { networkId: null }, orderBy: { id: "asc" }, take: 2, select: { ipAddress: true } });
  const skilled = await prisma.playerProgress.findFirst({ where: { networking: { gte: 30 } }, orderBy: { userId: "asc" }, select: { userId: true } });
  const novice = await prisma.playerProgress.findFirst({ where: { networking: { lt: 30 } }, orderBy: { userId: "asc" }, select: { userId: true } });
  const servers = [...withNet, ...noNet].map((s) => s.ipAddress);
  const users = [skilled?.userId, novice?.userId].filter((u): u is string => !!u);

  // Vacuity guards — a sample that exercises nothing passes everything.
  check("PRECONDITION: servers with a network were sampled", withNet.length > 0, `${withNet.length}`);
  check("PRECONDITION: a networking>=30 player exists (Linked Servers branch)", !!skilled);
  check("PRECONDITION: a networking<30 player exists", !!novice);

  const baseCtx = (userId: string) => ({
    userId,
    terminalWidth: 80,
    db: { client: prisma },
    services: {
      serverService: getService<any>(TOKENS.SERVER_SERVICE),
      networkTopologyService: getService<any>(TOKENS.NETWORK_TOPOLOGY_SERVICE),
    } as any,
  });

  const outputs: Record<string, { fallback: string; background: string }> = {};
  for (const userId of users) {
    for (const ip of servers) {
      const cmd = { command: "probe", args: [ip], terminalId: "a9" };

      // Instant fallback: no memoryService.
      const fb = await mod.handleProbe(cmd, baseCtx(userId));

      // Background path: a memoryService stub that completes at once, and an
      // io that captures what the real path emits.
      const emitted: any[] = [];
      let onComplete: (() => Promise<void>) | undefined;
      const ctx: any = baseCtx(userId);
      ctx.io = { to: () => ({ emit: (_e: string, p: any) => emitted.push(p) }) };
      ctx.services.memoryService = {
        canSpawnProcess: () => ({ allowed: true }),
        initComputerSpec: () => {},
        spawnGameProcess: (...a: any[]) => { onComplete = a[6]; return { pid: 1, duration: 1000 }; },
      };
      await mod.handleProbe(cmd, ctx);
      await onComplete?.();

      outputs[`${userId}|${ip}`] = { fallback: String(fb?.output ?? ""), background: String(emitted[0]?.output ?? "") };
    }
  }

  // ── whois ───────────────────────────────────────────────────────────
  const { PlayerInfoCommandsModule } = await import("../src/services/commandModules/playerInfoCommands");
  const info: any = new (PlayerInfoCommandsModule as any)();
  const joined = new Date(Date.UTC(2026, 0, 15, 12)); // noon UTC: no day-boundary drift
  const DETAILS: Record<string, any> = {
    veteran: {
      userId: "veteran", username: "veteran", level: 42, reputation: 1337, credits: 99000, joinedAt: joined,
      currentServerName: "corp-gw-01",
      skills: { hacking: 80, stealth: 55, networking: 61, cryptography: 47, socialEng: 12, forensics: 33 },
      totalHacks: 37, successfulHacks: 29, achievements: ["First Blood", "Ghost", "Root of All Evil"],
    },
    rookie: {
      userId: "rookie", username: "rookie", level: 1, reputation: 0, credits: 500, joinedAt: joined,
      currentServerName: null,
      skills: { hacking: 1, stealth: 1, networking: 1, cryptography: 1, socialEng: 1, forensics: 1 },
      totalHacks: 0, successfulHacks: 0, achievements: [],
    },
  };
  const presence = {
    findPlayerByUsername: (u: string) => (DETAILS[u] ? { userId: u, username: u } : null),
    getPlayerDetails: async (id: string) => DETAILS[id] ?? null,
  };
  const caller = users[0] ?? "a9-caller";
  for (const who of Object.keys(DETAILS)) {
    const cmd = { command: "whois", args: [who], terminalId: "a9" };
    const fbCtx: any = baseCtx(caller);
    fbCtx.services.playerPresenceService = presence;
    const fb = await info.handleWhois(cmd, fbCtx);

    const emitted: any[] = [];
    let onComplete: (() => Promise<void>) | undefined;
    const ctx: any = baseCtx(caller);
    ctx.services.playerPresenceService = presence;
    ctx.io = { to: () => ({ emit: (_e: string, p: any) => emitted.push(p) }) };
    ctx.services.memoryService = {
      canSpawnProcess: () => ({ allowed: true }),
      initComputerSpec: () => {},
      spawnGameProcess: (...a: any[]) => { onComplete = a[6]; return { pid: 1, duration: 1000 }; },
    };
    await info.handleWhois(cmd, ctx);
    await onComplete?.();
    outputs[`whois|${who}`] = { fallback: String(fb?.output ?? ""), background: String(emitted[0]?.output ?? "") };
  }
  const whoisKeys = Object.keys(outputs).filter((k) => k.startsWith("whois|"));
  check("whois produced both profiles", whoisKeys.length === 2 && whoisKeys.every((k) => outputs[k]!.fallback.includes("PLAYER INFO")));
  check("PRECONDITION: the ACHIEVEMENTS branch was exercised", outputs["whois|veteran"]!.fallback.includes("ACHIEVEMENTS"));
  check("PRECONDITION: the zero-hacks branch was exercised", outputs["whois|rookie"]!.fallback.includes("0%"));

  const keys = Object.keys(outputs);
  const probeKeys = keys.filter((k) => !k.startsWith("whois|"));
  check("probes ran", probeKeys.length === servers.length * users.length && probeKeys.length > 0, `${probeKeys.length} probes`);
  check("every probe produced a report", probeKeys.every((k) => outputs[k]!.fallback.includes("IP Address")));
  const linked = probeKeys.filter((k) => outputs[k]!.fallback.includes("Linked Servers"));
  check("PRECONDITION: the Linked Servers branch was exercised", linked.length > 0, `${linked.length} probes`);
  const disagree = keys.filter((k) => outputs[k]!.fallback !== outputs[k]!.background);
  check("background path output === fallback output, for every probe and whois", disagree.length === 0,
    disagree.length ? `differs: ${disagree.slice(0, 3).join(", ")}` : `${keys.length} identical`);

  const i = process.argv.indexOf("--record");
  const j = process.argv.indexOf("--compare");
  if (i > 0) {
    writeFileSync(process.argv[i + 1]!, JSON.stringify(outputs, null, 2));
    console.log(`  recorded ${keys.length} outputs -> ${process.argv[i + 1]}`);
  } else if (j > 0) {
    const old = JSON.parse(readFileSync(process.argv[j + 1]!, "utf8")) as typeof outputs;
    const changed = keys.filter((k) => old[k]?.fallback !== outputs[k]!.fallback || old[k]?.background !== outputs[k]!.background);
    check("OLD vs NEW: same probes", Object.keys(old).length === keys.length, `${Object.keys(old).length} vs ${keys.length}`);
    check("OLD vs NEW: every output byte-identical", changed.length === 0,
      changed.length ? `changed: ${changed.slice(0, 3).join(", ")}` : `${keys.length} x 2 paths identical`);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
