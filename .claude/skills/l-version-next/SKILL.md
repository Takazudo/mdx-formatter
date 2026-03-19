---
description: Publish a prerelease version under the npm "next" dist-tag
user-invocable: true
disable-model-invocation: true
argument-description: 'Optional: major, minor, or patch to set the base version (default: minor)'
---

# /l-version-next

Publish a prerelease version of `@takazudo/mdx-formatter` under the npm `next` dist-tag.

Users install with `npm install @takazudo/mdx-formatter@next`.

## Version Format

`X.Y.Z-next.N` where:

- `X.Y.Z` is the target stable version (e.g., `0.5.0`)
- `N` is an incrementing prerelease number (1, 2, 3, ...)

## Preconditions

Before doing anything else, verify ALL of the following. If any check fails, stop and tell the user.

1. Working tree is clean (`git status --porcelain` returns empty)
2. `gh` CLI is authenticated

## Determine Version

Read the current version from `package.json`.

### If current version is already a `-next.N` prerelease:

Increment the prerelease number:

- `0.5.0-next.1` → `0.5.0-next.2`
- `0.5.0-next.2` → `0.5.0-next.3`

### If current version is a stable release (e.g., `0.4.3`):

Determine the base version for the next release:

- If the user passed `major`: bump major (e.g., `0.4.3` → `1.0.0-next.1`)
- If the user passed `minor` or no argument: bump minor (e.g., `0.4.3` → `0.5.0-next.1`)
- If the user passed `patch`: bump patch (e.g., `0.4.3` → `0.4.4-next.1`)

Present the version to the user and **wait for confirmation**.

## Build and Test

```bash
pnpm build && pnpm test
```

If anything fails, stop and tell the user. Do not proceed.

## Update Version

Update the `version` field in `package.json` to the new prerelease version.

```bash
git add package.json
git commit -m "chore: Bump version to v{VERSION}"
```

## Push

```bash
git push
```

## Publish with `next` Tag

**Ask the user for confirmation before publishing.**

The user will run `npm publish --tag next` manually (it requires browser-based 2FA). Tell the user to run:

```bash
npm publish --tag next
```

After publishing, verify:

```bash
npm view @takazudo/mdx-formatter dist-tags
```

This should show both `latest` (stable) and `next` (prerelease) tags.

## Notes

- No changelog doc is created for prerelease versions
- No git tag is created for prerelease versions
- No GitHub release is created for prerelease versions
- To promote a next version to stable, use `/l-version-promote`
- To install the next version: `npm install @takazudo/mdx-formatter@next`
