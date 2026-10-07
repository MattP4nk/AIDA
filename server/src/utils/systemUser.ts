import crypto from "crypto";
import { prisma } from "../database/client";

export const SYSTEM_USERNAME = "SYSTEM";

/**
 * The id of the SYSTEM user, creating it on first use.
 *
 * It authors system mail and files automated moderation reports. This was a
 * private find-then-create in messageService; `username` is `@unique`, so two
 * concurrent first calls both missed the find and the second create threw
 * P2002. An upsert keyed on the unique field is a single statement.
 */
export async function getSystemUserId(): Promise<string> {
  const user = await prisma.user.upsert({
    where: { username: SYSTEM_USERNAME },
    update: {},
    create: {
      username: SYSTEM_USERNAME,
      email: "system@aida.internal",
      password: crypto.randomBytes(32).toString("hex"),
      homeIp: "0.0.0.0",
    },
    select: { id: true },
  });
  return user.id;
}
