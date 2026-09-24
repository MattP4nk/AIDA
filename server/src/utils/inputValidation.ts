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

/**
 * Caps on a pre-split `args` array.
 *
 * The HTTP path never needed this: it takes a single raw command STRING, which
 * `validateCommand()` length- and character-checks before the shell tokenizer
 * ever sees it. The socket path accepts `args` as a separate array, which
 * skips all of that — it was only filtered to strings and stripped of control
 * characters, with no cap on how many args or how long each one could be. So
 * the same input that HTTP bounds at MAX_COMMAND_LENGTH could arrive over the
 * socket as 10,000 arguments of arbitrary size.
 *
 * Deliberately NOT applying COMMAND_REGEX to args: unlike a command NAME, args
 * legitimately carry paths, quotes and free text (`msg alice it's fine`), so a
 * character whitelist here would break real input. Bounding size and count is
 * the part that was missing.
 */
export const MAX_COMMAND_ARGS = 32;
export const MAX_ARG_LENGTH = 512;

export function validateCommandArgs(
  args: unknown,
): { valid: boolean; reason?: string } {
  if (args === undefined || args === null) return { valid: true };
  if (!Array.isArray(args)) {
    return { valid: false, reason: "Arguments must be an array" };
  }
  if (args.length > MAX_COMMAND_ARGS) {
    return { valid: false, reason: `Too many arguments (max ${MAX_COMMAND_ARGS})` };
  }
  for (const a of args) {
    if (typeof a === "string" && a.length > MAX_ARG_LENGTH) {
      return { valid: false, reason: `Argument exceeds maximum length of ${MAX_ARG_LENGTH}` };
    }
  }
  return { valid: true };
}

export function sanitizeSocketInput(text: string): string {
  return (
    text
      // Stripping control characters is the purpose of this function, so the
      // control-char lint rule is suppressed deliberately.
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "")
      .trim()
  );
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

  if (typeof recipientId !== "string" || recipientId.length < 1 || recipientId.length > 128) {
    return { valid: false, reason: "Invalid recipientId format" };
  }

  if (typeof subject !== "string" || subject.length > MAX_SUBJECT_LENGTH) {
    return { valid: false, reason: `Subject exceeds maximum length of ${MAX_SUBJECT_LENGTH}` };
  }

  if (typeof content !== "string" || content.length > MAX_CONTENT_LENGTH) {
    return { valid: false, reason: `Content exceeds maximum length of ${MAX_CONTENT_LENGTH}` };
  }

  return { valid: true };
}
