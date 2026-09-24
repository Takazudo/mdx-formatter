#!/usr/bin/env bash
set -euo pipefail

# Before-push comprehensive check script
# Runs lightweight checks directly and queues resource-intensive builds.

START_TIME=$(date +%s)
FAILURES=()
NOT_RUN=()
QUEUE_TIMEOUTS=()
NATIVE_READY=0
DOC_WASM_READY=0

step() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "▶ $1"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

pass() {
  echo "✅ $1"
}

fail() {
  echo "❌ $1"
  FAILURES+=("$1")
}

not_run() {
  echo "⚠️ $1 was not run: $2"
  NOT_RUN+=("$1: $2")
}

# Machine-wide queue for heavy steps, shared by every agent session on this machine
# (owner's ~/.claude or ~/.codex). Absent on CI and on other machines → runs directly.
heavy() {
  local g="${HEAVY_GUARD:-}"
  [ -n "$g" ] || for c in "$HOME/.claude/scripts/heavy-guard.sh" "$HOME/.codex/scripts/heavy-guard.sh"; do
    [ -x "$c" ] && { g="$c"; break; }
  done
  if [ -n "$g" ] && [ -z "${CI:-}" ]; then "$g" -- "$@"; else "$@"; fi
}

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOC_DIR="$ROOT_DIR/doc"

# ── Step 1: Code quality checks (root) ────────────────
step "Step 1/9: Code quality checks (root)"
if (cd "$ROOT_DIR" && pnpm check); then
  pass "Prettier + ESLint passed"
else
  fail "Code quality checks (root)"
fi

# ── Step 2: Build the current native formatter ────────
step "Step 2/9: Build native formatter"
if (cd "$ROOT_DIR" && heavy pnpm build:rust); then
  pass "Native formatter binary built"
  NATIVE_READY=1
else
  status=$?
  if [ "$status" -eq 75 ]; then
    not_run "Native formatter build" "heavy-test queue timed out"
    QUEUE_TIMEOUTS+=("Native formatter build")
  else
    fail "Native formatter build"
  fi
fi

# ── Step 3: TypeScript build ──────────────────────────
step "Step 3/9: TypeScript build"
if (cd "$ROOT_DIR" && pnpm build); then
  pass "TypeScript compilation passed"
else
  fail "TypeScript build"
fi

# ── Step 4: Unit tests ────────────────────────────────
step "Step 4/9: Unit tests"
if [ "$NATIVE_READY" -eq 1 ]; then
  if (cd "$ROOT_DIR" && pnpm test); then
    pass "All tests passed"
  else
    fail "Unit tests"
  fi
else
  not_run "Unit tests" "native formatter binary was not built"
fi

# ── Step 5: Native formatter tests ────────────────────
step "Step 5/9: Native formatter tests"
if [ "$NATIVE_READY" -eq 1 ]; then
  if (cd "$ROOT_DIR" && pnpm test:rust); then
    pass "Native formatter tests passed"
  else
    fail "Native formatter tests"
  fi
else
  not_run "Native formatter tests" "native formatter binary was not built"
fi

# ── Step 6: Native passthrough tests ──────────────────
step "Step 6/9: Native passthrough tests"
if [ "$NATIVE_READY" -eq 1 ]; then
  if (cd "$ROOT_DIR" && pnpm test:rust-passthrough); then
    pass "Native passthrough tests passed"
  else
    fail "Native passthrough tests"
  fi
else
  not_run "Native passthrough tests" "native formatter binary was not built"
fi

# ── Step 7: Build the WASM package used by the playground ─
step "Step 7/9: Build documentation WASM"
if (cd "$ROOT_DIR" && heavy pnpm build:wasm:doc); then
  pass "Documentation WASM built"
  DOC_WASM_READY=1
else
  status=$?
  if [ "$status" -eq 75 ]; then
    not_run "Documentation WASM build" "heavy-test queue timed out"
    QUEUE_TIMEOUTS+=("Documentation WASM build")
  else
    fail "Documentation WASM build"
  fi
fi

# ── Step 8: Doc site quality checks ───────────────────
step "Step 8/9: Doc site quality checks"
if [ "$DOC_WASM_READY" -eq 1 ]; then
  if (cd "$DOC_DIR" && pnpm run check); then
    pass "Doc typecheck + lint + format passed"
  else
    fail "Doc site quality checks"
  fi
else
  not_run "Doc site quality checks" "documentation WASM package was not built"
fi

# ── Step 9: Doc site build ────────────────────────────
step "Step 9/9: Doc site build"
if [ "$DOC_WASM_READY" -eq 1 ]; then
  if (cd "$DOC_DIR" && heavy pnpm build); then
    pass "Doc site build passed"
  else
    status=$?
    if [ "$status" -eq 75 ]; then
      not_run "Doc site build" "heavy-test queue timed out"
      QUEUE_TIMEOUTS+=("Doc site build")
    else
      fail "Doc site build"
    fi
  fi
else
  not_run "Doc site build" "documentation WASM package was not built"
fi

# ── Summary ──────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SUMMARY (${DURATION}s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ${#FAILURES[@]} -eq 0 ] && [ ${#NOT_RUN[@]} -eq 0 ]; then
  echo "✅ All checks passed! Safe to push."
  exit 0
fi

if [ ${#FAILURES[@]} -gt 0 ]; then
  echo "❌ ${#FAILURES[@]} check(s) failed:"
  for f in "${FAILURES[@]}"; do
    echo "   - $f"
  done
  exit 1
fi

if [ ${#NOT_RUN[@]} -gt 0 ]; then
  echo "⚠️ ${#NOT_RUN[@]} step(s) were not run:"
  for s in "${NOT_RUN[@]}"; do
    echo "   - $s"
  done
fi

if [ ${#QUEUE_TIMEOUTS[@]} -gt 0 ]; then
  echo "⚠️ Heavy-test queue contention prevented ${#QUEUE_TIMEOUTS[@]} build step(s) from running."
  exit 75
fi

echo "❌ Checks were skipped because a prerequisite failed."
exit 1
