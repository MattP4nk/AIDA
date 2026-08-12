/**
 * safeExecute.ts — Universal error handler for the AIDA server.
 *
 * Inspired by the client-side `ejecutarSeguro` pattern from shared/handler.ts.
 * Wraps ANY async function with centralized error handling, logging, and
 * response formatting. The caller never writes try/catch.
 *
 * Architecture:
 *   1. `safeExecute()` — Factory that returns a wrapped function
 *   2. `formatServerError()` — Classifies and cleans errors (Prisma, JWT, GameError, generic)
 *   3. `mapFieldName()` — Maps technical field names to human-readable labels
 *
 * Usage:
 *   // Service — rethrow for route handler
 *   const createUser = safeExecute({
 *     fn: (data) => prisma.user.create({ data }),
 *     context: "Create user",
 *     logger: this.logger,
 *     rethrow: true,
 *   });
 *
 *   // Non-critical — silent fallback
 *   const enrichPrompt = safeExecute({
 *     fn: (prompt) => enrichWithTopology(prompt, prisma),
 *     context: "Topology enrichment",
 *     logger: this.logger,
 *     silent: true,
 *     fallback: basePrompt,
 *   });
 *
 *   // Command module — return error result on failure
 *   const execute = safeExecute({
 *     fn: (cmd, ctx) => handleComplexCommand(cmd, ctx),
 *     context: "Hack command",
 *     logger,
 *     onError: (_err, fmt) => errorResult(fmt.message),
 *   });
 */

import { GameError } from "../../../shared/types";
import { validateOrRetry } from "./aiOutputValidator";

// ═══════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════

export interface FormattedError {
  /** Human-readable message safe for client responses */
  message: string;
  /** Machine-readable error code: "UNIQUE_CONSTRAINT", "NOT_FOUND", etc. */
  code: string;
  /** HTTP status code (400, 404, 409, 500, etc.) */
  statusCode: number;
  /** Context-enriched message for pino logs */
  logMessage: string;
  /** Whether this was a Prisma/database error */
  isPrisma: boolean;
}

interface SafeExecuteConfig<TArgs extends any[], TResult> {
  /** The async function to wrap */
  fn: (...args: TArgs) => Promise<TResult>;
  /** Human-readable context for error messages: "Create mission", "Hack command" */
  context: string;
  /** Pino logger instance for structured logging */
  logger?: { error?: (obj: any, msg: string) => void; debug?: (obj: any, msg: string) => void } | undefined;
  /** Called after successful execution */
  onSuccess?: (result: TResult) => void | Promise<void>;
  /** Called on error with both raw error and formatted version */
  onError?: (error: Error, formatted: FormattedError) => void | Promise<void>;
  /** Re-throw after logging? Use for operations where the caller handles the error (routes) */
  rethrow?: boolean;
  /** Return this value instead of undefined on error */
  fallback?: TResult;
  /** Use debug-level logging instead of error (for non-critical operations) */
  silent?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// Core: safeExecute factory
// ═══════════════════════════════════════════════════════════════════

/**
 * Universal error handler factory.
 *
 * Takes a config object with the function and options, returns a wrapped
 * version that handles all error logging, formatting, and flow control.
 * The wrapped function has the same signature as the original.
 *
 * Return type adapts to config:
 * - With `fallback`: returns `Promise<TFallback>` (guaranteed value)
 * - Without `fallback`: returns `Promise<TResult | undefined>`
 */
export function safeExecute<TArgs extends any[], TResult, TFallback extends TResult>(
  config: SafeExecuteConfig<TArgs, TResult> & { fallback: TFallback },
): (...args: TArgs) => Promise<TResult>;
export function safeExecute<TArgs extends any[], TResult>(
  config: SafeExecuteConfig<TArgs, TResult>,
): (...args: TArgs) => Promise<TResult | undefined>;
export function safeExecute<TArgs extends any[], TResult>(
  config: SafeExecuteConfig<TArgs, TResult>,
) {
  return async (...args: TArgs): Promise<TResult | undefined> => {
    try {
      const result = await config.fn(...args);
      if (config.onSuccess) await config.onSuccess(result);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      const formatted = formatServerError(err, config.context);

      // Centralized logging — always logs, adapts level based on criticality
      if (config.silent) {
        config.logger?.debug?.({ err, context: config.context }, formatted.logMessage);
      } else {
        config.logger?.error?.({ err, context: config.context, code: formatted.code }, formatted.logMessage);
      }

      if (config.onError) await config.onError(err, formatted);
      if (config.rethrow) throw err;

      return config.fallback !== undefined ? config.fallback : undefined;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════
// Error Formatter
// ═══════════════════════════════════════════════════════════════════

/**
 * Classify and format any error into a structured, client-safe response.
 *
 * Detects Prisma errors by message pattern (not error codes, since Prisma
 * error classes may not be importable in all contexts). Also handles
 * GameError subclasses, JWT errors, and generic errors.
 *
 * Ported from the client-side `manejarErrorApi` + `limpiarErrorPrisma`
 * in shared/handler.ts, adapted for server-side Node.js.
 */
export function formatServerError(error: Error, context: string): FormattedError {
  const msg = error.message;

  // ── Prisma: Unique constraint violation (P2002) ──
  if (msg.includes("Unique constraint failed")) {
    const field = msg.match(/fields: \(`([^`]+)`\)/)?.[1] || "field";
    return {
      message: `A record with this ${mapFieldName(field)} already exists`,
      code: "UNIQUE_CONSTRAINT",
      statusCode: 409,
      logMessage: `[${context}] Unique constraint: ${field}`,
      isPrisma: true,
    };
  }

  // ── Prisma: Record not found (P2025) ──
  if (msg.includes("Record to update not found") || msg.includes("Record to delete does not exist")) {
    return {
      message: "The record was not found or has been deleted",
      code: "NOT_FOUND",
      statusCode: 404,
      logMessage: `[${context}] Record not found`,
      isPrisma: true,
    };
  }

  // ── Prisma: Foreign key constraint (P2003) ──
  if (msg.includes("Foreign key constraint failed")) {
    return {
      message: "Cannot complete operation: related records exist",
      code: "FOREIGN_KEY",
      statusCode: 409,
      logMessage: `[${context}] Foreign key constraint violation`,
      isPrisma: true,
    };
  }

  // ── Prisma: Invalid invocation (schema mismatch, missing fields) ──
  if (msg.includes("Invalid `") && msg.includes("invocation")) {
    const columnMatch = msg.match(/The column `([^`]+)` does not exist/);
    if (columnMatch) {
      return {
        message: `Configuration error: column '${columnMatch[1]}' does not exist`,
        code: "SCHEMA_ERROR",
        statusCode: 500,
        logMessage: `[${context}] Missing column: ${columnMatch[1]}`,
        isPrisma: true,
      };
    }
    return {
      message: "Database operation failed due to invalid data",
      code: "INVALID_QUERY",
      statusCode: 400,
      logMessage: `[${context}] Invalid Prisma invocation`,
      isPrisma: true,
    };
  }

  // ── Prisma: Table does not exist ──
  if (msg.includes("Table") && msg.includes("does not exist")) {
    const tableMatch = msg.match(/Table `([^`]+)` does not exist/);
    return {
      message: "Database configuration error",
      code: "SCHEMA_ERROR",
      statusCode: 500,
      logMessage: `[${context}] Missing table: ${tableMatch?.[1] || "unknown"}`,
      isPrisma: true,
    };
  }

  // ── Prisma/Network: Connection errors ──
  if (msg.includes("Can't reach database") || msg.includes("Connection refused") || msg.includes("ECONNREFUSED")) {
    return {
      message: "Database connection error. Try again shortly.",
      code: "DB_CONNECTION",
      statusCode: 503,
      logMessage: `[${context}] Database connection failed`,
      isPrisma: true,
    };
  }

  // ── Prisma/Network: Timeout ──
  if (msg.includes("Timed out") || msg.includes("timeout") || msg.includes("ETIMEDOUT")) {
    return {
      message: "Operation timed out. Try again.",
      code: "TIMEOUT",
      statusCode: 504,
      logMessage: `[${context}] Operation timed out`,
      isPrisma: false,
    };
  }

  // ── Prisma/Network: DNS resolution ──
  if (msg.includes("ENOTFOUND")) {
    return {
      message: "Server connection error",
      code: "DNS_ERROR",
      statusCode: 503,
      logMessage: `[${context}] DNS resolution failed`,
      isPrisma: false,
    };
  }

  // ── JWT errors ──
  if (msg.includes("JsonWebTokenError") || msg.includes("TokenExpiredError") || msg.includes("jwt expired") || msg.includes("invalid signature")) {
    return {
      message: "Session expired. Please log in again.",
      code: "AUTH_EXPIRED",
      statusCode: 401,
      logMessage: `[${context}] JWT error`,
      isPrisma: false,
    };
  }

  // ── GameError (already structured) ──
  if (error instanceof GameError) {
    return {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
      logMessage: `[${context}] ${error.message}`,
      isPrisma: false,
    };
  }

  // ── Generic error — hide internal details ──
  return {
    message: "An unexpected error occurred",
    code: "INTERNAL_ERROR",
    statusCode: 500,
    logMessage: `[${context}] ${msg}`,
    isPrisma: false,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Field Name Mapper
// ═══════════════════════════════════════════════════════════════════

/**
 * Map technical database field names to human-readable labels.
 * Used when Prisma unique constraint errors reference field names.
 */
function mapFieldName(field: string): string {
  const map: Record<string, string> = {
    username: "username",
    email: "email address",
    ipAddress: "IP address",
    url: "URL",
    name: "name",
    epochNum: "epoch number",
    token: "session token",
    shortName: "short name",
  };
  return map[field] || field;
}

// ═══════════════════════════════════════════════════════════════════
// AI-Specific: safeAI
// ═══════════════════════════════════════════════════════════════════

/** Minimal interface — matches AIService.generateOrThrow without importing the class. */
interface AIServiceLike {
  generateOrThrow(
    prompt: string,
    systemPrompt?: string,
    context?: number[],
    expectedFormat?: string,
  ): Promise<{ response: string; context?: number[] }>;
  queueForRetry?(
    prompt: string,
    systemPrompt?: string,
    onSuccess?: (response: string) => void,
    context?: number[],
    expectedFormat?: string,
  ): void;
}

interface SafeAIConfig<TResult> {
  /** AI service instance (needs generateOrThrow) */
  aiService: AIServiceLike;
  /** User prompt */
  prompt: string;
  /** System prompt for AI persona */
  systemPrompt?: string;
  /** JSON format hint appended to prompt */
  expectedFormat?: string;
  /** Validates parsed JSON → typed result or null */
  validate: (parsed: any) => TResult | null;
  /** Returned when AI fails or validation fails. Function form for lazy evaluation. */
  fallback: TResult | (() => TResult);
  /** Human-readable context for logging */
  context: string;
  /** Logger instance */
  logger?: { error?: (obj: any, msg: string) => void; debug?: (obj: any, msg: string) => void };
  /** JSON extraction type — "object" (default) or "array" */
  jsonType?: "object" | "array";
  /** If true, queue the prompt for background retry when AI fails */
  retry?: boolean;
  /** Callback when retry eventually succeeds (receives validated result) */
  onRetrySuccess?: (result: TResult) => Promise<void>;
}

/**
 * Structured AI call with validation + fallback.
 *
 * Combines generateOrThrow + validateOrRetry + safeExecute into a single call.
 * On any failure (network, timeout, bad JSON, validation), returns the fallback
 * and optionally queues for retry.
 *
 * Usage:
 *   const posts = await safeAI({
 *     aiService: this.aiService,
 *     prompt: userPrompt,
 *     systemPrompt: persona.systemPrompt,
 *     expectedFormat: '{ "title": "string", "content": "string" }',
 *     validate: validateForumPosts,
 *     fallback: () => [fallbackForumPost(faction, author)],
 *     context: "Generate forum posts",
 *     logger: this.logger,
 *     jsonType: "array",
 *     retry: true,
 *     onRetrySuccess: async (posts) => { await savePosts(posts); },
 *   });
 */
export async function safeAI<TResult>(config: SafeAIConfig<TResult>): Promise<TResult> {
  const resolveFallback = (): TResult =>
    typeof config.fallback === "function"
      ? (config.fallback as () => TResult)()
      : config.fallback;

  // Cache the resolved fallback once — avoids reference-equality bug when fallback is a function
  const resolvedFallback = resolveFallback();

  const result = await safeExecute({
    fn: async () => {
      const aiResult = await config.aiService.generateOrThrow(
        config.prompt,
        config.systemPrompt,
        undefined,
        config.expectedFormat,
      );

      const validated = validateOrRetry(
        aiResult.response,
        config.validate,
        null, // Don't let validateOrRetry queue retry — we handle it below
        undefined,
        config.jsonType || "object",
      );

      if (!validated) {
        throw new Error("AI response failed validation");
      }

      return validated;
    },
    context: config.context,
    logger: config.logger,
    silent: true, // AI failures are expected — debug level, not error
    fallback: resolvedFallback,
  })();

  // Queue for retry if AI failed and retry is enabled
  if (result === resolvedFallback && config.retry && config.aiService.queueForRetry) {
    config.aiService.queueForRetry(
      config.prompt,
      config.systemPrompt,
      config.onRetrySuccess
        ? async (response: string) => {
            const validated = validateOrRetry(response, config.validate, null, undefined, config.jsonType || "object");
            if (validated && config.onRetrySuccess) {
              await config.onRetrySuccess(validated);
            }
          }
        : undefined,
      undefined,
      config.expectedFormat,
    );
  }

  return result!;
}
