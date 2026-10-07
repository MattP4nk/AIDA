#!/usr/bin/env bash
#
# Run every verify-*.ts harness and report per-harness and aggregate results.
#
#   cd server && npm run verify
#
# WHAT YOU NEED FIRST:
#   - A reachable database (DATABASE_URL). Harnesses create their own fixtures
#     and delete them in a `finally`; they do NOT reset the schema. Never point
#     this at anything you care about — see `db:reset` in CLAUDE.md.
#   - The dev server running (`npm run dev`) for the ~10 harnesses that drive
#     real HTTP/socket traffic. Without it those fail with ECONNREFUSED, which
#     looks alarming and is environmental. They are not skipped silently.
#
# WHY A SCRIPT AND NOT A TEST RUNNER: there is no jest/vitest here. Each
# harness is a standalone tsx program that prints `=== N PASS / N FAIL ===` and
# exits non-zero on failure. That convention is the whole contract.
#
# EXIT CODE is non-zero if any harness fails, so this is CI-usable as-is.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

OUT="${VERIFY_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$OUT"

# A harness that hangs is worse than one that fails: it stalls the whole run
# with no output. 300s is generous for the slowest (AI-backed) ones.
TIMEOUT="${VERIFY_TIMEOUT:-300}"

ok=0
fail=0
failed_names=()

for f in scripts/verify-*.ts; do
  name=$(basename "$f" .ts)
  if timeout "$TIMEOUT" npx tsx "$f" >"$OUT/$name.log" 2>&1; then
    ok=$((ok + 1))
    printf '  ok   %s\n' "$name"
  else
    fail=$((fail + 1))
    failed_names+=("$name")
    printf '  FAIL %s\n' "$name"
  fi
done

# Aggregate the per-check totals, not just the per-harness ones. A harness can
# exit 0 having run far fewer checks than it used to — a drop in this number is
# the signal that something stopped being exercised.
#
# The numbers are EXTRACTED, not counted by field position. This used to be
# `awk -F'[ /]' '{p+=$2; f+=$5}'`, and with a one-character separator the
# " / " in "=== 8 PASS / 1 FAIL ===" yields two EMPTY fields — so $5 was always
# the blank between "/" and the space, and the fail total was hard-wired to 0
# for as long as this script existed. The suite's exit code stayed honest
# (it comes from each harness's exit status); this line never could.
checks=$(grep -h -oE '=== [0-9]+ PASS / [0-9]+ FAIL ===' "$OUT"/*.log 2>/dev/null |
  sed -E 's#^=== ([0-9]+) PASS / ([0-9]+) FAIL ===$#\1 \2#' |
  awk '{p+=$1; f+=$2} END{printf "%d pass, %d fail", p, f}')

echo
echo "=== SUITE: $ok ok / $fail fail ==="
[ -n "$checks" ] && echo "=== CHECKS: $checks ==="
echo "    logs: $OUT"

if [ "$fail" -gt 0 ]; then
  echo
  echo "failed:"
  printf '  - %s\n' "${failed_names[@]}"
  echo
  echo "If these are ECONNREFUSED, start the dev server and re-run before"
  echo "reading anything into them."
  exit 1
fi
