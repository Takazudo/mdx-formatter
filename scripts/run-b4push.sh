#!/usr/bin/env bash
set -euo pipefail

# Before-push comprehensive check script
# Runs all quality checks, builds, and tests to ensure everything is clean

START_TIME=$(date +%s)
FAILURES=()

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

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DOC_DIR="$ROOT_DIR/doc"

# ── Step 1: Code quality checks (root) ────────────────
step "Step 1/6: Code quality checks (root)"
if (cd "$ROOT_DIR" && pnpm check); then
  pass "Prettier + ESLint passed"
else
  fail "Code quality checks (root)"
fi

# ── Step 2: TypeScript build ──────────────────────────
step "Step 2/6: TypeScript build"
if (cd "$ROOT_DIR" && pnpm build); then
  pass "TypeScript compilation passed"
else
  fail "TypeScript build"
fi

# ── Step 3: Unit tests ───────────────────────────────
step "Step 3/6: Unit tests"
if (cd "$ROOT_DIR" && pnpm test); then
  pass "All tests passed"
else
  fail "Unit tests"
fi

# ── Step 4: Generate doc data ─────────────────────────
step "Step 4/6: Generate doc data files"
if (cd "$DOC_DIR" && pnpm run generate-doc-titles && pnpm run generate-category-nav); then
  pass "Doc data files generated"
else
  fail "Doc data generation"
fi

# ── Step 5: Doc site quality checks ──────────────────
step "Step 5/6: Doc site quality checks"
if (cd "$DOC_DIR" && pnpm run check); then
  pass "Doc typecheck + lint + format passed"
else
  fail "Doc site quality checks"
fi

# ── Step 6: Doc site build ───────────────────────────
step "Step 6/6: Doc site build"
if (cd "$DOC_DIR" && pnpm build); then
  pass "Doc site build passed"
else
  fail "Doc site build"
fi

# ── Summary ──────────────────────────────────────────
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SUMMARY (${DURATION}s)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ ${#FAILURES[@]} -eq 0 ]; then
  echo "✅ All checks passed! Safe to push."
  exit 0
else
  echo "❌ ${#FAILURES[@]} check(s) failed:"
  for f in "${FAILURES[@]}"; do
    echo "   - $f"
  done
  exit 1
fi
