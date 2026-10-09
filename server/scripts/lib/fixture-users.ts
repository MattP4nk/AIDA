/**
 * Every account a harness registers is deleted when it finishes — home and all.
 *
 * Registering through the API is the realistic way to make a fixture player
 * (it builds the home, filesystem and progress the game expects), but 26
 * harnesses registered accounts and never deleted them: every `npm run verify`
 * left dozens of users, each holding a home server, an IP and a filesystem
 * (review 2026-10-09).
 *
 * Importing this module wraps the global `fetch`: a successful POST to
 * `/api/auth/register` records the new user's id. The harness then calls
 * `deleteRegisteredUsers(prisma)` in its `finally` — by id, through
 * deleteFixtureUsers, so homes go too. Pinned by
 * scripts/verify-fixture-user-cleanup.ts.
 */
import type { PrismaClient } from "@prisma/client";
import { deleteFixtureUsers } from "./delete-fixture-user";

const registered: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const res = await realFetch(input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (res.ok && /\/api\/auth\/register$/.test(url)) {
    const body = (await res.clone().json().catch(() => null)) as { user?: { id?: unknown } } | null;
    if (typeof body?.user?.id === "string") registered.push(body.user.id);
  }
  return res;
};

/**
 * Record an account made WITHOUT the HTTP route — `AuthService.register`
 * called in-process — so `deleteRegisteredUsers` removes it too.
 */
export function trackFixtureUser(id: string): string {
  registered.push(id);
  return id;
}

/** The ids registered so far (and not yet deleted). */
export function registeredUserIds(): readonly string[] {
  return registered;
}

/** Delete every account registered so far, with its home. */
export async function deleteRegisteredUsers(prisma: PrismaClient): Promise<void> {
  await deleteFixtureUsers(prisma, registered.splice(0));
}
