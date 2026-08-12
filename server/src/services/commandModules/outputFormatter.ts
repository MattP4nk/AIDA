/**
 * outputFormatter.ts — Post-processing utility that reformats command output
 * to fit the client's terminal width.
 *
 * Applied after command execution, before sending to client.
 * Strategy:
 *   - Lines with box-drawing characters are left untouched (already sized by context.terminalWidth)
 *   - Plain text lines longer than the target width are word-wrapped
 *   - Preserves intentional line breaks and empty lines
 */

import { TERM_WIDTH } from "./asciiBox";

// Detect any box-drawing characters (double or single line)
const HAS_BOX_CHARS = /[╔╗╚╝╠╣║═┌┐└┘├┤│─┬┴┼]/;

/**
 * Word-wrap a plain text line at word boundaries.
 */
function wordWrap(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > maxWidth) {
    // Find last space within maxWidth
    let breakAt = remaining.lastIndexOf(" ", maxWidth);
    if (breakAt <= 0) {
      // No space found — force break
      breakAt = maxWidth;
    }
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).trimStart();
  }

  if (remaining.length > 0) {
    lines.push(remaining);
  }

  return lines;
}

/**
 * Format command output to fit within the target terminal width.
 * Box-drawing lines pass through unchanged. Plain text is word-wrapped.
 */
export function formatCommandOutput(
  output: string | string[],
  terminalWidth?: number,
): string | string[] {
  const width = terminalWidth && terminalWidth > 40 ? terminalWidth : TERM_WIDTH;

  if (Array.isArray(output)) {
    return output.flatMap((line) => {
      // Skip box-drawing lines — they're already sized correctly
      if (HAS_BOX_CHARS.test(line)) return [line];
      // Word-wrap plain text
      if (line.length > width) return wordWrap(line, width);
      return [line];
    });
  }

  // String output
  const lines = output.split("\n");
  const formatted = lines.flatMap((line) => {
    if (HAS_BOX_CHARS.test(line)) return [line];
    if (line.length > width) return wordWrap(line, width);
    return [line];
  });
  return formatted.join("\n");
}
