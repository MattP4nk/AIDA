/**
 * Deploy step for decision Q5 — see utils/legacyContacts.ts.
 *
 *   npm run migrate:contacts -- --dry-run            (count only)
 *   npm run migrate:contacts                         (contacts older than now)
 *   npm run migrate:contacts -- --before <ISO date>  (a database where the
 *     request flow has already been live: only rows older than that moment)
 */
import { prisma } from "../database/client";
import { migrateLegacyContacts } from "../utils/legacyContacts";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const at = args.indexOf("--before");
  const before = at >= 0 ? new Date(args[at + 1] ?? "") : new Date();
  if (Number.isNaN(before.getTime())) {
    console.error("usage: npm run migrate:contacts -- [--dry-run] [--before <ISO date>]");
    return 2;
  }
  const r = await migrateLegacyContacts(prisma, { before, dryRun });
  console.log(dryRun
    ? `${r.legacy} legacy contact(s) created before ${before.toISOString()} would become accepted.`
    : `${r.updated} of ${r.legacy} legacy contact(s) created before ${before.toISOString()} are now accepted.`);
  return 0;
}

main()
  .then(async (code) => { await prisma.$disconnect(); process.exit(code); })
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
