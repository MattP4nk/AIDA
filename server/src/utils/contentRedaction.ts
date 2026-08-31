/**
 * Content Redaction System
 *
 * Applies lore-consistent redaction to file/message content before displaying
 * to the player. Sensitive patterns (AIDA mentions, email addresses, server
 * metadata) are replaced with garbled/encrypted-looking text.
 *
 * Redaction is REMOVED when:
 * - The file is decrypted (decrypt command)
 * - The player's cryptography skill meets the threshold
 * - The content is on the player's own home server (downloaded + decrypted copy)
 */

// Characters used to generate garbled replacement text
const GLITCH_CHARS = "░▒▓█▌▐▀▄╳╬╪┼";
const HEX_CHARS = "0123456789abcdef";

/**
 * Generate garbled replacement text of similar length.
 * Uses a seed from the original text so the same input always produces
 * the same garble (prevents flickering on re-reads).
 */
function garble(original: string, style: "glitch" | "hex" = "glitch"): string {
  let seed = 0;
  for (let i = 0; i < original.length; i++) {
    seed = ((seed << 5) - seed + original.charCodeAt(i)) | 0;
  }

  const chars = style === "hex" ? HEX_CHARS : GLITCH_CHARS;
  const len = Math.max(original.length, 4);
  let result = "";

  for (let i = 0; i < len; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    result += chars[seed % chars.length];
  }

  if (style === "hex") {
    // Format as hex blocks: [0a3f:b7c2:...]
    return "[" + result.match(/.{1,4}/g)!.join(":") + "]";
  }

  return result;
}

/** Patterns to redact and their replacement styles */
const REDACTION_RULES: Array<{
  pattern: RegExp;
  label: string;
  style: "glitch" | "hex";
}> = [
  // AIDA mentions — case insensitive, whole word + fragmented variants (A___A, A.I.D.A, etc)
  {
    pattern: /\bA\.?_*I\.?_*D\.?_*A\.?_*\b/gi,
    label: "ENTITY",
    style: "glitch",
  },
  // The Emperor / "the one who shattered"
  {
    pattern: /\b(?:the\s+emperor|emperor\s+\w+|the\s+one\s+who\s+shattered|project\s+████|project\s+emperor)\b/gi,
    label: "CLASSIFIED",
    style: "glitch",
  },
  // Email addresses
  {
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    label: "CONTACT",
    style: "hex",
  },
  // Lore-adjacent terms — "the signal", "the entity", "the shattering", fragments, etc.
  {
    pattern: /\b(?:the\s+signal|the\s+entity|the\s+shattering|digital\s+consciousness|network\s+entity|neural\s+collective|the\s+fragment(?:s)?|signal\s+origin|the\s+sword|the\s+collar|the\s+key\s+fragment)\b/gi,
    label: "CLASSIFIED",
    style: "glitch",
  },
];

/**
 * Apply redaction to content before displaying to the player.
 *
 * @param content  Raw file/message content
 * @param options  Context for conditional redaction
 * @returns Redacted content with garbled replacements
 */
export function redactSensitiveContent(
  content: string,
  options?: {
    /** If true, skip all redaction (file is decrypted or on home server) */
    skipRedaction?: boolean;
    /** Player's cryptography skill level */
    cryptoSkill?: number;
  },
): string {
  if (options?.skipRedaction) return content;

  let redacted = content;
  let redactionCount = 0;

  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.pattern, (match) => {
      // Count every redaction, including partial reveals — otherwise the footer
      // silently vanishes for high-skill players, who are the ones most invested
      // in knowing that something was hidden at all.
      redactionCount++;

      // High crypto skill can partially reveal content
      if (options?.cryptoSkill && options.cryptoSkill >= 50) {
        // Skill 50+: show first/last char with garble in between
        if (match.length > 2) {
          return match[0] + garble(match.slice(1, -1), rule.style) + match[match.length - 1];
        }
      }
      return garble(match, rule.style);
    });
  }

  if (redactionCount > 0) {
    redacted += `\n\n[${redactionCount} section${redactionCount > 1 ? "s" : ""} redacted — decrypt to reveal]`;
  }

  return redacted;
}
