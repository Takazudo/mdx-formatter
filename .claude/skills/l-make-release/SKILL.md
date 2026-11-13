---
description: 'Release @takazudo/mdx-formatter — bump the version, sync platform packages, write the changelog, integrate on main, wait for CI, run the release coordinator (dry run, then the real start) so Actions tags the frozen SHA and release.yml publishes all 5 npm packages through OIDC trusted publishing, then verify npm, dist-tags and the GitHub Release. Works from Claude Code Cloud (no tag push, no PAT, no npm token). Fully autonomous end-to-end by default; pass --confirm to vet the proposal and stop after the coordinator dry run. Triggers on rough requests like "bump version", "cut a release", "release mdx-formatter", "make a release", "publish a new version".'
user-invocable: true
argument-description: 'Optional: major, minor, patch — stable release with that bump. No argument: analyze commits and pick the bump autonomously (a leftover X.Y.Z-next.N version is finalized to X.Y.Z). --confirm — interactive mode: present the bump proposal and wait, and stop before tagging instead of publishing.'
---

# /l-make-release

One-call orchestrator for releasing `@takazudo/mdx-formatter` and its four lockstep platform packages. Bumps the version, syncs the platform packages, writes a changelog doc, integrates the bump on `main`, waits for CI on that exact commit, then dispatches `.github/workflows/release-coordinator.yml`: a read-only dry run first, then the real start. The coordinator creates the `v*` tag at the frozen SHA with Actions' own token and explicitly dispatches `release.yml`, which builds the napi binaries, packs once, publishes **all five npm packages** through OIDC trusted publishing, moves both `latest` and `next`, verifies the registry and creates the GitHub Release. Full reference: [scripts/release/README.md](../../../scripts/release/README.md).

## Invocation & autonomy

This skill is **model-invocable**: a rough natural-language request like "bump version", "cut a release", or "release it" may trigger it.

**Default: fully autonomous end-to-end — NEVER ask for confirmation, NEVER stop and wait.** Steps 1–3 are read-only; print the Step 3 proposal (current → new version + categorized changelog) **for visibility only** and proceed straight into Step 4. The coordinator start with `dry_run=false` at Step 9 IS the publish trigger — do not pause to ask "tag?", "publish?", or any equivalent. The invocation itself is the authorization. A request that only asks to prepare or check a release is not an invocation of this skill's publish steps.

**`--confirm` option (opt-in interactive mode).** When the invocation includes `--confirm` (e.g. `/l-make-release --confirm`, `/l-make-release minor --confirm`), restore interactive behavior: present the Step 3 proposal and **wait for explicit user confirmation** before the first mutation (Step 4), and **stop after Step 8 (coordinator dry run green)** — report the version, the frozen SHA and the coordinator inputs for `dry_run=false`, and let the user start it. Use this when the version strategy or release notes need vetting.

## Architecture (why this works)

- The four platform packages (`npm/darwin-arm64`, `npm/darwin-x64`, `npm/linux-x64-gnu`, `npm/win32-x64-msvc`) are **pnpm workspace members**, declared on the root as pinned `workspace:X.Y.Z` optionalDependencies. They resolve locally at bump time — before the new versions exist on the registry — so the lockfile stays consistent and bump-commit CI is green. (The pre-workspace flow could never have green CI on the bump commit: `ERR_PNPM_OUTDATED_LOCKFILE`, see v1.2.1 history.)
- `scripts/sync-napi-versions.mjs` keeps all five `package.json` versions + the `workspace:` specifiers lockstep with the root version.
- `release.yml` packs once — the platform packages with `npm pack`, the root with `pnpm pack` (which rewrites `workspace:X.Y.Z` → exact `X.Y.Z`) — verifies the tarballs and the shipped Linux binary, then publishes those exact files with `npm publish <tgz>` through OIDC, natives first. An existing version must have identical bytes; a version is never republished.
- **Stable releases only — no prereleases.** The `-next.N` line was retired after `1.3.0-next.5`. Every release publishes under `latest`, then `release.yml` moves `next` to the same version, so `next` is just an alias of `latest` and anyone still installing `@next` lands on the stable release. Don't delete the `next` tag: `@next` installs would fail.
- **No npm token.** npm authenticates the `publish` job through GitHub OIDC (trusted publisher: owner `Takazudo`, repo `mdx-formatter`, workflow `release.yml`, no environment, allowed `npm publish` + `npm dist-tag`, on each of the five packages). The job refuses `NPM_TOKEN` / `NODE_AUTH_TOKEN` / npmrc tokens rather than falling back to them.
- **Why a coordinator.** Claude Code Cloud's `gh` is not authenticated and its git proxy can refuse tag pushes. `release-coordinator.yml` (dispatched on `main`) creates the tag with Actions' own `GITHUB_TOKEN` and dispatches `release.yml` explicitly, because a tag created with `GITHUB_TOKEN` does not trigger push workflows.

## Boundaries

- This skill **never** runs `npm publish` / `pnpm publish` / `npm dist-tag` locally and never adds an npm token, PAT or other credential. Publishing happens only in `release.yml`.
- The GitHub Release is created by `release.yml`'s `finalize` job after all five packages and both dist-tags are verified.
- Never move or delete a `v*` tag. The coordinator refuses a tag at another commit and keeps an identical one.
- Never create a prerelease (`X.Y.Z-next.N` or any other suffix), even if asked for "next". Ship a stable version instead.

## Step 1: Preconditions

Verify ALL of the following. If any check fails, stop with a clear message.

1. Current branch is `main` (`git branch --show-current`), or, in Claude Code Cloud, the session branch freshly created from the latest `origin/main`
2. Working tree is clean (`git status --porcelain` returns empty)
3. Know which GitHub capabilities exist: an authenticated `gh` (`gh auth status`), or the GitHub MCP tools (`actions_run_trigger`, `actions_list`, `create_pull_request`, `merge_pull_request`). In Claude Code Cloud `gh` is usually unauthenticated; use the MCP tools. If neither can dispatch a workflow, stop after Step 7 and hand the user the coordinator inputs (Actions UI fallback).
4. Tags are fresh and at least one `v*` tag exists:

   ```bash
   git fetch --tags origin
   git tag -l 'v*' --sort=-v:refname | head -1
   ```

## Step 2: Determine Next Version

Read the current version from the root `package.json`.

### No argument

- Current is a leftover prerelease `X.Y.Z-next.N`: finalize it → `X.Y.Z` (analyze commits since the last **stable** tag, skipping `-next.*` tags).
- Current is stable `X.Y.Z`: analyze commits since the last tag (Step 3) and pick autonomously:
  - breaking changes → **major**
  - new features → **minor**
  - otherwise → **patch**

### `major` / `minor` / `patch` argument

Stable release with that bump from the current stable version (e.g. `patch`: `1.2.1` → `1.2.2`). If the current version is a leftover prerelease, bump from its base (`1.3.0-next.5` + `patch` → `1.3.0`, + `minor` → `1.3.0`, + `major` → `2.0.0`).

### Guard: version must not already exist on npm

A partially recovered prior run may have published the computed version even though the local state suggests otherwise. Always check, and bump past any hit:

```bash
node -e "fetch('https://registry.npmjs.org/@takazudo%2fmdx-formatter',{headers:{'Cache-Control':'no-cache'}}).then(async r=>{if(r.status!==200)throw new Error('HTTP '+r.status);const d=await r.json();console.log(d.versions['<version>']?'TAKEN':'FREE')}).catch(e=>{console.error('UNKNOWN',e.message);process.exit(3)})"
```

`TAKEN` → recompute (next patch) and re-check. `UNKNOWN` (network, 4xx/5xx) is not "free": retry later or stop.

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

### 4d. Write the changelog doc

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

When finalizing a leftover prerelease, analyze ALL commits since the last **stable** tag (skipping `-next.*` tags) so the changelog covers the whole prerelease line.

## Step 5: Build and Test

```bash
pnpm build:rust && pnpm build && pnpm test
```

`pnpm build:rust` refreshes `crates/mdx-formatter-napi/mdx-formatter-napi.node` so the tests exercise the current Rust code, not a stale local binary. If anything fails, stop — nothing has been committed yet, so a full reset is:

```bash
git checkout -- . && git clean -f doc/src/content/docs/changelog/
```

(`git clean` removes the untracked changelog mdx written in Step 4d.)

## Step 6: Atomic Commit, Integrate on main

ONE commit containing everything (single revert = full rollback):

```bash
git add package.json npm/*/package.json pnpm-lock.yaml
git add doc/src/content/docs/changelog/v{VERSION}.mdx
git commit -m "chore(release): Bump to v{VERSION}"
```

- **Local with push rights to `main`:** `git push origin main`.
- **Claude Code Cloud (or no direct push):** push the session branch, open a PR to `main`, wait for its CI, and merge it with a regular merge.

Then read `main`'s HEAD and keep it as `SHA` (full 40 characters). That is the frozen candidate; never replace it with a later `main` commit during this release.

## Step 7: Wait for CI on the exact candidate

`ci.yml`'s **push** run on `main` for exactly `SHA` must be green (a PR run does not count). Delegate to `/watch-ci` when `gh` works (`Skill(skill="watch-ci", args="--branch main --commit <SHA>")`), otherwise poll `actions_list` → `list_workflow_runs` for `ci.yml` filtered by branch `main` and match `head_sha`. If it was cancelled by a later push, re-run it; do not freeze another commit.

## Step 8: Coordinator dry run

Dispatch `release-coordinator.yml` on `main` with `version={VERSION}`, `sha=<SHA>`, `dry_run=true`:

- Cloud: `actions_run_trigger` (`method: run_workflow`, `workflow_id: release-coordinator.yml`, `ref: main`, `inputs: {version, sha, dry_run: true}`).
- With `gh`: `gh workflow run release-coordinator.yml --ref main -f version={VERSION} -f sha=<SHA> -f dry_run=true`.

Find the run titled `Release coordinator v{VERSION} @ <SHA> (dry run)` and wait for it. It must be green; read its summary (CI run, npm state, warnings). A failure here changes nothing — fix the cause and repeat. Exit-3 style messages ("unknown", "pending") mean "check again later", never "not published".

**With `--confirm`: STOP HERE** and report `version`, `SHA` and the `dry_run=false` inputs.

## Step 9: Start the release

Send the same inputs with `dry_run=false`. The `tag` job creates `v{VERSION}` at `SHA` (or keeps an identical one), and the `dispatch` job starts `release.yml` at the tag and prints the run id and attempt. A green coordinator is **not** a finished release. If the tag job reports HTTP 403, do not work around it with another credential; report GitHub's message and the candidate/control/workflow SHAs it printed and let the user decide (push the tag with their credentials, or freeze a new candidate).

## Step 10: Watch the Release run

Follow the `release.yml` run the coordinator reported (match run id, tag `v{VERSION}` and `SHA`). Poll in the background (`actions_get` → `get_workflow_run`, or `gh run view <id> --json status,conclusion`) — never a foreground sleep.

- **Success:** `finalize` printed the five-package evidence table and the GitHub Release URL.
- **Failure:** read the failed job log. Re-send the coordinator with the same inputs: it reuses an active run, re-runs the failed jobs of the original run after a partial publish (same packed tarballs), or starts a new run when nothing was published. Never move the tag, never republish.

## Step 11: Verify + Final Report

```bash
for PKG in @takazudo/mdx-formatter @takazudo/mdx-formatter-darwin-arm64 @takazudo/mdx-formatter-darwin-x64 @takazudo/mdx-formatter-linux-x64-gnu @takazudo/mdx-formatter-win32-x64-msvc; do
  npm view "${PKG}@${VERSION}" version _npmUser.trustedPublisher dist.attestations.url
  npm view "${PKG}" dist-tags --json
done
```

Report separately: npm publication (five exact versions, trusted publisher, provenance run id), dist-tags (`latest` and `next` = `{VERSION}` on all five), the tag (`v{VERSION}` → `SHA`), and the GitHub Release URL, plus the coordinator and release.yml run URLs.

## Failure Recovery

### Build or test failure (Step 5)

Nothing is committed yet. Reset the working tree, fix the issue, re-run the skill.

### CI fails on the bump commit (Step 7)

Fix, commit, push, re-invoke `/watch-ci`. Do not tag until green.

### release.yml fails (Step 10)

- Re-send the coordinator with the same `version` and `SHA`. It decides from observed state: an active run is reused, a partial publish re-runs the failed jobs of the original run (its packed tarballs are reused), nothing published → a new run. In the Actions UI, "Re-run failed jobs" on the original run is equivalent.
- `different bytes` in the publish log means npm already holds that version from another build. Do not force it; resume the original run instead, or leave the version and release the next patch.
- `registry ... unknown` / exit 3: the registry could not be read. Wait and re-run; it is never treated as "not published".
- All five published but dist-tags or the GitHub Release missing → re-send the coordinator; `release.yml` then skips uploads, checks provenance, synchronizes the tags and finalizes.

#### OIDC authentication failures

`ENEEDAUTH`, `E404 Not Found - PUT` or `E403` from `npm publish` / `npm dist-tag` in the `publish` job mean npm did not accept the OIDC identity. Check, on npmjs.com for the failing package, that a trusted publisher exists with owner `Takazudo`, repository `mdx-formatter`, workflow `release.yml` (exact, with `.yml`), environment empty, and allowed actions `npm publish` and `npm dist-tag`; that the job still has `id-token: write`; and that npm is ≥ 11.21.0. Read the registry before retrying: a failed command does not prove nothing was published. Re-issuing an old npm token is **not** a fix; the workflows refuse tokens. If the owner decides to fall back temporarily, that is a separate, explicit change.

### Historical stable-only `latest` repair

The `repair-tags.yml` workflow remains for the September 2026 stable-only recovery. It does not implement the current both-tag policy. For a partial current release, re-send the coordinator (or "Re-run failed jobs" on the original `release.yml` run) so its byte-checked publish and both-tag synchronization complete. Use the stable-only repair workflow only when deliberately restoring stable `latest`; follow [scripts/release/README.md](../../../scripts/release/README.md) and verify that this is the intended policy for that incident.

### Rolling back before the coordinator created the tag

The Step 6 commit is atomic — one revert undoes the bump, the lockfile, and the changelog doc:

```bash
git revert --no-edit <BUMP_SHA>
git push origin main
```

If later commits already sit on top of the bump, do NOT revert; the stale version number is harmless — the next release bumps past it.

### Never delete published things

Never delete a pushed `v*` tag, a published GitHub Release, or unpublish an npm version. Abandoned/broken versions are superseded by the next bump.
