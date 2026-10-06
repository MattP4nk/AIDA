/**
 * U1 acceptance harness — tutorial alt-path (earn access via a found key
 * instead of hacking).
 *
 * Drives the REAL socket path end to end:
 *   register -> authenticate -> hop home->Internet Exchange->Training Gateway
 *   (solving each first-visit connection challenge) -> ls -a -> cat -> download
 *   -> connect Training Firewall on the discovered key.
 *
 * Asserts BOTH halves of the acceptance criterion:
 *   (a) the key path actually grants access, and
 *   (b) the tutorial's "hack" objective is credited, so the step can complete
 *       without hacking.
 */
// socket.io-client lives in the client workspace, not the server's.
import "reflect-metadata";
import { io as ioClient } from "../../client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";

let _missionRepo: any = null;
function missionRepo() {
  if (!_missionRepo) {
    const { PlayerMissionRepository } = require("../src/repositories/playerMissionRepository");
    const pino = require("pino");
    _missionRepo = new PlayerMissionRepository(pino({ level: "silent" }), prisma);
  }
  return _missionRepo;
}

const BASE = "http://localhost:3001";
const prisma = new PrismaClient();

const stamp = process.env.U1_STAMP || String(process.hrtime.bigint()).slice(-8);
const USERNAME = `u1probe${stamp}`;
const PASSWORD = "Passw0rd!u1probe";

function log(section: string, msg: string) {
  console.log(`\n[${section}] ${msg}`);
}

/** Command output crosses the socket as string | string[]; normalise both. */
function asText(output: unknown): string {
  if (Array.isArray(output)) return output.join("\n");
  return String(output ?? "");
}

async function register(): Promise<{ token: string; userId: string }> {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: USERNAME, email: `${USERNAME}@example.test`, password: PASSWORD }),
  });
  const body: any = await res.json();
  if (!res.ok) throw new Error(`register failed ${res.status}: ${JSON.stringify(body)}`);
  const token = body.token ?? body.data?.token ?? body.accessToken;
  const userId = body.user?.id ?? body.data?.user?.id;
  if (!token || !userId) throw new Error(`no token/userId: ${JSON.stringify(body)}`);
  return { token, userId };
}

/**
 * Solve a TCP handshake table: rows whose flags are exactly "SYN" and whose
 * window is > 0 are real; reply ACK = SEQ + 1 in ascending port order.
 * Mirrors generateHandshakeChallenge()'s solution construction.
 */
function solveHandshake(text: string): string[] | null {
  const rows: Array<{ seq: number; port: number }> = [];
  for (const line of text.split("\n")) {
    // "  <seq>   <port>  <service>  <flags>  <window>"
    const m = /^\s{2,}(\d{3,6})\s+(\d{1,5})\s+(\S+)\s+(\S+)\s+(\d+)\s*$/.exec(line);
    if (!m) continue;
    const [, seq, port, , flags, win] = m;
    if (flags === "SYN" && Number(win) > 0) rows.push({ seq: Number(seq), port: Number(port) });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => a.port - b.port);
  return rows.map((r) => String(r.seq + 1));
}

async function main() {
  log("SETUP", `registering ${USERNAME}`);
  const { token, userId } = await register();
  log("SETUP", `userId=${userId}`);

  const socket = ioClient(BASE, { auth: { token }, transports: ["websocket"] });
  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (e: Error) => reject(new Error(`connect_error: ${e.message}`)));
    setTimeout(() => reject(new Error("socket connect timeout")), 15000);
  });

  const authAck: any = await new Promise((resolve, reject) => {
    socket.emit("authenticated", (ack: any) => resolve(ack));
    setTimeout(() => reject(new Error("authenticated ack timeout")), 15000);
  });
  if (!authAck?.success) throw new Error(`auth failed: ${JSON.stringify(authAck)}`);
  log("SETUP", "game session established");

  const inbox: string[] = [];
  socket.on("command:result", (r: any) => inbox.push(asText(r?.output)));
  socket.on("command:error", (r: any) => inbox.push(`ERROR: ${r?.error}`));

  async function run(command: string, args: string[] = [], waitMs = 3000, quiet = false): Promise<string> {
    const before = inbox.length;
    socket.emit("command:execute", { command, args, terminalCols: 100 });
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (inbox.length > before) {
        await new Promise((r) => setTimeout(r, 400));
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const out = inbox.slice(before).join("\n---\n");
    if (!quiet) console.log(`\n$ ${command} ${args.join(" ")}\n${out || "(no output)"}`);
    return out;
  }

  /** connect, transparently solving a first-visit connection challenge. */
  async function connectTo(ip: string, label: string): Promise<{ ok: boolean; out: string }> {
    // `connect` awaits contentQueue.ensureReady() server-side, so this window
    // has to tolerate a content-generation backlog, not just network latency.
    let out = await run("connect", [ip], 45000, true);
    if (/HANDSHAKE|SYN packets/i.test(out)) {
      const ack = solveHandshake(out);
      if (!ack) {
        console.log(`\n[${label}] handshake present but unsolvable from output:\n${out}`);
        return { ok: false, out };
      }
      const ackOut = await run("handshake.ack", ack, 45000, true);
      out += "\n" + ackOut;
    } else if (/SIGNAL TRACE|signal\.trace/i.test(out)) {
      console.log(`\n[${label}] signal_trace challenge — not auto-solved`);
      return { ok: false, out };
    }
    // Verify against the SESSION, not the output text.
    //
    // Trusting the transcript made this harness report `connect -> OK` while the
    // player was still on the previous server: a second connection challenge had
    // failed, and the output still matched the success regex. Every later step
    // then ran against the wrong filesystem and failed for reasons that had
    // nothing to do with the code under test. Assert where the player actually is.
    // Source of truth is the ACTIVE ServerConnection row written by
    // serverService.connectToServer. (`UserSession.lastServerId` looks right but
    // is dead schema — nothing in src/ ever writes it, so asserting on it
    // reported "not landed" for every successful connect.)
    const target = await prisma.gameServer.findFirst({
      where: { ipAddress: ip },
      select: { id: true },
    });
    // POLL, don't sample once. `handshake.ack` -> completeConnection ->
    // serverService.connectToServer writes the ServerConnection row *after* the
    // ack result is emitted, so a single immediate read races that write and
    // reports "not landed" for a connect that did in fact succeed.
    let landed = false;
    if (target) {
      const deadline = Date.now() + 10000;
      while (Date.now() < deadline) {
        const conn = await prisma.serverConnection.findFirst({
          where: { userId, serverId: target.id, isActive: true },
          select: { id: true },
        });
        if (conn) { landed = true; break; }
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    const blocked = /CONNECTION BLOCKED|Access denied|requires hacking|requires an access key|FAILED|incorrect/i.test(out);
    console.log(`\n[${label}] connect ${ip} -> ${landed ? "OK (session confirmed)" : blocked ? "BLOCKED" : "NOT LANDED (output looked ok)"}`);
    if (!landed) console.log(out.slice(0, 400));
    return { ok: landed, out };
  }

  // ── Stage a tutorial-shaped "hack" objective, exactly as
  // createTutorialMission() would (Mission row + missionProgress entry). This
  // is the objective the alt-path is supposed to be able to complete.
  // Two objectives, to pin down BOTH halves of the intended semantics:
  //   gain_access -> must be credited by the key path (the tutorial's step 5)
  //   hack        -> must NOT be credited by the key path (you didn't hack)
  const objectives = [
    { id: "u1_breach", type: "breach_server", description: "Get access to a secured server", target: true, current: false, completed: false, metadata: {} },
    { id: "u1_hack", type: "hack", description: "Hack a server", target: 1, current: 0, completed: false, metadata: {} },
  ];
  const mission = await prisma.mission.create({
    data: {
      title: "Breach Protocol (U1 probe)",
      description: "Learn to breach secured systems.",
      type: "tutorial",
      difficulty: 1,
      reward: { xp: 100, credits: 200 } as any,
      objectives: objectives as any,
      createdBy: userId,
      assignedTo: userId,
      status: "active",
    },
  });
  // D3 pass 2: stage through the REPOSITORY, not by writing the blob.
  // This harness used to write `playerProgress.missionProgress` directly and
  // read the result back from it — reaching behind the app's own API. When
  // storage moved to PlayerMission/PlayerMissionObjective that staged mission
  // became invisible to the game and this test failed for a reason that had
  // nothing to do with the behaviour it asserts.
  await missionRepo().put(userId, mission.id, {
    missionId: mission.id,
    userId,
    status: "active",
    startedAt: new Date().toISOString(),
    objectives: JSON.parse(JSON.stringify(objectives)),
  } as any);
  log("SETUP", `staged breach_server + hack objectives (mission ${mission.id.slice(0, 8)})`);

  // ── Why the step-1 hint had to change: `connect` needs a DIRECT link, and a
  // new player's home terminal links only to the Internet Exchange. Assert the
  // constraint still holds, so the corrected hint stays correct.
  log("STEP 0", "direct connect 10.10.10.1 from home (must be blocked)");
  const directOut = await run("connect", ["10.10.10.1"], 5000);
  const directBlocked = /CONNECTION BLOCKED|No direct/i.test(directOut);

  log("STEP 1", "real path: home -> Internet Exchange -> Training Gateway");
  const ix = await connectTo("10.0.0.1", "Internet Exchange");
  const gw = await connectTo("10.10.10.1", "Training Gateway");
  const reachedGateway = gw.ok;

  log("STEP 2", "ls -a /etc must reveal the hidden key file");
  const lsOut = await run("ls", ["-a", "/etc"]);
  const lsShowsKey = lsOut.includes(".fw_maintenance.key");
  const lsPlain = await run("ls", ["/etc"]);
  // Positive control: bare `ls` must still list the non-hidden sibling,
  // else "key absent" would pass vacuously on empty output.
  const lsHidesKey = lsPlain.includes("firewall.conf") && !lsPlain.includes(".fw_maintenance.key");

  log("STEP 3", "cat the key file — expect the CREDENTIALS DETECTED hint");
  const catOut = await run("cat", ["/etc/.fw_maintenance.key"], 4000);
  const catHint = catOut.includes("CREDENTIALS DETECTED");
  const catNamesTarget = catOut.includes("Training Firewall");

  log("STEP 4", "download it — expect the access key to be granted");
  // `download` spawns a background process and pushes its real result later via
  // io.to(`player:<id>`). Waiting only for the first ack would read the "ETA 7s"
  // stub and miss the grant entirely, so keep collecting until the banner
  // arrives or the process ETA has comfortably elapsed.
  const dlStart = inbox.length;
  socket.emit("command:execute", { command: "download", args: ["/etc/.fw_maintenance.key"], terminalCols: 100 });
  const dlDeadline = Date.now() + 25000;
  while (Date.now() < dlDeadline) {
    const sofar = inbox.slice(dlStart).join("\n");
    if (sofar.includes("ACCESS KEY DISCOVERED") || /Download failed|File saved/i.test(sofar)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const dlOut = inbox.slice(dlStart).join("\n---\n");
  console.log(`\n$ download /etc/.fw_maintenance.key\n${dlOut || "(no output)"}`);
  const dlBanner = dlOut.includes("ACCESS KEY DISCOVERED");

  const fwServer = await prisma.gameServer.findFirst({ where: { name: "Training Firewall" }, select: { id: true } });
  const keyRow = fwServer
    ? await prisma.serverAccessKey.findUnique({ where: { userId_serverId: { userId, serverId: fwServer.id } } })
    : null;

  log("STEP 5", "connect to Training Firewall using the key, no hacking");
  const fwConn = await connectTo("10.10.10.30", "Training Firewall");

  // ── The acceptance criterion ──
  const staged = await missionRepo().get(userId, mission.id);
  const gainObj = staged?.objectives?.find((o: any) => o.id === "u1_breach");
  const hackObj = staged?.objectives?.find((o: any) => o.id === "u1_hack");
  const objectiveCredited = !!gainObj && (gainObj.current === true || gainObj.completed === true);
  // The key path must NOT satisfy "hack a server" — otherwise every
  // "hack N servers" mission becomes a credential hunt.
  const hackNotCredited = !!hackObj && Number(hackObj.current) === 0 && hackObj.completed !== true;

  console.log("\n\n================== U1 RESULTS ==================");
  const rows: Array<[string, boolean, string]> = [
    ["direct home->Gateway blocked", directBlocked, "adjacency rule the new hint teaches"],
    ["reached Training Gateway", reachedGateway, "via Internet Exchange hop"],
    ["ls -a reveals hidden key", lsShowsKey, "the alt-path is discoverable"],
    ["bare ls hides it", lsHidesKey, "hidden semantics correct"],
    ["cat shows credentials hint", catHint, "player learns the file matters"],
    ["hint names Training Firewall", catNamesTarget, "player learns what it opens"],
    ["download announces key grant", dlBanner, "ACCESS KEY DISCOVERED banner"],
    ["access key persisted", !!keyRow, "ServerAccessKey row exists"],
    ["Firewall admits us w/o hacking", fwConn.ok, "hack_or_key honoured the key"],
    ["breach_server credited by key", objectiveCredited, "step 5 completes via key path"],
    ["hack objective NOT credited", hackNotCredited, "keys must not count as hacking"],
  ];
  for (const [name, ok, why] of rows) console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} ${why}`);
  console.log("\ngain_access final:", JSON.stringify(gainObj));
  console.log("hack final:       ", JSON.stringify(hackObj));
  console.log("================================================");

  // ══════════════════════════════════════════════════════════════════
  // Phase 2: the OTHER authored route. Changing step 5's objective type
  // must not break brute force, so drive a real `hack` and confirm the same
  // objective is credited.
  // ══════════════════════════════════════════════════════════════════
  log("PHASE 2", "hack route — must credit the same objective");
  const hackObjectives = [
    { id: "u1_breach", type: "breach_server", description: "Get access to a secured server", target: true, current: false, completed: false, metadata: {} },
  ];
  const mission2 = await prisma.mission.create({
    data: {
      title: "Breach Protocol (U1 hack route)",
      description: "Brute-force route.",
      type: "tutorial",
      difficulty: 1,
      reward: { xp: 100, credits: 200 } as any,
      objectives: hackObjectives as any,
      createdBy: userId,
      assignedTo: userId,
      status: "active",
    },
  });
  await missionRepo().put(userId, mission2.id, {
    missionId: mission2.id,
    userId,
    status: "active",
    startedAt: new Date().toISOString(),
    objectives: JSON.parse(JSON.stringify(hackObjectives)),
  } as any);

  const hackOut = await run("hack", ["10.10.10.30"], 15000);
  console.log("\n(hack output above — minigame may need interaction)");

  const staged2 = await missionRepo().get(userId, mission2.id);
  const breachViaHack = staged2?.objectives?.find((o: any) => o.id === "u1_breach");
  console.log("breach_server after hack attempt:", JSON.stringify(breachViaHack));
  console.log("hack route reached a minigame:", /LAYER|minigame|solve|crack|sequence/i.test(hackOut));

  await prisma.mission.delete({ where: { id: mission.id } }).catch(() => {});
  await prisma.mission.delete({ where: { id: mission2.id } }).catch(() => {});
  socket.close();
}

main()
  .catch((e) => {
    console.error("\nHARNESS ERROR:", e?.stack ?? e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    setTimeout(() => process.exit(process.exitCode ?? 0), 300);
  });
