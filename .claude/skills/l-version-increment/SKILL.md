---
description: Bump package version, generate changelog doc, tag, and publish to npm
user-invocable: true
disable-model-invocation: true
argument-description: 'Optional: major, minor, or patch to skip the proposal step'
---

# /l-version-increment

Bump the version of `@takazudo/mdx-formatter`, generate a changelog doc page, commit, tag, and publish to npm.

The version bump must update the four `npm/*/package.json` platform sub-packages and root `optionalDependencies` in lockstep with root `version`, so that consumers of the published package always resolve a prebuilt napi binary whose version matches the root package. The `pnpm sync:napi-versions` script does this mechanically — always run it as part of the bump and commit all five `package.json` files atomically.

## Preconditions

Before doing anything else, verify ALL of the following. If any check fails, stop and tell the user.

1. Current branch is `main`
2. Working tree is clean (`git status --porcelain` returns empty)
3. At least one `v*` tag exists (`git tag -l 'v*'`). If no tag exists, tell the user to create the initial tag first (e.g. `git tag v0.1.0 && git push --tags`).

Find the latest version tag:

```bash
git tag -l 'v*' --sort=-v:refname | head -1
```

## Analyze changes since last tag

Run:

```bash
git log <last-tag>..HEAD --oneline
```

and

```bash
git diff <last-tag>..HEAD --stat
```

Categorize each commit by its conventional-commit prefix:

- **Breaking Changes**: commits with an exclamation mark suffix (e.g. `feat!:`) or BREAKING CHANGE in body
- **Features**: `feat:` prefix
- **Bug Fixes**: `fix:` prefix
- **Other Changes**: everything else (`docs:`, `chore:`, `refactor:`, `ci:`, `test:`, `style:`, `perf:`, etc.)

## Propose version bump

Based on the changes:

- If there are breaking changes → propose **major** bump
- If there are features (no breaking) → propose **minor** bump
- Otherwise → propose **patch** bump

If the user passed an argument (`major`, `minor`, or `patch`), use that directly instead of proposing.

Present the proposal to the user:

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

Only show sections that have entries. **Wait for user confirmation before proceeding.**

## Create changelog doc

Create `doc/src/content/docs/changelog/v{VERSION}.mdx` with this format:

```mdx
---
title: 'v{VERSION}'
sidebar_position: { computed }
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
- `sidebar_position` = `MAJOR * 1000 + MINOR * 100 + PATCH` — the changelog category uses `sortOrder: "desc"`, so higher values appear first (newer versions on top)
- Use today's date for the release date
- Each entry should be the commit subject with the short hash in parentheses

## Commit changelog

```bash
git add doc/src/content/docs/changelog/v{VERSION}.mdx
git commit -m "docs: Add changelog for v{VERSION}"
```

## Bump version in package.json

1. Update the `version` field in root `package.json` to the new version (without the `v` prefix).

2. Run the sync helper to propagate the new version to all four `npm/*/package.json` files and root `optionalDependencies`:

    ```bash
    pnpm sync:napi-versions
    ```

3. Stage and commit all five `package.json` files atomically:

    ```bash
    git add package.json npm/*/package.json
    git commit -m "chore: Bump version to v{VERSION}"
    ```

## Build and test

Run the full build and test suite to make sure everything is good:

```bash
pnpm build && pnpm test
```

If anything fails, stop and tell the user. Do not proceed with tagging or publishing.

## Push and wait for CI

Push the commits first (without the tag) and wait for CI to pass:

```bash
git push
```

Then check CI status with `gh run list --branch main --limit 2`. Poll every 30 seconds until both CI and Production Deploy show `completed success`. If CI fails, fix the issue, commit, and push again before proceeding.

**Do not tag or publish until CI is green.**

## Tag, push tag, and create GitHub release

**Ask the user for confirmation before tagging.**

```bash
git tag v{VERSION}
git push --tags
```

After pushing the tag, create a GitHub release using the changelog content (with YAML frontmatter and `# v{VERSION}` heading stripped, since the release title already shows the version):

```bash
NOTES=$(sed -n '/^Released:/,$ p' doc/src/content/docs/changelog/v{VERSION}.mdx)
gh release create v{VERSION} --title "v{VERSION}" --notes "$NOTES"
```

## Publish to npm

**Ask the user for confirmation before publishing.**

The user will run `npm publish` manually (it requires browser-based 2FA). Tell the user to run:

```bash
npm publish
```

After publishing, verify the package page: `https://www.npmjs.com/package/@takazudo/mdx-formatter`
