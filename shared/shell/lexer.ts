/**
 * AIDA Shell — Lexer
 *
 * Turns a raw command line into tokens, handling quoting and escaping.
 *
 * Shared between client and server on purpose:
 *   - the server needs it to execute
 *   - the client needs it to know what the cursor is sitting on (command
 *     position vs. argument vs. inside a quote) so tab completion can ask the
 *     right question, and to highlight syntax
 *
 * IMPORTANT: a WORD is NOT a string. It is a list of segments, each tagged with
 * whether it was quoted. Expansion needs that distinction — it is what makes
 *     cat "my file.txt"   one argument containing a space
 *     cat *.txt           a glob
 *     cat "*.txt"         a literal asterisk
 * work at the same time. Collapsing to a string here is the mistake that makes
 * naive shell implementations subtly and permanently wrong.
 */

export type TokenType =
  | "WORD"
  | "PIPE" // |
  | "AND" // &&
  | "OR" // ||
  | "SEMI" // ;
  | "AMP" // &
  | "GT" // >
  | "GTGT" // >>
  | "LT" // <
  | "EOF";

/** One run of characters within a word, tagged with how it was quoted. */
export interface Segment {
  text: string;
  /** True if this segment came from inside quotes — suppresses globbing. */
  quoted: boolean;
  /** True only for single quotes — additionally suppresses variable expansion. */
  literal: boolean;
}

export interface Word {
  segments: Segment[];
}

export interface Token {
  type: TokenType;
  /** Present only for WORD tokens. */
  word?: Word;
  /** Byte offset of the token start in the source string. */
  start: number;
  /** Byte offset one past the token end. */
  end: number;
}

export class ShellParseError extends Error {
  constructor(
    message: string,
    /** Column offset where the problem was detected. */
    public readonly column: number,
  ) {
    super(message);
    this.name = "ShellParseError";
  }
}

/** Collapse a word's segments into its literal text (post-quote-removal). */
export function wordText(word: Word): string {
  let out = "";
  for (const seg of word.segments) out += seg.text;
  return out;
}

/** True if any segment of the word was quoted — used to suppress globbing. */
export function wordIsQuoted(word: Word): boolean {
  return word.segments.some((s) => s.quoted);
}

const OPERATOR_CHARS = new Set(["|", "&", ";", ">", "<"]);

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/**
 * Tokenize a command line.
 *
 * @throws ShellParseError on an unterminated quote or a trailing backslash.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;

    // ── Whitespace ──
    if (isWhitespace(ch)) {
      i++;
      continue;
    }

    // ── Comments — everything to end of line ──
    if (ch === "#") break;

    // ── Operators ──
    if (OPERATOR_CHARS.has(ch)) {
      const start = i;
      const next = input[i + 1];

      if (ch === "|" && next === "|") {
        tokens.push({ type: "OR", start, end: i + 2 });
        i += 2;
      } else if (ch === "|") {
        tokens.push({ type: "PIPE", start, end: i + 1 });
        i += 1;
      } else if (ch === "&" && next === "&") {
        tokens.push({ type: "AND", start, end: i + 2 });
        i += 2;
      } else if (ch === "&") {
        tokens.push({ type: "AMP", start, end: i + 1 });
        i += 1;
      } else if (ch === ">" && next === ">") {
        tokens.push({ type: "GTGT", start, end: i + 2 });
        i += 2;
      } else if (ch === ">") {
        tokens.push({ type: "GT", start, end: i + 1 });
        i += 1;
      } else if (ch === "<") {
        tokens.push({ type: "LT", start, end: i + 1 });
        i += 1;
      } else {
        // ";"
        tokens.push({ type: "SEMI", start, end: i + 1 });
        i += 1;
      }
      continue;
    }

    // ── Word ──
    const start = i;
    const segments: Segment[] = [];
    let plain = "";

    const flushPlain = (): void => {
      if (plain.length > 0) {
        segments.push({ text: plain, quoted: false, literal: false });
        plain = "";
      }
    };

    while (i < input.length) {
      const c = input[i]!;

      if (isWhitespace(c) || OPERATOR_CHARS.has(c)) break;

      // Backslash escape outside quotes — next char is literal.
      if (c === "\\") {
        const escaped = input[i + 1];
        if (escaped === undefined) {
          throw new ShellParseError("Trailing backslash", i);
        }
        // Must flush pending plain text FIRST, or segment order is wrong and
        // `my\ file.txt` comes out as " myfile.txt".
        flushPlain();
        // Marked quoted so globbing is suppressed, and literal because an
        // escaped character means exactly itself.
        segments.push({ text: escaped, quoted: true, literal: true });
        i += 2;
        continue;
      }

      // Single quotes — fully literal, no expansion of any kind.
      if (c === "'") {
        flushPlain();
        const close = input.indexOf("'", i + 1);
        if (close === -1) {
          throw new ShellParseError("Unterminated single quote", i);
        }
        segments.push({
          text: input.slice(i + 1, close),
          quoted: true,
          literal: true,
        });
        i = close + 1;
        continue;
      }

      // Double quotes — variable expansion allowed later, globbing suppressed.
      if (c === '"') {
        flushPlain();
        let j = i + 1;
        let buf = "";
        let closed = false;
        while (j < input.length) {
          const d = input[j]!;
          if (d === "\\") {
            const nxt = input[j + 1];
            // Inside double quotes, backslash only escapes these four.
            if (nxt === '"' || nxt === "\\" || nxt === "$" || nxt === "`") {
              buf += nxt;
              j += 2;
              continue;
            }
            buf += d;
            j += 1;
            continue;
          }
          if (d === '"') {
            closed = true;
            break;
          }
          buf += d;
          j += 1;
        }
        if (!closed) {
          throw new ShellParseError("Unterminated double quote", i);
        }
        segments.push({ text: buf, quoted: true, literal: false });
        i = j + 1;
        continue;
      }

      plain += c;
      i += 1;
    }

    flushPlain();

    // A word can legitimately be empty only if it came from "" or '' — in that
    // case segments is non-empty, so this guard is about defensive safety.
    if (segments.length === 0) {
      segments.push({ text: "", quoted: true, literal: true });
    }

    tokens.push({ type: "WORD", word: { segments }, start, end: i });
  }

  tokens.push({ type: "EOF", start: input.length, end: input.length });
  return tokens;
}
