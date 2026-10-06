import { io as ioClient } from "/home/mattp4nk/CODE/AIDA/AIDA/client/node_modules/socket.io-client/build/esm/index.js";
const BASE = "http://localhost:3001";
const u = `p0${String(process.hrtime.bigint()).slice(-7)}`;
(async () => {
  const r = await fetch(`${BASE}/api/auth/register`, { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ username:u, email:`${u}@e.test`, password:"Passw0rd!p0" })});
  const b:any = await r.json(); const token = b.token ?? b.data?.token;
  const uid = b.user?.id ?? b.data?.user?.id;
  // Raise hacking past `exploit`'s baseline (40) so the SKILL gate is satisfied
  // and execution actually reaches the ownership check we are testing. Without
  // this the skill gate refuses first and the test proves nothing about P0-2.
  const { PrismaClient } = await import("@prisma/client");
  const pc = new PrismaClient();
  await pc.playerProgress.update({ where: { userId: uid }, data: { hacking: 45 } });
  await pc.$disconnect();
  const s = ioClient(BASE, { auth:{token}, transports:["websocket"] });
  await new Promise<void>((res,rej)=>{ s.on("connect",()=>res()); s.on("connect_error",(e:Error)=>rej(e)); setTimeout(()=>rej(new Error("timeout")),15000); });
  await new Promise((res,rej)=>{ s.emit("authenticated",(a:any)=>res(a)); setTimeout(()=>rej(new Error("ack")),15000); });
  const inbox:string[] = [];
  s.on("command:result",(x:any)=>inbox.push(Array.isArray(x?.output)?x.output.join("\n"):String(x?.output??"")));
  s.on("command:error",(x:any)=>inbox.push(`ERR: ${x?.error}`));
  const run = async (c:string,a:string[]=[]) => { const n=inbox.length; s.emit("command:execute",{command:c,args:a,terminalCols:100});
    const d=Date.now()+5000; while(Date.now()<d){ if(inbox.length>n){await new Promise(r=>setTimeout(r,300));break;} await new Promise(r=>setTimeout(r,100)); }
    return inbox.slice(n).join("\n"); };
  const rows: Array<[string,boolean,string]> = [];
  const one = (t:string) => (t.split("\n")[0]||"").slice(0,72);

  const fc = await run("fragment.crack",["x.dat"]);
  rows.push(["P0-1 fragment.crack now gated", /hacking|skill|requires/i.test(fc), one(fc)]);
  const sw = await run("sweep");
  rows.push(["P0-1 sweep now gated (forensics 15)", /forensics|skill|requires/i.test(sw), one(sw)]);
  const ex = await run("exploit",["10.10.10.30","zero_day"]);
  rows.push(["P0-2 unowned exploit refused", /don't own|Unknown exploit/i.test(ex), one(ex)]);
  const sub = await run("subnet",["10.0.0.0/24"]);
  rows.push(["control: ungated cmd still works", !/requires|skill/i.test(sub) && sub.length>0, one(sub)]);

  console.log("\n===== P0 VERIFICATION =====");
  for (const [n,ok,w] of rows) console.log(`${ok?"PASS":"FAIL"}  ${n.padEnd(38)} ${w}`);
  console.log(`${rows.filter(r=>r[1]).length}/${rows.length} passed`);
  s.close(); process.exit(0);
})().catch(e=>{ console.error("ERR",e); process.exit(1); });
