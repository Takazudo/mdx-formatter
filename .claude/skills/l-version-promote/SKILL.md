---
description: Promote a next prerelease to a stable release
user-invocable: true
disable-model-invocation: true
---

# /l-version-promote

Promote a `@takazudo/mdx-formatter@next` prerelease to a stable release.

## Preconditions

1. Current branch is `main`
2. Working tree is clean
3. Current version in `package.json` is a `-next.N` prerelease (e.g., `0.5.0-next.3`)

If the current version is NOT a prerelease, stop and tell the user.

## Determine Stable Version

Strip the `-next.N` suffix:

- `0.5.0-next.3` → `0.5.0`
- `1.0.0-next.1` → `1.0.0`

Present to the user and **wait for confirmation**.

## Create Changelog Doc

Create `doc2/src/content/docs/changelog/v{VERSION}.mdx` using the same format as `/l-version-increment`.

Analyze all commits since the last stable tag (`git tag -l 'v*' --sort=-v:refname` excluding prerelease tags) and categorize them.

Rules:

- `sidebar_position` = `MAJOR * 1000 + MINOR * 100 + PATCH`
- Include `title` in frontmatter
- Only include sections that have entries

```bash
git add doc2/src/content/docs/changelog/v{VERSION}.mdx
git commit -m "docs: Add changelog for v{VERSION}"
```

## Update Version

Update `package.json` version to the stable version (without `-next.N`).

```bash
git add package.json
git commit -m "chore: Bump version to v{VERSION}"
```

## Build and Test

```bash
pnpm build && pnpm test
```

If anything fails, stop.

## Push and Wait for CI

```bash
git push
```

Wait for CI to pass.

## Tag and Release

**Ask for confirmation.**

```bash
git tag v{VERSION}
git push --tags
```

Create GitHub release:

```bash
NOTES=$(sed -n '/^Released:/,$ p' doc2/src/content/docs/changelog/v{VERSION}.mdx)
gh release create v{VERSION} --title "v{VERSION}" --notes "$NOTES"
```

## Publish to npm (stable)

**Ask for confirmation.**

The user runs manually:

```bash
npm publish
```

This publishes under the `latest` tag (default). The `next` tag automatically becomes stale — users who had installed `@next` will stay on the prerelease version until they explicitly update.

After publishing, verify:

```bash
npm view @takazudo/mdx-formatter dist-tags
```

Both `latest` and `next` should show the correct versions.
