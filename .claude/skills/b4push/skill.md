---
name: b4push
description: >-
  Run comprehensive pre-push validation covering code quality, builds, tests, and doc site.
  Use when: (1) Completing a PR or feature implementation, (2) Before pushing significant changes,
  (3) After large refactors or multi-file edits, (4) User says 'b4push', 'before push', 'check
  everything', 'run all checks', or 'ready to push'.
user-invocable: true
allowed-tools:
  - Bash
---

# Before Push Check

Run `pnpm b4push` from the project root. This executes `scripts/run-b4push.sh` which runs all checks in order:

1. Code quality (root) - Prettier + ESLint
2. TypeScript build - Compile to dist/
3. Unit tests - Vitest suite (232 tests)
4. Doc data generation - doc-titles.json + category-nav.json
5. Doc quality checks - TypeScript + ESLint + Prettier
6. Doc site build - Full Docusaurus production build

Takes ~40 seconds. All 6 steps must pass.

## On failure

1. Read the failure output to identify which step failed
2. Auto-fix what you can:
   - Formatting: `pnpm check:fix` (root) or `cd doc && pnpm check:fix` (doc)
   - Lint: `pnpm lint:fix` (root) or `cd doc && pnpm lint:fix` (doc)
3. Re-run `pnpm b4push` to confirm all checks pass
4. Report the final status
