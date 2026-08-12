/**
 * AI Output Validator
 *
 * Validates and sanitizes JSON output from AI responses.
 * Each validator returns a typed result or null if invalid.
 * Logs validation failures for debugging.
 *
 * When validation fails AND an AIService + retry callback are provided,
 * the original request is automatically queued for retry.
 */

import logger from "../logger";
import type { AIService } from "../services/aiService";

// ═══════════════════════════════════════════════════════════════════
// Validate-or-Retry Helper
// ═══════════════════════════════════════════════════════════════════

/**
 * Validate AI output and automatically queue for retry if validation fails.
 * Returns the validated result or null (caller uses fallback).
 *
 * @param response - Raw AI response string
 * @param validator - The validation function to apply
 * @param aiService - AIService instance (for queueing retry)
 * @param retryContext - Original prompt + systemPrompt + onSuccess callback + expected JSON format
 * @param jsonType - "object" or "array" for JSON extraction
 */
export function validateOrRetry<T>(
  response: string,
  validator: (parsed: any) => T | null,
  aiService?: AIService | null,
  retryContext?: {
    prompt: string;
    systemPrompt?: string;
    onSuccess: (response: string) => void;
    expectedFormat?: string; // JSON schema hint appended on retry, e.g. '{ "title": "string (3-80 chars)", "description": "string (10-500 chars)" }'
  },
  jsonType: "object" | "array" = "object",
): T | null {
  const parsed = extractJSON(response, jsonType);
  const validated = validator(parsed);

  if (!validated && aiService && retryContext) {
    // AI responded but output was invalid — queue for retry with format hint
    aiService.queueForRetry(
      retryContext.prompt,
      retryContext.systemPrompt,
      retryContext.onSuccess,
      retryContext.expectedFormat,
    );
    logger.debug("AI output failed validation — queued for retry with format hint");
  }

  return validated;
}

// ═══════════════════════════════════════════════════════════════════
// Common Helpers
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract and parse JSON from an AI response string.
 * Handles both object `{...}` and array `[...]` patterns.
 */
export function extractJSON(response: string, type: "object" | "array" = "object"): any | null {
  const startChar = type === "array" ? "[" : "{";
  const endChar = type === "array" ? "]" : "}";

  let startIdx = response.indexOf(startChar);
  while (startIdx !== -1) {
    // Try parsing from this position by tracking bracket depth
    let depth = 0;
    for (let i = startIdx; i < response.length; i++) {
      if (response[i] === startChar) depth++;
      else if (response[i] === endChar) depth--;

      if (depth === 0) {
        try {
          return JSON.parse(response.substring(startIdx, i + 1));
        } catch {
          break; // This balanced block wasn't valid JSON, try next start position
        }
      }
    }
    startIdx = response.indexOf(startChar, startIdx + 1);
  }
  return null;
}

function isNonEmptyString(val: unknown, minLen: number = 1, maxLen: number = Infinity): val is string {
  return typeof val === "string" && val.trim().length >= minLen && val.length <= maxLen;
}

function logInvalid(schema: string, reason: string, data?: unknown): void {
  logger.debug({ schema, reason, sample: typeof data === "string" ? data.slice(0, 100) : data }, "AI output validation failed");
}

// ═══════════════════════════════════════════════════════════════════
// Message Output — { subject, content }
// ═══════════════════════════════════════════════════════════════════

export interface ValidatedMessage {
  subject: string;
  content: string;
}

export function validateMessageOutput(parsed: any): ValidatedMessage | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("Message", "not an object", parsed);
    return null;
  }

  const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";

  if (!content || content.length < 5) {
    logInvalid("Message", "content too short or empty", { subject, contentLen: content.length });
    return null;
  }

  return {
    subject: subject.slice(0, 120) || "Message",
    content: content.slice(0, 3000),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Mission Output — { title, description }
// ═══════════════════════════════════════════════════════════════════

export interface ValidatedMission {
  title: string;
  description: string;
}

export function validateMissionOutput(parsed: any): ValidatedMission | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("Mission", "not an object", parsed);
    return null;
  }

  if (!isNonEmptyString(parsed.title, 3, 80)) {
    logInvalid("Mission", "title invalid (need 3-80 non-empty chars)", { title: parsed.title });
    return null;
  }

  if (!isNonEmptyString(parsed.description, 10, 500)) {
    logInvalid("Mission", "description invalid (need 10-500 non-empty chars)", { descLen: parsed.description?.length });
    return null;
  }

  return {
    title: parsed.title.trim(),
    description: parsed.description.trim(),
  };
}

// ═══════════════════════════════════════════════════════════════════
// Decision Output — { action, reason, details?, target? }
// ═══════════════════════════════════════════════════════════════════

const VALID_ACTION_TYPES = new Set([
  "issue_mission", "create_story_arc", "send_message",
  "forum_post", "trigger_event", "none",
]);

export interface ValidatedDecision {
  action: string;
  reason: string;
  details?: any;
  target?: string;
}

export function validateDecisionOutput(parsed: any): ValidatedDecision | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("Decision", "not an object", parsed);
    return null;
  }

  if (!VALID_ACTION_TYPES.has(parsed.action)) {
    logInvalid("Decision", `invalid action type: ${parsed.action}`, { action: parsed.action });
    return null;
  }

  return {
    action: parsed.action,
    reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "AI decision",
    details: parsed.details,
    target: typeof parsed.target === "string" ? parsed.target : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Content Plan — { directories[], files[] }
// ═══════════════════════════════════════════════════════════════════

export interface ValidatedContentPlan {
  directories: Array<{ path: string; isHidden?: boolean; isProtected?: boolean }>;
  files: Array<{ path: string; content: string; isHidden?: boolean; isEncrypted?: boolean; isProtected?: boolean }>;
}

export function validateContentPlan(parsed: any): ValidatedContentPlan | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("ContentPlan", "not an object", parsed);
    return null;
  }

  if (!Array.isArray(parsed.directories) || !Array.isArray(parsed.files)) {
    logInvalid("ContentPlan", "missing directories or files array");
    return null;
  }

  const directories = parsed.directories
    .filter((d: any) => typeof d.path === "string" && d.path.startsWith("/"))
    .map((d: any) => ({
      path: d.path,
      isHidden: Boolean(d.isHidden),
      isProtected: Boolean(d.isProtected),
    }));

  const files = parsed.files
    .filter((f: any) =>
      typeof f.path === "string" &&
      f.path.startsWith("/") &&
      typeof f.content === "string" &&
      f.content.trim().length > 0,
    )
    .map((f: any) => ({
      path: f.path,
      content: String(f.content).slice(0, 3000),
      isHidden: Boolean(f.isHidden),
      isEncrypted: Boolean(f.isEncrypted),
      isProtected: Boolean(f.isProtected),
    }));

  if (files.length === 0 && directories.length === 0) {
    logInvalid("ContentPlan", "all entries filtered out (empty paths or content)");
    return null;
  }

  return { directories, files };
}

// ═══════════════════════════════════════════════════════════════════
// Architect Evaluation — { narrativeSummary, interventions[], epochTransition? }
// ═══════════════════════════════════════════════════════════════════

const VALID_INTERVENTION_TYPES = new Set([
  "send_message", "plant_clue", "trigger_event",
  "adjust_tension", "create_mission", "grant_token", "reveal_faction",
]);

export interface ValidatedIntervention {
  type: string;
  target?: string;
  data?: any;
  reasoning?: string;
}

export interface ValidatedArchitectEvaluation {
  narrativeSummary: string;
  interventions: ValidatedIntervention[];
  epochTransition?: { title: string; summary: string } | undefined;
}

export function validateArchitectEvaluation(parsed: any): ValidatedArchitectEvaluation | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("ArchitectEval", "not an object", parsed);
    return null;
  }

  if (!isNonEmptyString(parsed.narrativeSummary, 5)) {
    logInvalid("ArchitectEval", "narrativeSummary too short or missing");
    return null;
  }

  if (!Array.isArray(parsed.interventions)) {
    logInvalid("ArchitectEval", "interventions not an array");
    return null;
  }

  const interventions = parsed.interventions
    .filter((i: any) => i && typeof i.type === "string" && VALID_INTERVENTION_TYPES.has(i.type))
    .map((i: any) => ({
      type: i.type,
      target: typeof i.target === "string" ? i.target : undefined,
      data: i.data,
      reasoning: typeof i.reasoning === "string" ? i.reasoning : undefined,
    }));

  const result: ValidatedArchitectEvaluation = {
    narrativeSummary: parsed.narrativeSummary.trim().slice(0, 1000),
    interventions,
  };

  if (parsed.epochTransition && typeof parsed.epochTransition === "object") {
    if (isNonEmptyString(parsed.epochTransition.title) && isNonEmptyString(parsed.epochTransition.summary)) {
      result.epochTransition = {
        title: parsed.epochTransition.title.trim(),
        summary: parsed.epochTransition.summary.trim(),
      };
    }
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════
// Story Arc Plan — { steps[], premise }
// ═══════════════════════════════════════════════════════════════════

export interface ValidatedStoryArcPlan {
  premise: string;
  steps: Array<{
    title: string;
    description: string;
    objectiveType?: string;
    successBranch?: string;
    failureBranch?: string;
  }>;
}

export function validateStoryArcPlan(parsed: any): ValidatedStoryArcPlan | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("StoryArc", "not an object", parsed);
    return null;
  }

  if (!isNonEmptyString(parsed.premise, 10)) {
    logInvalid("StoryArc", "premise too short or missing");
    return null;
  }

  if (!Array.isArray(parsed.steps) || parsed.steps.length < 2) {
    logInvalid("StoryArc", "steps array missing or too short (need >= 2)");
    return null;
  }

  const steps = parsed.steps
    .filter((s: any) => isNonEmptyString(s.title, 3) && isNonEmptyString(s.description, 10))
    .map((s: any) => ({
      title: s.title.trim().slice(0, 80),
      description: s.description.trim().slice(0, 500),
      objectiveType: typeof s.objectiveType === "string" ? s.objectiveType : undefined,
      successBranch: typeof s.successBranch === "string" ? s.successBranch : undefined,
      failureBranch: typeof s.failureBranch === "string" ? s.failureBranch : undefined,
    }));

  if (steps.length < 2) {
    logInvalid("StoryArc", "after filtering, fewer than 2 valid steps remain");
    return null;
  }

  return {
    premise: parsed.premise.trim().slice(0, 500),
    steps,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Forum Posts — [{ authorHandle, title, content }]
// ═══════════════════════════════════════════════════════════════════

export interface ValidatedForumPost {
  authorHandle: string;
  authorPersonality: string;
  title: string;
  content: string;
  isSticky?: boolean;
  storyRelevant?: boolean;
}

export function validateForumPosts(parsed: any): ValidatedForumPost[] | null {
  if (!Array.isArray(parsed)) {
    logInvalid("ForumPosts", "not an array", parsed);
    return null;
  }

  const valid = parsed
    .filter((p: any) =>
      isNonEmptyString(p.authorHandle, 1) &&
      isNonEmptyString(p.title, 3) &&
      isNonEmptyString(p.content, 10),
    )
    .map((p: any) => ({
      authorHandle: p.authorHandle.trim(),
      authorPersonality: typeof p.authorPersonality === "string" ? p.authorPersonality.trim() : "",
      title: p.title.trim().slice(0, 200),
      content: p.content.trim().slice(0, 3000),
      isSticky: Boolean(p.isSticky),
      storyRelevant: Boolean(p.storyRelevant),
    }));

  if (valid.length === 0) {
    logInvalid("ForumPosts", "all entries filtered out (missing required fields)");
    return null;
  }

  return valid;
}

// ═══════════════════════════════════════════════════════════════════
// Forum Reply — { reply, memoryEntry? }
// ═══════════════════════════════════════════════════════════════════

export interface ValidatedForumReply {
  reply: string;
  memoryEntry?: { summary: string; topic: string } | null;
}

export function validateForumReply(parsed: any): ValidatedForumReply | null {
  if (!parsed || typeof parsed !== "object") {
    logInvalid("ForumReply", "not an object", parsed);
    return null;
  }

  if (!isNonEmptyString(parsed.reply, 5)) {
    logInvalid("ForumReply", "reply too short or missing");
    return null;
  }

  return {
    reply: parsed.reply.trim().slice(0, 3000),
    memoryEntry: parsed.memoryEntry && typeof parsed.memoryEntry === "object"
      ? {
          summary: typeof parsed.memoryEntry.summary === "string" ? parsed.memoryEntry.summary.trim() : "",
          topic: typeof parsed.memoryEntry.topic === "string" ? parsed.memoryEntry.topic.trim() : "",
        }
      : null,
  };
}
