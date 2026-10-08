/**
 * Roles: their order, and the ONE rule for changing someone's role.
 *
 * Maintainer decision (2026-10-08): neither the terminal nor the admin panel
 * may create an admin. The two had different rules — in game an admin could
 * not grant a role at or above their own (so could not make admins), while
 * the panel let any admin grant `admin` and demote other admins. Admins are
 * now made and unmade only on the host: `npm run admin:grant|admin:revoke`.
 */
export const ROLE_HIERARCHY: Record<string, number> = {
  player: 0,
  moderator: 1,
  admin: 2,
};

export function roleLevel(role: string): number {
  return ROLE_HIERARCHY[role] ?? 0;
}

/** Why `actor` may not set `target`'s role to `newRole` — or null if they may. */
export function roleChangeRefusal(
  actor: { id: string; role: string },
  target: { id: string; role: string },
  newRole: string,
): string | null {
  if (actor.id === target.id) return "Cannot change your own role.";
  if (roleLevel(target.role) >= roleLevel(actor.role)) {
    return "Cannot change role of a user with equal or higher rank.";
  }
  if (roleLevel(newRole) >= roleLevel(actor.role)) {
    return "Cannot set a role equal to or above your own.";
  }
  return null;
}
