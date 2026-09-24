# AIDA Shell — Design

Design for a real shell layer inside the AIDA terminal. Companion to `PLAN.md` Phase 9.

**Goal:** pipes, redirection, quoting, globbing, variables, exit codes, and job control — without
rewriting the 17 existing command modules, and without regressing any current behaviour.

---

## 1. Premise: there is no shell to inject into

`validators.ts:244` currently rejects `|`, `;[\s]*rm`, `$(`, and backticks as "command injection."
Verified across all of `server/src`: **zero** `child_process`, `exec`, `execSync`, or `spawn`.
Commands dispatch through `registry.ts` to TypeScript methods operating on a Postgres-backed
virtual filesystem.

Those characters are therefore not dangerous — they are **unparsed syntax**. This design replaces
character blocklisting with a real grammar plus structural and resource limits, which is a
strictly stronger security posture (see §9).

---

## 2. Architecture

Five layers. Only the last one touches existing code.

```
raw string
    │
    ▼
┌─────────────┐  shared/shell/lexer.ts      quotes, escapes, operators
│   Lexer     │  → Token[]                  (shared client+server)
└─────────────┘
    │
    ▼
┌─────────────┐  shared/shell/parser.ts     grammar → AST
│   Parser    │  → Node                     (shared client+server)
└─────────────┘
    │
    ▼
┌─────────────┐  server/shell/expander.ts   alias, tilde, $VAR, globs
│  Expander   │  → Node (expanded)          SERVER ONLY (needs FS + env)
└─────────────┘
    │
    ▼
┌─────────────┐  server/shell/executor.ts   streams, exit codes, jobs
│  Executor   │  → ExitCode                 SERVER ONLY
└─────────────┘
    │
    ▼
┌─────────────┐  services/commandModules/*  existing modules, unchanged
│  Commands   │  + new stream-aware utils
└─────────────┘
```

**Why the lexer and parser are shared:** the server needs them to execute; the client needs them
to know *what the cursor is sitting on* (command position vs. argument position vs. inside a
quote) so tab completion can ask the right question, and to highlight syntax and matching quotes.
One implementation, two consumers. This is a genuinely good use of `shared/`, which is currently
near-dead weight.

**Why expansion and execution are server-only:** globbing needs filesystem access, variables live
server-side, and the client cannot be trusted in a game with cheating incentives. The client's
copy is advisory (UX only); the server's parse is authoritative.

---

## 3. Lexer

### Tokens

| Token | Lexeme |
|---|---|
| `WORD` | a sequence of segments (see below) |
| `PIPE` | `\|` |
| `AND` / `OR` | `&&` / `\|\|` |
| `SEMI` / `AMP` | `;` / `&` |
| `GT` / `GTGT` / `LT` | `>` / `>>` / `<` |
| `EOF` | — |

### Quoting rules

- `'…'` — literal; no expansion of any kind.
- `"…"` — `$VAR` expands; `\` escapes only `$ " \`; globs do **not** expand.
- `\x` — literal `x`.
- Unquoted — subject to variable expansion, then globbing.

A `WORD` is **not** a plain string. It is a list of segments, each tagged with whether it was
quoted, because expansion must know:

```ts
type Segment = { text: string; quoted: boolean };
type Word = { segments: Segment[] };
```

This is what makes `cat "my file.txt"` work while `cat *.txt` still globs — and what stops
`cat "*.txt"` from globbing. Collapsing to a string here is the mistake that makes every
naive shell implementation wrong.

### Error handling

Unterminated quote → `ShellParseError` with a column offset. The client's copy of the lexer uses
the same error to render an inline caret before the user even hits Enter.

---

## 4. Grammar

POSIX-shaped, deliberately reduced:

```
list        := andOr ( ( ';' | '&' ) andOr )*
andOr       := pipeline ( ( '&&' | '||' ) pipeline )*
pipeline    := command ( '|' command )*
command     := WORD+ redirect*
redirect    := ( '>' | '>>' | '<' ) WORD
```

Deliberately **excluded from v1**, in rough order of when they'd be added:
- Command substitution `$(…)` — very thematic (`connect $(scan | head -1)`), but introduces
  recursion and a nesting-depth budget. **v2.**
- Subshells `( … )`, functions, `if`/`while`/`for` — **v3**, and only if scripting (§8) demands it.
- Here-docs, process substitution, arithmetic `$(( ))` — likely never; `ExpressionEngine` already
  covers arithmetic through the `expr` command.

### AST

```ts
type Node = ListNode | AndOrNode | PipelineNode | CommandNode;

interface CommandNode {
  kind: "command";
  words: Word[];                 // words[0] is the command name pre-expansion
  redirects: RedirectNode[];
}
interface RedirectNode {
  kind: "redirect";
  op: ">" | ">>" | "<";
  target: Word;
}
interface PipelineNode  { kind: "pipeline"; stages: CommandNode[]; }
interface AndOrNode     { kind: "andor"; op: "&&" | "||"; left: Node; right: Node; }
interface ListNode      { kind: "list"; items: { node: Node; background: boolean }[]; }
```

---

## 5. Expansion

Applied per `CommandNode`, in this order (POSIX order, minus the excluded stages):

1. **Alias** — only on `words[0]`, only at pipeline-stage start, **non-recursive** (one pass; an
   alias whose expansion names itself is left alone). Reuses the existing `aliasCommands` store.
2. **Tilde** — leading `~` → the player's home directory on their home server; `~-` → previous cwd.
3. **Variable** — `$NAME` / `${NAME}` from the session environment (§7). Unset → empty string.
   `$?` → last exit code. Only in unquoted and double-quoted segments.
4. **Glob** — `*`, `?`, `[…]` against the virtual FS, on unquoted segments only.
5. **Quote removal** — segments collapse to final argument strings.

### Globbing details

Patterns match within a single path component; `*` does not cross `/`. Resolution walks the
existing `fileService.resolvePath` tree scoped by `serverId`, then filters the directory listing.

- **No match →** the pattern is left literal (bash default). Predictable, and avoids "no such
  file: <nothing>" confusion.
- **Hidden files** are excluded unless the pattern starts with `.` — matches real shell behaviour
  and makes the existing `ls -a` distinction meaningful.
- **Expansion cap:** `MAX_GLOB_MATCHES = 1000`. Exceeding it fails the command with a clear error
  rather than materializing an enormous argv (see §9).

---

## 6. Execution

### 6.1 The central problem

17 command modules, 100+ commands, all shaped like:

```ts
execute(command: Command, context: CommandContext): Promise<CommandResult>
// CommandResult { success: boolean; output: string; data?: unknown; timestamp: Date }
```

We must not rewrite them. **We don't have to** — because of one asymmetry:

> In a pipeline, only the *consumers* need to be stream-aware. Producers just need their output
> captured.

`ls | grep root` requires nothing of `ls` beyond what it already does. So:

- **Existing commands work unchanged as pipeline sources**, via an adapter.
- **New text utilities** (`grep`, `wc`, `head`, `tail`, `sort`, `uniq`, `find`) are written
  stream-aware from day one.
- Migration to streaming is **opt-in, per command, forever optional**.

### 6.2 The stream-aware interface

```ts
interface ShellIO {
  stdin: AsyncIterable<string> | null;   // null when not piped into
  stdout: { write(line: string): void };
  stderr: { write(line: string): void };
  env: Map<string, string>;
  cwd: string;
  serverId: string;
  signal: AbortSignal;                   // Ctrl+C, kill, timeout
}

interface StreamCommand {
  readonly streaming: true;
  run(argv: string[], io: ShellIO, ctx: CommandContext): Promise<number>;  // exit code
}
```

### 6.3 The adapter

```ts
async function runLegacy(mod, cmd, ctx, io: ShellIO): Promise<number> {
  const result = await mod.execute(cmd, ctx);
  if (result.output) {
    for (const line of result.output.split("\n")) io.stdout.write(line);
  }
  return result.success ? 0 : 1;
}
```

A legacy command in the *middle* of a pipeline silently ignores stdin — same as a real shell
running a program that doesn't read stdin. No special case needed.

### 6.4 Pipeline execution

Stages run **concurrently**, connected by bounded async queues (backpressure at
`PIPE_BUFFER = 1000` lines), exactly like a real shell — not sequentially with buffering. This is
what makes `hack 10.0.0.5 | grep -i breach` show lines as they happen rather than after the hack
completes.

Pipeline exit code = last stage's exit code.

### 6.5 Redirection

`>` / `>>` write into the virtual FS through `fileService.createFile` / an appended write — so
permission checks, `MAX_FILE_SIZE_MB`, and `MAX_FILES_PER_USER` all apply for free. `<` opens a
file as stdin, subject to the same read permission checks as `cat` (including the ancestor checks
added in R11).

This is where redirection earns its keep as *gameplay*: `scan > targets.txt` produces a real
artifact another player can steal.

### 6.6 Signals and cancellation

Every job owns an `AbortController`. Ctrl+C sends `SIGINT` to the foreground job; `kill <pid>`
sends to any job. Stream commands check `io.signal.aborted` in their loops; legacy commands can't
be interrupted mid-call, so they're abandoned at the adapter boundary and their output discarded.

---

## 7. Environment and session state

```ts
interface ShellSession {
  env: Map<string, string>;   // USER, HOST, PWD, HOME, PS1, ?
  cwd: string;
  prevCwd: string;            // for `cd -`
  lastExit: number;           // $?
  jobs: Map<number, Job>;     // PID → job
}
```

Persisted per **terminal**, not per user — each tab is its own shell, which is what makes the
existing multi-tab feature feel real. Seeded at login from `.aidarc` (§8).

**This fixes R12 as a side effect.** Today `cd` writes `session.currentDirectory` while the crack
commands read `terminals[0].currentDirectory`, so `cd /data` then `crack vault.enc` fails. With
cwd owned by the shell session per terminal, there is exactly one source of truth.

Built-ins that must run in-process (they mutate session state, so they cannot be a subprocess):
`cd`, `export`, `unset`, `alias`, `unalias`, `jobs`, `fg`, `bg`, `exit`, `source`.

---

## 8. `.aidarc` and scripting

Once §3–§7 exist, scripting is mostly free:

- **`.aidarc`** — executed at login from the player's home directory. Sets aliases, env, `PS1`.
  Thematically strong: players customize their own rig, and it's a natural late-tutorial beat.
- **`run script.sh`** — execute a file from the virtual FS line by line through the same executor.
  Note `.env.example` already declares `SCRIPT_EXECUTION_TIMEOUT_MS` and `SCRIPT_MEMORY_LIMIT_MB`;
  someone planned this once.
- Control flow (`if`, `while`) is the v3 grammar extension, and only if scripts actually want it.
  A surprising amount is expressible with `&&` / `||` alone.

Scripts run under the same resource accounting and timeout as any pipeline — a runaway script
exhausts the player's CPU/RAM budget and dies, which is both correct and thematic.

---

## 9. Security model

Replacing the blocklist with a grammar means the limits must be **structural and resource-based**.
This bounds real cost instead of pattern-matching scary characters:

| Limit | Value | Rationale |
|---|---|---|
| `MAX_PIPELINE_STAGES` | 16 | bounds concurrent stage count |
| `MAX_AST_DEPTH` | 32 | bounds parser/executor recursion |
| `MAX_GLOB_MATCHES` | 1000 | prevents argv explosion on a large tree |
| `MAX_ARGV_LENGTH` | 4096 | post-expansion total |
| `PIPE_BUFFER` | 1000 lines | backpressure, bounds memory per stage |
| `MAX_SUBST_DEPTH` (v2) | 4 | bounds `$(…)` recursion |
| command length | 1000 | already enforced |
| execution timeout | `SCRIPT_EXECUTION_TIMEOUT_MS` | already in config |

Plus, unchanged and still load-bearing:
- Redirection targets go through `fileService` permission checks and `pathSanitizer`.
- Each stage draws CPU/RAM/bandwidth from the existing `memoryService` budget; a pipeline that
  can't afford its stages fails cleanly.
- `validateCommand`'s **null-byte and length checks stay**. Only the metacharacter blocklist is
  removed, and only once the parser handles those characters.

---

## 10. Socket protocol changes

**There is already a precedent in the tree, and this design extends it rather than replacing it.**
The uncommitted work converted `upload`, `analyze`, `probe`, and `whois` into background processes
that emit their result out-of-band on completion:

```ts
const spawn = await spawnBackgroundProcess({ context, processType: "probe", … onComplete: async () => {
  context.io.to(`player:${context.userId}`).emit("command:result", { success, output, terminalId, timestamp });
}});
```

That is already half of streaming — deferred, correlated by `terminalId`, emitted rather than
returned. What it lacks is *incremental* output and a completion signal. The events below
generalize that existing pattern; `spawnBackgroundProcess` becomes the natural place to adopt them,
and the four already-converted commands are the obvious first migrations (step 8 in §11).

Streaming needs the protocol to stop being request/response. Additive, so old clients keep working:

```
client → server   command:execute   { input, terminalId }           (unchanged)
server → client   command:started   { jobId, pid }                  (new)
server → client   command:output    { jobId, stream: "out"|"err", lines: string[] }  (new)
server → client   command:complete  { jobId, exitCode }             (new)
client → server   command:signal    { jobId, signal: "SIGINT" }     (new)
```

`command:result` is retained and still emitted for non-streaming commands, so the migration is
incremental. These four new events go into the typed event map from Phase 7 (`A3`) — adding them
to a stringly-typed contract is how the existing 11 dead listeners happened.

---

## 10a. Navigation: `cd`, `ls`, and moving around a server

Audited 2026-08-30 against `systemCommands.ts:173-310`, `helpers.ts:20`, `fileService.ts:193`.

**What's already right:** the prompt is `username@server:cwd$` (`Terminal.svelte:1479`), so
orientation is solid. Don't change it.

### Bugs that make navigation painful today

| # | Problem | Location |
|---|---|---|
| N1 | `ls -l` and `ls -a` **fail outright** — `resolvePath(args[0] \|\| currentDir)` takes `-l` as the path → `/-l` → "Directory not found". Only bare `ls` works. | `systemCommands.ts:187` |
| N2 | **`cd` is O(children) database queries.** It validates the target by calling `listDirectory`, which permission-checks every child (the N+1 at `fileService.ts:193`). Entering a large directory is slow *by design of the check*. | `systemCommands.ts:270` |
| N3 | **`cd ~` is broken** — expands to `/home/${session.userId}` (a cuid) but home directories are `/home/{username}` (`gameStateManager.ts:683,855`). | `systemCommands.ts:275` |
| N4 | **Three conflicting meanings of `~`** in one path: `helpers.resolvePath` maps `~` → `/` (server root); `handleChangeDirectory` maps it to `/home/{userId}`; reality is `/home/{username}`. | `helpers.ts:21-29` + `systemCommands.ts:275` |
| N5 | **`cd` with no argument goes to `/`, not home.** Every shell on earth sends you `$HOME`. | `systemCommands.ts:272` |
| N6 | **`cd` prints `Changed directory to /x` on success.** Real shells are silent. With the typewriter effect, every navigation costs a line of scrollback and a beat of time. | `systemCommands.ts:290` |
| N7 | **`ls` is one entry per line inside a drawn box.** A 30-file directory is 30+ lines plus borders, where a real `ls` is 4 dense columns. This is likely the single largest felt cost. | `systemCommands.ts:243` |
| N8 | No `tree`, no `find` — verified, zero matches repo-wide. In a game *about* exploring filesystems, structure below the current level is invisible. | — |
| N9 | No `cd -`, no path completion. | — |
| N10 | `ls -l` falls back to a literal `"rwxr-xr-x"` when permissions are absent, so the column can show fiction. | `systemCommands.ts:227` |

### The presentation rule

The ASCII box aesthetic (`asciiBox.ts`, `outputFormatter.ts`) is deliberate and worth keeping —
but it should be applied by **read frequency**, not uniformly:

> **Boxes for things you read once. Dense text for things you read constantly.**

`whois`, `probe`, `player`, mission briefings — reports, read once, boxes earn their space.
`ls`, `cd`, `pwd` — navigation, read hundreds of times per session, must be dense and fast.
`ls` should be multi-column and width-aware; `context.terminalWidth` is already plumbed through
to `table()`, so the width is available today.

### Fixes, in the order they pay out

1. **Flag parsing** — comes free with the tokenizer (§3). Fixes N1 and is the same change as G8.
2. **Multi-column `ls`** — width-aware packing, directories first, `/` suffix, `[ENC]`/`[PROT]`
   preserved. Fixes N7. Keep `-l` as the boxed long form; that one *is* a report.
3. **Silent `cd`** on success; error only on failure. Fixes N6. One line deleted, immediately
   feels like a terminal.
4. **`cd` uses a cheap existence check** (`statPath`), not a full permission-checked listing.
   Fixes N2 — this is the one that literally makes navigation slow.
5. **One `~`, one meaning.** `~` = `/home/{username}` **on your own home server**. On a remote box
   you are an intruder with no account, so `~` should fail with *"no home directory on this
   host"* — which is both correct and teaches the fiction. Fixes N3/N4.
6. **`cd` bare → home; `cd -` → previous directory.** Fixes N5/N9. `prevCwd` already exists in the
   `ShellSession` design (§7).
7. **`tree [-L depth]`** — the highest-value *new* command for this game specifically. Exploring
   unfamiliar filesystems is the core loop; seeing structure without a dozen round-trips is a
   large quality-of-life win. Cap depth and node count.
8. **`find` / `grep -r`** — the hacker verbs, and the payoff for the pipe work.
9. **Path tab completion** (§11 step 3) — the largest single fix, listed last only because it
   depends on the tokenizer.

### Game-specific affordances worth considering

These go beyond a real shell, and suit a game where you're constantly landing in unfamiliar boxes:

- **`ls -t`** (sort by modified). In a hacking game, recently-touched files are where the story is.
- **Dim what you can't read.** `ls` already knows permissions; rendering unreadable entries dim
  and encrypted ones highlighted turns a listing into a target map at a glance.
- **Flag files containing access keys.** `fileService.scanForAccessKeys` already exists (added in
  your uncommitted work) — surfacing a marker in `ls -l` rewards thorough exploration without
  giving it away for free.
- **Waypoints** — per-server bookmarks (`mark web`, `goto web`). Thematic as recon notes, and
  removes the tedium of re-walking deep paths.

One caution: `tree` and the affordances above can *trivialize* exploration if unrestricted.
Suggest depth-limiting `tree` by default and considering whether the richer markers should require
a `scan`/`analyze` first — discovery should still cost something.

---

## 11. Rollout

Feature-flagged with `SHELL_V2`, and safe by construction: **an input containing no shell
metacharacters parses to a single `CommandNode` and takes exactly the path it takes today.** The
overwhelming majority of existing inputs are unaffected, which makes this rollout low-risk despite
touching the entry point of every command.

| Step | Deliverable | Notes |
|---|---|---|
| 1 | ✅ **DONE 2026-08-30** — lexer + parser + argv parsing in `shared/shell/` | quoting/escaping fixed G8 at the root; `ls -l`/`-a`, `rm -r`, `cp -r` work; `cat "a b.txt"` works |
| 2 | ✅ **DONE (compatibility form)** — `tryShellParse()` in `commandProcessor`, single-command path only | Rather than a `SHELL_V2` flag, the rollout is **fallback-based**: non-simple ASTs and parse errors degrade to the legacy split, so no input can regress. Becomes a real executor at step 5. |
| 3 | Tab completion using the shared lexer for cursor context | highest UX win; needs only step 1 |
| 4 | Text utilities (`grep`, `wc`, `head`, `tail`, `sort`, `uniq`, `find`) | stream-aware from birth |
| 5 | Pipes + redirection | now worth having, because step 4 exists |
| 6 | Exit codes, `$?`, `&&` / `\|\|` | |
| 7 | Globbing | |
| 8 | Streaming output protocol (§10) + migrate `scan`, `hack`, `cat` | |
| 9 | Job control (`&`, `jobs`, `fg`, `bg`, Ctrl+Z) onto existing PIDs | |
| 10 | Env vars, `PS1`, `.aidarc`, `source` | |
| 11 | `run script.sh` | |
| 12 | v2: command substitution | |

**Step 1 must land as the G8 fix**, not after it (PLAN decision 7). Fixing flag-parsing
per-command and then replacing it with a tokenizer means doing the same work twice and shipping an
inconsistent argument grammar in between. The `cd`/`ls` fixes in §10a ride along with step 1.

---

## 11a. Design principle: shallow entry, deep ceiling

**Decided 2026-08-30.** The full engine ships unlocked — nothing is gated behind progression.
Discoverability comes from `man` pages and contextual hints, not from locks.

The operative rule for content design:

> **Every objective must be solvable the simple way and the elegant way.**

`cat` each log file one by one, *or* `grep -r password /var/log`. Both work. The elegant path is
never *required* — but it is **rewarded**, and the right currency for that reward is already in
your game:

- **Fewer process ticks** → less CPU/RAM/bandwidth drawn from the player's rig.
- **Less trace evidence** → `calculateEvidence` scales with how long you were on the box, so a
  player who greps once instead of `cat`-ing forty files is genuinely quieter.

That second one is the good one: *skill makes you stealthier*, which is exactly the fantasy. It
needs no new systems — just making the resource and evidence costs reflect the number of
operations rather than a flat per-command charge.

Practical consequences:
- `man` pages carry worked examples, because they're the on-ramp for players who've never used a
  shell.
- Command errors suggest the fix (`ls -l` → *"did you mean `ls -l <path>`?"*), rather than just
  reporting failure.
- Missions are authored against the simple path and *checked* against the elegant one, so a
  clever player is never locked out by an objective that assumed brute force.

---

## 12. Open decisions

1. ~~**Keybindings.**~~ **DECIDED 2026-08-30: shell semantics win when the input has focus; app
   shortcuts move to `Ctrl+Shift+*`.**

   | Key | Behaviour |
   |---|---|
   | `Ctrl+A` / `Ctrl+E` | line start / end |
   | `Ctrl+W` | delete previous word |
   | `Ctrl+K` | kill to end of line |
   | `Ctrl+U` | kill line *(already implemented)* |
   | `Ctrl+L` | clear *(already implemented)* |
   | `Ctrl+R` | reverse history search |
   | `Alt+B` / `Alt+F` | word navigation |
   | `Ctrl+C` | cancel input / SIGINT **only** — no longer opens chat (fixes R13) |
   | `Ctrl+Shift+W` | close tab *(was `Ctrl+W`)* |
   | `Ctrl+Shift+N` | chat *(was `Ctrl+C`'s second binding)* |

   Remaining app shortcuts (`Ctrl+S/I/M/F/T/1-9/Tab`) don't collide with readline and stay as-is.
   Ship a one-time notice on first launch after the change so the remap isn't silently surprising.
2. **Does `hack` belong in a pipeline?** `hack 10.0.0.5 | grep breach` is evocative but invites
   piping *interactive* commands with minigame challenges. Recommend: minigame-bearing commands
   refuse to run non-interactively (exit 1 with a clear message), the way real tools refuse when
   stdin isn't a TTY.
3. **Do exit codes leak information?** `cat /root/secret && echo yes` reveals existence without
   contents. Recommend accepting it — that's a real technique, and this is a hacking game.
4. **Alias recursion.** Single-pass non-recursive is proposed. Real shells allow limited
   recursion; single-pass is simpler and adequate.
5. **Per-stage vs. per-pipeline resource cost.** Proposed: per-stage, since `PROCESS_COSTS` is
   already keyed by command type. Makes long pipelines genuinely expensive, which is good
   game design but needs a balance pass.
