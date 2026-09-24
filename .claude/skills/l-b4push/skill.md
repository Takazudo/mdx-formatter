---
name: l-b4push
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

Run `pnpm b4push` from the project root. This executes `scripts/run-b4push.sh` and runs the checks in order:

1. Code quality (root) - Prettier + ESLint
2. Build the current native formatter binary
3. TypeScript build - Compile to dist/
4. Unit tests - `pnpm test`
5. Native formatter tests - `pnpm test:rust`
6. Native passthrough tests - `pnpm test:rust-passthrough`
7. Build the playground WASM package and copy it into the doc site
8. Doc quality checks - TypeScript + ESLint + Prettier
9. Doc site build - Production build with zfb

The native formatter build, doc WASM build, and doc site build use the machine-wide heavy guard. Type checks, lint, formatting, and Vitest suites run without queueing.

The root test suites run only after the native build succeeds. Doc checks and the doc site build run only after the playground WASM build succeeds, so stale artifacts are never used when preparation fails.

## On failure

1. Read the failure output to identify which step failed
2. Auto-fix what you can:
   - Formatting: `pnpm check:fix` (root) or `cd doc && pnpm check:fix` (doc)
   - Lint: `pnpm lint:fix` (root) or `cd doc && pnpm lint:fix` (doc)
3. Re-run `pnpm b4push` to confirm all checks pass
4. Report the final status

Do not wrap the entire `pnpm b4push` command in another heavy guard. Its resource-intensive build steps enter the machine-wide queue individually and print a `heavy-guard: verdict=PASS|FAIL|ENV_SUSPECT` line.

- Exit 75 = the queue timed out and the guarded step never ran. b4push reports it as not run and returns 75 when no other check failed; do not retry it unguarded.
- `ENV_SUSPECT` → rerun once. Still red with no assertion / type / lint error → defer that step to CI under a `deferred-verification` issue and report it as deferred, never as passed
