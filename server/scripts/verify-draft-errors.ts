/**
 * Admin draft review returns the right HTTP status.
 *
 * REVIEW #2 (angles A and C): delegating the reject route to
 * `contentDraftService.rejectDraft` swapped the route's typed
 * `NotFoundError`/`ValidationError` for the service's plain `new Error(...)`.
 * `formatServerError` only preserves a status for `GameError` subclasses, so
 * every ordinary admin mistake — rejecting a draft someone already handled,
 * or one that was deleted — became a **500 with the reason stripped**, logged
 * at error level as if the server had faulted.
 *
 * The fix belongs in the SERVICE rather than back in the route: `approveDraft`
 * throws the same bare errors and was already exposed to this before the
 * delegation, so putting typed errors in the route would have fixed one of two
 * paths and left the asymmetry that caused the bug.
 *
 * WRITTEN BEFORE THE FIX and confirmed red.
 *
 * SELF-CONTAINED: creates its own drafts and deletes them.
 *
 * Run: npx tsx scripts/verify-draft-errors.ts
 */
import "reflect-metadata";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Catch and return, so each case can be inspected rather than thrown. */
async function caught(fn: () => Promise<unknown>): Promise<any> {
  try { await fn(); return null; } catch (e) { return e; }
}

async function main() {
  console.log("\n=== Draft review error mapping ===");

  const { setupContainer, getService } = await import("../src/di/container");
  const TOKENS = await import("../src/di/tokens");
  const { Server: SocketIOServer } = await import("socket.io");
  const loggerMod: any = await import("../src/logger");
  setupContainer(new SocketIOServer() as any, prisma as any, (loggerMod.default ?? loggerMod) as any);

  const drafts = getService<any>(TOKENS.CONTENT_DRAFT_SERVICE);
  const { formatServerError } = await import("../src/utils/safeExecute");
  const { GameError } = await import("../../shared/types");

  const tag = `__draft_probe_${process.pid}`;
  const made: string[] = [];

  try {
    // ── A draft that does not exist ──────────────────────────────────
    console.log("\nDE-1 — a missing draft is 404, not 500");
    {
      const err = await caught(() => drafts.rejectDraft("no-such-draft-id", "admin", "because"));
      check("rejectDraft throws", err !== null);
      check(
        "and it is a GameError, so the status survives",
        err instanceof GameError,
        `${err?.constructor?.name} — formatServerError only keeps a status for GameError`,
      );
      const formatted = formatServerError(err);
      check(
        "formatServerError maps it to 404",
        formatted.statusCode === 404,
        `${formatted.statusCode} — a plain Error falls through to 500 INTERNAL_ERROR`,
      );
      check(
        "and keeps the reason rather than masking it",
        /not found/i.test(formatted.message),
        `"${formatted.message}"`,
      );
    }

    // ── A draft in the wrong state ───────────────────────────────────
    console.log("\nDE-2 — an already-handled draft is 400, not 500");
    {
      const d = await prisma.contentDraft.create({
        data: {
          type: "mission",
          title: `${tag}_draft`,
          description: "probe draft",
          source: "admin",
          status: "rejected",
          payload: {},
        },
      });
      made.push(d.id);

      const err = await caught(() => drafts.rejectDraft(d.id, "admin", "again"));
      const formatted = formatServerError(err);
      check(
        "rejecting a non-draft maps to 400",
        formatted.statusCode === 400,
        `${formatted.statusCode}`,
      );
      check(
        "and names the status the admin actually hit",
        /rejected/.test(formatted.message),
        `"${formatted.message}" — the generic 500 message told them nothing`,
      );
    }

    // ── The sibling path had the same defect ─────────────────────────
    console.log("\nDE-3 — approveDraft is fixed too, not just the delegated one");
    {
      const err = await caught(() => drafts.approveDraft("no-such-draft-id", "admin"));
      const formatted = formatServerError(err);
      check(
        "approveDraft on a missing draft is also 404",
        formatted.statusCode === 404,
        `${formatted.statusCode} — it threw bare Errors before the route ever delegated, ` +
        "so fixing only the route would have left one of two paths broken",
      );

      const d = await prisma.contentDraft.create({
        data: { type: "mission", title: `${tag}_draft`, description: "probe draft", source: "admin", status: "approved", payload: {} },
      });
      made.push(d.id);
      const err2 = await caught(() => drafts.approveDraft(d.id, "admin"));
      check(
        "and an already-approved draft is 400",
        formatServerError(err2).statusCode === 400,
        `${formatServerError(err2).statusCode}`,
      );
    }

    // ── Bound it from the other side ─────────────────────────────────
    console.log("\nDE-4 — POSITIVE CONTROL: a real rejection still succeeds");
    {
      const d = await prisma.contentDraft.create({
        data: { type: "mission", title: `${tag}_draft`, description: "probe draft", source: "admin", status: "draft", payload: {} },
      });
      made.push(d.id);
      const err = await caught(() => drafts.rejectDraft(d.id, "admin", "not good enough"));
      check(
        "rejecting a real draft does not throw",
        err === null,
        err ? String(err.message) : "ok — otherwise every check above passes because nothing works",
      );
      const after = await prisma.contentDraft.findUnique({ where: { id: d.id } });
      check("and the row is marked rejected", after?.status === "rejected", after?.status ?? "-");
      check("with the review note recorded", after?.reviewNote === "not good enough", after?.reviewNote ?? "-");
    }

    // ── The route must not re-implement any of this ──────────────────
    console.log("\nDE-5 — the route stays a thin caller");
    {
      const { readFileSync } = await import("node:fs");
      const r = readFileSync(
        new URL("../src/routes/adminApi/drafts.ts", import.meta.url).pathname,
        "utf8",
      ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      check(
        "the reject route delegates to the service",
        /draftService\.rejectDraft\(/.test(r),
        "it used to re-implement the transition inline against raw Prisma",
      );
      check(
        "and does not re-check the status itself",
        !/Cannot reject draft with status/.test(r),
        "two implementations of one transition is what let them drift",
      );
    }
  } finally {
    for (const id of made) {
      await prisma.contentDraft.delete({ where: { id } }).catch((e) => {
        console.error(`CLEANUP FAILED (draft ${id}):`, e.message);
      });
    }
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  await prisma.$disconnect();
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e);
  process.exit(1);
});
