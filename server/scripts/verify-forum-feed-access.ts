/**
 * Who may receive a forum's live feed.
 *
 * REVIEW #2 (angle E): the forum-room join added on 2026-09-25 did
 * `forumMember.findMany({ where: { userId } })` with no further filter, so a
 * socket joined `forum:<id>` for EVERY membership row. `banMember` only flips
 * `isBanned: true` and leaves the row in place — posting checks that flag,
 * the join did not — so a banned member rejoined the live feed on their next
 * authenticate and kept reading every new post and reply in real time.
 *
 * This was latent before that change (nothing had ever joined the room). The
 * join is what made it exploitable, which makes it mine.
 *
 * THE DECISION LIVES IN A FUNCTION, not inline in a socket handler. That is
 * half the fix: an access rule buried in `handlers.ts` cannot be tested
 * without standing up a socket, and the previous inline version was never
 * exercised by anything.
 *
 * WRITTEN BEFORE THE FIX and confirmed red.
 *
 * SELF-CONTAINED: builds its own forums, memberships and player.
 *
 * Run: npx tsx scripts/verify-forum-feed-access.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("\n=== Forum live-feed access ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const forums = getService<any>(TOKENS.FORUM_SERVICE);

  const tag = `__feed_probe_${process.pid}`;
  const madeForums: string[] = [];
  let userId: string | null = null;

  const mkForum = async (label: string, isActive: boolean, requiresProxy = false) => {
    const f = await prisma.forum.create({
      data: {
        name: `${tag}_${label}`,
        description: "probe",
        url: `${tag}-${label}.onion`,
        category: "general",
        securityLevel: 1,
        isActive,
        requiresProxy,
      },
    });
    madeForums.push(f.id);
    return f;
  };

  try {
    const user = await prisma.user.create({
      data: {
        username: tag,
        email: `${tag}@probe.local`,
        password: "p",
        homeIp: `10.61.0.${process.pid % 250}`,
      },
    });
    userId = user.id;

    const ok = await mkForum("ok", true);
    const banned = await mkForum("banned", true);
    const inactive = await mkForum("inactive", false);
    const proxied = await mkForum("proxied", true, true);

    await prisma.forumMember.createMany({
      data: [
        { userId: user.id, forumId: ok.id, handle: `${tag}_h1` },
        { userId: user.id, forumId: banned.id, handle: `${tag}_h2`, isBanned: true },
        { userId: user.id, forumId: inactive.id, handle: `${tag}_h3` },
        { userId: user.id, forumId: proxied.id, handle: `${tag}_h4` },
      ],
    });

    // ── The rule ─────────────────────────────────────────────────────
    console.log("\nFF-1 — only a valid membership grants the live feed");
    {
      const allowed: string[] = await forums.getLiveFeedForums(user.id);
      check(
        "the function exists and returns a list",
        Array.isArray(allowed),
        "the decision used to be inline in handlers.ts, where nothing could reach it",
      );
      check(
        "POSITIVE CONTROL: a normal membership IS included",
        allowed.includes(ok.id),
        "otherwise the exclusions below pass because the function returns nothing",
      );
      check(
        "a BANNED member does not receive the feed",
        !allowed.includes(banned.id),
        "banMember leaves the row in place, so the join used to re-add them every reconnect",
      );
      check(
        "an INACTIVE forum does not broadcast",
        !allowed.includes(inactive.id),
        "an archived forum should not be pushing live posts to anyone",
      );
      check(
        "a requiresProxy forum does not broadcast",
        !allowed.includes(proxied.id),
        "accessForum refuses to show these without a proxy; the live feed was " +
        "handing over the same posts with no proxy at all",
      );
      check(
        "and nothing else leaks in",
        allowed.length === 1,
        `${allowed.length} forums for a user with 4 memberships`,
      );
    }

    // ── A ban must reach the sockets already in the room ─────────────
    console.log("\nFF-4 — ban and unban both reach the LIVE session");
    {
      const left: Array<{ from: string; room: string }> = [];
      const joined: Array<{ from: string; room: string }> = [];
      const realIo = (forums as any).io;
      (forums as any).io = {
        in: (from: string) => ({
          socketsLeave: (room: string) => left.push({ from, room }),
          socketsJoin: (room: string) => joined.push({ from, room }),
        }),
        to: () => ({ emit: () => {} }),
      };

      // The banner must be an admin of the forum, so promote the probe user
      // and ban a second member rather than themselves.
      const victim = await prisma.user.create({
        data: {
          username: `${tag}_v`,
          email: `${tag}_v@probe.local`,
          password: "p",
          homeIp: `10.63.0.${process.pid % 250}`,
        },
      });
      try {
        await prisma.forumMember.update({
          where: { userId_forumId: { userId: user.id, forumId: ok.id } },
          data: { isAdmin: true },
        });
        await prisma.forumMember.create({
          data: { userId: victim.id, forumId: ok.id, handle: `${tag}_vh` },
        });

        await forums.banMember(user.id, ok.id, `${tag}_vh`);

        check(
          "PRECONDITION: the ban was recorded",
          (await prisma.forumMember.findUnique({
            where: { userId_forumId: { userId: victim.id, forumId: ok.id } },
            select: { isBanned: true },
          }))?.isBanned === true,
          "otherwise the eviction check below says nothing",
        );
        check(
          "the banned user is removed from the forum room",
          left.some((l) => l.room === `forum:${ok.id}`),
          `${JSON.stringify(left)} — the flag alone only gates paths that re-check ` +
          "membership, so a joined socket kept reading posts until it reconnected",
        );
        check(
          "and it covers every tab, not one socket",
          left.some((l) => l.from === `user:${victim.id}`),
          `${JSON.stringify(left)} — socketsLeave over user:<id> is the sanctioned idiom`,
        );
        check(
          "and it evicts the VICTIM, not the admin who issued the ban",
          !left.some((l) => l.from === `user:${user.id}`),
          `${JSON.stringify(left)}`,
        );

        // ── The other direction ──────────────────────────────────────
        joined.length = 0;
        await forums.unbanMember(user.id, ok.id, `${tag}_vh`);
        check(
          "PRECONDITION: the unban was recorded",
          (await prisma.forumMember.findUnique({
            where: { userId_forumId: { userId: victim.id, forumId: ok.id } },
            select: { isBanned: true },
          }))?.isBanned === false,
        );
        check(
          "unbanMember puts them BACK in the room",
          joined.some(
            (j) => j.room === `forum:${ok.id}` && j.from === `user:${victim.id}`,
          ),
          `${JSON.stringify(joined)} — without the symmetric rejoin an unban is silently ` +
          "inert: they can read and post, but their live feed stays dead until they reload",
        );
      } finally {
        (forums as any).io = realIo;
        await prisma.forumMember.deleteMany({ where: { userId: victim.id } });
        await prisma.user.delete({ where: { id: victim.id } }).catch((e) => {
          console.error("CLEANUP FAILED (victim):", e.message);
        });
      }
    }

    // ── A non-member gets nothing ────────────────────────────────────
    console.log("\nFF-2 — membership is required, not merely knowing the id");
    {
      const stranger = await prisma.user.create({
        data: {
          username: `${tag}_s`,
          email: `${tag}_s@probe.local`,
          password: "p",
          homeIp: `10.62.0.${process.pid % 250}`,
        },
      });
      try {
        const allowed: string[] = await forums.getLiveFeedForums(stranger.id);
        check(
          "a user with no memberships joins no rooms",
          allowed.length === 0,
          `${allowed.length}`,
        );
      } finally {
        await prisma.user.delete({ where: { id: stranger.id } });
      }
    }

    // ── Registration must obey the SAME rule as the join ─────────────
    console.log("\nFF-5 — a mid-session registration cannot bypass the rule");
    {
      // `registerForumAccount` used to join `forum:<id>` unconditionally. So a
      // player who registered on a proxy-only forum received its live feed for
      // the rest of that session — and lost it on the next reconnect, when the
      // authenticate-time join correctly refused. Same player, same forum, two
      // different answers, which is what one rule stated in two places buys.
      const joined: Array<{ from: string; room: string }> = [];
      const realIo = (forums as any).io;
      (forums as any).io = {
        in: (from: string) => ({
          socketsJoin: (room: string) => joined.push({ from, room }),
          socketsLeave: () => {},
        }),
        to: () => ({ emit: () => {} }),
      };

      const joiner = await prisma.user.create({
        data: {
          username: `${tag}_j`,
          email: `${tag}_j@probe.local`,
          password: "p",
          homeIp: `10.64.0.${process.pid % 250}`,
        },
      });
      try {
        // Registration now requires prior discovery, so grant it explicitly.
        // `accessForum` would auto-discover, but calling it here would also
        // trigger honeypots and emit — the fixture states the precondition
        // directly instead.
        await prisma.forumDiscovery.createMany({
          data: [
            { userId: joiner.id, forumId: ok.id, method: "scan" },
            { userId: joiner.id, forumId: proxied.id, method: "scan" },
          ],
        });

        await forums.registerForumAccount(joiner.id, ok.id, `${tag}_jh`);
        check(
          "POSITIVE CONTROL: registering on an ordinary forum DOES join the room",
          joined.some((j) => j.room === `forum:${ok.id}` && j.from === `user:${joiner.id}`),
          `${JSON.stringify(joined)} — otherwise the exclusion below is vacuous`,
        );

        // A proxy-only forum is now refused at registration, which is stronger
        // than "registers but does not join": `accessForum` would not show it
        // without a proxy, so creating an identity on it should not be
        // possible either.
        joined.length = 0;
        let proxyErr: any = null;
        try {
          await forums.registerForumAccount(joiner.id, proxied.id, `${tag}_jp`);
        } catch (e) { proxyErr = e; }
        check(
          "registering on a requiresProxy forum without a proxy is refused",
          proxyErr !== null && /proxy/i.test(String(proxyErr?.message)),
          `${proxyErr?.message ?? "no error — it succeeded"}`,
        );
        check(
          "and no membership row was left behind",
          (await prisma.forumMember.findUnique({
            where: { userId_forumId: { userId: joiner.id, forumId: proxied.id } },
          })) === null,
          "a refusal that still writes the row is worse than no check",
        );
        check(
          "nor was the room joined",
          !joined.some((j) => j.room === `forum:${proxied.id}`),
          `${JSON.stringify(joined)}`,
        );

        // Even with a membership forced into place, the feed predicate holds.
        await prisma.forumMember.create({
          data: { userId: joiner.id, forumId: proxied.id, handle: `${tag}_jf` },
        });
        check(
          "and the live feed still excludes it even if a membership exists",
          !(await forums.getLiveFeedForums(joiner.id)).includes(proxied.id),
          "the registration gate and the feed predicate are independent defences",
        );

        // ── Discovery is required ────────────────────────────────────
        const undiscovered = await mkForum("undiscovered", true);
        let discErr: any = null;
        try {
          await forums.registerForumAccount(joiner.id, undiscovered.id, `${tag}_ju`);
        } catch (e) { discErr = e; }
        check(
          "registering on a forum you have never found is refused",
          discErr !== null && /found this forum/i.test(String(discErr?.message)),
          `${discErr?.message ?? "no error — knowing the id was enough"}`,
        );
        check(
          "and the refusal names the fix rather than claiming it does not exist",
          /access it first/i.test(String(discErr?.message)),
          `"${discErr?.message}" — "Forum not found" for a forum that plainly exists ` +
          "reads as a bug",
        );
      } finally {
        (forums as any).io = realIo;
        await prisma.forumMember.deleteMany({ where: { userId: joiner.id } });
        await prisma.user.delete({ where: { id: joiner.id } }).catch((e) => {
          console.error("CLEANUP FAILED (joiner):", e.message);
        });
      }
    }

    // ── The handler must use it ──────────────────────────────────────
    console.log("\nFF-3 — the socket handler routes through the function");
    {
      const { readFileSync } = await import("node:fs");
      const h = readFileSync(
        new URL("../src/sockets/handlers.ts", import.meta.url).pathname,
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      check(
        "handlers.ts calls getLiveFeedForums",
        /getLiveFeedForums\(/.test(h),
        "an access rule inline in a socket handler is one nothing can test",
      );
      check(
        "and no longer queries forumMember directly",
        !/forumMember\.findMany/.test(h),
        "two places deciding who may read a forum is how they drift",
      );
    }
  } finally {
    if (userId) {
      await prisma.forumMember.deleteMany({ where: { userId } });
      await prisma.user.delete({ where: { id: userId } }).catch((e) => {
        console.error("CLEANUP FAILED (user):", e.message);
      });
    }
    for (const id of madeForums) {
      await prisma.forumMember.deleteMany({ where: { forumId: id } });
      await prisma.forum.delete({ where: { id } }).catch((e) => {
        console.error(`CLEANUP FAILED (forum ${id}):`, e.message);
      });
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
