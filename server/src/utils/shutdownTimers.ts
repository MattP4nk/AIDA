/**
 * O9 — a home for timers that have no service to own them.
 *
 * Most recurring work lives on a service with a `stop()`, which `lifecycle`
 * calls. But several intervals are created inline — two in `index.ts` (the
 * Architect evaluation and the dungeon expiry sweep, the very timers the O9
 * plan item named) and one each in two command modules. They captured no
 * handle at all, so there was nothing to clear even in principle.
 *
 * That matters because both `index.ts` timers call into the database, and
 * `db.disconnect()` runs near the end of the shutdown sequence: a tick landing
 * after it rejects, and the resulting unhandled rejection re-enters the
 * shutdown handler that is already running.
 *
 * Register here instead of holding a loose handle, so `lifecycle` can clear
 * every one without needing to know what they are.
 */

const timers = new Set<NodeJS.Timeout>();

/**
 * Track a recurring timer so shutdown can stop it.
 *
 * Returns the timer, so it can wrap a `setInterval` call directly:
 *
 *     registerShutdownTimer(setInterval(fn, ms));
 */
export function registerShutdownTimer(timer: NodeJS.Timeout): NodeJS.Timeout {
  timers.add(timer);
  return timer;
}

/** Clear every registered timer. Safe to call more than once. */
export function clearShutdownTimers(): number {
  const count = timers.size;
  for (const t of timers) clearInterval(t);
  timers.clear();
  return count;
}

