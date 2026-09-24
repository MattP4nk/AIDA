# AIDA Client/UI Refactor Roadmap

## Goal

Transform the terminal from a static text display into a dynamic, immersive hacker console. Every interaction should feel responsive — live progress, contextual hints, ambient sound, and zero immersion-breaking popups.

## Phase Summary

| Phase | Name | Status | Impact |
|-------|------|--------|--------|
| 1 | Command History + Tab Completion | DONE | Foundation: input system |
| 2 | Live Process Widget | TODO | Real-time progress bars + timers |
| 3 | Terminal-Native Notifications | TODO | In-terminal toasts, no popups |
| 4 | Responsive ASCII + Status Bar | TODO | Scales to any screen size |
| 5 | Polish: Sound + Typewriter + Palette | TODO | Final immersion layer |

---

## Phase 1: Command History + Tab Completion (DONE)

### Problem
- Up arrow only recalled the last command (bug: `0 || -1` treated index 0 as falsy)
- No way to auto-fill commands suggested by the server (e.g., "Submit with: handshake.ack")
- Tab completion showed no visual feedback for multiple matches

### What Was Built
- **Full history cycling**: Up/down arrows navigate all 100 stored commands per tab
- **Suggested command**: Server output parsed for patterns like "Submit with:", "Try:", "Use:". A `TAB` badge appears above input. Pressing Tab fills it.
- **Visual tab completion**: First Tab shows all matching commands below input with current selection in `[brackets]`. Subsequent Tabs cycle through. Hint disappears on any other keypress.
- **Bug fix**: `terminalTabs.ts` line 278 — `|| -1` changed to `?? -1` (nullish coalescing)

### Files Changed
- `client/src/components/Terminal.svelte` — history navigation, Tab handler, suggestion extraction, hint UI + CSS
- `client/src/services/terminalTabs.ts` — fixed history index persistence

---

## Phase 2: Live Process Widget

### Problem
- Processes (hack, scan, download, decrypt) show no live progress
- Player must spam `ps` command to see status
- Challenge panels (hack/connection) show static timers — no countdown
- No visual indication that something is happening in the background

### What To Build

#### ProcessBar Component (`client/src/components/ProcessBar.svelte`)
- Persistent widget that sits between the output area and input line
- Shows all active processes from the `activeProcesses` store
- Each process displays as a single line:
  ```
  [PID 42] hack_prep ████████░░░░ 67% ETA 8s
  [PID 43] scan      ██░░░░░░░░░░ 15% ETA 12s
  ```
- Progress bar updates in real-time from `process:progress` socket events
- ETA countdown ticks locally every second (don't wait for server push)
- When a process completes: brief flash/highlight, then removed
- When no processes are active: component renders nothing (zero height)
- Compact mode: if more than 3 processes, collapse to summary: `3 processes running...`

#### Live Countdown Timers on Challenge Panels
- Hack challenge panel: add a ticking countdown showing time remaining
- Connection challenge panel: same — countdown from `challenge.timeLimit`
- Timer starts when challenge data arrives, ticks via `setInterval`
- Visual urgency: timer turns yellow at 50%, red at 25%, pulses at 10%

### Data Flow
```
Server sends process:started → activeProcesses store updated → ProcessBar renders new row
Server sends process:progress → activeProcesses store updated → ProcessBar updates bar + ETA
Server sends process:completed → activeProcesses store updated → ProcessBar removes row
Local setInterval (1s) → decrements ETA display on each process
```

### Files
- `client/src/components/ProcessBar.svelte` — CREATE (~150 lines)
- `client/src/components/Terminal.svelte` — import ProcessBar, insert in layout, add timers to challenge panels

### Acceptance Criteria
- [ ] Run `hack <ip>` → see live progress bar appear, fill up, then disappear on completion
- [ ] Run `scan` → see ETA countdown tick down every second
- [ ] Multiple processes stack vertically
- [ ] Connection challenge shows countdown timer that ticks
- [ ] Timer turns red when < 25% time remaining

---

## Phase 3: Terminal-Native Notifications

### Problem
- NotificationPanel is a 450px full-screen overlay that breaks immersion
- Notifications look like a separate application, not part of the terminal
- Important alerts (fragment stolen, level up, hack detected) deserve in-terminal presentation

### What To Build

#### TerminalToast Component (`client/src/components/TerminalToast.svelte`)
- Small notification toasts that appear in the bottom-right corner of the output area
- Styled with CRT aesthetic: green/cyan text, subtle scanline, terminal borders
- Maximum 3 visible toasts stacked vertically
- Each toast shows: icon + title + one-line message + dismiss button
- Auto-dismiss after 5 seconds (configurable per priority)
- Priority behavior:
  - `low/normal`: auto-dismiss 5s, subtle appearance
  - `high`: auto-dismiss 8s, brighter border, sound beep
  - `urgent`: persists until clicked/dismissed, pulsing border, louder beep
- Click on toast: executes action (open dialog, navigate) or just dismisses
- Slide-in animation from right, fade-out on dismiss

#### NotificationPanel Kept As History
- NotificationPanel.svelte stays but only opens via `Ctrl+N` or `notifications` command
- Functions as a "notification history" / log viewer
- No longer auto-opens on notification arrival
- Add a command: `notifications [clear|read|count]`

#### Notification Sound Refinement
- Different tones per type (preparation for Phase 5 sound system):
  - Message: soft double-beep
  - Game event: single tone
  - Urgent: sharp ascending tone
  - Error: low buzz

### Files
- `client/src/components/TerminalToast.svelte` — CREATE (~200 lines)
- `client/src/components/Terminal.svelte` — replace NotificationPanel auto-show with TerminalToast, keep panel as Ctrl+N overlay
- `client/src/services/notifications.ts` — add toast queue (visible toasts array, auto-dismiss timers, max visible limit)
- `client/src/components/NotificationPanel.svelte` — minor: remove auto-trigger, make it history-only

### Acceptance Criteria
- [ ] Receive a message → green toast slides in at bottom-right of terminal
- [ ] Toast auto-dismisses after 5 seconds
- [ ] Urgent notification (hack detected, fragment stolen) persists with pulse
- [ ] Maximum 3 toasts visible — oldest auto-dismissed when 4th arrives
- [ ] Ctrl+N opens full notification history panel
- [ ] No more full-screen overlay on regular notifications

---

## Phase 4: Responsive ASCII + Status Bar

### Problem
- ASCII art in welcome screen and command outputs overflows on small screens
- Status bar items get cramped or hidden at narrow widths
- New terminal tabs show no context (player doesn't know what server/directory they're in)
- Challenge panels may not fit on narrow screens

### What To Build

#### Terminal Width Tracking
- Add `ResizeObserver` on the output container
- Calculate character width: `containerPixelWidth / charWidth` (measure a monospace char)
- Store as reactive `terminalCols` variable
- Pass to server via command metadata (future: server can adjust output width)

#### Responsive Welcome Screen
- 3 tiers based on `terminalCols`:
  - **Full** (>100 cols): Current large ASCII art
  - **Medium** (60-100 cols): Simplified banner, essential info
  - **Compact** (<60 cols): Text-only, no ASCII art
- Detect on mount and on resize

#### Status Bar Improvements
- **>1024px**: Full status bar (current)
- **768-1024px**: Tabs shrink to icons + short labels, gauges show as mini bars
- **<768px**: Single row — active tab name + CPU% + notification badge only
- Process count badge: small number showing active processes (links to Phase 2 ProcessBar)

#### New Tab Context
- When a new terminal tab is created, auto-print a context line:
  ```
  [Terminal 2] Server: Internet Exchange (10.0.0.1) | Dir: / | Level: 15
  ```
- Shows current server name, IP, directory, and player level

#### Challenge Panel Responsive
- On narrow screens: challenge display text wraps or scrolls horizontally
- Timer (from Phase 2) stays visible even when panel scrolls

### Files
- `client/src/components/Terminal.svelte` — ResizeObserver, responsive welcome, status bar improvements, challenge panel scroll
- `client/src/services/terminalTabs.ts` — pass context info to new tabs

### Acceptance Criteria
- [ ] Resize browser to 400px wide → welcome screen shows compact version
- [ ] Status bar collapses gracefully at each breakpoint
- [ ] New tab shows server/directory context
- [ ] Challenge panel usable on narrow screens

---

## Phase 5: Polish — Sound + Typewriter + Command Palette

### Problem
- Terminal output appears all at once — no dramatic reveal
- No audio feedback for actions
- Discovering commands requires memorization or typing `help`

### What To Build

#### Sound System (`client/src/services/sound.ts`)
- Web Audio API based (like existing notification beep but expanded)
- Sound events:
  - `keystroke`: very subtle click (off by default)
  - `submit`: soft blip when command sent
  - `success`: ascending tone on successful command
  - `error`: low descending buzz on error
  - `process_complete`: completion chime
  - `hack_success`: triumphant chord (3 ascending tones)
  - `level_up`: fanfare (5 rapid ascending tones)
  - `alert`: sharp tone for urgent notifications
- All sounds are synthesized (no audio files needed)
- Master volume control + per-category toggles
- Respects browser autoplay policy (no sound until first interaction)

#### Typewriter Effect
- Server responses render character-by-character instead of all at once
- Three speed modes (stored in settings):
  - `instant`: current behavior, no delay
  - `fast`: 5ms per character (~200 chars/sec)
  - `cinematic`: 20ms per character (~50 chars/sec)
- System messages always render at `fast` speed
- Large outputs (>500 chars) auto-switch to `instant` to avoid annoying waits
- Player can skip animation by pressing any key during typewriter
- Setting command: `settings typewriter [instant|fast|cinematic]`

#### Command Palette
- `Ctrl+K` opens an inline overlay at the top of the terminal
- Text input with fuzzy search over all known commands
- Shows: command name, category, one-line description
- Arrow keys to navigate results, Enter to select (fills input)
- Escape to close
- Commands loaded from `KNOWN_COMMANDS` list + descriptions from `getCommandInfo()` (cached on login)

#### Clickable Inline Commands
- When output contains command-like text (e.g., `hack 10.0.0.1`, `connect.abort`), wrap in styled span
- Click fills the input with that command
- Visual: slightly brighter color + underline on hover
- Detection: match known commands in output text, wrap in `<span class="clickable-cmd">`

#### Settings Store (`client/src/stores/settings.ts`)
- Persisted to localStorage
- Keys: `typewriterSpeed`, `soundEnabled`, `soundVolume`, `crtEffects`, `timestampsVisible`
- Command: `settings [key] [value]` to modify
- Command: `settings` (no args) to show all current settings

### Files
- `client/src/services/sound.ts` — CREATE (~150 lines)
- `client/src/stores/settings.ts` — CREATE (~50 lines)
- `client/src/components/Terminal.svelte` — typewriter rendering, clickable commands, command palette overlay, settings integration
- `client/src/components/CommandPalette.svelte` — CREATE (~200 lines)

### Acceptance Criteria
- [ ] Type command → hear soft blip. Error → hear buzz. Process complete → hear chime.
- [ ] `settings typewriter cinematic` → responses type out character by character
- [ ] Press any key during typewriter → skips to full text
- [ ] Ctrl+K → palette opens, type "ha" → shows "hack", "handshake.ack", "hack.abort" etc.
- [ ] Click on a command in output → fills input
- [ ] `settings sound off` → all sounds disabled
- [ ] Settings persist across page reloads

---

## Architecture After Refactor

```
Terminal.svelte (2100+ lines → should stay similar, new components extract complexity)
├── StatusBar (existing — improved responsive behavior)
├── OutputArea (existing — typewriter rendering, clickable commands)
│   └── TerminalToast (NEW — bottom-right toast stack, max 3)
├── ChallengePanel (existing — live countdown timer added)
├── ProcessBar (NEW — live progress bars for active processes)
├── SuggestionHint (inline — TAB badge above input)
├── InputLine (existing — enhanced Tab handler)
├── TabHint (inline — temporary match display below input)
├── CommandPalette (NEW — Ctrl+K fuzzy search overlay)
└── NotificationPanel (existing — now history-only via Ctrl+N)
```

## New Files Summary

| File | Phase | Lines (est.) | Purpose |
|------|-------|-------------|---------|
| `ProcessBar.svelte` | 2 | ~150 | Live process progress bars |
| `TerminalToast.svelte` | 3 | ~200 | In-terminal toast notifications |
| `CommandPalette.svelte` | 5 | ~200 | Ctrl+K command search |
| `sound.ts` | 5 | ~150 | Web Audio sound effects |
| `settings.ts` | 5 | ~50 | User preferences (localStorage) |

## Risk Notes

- **Phase 2** is the most impactful — live progress fundamentally changes how the game feels
- **Phase 3** must be careful not to lose notification functionality — keep history panel as fallback
- **Phase 4** ASCII detection may need server cooperation (sending terminal width with commands)
- **Phase 5** typewriter must be interruptible or it becomes annoying on long outputs
- Each phase is independently deployable — no phase depends on a later phase
