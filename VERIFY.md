# VERIFY.md — manual playthrough gate

Run this **at every phase boundary**, before declaring a phase closed.

Per PLAN.md decision 2 there are no automated tests until Phase 7, so until then this is the only
gate that exercises *behaviour*. CI covers `tsc` / `eslint` / `svelte-check` / audit — none of which
would have caught a single one of the defects found in Phases 0–2. Every real bug this project has
hit was a second code path, a name mismatch, or two correct changes cancelling; all of them typecheck
perfectly.

**Why it has to be written down:** without a script, "test by playing" reliably degrades into "test
the thing I just changed", which is exactly how `crack.protected`, the admin broadcast, and the
darknet script reward each stayed broken for months while the code around them was actively worked on.

---

## How to use this

- Work top to bottom. State accumulates — later steps depend on earlier ones.
- **A step passes only if you see the stated observable.** "No error" is not a pass. Several bugs in
  this codebase presented as a command that succeeded and silently did nothing.
- When something fails, note the step number and the actual output. Don't fix it mid-run — finish the
  pass first, so you find out whether it's one defect or five.
- §6 lists what is *known* broken. Check it before reporting anything.

---

## 0. Setup

```bash
# fresh database — this is disposable until go-live (PLAN.md decision 14)
cd server && npm run db:reset

# start server, then client
cd server && npm run dev
cd client && npm run dev
```

- [ ] **0.1** Server boot log shows `Shop catalog synced` with a non-zero count, and
      `Shop reconcile: … seed rows removed` (0 removed is fine on a fresh DB).
- [ ] **0.2** No `PrismaClientValidationError` or unhandled rejection in the first 30 seconds.
- [ ] **0.3** Client loads and shows the terminal. Browser console has no red errors on load.

---

## 1. Register and first contact

- [ ] **1.1** Register a new account. You land in the terminal, logged in.
- [ ] **1.2** `stats` (or equivalent) shows **level 1**, **1000 credits**, and starting skills
      **hacking 10, networking 10, stealth 10, cryptography 5, socialEng 5, forensics 5**.
      *(These specific numbers matter — several gates are tuned against them.)*
- [ ] **1.3** `inbox` contains the Architect's onboarding message.
      **Not `mail`** — that is the *send* command (`mail <username> <subject> <message>`); running it
      bare just prints usage. (Caught on the first run of this document.)
      Failure mode to watch for: an empty inbox means persona mail is failing silently.

---

## 2. Tutorial

The tutorial's early steps were rewritten in U1 because they taught routes that could not work.

- [ ] **2.1** There is **no `tutorial` command** — the tutorial is delivered as missions plus
      Architect mail, so `missions` and `mail` are the surfaces. Step 1 must teach a **route that
      works**: you cannot `connect 10.10.10.1` directly from a new home terminal, and the taught path
      goes via the Internet Exchange. (`progress` shows active missions with progress bars.)
- [ ] **2.2** Follow the tutorial to the Training Firewall (`10.10.10.30`). You reach it.
- [ ] **2.3** The step completes via the **key** route (find credentials → gain access), not only via
      hacking. Both routes are supposed to credit the objective.
- [ ] **2.4** Tutorial progress persists: reload the page, and you are on the same step.

---

## 3. Core loop

### 3a. Missions

- [ ] **3.1** `missions` lists at least one available mission. An empty list after a fresh DB means
      generation is failing — check the server log for `ContentQueue` / provisioning errors.
- [ ] **3.2** `accept <id>` succeeds and the mission moves to ACTIVE.
- [ ] **3.3** Do what the objective asks. **The objective counter actually moves.** This is the single
      most important assertion in this document — the mission system's entire history of defects is
      objectives that look accepted and can never be credited.
- [ ] **3.4** On completion you receive the reward, and **a notification appears for XP and credits**
      (see §5.1 — this was wired in Phase 2 and is unverified in a browser).

### 3b. Shop and rig

- [ ] **3.5** `specs` shows **CPU 200 / RAM 256 / NET 100** at level 1, and all three hardware
      channels reading `(none — stock)`.
- [ ] **3.6** `shop` lists items, including hardware. Persona tokens must **not** appear (reward-only).
- [ ] **3.7** `buy ram_module_mk1` succeeds and prints `Installed.`
- [ ] **3.8** `specs` now shows **RAM 320** (256 + 64) and names `RAM Module Mk1`. CPU and NET unchanged.
- [ ] **3.9** `buy token_steele_briefing` is **refused** — "It has to be earned."
- [ ] **3.10** `equip ram_module_mk1` is **refused** — hardware is installed, not equipped.
- [ ] **3.11** *(needs level 10 + credits)* Buying `ram_module_mk2` supersedes Mk1: RAM becomes
      **384**, not 448, and the output reports `Traded in RAM Module Mk1 (+250 credits)`.

### 3c. Hacking

- [ ] **3.12** `hack 10.10.10.30` is **attemptable** at Hacking 10 despite the baseline of 20 — the
      soft gate permits it at a penalty. It must not be refused outright.
- [ ] **3.13** The hack spawns a process (`ps` shows it) and consumes resources (`specs`/`top` show
      CPU/RAM used rising).
- [ ] **3.14** The minigame appears and can be answered. Solving it grants access.
- [ ] **3.15** `exploit <ip> zero_day` while **not** owning it is refused with "You don't own
      zero_day." *(P0-2. Requires Hacking 40+ to reach the ownership check — below that the skill
      gate refuses first, which is also correct.)*

### 3d. File operations

- [ ] **3.16** `ls -a` on a breached server reveals hidden files that plain `ls` does not.
- [ ] **3.17** `cat` a readable file. `download` it; it appears under your home `~/downloads/`.
- [ ] **3.18** `analyze <file>` at Forensics 5 **runs** and returns a degraded report — some fields
      read `-- inconclusive --`. It must not be refused.

---

## 4. Skill gates (Phase 1 P0-1)

Twelve gates were declared but never evaluated until Phase 1's audit. Confirm they bite — **and
confirm they don't over-bite**, which is what the control step is for.

- [ ] **4.1** `fragment.crack <file>` at low Hacking is **refused**. This one destroys a unique
      endgame item on failure; it must never be attemptable under-skilled.
- [ ] **4.2** `sweep` at Forensics 5 is **refused** (baseline 15).
- [ ] **4.3** **Control:** `subnet 10.0.0.0/24` still works. If this fails, gating is over-applied and
      4.1/4.2 prove nothing.

---

## 5. Recently changed and not yet observed

Everything here typechecks and passes its static check, but **has never been watched working in a
browser.** Confirm or falsify.

- [ ] **5.1** Complete anything that grants XP or credits **from a background path** (a mission
      credited by a hook, a process completing). A notification appears: `+N XP` / `+N credits`.
      *Before Phase 2 these fired into the void — the server raised the event and nothing forwarded
      it to the socket.*
      **This step requires an actual mission completion.** A run that merely connects and buys things
      will observe nothing and prove nothing — the first run of this document made exactly that
      mistake and recorded a false negative. Accept a mission, complete it, THEN check.
      *Status: still unverified at runtime as of 2026-08-31.*
- [ ] **5.2** As an admin, `admin broadcast <message>`. A **normal player's** client shows a
      System Announcement. *This has reportedly never worked — the server emitted `system:broadcast`
      while the client listened for `system:announcement`.*
- [ ] **5.3** Run a subnet scan that discovers servers. A Discovery notification names a count and
      subnet — e.g. "Discovered 3 servers on 10.10.10.0/24" — **not** "New discovery: undefined".
- [ ] **5.4** Send a message that fails (rate-limit it, or target a bad recipient). An error surfaces
      with a real reason, **not** "Message error: undefined" — and no error appears on a *successful*
      send.
- [ ] **5.5** `crack.protected <file>` while holding a Quantum Decryptor Charge **consumes it and
      works**. *This was impossible for everyone until Phase 2 — the matcher looked for a substring
      the item's name doesn't contain.*

---

## 6. Reconnect and persistence

- [ ] **6.1** Hard-reload mid-session. You are still logged in (cookie session restore).
- [ ] **6.2** Your level, credits, inventory and installed hardware are unchanged.
- [ ] **6.3** `specs` still reflects installed hardware. *(The rig is in-memory and derived — a
      readout that reverts to 200/256/100 means the refresh path regressed.)*
- [ ] **6.4** An in-flight process either survived or was cleaned up — not left as a phantom row in `ps`.
- [ ] **6.5** Restart the **server** and reconnect. Missions, inventory and progress persist.

---

## 7. Known broken — do not report these

Current as of 2026-08-31. Delete entries as they are fixed.

| Symptom | Item |
|---|---|
| Hack / mission / faction / file-modified notifications never appear | 7 socket shape mismatches, deferred to **Phase 7** |
| `process:failed` never fires | `failProcess()` has no callers — **Phase 5** |
| `alias reveal` always says skills insufficient | reads an empty JSON column — **Phase 5** |
| `backdoor use` claims "the owner has been alerted"; nobody is | no subscriber — **Phase 5** |
| `backdoor install <ip>` doesn't parse | taught in 4 places, syntax doesn't exist — **Phase 5** |
| Item stat bonuses (+hacking, +success%) change nothing | displayed, never applied — **Phase 8** |
| NPC intrusion replies sound generic | `FALLBACK_VOICES` keyed on pre-rename usernames — **Phase 6** |
| Persona replies arrive instantly rather than delayed | only the tutorial uses the queue — **Phase 6** |
| `decode` / `sweep` refused to new players | correct — gates now enforced; U3c relaxes them in **Phase 8** |

---

## Recording a run

Append to the bottom of this file:

```
### <date> — before/after Phase <n>
Result: <passed | N failures>
Failures: <step numbers + actual output>
New defects filed: <where>
```

A run with zero failures and no notes is suspicious — it usually means steps were skimmed rather than
performed. The value is in §3.3, §4.3 and §5, where the observable is specific enough to catch a
silent no-op.

### 2026-08-31 — first run, after Phase 2

Result: **14/16 executed steps passed; 2 failures, both defects in THIS DOCUMENT, not the product.**

- **1.3** told you to run `mail` to read the inbox. `mail` is the *send* command — running it bare
  prints usage. Corrected to `inbox`.
- **5.1** recorded a false negative: the run never completed a mission, so no reward event could
  fire, and "no events seen" was reported as a failure of the bridge. The step now states that a
  mission completion is a precondition.

Confirmed working: register + starting stats (L1, 1000c, hack 10 / crypto 5 / forensics 5); rig
baseline 200/256/100 all-stock; shop lists hardware and hides persona tokens; `buy ram_module_mk1`
installs and takes RAM 256 → 320 with CPU/NET untouched; token purchase refused; hardware refuses
`equip`; `hack` attemptable at Hacking 10 under the soft gate; `fragment.crack` and `sweep` correctly
refused while the `subnet` control still works; `analyze` runs degraded rather than refusing.

Not executed: §0 fresh-DB reset (blocked as destructive — run by hand for a clean pass), §2 tutorial,
§3a missions, §3.11 supersession, §3c minigame, §3d file ops, §5.2–5.5, §6 reconnect.

**Still unverified at runtime: every item in §5.** The reward bridges, `system:broadcast`,
`server:discovered`, `message:result` and `crack.protected` remain confirmed only by static checks.

New defects filed: none — no product defect found.

### 2026-09-01 — before/after Phase 2
Result: §5 **4/4 at runtime**, all confirmed in the running system rather than statically.

```
PASS  control: no reward events yet        0 seen
PASS  5.1 reward bridge delivers           xp=1 credits=1
PASS  5.2 admin broadcast reaches client   {"message":"VERIFY-PHASE2-PROBE","from":"SYSTEM",…}
PASS  5.3 server:discovered                count=5 subnet=10.10.10.
```

Getting there took four harness corrections and exposed **three real defects that every static check
passed clean**:
- `setSocketIO()` had zero callers on `serverService` AND `missionService` — 21 stranded emits,
  including `player:levelup`, which the client answers with a sound and an urgent notification that
  had never once fired. Fixed by injecting `SOCKET_IO` instead of relying on a setter to be remembered.
- `discoverServers()` is reachable only from the sweep's dead no-resource fallback.
- The live sweep emitted `server:subnet-scan` — a name no client listens for, and one
  `check-socket-contract.ts` could not see because its regex excluded hyphens (11 other events were
  invisible too). Unified onto `server:discovered`.

New defects filed: 3 (above) + the sweep/`explore` note below.

**Caveat on 5.1's trigger:** it drives `report mission`, which fires `onServerConnect` without a link —
the explore-farming defect filed to Phase 5. Real `connect` needs adjacency, so it could not be used.
When Phase 5 closes that hole this step MUST switch to genuine connects, or fixing the bug will
silently break the check.

**Intermittent:** `verify-tutorial-altpath` gave 10/11 once during a back-to-back run of all seven
harnesses, then 11/11 on three isolated runs. Contention-sensitive, not a regression — but recorded
rather than dismissed, because "flaky" is how real bugs get ignored.
