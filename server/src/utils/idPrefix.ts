/**
 * Resolve an id the way the game DISPLAYS it.
 *
 * Listings shorten cuids (25 chars) to a prefix — `bounties` and `story`
 * print 16, `admin reports` 8 — while the commands that consume them did a
 * `findUnique` on the full id. So the id a player was shown could never be
 * found: no bounty was ever claimable, no story arc could be opened or
 * abandoned, no mail report resolved from the listing. One rule, used by all
 * of them: the exact id, else a prefix of at least MIN_ID_PREFIX characters
 * that matches exactly one row.
 */
export const MIN_ID_PREFIX = 8;

export type IdResolution<T> = { ok: true; row: T } | { ok: false; reason: "not_found" | "ambiguous" };

export async function resolveIdOrPrefix<T>(
  input: string,
  exact: (id: string) => Promise<T | null>,
  /** Rows whose id starts with the prefix — at most 2 are needed. */
  byPrefix: (prefix: string) => Promise<T[]>,
): Promise<IdResolution<T>> {
  const hit = await exact(input);
  if (hit) return { ok: true, row: hit };
  if (input.length < MIN_ID_PREFIX) return { ok: false, reason: "not_found" };
  const rows = await byPrefix(input);
  if (rows.length === 1 && rows[0] !== undefined) return { ok: true, row: rows[0] };
  return { ok: false, reason: rows.length > 1 ? "ambiguous" : "not_found" };
}
