# @takazudo/mdx-formatter

AST-based markdown and MDX formatter powered by a Rust engine (via napi-rs). Published as a scoped npm package (ESM-only).

## Tech Stack

- **Language**: TypeScript (strict mode, ES2022 target, Node16 module resolution)
- **Runtime**: Node.js >= 18
- **Package manager**: pnpm
- **Test framework**: vitest
- **Linting**: ESLint (flat config) + Prettier + lefthook (pre-commit hooks)
- **Build**: `tsc` (output to `dist/`)
- **Doc site**: zudo-doc 5.13.0 / zfb (workspace in `doc/`; Node.js >= 22)
- **Rust implementation**: Production-ready Rust engine in `crates/` (markdown-rs + napi-rs + WASM)

## Commands

```bash
pnpm build          # Compile TypeScript to dist/
pnpm test           # Run tests (vitest run)
pnpm test:watch     # Watch mode
pnpm test:coverage  # Coverage report
pnpm lint           # ESLint check
pnpm lint:fix       # ESLint autofix
pnpm check          # Prettier + ESLint check
pnpm check:fix      # Prettier + ESLint autofix
pnpm build:wasm:doc # Build/copy the WASM assets required by the docs playground
pnpm doc:start      # Run the zfb docs dev server (port 4321) plus doc-history (port 4322)
pnpm --dir doc check # Run zfb's docs type/content checks
pnpm --dir doc build # Build the static zfb docs site to doc/dist/
pnpm --dir doc preview # Preview doc/dist/ with zfb
```

## Conventions

- **Commits**: Start with a scope prefix, then a short description:
  - `[formatter] ` - main formatter script (src/, test/, build, CLI)
  - `[doc] ` - documentation site related updates (doc/)
  - `[claude] ` - Claude Code related tweaks (.claude/, CLAUDE.md)
  - `[misc] ` - other things (CI, dependencies, config, etc.)
- **Unused vars**: Prefix with `_` (enforced by ESLint `argsIgnorePattern: '^_'`)
- **Imports**: Always use `.js` extension in TypeScript imports (required for ESM with Node16 resolution)
- **Console**: `no-console` is `warn` everywhere except `src/cli.ts` and `format-stdin.js`
- **Docs**: zudo-doc owns the generated layout, chrome, routes, and default islands. Keep authored docs in `doc/src/content/`; add supported customization through zudo-doc's configuration and chrome bindings rather than altering generated framework internals.

## Package Publishing

- Scoped package: `@takazudo/mdx-formatter` + 4 platform binary packages (`npm/*`, pnpm workspace members pinned as `workspace:X.Y.Z` optionalDependencies)
- `files` field limits published content to: `dist/`, `format-stdin.js`, `README.md`, `LICENSE`
- `prepublishOnly` runs `tsc && vitest run` automatically
- Use `/l-make-release` for ALL releases (stable, prerelease, promotion) — one-call autonomous: bump, changelog, CI wait, tag; the tag triggers `release.yml` which auto-publishes all 5 packages via the repo `NPM_TOKEN`. Pass `--confirm` for interactive vetting
- Never run `npm publish` / `pnpm publish` locally — publishing happens only in `release.yml` (the root package MUST go through `pnpm publish` there, which rewrites the `workspace:` specifiers)
