/**
 * ONE rule reveals the fragment commands (maintainer decision 2026-10-08):
 * AIDA intel or a fragment discovery — the rule the commands enforce.
 *
 * The help listing used `discoveryLevel >= 3` instead, and hid only three of
 * the module's six commands by name, so `fragment.crack`, `collar.shield` and
 * `key.contact` were listed to players who could not run them.
 *
 * In-process: the help module's listing and the fragment module's gate, for a
 * fixture player before and after an AIDA intel report (deleted by id).
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-fragment-reveal.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { deleteRegisteredUsers } from "./lib/fixture-users";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

async function main() {
  console.log("\n=== Fragment commands: one reveal rule ===");
  const tag = `fr${Date.now().toString(36)}`;
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: tag, email: `${tag}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const userId: string = ((await r.json()) as any).user.id;

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
  const { HelpCommandsModule } = await import("../src/services/commandModules/helpCommands");
  const { FragmentCommandsModule } = await import("../src/services/commandModules/fragmentCommands");
  const frag: any = new FragmentCommandsModule();
  const help: any = new HelpCommandsModule();
  const ctx: any = { userId, terminalWidth: 80, modules: [frag], playerProgress: getService<any>(TOKENS.PLAYER_PROGRESS_REPOSITORY) };
  const ALL = [...frag.commands] as string[];
  const listed = async () => (await help.getAvailableCommands(ctx)).map((c: any) => c.command as string);
  const runs = async () => !/Command not found/.test(String((await frag.execute({ command: "fragments", args: [] }, ctx)).output ?? ""));

  let reportId: string | null = null;
  try {
    check("PRECONDITION: the fragment module has six commands", ALL.length === 6, ALL.join(", "));
    const before = await listed();
    check("no intel: none of the six is listed (was: three listed)", ALL.every((c) => !before.includes(c)),
      ALL.filter((c) => before.includes(c)).join(", ") || "none listed");
    check("no intel: and they do not run", (await runs()) === false);

    const rep = await prisma.intelligenceReport.create({
      data: { userId, category: "aida", title: "fixture", content: "fixture", source: "harness", importance: 1 },
    });
    reportId = rep.id;
    const after = await listed();
    check("with AIDA intel: all six are listed (was: hidden until discovery level 3)", ALL.every((c) => after.includes(c)),
      ALL.filter((c) => !after.includes(c)).join(", ") || "all listed");
    check("with AIDA intel: and they run — the listing and the gate agree", (await runs()) === true);
  } finally {
    try { if (reportId) await prisma.intelligenceReport.delete({ where: { id: reportId } }); }
    catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => { console.error(e); process.exit(1); });
