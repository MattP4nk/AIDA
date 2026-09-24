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
 */
import type { Logger } from "pino";
import type { AIService } from "../services/aiService";

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
): Promise<{ verdict: "safe" | "unsafe" | "unavailable" }> {
  let aiService: AIService | null = null;
  try {
    const { getService } = await import("../di/container");
    const { AI_SERVICE } = await import("../di/tokens");
    aiService = getService<AIService>(AI_SERVICE);
  } catch (err) {
    logger.error({ err }, "S7: moderation service could not be resolved — publishing unmoderated");
    return { verdict: "unavailable" };
  }

  if (!aiService) return { verdict: "unavailable" };

  const result = await aiService.moderateForDelivery(content);

  if (result.verdict === "unsafe") {
    // Deliberately NOT wrapped in a swallowing catch. If hiding fails we must
    // know: the old `catch {}` here meant a failed hide looked identical to
    // approved content.
    await applyUnsafe(result.reason);
    logger.warn({ reason: result.reason }, "S7: content blocked by moderation");
    return { verdict: "unsafe" };
  }

  if (result.verdict === "unavailable") {
    logger.warn(
      { reason: result.reason },
      "S7: no moderation verdict — content published, re-check queued",
    );
    aiService.queueModerationRecheck(content, async (recheck) => {
      if (recheck.verdict !== "unsafe") return;
      try {
        await applyUnsafe(recheck.reason);
        logger.warn({ reason: recheck.reason }, "S7: content hidden by background re-check");
      } catch (err) {
        logger.error({ err }, "S7: re-check said unsafe but hiding it failed");
      }
    });
    return { verdict: "unavailable" };
  }

  return { verdict: "safe" };
}
