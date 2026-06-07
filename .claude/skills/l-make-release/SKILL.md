---
description: 'Release @takazudo/mdx-formatter — bump the version, sync platform packages, write the changelog, push, wait for CI, tag (which triggers the release.yml auto-publish of all 5 npm packages via the repo NPM_TOKEN), watch the publish run, and create the GitHub Release. Fully autonomous end-to-end by default (no confirmation prompts); pass --confirm to vet the proposal interactively and stop before tagging. Triggers on rough requests like "bump version", "cut a release", "release mdx-formatter", "make a release", "publish a new version".'
user-invocable: true
argument-description: 'Optional: major, minor, patch — stable release with that bump. next — start or continue an X.Y.Z-next.N prerelease. stable — promote the current prerelease to stable. No argument: prerelease → increment N; stable → analyze commits and pick the bump autonomously. --confirm — interactive mode: present the bump proposal and wait, and stop before tagging instead of publishing.'
---

# /l-make-release

One-call orchestrator for releasing `@takazudo/mdx-formatter` and its four lockstep platform packages. Bumps the version, syncs the platform packages, writes a changelog doc (stable only), commits + pushes, waits for CI, pushes the `v*` tag — which triggers `.github/workflows/release.yml` to build the napi binaries and publish **all five npm packages** — watches that run to completion, then creates the GitHub Release (stable only).

## Invocation & autonomy

This skill is **model-invocable**: a rough natural-language request like "bump version", "cut a release", or "release it" may trigger it.

**Default: fully autonomous end-to-end — NEVER ask for confirmation, NEVER stop and wait.** Steps 1–3 are read-only; print the Step 3 proposal (current → new version + categorized changelog) **for visibility only** and proceed straight into Step 4. The tag push at Step 8 IS the publish trigger — do not pause to ask "tag?", "publish?", or any equivalent. The invocation itself is the authorization.

**`--confirm` option (opt-in interactive mode).** When the invocation includes `--confirm` (e.g. `/l-make-release --confirm`, `/l-make-release minor --confirm`), restore interactive behavior: present the Step 3 proposal and **wait for explicit user confirmation** before the first mutation (Step 4), and **stop after Step 7 (CI green) with the tag NOT yet pushed** — report the exact `git tag` / `git push` commands and let the user fire them. Use this when the version strategy or release notes need vetting.

## Architecture (why this works)

- The four platform packages (`npm/darwin-arm64`, `npm/darwin-x64`, `npm/linux-x64-gnu`, `npm/win32-x64-msvc`) are **pnpm workspace members**, declared on the root as pinned `workspace:X.Y.Z` optionalDependencies. They resolve locally at bump time — before the new versions exist on the registry — so the lockfile stays consistent and bump-commit CI is green. (The pre-workspace flow could never have green CI on the bump commit: `ERR_PNPM_OUTDATED_LOCKFILE`, see v1.2.1 history.)
- `scripts/sync-napi-versions.mjs` keeps all five `package.json` versions + the `workspace:` specifiers lockstep with the root version.
- `release.yml` publishes the platform packages with `npm publish` and the root with `pnpm publish` (which rewrites `workspace:X.Y.Z` → exact `X.Y.Z` in the tarball). Every publish is idempotency-guarded, so re-running the workflow after a partial failure is safe.
- The repo secret `NPM_TOKEN` is an automation token covering ALL `@takazudo` packages (root + platform). If a publish fails with `E404 Not Found - PUT` or a 2FA error, the token scope/type is the problem — fix it at npmjs.com → Access Tokens.

## Boundaries

- This skill **never** runs `npm publish` / `pnpm publish` locally. Publishing happens only in `release.yml`, triggered by the tag push.
- The GitHub Release is created AFTER the publish run succeeds (it does not trigger anything — the tag does).
- Prereleases get a git tag (required to trigger publishing) but **no changelog doc and no GitHub Release** (existing convention).

## Step 1: Preconditions

Verify ALL of the following. If any check fails, stop with a clear message.

1. Current branch is `main` (`git branch --show-current`)
2. Working tree is clean (`git status --porcelain` returns empty)
3. `gh` CLI is authenticated (`gh auth status`)
4. Tags are fresh and at least one `v*` tag exists:

   ```bash
   git fetch --tags origin
   git tag -l 'v*' --sort=-v:refname | head -1
   ```

## Step 2: Determine Next Version

Read the current version from the root `package.json`.

### No argument

- Current is `X.Y.Z-next.N` (prerelease): continue the line → `X.Y.Z-next.{N+1}`
- Current is stable `X.Y.Z`: analyze commits since the last stable tag (Step 3) and pick autonomously:
  - breaking changes → **major**
  - new features → **minor**
  - otherwise → **patch**

### `major` / `minor` / `patch` argument

Stable release with that bump from the current stable version (e.g. `patch`: `1.2.1` → `1.2.2`). If the current version is a prerelease, stop with an error — promote with `stable` or bump explicitly from the prerelease's base.

### `next` argument

- Current is stable `X.Y.Z`: start a new minor prerelease → `X.{Y+1}.0-next.1`
- Current is `X.Y.Z-next.N`: continue → `X.Y.Z-next.{N+1}`

### `stable` argument

Strip the `-next.N` suffix (e.g. `1.3.0-next.4` → `1.3.0`). Requires the current version to be a prerelease; stop with an error otherwise.

### Guard: version must not already exist on npm

A partially recovered prior run may have published the computed version even though the local state suggests otherwise. Always check, and bump past any hit:

```bash
npm view "@takazudo/mdx-formatter@<version>" version 2>/dev/null
```

If this prints a version, the computed version is taken — recompute (next prerelease N, or next patch) and re-check.

## Step 3: Analyze Changes and Propose

```bash
git log <last-tag>..HEAD --oneline
```

Categorize each commit **by judgment** (this repo uses `[formatter]` / `[doc]` / `[misc]` / `[claude]` scope prefixes, not conventional commits — read the subjects and classify):

- **Breaking Changes**: API/CLI behavior changes consumers must adapt to
- **Features**: new capabilities
- **Bug Fixes**: fixes to formatting behavior, CLI, or shipped binaries
- **Other Changes**: docs, CI, deps, internal refactors

Present the proposal:

```
Proposed bump: {current} → {new} ({type})

Breaking Changes:
- description (hash)

Features:
- description (hash)

Bug Fixes:
- description (hash)

Other Changes:
- description (hash)
```

Only show sections that have entries.

- **Default (autonomous)**: the printout is for visibility only — proceed straight to Step 4.
- **With `--confirm`**: wait for explicit user confirmation before proceeding.

## Step 4: Bump + Sync + Changelog

### 4a. Bump the root version

Update the `version` field in the root `package.json` to the new version (no `v` prefix).

### 4b. Propagate to platform packages

```bash
pnpm sync:napi-versions
```

This rewrites the four `npm/*/package.json` versions and the root's `workspace:X.Y.Z` optionalDependencies.

### 4c. Regenerate the lockfile

```bash
pnpm install --lockfile-only --no-frozen-lockfile
```

`--lockfile-only` updates `pnpm-lock.yaml` without touching `node_modules` (avoids the non-TTY purge abort). The platform entries are workspace links, so the new version always resolves. The expected diff is exactly the four `specifier: workspace:<old>` → `workspace:<new>` lines — if anything structural appears, stop and surface it.

### 4d. Write the changelog doc (STABLE releases only — skip for prereleases)

Create `doc/src/content/docs/changelog/v{VERSION}.mdx`:

```mdx
---
title: 'v{VERSION}'
sidebar_position: { MAJOR * 1000 + MINOR * 100 + PATCH }
---

# v{VERSION}

Released: {YYYY-MM-DD}

## Breaking Changes

- Description (commit-hash)

## Features

- Description (commit-hash)

## Bug Fixes

- Description (commit-hash)

## Other Changes

- Description (commit-hash)
```

Rules:

- Only include sections that have entries
- Use today's date
- Each entry: commit subject with the short hash in parentheses
- The changelog category sorts `desc`, so the position formula puts newer versions on top

For a `stable` promotion, analyze ALL commits since the last **stable** tag (skipping `-next.*` tags) so the changelog covers the whole prerelease line.

## Step 5: Build and Test

```bash
pnpm build:rust && pnpm build && pnpm test
```

`pnpm build:rust` refreshes `crates/mdx-formatter-napi/mdx-formatter-napi.node` so the tests exercise the current Rust code, not a stale local binary. If anything fails, stop — nothing has been committed yet, so `git checkout -- . ` (plus deleting the new changelog file) resets cleanly.

## Step 6: Atomic Commit + Push

ONE commit containing everything (single revert = full rollback):

```bash
git add package.json npm/*/package.json pnpm-lock.yaml
git add doc/src/content/docs/changelog/v{VERSION}.mdx   # stable only
git commit -m "chore(release): Bump to v{VERSION}"
git push origin main
BUMP_SHA=$(git rev-parse HEAD)
```

## Step 7: Wait for CI on the Bump Commit

Delegate to `/watch-ci` — do NOT reimplement polling:

```
Skill(skill="watch-ci", args="--branch main --commit <BUMP_SHA>")
```

If CI fails, fix the issue, push the fix, and re-invoke `/watch-ci`. **Do not tag until CI is green.**

**With `--confirm`: STOP HERE.** Report that the bump is pushed and CI is green, and print the exact commands for the user to fire:

```
git tag v{VERSION} && git push origin v{VERSION}
```

## Step 8: Tag → Auto-Publish

```bash
git tag v{VERSION}
git push origin v{VERSION}
```

The tag push triggers `release.yml`: 4 platform binary builds → 4 platform package publishes → root package publish (prepublishOnly runs tsc + vitest against the shipped linux binary).

## Step 9: Watch the Release Run

Find the run (allow a few seconds for it to appear):

```bash
gh run list --workflow release.yml --limit 3 --json databaseId,displayTitle,status,headBranch
```

Watch it to completion with a background poll (`gh run view <id> --json status,conclusion` every 30s until `completed` — background shell loop, NOT foreground sleep).

- **On success**: proceed to Step 10.
- **On failure**: fetch the failed logs (`gh run view <id> --log-failed`). If clearly transient (network flake, runner eviction), retry once with `gh run rerun <id> --failed` — the idempotency guards make re-runs safe. Otherwise surface the failure summary and stop. Do NOT delete the tag; the next run of this skill bumps past the broken version.

## Step 10: GitHub Release (STABLE releases only — skip for prereleases)

```bash
NOTES=$(sed -n '/^Released:/,$ p' doc/src/content/docs/changelog/v{VERSION}.mdx)
gh release create v{VERSION} --title "v{VERSION}" --notes "$NOTES"
```

## Step 11: Verify + Final Report

```bash
npm view @takazudo/mdx-formatter dist-tags
npm view "@takazudo/mdx-formatter@{VERSION}" version
npm view "@takazudo/mdx-formatter-linux-x64-gnu@{VERSION}" version
```

Report: released version, dist-tag (`latest` or `next`), release.yml run URL, GitHub Release URL (stable), npm package page `https://www.npmjs.com/package/@takazudo/mdx-formatter`.

Note for `stable` promotions: the `next` dist-tag stays pointing at the last prerelease (existing convention — `@next` users stay until they update). Mention it in the report.

## Failure Recovery

### Build or test failure (Step 5)

Nothing is committed yet. Reset the working tree, fix the issue, re-run the skill.

### CI fails on the bump commit (Step 7)

Fix, commit, push, re-invoke `/watch-ci`. Do not tag until green.

### release.yml fails (Step 9)

- Transient → `gh run rerun <id> --failed` (once).
- Real failure after a partial publish (e.g. platform packages live, root missing) → fix the cause, then re-run via `gh workflow run release.yml` from the tag's commit or `gh run rerun` — the idempotency guards skip what is already live.
- `E404 Not Found - PUT` or 2FA errors → the NPM_TOKEN secret lacks scope/automation type. Fix at npmjs.com, then re-run the workflow.

### Rolling back before the tag was pushed

The Step 6 commit is atomic — one revert undoes the bump, the lockfile, and the changelog doc:

```bash
git revert --no-edit <BUMP_SHA>
git push origin main
```

If later commits already sit on top of the bump, do NOT revert; the stale version number is harmless — the next release bumps past it.

### Never delete published things

Never delete a pushed `v*` tag, a published GitHub Release, or unpublish an npm version. Abandoned/broken versions are superseded by the next bump.
