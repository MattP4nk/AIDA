import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import type { CacheService } from "./cacheService";
import { LOGGER } from "../di/tokens";
import crypto from "crypto";

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
  };

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

  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        const delay = 1000 * Math.pow(2, i);
        this.logger.warn({ attempt: i + 1, delay }, "Retrying AI request");
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new Error("Max retries exceeded");
  }

  public async generateResponse(
    prompt: string,
    systemPrompt?: string,
    context?: number[],
  ): Promise<{ response: string; context?: number[] }> {
    this.metrics.totalRequests++;

    const cacheKey = this.getCacheKey(prompt, systemPrompt, context);
    const cached = this.cacheService.get<{
      response: string;
      context?: number[];
    }>(cacheKey);
    if (cached) {
      this.metrics.cacheHits++;
      this.logger.debug({ cacheKey }, "AI cache hit");
      return cached;
    }

    try {
      const result = await this.retryOperation(async () => {
        const messages: OllamaChatMessage[] = [];

        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        }

        messages.push({ role: "user", content: prompt });

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

      // Cache all responses (including those with context)
      this.cacheService.set(cacheKey, result, 300);

      return result;
    } catch (error) {
      this.metrics.failedRequests++;
      this.logger.error(error, "Error generating AI response");
      return {
        response: "... [Connection Lost] ...",
      };
    }
  }

  public async moderate(
    content: string,
  ): Promise<{ safe: boolean; reason?: string }> {
    const systemPrompt = `Review the following content for safety violations.
    Flag if it contains: illegal content, hate speech, personal information, exploits, or spam.
    Respond ONLY with a JSON object: { "safe": boolean, "reason": string | null }`;

    try {
      const { response } = await this.generateResponse(content, systemPrompt);

      const jsonMatch = response.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          safe: parsed.safe,
          reason: parsed.reason || undefined,
        };
      }

      return { safe: true };
    } catch (error) {
      this.logger.error(error, "Error moderating content");
      return { safe: true, reason: "Moderation service unavailable" };
    }
  }

  public async summarize(content: string): Promise<string> {
    const systemPrompt =
      "Summarize the following text concisely, retaining key facts and entities.";
    const { response } = await this.generateResponse(content, systemPrompt);
    return response;
  }

  public async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/tags`, {
        headers: this.getHeaders(),
      });
      return response.ok;
    } catch (error) {
      return false;
    }
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
