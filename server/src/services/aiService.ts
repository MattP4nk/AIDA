import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import type { CacheService } from "./cacheService";
import { LOGGER } from "../di/tokens";
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
  context?: number[] | undefined;
  expectedFormat?: string | undefined;
  onSuccess: (response: string) => void;
  attempts: number;
  createdAt: number;
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
    retrySuccesses: 0,
  };

  /** Queue of failed requests to retry later. */
  private retryQueue: QueuedRequest[] = [];
  private readonly RETRY_QUEUE_MAX = 20;
  private readonly RETRY_QUEUE_INTERVAL_MS = 30_000; // Process queue every 30s
  private readonly RETRY_MAX_ATTEMPTS = 3;
  private readonly RETRY_MAX_AGE_MS = 10 * 60 * 1000; // Drop requests older than 10 min
  private retryTimer: NodeJS.Timeout | null = null;

  /** Concurrency throttle — prevents flooding the API with parallel requests. */
  private activeRequests = 0;
  private readonly MAX_CONCURRENT_REQUESTS = 2;
  private readonly MAX_QUEUE_DEPTH = 20;
  private readonly SLOT_TIMEOUT_MS = 30_000;
  private requestQueue: Array<{ resolve: () => void }> = [];

  constructor(
    @inject(LOGGER) logger: Logger,
    @inject("CacheService") cacheService: CacheService,
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

    // Dynamic timeout: cloud GPUs are fast (60s), local CPU inference is slow (120s)
    this.requestTimeout = this.isCloudMode ? 60000 : 120000;

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

  private getCacheKey(prompt: string, systemPrompt?: string, context?: number[]): string {
    const contextStr = context ? context.join(",") : "";
    const data = `${prompt}|${systemPrompt || ""}|${this.defaultModel}|${contextStr}`;
    return `ai:${crypto.createHash("md5").update(data).digest("hex")}`;
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

  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        const isRateLimit = error instanceof Error && error.message.includes("Too Many Requests");
        if (i === maxRetries - 1) throw error;
        // Use longer backoff for rate limits (5s, 15s, 30s)
        const delay = isRateLimit
          ? 5000 * Math.pow(3, i)
          : 1000 * Math.pow(2, i);
        this.logger.warn({ attempt: i + 1, delay, isRateLimit }, "Retrying AI request");
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error("Max retries exceeded");
  }

  /**
   * Generate an AI response.
   * @param prompt - The user prompt
   * @param systemPrompt - Optional system prompt
   * @param context - Optional conversation context
   * @param expectedFormat - Optional JSON format hint appended to prompt (improves structured output accuracy)
   */
  public async generateResponse(
    prompt: string,
    systemPrompt?: string,
    context?: number[],
    expectedFormat?: string,
  ): Promise<{ success: boolean; response: string; context?: number[]; error?: string }> {
    this.metrics.totalRequests++;

    // Append format instruction to prompt if provided
    const fullPrompt = expectedFormat
      ? `${prompt}\n\nRespond ONLY with valid JSON in this exact format:\n${expectedFormat}`
      : prompt;

    const cacheKey = this.getCacheKey(fullPrompt, systemPrompt, context);
    const cached = this.cacheService.get<{
      success: boolean;
      response: string;
      context?: number[];
    }>(cacheKey);
    if (cached) {
      this.metrics.cacheHits++;
      this.logger.debug({ cacheKey }, "AI cache hit");
      return cached;
    }

    // Throttle concurrent requests to avoid rate limiting
    await this.acquireSlot();
    try {
      const result = await this.retryOperation(async () => {
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
        const timeout = setTimeout(
          () => controller.abort(),
          this.requestTimeout,
        );

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
    context?: number[],
    expectedFormat?: string,
  ): Promise<{ response: string; context?: number[] }> {
    const result = await this.generateResponse(prompt, systemPrompt, context, expectedFormat);
    if (!result.success) {
      throw new Error(result.error || "AI generation failed");
    }
    return { response: result.response, ...(result.context ? { context: result.context } : {}) };
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
    onSuccess: (response: string) => void,
    context?: number[],
    expectedFormat?: string,
  ): void {
    // Don't exceed max queue size
    if (this.retryQueue.length >= this.RETRY_QUEUE_MAX) {
      // Drop oldest entry
      this.retryQueue.shift();
    }

    const id = `retry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.retryQueue.push({
      id,
      prompt,
      systemPrompt,
      context,
      expectedFormat,
      onSuccess,
      attempts: 0,
      createdAt: Date.now(),
    });

    this.metrics.retryQueueSize = this.retryQueue.length;
    this.logger.debug({ queueSize: this.retryQueue.length, id }, "AI request queued for retry");
  }

  /**
   * Process the retry queue — attempts one request per cycle.
   * Runs every RETRY_QUEUE_INTERVAL_MS (30s).
   */
  private async processRetryQueue(): Promise<void> {
    if (this.retryQueue.length === 0) return;

    // Purge expired entries
    const now = Date.now();
    this.retryQueue = this.retryQueue.filter(
      (req) => now - req.createdAt < this.RETRY_MAX_AGE_MS,
    );

    if (this.retryQueue.length === 0) return;

    // Try the oldest request — pass format hint through generateResponse
    const req = this.retryQueue[0]!;
    req.attempts++;

    // On retry, strengthen the format instruction
    const retryFormat = req.expectedFormat
      ? `IMPORTANT: Your previous response was invalid. ${req.expectedFormat}`
      : (req.attempts > 1 ? "Respond ONLY with valid JSON. No markdown, no explanation." : undefined);

    try {
      const result = await this.generateResponse(req.prompt, req.systemPrompt, req.context, retryFormat);

      if (result.success) {
        // Success — remove from queue and call the callback
        this.retryQueue.shift();
        this.metrics.retrySuccesses++;
        this.metrics.retryQueueSize = this.retryQueue.length;

        this.logger.info({ id: req.id, attempts: req.attempts }, "Retry queue: AI request succeeded");

        try {
          req.onSuccess(result.response);
        } catch (cbErr) {
          this.logger.warn({ err: cbErr, id: req.id }, "Retry queue: onSuccess callback failed");
        }
      } else if (req.attempts >= this.RETRY_MAX_ATTEMPTS) {
        // Max attempts reached — drop it
        this.retryQueue.shift();
        this.metrics.retryQueueSize = this.retryQueue.length;
        this.logger.warn({ id: req.id, attempts: req.attempts }, "Retry queue: request dropped after max attempts");
      }
      // Otherwise leave it in queue for next cycle
    } catch (err) {
      if (req.attempts >= this.RETRY_MAX_ATTEMPTS) {
        this.retryQueue.shift();
        this.metrics.retryQueueSize = this.retryQueue.length;
      }
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

  public async moderate(
    content: string,
  ): Promise<{ safe: boolean; reason?: string }> {
    const systemPrompt = `Review the following content for safety violations.
    Flag if it contains: illegal content, hate speech, personal information, exploits, or spam.
    Respond ONLY with a JSON object: { "safe": boolean, "reason": string | null }`;

    return (await safeExecute({
      fn: async () => {
        const result = await this.generateResponse(content, systemPrompt, undefined, '{ "safe": true|false, "reason": "string|null" }');
        if (!result.success) {
          return { safe: true, reason: "Moderation service unavailable" };
        }

        const jsonMatch = result.response.match(/\{.*\}/s);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const reason = (parsed.reason as string) || undefined;
          if (reason) {
            return { safe: parsed.safe as boolean, reason };
          }
          return { safe: parsed.safe as boolean };
        }

        return { safe: true };
      },
      context: "Moderate content",
      logger: this.logger,
      fallback: { safe: true, reason: "Moderation service unavailable" } as { safe: boolean; reason?: string },
    })()) ?? { safe: true, reason: "Moderation service unavailable" };
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
        const response = await fetch(`${this.apiUrl}/api/tags`, {
          headers: this.getHeaders(),
        });
        return response.ok;
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
