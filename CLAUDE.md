# @takazudo/mdx-formatter

AST-based markdown and MDX formatter powered by a Rust engine (via napi-rs). Published as a scoped npm package (ESM-only).

## Tech Stack

- **Language**: TypeScript (strict mode, ES2022 target, Node16 module resolution)
- **Runtime**: Node.js >= 18
- **Package manager**: pnpm
- **Test framework**: vitest
- **Linting**: ESLint (flat config) + Prettier + lefthook (pre-commit hooks)
- **Build**: `tsc` (output to `dist/`)
- **Doc site**: zudo-doc / Astro (workspace in `doc/`)
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

## Package Publishing

- Scoped package: `@takazudo/mdx-formatter`
- `files` field limits published content to: `dist/`, `format-stdin.js`, `README.md`, `LICENSE`
- `prepublishOnly` runs `tsc && vitest run` automatically
- Use `/l-version-increment` for stable releases
- Use `/l-version-next` for prerelease (`@next` dist-tag)
- Use `/l-version-promote` to promote a next version to stable
