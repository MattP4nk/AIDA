/**
 * Sanitizes user-controlled input before interpolation into AI prompts.
 * Wraps content in XML boundary tags so the model can distinguish
 * instruction from user input, and strips any injected boundary tags.
 */

/**
 * Every boundary tag this module uses. Untrusted text must have ALL of them
 * stripped, not just the one it is about to be wrapped in — otherwise a
 * payload closing a *different* tag escapes its container.
 */
const BOUNDARY_TAGS = ["user_message", "conversation_history", "entry"] as const;

const BOUNDARY_TAG_RE = new RegExp(
  `<\\/?(?:${BOUNDARY_TAGS.join("|")})[^>]*>`,
  "gi",
);

/**
 * Strip boundary tags from an untrusted fragment WITHOUT wrapping it.
 *
 * For values interpolated into prompt prose rather than presented as a block —
 * usernames, handles, topic labels. These were interpolated raw on the grounds
 * that they are "just a name", but a username is player-chosen text and can
 * close a tag as easily as a message body can.
 */
export function stripPromptBoundaries(input: string, maxLength = 200): string {
  return String(input ?? "")
    .replace(BOUNDARY_TAG_RE, "")
    .slice(0, maxLength);
}

export function sanitizeForPrompt(input: string, maxLength = 2000): string {
  const sanitized = String(input ?? "")
    .replace(BOUNDARY_TAG_RE, "") // prevent boundary-tag injection
    .slice(0, maxLength);
  return `<user_message>\n${sanitized}\n</user_message>`;
}

export interface TranscriptEntry {
  /** Who said it. Player-controlled in practice — sanitized like any other. */
  role: string;
  content: string;
}

/**
 * S6c. Sanitize a CONVERSATION HISTORY, not just the current turn.
 *
 * This is the gap that made the current-turn sanitizer decorative. In
 * `messageService.generatePersonaReply` the history was assembled by mapping
 * `pm.content` straight into a string, and `sanitizeForPrompt` was imported on
 * the line *after* that loop and applied only to the latest subject and body.
 * So the bypass was structural, not subtle:
 *
 *   turn N    player sends the payload -> wrapped in <user_message>, ignored
 *   turn N+1  the same text is read back out of `personaMessage.content`
 *             and spliced into the prompt BARE
 *
 * An attacker just sends their payload and then says "hi". The same shape
 * exists in `forumService.handleNPCReply`, where the replayed NPC `memory` is
 * itself an AI-extracted summary of earlier player text — so the injection
 * persists across conversations rather than lasting one turn.
 *
 * Roles are sanitized too: the role is `playerUsername`, which is
 * player-chosen.
 */
export function sanitizeTranscript(
  entries: readonly TranscriptEntry[],
  opts: { maxEntries?: number; maxEntryLength?: number } = {},
): string {
  const { maxEntries = 20, maxEntryLength = 1000 } = opts;

  if (!Array.isArray(entries) || entries.length === 0) return "";

  const lines = entries
    .slice(-maxEntries) // keep the most recent
    .filter((e): e is TranscriptEntry => !!e && typeof e.content === "string")
    .map((e) => {
      const role = stripPromptBoundaries(e.role ?? "unknown", 64);
      const content = String(e.content)
        .replace(BOUNDARY_TAG_RE, "")
        .slice(0, maxEntryLength);
      return `<entry from="${role}">\n${content}\n</entry>`;
    });

  if (lines.length === 0) return "";

  return `<conversation_history>\n${lines.join("\n")}\n</conversation_history>`;
}
