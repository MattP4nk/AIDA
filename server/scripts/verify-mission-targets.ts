/**
 * Mission targets are REUSED, and what generation makes is recorded for whom
 * (maintainer decision 2026-10-09).
 *
 * `selectOrCreateTargetServer` was meant to reuse an NPC server, but looked
 * for `ownerId: null` (P0-3 gave every server an NPC owner) in an encryption
 * range on the old 0-100 scale (P0-4 moved creation to 0-5). Nothing could
 * match: EVERY server-objective mission created a new server — 559 corporate
 * servers in the dev world, for real players too.
 *
 *   MT-1  a mission REUSES a permanent NPC server (was: a new one each time)
 *   MT-2  never a dungeon or offline server, even as the only faction server
 *   MT-3  provenance: a server made for a mission, and planted files, record
 *         the player; reuse by ANOTHER player clears it (shared world content)
 *   MT-4  a planted path that is taken gets a unique name — not the existing
 *         file adopted (was: two players' missions on one file)
 *   MT-5  deleting a test account removes what was made for it — and not a
 *         server another player reused, nor one a key fragment sits on
 *   MT-6  nothing is provisioned for an account that no longer exists (was:
 *         background generation outlived a deleted account and planted for it)
 *   MT-7  discardProvision removes a mission's server and files if made for it,
 *         and keeps a reused world server
 *   MT-8  a mission whose save fails discards what was provisioned for it
 *         (provisioning runs FIRST — it was stranded)
 *   MT-9  a player deleted WHILE generation runs: the offers made for them, and
 *         what was provisioned, are discarded (was: orphaned Mission rows and
 *         planted files, every time a test account was deleted mid-`missions`)
 *   (and) planting is a SYSTEM write: through createFile it failed on most
 *         world servers (permissions, missing directories), so `steal`
 *         objectives had no target file
 *
 * Fixtures: a fixture faction (so reuse is confined to fixture servers), its
 * servers, a fixture dungeon (network + `conquered` instance), a fixture
 * fragment; deleted by id in `finally`. MT-1 runs on the real world and plants
 * files attributed to the fixture player — removed by the account cleanup.
 *
 * Needs the dev server (registration). Run: npx tsx scripts/verify-mission-targets.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { freeIp } from "./lib/free-ip";
import { deleteAccountOnly, deleteFixtureUsers } from "./lib/delete-fixture-user";
import { deleteRegisteredUsers } from "./lib/fixture-users";

const prisma = new PrismaClient();
const BASE = "http://localhost:3001";
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}
async function register(username: string) {
  const r = await fetch(`${BASE}/api/auth/register`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, email: `${username}@fixture.invalid`, password: randomUUID() + "Aa1!" }),
  });
  const j: any = await r.json();
  if (!j?.user?.id) throw new Error(`register ${username}: ${r.status}`);
  return j.user.id as string;
}

async function main() {
  console.log("\n=== Mission targets: reuse and provenance ===");
  const tag = `mt${Date.now().toString(36)}`;
  const serverIds: string[] = [];
  let factionId: string | null = null;
  let networkId: string | null = null;
  let fragmentId: string | null = null;
  try {
    const a = await register(`${tag}a`);
    const b = await register(`${tag}b`);
    const { setupContainer, getService } = await import("../src/di/container");
    const TOKENS = await import("../src/di/tokens");
    const { Server: SocketIOServer } = await import("socket.io");
    const loggerMod: any = await import("../src/logger");
    setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);
    const content: any = getService<any>(TOKENS.SERVER_CONTENT_SERVICE);
    // No AI: deterministic, free, and not at the mercy of the provider's rate
    // limit — the static fallbacks are what runs.
    content.generateMissionFilesWithAI = async () => [];
    content.generatePlanFromAI = async () => null;
    content.provisionAIContent = async () => undefined;
    const mission = (extra: Record<string, unknown> = {}) => ({
      title: `${tag} job`, description: "fixture", type: "recon", difficulty: 5,
      objectives: [{ id: "o1", type: "hack_target", target: true }, { id: "o2", type: "steal", target: true }],
      ...extra,
    });

    console.log("\nMT-1 — a mission reuses a permanent NPC server");
    // Planting is a SYSTEM write now: it used to go through createFile (a
    // player write) and fail on most world servers, so `steal` missions came
    // with no target file.
    const before = await prisma.gameServer.count();
    const r1 = await content.provisionMissionInfrastructure(mission(), a);
    const target = r1?.targetServerId ? await prisma.gameServer.findUnique({ where: { id: r1.targetServerId }, include: { owner: { select: { role: true } } } }) : null;
    check("PRECONDITION: the mission was provisioned", !!target, JSON.stringify(r1)?.slice(0, 120));
    check("no new server was created (was: one per mission)", (await prisma.gameServer.count()) === before, `${before} -> ${await prisma.gameServer.count()}`);
    check("the target is an existing NPC-owned world server", target?.owner?.role === "npc" && !target.isPlayerHome);
    const planted = await prisma.fileSystemNode.findMany({ where: { generatedForUserId: a }, select: { id: true } });
    check("the planted files record who they were made for", planted.length > 0, `${planted.length} file(s)`);
    const stealPatch = (r1?.objectives ?? []).find((o: any) => o.index === 1)?.metadata;
    check("the `steal` objective points at a planted file (was: none planted on most world servers)",
      !!stealPatch?.fileId && planted.some((p) => p.id === stealPatch.fileId), JSON.stringify(stealPatch)?.slice(0, 120));

    console.log("\nMT-2 — never a dungeon or offline server");
    const faction = await prisma.faction.create({ data: { name: `${tag}-faction`, description: "fixture" } });
    factionId = faction.id;
    const net = await prisma.network.create({ data: { name: `${tag}_dungeon`, zone: "darknet", isHidden: true } });
    networkId = net.id;
    await prisma.darkNetInstance.create({ data: { name: `${tag}_dungeon`, networkId: net.id, gatewayIp: "0.0.0.0", passkey: "x", rewardType: "credits_cache", status: "conquered" } });
    const npc = await prisma.user.findFirstOrThrow({ where: { role: "npc" }, select: { id: true } });
    const mk = async (name: string, extra: Record<string, unknown>) => {
      const s = await prisma.gameServer.create({ data: { name: `${tag}_${name}`, ipAddress: await freeIp(prisma), type: "corporate", encryptionLevel: 2, ownerId: npc.id, factionId: faction.id, ...extra } });
      serverIds.push(s.id);
      return s;
    };
    const dungeon = await mk("dungeon", { networkId: net.id });
    const offline = await mk("offline", { isOnline: false });
    const chosen = await content.selectOrCreateTargetServer(mission({ factionId: faction.id }), a);
    if (chosen && !serverIds.includes(chosen.id)) serverIds.push(chosen.id);
    check("with only a dungeon and an offline server in the faction, neither is chosen — a new one is made",
      !!chosen && chosen.id !== dungeon.id && chosen.id !== offline.id, chosen?.name);

    console.log("\nMT-3 — provenance");
    const made = await prisma.gameServer.findUniqueOrThrow({ where: { id: chosen.id } });
    check("a server made for a mission records the player", made.generatedForUserId === a);
    const reused = await content.selectOrCreateTargetServer(mission({ factionId: faction.id }), b);
    check("PRECONDITION: another player's mission reuses it", reused?.id === made.id, reused?.name);
    check("and it is shared world content now — attribution cleared",
      (await prisma.gameServer.findUniqueOrThrow({ where: { id: made.id } })).generatedForUserId === null);

    console.log("\nMT-4 — a taken path gets a unique name");
    await content.provisionServerContent(made.id); // as provisionMissionInfrastructure does first
    const pa = await content.plantMissionFiles(made.id, npc.id, mission(), a);
    const pb = await content.plantMissionFiles(made.id, npc.id, mission(), b);
    const aPaths = new Set(pa.map((f: any) => f.path));
    const bIds = new Set(pb.map((f: any) => f.nodeId));
    check("PRECONDITION: both plantings produced files", pa.length > 0 && pb.length > 0, `${pa.length} / ${pb.length}`);
    check("the second never adopts the first's files (was: same node, two missions)", pa.every((f: any) => !bIds.has(f.nodeId)));
    check("its colliding paths got new names", pb.some((f: any) => !aPaths.has(f.path)), pb.map((f: any) => f.path).join(", "));
    const owners = await prisma.fileSystemNode.findMany({ where: { id: { in: pb.map((f: any) => f.nodeId) } }, select: { generatedForUserId: true } });
    check("each player's planted files are attributed to that player", owners.every((o) => o.generatedForUserId === b));
    const dotFile = await prisma.fileSystemNode.findFirst({ where: { id: { in: pa.map((f: any) => f.nodeId) }, name: { startsWith: "." } }, select: { isHidden: true } });
    check("a planted dot-file is hidden, as createFile made it", !!dotFile && dotFile.isHidden === true);

    console.log("\nMT-6 — nothing for an account that does not exist");
    const filesBefore = await prisma.fileSystemNode.count();
    const ghost = await content.provisionMissionInfrastructure(mission(), "no-such-user-" + tag);
    check("provisioning for a deleted account does nothing (was: planted for it)",
      ghost === null && (await prisma.fileSystemNode.count()) === filesBefore, JSON.stringify(ghost));

    console.log("\nMT-7 — discardProvision");
    const lone = await prisma.faction.create({ data: { name: `${tag}-lone`, description: "fixture" } });
    const loneId = lone.id;
    try {
      const fresh = await content.provisionMissionInfrastructure(mission({ factionId: loneId }), a);
      check("PRECONDITION: a faction with no servers gets a NEW target, made for the player",
        !!fresh && (await prisma.gameServer.findUniqueOrThrow({ where: { id: fresh.targetServerId } })).generatedForUserId === a);
      if (fresh) serverIds.push(fresh.targetServerId);
      await content.discardProvision(fresh, a);
      check("discarding it removes the server and its planted files",
        (await prisma.gameServer.findUnique({ where: { id: fresh.targetServerId } })) === null &&
        (await prisma.fileSystemNode.count({ where: { id: { in: fresh.plantedFileIds } } })) === 0);
      const worldTarget = r1.targetServerId;
      await content.discardProvision(r1, a);
      check("discarding a REUSED world server's provisioning keeps the server, removes the files",
        (await prisma.gameServer.findUnique({ where: { id: worldTarget } })) !== null &&
        (await prisma.fileSystemNode.count({ where: { id: { in: r1.plantedFileIds } } })) === 0);

      console.log("\nMT-8 — a failed mission save discards its provisioning");
      const generator: any = getService<any>(TOKENS.MISSION_GENERATOR_SERVICE);
      const realCreate = generator.missionService.createMission;
      generator.missionService.createMission = async () => { throw new Error("injected save failure"); };
      const madeBefore = await prisma.gameServer.count({ where: { generatedForUserId: a } });
      let id: unknown = "unset";
      try {
        id = await generator.createMission({ ...mission({ factionId: loneId }), reward: { credits: 1 } }, a);
      } finally { generator.missionService.createMission = realCreate; }
      check("PRECONDITION: the save failed", id === null, String(id));
      check("nothing made for it remains (was: a server and files stranded)",
        (await prisma.gameServer.count({ where: { generatedForUserId: a } })) === madeBefore &&
        (await prisma.fileSystemNode.count({ where: { generatedForUserId: a, server: { factionId: loneId } } })) === 0);
    } finally {
      const strays = await prisma.gameServer.findMany({ where: { factionId: loneId }, select: { id: true } });
      await prisma.fileSystemNode.deleteMany({ where: { serverId: { in: strays.map((x) => x.id) } } });
      await prisma.gameServer.deleteMany({ where: { id: { in: strays.map((x) => x.id) } } });
      await prisma.faction.deleteMany({ where: { id: loneId } });
    }

    console.log("\nMT-9 — a player deleted while their offers are generated");
    const c = await register(`${tag}c`);
    const gen: any = getService<any>(TOKENS.MISSION_GENERATOR_SERVICE);
    const store = gen.playerMissions;
    const realMutateAll = store.mutateAll.bind(store);
    let createdMissionIds: string[] = [];
    const cTutorials = (await prisma.mission.findMany({ where: { assignedTo: c }, select: { id: true } })).map((m) => m.id);
    store.mutateAll = async (userId: string, fn: any) => {
      // The account goes away between generating the offers and registering
      // them — deleted PLAINLY, not through the test cleanup (which removes
      // offers by creator itself and would hide the path under test): any
      // future account deletion is this.
      createdMissionIds = (await prisma.mission.findMany({ where: { createdBy: c }, select: { id: true } })).map((m) => m.id);
      await deleteAccountOnly(prisma, c);
      return realMutateAll(userId, fn);
    };
    let got: unknown;
    try { got = await gen.generateMissionsForPlayer(c, 5); } finally { store.mutateAll = realMutateAll; }
    check("PRECONDITION: offers had been created for them", createdMissionIds.length > 0, `${createdMissionIds.length}`);
    check("the offers are discarded (was: orphaned Mission rows)",
      (await prisma.mission.count({ where: { id: { in: createdMissionIds } } })) === 0 && Array.isArray(got) && got.length === 0, JSON.stringify(got));
    check("and nothing generated for them remains",
      (await prisma.fileSystemNode.count({ where: { generatedForUserId: c } })) === 0 &&
      (await prisma.gameServer.count({ where: { generatedForUserId: c } })) === 0);
    // The plain delete left the tutorial mission it was given at registration.
    await prisma.mission.deleteMany({ where: { id: { in: cTutorials } } });

    console.log("\nMT-5 — deleting a test account removes what was made for it");
    const own = await content.createMissionTargetServer(mission(), "corporate", a);
    serverIds.push(own.id);
    const kept = await content.createMissionTargetServer(mission(), "corporate", a);
    serverIds.push(kept.id);
    const frag = await prisma.keyFragment.create({ data: { keyType: `harness-${tag}`, fragmentNum: 1, name: "fixture", description: "fixture", hint: "fixture", sourceType: "server", sourceId: kept.id, status: "active" } });
    fragmentId = frag.id;
    const aFiles = pa.map((f: any) => f.nodeId);
    const r1Files = await prisma.fileSystemNode.findMany({ where: { generatedForUserId: a }, select: { id: true } });
    await deleteFixtureUsers(prisma, [a]);
    check("the server made only for them is gone", (await prisma.gameServer.findUnique({ where: { id: own.id } })) === null);
    check("their planted files are gone (MT-1's on the real world too)",
      (await prisma.fileSystemNode.count({ where: { id: { in: [...aFiles, ...r1Files.map((p) => p.id)] } } })) === 0 &&
      r1Files.length > 0);
    check("POSITIVE: the server another player reused stays", (await prisma.gameServer.findUnique({ where: { id: made.id } })) !== null);
    const keptRow = await prisma.gameServer.findUnique({ where: { id: kept.id } });
    check("POSITIVE: a server a key fragment sits on stays, unattributed", !!keptRow && keptRow.generatedForUserId === null);
    check("POSITIVE: the other player's files stay", (await prisma.fileSystemNode.count({ where: { id: { in: [...bIds] as string[] } } })) === pb.length);
  } finally {
    try {
      if (fragmentId) await prisma.keyFragment.deleteMany({ where: { id: fragmentId } });
      await prisma.fileSystemNode.deleteMany({ where: { serverId: { in: serverIds } } });
      await prisma.gameServer.deleteMany({ where: { id: { in: serverIds } } });
      if (networkId) await prisma.network.deleteMany({ where: { id: networkId } }); // the instance cascades
      if (factionId) await prisma.faction.deleteMany({ where: { id: factionId } });
    } catch (err) { fail++; console.log(`  [FAIL] cleanup — ${(err as Error).message}`); }
    await deleteRegisteredUsers(prisma).catch((e: unknown) => { fail++; console.log(`  [FAIL] cleanup — fixture users: ${(e as Error).message}`); });
  }
  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch(async (e) => {
  console.error(e);
  await deleteRegisteredUsers(prisma).catch((err: unknown) => console.error("cleanup — fixture users:", err));
  process.exit(1);
});
