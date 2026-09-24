# PR #3 Review Fixes Tracker

## CRITICAL

- [x] **C1** — Missing `FILE_CHALLENGE: -3` in `ReservedPID` (Terminal.svelte + shared/types/game.ts)
- [x] **C2** — Missing database indexes on FileSystemNode, ServerConnection, Message, HackLog, AuditLog

## HIGH

- [x] **H1** — AI prompt sanitizer boundary-tag bypass (aiPromptSanitizer.ts)
- [x] **H2** — Greedy JSON extraction regex (aiOutputValidator.ts)
- [x] **H3** — `detectAndGrantAccessKeys` unbounded query (fileService.ts) — cached with 5min TTL
- [x] **H4** — Shared `challengeCountdown` timer across challenge types (Terminal.svelte) — per-type Map
- [x] **H5** — Command string injection in ForumDialog / MailDialog — backslash+quote escaping
- [x] **H6** — Socket lazy import race condition (socket.ts) — promise-based with cache

## MEDIUM

- [x] **M1** — CSRF token comparison not timing-safe (csrf.ts) — crypto.timingSafeEqual
- [x] **M2** — CSRF SKIP_PATHS uses startsWith (csrf.ts) — exact match
- [x] **M3** — CSRF new token overwrites old (csrf.ts) — up to 3 tokens per JWT
- [x] **M4** — Account lockout keyed by username only (auth.ts) — combined IP+username + per-IP limit
- [x] **M5** — GameError.details sent to client (setup.ts) — dev-only
- [x] **M6** — server.close()/io.close() not awaited before exit (lifecycle.ts) — promisified
- [x] **M7** — No shutdown timeout (lifecycle.ts) — 15s forced exit timer
- [x] **M8** — DB query for user role on every command (commandProcessor.ts) — passed from session
- [x] **M9** — serverStates Map grows unbounded (gameStateManager.ts) — pruned in cleanupIdleSessions
- [x] **M10** — Retry queue onSuccess async callback not awaited (aiService.ts) — added await
- [x] **M11** — N+1 file count queries in enqueueAllUnpopulated (contentQueueService.ts) — groupBy
- [x] **M12** — No-op DB write in savePlayerProgress (progressService.ts) — removed
- [x] **M13** — Socket middleware re-verifies JWT on every packet (handlers.ts) — cached after first verify
- [x] **M14** — Dynamic import in hot command path (handlers.ts) — static imports
- [x] **M15** — onDestroy never calls emitTypingStop (ChatDialog.svelte) — added cleanup
- [x] **M16** — Removed socket listeners cause stale data (ShopDialog.svelte, EquipmentDialog.svelte) — reactive refetch on visible
- [x] **M17** — seenIds pruning can re-show old notifications (TerminalToast.svelte) — keep toast+recent IDs
- [x] **M18** — ReDoS risk from admin regex patterns (censorshipService.ts) — isSafeRegex check
- [x] **M19** — Seed deleteMany with no production guard (seed.ts) — env check added

## LOW

- [x] **L1** — Role hierarchy defaults unknown roles to 0 (auth.ts) — throws on invalid role
- [x] **L2** — Registration .escape() on username (validation.ts) — removed (regex already restricts)
- [x] **L3** — sanitizeSocketInput missing control char strip (inputValidation.ts) — added control char regex
- [x] **L4** — recipientId format not validated (inputValidation.ts) — length validation added
- [x] **L5** — Faction init failure silently swallowed (auth.ts) — logger.warn added
- [x] **L6** — commandsExecuted increment swallows errors (commandProcessor.ts) — logger.debug added
- [x] **L7** — rateLimitCleanupTimer never cleared (commandProcessor.ts) — stop() method added
- [x] **L8** — hackService sessionTimers never cleaned on shutdown (hackService.ts) — cleanup() + wired in lifecycle
- [x] **L9** — Lazy service getters typed as any (hackService.ts) — typed return values
- [x] **L10** — Dead context parameter in AI API (aiService.ts) — removed from 7 files
- [x] **L11** — Typewriter eats first keypress (Terminal.svelte) — printable chars propagate
- [x] **L12** — No type validation on loaded settings (settings.ts) — per-field type validation
- [x] **L13** — showDesktopNotification is dead code (notifications.ts) — removed dead methods
- [x] **L14** — sound event as any allows arbitrary method call (socket.ts) — typed keyof
- [x] **L15** — User.role free-form string vs VALID_ROLES mismatch (schema + admin) — added "npc" to VALID_ROLES
- [x] **L16** — Hardcoded scrypt salt "salt" (messageEncryptionService.ts + fileService.ts) — random salt per encryption

## Summary

- **43/43 issues fixed**
- Files modified: ~30 across client + server + shared + prisma
- Note: Run `npx prisma db push` to apply C2 index changes
