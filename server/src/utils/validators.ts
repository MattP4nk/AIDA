/**
 * Input Validation Utilities
 *
 * Comprehensive validation functions to prevent injection attacks,
 * data corruption, and ensure data integrity across the application.
 */

/**
 * Validate a UUID format
 * @param id - The ID to validate
 * @returns True if valid UUID
 */
export function isValidUUID(id: string): boolean {
  if (!id || typeof id !== "string") {
    return false;
  }

  // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

/**
 * Validate a CUID (Collision-resistant Unique Identifier)
 * Prisma uses CUIDs by default in this project
 * @param id - The ID to validate
 * @returns True if valid CUID
 */
export function isValidCUID(id: string): boolean {
  if (!id || typeof id !== "string") {
    return false;
  }

  // CUIDs start with 'c' and are alphanumeric, usually 25 chars
  // We'll be slightly permissive to allow for different versions/lengths
  return /^c[a-z0-9]{20,30}$/.test(id);
}

/**
 * Validate a server ID (supports UUID or CUID)
 * @param serverId - The server ID to validate
 * @returns True if valid
 */
export function validateServerId(serverId: string): boolean {
  return isValidUUID(serverId) || isValidCUID(serverId);
}

/**
 * Validate a user ID (supports UUID or CUID)
 * @param userId - The user ID to validate
 * @returns True if valid
 */
export function validateUserId(userId: string): boolean {
  return isValidUUID(userId) || isValidCUID(userId);
}

/**
 * Validate a username
 * @param username - The username to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateUsername(username: string): {
  isValid: boolean;
  error?: string;
} {
  if (!username || typeof username !== "string") {
    return { isValid: false, error: "Username is required" };
  }

  // Length check
  if (username.length < 3) {
    return { isValid: false, error: "Username must be at least 3 characters" };
  }

  if (username.length > 20) {
    return { isValid: false, error: "Username must be at most 20 characters" };
  }

  // Allowed characters: alphanumeric, underscore, hyphen
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return {
      isValid: false,
      error:
        "Username can only contain letters, numbers, underscores, and hyphens",
    };
  }

  // Must start with a letter
  if (!/^[a-zA-Z]/.test(username)) {
    return { isValid: false, error: "Username must start with a letter" };
  }

  return { isValid: true };
}

/**
 * Validate an IP address (IPv4)
 * @param ip - The IP address to validate
 * @returns True if valid IPv4 address
 */
export function validateIPAddress(ip: string): boolean {
  if (!ip || typeof ip !== "string") {
    return false;
  }

  // IPv4 format: xxx.xxx.xxx.xxx where xxx is 0-255
  const parts = ip.split(".");

  if (parts.length !== 4) {
    return false;
  }

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (isNaN(num) || num < 0 || num > 255 || part !== num.toString()) {
      return false;
    }
  }

  return true;
}

/**
 * Validate a partial/incomplete IP address.
 *
 * Accepts two styles:
 *   1. Explicit wildcards (4-part): "10.10.10.x", "10.10.x.x", "192.168.x.x"
 *   2. Shortened form (2-3 parts):  "10.10.10", "10.10", "192.168"
 *      These are treated as having implicit trailing 'x' wildcards.
 *
 * Invalid examples: "10.x.10.x" (non-contiguous), "x.x.x.x" (fewer than 2 numeric),
 *                   "256.1.x.x" (octet out of range), "10" (only 1 octet)
 *
 * @param partialIp - The partial IP string to validate
 * @returns Object with isValid, and on success prefix (the known numeric portion) and wildcardCount
 */
export function validatePartialIP(partialIp: string): {
  isValid: boolean;
  prefix?: string;
  wildcardCount?: number;
} {
  if (!partialIp || typeof partialIp !== "string") {
    return { isValid: false };
  }

  const parts = partialIp.split(".");

  // ── Short form: 2-3 numeric octets with no wildcards ──
  // "10.10.10" → treated as "10.10.10.x" (wildcardCount = 1)
  // "10.10"    → treated as "10.10.x.x"  (wildcardCount = 2)
  if (parts.length >= 2 && parts.length <= 3) {
    const numericParts: number[] = [];
    for (const part of parts) {
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255 || part !== num.toString()) {
        return { isValid: false };
      }
      numericParts.push(num);
    }
    const wildcardCount = 4 - numericParts.length;
    const prefix = numericParts.join(".");
    return { isValid: true, prefix, wildcardCount };
  }

  // ── Explicit wildcard form: exactly 4 parts with trailing 'x' ──
  if (parts.length !== 4) {
    return { isValid: false };
  }

  // Classify each part as numeric or wildcard
  const numericParts: number[] = [];
  let wildcardCount = 0;
  let seenWildcard = false;

  for (const part of parts) {
    if (part.toLowerCase() === "x") {
      seenWildcard = true;
      wildcardCount++;
    } else if (seenWildcard) {
      // A numeric part after a wildcard means wildcards are non-contiguous
      return { isValid: false };
    } else {
      // Must be a valid octet: 0-255 with no leading zeros
      const num = parseInt(part, 10);
      if (isNaN(num) || num < 0 || num > 255 || part !== num.toString()) {
        return { isValid: false };
      }
      numericParts.push(num);
    }
  }

  // Must have at least 2 numeric octets and at least 1 wildcard
  if (numericParts.length < 2 || wildcardCount === 0) {
    return { isValid: false };
  }

  const prefix = numericParts.join(".");

  return { isValid: true, prefix, wildcardCount };
}

/**
 * Convert a valid partial IP to a prefix string suitable for database "startsWith" queries.
 *
 * For "10.10.10.x" or "10.10.10" returns "10.10.10."
 * For "10.10.x.x"  or "10.10"    returns "10.10."
 *
 * @param partialIp - A partial IP string (must pass validatePartialIP)
 * @returns The prefix string with trailing dot, or null if the input is invalid
 */
export function partialIpToPrefix(partialIp: string): string | null {
  const result = validatePartialIP(partialIp);

  if (!result.isValid || !result.prefix) {
    return null;
  }

  return result.prefix + ".";
}

/**
 * Validate a command string
 * @param command - The command to validate
 * @returns Object with isValid flag and optional error message
 */
export function validateCommand(command: string): {
  isValid: boolean;
  error?: string;
} {
  if (!command || typeof command !== "string") {
    return { isValid: false, error: "Command is required" };
  }

  // Length check (prevent DoS)
  if (command.length > 1000) {
    return {
      isValid: false,
      error: "Command is too long (max 1000 characters)",
    };
  }

  // Check for command injection attempts
  const dangerousPatterns = [
    /;[\s]*rm/i, // ; rm (command chaining)
    /\|[\s]*rm/i, // | rm (piping)
    /&&[\s]*rm/i, // && rm (logical AND)
    /\$\(/, // $( (command substitution)
    /`/, // ` (backtick command substitution)
    /\\\\/, // Escaped backslashes (Windows)
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(command)) {
      return {
        isValid: false,
        error: "Command contains potentially dangerous patterns",
      };
    }
  }

  return { isValid: true };
}

/**
 * Validate command arguments
 * @param args - Array of arguments
 * @returns Object with isValid flag and optional error message
 */
export function validateArgs(args: string[]): {
  isValid: boolean;
  error?: string;
} {
  if (!Array.isArray(args)) {
    return { isValid: false, error: "Arguments must be an array" };
  }

  // Check total length
  if (args.length > 50) {
    return { isValid: false, error: "Too many arguments (max 50)" };
  }

  // Check each argument
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (typeof arg !== "string") {
      return { isValid: false, error: `Argument ${i} must be a string` };
    }

    if (arg.length > 500) {
      return {
        isValid: false,
        error: `Argument ${i} is too long (max 500 characters)`,
      };
    }

    // Check for null bytes
    if (arg.includes("\0")) {
      return { isValid: false, error: `Argument ${i} contains null bytes` };
    }
  }

  return { isValid: true };
}

/**
 * Sanitize message content (for chat, mail, etc.)
 * @param content - The message content
 * @returns Sanitized content
 */
export function sanitizeMessageContent(content: string): string {
  if (!content || typeof content !== "string") {
    return "";
  }

  // Remove null bytes
  let sanitized = content.replace(/\0/g, "");

  // Remove control characters except newline and tab. Suppressed deliberately —
  // matching control characters is exactly what this line is for.
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, "");

  // Limit length
  if (sanitized.length > 5000) {
    sanitized = sanitized.substring(0, 5000);
  }

  return sanitized;
}

/**
 * Validate message content
 * @param content - The message content
 * @returns Object with isValid flag and optional error message
 */
export function validateMessageContent(content: string): {
  isValid: boolean;
  error?: string;
} {
  if (!content || typeof content !== "string") {
    return { isValid: false, error: "Message content is required" };
  }

  if (content.length === 0) {
    return { isValid: false, error: "Message cannot be empty" };
  }

  if (content.length > 5000) {
    return {
      isValid: false,
      error: "Message is too long (max 5000 characters)",
    };
  }

  // Check for null bytes
  if (content.includes("\0")) {
    return { isValid: false, error: "Message contains invalid characters" };
  }

  return { isValid: true };
}

/**
 * Validate an email address
 * @param email - The email to validate
 * @returns True if valid email format
 */
export function validateEmail(email: string): boolean {
  if (!email || typeof email !== "string") {
    return false;
  }

  // Basic email regex (not perfect but good enough)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Validate a password
 * @param password - The password to validate
 * @returns Object with isValid flag and optional error message
 */
export function validatePassword(password: string): {
  isValid: boolean;
  error?: string;
} {
  if (!password || typeof password !== "string") {
    return { isValid: false, error: "Password is required" };
  }

  if (password.length < 8) {
    return { isValid: false, error: "Password must be at least 8 characters" };
  }

  if (password.length > 128) {
    return {
      isValid: false,
      error: "Password is too long (max 128 characters)",
    };
  }

  // Check for at least one letter and one number
  if (!/[a-zA-Z]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one letter",
    };
  }

  if (!/[0-9]/.test(password)) {
    return {
      isValid: false,
      error: "Password must contain at least one number",
    };
  }

  return { isValid: true };
}

/**
 * Validate a number within a range
 * @param value - The value to validate
 * @param min - Minimum value (inclusive)
 * @param max - Maximum value (inclusive)
 * @returns True if valid
 */
export function validateNumberInRange(
  value: any,
  min: number,
  max: number,
): boolean {
  const num = Number(value);
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * Sanitize a search query
 * @param query - The search query
 * @returns Sanitized query
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== "string") {
    return "";
  }

  // Remove dangerous characters
  let sanitized = query.replace(/[<>;"'\\]/g, "");

  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, " ").trim();

  // Limit length
  if (sanitized.length > 100) {
    sanitized = sanitized.substring(0, 100);
  }

  return sanitized;
}

/**
 * Validate a port number
 * @param port - The port number
 * @returns True if valid port (1-65535)
 */
export function validatePort(port: any): boolean {
  return validateNumberInRange(port, 1, 65535);
}

/**
 * Validate a skill level
 * @param level - The skill level
 * @returns True if valid (0-100)
 */
export function validateSkillLevel(level: any): boolean {
  return validateNumberInRange(level, 0, 100);
}
