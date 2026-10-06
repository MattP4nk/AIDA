/**
 * Phase 5 — code review pass 3. Verifies the fixes made in response to the
 * review, most of which were defects in EARLIER Phase 5 fixes.
 *
 *  RV-1  DOWNLOAD DOUBLE-EMIT. The success emit was gated on `context.io`
 *        alone, not on `result.success`, so adding a failure branch made a
 *        failed download emit BOTH a success and a failure message.
 *
 *  RV-2  ABANDON DESTROYED THE STORY ARC. `mission:failed` drives
 *        `advanceStory(id, "failed")`, which can set arc.status="failed"
 *        permanently — while abandonMission returns the row to the pool.
 *
 *  RV-3  EPOCH EVENT CONSUMED ON A NO-OP. The no-successor branch was still
 *        written as status:"fired", success:true, so the advance could never
 *        happen later once a successor epoch was authored.
 *
 *  RV-4  CLIENT: severity->priority rename missed at socket.ts, badge counted
 *        every notification type, clearNotifications marked nothing read,
 *        reconnect gave up after ~31s, auth failure skipped tab init.
 *
 * Run: npx tsx scripts/verify-phase5-review3.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Match code, not the comments that describe the code. */
const strip = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const read = (rel: string) =>
  strip(readFileSync(new URL(rel, import.meta.url).pathname, "utf8"));

async function main() {
  // ── RV-1: exactly one command:result per download ──────────────────────
  console.log("\nRV-1 — a download emits exactly one result");
  {
    const src = read("../src/services/commandModules/fileCommands.ts");
    check(
      "the success emit is gated on result.success",
      /if \(result\.success && context\.io\)/.test(src),
      "was `if (context.io)` — fired even when createFile returned success:false",
    );
    check(
      "the failure emit is gated on !result.success",
      /if \(!result\.success && context\.io\)/.test(src),
    );
    // Bounding assertion from the other side: the two guards must be
    // complementary, so no reachable state emits both or neither.
    const successGuards = (src.match(/if \(result\.success && context\.io\)/g) || []).length;
    const failureGuards = (src.match(/if \(!result\.success && context\.io\)/g) || []).length;
    check(
      "the two guards are complementary and unique",
      successGuards === 1 && failureGuards === 1,
      `${successGuards} success guard, ${failureGuards} failure guard`,
    );
    // Negative control: an ungated `if (context.io) {` immediately preceding
    // the download output would reintroduce the bug.
    check(
      "no ungated io-emit remains on the download path",
      !/if \(context\.io\) \{\s*\n\s*let downloadOutput/.test(src),
      "the exact shape the bug had",
    );
  }

  // ── RV-2: abandoning is not a narrative failure ────────────────────────
  console.log("\nRV-2 — abandoning a story mission does not branch the arc");
  {
    const idx = read("../src/index.ts");
    check(
      "the mission:failed listener distinguishes abandonment",
      /const abandoned = data\.reason === "abandoned"/.test(idx),
    );
    check(
      "advanceStory is skipped for abandonment",
      /if \(data\.missionId && !abandoned\)[\s\S]{0,200}?advanceStory\(data\.missionId, "failed"\)/.test(idx),
      "walking failureBranch can set arc.status='failed' with no way back",
    );
    check(
      "but the ledger still records the abandonment",
      /recordEvent\(\{[\s\S]{0,400}?abandoned \? "Abandoned" : "Failed"/.test(idx),
      "the narrative remembers it; it just does not branch on it",
    );

    // Bounding from the producer side: expiry must still be treated as a
    // real failure, or this fix would have silently disabled arc failure.
    const ms = read("../src/services/missionService.ts");
    check(
      "expiry still emits a reason that DOES advance the arc",
      /this\.emit\("mission:failed", \{[\s\S]{0,120}?reason: "expired"/.test(ms),
      "running out of time is a genuine failure",
    );
    check(
      "abandon emits the reason the listener keys on",
      /this\.emit\("mission:failed", \{[\s\S]{0,120}?reason: "abandoned"/.test(ms),
    );
    // The contradiction that made this a bug: the row goes back in the pool.
    check(
      "abandon still returns the mission to the pool",
      /status: "available",\s*\n\s*assignedTo: null/.test(ms),
      "which is why failing the arc for it was incoherent",
    );
  }

  // ── RV-3: a declined epoch advance stays pending ───────────────────────
  console.log("\nRV-3 — a no-op epoch advance does not consume the event");
  {
    const src = read("../src/services/epochSchedulerService.ts");
    check(
      "the no-successor branch flags itself for retry",
      /advanced: false,[\s\S]{0,160}?__retry: true/.test(src),
    );
    check(
      "fireEvent returns before markEventResult when retrying",
      /if \(\(result as any\)\.__retry\)[\s\S]{0,400}?return;/.test(src),
      "markEventResult would have written status:'fired', success:true",
    );
    // Ordering assertion: the retry guard must precede the markEventResult
    // call, or it cannot prevent anything.
    const guardAt = src.indexOf("__retry");
    const markAt = src.indexOf('markEventResult(event.id, "fired"');
    check(
      "the retry guard precedes the fired-write",
      guardAt !== -1 && markAt !== -1 && guardAt < markAt,
      `guard@${guardAt} < write@${markAt}`,
    );
    check(
      "both advance_epoch exits share a return shape",
      (src.match(/advanced: (true|false)/g) || []).length === 2,
      "callers can ask 'did it advance?' without knowing the branch",
    );
  }

  // ── RV-4: the client fixes ─────────────────────────────────────────────
  console.log("\nRV-4 — client: notifications, badge, reconnect, init");
  {
    const sock = read("../../client/src/services/socket.ts");
    const term = read("../../client/src/components/Terminal.svelte");
    const panel = read("../../client/src/components/NotificationPanel.svelte");
    const app = read("../../client/src/App.svelte");

    check(
      'no "urgent" priority survives anywhere in the client',
      !/"urgent"/.test(sock) && !/"urgent"/.test(term),
      "the server never sends it; it matched no sound, colour, or CSS rule",
    );
    check(
      "the severity mapping now yields critical",
      /severity === "critical" \? "critical" : "high"/.test(sock),
      "was `? \"urgent\" :` — critical alerts got LESS treatment than high",
    );
    check(
      "the priority CSS rule was renamed with it",
      /\.notif-priority\.critical \{/.test(panel) && !/\.notif-priority\.urgent \{/.test(panel),
      "the template interpolates the raw priority into the class",
    );

    check(
      "the mail/chat badge counts only mail and chat",
      /unreadCount = unreadChatCount \+ unreadMailCount/.test(term),
      "was $unreadCounts.total — a game notification showed as '📧 1 / 0 mail'",
    );
    check(
      "clearNotifications marks read instead of assigning to derived vars",
      /markAllAsRead\("chat"\)/.test(term) && /markAllAsRead\("mail"\)/.test(term) &&
        !/unreadCount = 0/.test(term),
      "assignments to a `$:` variable are clobbered on the next store update",
    );

    check(
      "reconnect retries indefinitely with a capped delay",
      /maxReconnectDelay/.test(sock) && !/maxReconnectAttempts/.test(sock),
      "a 5-attempt ceiling is ~31s; socket.io's default was Infinity",
    );
    check(
      "the backoff is actually clamped",
      /Math\.min\(\s*this\.reconnectDelay \* Math\.pow\(2, this\.reconnectAttempts - 1\),\s*this\.maxReconnectDelay,?\s*\)/.test(sock),
    );

    check(
      "socket auth failure no longer skips terminal tab init",
      /catch \(authError\)[\s\S]{0,400}?\}\s*\n\s*\}\s*\n\s*\n?\s*await terminalTabsStore\.initialize\(\)/.test(app),
      "the outer catch set isTerminalReady with zero tabs loaded",
    );
  }

  console.log(`\n=== ${pass} PASS / ${fail} FAIL ===`);
  process.stdout.write("", () => process.exit(fail > 0 ? 1 : 0));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
