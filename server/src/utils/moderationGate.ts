/**
 * S7: the single moderation gate for player-authored content.
 *
 * Three call sites (private messages, forum posts, forum replies) each had
 * their own copy of this, and all three shared the same two defects:
 *
 *   1. They ran `void (async () => { ... })()` AFTER the content was
 *      persisted, delivered over Socket.IO and broadcast. Setting `isHidden`
 *      afterwards only suppressed a later re-fetch — the recipient's client
 *      had already rendered it. Moderation that runs after delivery is not
 *      moderation, it is bookkeeping.
 *
 *   2. They tested `if (!modResult.safe)` against a boolean that was `true`
 *      for "approved" AND for every failure mode, so an AI outage read as
 *      unanimous approval.
 *
 * Policy (agreed with the maintainer):
 *
 *   safe        -> publish, do nothing
 *   unsafe      -> apply the caller's hide/notify action immediately, before
 *                  anyone sees it
 *   unavailable -> publish, and queue a background re-check. An AI outage
 *                  must not become a messaging outage; if the re-check later
 *                  says unsafe, the same hide/notify action runs then.
 *
 * The `unavailable` branch is a deliberate, documented fail-open. It is
 * narrower than what it replaces: previously *every* outcome, including an
 * explicit "unsafe", could fail open through a truthy string or a swallowed
 * throw.
 *
 * HOW FAR THAT PROMISE ACTUALLY REACHES. "The re-check later runs" is a claim
 * about a queue, and the queue can give up: it is shared with six other AI
 * callers, holds 20 entries, and expires anything older than 10 minutes. Three
 * of its four give-up paths used to be invisible — overflow evicted the oldest
 * entry regardless of kind, and the age purge dropped entries with no counter
 * and no log at all. So the honest statement of the policy is:
 *
 *   - a queued re-check is never evicted to make room for ordinary AI work
 *     (NPC mail, ambient prose); those are dropped first;
 *   - if one is abandoned anyway — queue full, too old, out of attempts,
 *     illegible answer, or the server shutting down — the content is filed
 *     in the ADMIN REVIEW QUEUE (`escalate`) as a SYSTEM report, beside player
 *     reports: `admin reports mail` for messages, `forum reports` for posts.
 *     Content judged unsafe whose hide then fails is filed the same way.
 *
 * So the policy is now: every outcome that is not a clean "safe" ends with the
 * content hidden, re-checked, or in front of a human. What is still uncovered,
 * by name: a CRASH (graceful shutdown escalates, a kill -9 cannot), and an
 * escalation whose own DB write fails — counted as
 * `moderationEscalationsFailed` on the admin health endpoint.
 */
import type { Logger } from "pino";
import type { AIService } from "../services/aiService";
import { AI_SERVICE } from "../di/tokens";

/**
 * Moderate `content` and, if it is unsafe, run `applyUnsafe` before returning.
 *
 * `applyUnsafe` is called at most once per outcome — immediately when the
 * verdict is unsafe, or later from the re-check. It is the caller's job to
 * make it idempotent (all three current callers set `isHidden: true`, which
 * is).
 */
export async function moderateBeforePublish(
  content: string,
  logger: Logger,
  applyUnsafe: (reason: string) => Promise<void>,
  /**
   * File this content for human review. REQUIRED, so no caller can opt out:
   * it is the backstop for every path where automated moderation could not
   * finish on content that is already out.
   */
  escalate: (reason: string) => Promise<void>,
): Promise<{ verdict: "safe" | "unsafe" | "unavailable" }> {
  const fileForReview = async (reason: string): Promise<void> => {
    try {
      await escalate(reason);
    } catch (err) {
      logger.error({ err, reason }, "S7: could not file content for admin review");
    }
  };

  let aiService: AIService | null = null;
  try {
    const { getService } = await import("../di/container");
    aiService = getService<AIService>(AI_SERVICE);
  } catch (err) {
    // No service means no re-check either — this used to return here with
    // nothing queued and nothing recorded: a silent, permanent fail-open.
    logger.error({ err }, "S7: moderation service could not be resolved — publishing, filed for review");
    await fileForReview("moderation service unavailable; published without any review");
    return { verdict: "unavailable" };
  }

  if (!aiService) {
    await fileForReview("moderation service unavailable; published without any review");
    return { verdict: "unavailable" };
  }

  const result = await aiService.moderateForDelivery(content);

  if (result.verdict === "unsafe") {
    // REVIEW: the failure is LOGGED LOUDLY but must not propagate.
    //
    // Letting it throw was the wrong call: `applyUnsafe` is a Prisma update,
    // and a transient error or a P2025 (row deleted concurrently) unwound out
    // of the publish path entirely — skipping mission hooks and reputation,
    // telling the caller the whole operation failed for content that WAS
    // persisted, and inviting a retry that duplicates it. Worse, the row was
    // left with `isHidden` still false: an unsafe verdict plus a failed hide
    // failed OPEN, which is the exact outcome this gate exists to prevent.
    //
    // Returning "unsafe" regardless is what matters — the caller suppresses
    // delivery either way, so the content does not reach anyone even if the
    // flag did not persist.
    try {
      await applyUnsafe(result.reason);
      logger.warn({ reason: result.reason }, "S7: content blocked by moderation");
    } catch (err) {
      logger.error(
        { err, reason: result.reason },
        "S7: content judged UNSAFE but could not be hidden — delivery still suppressed",
      );
      // Delivery is suppressed, but the ROW is unhidden: a forum post with
      // isHidden=false is still listed to anyone who opens the forum.
      await fileForReview(`judged unsafe (${result.reason}) but hiding it failed`);
    }
    return { verdict: "unsafe" };
  }

  if (result.verdict === "unavailable") {
    logger.warn(
      { reason: result.reason },
      "S7: no moderation verdict — content published, re-check queued",
    );
    aiService.queueModerationRecheck(
      content,
      async (recheck) => {
        if (recheck.verdict !== "unsafe") return;
        try {
          await applyUnsafe(recheck.reason);
          logger.warn({ reason: recheck.reason }, "S7: content hidden by background re-check");
        } catch (err) {
          logger.error({ err }, "S7: re-check said unsafe but hiding it failed");
          await fileForReview(`re-check judged unsafe (${recheck.reason}) but hiding it failed`);
        }
      },
      (why) => fileForReview(`moderation could not complete (${why}); published without review`),
    );
    return { verdict: "unavailable" };
  }

  return { verdict: "safe" };
}
