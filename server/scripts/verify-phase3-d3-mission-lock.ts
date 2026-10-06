/**
 * D3 — PlayerMissionRepository: per-user serialisation (pass 1) and the two
 * guarantees only real tables can give (pass 2).
 *
 * Pass 1 proved `mutate`/`mutateAll` turn read-modify-write into one critical
 * section. Pass 2 moved storage into `PlayerMission` / `PlayerMissionObjective`,
 * which buys two things a lock never could:
 *   - `incrementObjective` is a relative UPDATE, so concurrent credits to the
 *     SAME objective cannot collapse (callers used to pass an absolute computed
 *     from a read outside the lock);
 *   - `findExpired` is one indexed query instead of scanning every player.
 *
 * Every negative assertion is paired with either a positive control or a
 * negative control running the OLD shape — without those, a passing suite could
 * just mean the harness failed to interleave.
 *
 * Run: npx tsx scripts/verify-phase3-d3-mission-lock.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import {
  PlayerMissionRepository,
  NO_CHANGE,
  type StoredPlayerMission,
} from "../src/repositories/playerMissionRepository";

const prisma = new PrismaClient();
const repo = new PlayerMissionRepository(pino({ level: "silent" }) as any, prisma);

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

const createdUsers: string[] = [];
const createdMissions: string[] = [];

/** A real Mission row — PlayerMission.missionId has a FK to it now. */
async function makeMission(tag: string): Promise<string> {
  const m = await prisma.mission.create({
    data: {
      title: `d3 ${tag}`, description: "harness", type: "test",
      difficulty: 1, reward: {} as never, objectives: [] as never, status: "available",
    },
    select: { id: true },
  });
  createdMissions.push(m.id);
  return m.id;
}

async function makeUser(tag: string): Promise<string> {
  const id = `d3_${tag}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  await prisma.user.create({
    data: {
      id, username: id, email: `${id}@d3.test`, password: "x",
      homeIp: `0.7.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`,
      role: "npc",
      progress: { create: {} },
    },
  });
  createdUsers.push(id);
  return id;
}

function missionBody(missionId: string, userId: string, over: Partial<StoredPlayerMission> = {}): StoredPlayerMission {
  return {
    missionId, userId, status: "active",
    objectives: [{ id: `${missionId}_o1`, type: "hack", target: 1, current: 0, completed: false }],
    startedAt: new Date().toISOString(),
    ...over,
  };
}

/**
 * A player holding `n` missions, keyed m1..mn for readability. Returns the
 * userId plus the real mission ids behind those aliases.
 */
async function player(tag: string, aliases: string[] = [], over: Record<string, Partial<StoredPlayerMission>> = {}) {
  const userId = await makeUser(tag);
  const ids: Record<string, string> = {};
  for (const alias of aliases) {
    const missionId = await makeMission(`${tag}_${alias}`);
    ids[alias] = missionId;
    await repo.put(userId, missionId, missionBody(missionId, userId, over[alias] ?? {}));
  }
  return { userId, ids };
}

/** A player with a single COUNT objective, for the pass-2 increment tests. */
async function countObjective(tag: string, target: number, boolean_ = false, expiresAt?: Date) {
  const userId = await makeUser(tag);
  const missionId = await makeMission(tag);
  const objectiveId = boolean_ ? "obj_flag" : "obj_count";
  await repo.put(userId, missionId, {
    missionId, userId, status: "active",
    startedAt: new Date().toISOString(),
    ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
    objectives: [
      boolean_
        ? { id: objectiveId, type: "flag", target: true, current: false, completed: false }
        : { id: objectiveId, type: "count", target, current: 0, completed: false },
    ],
  });
  return { userId, missionId, objectiveId };
}

async function readObjective(userId: string, missionId: string, objectiveId: string) {
  return prisma.playerMissionObjective.findFirst({
    where: { objectiveId, playerMission: { userId, missionId } },
    select: { currentCount: true, completed: true, currentFlag: true },
  });
}

/** Current stored state, keyed by mission id. */
async function readState(userId: string): Promise<Record<string, StoredPlayerMission>> {
  const out: Record<string, StoredPlayerMission> = {};
  for (const m of await repo.list(userId)) out[m.missionId] = m;
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("\n=== D3 — PlayerMissionRepository (pass 1 lock + pass 2 tables) ===\n");

  // ── PASS 1: concurrent writes to DIFFERENT missions of one player ─────
  console.log("Lost updates (pass 1)");
  {
    const { userId, ids } = await player("lost", ["m1", "m2"]);
    await Promise.all([
      repo.mutate(userId, ids.m1!, (m) => { m!.status = "completed"; return m!; }),
      repo.mutate(userId, ids.m2!, (m) => { m!.status = "failed"; return m!; }),
    ]);
    const st = await readState(userId);
    check(
      "two concurrent mutations on one player both survive",
      st[ids.m1!]?.status === "completed" && st[ids.m2!]?.status === "failed",
      `m1=${st[ids.m1!]?.status} m2=${st[ids.m2!]?.status}`,
    );
  }
  {
    const { userId, ids } = await player("bump", ["m1"]);
    await Promise.all(
      Array.from({ length: 20 }, () =>
        repo.mutate(userId, ids.m1!, (m) => {
          const o = m!.objectives[0]!;
          o.current = (o.current as number) + 1;
          return m!;
        }),
      ),
    );
    const st = await readState(userId);
    check("20 concurrent read-modify-writes all land", st[ids.m1!]?.objectives[0]?.current === 20, `current=${st[ids.m1!]?.objectives[0]?.current}`);
  }

  // ── PASS 1: the sweep race, D3's headline ─────────────────────────────
  console.log("\nThe expiry-sweep race (D3's headline)");
  {
    const { userId, ids } = await player("sweep", ["m1"], {
      m1: { expiresAt: new Date(Date.now() - 1000).toISOString() },
    });

    const sweep = repo.mutateAll(userId, async (blob) => {
      await sleep(60); // stand in for the sweep's two awaits
      let changed = false;
      for (const id of Object.keys(blob)) {
        const pm = blob[id]!;
        if (pm.status === "active" && pm.expiresAt && new Date(pm.expiresAt).getTime() < Date.now()) {
          pm.status = "expired";
          changed = true;
        }
      }
      return changed;
    });
    await sleep(10); // player acts while the sweep is mid-flight
    const complete = repo.mutate(userId, ids.m1!, (m) => { m!.status = "completed"; return m!; });
    await Promise.all([sweep, complete]);

    const st = await readState(userId);
    check("a mission completed during the sweep is NOT reverted to active", st[ids.m1!]?.status !== "active", `status=${st[ids.m1!]?.status}`);
    check("the completion wins (serialised after the sweep)", st[ids.m1!]?.status === "completed", `status=${st[ids.m1!]?.status}`);
  }

  // ── Lock behaviour ────────────────────────────────────────────────────
  console.log("\nLock behaviour");
  {
    const { userId, ids } = await player("throw", ["m1"]);
    const boom = repo.mutate(userId, ids.m1!, () => { throw new Error("boom"); }).catch(() => "rejected");
    const after = repo.mutate(userId, ids.m1!, (m) => { m!.status = "completed"; return m!; });
    const [b] = await Promise.all([boom, after]);
    const st = await readState(userId);
    check("a throwing mutation rejects its own caller", b === "rejected");
    check("and does NOT deadlock the next operation", st[ids.m1!]?.status === "completed", `status=${st[ids.m1!]?.status}`);
  }
  {
    const a = await player("iso_a", ["m1"]);
    const b = await player("iso_b", ["m1"]);
    const order: string[] = [];
    await Promise.all([
      repo.mutate(a.userId, a.ids.m1!, async (m) => { await sleep(80); order.push("a"); m!.status = "completed"; return m!; }),
      repo.mutate(b.userId, b.ids.m1!, async (m) => { await sleep(10); order.push("b"); m!.status = "completed"; return m!; }),
    ]);
    check("different players are not serialised against each other", order[0] === "b", `order=${order.join(",")}`);
  }
  {
    const { userId, ids } = await player("nochange", ["m1"]);
    const before = await prisma.playerMission.findFirstOrThrow({ where: { userId }, select: { updatedAt: true } });
    await sleep(15);
    await repo.mutate(userId, ids.m1!, () => NO_CHANGE);
    const after = await prisma.playerMission.findFirstOrThrow({ where: { userId }, select: { updatedAt: true } });
    check("NO_CHANGE skips the write (updatedAt untouched)", before.updatedAt.getTime() === after.updatedAt.getTime());
  }
  {
    const { userId, ids } = await player("drain", ["m1"]);
    await repo.mutate(userId, ids.m1!, (m) => m!);
    await sleep(20);
    const size = (repo as unknown as { chains: Map<string, unknown> }).chains.size;
    check("the lock map drains after the chain completes", size === 0, `chains.size=${size}`);
  }
  {
    // Reentrancy must THROW, not hang — a nested call waits on a lock the
    // caller already holds, which would strand that player permanently.
    const { userId, ids } = await player("reentrant", ["m1"]);
    const outcome = await Promise.race([
      repo
        .mutateAll(userId, async () => {
          await repo.get(userId, ids.m1!); // reads are fine…
          await repo.put(userId, ids.m1!, missionBody(ids.m1!, userId)); // …this must throw
          return true;
        })
        .then(() => "resolved", (e: Error) => (/re-entrant/i.test(e.message) ? "threw" : `wrong error: ${e.message}`)),
      sleep(3000).then(() => "HUNG"),
    ]);
    check("a re-entrant call throws instead of deadlocking", outcome === "threw", `outcome=${outcome}`);
    const after = await repo.mutate(userId, ids.m1!, (m) => { m!.status = "completed"; return m!; });
    check("the player's lock is released after a re-entrant throw", after?.status === "completed");
  }

  // ── PASS 2: what the blob could not express ───────────────────────────
  console.log("\nPass 2 — relative increments and the sweep query");
  {
    const { userId, missionId, objectiveId } = await countObjective("inc", 50);
    await Promise.all(
      Array.from({ length: 25 }, () => repo.incrementObjective(userId, missionId, objectiveId, 1)),
    );
    const o = await readObjective(userId, missionId, objectiveId);
    check("25 concurrent credits all land (pass 1 could not do this)", o?.currentCount === 25, `current=${o?.currentCount}`);
    check("not yet complete below target", o?.completed === false, `completed=${o?.completed}`);
  }
  {
    // NEGATIVE CONTROL for the same thing — the old absolute-from-a-read shape
    // must still lose credits, or the test above proves nothing.
    const { userId, missionId, objectiveId } = await countObjective("inc_neg", 50);
    const oldCredit = async () => {
      const cur = await readObjective(userId, missionId, objectiveId);
      await prisma.playerMissionObjective.updateMany({
        where: { objectiveId, playerMission: { userId, missionId } },
        data: { currentCount: (cur?.currentCount ?? 0) + 1 },
      });
    };
    await Promise.all(Array.from({ length: 25 }, () => oldCredit()));
    const o = await readObjective(userId, missionId, objectiveId);
    check("NEGATIVE CONTROL: the old absolute-from-a-read DOES lose credits", (o?.currentCount ?? 0) < 25, `current=${o?.currentCount} of 25`);
  }
  {
    const { userId, missionId, objectiveId } = await countObjective("inc_done", 3);
    const r1 = await repo.incrementObjective(userId, missionId, objectiveId, 3);
    check("reaching the target completes the objective", r1?.completed === true, `completed=${r1?.completed}`);
    const r2 = await repo.incrementObjective(userId, missionId, objectiveId, -5);
    check("completion is STICKY when the counter later drops (G1)", r2?.completed === true, `current=${r2?.current} completed=${r2?.completed}`);
  }
  {
    const { userId, missionId } = await countObjective("inc_bool", 1, true);
    const r = await repo.incrementObjective(userId, missionId, "obj_flag", 1);
    check("a boolean objective returns null from incrementObjective", r === null, `got=${JSON.stringify(r)}`);
  }
  {
    const past = new Date(Date.now() - 60_000);
    const due0 = await countObjective("exp", 5, false, past);
    const due = await repo.findExpired(new Date());
    check("findExpired returns the overdue active mission", due.some((d) => d.missionId === due0.missionId), `${due.length} due`);

    const fresh = await countObjective("exp_ok", 5, false, new Date(Date.now() + 3_600_000));
    const due2 = await repo.findExpired(new Date());
    check("POSITIVE CONTROL: a future-dated mission is NOT returned", !due2.some((d) => d.missionId === fresh.missionId));
  }
  {
    // REGRESSION GUARD — found by code review, not by this harness.
    //
    // `incrementObjective` is relative and so is safe against another
    // increment, but NOT against `mutate`: `writeMission` re-upserts every
    // objective with an ABSOLUTE currentCount taken from the copy `mutate` read
    // at the top of its callback. After the pass-2 conversion, count objectives
    // are credited through `creditObjective`/`incrementObjective` and boolean
    // ones through `updateObjective`/`mutate` — and one mission routinely has
    // both, so crediting the boolean could erase a concurrent count credit.
    // Before the fix this left current_count at 0 after a +7.
    const userId = await makeUser("lostupd");
    const missionId = await makeMission("lostupd");
    await repo.put(userId, missionId, {
      missionId, userId, status: "active", startedAt: new Date().toISOString(),
      objectives: [
        { id: "cnt", type: "count", target: 100, current: 0, completed: false },
        { id: "flag", type: "flag", target: true, current: false, completed: false },
      ],
    } as never);

    const slowBooleanUpdate = repo.mutate(userId, missionId, async (pm) => {
      await sleep(120); // the window between get() and writeMission()
      pm!.objectives.find((o) => o.id === "flag")!.current = true;
      return pm!;
    });
    await sleep(30);
    await repo.incrementObjective(userId, missionId, "cnt", 7);
    await slowBooleanUpdate;

    const cnt = await readObjective(userId, missionId, "cnt");
    check(
      "a count credit is NOT erased by a concurrent boolean update on the same mission",
      cnt?.currentCount === 7,
      `current=${cnt?.currentCount} (0 means the increment was clobbered)`,
    );
  }
  {
    // The round-trip that makes pass 2 invisible to the 64 call sites.
    const { userId, ids } = await player("roundtrip", ["m1"]);
    await repo.mutate(userId, ids.m1!, (m) => {
      m!.objectives = [
        { id: "a", type: "count", target: 5, current: 2, completed: false },
        { id: "b", type: "flag", target: true, current: true, completed: true },
      ];
      return m!;
    });
    const back = await repo.get(userId, ids.m1!);
    const a = back?.objectives.find((o) => o.id === "a");
    const b = back?.objectives.find((o) => o.id === "b");
    check("a count objective round-trips as numbers", a?.target === 5 && a?.current === 2 && a?.completed === false, JSON.stringify(a));
    check("a boolean objective round-trips as booleans", b?.target === true && b?.current === true && b?.completed === true, JSON.stringify(b));
    check("objective ORDER is preserved", back?.objectives.map((o) => o.id).join(",") === "a,b", back?.objectives.map((o) => o.id).join(","));
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===\n`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => {
    if (createdUsers.length) await prisma.user.deleteMany({ where: { id: { in: createdUsers } } });
    if (createdMissions.length) await prisma.mission.deleteMany({ where: { id: { in: createdMissions } } });
    await prisma.$disconnect();
  });
