/**
 * The three dynamic-content hooks wired on 2026-10-07 render real content.
 *
 * verify-bus-contract.ts proves each hook is FED. That is not the same as the
 * feed matching the hook: before wiring, `honeypot:triggered`'s only emitter
 * sent { userId, forumId, factionId } to a hook reading serverId/fileName/
 * attackerId — none of them — and `backdoor:discovered` lacked the `type` and
 * `detectionRisk` its hook prints. So this pairs, per hook:
 *
 *   - STRUCTURAL: the emitter sends the fields the hook reads, and
 *   - BEHAVIOURAL: the real generator, given that shape, renders them.
 *
 * Generators only RETURN injections — nothing is written — so this reads the
 * dev DB (dungeon targets) without mutating it.
 *
 * Run: npx tsx scripts/verify-phase7-bus-hooks.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url).pathname, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

async function main() {
  console.log("\n=== Dynamic-content hooks render what their emitters send ===");
  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const dc = getService<any>(TOKENS.DYNAMIC_CONTENT_SERVICE);
  const run = async (event: string, data: unknown) => {
    const hooks = dc.getHooksForEvent(event);
    const out: any[] = [];
    for (const h of hooks) out.push(...((await h.generator(data)) ?? []));
    return { hooks: hooks.length, out };
  };

  console.log("\nH-1 — backdoor:discovered -> the victim's security log");
  {
    const bd = src("../src/services/backdoorService.ts");
    const emits = [...bd.matchAll(/this\.emit\("backdoor:discovered",\s*\{([\s\S]*?)\}\);/g)].map((m) => m[1]!);
    check("both emits found", emits.length === 2, `${emits.length}`);
    check("both emits send type AND detectionRisk",
      emits.length === 2 && emits.every((e) => /\btype:/.test(e) && /\bdetectionRisk:/.test(e)));
    const r = await run("backdoor:discovered",
      { backdoorId: "b", serverId: "srv-x", installerId: "u-1", discoveredBy: "scan", type: "rootkit", detectionRisk: 42 });
    const c = String(r.out[0]?.content ?? "");
    check("the hook writes /var/log/security.log on the discovered server",
      r.out[0]?.serverId === "srv-x" && r.out[0]?.path === "/var/log/security.log");
    check("it prints the real type and risk, not its fallbacks",
      c.includes("Type: rootkit") && c.includes("Detection risk was: 42%") && !c.includes("standard") && !c.includes("unknown%"),
      c.split("\n").slice(1, 4).join(" | "));
  }

  console.log("\nH-2 — honeypot:triggered -> the owner's hidden trap log (FILE honeypots)");
  {
    const fs = src("../src/services/fileService.ts");
    check("alertHoneypot forwards serverId, fileName and attackerId",
      /processEvent\("honeypot:triggered",\s*\{\s*serverId,\s*fileName,\s*attackerId/.test(fs));
    const forum = src("../src/services/forumAccessService.ts");
    check("the FORUM honeypot no longer emits the same name with an unusable payload",
      !/emit\("honeypot:triggered"/.test(forum));
    const r = await run("honeypot:triggered", { serverId: "srv-h", fileName: "bait.txt", attackerId: "u-9", action: "read" });
    const c = String(r.out[0]?.content ?? "");
    check("the hook renders the decoy and who touched it",
      r.out[0]?.serverId === "srv-h" && r.out[0]?.isHidden === true && c.includes("bait.txt") && c.includes("u-9"), c.trim());
  }

  console.log("\nH-3 — dungeon:conquered -> DarkNet servers only");
  {
    const dg = src("../src/services/darknetDungeonService.ts");
    check("conquerVault forwards the reward type", /processEvent\("dungeon:conquered",\s*\{[^}]*rewardType/.test(dg));
    const r = await run("dungeon:conquered", { rewardType: "fragment" });
    check("PRECONDITION: the hook picked targets", r.out.length > 0, `${r.out.length}`);
    const ids = r.out.map((o) => o.serverId as string);
    const servers = await prisma.gameServer.findMany({ where: { id: { in: ids } }, select: { id: true, faction: { select: { shortName: true } } } });
    const wrong = servers.filter((s) => s.faction?.shortName !== "darknet");
    check("every target is a DarkNet server (was ANY faction's)", servers.length === ids.length && wrong.length === 0,
      wrong.length ? `${wrong.length} non-darknet` : `${ids.length} darknet`);
    check("the notice carries the reward", String(r.out[0]?.content ?? "").includes("Reward dispersed: fragment"));
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
