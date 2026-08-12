/**
 * Sanitizes user-controlled input before interpolation into AI prompts.
 * Wraps content in XML boundary tags so the model can distinguish
 * instruction from user input, and strips any injected boundary tags.
 */
export function sanitizeForPrompt(
  input: string,
  maxLength = 2000,
): string {
  const sanitized = input
    .replace(/<\/?user_message>/gi, "") // prevent boundary-tag injection
    .slice(0, maxLength);
  return `<user_message>\n${sanitized}\n</user_message>`;
}
