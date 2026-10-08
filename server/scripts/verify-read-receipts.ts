/**
 * Read receipts — bounded, and never dropped before they are applied.
 *
 * Review finding (2026-10-08) on 46f6fc0. socket.ts appended every
 * `message:read_receipt` to a store and MailDialog cleared ALL of it whenever
 * a receipt arrived:
 *   - dialog closed: nothing consumed the store, so it grew all session;
 *   - Inbox open: a receipt for a SENT message matched nothing and was
 *     cleared anyway, so it was lost.
 * The logic now lives in client/src/services/readReceipts.ts, which both the
 * socket handler and MailDialog call; this drives it directly.
 *
 * Run: npx tsx scripts/verify-read-receipts.ts
 */
let pass = 0, fail = 0;
function check(n: string, ok: boolean, d = "") {
  if (ok) { pass++; console.log(`  [PASS] ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${n}${d ? ` — ${d}` : ""}`); }
}

async function main() {
  console.log("\n=== Read receipts ===");
  const R = await import("../../client/src/services/readReceipts.ts");

  console.log("\nRR-1 — the store is bounded while nothing consumes it");
  {
    let ids: string[] = [];
    for (let i = 0; i < 1000; i++) ids = R.addReceipt(ids, `m${i % 3}`); // the same 3 messages, again and again
    check("1000 receipts for 3 messages hold 3 ids (was: 1000)", ids.length === 3, `${ids.length}`);
  }

  console.log("\nRR-2 — a receipt for a message not loaded right now is KEPT");
  {
    const inbox = [{ id: "in1", isRead: false }];
    const r = R.applyReceipts(inbox, ["sent7"]);
    check("Inbox open: the Sent receipt stays pending (was: cleared, lost)", r.remaining.length === 1 && r.remaining[0] === "sent7");
    check("and the Inbox is untouched", r.changed === false && inbox[0]!.isRead === false);
    // ...then the Sent folder loads.
    const sent = [{ id: "sent7", isRead: false }, { id: "sent8", isRead: false }];
    const r2 = R.applyReceipts(sent, r.remaining);
    check("Sent loads: it is applied", r2.changed === true && sent[0]!.isRead === true && sent[1]!.isRead === false);
    check("and consumed", r2.remaining.length === 0);
  }

  console.log("\nRR-3 — POSITIVE: a receipt for a loaded message applies at once");
  {
    const sent = [{ id: "a", isRead: false }];
    const r = R.applyReceipts(sent, ["a"]);
    check("applied and consumed", r.changed && sent[0]!.isRead === true && r.remaining.length === 0);
    const again = R.applyReceipts(sent, ["a"]);
    check("an already-read message is consumed without a change", !again.changed && again.remaining.length === 0);
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.exitCode = fail > 0 ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exit(1); });
