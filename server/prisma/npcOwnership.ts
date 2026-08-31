/**
 * NPC server ownership.
 *
 * EVERY server must have an owner — a player or an NPC. `hack` refuses an
 * ownerless target outright (`hackCommands.resolveHackTarget`), and the hack
 * pipeline reads the DEFENDER's `PlayerProgress` for defence
 * (`targetProgress.forensics` in `calculateHackParameters`) and bails without
 * one. With 44 of 59 seeded servers ownerless, that made the entire NPC world
 * unhackable and left `hack` working only against other players' homes.
 *
 * Rather than synthesizing a fake defender at the call site, the fix is to make
 * the data model honest: faction infrastructure is owned by that faction's
 * NPC, and neutral infrastructure by a system sysadmin.
 *
 * Idempotent — safe to re-run, and safe to run against an existing database.
 */
import { PrismaClient } from "@prisma/client";

/**
 * Defender profiles.
 *
 * NOTE on which numbers actually matter: of the owner's skills, only
 * `forensics` currently affects a hack. `calculateHackParameters` reads
 * `targetProgress.forensics` (up to -20% attacker success, +15% detection) and
 * takes stealth from the ATTACKER only. `hacking`/`stealth` here are set for
 * coherence and for future defensive mechanics, but changing them today has no
 * mechanical effect — don't tune them expecting one.
 *
 * `homeFirewall`/`homeVault`/`homeIds`/`homeHoneypot` are deliberately left at 0:
 * those paths are all gated on `server.isPlayerHome`, which is false for every
 * NPC server, so they would be inert anyway.
 */
interface NpcProfile {
  /**
   * The account's username — and therefore the name a player sees in their
   * inbox. These are display names, not slugs: an intrusion warning signed
   * `npc_steele` breaks the fiction the message is trying to create.
   */
  username: string;
  /**
   * The pre-rename username, kept so existing databases can be migrated in
   * place instead of growing a second account per character.
   */
  legacyUsername: string;
  homeIp: string;
  /** Matching AIPersona name, or null for NPCs with no persona (the sysadmin). */
  personaName: string | null;
  forensics: number;
  hacking: number;
  stealth: number;
  cryptography: number;
}

/** Keys are stable identifiers used by the assignment rules below. */
const NPC_PROFILES: Record<string, NpcProfile> = {
  // Neutral public + training infrastructure. Deliberately soft: the training
  // range exists to be broken into, and this is the first defender a new player
  // ever meets. No persona — it speaks with a hand-written voice.
  sysadmin: { username: "sysadmin", legacyUsername: "npc_sysadmin", homeIp: "0.0.0.5", personaName: null, forensics: 5, hacking: 15, stealth: 10, cryptography: 10 },

  // Faction NPCs. Each shares an identity with the AIPersona of the same name:
  // ONE account per character, which owns that faction's servers AND sends its
  // messages. Previously these were separate accounts, so a player could receive
  // mail from both `npc_steele` and `Commander Steele`.
  garrison: { username: "Commander Steele", legacyUsername: "npc_steele", homeIp: "0.0.0.1", personaName: "Commander Steele", forensics: 65, hacking: 60, stealth: 40, cryptography: 50 },
  dothackers: { username: "gh0st", legacyUsername: "npc_gh0st", homeIp: "0.0.0.2", personaName: "gh0st", forensics: 45, hacking: 75, stealth: 70, cryptography: 60 },
  cybercorp: { username: "Director Chen", legacyUsername: "npc_chen", homeIp: "0.0.0.3", personaName: "Director Chen", forensics: 55, hacking: 50, stealth: 35, cryptography: 65 },
  darknet: { username: "AIDA", legacyUsername: "npc_aida", homeIp: "0.0.0.4", personaName: "AIDA", forensics: 80, hacking: 90, stealth: 85, cryptography: 90 },
};

/** Faction name (as seeded) → NPC profile key. */
const FACTION_TO_NPC: Record<string, string> = {
  "The Garrison": "garrison",
  dotHackers: "dothackers",
  CyberCorp: "cybercorp",
  DarkNet: "darknet",
};

/**
 * Server `type` → NPC profile key, for servers with no faction.
 * A rule rather than a hand-listed set, so servers added later are covered.
 * Approximate by design: "TechCorp Main Server" is type `corporate` and so ends
 * up with CyberCorp's NPC, which is close enough for a defender profile.
 */
const TYPE_TO_NPC: Record<string, string> = {
  tutorial: "sysadmin",
  public: "sysadmin",
  underground: "darknet",
  corporate: "cybercorp",
  government: "garrison",
};

export interface NpcOwnershipResult {
  npcsEnsured: number;
  progressCreated: number;
  serversAssigned: number;
  stillOwnerless: number;
  renamed: number;
  merged: number;
  assignmentsByNpc: Record<string, number>;
}

/**
 * Collapse the two-accounts-per-character situation into one.
 *
 * There were two independent creators of NPC identities: this file (owning
 * servers, named `npc_steele`) and `resolveAiPersonaUserId` (sending mail, named
 * `Commander Steele`). Both are the same character, so a player could receive
 * messages from two accounts for one person — one of them named `npc_steele`.
 *
 * The server-owning account wins, because it carries the real data (server
 * ownership, authored files, forum memberships). It takes over the display name
 * and the persona's canonical email, so `resolveAiPersonaUserId` resolves to it
 * by email and no second account is ever minted.
 *
 * Idempotent, and ordered to avoid tripping the unique constraints on
 * `username` / `email` midway.
 */
async function reconcileIdentity(
  prisma: PrismaClient,
  profile: NpcProfile,
  log: (msg: string) => void,
): Promise<{ id: string; renamed: boolean; merged: boolean }> {
  const personaEmail = profile.personaName
    ? await prisma.aIPersona
        .findFirst({ where: { name: profile.personaName }, select: { id: true } })
        .then((p) => (p ? `${p.id}@ai.aida.internal` : null))
    : null;

  // Candidate accounts for this character, in order of authority.
  const byLegacy = await prisma.user.findUnique({ where: { username: profile.legacyUsername } });
  const byDisplay = await prisma.user.findUnique({ where: { username: profile.username } });
  const byPersonaEmail = personaEmail
    ? await prisma.user.findUnique({ where: { email: personaEmail } })
    : null;

  // Prefer whichever account actually owns servers; that is the one holding data.
  const candidates = [byLegacy, byDisplay, byPersonaEmail].filter(
    (u): u is NonNullable<typeof u> => !!u,
  );
  const unique = new Map(candidates.map((u) => [u.id, u]));
  if (unique.size === 0) {
    return { id: "", renamed: false, merged: false };
  }

  let canonicalId = byLegacy?.id ?? byDisplay?.id ?? byPersonaEmail!.id;
  if (unique.size > 1) {
    const counts = await Promise.all(
      [...unique.values()].map(async (u) => ({
        id: u.id,
        servers: await prisma.gameServer.count({ where: { ownerId: u.id } }),
      })),
    );
    counts.sort((a, b) => b.servers - a.servers);
    canonicalId = counts[0]!.id;
  }

  let merged = false;
  for (const dup of unique.values()) {
    if (dup.id === canonicalId) continue;

    // Move anything that would be lost. Server ownership is the one that
    // matters for gameplay; messages are moved so inbox history stays coherent.
    const movedServers = await prisma.gameServer.updateMany({
      where: { ownerId: dup.id },
      data: { ownerId: canonicalId },
    });
    const movedMessages = await prisma.message.updateMany({
      where: { senderId: dup.id },
      data: { senderId: canonicalId },
    });

    // Forum memberships are unique per (userId, forumId), so a blind move can
    // collide. Drop the duplicate's rows the canonical account already has.
    const dupMemberships = await prisma.forumMember.findMany({
      where: { userId: dup.id },
      select: { id: true, forumId: true },
    });
    for (const m of dupMemberships) {
      const clash = await prisma.forumMember.findUnique({
        where: { userId_forumId: { userId: canonicalId, forumId: m.forumId } },
        select: { id: true },
      });
      if (clash) {
        await prisma.forumMember.delete({ where: { id: m.id } });
      } else {
        await prisma.forumMember.update({ where: { id: m.id }, data: { userId: canonicalId } });
      }
    }

    // Free the unique columns before the canonical account claims them.
    await prisma.user.update({
      where: { id: dup.id },
      data: {
        username: `merged_${dup.id.slice(0, 12)}`,
        email: `merged_${dup.id.slice(0, 12)}@merged.local`,
        homeIp: `0.1.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`,
      },
    });
    await prisma.playerProgress.deleteMany({ where: { userId: dup.id } });
    await prisma.user.delete({ where: { id: dup.id } });

    merged = true;
    log(
      `  [~] merged duplicate ${dup.username} into ${profile.username}` +
        ` (servers ${movedServers.count}, messages ${movedMessages.count}, memberships ${dupMemberships.length})`,
    );
  }

  const current = await prisma.user.findUnique({
    where: { id: canonicalId },
    select: { username: true, email: true },
  });
  const needsRename = current?.username !== profile.username;
  const needsEmail = !!personaEmail && current?.email !== personaEmail;

  if (needsRename || needsEmail) {
    await prisma.user.update({
      where: { id: canonicalId },
      data: {
        ...(needsRename ? { username: profile.username } : {}),
        ...(needsEmail ? { email: personaEmail! } : {}),
      },
    });
    if (needsRename) {
      log(`  [~] renamed ${current?.username} -> ${profile.username}`);
    }
  }

  return { id: canonicalId, renamed: needsRename, merged };
}

export async function assignNpcOwnership(
  prisma: PrismaClient,
  log: (msg: string) => void = () => {},
): Promise<NpcOwnershipResult> {
  const result: NpcOwnershipResult = {
    npcsEnsured: 0,
    progressCreated: 0,
    serversAssigned: 0,
    stillOwnerless: 0,
    renamed: 0,
    merged: 0,
    assignmentsByNpc: {},
  };

  // ── 1. Ensure every NPC user exists, is named for a player's eyes, and has a
  //       defender profile ──
  const npcIds = new Map<string, string>();
  for (const [key, profile] of Object.entries(NPC_PROFILES)) {
    // Collapse any pre-rename / duplicate accounts for this character first, so
    // the display name and persona email are free to claim.
    const reconciled = await reconcileIdentity(prisma, profile, log);
    if (reconciled.renamed) result.renamed++;
    if (reconciled.merged) result.merged++;

    let user = reconciled.id
      ? await prisma.user.findUnique({ where: { id: reconciled.id } })
      : null;

    if (!user) {
      user = await prisma.user.create({
        data: {
          username: profile.username,
          email: profile.personaName
            ? await prisma.aIPersona
                .findFirst({ where: { name: profile.personaName }, select: { id: true } })
                .then((p) => (p ? `${p.id}@ai.aida.internal` : `${key}@npc.local`))
            : `${key}@npc.local`,
          // NPCs never authenticate. This is not a hash of anything, so it
          // cannot validate against any input.
          password: "!npc-no-login",
          homeIp: profile.homeIp,
          role: "npc",
          isActive: true,
          isOnline: false,
        },
      });
      log(`  [+] created NPC user ${profile.username}`);
    }
    npcIds.set(key, user.id);
    result.npcsEnsured++;

    // A defender NEEDS PlayerProgress — the hack pipeline bails without it.
    // None of the pre-existing NPC users had one, which is the second half of
    // why NPC servers were unhackable.
    const existing = await prisma.playerProgress.findUnique({ where: { userId: user.id } });
    if (!existing) {
      await prisma.playerProgress.create({
        data: {
          userId: user.id,
          forensics: profile.forensics,
          hacking: profile.hacking,
          stealth: profile.stealth,
          cryptography: profile.cryptography,
          networking: profile.hacking,
          socialEng: 50,
          level: Math.max(1, Math.floor(profile.hacking / 5)),
          credits: 0,
        },
      });
      result.progressCreated++;
      log(`  [+] defender profile for ${profile.username} (forensics ${profile.forensics})`);
    }
  }

  // ── 2. Assign an owner to every ownerless server ──
  const factions = await prisma.faction.findMany({ select: { id: true, name: true } });
  const factionIdToNpcKey = new Map<string, string>();
  for (const f of factions) {
    const key = FACTION_TO_NPC[f.name];
    if (key) factionIdToNpcKey.set(f.id, key);
  }

  const ownerless = await prisma.gameServer.findMany({
    where: { ownerId: null },
    select: { id: true, name: true, type: true, factionId: true, isPlayerHome: true },
  });

  for (const server of ownerless) {
    // A player home with no owner is a data fault, not something to hand to an
    // NPC — claiming it would make it unreachable for its real owner.
    if (server.isPlayerHome) {
      result.stillOwnerless++;
      log(`  [!] SKIPPED ${server.name}: isPlayerHome with no owner (data fault)`);
      continue;
    }

    const key =
      (server.factionId ? factionIdToNpcKey.get(server.factionId) : undefined) ??
      TYPE_TO_NPC[server.type];

    if (!key) {
      result.stillOwnerless++;
      log(`  [!] SKIPPED ${server.name}: no rule for type "${server.type}"`);
      continue;
    }

    const ownerId = npcIds.get(key);
    if (!ownerId) {
      result.stillOwnerless++;
      continue;
    }

    await prisma.gameServer.update({ where: { id: server.id }, data: { ownerId } });
    result.serversAssigned++;
    const uname = NPC_PROFILES[key]!.username;
    result.assignmentsByNpc[uname] = (result.assignmentsByNpc[uname] ?? 0) + 1;
  }

  return result;
}

/**
 * Runtime resolver: which NPC should own a newly created server?
 *
 * Seeding alone is not enough — `darknetDungeonService` regenerates dungeons
 * periodically and `contentDraftService` creates AI-authored servers, both of
 * which would otherwise reintroduce ownerless (and therefore unhackable)
 * servers. Call this at every creation site that has no player owner.
 *
 * Returns null rather than throwing if no NPC can be resolved: failing to
 * assign an owner should degrade the server's hackability, never abort content
 * generation.
 */
export async function resolveNpcOwnerId(
  prisma: PrismaClient,
  server: { factionId?: string | null; type?: string | null },
): Promise<string | null> {
  try {
    let key: string | undefined;

    if (server.factionId) {
      const faction = await prisma.faction.findUnique({
        where: { id: server.factionId },
        select: { name: true },
      });
      if (faction) key = FACTION_TO_NPC[faction.name];
    }
    key ??= server.type ? TYPE_TO_NPC[server.type] : undefined;
    // Unknown type: neutral infrastructure is a safer default than no owner.
    key ??= "sysadmin";

    const profile = NPC_PROFILES[key];
    if (!profile) return null;

    const user = await prisma.user.findUnique({
      where: { username: profile.username },
      select: { id: true },
    });
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/** Standalone runner: `npx tsx prisma/npcOwnership.ts` */
async function main() {
  const prisma = new PrismaClient();
  try {
    console.log("Assigning NPC server ownership...");
    const r = await assignNpcOwnership(prisma, (m) => console.log(m));
    console.log(`\n  NPCs ensured:       ${r.npcsEnsured}`);
    console.log(`  Profiles created:   ${r.progressCreated}`);
    console.log(`  Servers assigned:   ${r.serversAssigned}`);
    console.log(`  Still ownerless:    ${r.stillOwnerless}`);
    console.log("\n  by owner:");
    for (const [name, count] of Object.entries(r.assignmentsByNpc)) {
      console.log(`    ${name.padEnd(16)} ${count}`);
    }
    const remaining = await prisma.gameServer.count({ where: { ownerId: null } });
    console.log(`\n  servers still without an owner: ${remaining}`);
  } finally {
    await prisma.$disconnect();
  }
}

// Only run when invoked directly, not when imported by seed.ts.
if (process.argv[1] && process.argv[1].endsWith("npcOwnership.ts")) {
  main();
}
