/**
 * Shared input validation for both HTTP and Socket.IO paths.
 * Extracted from middleware/validation.ts to be callable from socket handlers.
 */

const COMMAND_REGEX = /^[a-zA-Z0-9\s_./,@:=+*#"'()!?~%^-]*$/;
const MAX_COMMAND_LENGTH = 1000;
const MAX_SUBJECT_LENGTH = 200;
const MAX_CONTENT_LENGTH = 10000;

export function validateCommandInput(
  command: string,
): { valid: boolean; reason?: string } {
  if (!command || typeof command !== "string") {
    return { valid: false, reason: "Invalid command format" };
  }

  const trimmed = command.trim();

  if (trimmed.length === 0) {
    return { valid: false, reason: "Command cannot be empty" };
  }

  if (trimmed.length > MAX_COMMAND_LENGTH) {
    return { valid: false, reason: `Command exceeds maximum length of ${MAX_COMMAND_LENGTH}` };
  }

  if (!COMMAND_REGEX.test(trimmed)) {
    return { valid: false, reason: "Command contains invalid characters" };
  }

  return { valid: true };
}

export function sanitizeSocketInput(text: string): string {
  return text
    .replace(/\0/g, "") // strip null bytes
    .trim();
}

export function validateMessageInput(data: {
  recipientId?: string | undefined;
  subject?: string | undefined;
  content?: string | undefined;
}): { valid: boolean; reason?: string } {
  const { recipientId, subject, content } = data;

  if (!recipientId || !subject || !content) {
    return { valid: false, reason: "recipientId, subject, and content are required" };
  }

  if (typeof subject !== "string" || subject.length > MAX_SUBJECT_LENGTH) {
    return { valid: false, reason: `Subject exceeds maximum length of ${MAX_SUBJECT_LENGTH}` };
  }

  if (typeof content !== "string" || content.length > MAX_CONTENT_LENGTH) {
    return { valid: false, reason: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH}` };
  }

  return { valid: true };
}
