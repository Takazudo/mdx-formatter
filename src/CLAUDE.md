# src/ — TypeScript Wrapper for Rust Engine

## Architecture

The formatting engine is written in Rust (`crates/mdx-formatter-core`). The TypeScript code in `src/` is a thin wrapper that loads the Rust napi module and provides the npm package API.

### Key Files

- `index.ts` — Public API (`format()`, `formatFile()`, `checkFile()`, `detectMdx()`)
- `cli.ts` — CLI entry point (commander-based)
- `rust-formatter.ts` — Loads the Rust napi module (platform package or local build)
- `settings.ts` — Default `FormatterSettings` with all rules and their defaults
- `types.ts` — Settings interfaces and `FormatOptions`
- `load-config.ts` — Loads `.mdx-formatter.json` config and merges with defaults
- `utils.ts` — Utility functions (deep clone, deep merge with prototype pollution guard)
- `detect-mdx.ts` — MDX content detection heuristic
- `browser.ts` — Browser-safe export (re-exports from index.ts; for true browser use, see WASM)

## Settings

All formatter rules are defined in `settings.ts` as the `formatterSettings` object. Each rule has an `enabled` flag and rule-specific options. Some rules (e.g., `indentJsxContent`, `addEmptyLinesInBlockJsx`) accept component name arrays that ship empty by default — users configure them per-project via `.mdx-formatter.json`.

## Types

Settings interfaces live in `types.ts`. Key types:

- `FormatterSettings` / `FormatOptions` — Configuration
- `DeepPartial<T>` — Used for partial settings overrides
