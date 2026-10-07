/**
 * UserRepository — how game code looks a player up.
 *
 * A4: command modules held ~30 direct `user.findUnique/findFirst` calls, and
 * they disagreed on the one rule that matters for a lookup BY NAME: some
 * matched a username exactly (every admin command, `contact`), others
 * case-insensitively with `findFirst` (`fragment give`, `tap`, `alias`). The
 * column is a case-sensitive @unique and registration checked it exactly, so
 * "Bob" and "bob" could both exist — and a case-insensitive `findFirst` would
 * then pick one of them arbitrarily: `fragment give bob` could hand a fragment
 * to Bob. Registration now refuses a case-insensitive duplicate
 * (authService), which is what makes the single rule here — case-insensitive
 * — unambiguous.
 *
 * Every read returns the same fixed field set, which never includes the
 * password hash.
 */
import { injectable, inject } from "tsyringe";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../di/tokens";

const USER_FIELDS = {
  id: true,
  username: true,
  email: true,
  role: true,
  isActive: true,
  isOnline: true,
  homeServerId: true,
  homeIp: true,
  mutedUntil: true,
  createdAt: true,
  lastLogin: true,
} as const;

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  isOnline: boolean;
  homeServerId: string | null;
  homeIp: string;
  mutedUntil: Date | null;
  createdAt: Date;
  lastLogin: Date;
}

@injectable()
export class UserRepository {
  constructor(@inject(PRISMA_CLIENT) private prisma: PrismaClient) {}

  async findById(id: string): Promise<UserRecord | null> {
    return this.prisma.user.findUnique({ where: { id }, select: USER_FIELDS });
  }

  /** Case-insensitive; unambiguous because registration enforces it. */
  async findByUsername(username: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: USER_FIELDS,
    });
  }

  async findManyByIds(ids: string[]): Promise<UserRecord[]> {
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({ where: { id: { in: ids } }, select: USER_FIELDS });
  }

  async usernameOf(id: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id }, select: { username: true } });
    return u?.username ?? null;
  }

  /**
   * The player's home directory path. The fallback "user" is what every
   * command used when the row was missing; kept so no path changes shape.
   */
  async homeDirectory(id: string): Promise<string> {
    return `/home/${(await this.usernameOf(id)) || "user"}`;
  }

  async counts(): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: true } }),
    ]);
    return { total, active };
  }
}

export default UserRepository;
