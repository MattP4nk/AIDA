/**
 * AccountAdminService — what happens to an account when a moderator acts on it.
 *
 * A4: these were direct `db.client` writes inside adminCommands, and the admin
 * panel's role route re-implemented one of them inline. Each write has
 * consequences beyond the row, and the copies disagreed about which ones they
 * honoured:
 *
 *   - role lives in TWO caches — the 60s auth cache (HTTP) and every live
 *     socket's `socket.data.user.role`, set at authentication and never
 *     refreshed. A demotion through either path updated neither, so a demoted
 *     admin stayed admin on their open sockets until they reconnected.
 *   - a password reset is the response to a compromised account, and it
 *     deactivated DB sessions while leaving the auth cache and every live
 *     socket working — the attacker's session carried on.
 *   - the panel's role change wrote no audit record at all.
 *
 * The mechanics live here once. PERMISSION POLICY stays with each caller —
 * the in-game command and the panel genuinely differ (in game an admin cannot
 * create another admin; the panel can), and unifying them is a decision, not
 * a refactor.
 */
import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import type { Server as SocketIOServer } from "socket.io";
import { Prisma } from "@prisma/client";
import { prisma } from "../database/client";
import { config } from "../config/environment";
import { invalidateAuthCacheForUser } from "../middleware/auth";
import { GAME_STATE_MANAGER, LOGGER, SOCKET_IO } from "../di/tokens";
import { getService } from "../di/resolve";
import type GameStateManager from "./gameStateManager";

@injectable()
export class AccountAdminService {
  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(SOCKET_IO) private io: SocketIOServer,
  ) {}

  /** Lazily: gameStateManager is heavy and resolves half the container. */
  private gsm(): GameStateManager {
    return getService<GameStateManager>(GAME_STATE_MANAGER);
  }

  /**
   * Write an audit record. Never fails the caller's action — but a failure is
   * LOGGED; the in-game helper this replaces swallowed it with `catch {}`.
   */
  async audit(
    actorId: string,
    action: string,
    resource: string,
    resourceId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: { userId: actorId, action, resource, resourceId, metadata: metadata as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.logger.warn({ err, actorId, action, resourceId }, "Audit record could not be written");
    }
  }

  /** The most recent actions an account TOOK (as actor), newest first. */
  async auditTrail(actorId: string, limit: number) {
    return prisma.auditLog.findMany({
      where: { userId: actorId },
      orderBy: { timestamp: "desc" },
      take: limit,
      select: { action: true, resource: true, timestamp: true, ipAddress: true },
    });
  }

  /** Change a role and make every cache that holds it agree, immediately. */
  async setRole(targetId: string, newRole: string): Promise<{ oldRole: string }> {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { role: true } });
    await prisma.user.update({ where: { id: targetId }, data: { role: newRole } });
    invalidateAuthCacheForUser(targetId);
    const { setSocketUserRole } = await import("../sockets/handlers");
    setSocketUserRole(this.io, targetId, newRole);
    return { oldRole: before.role };
  }

  async mute(targetId: string, until: Date): Promise<void> {
    await prisma.user.update({ where: { id: targetId }, data: { mutedUntil: until } });
  }

  async unmute(targetId: string): Promise<void> {
    await prisma.user.update({ where: { id: targetId }, data: { mutedUntil: null } });
  }

  /**
   * End every way the user is currently signed in: game session, live
   * sockets (closed server-side, so a modified client cannot ignore it), DB
   * sessions, and the auth cache.
   */
  async endAllSessions(targetId: string, reason: string): Promise<void> {
    await this.gsm().destroySession(targetId);
    this.io.to(`user:${targetId}`).emit("force:disconnect", { reason });
    const { disconnectUserSockets } = await import("../sockets/handlers");
    disconnectUserSockets(this.io, targetId);
    await prisma.userSession.updateMany({
      where: { userId: targetId, isActive: true },
      data: { isActive: false },
    });
    invalidateAuthCacheForUser(targetId);
  }

  async ban(targetId: string, reason: string): Promise<void> {
    await prisma.user.update({ where: { id: targetId }, data: { isActive: false, isOnline: false } });
    await this.endAllSessions(targetId, `Account banned: ${reason}`);
  }

  async unban(targetId: string): Promise<void> {
    await prisma.user.update({ where: { id: targetId }, data: { isActive: true } });
  }

  /**
   * Issue a temporary password and sign the account out EVERYWHERE.
   *
   * The temporary password came from Math.random(), which is not a CSPRNG;
   * crypto.randomInt is.
   */
  async resetPassword(targetId: string): Promise<string> {
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let tempPw = "";
    for (let i = 0; i < 12; i++) tempPw += chars[randomInt(chars.length)];
    // S10: the configured cost, as registration uses.
    const hashed = await bcrypt.hash(tempPw, config.BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: targetId }, data: { password: hashed } });
    await this.endAllSessions(targetId, "Your password was reset by an administrator.");
    return tempPw;
  }
}

export default AccountAdminService;
