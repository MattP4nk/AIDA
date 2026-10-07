import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import type { CacheService } from "./cacheService";
import { LOGGER, CACHE_SERVICE } from "../di/tokens";
import crypto from "crypto";
import { safeExecute } from "../utils/safeExecute";

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  options?: Record<string, any>;
}

interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/** A failed AI request queued for retry. */
interface QueuedRequest {
  id: string;
  prompt: string;
  systemPrompt?: string | undefined;
  expectedFormat?: string | undefined;
  onSuccess: (response: string) => void | Promise<void>;
  attempts: number;
  createdAt: number;
  /**
   * Dropping this entry has a SAFETY consequence, not a cosmetic one.
   *
   * Only moderation re-checks set it. Every other queue user — NPC mail,
   * ambient content, discovery text — loses flavour when evicted; a dropped
   * moderation re-check leaves player content published and never reviewed,
   * silently breaking the promise `moderationGate` makes when it fails open.
   */
  critical?: boolean;
}

/**
 * S7: the outcome of a moderation attempt.
 *
 * `unavailable` is deliberately NOT a boolean. The old signature returned
 * `{ safe: true, reason: "Moderation service unavailable" }` for every
 * failure, so an outage was indistinguishable from an approval at the call
 * site — and all three callers treated it as approval.
 */
export type ModerationResult =
  | { verdict: "safe"; reason?: undefined }
  | { verdict: "unsafe"; reason: string }
  | { verdict: "unavailable"; reason: string };

/**
 * Read a model's `safe` field. Returns null when it cannot be read.
 *
 * Small models routinely answer with the STRING "false" rather than the
 * boolean, which the old `as boolean` cast made truthy — the single most
 * consequential bug in this file, because it published exactly the content
 * the moderator had just flagged. Strings are normalised explicitly; anything
 * unrecognised returns null so the caller treats it as "no verdict" rather
 * than guessing.
 */
export function readModerationVerdict(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "yes" || s === "safe") return true;
    if (s === "false" || s === "no" || s === "unsafe") return false;
  }
  return null;
}

@injectable()
export class AIService {
  private apiUrl: string;
  private defaultModel: string;
  private apiKey: string | undefined;
  private isCloudMode: boolean;
  private requestTimeout: number;
  private logger: Logger;
  private cacheService: CacheService;
  private metrics = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    retryQueueSize: 0,
    retryQueueDropped: 0,
    retrySuccesses: 0,
    /** R14c: how many times a caller had to serve static fallback content. */
    fallbacksServed: 0,
    /**
     * S7: queued moderation re-checks that were given up on.
     *
     * Each one is a piece of player content that was published without a
     * verdict and will now never get one. A log line alone was not enough —
     * the age purge below used to discard these with no counter and no
     * message at all.
     */
    moderationRechecksAbandoned: 0,
  };

  /** R14c: when a fallback was last served, and for what. */
  private lastFallback: { at: string; context: string } | null = null;

  /**
   * S7: single place where a queued request is given up on.
   *
   * There are four ways out of this queue that are not success — overflow
   * eviction, the age purge, max attempts, and max attempts after a throw —
   * and a moderation re-check taking any of them means player content stays
   * published and unreviewed forever. Routing them all through here is what
   * makes that one fact countable instead of four separate log lines, one of
   * which did not exist.
   */
  private abandon(req: QueuedRequest, reason: string): void {
    this.metrics.retryQueueDropped++;
    if (req.critical) {
      this.metrics.moderationRechecksAbandoned++;
      this.logger.error(
        { id: req.id, attempts: req.attempts, reason },
        "S7: moderation re-check abandoned — that content stays published unreviewed",
      );
    } else {
      this.logger.warn({ id: req.id, attempts: req.attempts, reason }, "Retry queue: request dropped");
    }
  }

  /** Queue of failed requests to retry later. */
  private retryQueue: QueuedRequest[] = [];
  private readonly RETRY_QUEUE_MAX = 20;
  private readonly RETRY_QUEUE_INTERVAL_MS = 30_000; // Process queue every 30s
  private readonly RETRY_MAX_ATTEMPTS = 3;
  private readonly RETRY_MAX_AGE_MS = 10 * 60 * 1000; // Drop requests older than 10 min
  /** Shortest attempt worth starting — below this, fail rather than half-try. */
  private readonly MIN_ATTEMPT_MS = 5_000;
  /** S7: hard bound on moderation when it sits on a delivery path. */
  private readonly MODERATION_DELIVERY_TIMEOUT_MS = 10_000;
  /** Health probes are liveness checks, not generation — keep them short. */
  private readonly HEALTH_PROBE_TIMEOUT_MS = 3_000;
  /** R14: guards processRetryQueue against overlapping interval ticks. */
  private retryQueueProcessing = false;
  private retryTimer: NodeJS.Timeout | null = null;

  /** Concurrency throttle — prevents flooding the API with parallel requests. */
  private activeRequests = 0;
  private readonly MAX_CONCURRENT_REQUESTS = 2;
  private readonly MAX_QUEUE_DEPTH = 30;
  private readonly SLOT_TIMEOUT_MS = 120_000; // 120s — cloud 120B model can be slow on complex prompts
  private requestQueue: Array<{ resolve: () => void }> = [];

  constructor(
    @inject(LOGGER) logger: Logger,
    @inject(CACHE_SERVICE) cacheService: CacheService,
  ) {
    this.logger = logger;
    this.cacheService = cacheService;

    // New env vars take precedence over legacy ones
    this.apiUrl =
      process.env.AI_API_URL ||
      process.env.OLLAMA_API_URL ||
      "http://localhost:11434";
    this.defaultModel =
      process.env.AI_MODEL || process.env.OLLAMA_MODEL || "llama3.1:8b";
    this.apiKey =
      process.env.AI_API_KEY || process.env.OLLAMA_API_KEY || undefined;

    // Cloud mode is active when an API key is present
    this.isCloudMode = !!this.apiKey;

    // 120s for both: cloud 120B model needs time for complex prompts, local CPU is slow
    this.requestTimeout = 120000;

    this.logger.info(
      {
        apiUrl: this.apiUrl,
        model: this.defaultModel,
        cloudMode: this.isCloudMode,
      },
      `AIService initialized (${this.isCloudMode ? "cloud" : "local"} mode)`,
    );

    // Start retry queue processor
    this.retryTimer = setInterval(() => this.processRetryQueue(), this.RETRY_QUEUE_INTERVAL_MS);
    (this.retryTimer as NodeJS.Timeout & { unref?: () => void }).unref?.();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return headers;
  }

  private getCacheKey(prompt: string, systemPrompt?: string): string {
    const data = `${prompt}|${systemPrompt || ""}|${this.defaultModel}`;
    return `ai:${crypto.createHash("md5").update(data).digest("hex")}`;
  }

  /**
   * Current pressure on the concurrency throttle, 0 (idle) to 1+ (saturated).
   *
   * Exposed so callers with a *deferrable* workload can back off instead of
   * queueing behind a full throttle and timing out. `personaMailQueueService`
   * uses it to slide a reply's delivery time later — an NPC taking longer to
   * answer reads as them being busy, which is strictly better than either
   * blocking on a slot or dropping the reply.
   */
  public getLoad(): { activeRequests: number; queueDepth: number; saturation: number } {
    const capacity = this.MAX_CONCURRENT_REQUESTS + this.MAX_QUEUE_DEPTH;
    return {
      activeRequests: this.activeRequests,
      queueDepth: this.requestQueue.length,
      saturation: (this.activeRequests + this.requestQueue.length) / capacity,
    };
  }

  /** Acquire a slot in the concurrency throttle. */
  private async acquireSlot(): Promise<void> {
    if (this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
      this.activeRequests++;
      return;
    }
    if (this.requestQueue.length >= this.MAX_QUEUE_DEPTH) {
      throw new Error("AI service queue full — try again later");
    }
    // Wait for a slot to free up (with timeout)
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.requestQueue.findIndex(q => q.resolve === wrappedResolve);
        if (idx >= 0) this.requestQueue.splice(idx, 1);
        reject(new Error("AI service request timed out waiting for slot"));
      }, this.SLOT_TIMEOUT_MS);

      const wrappedResolve = () => {
        clearTimeout(timer);
        resolve();
      };

      this.requestQueue.push({ resolve: wrappedResolve });
    });
  }

  /** Release a slot in the concurrency throttle. */
  private releaseSlot(): void {
    this.activeRequests--;
    if (this.requestQueue.length > 0) {
      const next = this.requestQueue.shift()!;
      this.activeRequests++;
      next.resolve();
    }
  }

  /**
   * R14: the retry chain is bounded by a DEADLINE, not just an attempt count.
   *
   * This runs INSIDE an acquired slot (see generateResponse), so however long
   * it takes is how long a slot is held. It used to be able to run
   * 3 x requestTimeout(120s) + 5s + 15s = 380s, while `SLOT_TIMEOUT_MS` — how
   * long a WAITER will wait for a slot — was 120s. A holder could therefore
   * occupy a slot for three times longer than anyone would wait for it, so
   * with MAX_CONCURRENT_REQUESTS = 2 a 30-deep queue drained into timeouts
   * instead of being served.
   *
   * Tuning two constants to agree would have drifted apart again at the next
   * model change. Instead the budget IS the slot timeout: attempts stop when
   * the remaining budget cannot cover a backoff plus a meaningful attempt, and
   * each attempt's own timeout is clamped to what is left. The worst-case hold
   * is now SLOT_TIMEOUT_MS by construction.
   */
  private async retryOperation<T>(
    operation: (attemptTimeoutMs: number) => Promise<T>,
    maxRetries: number = 3,
    budgetMs: number = this.SLOT_TIMEOUT_MS,
  ): Promise<T> {
    const deadline = Date.now() + budgetMs;
    let lastError: unknown;

    for (let i = 0; i < maxRetries; i++) {
      const remaining = deadline - Date.now();
      // Too little left to be worth ANOTHER attempt — stop rather than start
      // one we would have to abandon mid-flight.
      //
      // The first attempt is exempt. Gating it on the budget too meant that a
      // budget smaller than MIN_ATTEMPT_MS produced ZERO attempts and a
      // synthetic error — the call silently became a no-op that had never
      // touched the API. Whatever the budget, we try once; only retries have
      // to justify themselves against the remaining time.
      //
      // REVIEW — THE DELIBERATE TRADE, stated because it was previously only
      // implicit: `requestTimeout` and `SLOT_TIMEOUT_MS` are both 120s, so an
      // attempt that runs to a FULL TIMEOUT consumes the entire budget and no
      // retry follows. Retry-on-timeout is therefore gone; retry-on-fast-error
      // (connection refused, HTTP 429) is intact, because those leave budget.
      //
      // That is the right trade rather than an oversight. Retrying a 120s
      // timeout inside a 120s hold is arithmetically impossible, and doing it
      // anyway is exactly what starved the queue before R14a: a holder sat on
      // one of two slots for 380s while every waiter gave up at 120s. A timed
      // out generation still recovers — just not inline — via the caller's
      // fallback plus `queueForRetry`. The alternative (shortening
      // `requestTimeout` so two attempts fit) would fail the legitimately slow
      // cloud generations those 120s were chosen for.
      if (i > 0 && remaining < this.MIN_ATTEMPT_MS) {
        this.logger.warn(
          { attempt: i + 1, remaining, budgetMs },
          "AI retry skipped — the slot budget cannot fund another attempt",
        );
        throw lastError ?? new Error("AI retry budget exhausted");
      }

      try {
        return await operation(Math.min(this.requestTimeout, remaining));
      } catch (error) {
        lastError = error;
        const isRateLimit = error instanceof Error && error.message.includes("Too Many Requests");
        if (i === maxRetries - 1) throw error;

        const delay = isRateLimit
          ? 5000 * Math.pow(3, i)
          : 1000 * Math.pow(2, i);

        // Only sleep if the budget can still fund the sleep AND an attempt
        // after it. Otherwise the sleep would burn the slot for nothing.
        if (Date.now() + delay + this.MIN_ATTEMPT_MS > deadline) {
          this.logger.warn(
            { attempt: i + 1, isRateLimit },
            "AI retry budget exhausted — not sleeping for a retry that cannot finish",
          );
          throw error;
        }

        this.logger.warn({ attempt: i + 1, delay, isRateLimit }, "Retrying AI request");
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError ?? new Error("Max retries exceeded");
  }

  /**
   * Generate an AI response.
   * @param prompt - The user prompt
   * @param systemPrompt - Optional system prompt
   * @param expectedFormat - Optional JSON format hint appended to prompt (improves structured output accuracy)
   */
  public async generateResponse(
    prompt: string,
    systemPrompt?: string,
    expectedFormat?: string,
  ): Promise<{ success: boolean; response: string; error?: string }> {
    this.metrics.totalRequests++;

    // Append format instruction to prompt if provided
    const fullPrompt = expectedFormat
      ? `${prompt}\n\nRespond ONLY with valid JSON in this exact format:\n${expectedFormat}`
      : prompt;

    const cacheKey = this.getCacheKey(fullPrompt, systemPrompt);
    const cached = this.cacheService.get<{
      success: boolean;
      response: string;
    }>(cacheKey);
    if (cached) {
      this.metrics.cacheHits++;
      this.logger.debug({ cacheKey }, "AI cache hit");
      return cached;
    }

    // Throttle concurrent requests to avoid rate limiting
    await this.acquireSlot();
    try {
      const result = await this.retryOperation(async (attemptTimeoutMs) => {
        const messages: OllamaChatMessage[] = [];

        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        }

        messages.push({ role: "user", content: fullPrompt });

        const request: OllamaChatRequest = {
          model: this.defaultModel,
          messages,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          },
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);

        try {
          const response = await fetch(`${this.apiUrl}/api/chat`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(request),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
          }

          const data = (await response.json()) as OllamaChatResponse;

          if (
            !data.message ||
            !data.message.content ||
            typeof data.message.content !== "string"
          ) {
            throw new Error("Invalid response from Ollama");
          }

          return {
            response: data.message.content,
          };
        } finally {
          clearTimeout(timeout);
        }
      });

      this.metrics.successfulRequests++;

      const successResult = { success: true as const, ...result };

      // Cache all responses (including those with context)
      this.cacheService.set(cacheKey, successResult, 300);

      return successResult;
    } catch (error) {
      this.metrics.failedRequests++;
      const errMsg = error instanceof Error ? error.message : "Unknown AI error";
      this.logger.error({ err: error }, "Error generating AI response");
      return {
        success: false,
        response: "",
        error: errMsg,
      };
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Like generateResponse, but throws on failure instead of returning success=false.
   * Designed for use with safeExecute/safeAI — lets the error handler catch and log.
   */
  public async generateOrThrow(
    prompt: string,
    systemPrompt?: string,
    expectedFormat?: string,
  ): Promise<{ response: string }> {
    const result = await this.generateResponse(prompt, systemPrompt, expectedFormat);
    if (!result.success) {
      throw new Error(result.error || "AI generation failed");
    }
    return { response: result.response };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Retry Queue — failed requests are retried later
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Queue a failed AI request for background retry.
   * When the retry succeeds, `onSuccess` is called with the response text.
   * Callers should use their smart fallback immediately and let the queue
   * handle eventual consistency (e.g., updating a message, adding a file).
   *
   * @param expectedFormat - JSON format hint appended to the prompt on retry
   *   e.g. '{ "title": "string", "description": "string" }'
   *   This helps the AI produce valid output on the second attempt.
   */
  public queueForRetry(
    prompt: string,
    systemPrompt: string | undefined,
    onSuccess: (response: string) => void | Promise<void>,
    expectedFormat?: string,
    critical = false,
  ): void {
    // R14: dropping the oldest entry used to drop the IN-FLIGHT one.
    //
    // processRetryQueue read `retryQueue[0]` and left it in place across a
    // long await, so the "oldest entry" this shift() discarded was usually
    // the request currently being generated — and when that generation
    // finished it removed index 0 again, silently discarding a DIFFERENT,
    // untried request. Requests vanished without ever running.
    //
    // The in-flight request is now removed from the array while it runs (see
    // processRetryQueue), so it cannot be the victim here and the eviction
    // below only ever drops a genuinely queued, untried entry.
    if (this.retryQueue.length >= this.RETRY_QUEUE_MAX) {
      // EVICT A NON-CRITICAL ENTRY FIRST.
      //
      // This queue is shared by seven callers, and plain FIFO meant a burst of
      // NPC mail or ambient content generation could evict a queued moderation
      // re-check. The failure modes are CORRELATED, which is what makes it
      // sharp: `unavailable` only happens during an AI outage, and an AI
      // outage is exactly when the retry queue fills with everything else that
      // just failed. So the one entry whose loss means unreviewed player
      // content stays published forever is the one most likely to be evicted,
      // precisely when it matters.
      const victim = this.retryQueue.findIndex((r) => !r.critical);
      const dropped =
        victim >= 0 ? this.retryQueue.splice(victim, 1)[0] : this.retryQueue.shift();
      if (dropped) this.abandon(dropped, "queue full");
    }

    const id = `retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.retryQueue.push({
      id,
      prompt,
      systemPrompt,
      expectedFormat,
      onSuccess,
      attempts: 0,
      createdAt: Date.now(),
      ...(critical ? { critical: true } : {}),
    });

    this.metrics.retryQueueSize = this.retryQueue.length;
    this.logger.debug({ queueSize: this.retryQueue.length, id }, "AI request queued for retry");
  }

  /**
   * Process the retry queue — attempts one request per cycle.
   * Runs every RETRY_QUEUE_INTERVAL_MS (30s).
   */
  private async processRetryQueue(): Promise<void> {
    // R14: REENTRANCY GUARD.
    //
    // This is driven by `setInterval(..., 30_000)` and never awaited, while
    // the generateResponse below can hold for up to SLOT_TIMEOUT_MS. Ticks
    // therefore overlapped as a matter of course, not as a rare race: several
    // of them read the same `retryQueue[0]`, each fired that request's
    // `onSuccess` (duplicate NPC mail, duplicate generated content), and each
    // then shift()ed a different entry off the front — so for every duplicate
    // delivery another queued request disappeared untried.
    if (this.retryQueueProcessing) {
      this.logger.debug("Retry queue tick skipped — previous tick still running");
      return;
    }
    this.retryQueueProcessing = true;
    try {
      await this.processRetryQueueOnce();
    } finally {
      this.retryQueueProcessing = false;
    }
  }

  private async processRetryQueueOnce(): Promise<void> {
    if (this.retryQueue.length === 0) return;

    // Purge expired entries
    const now = Date.now();
    const fresh: QueuedRequest[] = [];
    for (const req of this.retryQueue) {
      if (now - req.createdAt < this.RETRY_MAX_AGE_MS) fresh.push(req);
      else this.abandon(req, "exceeded max age");
    }
    this.retryQueue = fresh;

    if (this.retryQueue.length === 0) return;

    // TAKE the request out of the queue for the duration of the attempt.
    //
    // Removal used to be positional — `shift()` after the await — which is
    // only correct if the array did not change while we were awaiting. It
    // did: the purge above reassigns it wholesale, and queueForRetry drops
    // the head on overflow. Holding the entry itself, rather than an index
    // into a mutating array, is what makes the removal correct.
    const req = this.retryQueue.shift()!;
    req.attempts++;

    // On retry, strengthen the format instruction
    const retryFormat = req.expectedFormat
      ? `IMPORTANT: Your previous response was invalid. ${req.expectedFormat}`
      : (req.attempts > 1 ? "Respond ONLY with valid JSON. No markdown, no explanation." : undefined);

    try {
      const result = await this.generateResponse(req.prompt, req.systemPrompt, retryFormat);

      if (result.success) {
        // Already removed above — nothing to shift.
        this.metrics.retrySuccesses++;
        this.metrics.retryQueueSize = this.retryQueue.length;

        this.logger.info({ id: req.id, attempts: req.attempts }, "Retry queue: AI request succeeded");

        try {
          await req.onSuccess(result.response);
        } catch (cbErr) {
          this.logger.warn({ err: cbErr, id: req.id }, "Retry queue: onSuccess callback failed");
        }
      } else if (req.attempts >= this.RETRY_MAX_ATTEMPTS) {
        // Max attempts reached — leave it removed.
        this.abandon(req, "max attempts");
        this.metrics.retryQueueSize = this.retryQueue.length;
      } else {
        // Not done — put it BACK at the front so it keeps its place in line.
        this.retryQueue.unshift(req);
        this.metrics.retryQueueSize = this.retryQueue.length;
      }
    } catch (err) {
      if (req.attempts >= this.RETRY_MAX_ATTEMPTS) {
        this.abandon(req, "max attempts after error");
      } else {
        this.retryQueue.unshift(req);
      }
      this.metrics.retryQueueSize = this.retryQueue.length;
      this.logger.debug({ err, id: req.id }, "Retry queue: attempt failed");
    }
  }

  /** Get retry queue stats. */
  public getRetryQueueStats(): { size: number; successes: number } {
    return {
      size: this.retryQueue.length,
      successes: this.metrics.retrySuccesses,
    };
  }

  /** Stop the retry queue processor. */
  public stopRetryQueue(): void {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * AI-powered content moderation.
   *
   * S7. Returns a THREE-STATE verdict, because the old boolean conflated two
   * completely different situations — "the moderator judged this safe" and
   * "the moderator never ran" — and every caller read the second as the first.
   *
   * What was wrong, all four verified against source:
   *
   *  (a) `content` went in as the raw user prompt, so the text being judged
   *      was itself an injection vector into its own judge. (The "filtered"
   *      string callers pass is `censorshipService` word replacement — not
   *      prompt sanitization.)
   *  (b) `parsed.safe as boolean` is a COMPILE-TIME cast with no runtime
   *      check, and callers tested truthiness (`if (!modResult.safe)`). A
   *      model emitting the *string* `"false"` — which small models do
   *      constantly — is truthy, so flagged content PUBLISHED.
   *  (c) Four separate fail-open returns. The only fail-closed path was
   *      accidental: a missing `safe` key is `undefined`, which is falsy.
   *  (d) Ordering — see the call sites.
   *
   * The distinction that fixes (b) and (c) together: a verdict is only
   * honoured when it is actually legible. Anything else is `unavailable`,
   * which callers must handle explicitly rather than mistake for consent.
   */
  public async moderate(content: string): Promise<ModerationResult> {
    const systemPrompt = `Review the following content for safety violations.
    Flag if it contains: illegal content, hate speech, personal information, exploits, or spam.
    Respond ONLY with a JSON object: { "safe": boolean, "reason": string | null }`;

    // (a) The judged text is wrapped before it reaches its own judge.
    const { sanitizeForPrompt } = await import("../utils/aiPromptSanitizer");

    return (await safeExecute({
      fn: async (): Promise<ModerationResult> => {
        const result = await this.generateResponse(
          sanitizeForPrompt(content),
          systemPrompt,
          '{ "safe": true|false, "reason": "string|null" }',
        );
        if (!result.success) {
          return { verdict: "unavailable", reason: result.error || "AI request failed" };
        }

        const jsonMatch = result.response.match(/\{.*\}/s);
        if (!jsonMatch) {
          return { verdict: "unavailable", reason: "Moderator returned no JSON object" };
        }

        const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
        const safe = readModerationVerdict(parsed.safe);
        const reason =
          typeof parsed.reason === "string" && parsed.reason.trim()
            ? parsed.reason.trim().slice(0, 500)
            : undefined;

        // An illegible verdict is NOT consent. This is the (b) fix: the
        // string "false" now reads as false instead of as truthy.
        if (safe === null) {
          return {
            verdict: "unavailable",
            reason: `Moderator verdict was not legible: ${JSON.stringify(parsed.safe)}`,
          };
        }

        return safe
          ? { verdict: "safe" }
          : { verdict: "unsafe", reason: reason || "Content policy violation" };
      },
      context: "Moderate content",
      logger: this.logger,
      fallback: { verdict: "unavailable", reason: "Moderation service unavailable" } as ModerationResult,
    })()) ?? { verdict: "unavailable", reason: "Moderation service unavailable" };
  }

  /**
   * Moderate with a hard wall-clock bound, for use ON a delivery path.
   *
   * S7(d): moderation now gates delivery, so its latency is felt by the
   * sender. `generateResponse` may legitimately take up to SLOT_TIMEOUT_MS
   * (120s) once queueing is counted, which is far too long to hold a message
   * send. Past this bound the answer is `unavailable` — which, per the agreed
   * policy, means deliver and re-check rather than block.
   */
  public async moderateForDelivery(
    content: string,
    timeoutMs = this.MODERATION_DELIVERY_TIMEOUT_MS,
  ): Promise<ModerationResult> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<ModerationResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ verdict: "unavailable", reason: `Moderation exceeded ${timeoutMs}ms` }),
        timeoutMs,
      );
      timer.unref?.();
    });

    try {
      return await Promise.race([this.moderate(content), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Re-moderate content that was delivered without a verdict.
   *
   * Rides the existing retry queue (fixed in R14a — before that, overlapping
   * ticks could fire `onSuccess` several times for one entry, which here
   * would mean hiding a post repeatedly and spamming its author).
   */
  public queueModerationRecheck(
    content: string,
    onVerdict: (result: ModerationResult) => void | Promise<void>,
  ): void {
    const systemPrompt = `Review the following content for safety violations.
    Flag if it contains: illegal content, hate speech, personal information, exploits, or spam.
    Respond ONLY with a JSON object: { "safe": boolean, "reason": string | null }`;

    void (async () => {
      const { sanitizeForPrompt } = await import("../utils/aiPromptSanitizer");
      this.queueForRetry(
        sanitizeForPrompt(content),
        systemPrompt,
        async (response) => {
          const match = response.match(/\{.*\}/s);
          if (!match) {
            // REVIEW: log it. The entry has already been removed from the
            // queue by processRetryQueueOnce, so returning quietly means the
            // content stays published forever with no record that its
            // re-check gave up — a silent permanent fail-open.
            this.metrics.moderationRechecksAbandoned++;
            this.logger.warn("S7: moderation re-check returned no JSON — content stays published unchecked");
            return;
          }
          // PARSE AND ENFORCE ARE SEPARATE.
          //
          // `await onVerdict(...)` used to sit inside this try, under a bare
          // `catch {}` whose comment read "the content simply stays visible".
          // That is true for a parse failure and catastrophic for the other
          // case it also caught: moderation correctly returning UNSAFE and the
          // hide/notify action then throwing. The verdict was right, the
          // enforcement was lost, and nothing was logged — CLAUDE.md bug shape
          // #1, an enclosing catch hiding a failure the compiler could not see.
          let verdict: ModerationResult;
          try {
            const parsed = JSON.parse(match[0]) as Record<string, unknown>;
            const safe = readModerationVerdict(parsed.safe);
            if (safe === null) {
              // Illegible is precisely what produced `unavailable` in the
              // first place, so this is the likely path, not the rare one.
              this.logger.warn(
                { raw: JSON.stringify(parsed.safe) },
                "S7: moderation re-check verdict still illegible — content stays published unchecked",
              );
              this.metrics.moderationRechecksAbandoned++;
              return;
            }
            const reason =
              typeof parsed.reason === "string" && parsed.reason.trim()
                ? parsed.reason.trim().slice(0, 500)
                : "Content policy violation";
            verdict = safe ? { verdict: "safe" } : { verdict: "unsafe", reason };
          } catch (err) {
            this.metrics.moderationRechecksAbandoned++;
            this.logger.warn(
              { err },
              "S7: moderation re-check response unparseable — content stays published unchecked",
            );
            return;
          }

          try {
            await onVerdict(verdict);
          } catch (err) {
            // Loud, and loudest when the verdict was `unsafe`: content the
            // model positively identified as a violation is still visible.
            this.logger.error(
              { err, verdict: verdict.verdict },
              verdict.verdict === "unsafe"
                ? "S7: moderation found UNSAFE content but the hide/notify action FAILED — it is still published"
                : "S7: moderation re-check verdict handler failed",
            );
          }
        },
        '{ "safe": true|false, "reason": "string|null" }',
        true, // critical: never evict this in favour of NPC mail or ambient prose
      );
    })();
  }

  /**
   * R14c: record that a caller fell back to static content.
   *
   * Fallbacks were completely invisible: `safeAI` returned the fallback value
   * unchanged with no flag and no counter, and `aiFallbacks` returns plain
   * strings indistinguishable from real AI output. A total outage looked, from
   * outside, exactly like a working game with slightly duller prose — which is
   * the failure this phase is meant to make impossible to miss.
   */
  public noteFallbackServed(context: string): void {
    this.metrics.fallbacksServed++;
    this.lastFallback = { at: new Date().toISOString(), context };
  }

  public async summarize(content: string): Promise<string> {
    const systemPrompt =
      "Summarize the following text concisely, retaining key facts and entities.";
    const result = await this.generateResponse(content, systemPrompt);
    if (!result.success) return content; // fallback to original content
    return result.response;
  }

  public async checkHealth(): Promise<boolean> {
    return (await safeExecute({
      fn: async () => {
        // R14c review: bound the probe. Without a signal this inherits the
        // default fetch timeout, so a hung Ollama leaves every /health request
        // pending — turning a liveness probe into a queue of stuck sockets.
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.HEALTH_PROBE_TIMEOUT_MS);
        try {
          const response = await fetch(`${this.apiUrl}/api/tags`, {
            headers: this.getHeaders(),
            signal: controller.signal,
          });
          return response.ok;
        } finally {
          clearTimeout(timer);
        }
      },
      context: "AI health check",
      logger: this.logger,
      silent: true,
      fallback: false,
    })()) ?? false;
  }

  public getMetrics() {
    return {
      ...this.metrics,
      // R14c: exposed so an outage is legible without reading logs.
      lastFallback: this.lastFallback,
      queueDepth: this.requestQueue.length,
      activeRequests: this.activeRequests,
      cacheHitRate:
        this.metrics.totalRequests > 0
          ? (
              (this.metrics.cacheHits / this.metrics.totalRequests) *
              100
            ).toFixed(2) + "%"
          : "0%",
    };
  }
}
