/**
 * Applying a `state:delta`.
 *
 * SHARED on purpose. A delta channel only works if both sides agree what a
 * path means, and a disagreement there does not fail loudly — it shows up as a
 * UI that is quietly stale. Keeping the applier next to the shape it applies
 * means the semantics have exactly one definition, and a harness can exercise
 * it without booting a browser.
 *
 * ORPHAN AUDIT 2026-09-25: `state:delta` was emitted by nothing and listened
 * for by nobody, so none of this existed. `broadcastStateDelta` had zero
 * callers.
 */
export interface StateDeltaInput {
  path: string;
  value: unknown;
  operation?: string;
}

/**
 * Apply a `state:delta` to the store.
 *
 * Exported so it can be tested directly: the whole point of a delta channel
 * is that the client and server agree on what a path means, and a silent
 * mismatch there looks exactly like a stale UI.
 *
 * Returns false when the path cannot be walked, so a delta for a state the
 * client has not received yet is a no-op rather than a store full of
 * half-built objects.
 */
export function applyStateDelta(
  state: any,
  delta: StateDeltaInput,
): { next: any; applied: boolean } {
  if (!state || !delta?.path) return { next: state, applied: false };
  const parts = delta.path.split(".").filter(Boolean);
  if (parts.length === 0) return { next: state, applied: false };

  // Copy along the path only — untouched branches keep their identity so
  // derived stores for other fields do not fire.
  const next = { ...state };
  let cursor: any = next;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    if (cursor[key] === null || typeof cursor[key] !== "object") {
      return { next: state, applied: false };
    }
    cursor[key] = Array.isArray(cursor[key]) ? [...cursor[key]] : { ...cursor[key] };
    cursor = cursor[key];
  }

  const leaf = parts[parts.length - 1]!;
  switch (delta.operation ?? "set") {
    case "push":
      if (!Array.isArray(cursor[leaf])) return { next: state, applied: false };
      cursor[leaf] = [...cursor[leaf], delta.value];
      break;
    case "remove":
      if (Array.isArray(cursor[leaf])) {
        cursor[leaf] = cursor[leaf].filter((e: any) => e?.id !== (delta.value as any));
      } else {
        delete cursor[leaf];
      }
      break;
    case "update":
      if (Array.isArray(cursor[leaf])) {
        const patch = delta.value as any;
        cursor[leaf] = cursor[leaf].map((e: any) => (e?.id === patch?.id ? { ...e, ...patch } : e));
      } else if (cursor[leaf] && typeof cursor[leaf] === "object") {
        cursor[leaf] = { ...cursor[leaf], ...(delta.value as object) };
      } else {
        return { next: state, applied: false };
      }
      break;
    default:
      cursor[leaf] = delta.value;
  }
  return { next, applied: true };
}
