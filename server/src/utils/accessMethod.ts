/**
 * U3: the one definition of a valid `accessMethod`.
 *
 * The set existed only as a COMMENT on `schema.prisma:228`:
 *
 *   accessMethod String @default("hackable") // "open" | "hackable" | "keycard" | "hack_or_key"
 *
 * No Prisma enum, no shared constant, no validator — so every write site was
 * free to store anything: `contentDraftService.ts` took `payload.accessMethod`
 * from a draft, and `routes/adminApi/servers.ts` took it straight off
 * `req.body` with no check beyond `name`/`ipAddress`/`type` being present.
 *
 * The read side is already fail-closed (S11, `networkTopologyService`): an
 * unrecognised method denies access. That converts a typo into an
 * *unreachable server* rather than a public one — safe, but silent, and
 * indistinguishable from a bug in the topology. Rejecting at the write is what
 * turns it into an error someone can see.
 *
 * Note the AI path is closed today only by a hardcoded literal
 * (`aiAgentTools` `create_server` passes `accessMethod: "hackable"`), not by a
 * check. Any future field pass-through reopens it, and `contentDraftService`
 * would accept whatever arrived — which is exactly why this belongs at the
 * write boundary rather than in the caller.
 */

export const ACCESS_METHODS = ["open", "hackable", "keycard", "hack_or_key"] as const;

export type AccessMethod = (typeof ACCESS_METHODS)[number];

const ACCESS_METHOD_SET: ReadonlySet<string> = new Set(ACCESS_METHODS);

export const DEFAULT_ACCESS_METHOD: AccessMethod = "hackable";

/** True when `value` is one of the four methods the access switch handles. */
export function isAccessMethod(value: unknown): value is AccessMethod {
  return typeof value === "string" && ACCESS_METHOD_SET.has(value);
}

/**
 * Coerce an untrusted value to a valid method.
 *
 * Trims and lowercases first: `"keycard "` and `"Keycard"` are obviously
 * meant, and the fail-closed read side would otherwise make such a server
 * permanently unreachable with no error anywhere. Anything still unrecognised
 * returns null so the caller can reject it explicitly rather than guess.
 */
export function normalizeAccessMethod(value: unknown): AccessMethod | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ACCESS_METHOD_SET.has(normalized) ? (normalized as AccessMethod) : null;
}

/** Human-readable list, for error messages. */
export function accessMethodList(): string {
  return ACCESS_METHODS.join(", ");
}
