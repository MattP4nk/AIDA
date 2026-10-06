/**
 * VERIFY.md §5 — the Phase 2 socket work, observed rather than asserted.
 *
 * Everything here typechecks and passes the contract check. None of it had been
 * seen to actually fire. Each assertion listens for the REAL socket event.
 */
import { io as ioClient } from "/home/mattp4nk/CODE/AIDA/AIDA/client/node_modules/socket.io-client/build/esm/index.js";
import { PrismaClient } from "@prisma/client";
const BASE = "http://localhost:3001";
const prisma = new PrismaClient();
const u = `v2r${String(process.hrtime.bigint()).slice(-7)}`;
const rows: Array<[string, boolean, string]> = [];

(async () => {
  const r = await fetch(`${BASE}/api/auth/register`, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ username:u, email:`${u}@e.test`, password:"Passw0rd!v2r" })});
  const b:any = await r.json();
  const token = b.token ?? b.data?.token, uid = b.user?.id ?? b.data?.user?.id;

  // Promote BEFORE connecting: the session caches role at authentication, so a
  // later UPDATE leaves the live session on the old role and `admin` answers
  // "ACCESS DENIED" — which looks exactly like a broken broadcast.
  await prisma.user.update({ where:{id:uid}, data:{ role:"admin" }});

  const s = ioClient(BASE, { auth:{token}, transports:["websocket"] });
  await new Promise<void>((res,rej)=>{ s.on("connect",()=>res()); s.on("connect_error",(e:Error)=>rej(e)); setTimeout(()=>rej(new Error("timeout")),15000); });
  await new Promise((res,rej)=>{ s.emit("authenticated",(a:any)=>res(a)); setTimeout(()=>rej(new Error("ack")),15000); });

  // Record the events under test as they arrive.
  const seen: Record<string, any[]> = {};
  for (const ev of ["rewards:xp_granted","rewards:credits_granted","system:broadcast","server:discovered","message:result"]) {
    seen[ev] = []; s.on(ev, (d:any) => seen[ev]!.push(d));
  }
  const out:string[] = [];
  s.on("command:result",(x:any)=>out.push(Array.isArray(x?.output)?x.output.join("\n"):String(x?.output??"")));
  s.on("command:error",(x:any)=>out.push(`ERR: ${x?.error}`));
  const run = async (c:string,a:string[]=[],ms=6000) => { const n=out.length; s.emit("command:execute",{command:c,args:a,terminalCols:100});
    const d=Date.now()+ms; while(Date.now()<d){ if(out.length>n){await new Promise(r=>setTimeout(r,400));break;} await new Promise(r=>setTimeout(r,100)); }
    return out.slice(n).join("\n"); };
  const wait = (ms:number) => new Promise(r=>setTimeout(r,ms));

  // ── 5.1 reward bridge: complete a mission, expect BOTH socket events ──
  const mOut = await run("missions", [], 12000);
  const id = mOut.match(/\b([a-z0-9]{20,})\b/)?.[1];
  let completed = false;
  if (id) { await run("accept",[id],8000); }
  // Drive the reward path directly through the service the bridge listens to,
  // so this tests the BRIDGE rather than the mission content pipeline.
  const { getService } = await import("../src/di/container");
  const container = await import("../src/di/container");
  const pino = (await import("pino")).default;
  const { Server: SocketIOServer } = await import("socket.io");
  container.setupContainer(new SocketIOServer(), prisma as any, pino({level:"silent"}) as any);

  // Positive control: no reward events before we trigger one.
  const before = seen["rewards:xp_granted"]!.length + seen["rewards:credits_granted"]!.length;
  rows.push(["control: no reward events yet", before === 0, `${before} seen`]);

  // ── 5.1 reward bridge, driven through the SERVER's missionService ──
  //
  // It has to complete in-server: the bridge is registered on the instance
  // index.ts owns, so a harness completing a mission through its own DI
  // container emits on a different EventEmitter and proves nothing.
  // `explore` objectives are credited by onServerConnect and `spend_credits` by
  // a purchase, so accept everything available and then do both.
  await prisma.playerProgress.update({ where:{userId:uid}, data:{ credits: 20000 }});
  const all = await prisma.mission.findMany({ where:{ status:"available" }, select:{ id:true }, take: 8 });
  for (const m of all) await run("accept",[m.id],5000);

  // Credit the `explore` objective. NOTE: `report mission` is used deliberately
  // because it fires onServerConnect without requiring an actual link — that is
  // the explore-farming defect the Phase 1 audit filed to Phase 5. Driving
  // `connect <ip>` against arbitrary servers fails (connecting needs adjacency,
  // and a new home links only to the Internet Exchange), which is why the first
  // attempt at this step observed nothing and proved nothing.
  // Using the defect is legitimate HERE: 5.1 tests the reward BRIDGE, and this
  // reaches it through the real in-server path. When Phase 5 closes that hole,
  // this step must switch to genuine connects.
  for (let i = 0; i < 6; i++) await run("report",["mission"],5000);
  await run("buy",["basic_scanner"],6000);

  // grantRewards runs inside mission completion; poll rather than sample once.
  for (let i=0;i<20 && seen["rewards:xp_granted"]!.length + seen["rewards:credits_granted"]!.length === 0;i++) await wait(1000);
  const xp = seen["rewards:xp_granted"]!, cr = seen["rewards:credits_granted"]!;
  rows.push(["5.1 reward bridge delivers to socket",
    xp.length + cr.length > 0,
    xp.length||cr.length ? `xp=${xp.length} credits=${cr.length} ${JSON.stringify(xp[0]??cr[0]).slice(0,60)}` : "NO reward events received"]);

  // ── 5.2 admin broadcast reaches a normal player ──
  const adminOut = await run("admin",["broadcast","VERIFY-PHASE2-PROBE"],8000);
  console.log("  [diag] admin broadcast said:", adminOut.slice(0,120).replace(/\n/g," "));
  await wait(1200);
  const bc = seen["system:broadcast"]!;
  rows.push(["5.2 admin broadcast reaches client",
    bc.some(d=>String(d?.message??"").includes("VERIFY-PHASE2-PROBE")),
    bc.length ? JSON.stringify(bc[0]).slice(0,70) : "NO system:broadcast RECEIVED"]);

  // ── 5.3 discovery notification carries a real payload ──
  // `server:discovered` is emitted by serverService.discoverServers, which is
  // reached from handleSubnetSweep — the SECOND branch of `scan`, taken only when
  // a partial IP is supplied. `subnet` is the unrelated CIDR-math command. Driving
  // `scan` observed nothing and looked exactly like a broken notification.
  const scanOut = await run("scan",["10.10.10"],14000);
  console.log("  [diag] subnet said:", scanOut.slice(0,160).replace(/\n/g," "));
  // `scan` is a background process (ETA ~10s); server:discovered fires on
  // COMPLETION, not on the command returning. Poll rather than sample once.
  for (let i = 0; i < 30 && seen["server:discovered"]!.length === 0; i++) await wait(1000);
  const disc = seen["server:discovered"]!;
  rows.push(["5.3 server:discovered has count+subnet",
    disc.length > 0 && typeof disc[0]?.count === "number",
    disc.length ? `count=${disc[0]?.count} subnet=${disc[0]?.subnet}` : "none received (scan may have found nothing)"]);

  s.close();
  console.log("\n===== PHASE 2 RUNTIME (VERIFY.md §5) =====");
  for (const [n,ok,w] of rows) console.log(`${ok?"PASS":"FAIL"}  ${n.padEnd(40)} ${w}`);
  console.log(`${rows.filter(r=>r[1]).length}/${rows.length} passed`);
  await prisma.$disconnect(); process.exit(0);
})().catch(async e=>{ console.error("HARNESS ERROR:", e?.message ?? e); await prisma.$disconnect(); process.exit(1); });
