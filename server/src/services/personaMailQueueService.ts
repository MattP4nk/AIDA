/**
 * PersonaMailQueueService — deferred, in-character mail delivery.
 *
 * Two problems solved by the same mechanism:
 *
 *  1. **Immersion.** A persona that answers the instant a message arrives reads
 *     as a vending machine. People take a while to reply.
 *  2. **AI load.** Replies used to be generated INLINE and synchronously, so a
 *     burst of player messages contended for the AI service's two concurrency
 *     slots, and a player's `msg` command blocked on the model. Generation now
 *     happens when an item comes due, spreading a burst across time.
 *
 * The two reinforce each other: when the AI is saturated, the delivery time
 * *slides later* instead of the call being forced or the reply dropped. Waiting
 * longer for an answer is in-fiction plausible, so backpressure becomes
 * characterisation rather than a failure mode. That is the key idea here — the
 * queue never needs to skip work.
 */
import { injectable, inject } from "tsyringe";
import type { Logger } from "pino";
import { LOGGER, AI_SERVICE, MESSAGE_SERVICE } from "../di/tokens";
import type { AIService } from "./aiService";
import type { MessageService } from "./messageService";
import { db } from "../database/client";
import { safeExecute } from "../utils/safeExecute";

/**
 * Delay profiles, in seconds. Ranges rather than constants so two players
 * messaging at once do not get answers in lockstep.
 */
const DELAY_PROFILES: Record<string, { min: number; max: number }> = {
  // A reply to something the player wrote. Long enough to feel considered.
  reply: { min: 45, max: 210 },
  // Unprompted contact (an intrusion notice, a faction overture). Snappier —
  // an automated alarm plausibly fires fast.
  notice: { min: 15, max: 75 },
};

/** How often the worker looks for due mail. */
const TICK_MS = 15_000;
/** Items handled per tick. Caps DB and AI work per pass. */
const BATCH_SIZE = 5;

/**
 * Saturation above which generation is deferred rather than attempted.
 * 0.5 = the throttle is half full counting queued waiters.
 */
const DEFER_SATURATION = 0.5;
/** How long to slide delivery when deferring, in seconds (plus jitter). */
const DEFER_BASE_S = 60;

export interface EnqueuePersonaMailInput {
  senderId: string;
  recipientId: string;
  subject: string;
  /** Pre-rendered body. Provide this OR a prompt. */
  content?: string;
  /** Generated at delivery time when `content` is absent. */
  prompt?: string;
  systemPrompt?: string;
  personaId?: string;
  /** Delivered if generation keeps failing, so something always arrives. */
  fallback?: string;
  kind?: keyof typeof DELAY_PROFILES | string;
  /** Override the computed delay. Used by tests and by scripted story beats. */
  delaySeconds?: number;
}

@injectable()
export class PersonaMailQueueService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @inject(LOGGER) private logger: Logger,
    @inject(AI_SERVICE) private aiService: AIService,
    @inject(MESSAGE_SERVICE) private messageService: MessageService,
  ) {}

  // ==================== LIFECYCLE ====================

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    this.logger.info({ tickMs: TICK_MS }, "Persona mail queue started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("Persona mail queue stopped");
    }
  }

  // ==================== ENQUEUE ====================

  /**
   * Schedule mail for later delivery. Returns the queued row's id.
   *
   * Cheap and non-blocking: no AI call happens here even when a prompt is
   * supplied, so the caller (a player's command handler) returns immediately.
   *
   * Replies COALESCE: at most one pending reply exists per sender→recipient.
   * A second message while the first answer is still pending updates that
   * pending item rather than queueing another.
   *
   * This is both truer to life — a person answers your latest message, not each
   * of five in turn — and the bound that makes it safe for replies to sit
   * outside the scheduler's daily AI budget. Without it, a player spamming `msg`
   * could queue unlimited generations, since the flood limit only caps DELIVERY
   * and generation happens before it.
   */
  async enqueue(input: EnqueuePersonaMailInput): Promise<string | null> {
    return (await safeExecute({
      fn: async () => {
        const kind = String(input.kind ?? "reply");

        if (kind === "reply") {
          const pending = await db.client.pendingPersonaMail.findFirst({
            where: {
              status: "pending",
              kind: "reply",
              senderId: input.senderId,
              recipientId: input.recipientId,
            },
            select: { id: true, deliverAt: true },
          });

          if (pending) {
            // Refresh the content to the newest question but keep the ORIGINAL
            // deliverAt, so repeated nagging cannot push the answer further away
            // (nor pull it closer).
            await db.client.pendingPersonaMail.update({
              where: { id: pending.id },
              data: {
                subject: input.subject,
                content: input.content ?? null,
                prompt: input.prompt ?? null,
                systemPrompt: input.systemPrompt ?? null,
                fallback: input.fallback ?? null,
              },
            });
            this.logger.debug(
              { id: pending.id, recipientId: input.recipientId },
              "Persona reply coalesced into pending item",
            );
            return pending.id;
          }
        }

        const delay = input.delaySeconds ?? this.pickDelaySeconds(kind);
        const row = await db.client.pendingPersonaMail.create({
          data: {
            personaId: input.personaId ?? null,
            senderId: input.senderId,
            recipientId: input.recipientId,
            subject: input.subject,
            content: input.content ?? null,
            prompt: input.prompt ?? null,
            systemPrompt: input.systemPrompt ?? null,
            fallback: input.fallback ?? null,
            kind,
            deliverAt: new Date(Date.now() + delay * 1000),
          },
          select: { id: true },
        });
        this.logger.debug(
          { id: row.id, recipientId: input.recipientId, delaySeconds: delay, kind },
          "Persona mail queued",
        );
        return row.id;
      },
      context: "Enqueue persona mail",
      logger: this.logger,
      fallback: null,
      silent: true,
    })()) as string | null;
  }

  /** Human-plausible delay with jitter, from the kind's profile. */
  private pickDelaySeconds(kind: string): number {
    const profile = DELAY_PROFILES[kind] ?? DELAY_PROFILES.reply!;
    return Math.round(profile.min + Math.random() * (profile.max - profile.min));
  }

  // ==================== WORKER ====================

  /**
   * Deliver everything that is due. Public so tests can drive it directly
   * instead of waiting on the interval.
   */
  async tick(): Promise<{ delivered: number; deferred: number; failed: number }> {
    if (this.running) return { delivered: 0, deferred: 0, failed: 0 };
    this.running = true;
    const stats = { delivered: 0, deferred: 0, failed: 0 };

    try {
      const due = await db.client.pendingPersonaMail.findMany({
        where: { status: "pending", deliverAt: { lte: new Date() } },
        orderBy: { deliverAt: "asc" },
        take: BATCH_SIZE,
      });
      if (due.length === 0) return stats;

      for (const item of due) {
        const needsGeneration = !item.content && !!item.prompt;

        // Defer rather than pile onto a busy model. An answer that takes a few
        // more minutes is indistinguishable from a character being busy.
        if (needsGeneration && this.shouldDefer()) {
          const slide = DEFER_BASE_S + Math.round(Math.random() * DEFER_BASE_S);
          await db.client.pendingPersonaMail.update({
            where: { id: item.id },
            data: { deliverAt: new Date(Date.now() + slide * 1000) },
          });
          stats.deferred++;
          this.logger.debug(
            { id: item.id, slideSeconds: slide, saturation: this.aiService.getLoad().saturation },
            "Persona mail deferred — AI busy",
          );
          continue;
        }

        const outcome = await this.deliver(item);
        if (outcome === "delivered") stats.delivered++;
        else if (outcome === "deferred") stats.deferred++;
        else stats.failed++;
      }

      if (stats.delivered || stats.deferred || stats.failed) {
        this.logger.info(stats, "Persona mail queue tick");
      }
      return stats;
    } catch (err) {
      this.logger.error({ err }, "Persona mail queue tick failed");
      return stats;
    } finally {
      this.running = false;
    }
  }

  private shouldDefer(): boolean {
    try {
      return this.aiService.getLoad().saturation >= DEFER_SATURATION;
    } catch {
      return false;
    }
  }

  /** Resolve the body, send it, and record the result. */
  private async deliver(item: {
    id: string;
    senderId: string;
    recipientId: string;
    subject: string;
    content: string | null;
    prompt: string | null;
    systemPrompt: string | null;
    fallback: string | null;
    attempts: number;
    maxAttempts: number;
  }): Promise<"delivered" | "deferred" | "failed"> {
    let body = item.content ?? "";
    let usedFallback = false;

    if (!body && item.prompt) {
      try {
        const result = await this.aiService.generateOrThrow(
          item.prompt,
          item.systemPrompt ?? undefined,
        );
        body = (result?.response ?? "").trim();
      } catch (err) {
        const attempts = item.attempts + 1;

        // Keep trying on a later tick. Only once the budget is spent does the
        // fallback go out — and it goes out, so the player is never left
        // waiting on a reply that never comes.
        if (attempts < item.maxAttempts) {
          const slide = DEFER_BASE_S * attempts;
          await db.client.pendingPersonaMail.update({
            where: { id: item.id },
            data: {
              attempts,
              deliverAt: new Date(Date.now() + slide * 1000),
              error: err instanceof Error ? err.message : String(err),
            },
          });
          this.logger.debug({ id: item.id, attempts, slideSeconds: slide }, "Persona mail generation failed — retrying later");
          return "deferred";
        }

        if (!item.fallback) {
          await db.client.pendingPersonaMail.update({
            where: { id: item.id },
            data: { status: "failed", attempts, error: "generation failed, no fallback" },
          });
          this.logger.warn({ id: item.id }, "Persona mail failed with no fallback");
          return "failed";
        }
        body = item.fallback;
        usedFallback = true;
      }
    }

    if (!body) {
      body = item.fallback ?? "";
      usedFallback = !!item.fallback;
    }
    if (!body) {
      await db.client.pendingPersonaMail.update({
        where: { id: item.id },
        data: { status: "failed", error: "empty body" },
      });
      return "failed";
    }

    const sent = await this.messageService.sendPrivateMessage(item.senderId, item.recipientId, {
      subject: item.subject,
      content: body,
      messageType: "faction",
    });

    if (!sent.success) {
      await db.client.pendingPersonaMail.update({
        where: { id: item.id },
        data: { status: "failed", error: sent.message },
      });
      this.logger.warn({ id: item.id, reason: sent.message }, "Persona mail send failed");
      return "failed";
    }

    await db.client.pendingPersonaMail.update({
      where: { id: item.id },
      data: { status: "sent", sentAt: new Date() },
    });
    this.logger.info(
      { id: item.id, recipientId: item.recipientId, usedFallback },
      usedFallback ? "Persona mail delivered (fallback body)" : "Persona mail delivered",
    );
    return "delivered";
  }

  /** Queue depth, for diagnostics and admin. */
  async getStats(): Promise<{ pending: number; due: number; sent: number; failed: number }> {
    const [pending, due, sent, failed] = await Promise.all([
      db.client.pendingPersonaMail.count({ where: { status: "pending" } }),
      db.client.pendingPersonaMail.count({
        where: { status: "pending", deliverAt: { lte: new Date() } },
      }),
      db.client.pendingPersonaMail.count({ where: { status: "sent" } }),
      db.client.pendingPersonaMail.count({ where: { status: "failed" } }),
    ]);
    return { pending, due, sent, failed };
  }
}

export default PersonaMailQueueService;
