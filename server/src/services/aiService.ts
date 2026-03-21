import { injectable, inject } from "tsyringe";
import { Logger } from "pino";
import type { CacheService } from "./cacheService";
import { LOGGER } from "../di/tokens";
import crypto from "crypto";

interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OllamaRequest {
  model: string;
  prompt: string;
  system?: string;
  template?: string;
  context?: number[];
  stream?: boolean;
  options?: Record<string, any>;
}

@injectable()
export class AIService {
  private apiUrl: string;
  private defaultModel: string;
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
    @inject("CacheService") cacheService: CacheService
  ) {
    this.logger = logger;
    this.cacheService = cacheService;
    this.apiUrl = process.env.OLLAMA_API_URL || "http://localhost:11434";
    this.defaultModel = process.env.OLLAMA_MODEL || "llama3.1:8b";
  }

  /**
   * Generate a cache key for AI requests
   */
  private getCacheKey(prompt: string, systemPrompt?: string): string {
    const data = `${prompt}|${systemPrompt || ""}|${this.defaultModel}`;
    return `ai:${crypto.createHash("md5").update(data).digest("hex")}`;
  }

  /**
   * Retry an operation with exponential backoff
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        const delay = 1000 * Math.pow(2, i); // Exponential backoff: 1s, 2s, 4s
        this.logger.warn({ attempt: i + 1, delay }, "Retrying AI request");
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error("Max retries exceeded");
  }

  /**
   * Generate a response from the AI model
   */
  public async generateResponse(
    prompt: string,
    systemPrompt?: string,
    context?: number[]
  ): Promise<{ response: string; context?: number[] }> {
    this.metrics.totalRequests++;

    // Check cache (only if no context array - context makes responses stateful)
    if (!context) {
      const cacheKey = this.getCacheKey(prompt, systemPrompt);
      const cached = this.cacheService.get<{ response: string; context?: number[] }>(cacheKey);
      if (cached) {
        this.metrics.cacheHits++;
        this.logger.debug({ cacheKey }, "AI cache hit");
        return cached;
      }
    }

    try {
      const result = await this.retryOperation(async () => {
        const request: OllamaRequest = {
          model: this.defaultModel,
          prompt,
          stream: false,
          options: {
            temperature: 0.7,
            top_p: 0.9,
          },
        };

        if (systemPrompt) {
          request.system = systemPrompt;
        }

        if (context) {
          request.context = context;
        }

        // Add request timeout
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

        try {
          const response = await fetch(`${this.apiUrl}/api/generate`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(request),
            signal: controller.signal,
          });

          clearTimeout(timeout);

          if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
          }

          const data = (await response.json()) as OllamaResponse;

          // Validate response
          if (!data.response || typeof data.response !== 'string') {
            throw new Error("Invalid response from Ollama");
          }

          return {
            response: data.response,
            ...(data.context ? { context: data.context } : {}),
          };
        } finally {
          clearTimeout(timeout);
        }
      });

      this.metrics.successfulRequests++;

      // Cache successful responses (5 minute TTL)
      if (!context) {
        const cacheKey = this.getCacheKey(prompt, systemPrompt);
        this.cacheService.set(cacheKey, result, 300);
      }

      return result;
    } catch (error) {
      this.metrics.failedRequests++;
      this.logger.error(error, "Error generating AI response");
      // Fallback response if AI is down
      return {
        response: "... [Connection Lost] ...",
      };
    }
  }

  /**
   * Check content safety using the AI model
   */
  public async moderate(content: string): Promise<{ safe: boolean; reason?: string }> {
    const systemPrompt = `Review the following content for safety violations. 
    Flag if it contains: illegal content, hate speech, personal information, exploits, or spam. 
    Respond ONLY with a JSON object: { "safe": boolean, "reason": string | null }`;

    try {
      const { response } = await this.generateResponse(content, systemPrompt);
      
      // Try to parse JSON from response
      const jsonMatch = response.match(/\{.*\}/s);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          safe: parsed.safe,
          reason: parsed.reason || undefined,
        };
      }

      // Default to safe if parsing fails but no error
      return { safe: true };
    } catch (error) {
      this.logger.error(error, "Error moderating content");
      // Fail safe (allow content if moderation fails? or block? blocking is safer)
      // For a game, maybe allow but log warning
      return { safe: true, reason: "Moderation service unavailable" };
    }
  }

  /**
   * Summarize a large block of text (e.g., knowledge base)
   */
  public async summarize(content: string): Promise<string> {
    const systemPrompt = "Summarize the following text concisely, retaining key facts and entities.";
    const { response } = await this.generateResponse(content, systemPrompt);
    return response;
  }

  /**
   * Check if the AI service is available
   */
  public async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.apiUrl}/api/tags`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get service metrics
   */
  public getMetrics() {
    return { 
      ...this.metrics,
      cacheHitRate: this.metrics.totalRequests > 0 
        ? (this.metrics.cacheHits / this.metrics.totalRequests * 100).toFixed(2) + '%'
        : '0%'
    };
  }
}
