/**
 * BountyService — a hunter claiming and completing a faction bounty.
 *
 * Posting stays in hackCountermeasureService (it is a countermeasure). A4
 * moved claim and completion out of `playerInfoCommands`, where they were
 * direct `db.client` writes, and reading them found that the feature could
 * never have worked, and would have paid out wrongly if it had:
 *
 *   - UNCLAIMABLE. `bounties` prints `id.substring(0, 16)`; ids are 25-char
 *     cuids and `bounty claim` looked them up with `findUnique`. The ID the
 *     game showed the player could never be found. `resolve` accepts it.
 *   - CLAIM RACE. Status and claimer were checked, then written: two hunters
 *     claiming together both passed and both were told "BOUNTY CLAIMED", the
 *     second silently overwriting the first. The guard is now the WHERE.
 *   - DOUBLE PAYOUT. Completion was the same check-then-act, then paid. Two
 *     concurrent completes both paid the credits and the reputation. The
 *     transition and the credit grant are now one transaction, and only the
 *     request whose transition matched pays.
 *   - STALE PROOF. "Hack the target's home" was checked as "has EVER held
 *     access there" — connection rows are never pruned, so a hunter who had
 *     been in that home a month earlier completed the bounty the instant they
 *     claimed it. Access must have been gained after the bounty was posted.
 *   - EXPIRED CLAIMS. The listing hid expired bounties; `claim` did not check.
 */
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import type { Server as SocketIOServer } from "socket.io";
import type { Bounty } from "@prisma/client";
import { prisma } from "../database/client";
import {
  FACTION_SERVICE,
  FILE_SERVICE,
  LOGGER,
  MISSION_INTEGRATION_SERVICE,
  PLAYER_PROGRESS_REPOSITORY,
  SOCKET_IO,
} from "../di/tokens";
import { getService } from "../di/resolve";
import { notifyUser } from "../utils/notify";
import type PlayerProgressRepository from "../repositories/playerProgressRepository";
import type { FactionService } from "./factionService";
import type FileService from "./fileService";
import type { MissionIntegrationService } from "./missionIntegration";

/** The shortest id prefix accepted — the listing prints 16. */
const MIN_PREFIX = 8;

export type Resolved = { ok: true; bounty: Bounty } | { ok: false; error: string };
export type ClaimResult = { ok: true; bounty: Bounty; targetHomeIp: string | null } | { ok: false; error: string };
export interface Completion {
  ok: true;
  bounty: Bounty;
  filesDeleted: number;
  decoysHit: number;
  keysRevoked: number;
}
export type CompleteResult = Completion | { ok: false; error: string };

@injectable()
export class BountyService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
    @inject(PLAYER_PROGRESS_REPOSITORY) private progress: PlayerProgressRepository,
  ) {}

  /** Full id, or the unambiguous prefix `bounties` displays. */
  async resolve(idOrPrefix: string): Promise<Resolved> {
    const exact = await prisma.bounty.findUnique({ where: { id: idOrPrefix } });
    if (exact) return { ok: true, bounty: exact };
    if (idOrPrefix.length >= MIN_PREFIX) {
      const matches = await prisma.bounty.findMany({ where: { id: { startsWith: idOrPrefix } }, take: 2 });
      if (matches.length === 1 && matches[0]) return { ok: true, bounty: matches[0] };
      if (matches.length > 1) return { ok: false, error: `Ambiguous bounty id: ${idOrPrefix}. Use more characters.` };
    }
    return { ok: false, error: `Bounty not found: ${idOrPrefix}` };
  }

  async claim(bountyId: string, userId: string): Promise<ClaimResult> {
    const now = new Date();
    const won = await prisma.bounty.updateMany({
      where: {
        id: bountyId,
        status: "active",
        claimedByUserId: null,
        expiresAt: { gt: now },
        targetUserId: { not: userId },
      },
      data: { claimedByUserId: userId, status: "claimed" },
    });
    const bounty = await prisma.bounty.findUnique({ where: { id: bountyId } });
    if (!bounty) return { ok: false, error: `Bounty not found: ${bountyId}` };
    if (won.count !== 1) {
      // Explain from the row as it is NOW — after the race, not before it.
      if (bounty.targetUserId === userId) return { ok: false, error: "You can't claim a bounty on yourself." };
      if (bounty.claimedByUserId && bounty.claimedByUserId !== userId) {
        return { ok: false, error: "Bounty already claimed by another player." };
      }
      if (bounty.status !== "active") return { ok: false, error: `Bounty is ${bounty.status}, cannot claim.` };
      if (bounty.expiresAt <= now) return { ok: false, error: "Bounty has expired." };
      return { ok: false, error: "Bounty could not be claimed." };
    }
    const target = await prisma.user.findUnique({ where: { id: bounty.targetUserId }, select: { homeIp: true } });
    return { ok: true, bounty, targetHomeIp: target?.homeIp ?? null };
  }

  async complete(bountyId: string, userId: string): Promise<CompleteResult> {
    const bounty = await prisma.bounty.findUnique({ where: { id: bountyId } });
    if (!bounty) return { ok: false, error: `Bounty not found: ${bountyId}` };
    if (bounty.status !== "claimed") {
      return { ok: false, error: bounty.status === "completed"
        ? "Bounty already completed."
        : "Bounty must be claimed first. Use 'bounty claim <id>'." };
    }
    if (bounty.claimedByUserId !== userId) return { ok: false, error: "This bounty was claimed by someone else." };

    const target = await prisma.user.findUnique({
      where: { id: bounty.targetUserId },
      select: { homeServerId: true, homeIp: true },
    });
    if (!target?.homeServerId) return { ok: false, error: "Target has no home server." };
    const access = await prisma.serverConnection.findFirst({
      where: {
        userId,
        serverId: target.homeServerId,
        accessLevel: { gt: 0 },
        connectedAt: { gte: bounty.createdAt },
      },
      select: { id: true },
    });
    if (!access) {
      return { ok: false, error: `You haven't hacked ${bounty.targetUsername}'s home server since this bounty was posted. Hack ${target.homeIp} first.` };
    }

    // The transition IS the authorization: only the request that moves the
    // row out of "claimed" pays, and the pay commits with it or not at all.
    const paid = await prisma.$transaction(async (tx) => {
      const moved = await tx.bounty.updateMany({
        where: { id: bountyId, status: "claimed", claimedByUserId: userId },
        data: { status: "completed", completedAt: new Date() },
      });
      if (moved.count !== 1) return false;
      await this.progress.addCredits(userId, bounty.rewardCredits, tx);
      return true;
    });
    if (!paid) return { ok: false, error: "Bounty already completed." };
    // `addCredits` stays silent under a transaction (it would announce
    // uncommitted state); announce the committed balance now.
    await this.progress.announceCommittedCredits(userId);

    // Everything below happens exactly once, because only the winner gets here.
    // addReputation logs its own failures (safeExecute) and emits the change.
    await getService<FactionService>(FACTION_SERVICE).addReputation(
      userId, bounty.issuedByFactionId, bounty.rewardReputation, "Bounty claimed",
    );
    const purge = await this.purgeStolenFiles(bounty, target.homeServerId);
    if (purge.filesDeleted > 0) {
      // Persisted, so a target who is offline learns of it on login — the
      // socket-only emit this replaces was simply lost for them.
      await notifyUser(this.io, bounty.targetUserId, {
        type: "security_alert",
        category: "security",
        title: "Bounty Hunter",
        message: `SECURITY BREACH: ${purge.filesDeleted} file(s) deleted from your home server by a bounty hunter.` +
          (purge.keysRevoked > 0 ? ` ${purge.keysRevoked} access key(s) revoked.` : ""),
        severity: "high",
      });
    }
    getService<MissionIntegrationService>(MISSION_INTEGRATION_SERVICE)
      .onBountyCompleted(userId, bounty.issuedByFactionId)
      .catch((err) => this.logger.warn({ err, bountyId, userId }, "Bounty mission hook failed"));

    return { ok: true, bounty, ...purge };
  }

  /**
   * Delete the files the target stole, and the access keys they granted.
   * Best effort — the bounty is already paid — but every failure is logged;
   * the code this replaces discarded them with `.catch(() => {})`.
   */
  private async purgeStolenFiles(bounty: Bounty, homeServerId: string) {
    const ids = Array.isArray(bounty.stolenFileIds)
      ? bounty.stolenFileIds.filter((x): x is string => typeof x === "string")
      : [];
    const out = { filesDeleted: 0, decoysHit: 0, keysRevoked: 0 };
    if (ids.length === 0) return out;
    const files = await prisma.fileSystemNode.findMany({
      where: { id: { in: ids }, serverId: homeServerId },
      select: { id: true, metadata: true },
    });
    const fileService = getService<FileService>(FILE_SERVICE);
    for (const file of files) {
      try {
        const r = await fileService.purgeNode(file.id);
        if (!r.deleted) continue; // the target already deleted it themselves
        out.filesDeleted++;
        out.keysRevoked += r.keysRevoked;
        if ((file.metadata as { isDecoy?: unknown } | null)?.isDecoy === true) out.decoysHit++;
      } catch (err) {
        this.logger.warn({ err, bountyId: bounty.id, fileId: file.id }, "Bounty: stolen file could not be purged");
      }
    }
    return out;
  }
}

export default BountyService;
