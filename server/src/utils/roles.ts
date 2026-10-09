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

/**
 * The roles a person can be given. `npc` is not one: NPC accounts are the
 * game's own (npcOwnership, seed), and their role is how the game recognises
 * them — npcReactionService treats a server whose owner has role "npc" as
 * NPC-owned. The panel accepted `npc` both ways (review 2026-10-09): an admin
 * could make an NPC a moderator, or a player an NPC.
 */
export const ASSIGNABLE_ROLES: readonly string[] = ["player", "moderator", "admin"];

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
  if (!ASSIGNABLE_ROLES.includes(newRole)) return `Invalid role. Must be one of: ${ASSIGNABLE_ROLES.join(", ")}.`;
  if (target.role === "npc") return "NPC accounts belong to the game; their role cannot be changed.";
  if (roleLevel(target.role) >= roleLevel(actor.role)) {
    return "Cannot change role of a user with equal or higher rank.";
  }
  if (roleLevel(newRole) >= roleLevel(actor.role)) {
    return "Cannot set a role equal to or above your own.";
  }
  return null;
}
