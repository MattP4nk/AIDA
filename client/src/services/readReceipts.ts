/**
 * Read receipts for mail the player SENT, between the socket and MailDialog.
 *
 * Review fix (2026-10-08). The store was a queue: socket.ts appended every
 * receipt and MailDialog cleared ALL of them whenever any arrived. So:
 *   - with the dialog closed, nothing consumed it and it grew for the whole
 *     session;
 *   - with the Inbox open, a receipt for a SENT message matched nothing and
 *     was still cleared — lost, so the Sent folder only caught up on refetch.
 * Now each id is held once (so the store is bounded by the messages the
 * player sent), and an id leaves only when it has been applied to a loaded
 * message — on arrival, or after the next folder load.
 */
export interface ReceiptTarget {
  id: string;
  isRead?: boolean;
}

/** Record a receipt. Idempotent: a message is held at most once. */
export function addReceipt(ids: string[], messageId: string): string[] {
  return ids.includes(messageId) ? ids : [...ids, messageId];
}

/**
 * Mark every loaded message that has a receipt as read. Returns whether
 * anything changed, and the ids still waiting for their message to be loaded.
 */
export function applyReceipts(
  messages: ReceiptTarget[],
  ids: string[],
): { changed: boolean; remaining: string[] } {
  let changed = false;
  const remaining: string[] = [];
  for (const id of ids) {
    const msg = messages.find((m) => m.id === id);
    if (!msg) {
      remaining.push(id);
      continue;
    }
    if (!msg.isRead) {
      msg.isRead = true;
      changed = true;
    }
  }
  return { changed, remaining };
}
