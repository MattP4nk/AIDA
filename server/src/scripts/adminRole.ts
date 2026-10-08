/**
 * Grant or revoke the admin role — on the HOST, the only place it can be done.
 *
 * Maintainer decision (2026-10-08): neither the in-game terminal nor the admin
 * panel may create or unmake an admin (utils/roles.ts). This is the
 * deploy-time path:
 *
 *   npm run admin:grant -- <username>
 *   npm run admin:revoke -- <username>      (back to "player")
 *
 * It needs DB access only. It does not need to reach the running server's
 * caches: `requireRole` and the `admin` command both re-read the role from the
 * database, so a grant or revoke applies on the next privileged request.
 * Every change is written to the audit log.
 */
import { prisma } from "../database/client";
import { userInfo } from "node:os";

async function main(): Promise<number> {
  const [action, username] = process.argv.slice(2);
  if ((action !== "grant" && action !== "revoke") || !username) {
    console.error("usage: npm run admin:grant -- <username>  |  npm run admin:revoke -- <username>");
    return 2;
  }
  const user = await prisma.user.findFirst({
    where: { username: { equals: username, mode: "insensitive" } },
    select: { id: true, username: true, role: true },
  });
  if (!user) {
    console.error(`No such user: ${username}`);
    return 1;
  }
  const newRole = action === "grant" ? "admin" : "player";
  if (action === "revoke" && user.role !== "admin") {
    console.error(`${user.username} is not an admin (role: ${user.role}); nothing revoked.`);
    return 1;
  }
  if (user.role === newRole) {
    console.log(`${user.username} is already ${newRole}.`);
    return 0;
  }
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { role: newRole } }),
    prisma.auditLog.create({
      data: {
        userId: null,
        action: action === "grant" ? "admin_grant" : "admin_revoke",
        resource: "user",
        resourceId: user.id,
        metadata: { target: user.username, oldRole: user.role, newRole, via: "host-cli", hostUser: userInfo().username },
      },
    }),
  ]);
  console.log(`${user.username}: ${user.role} -> ${newRole}`);
  return 0;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
