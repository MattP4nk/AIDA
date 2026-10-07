/**
 * Mute enforcement — the half of `admin mute` that was missing.
 *
 * `admin mute <user> <minutes>` wrote `user.mutedUntil` and replied "Muted",
 * and NOTHING read the field: a muted player kept chatting, mailing and
 * posting. The channels that reach other players — private messages and mail
 * (messageService.sendPrivateMessage), forum posts and replies — now refuse
 * while a mute is active. Messages to AI personas are not player-to-player
 * and are left alone.
 */
export function activeMuteMessage(mutedUntil: Date | null | undefined, now: Date = new Date()): string | null {
  if (!mutedUntil || mutedUntil <= now) return null;
  return `You are muted until ${mutedUntil.toISOString().slice(0, 16).replace("T", " ")} UTC.`;
}
