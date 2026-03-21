# src/ — Formatter Source Code

## Architecture

The formatter parses markdown/MDX into an AST (via remark), analyzes it, then applies targeted line-based operations to the original text. This preserves formatting that AST round-tripping would destroy.

### Key Files

- `index.ts` — Public API (`format()`, `formatFile()`, `checkFile()`, `detectMdx()`)
- `cli.ts` — CLI entry point (commander-based)
- `mdx-formatter.ts` — Core formatter (`MdxFormatter`): parses AST, collects `FormatterOperation`s, applies them to source lines
- `html-block-formatter.ts` — Formats HTML blocks within MDX using Prettier
- `rust-formatter.ts` — Wrapper for Rust napi formatter (tries platform package, then local build)
- `indent-detector.ts` — Auto-detects indentation style from file content
- `settings.ts` — Default `FormatterSettings` with all rules and their defaults
- `types.ts` — All shared type definitions (AST node types, settings interfaces, operation types)
- `load-config.ts` — Loads `.mdx-formatter.json` config and merges with defaults
- `utils.ts` — Utility functions (deep clone, deep merge with prototype pollution guard)
- `browser.ts` — Browser-safe export (no Node.js dependencies)

## Settings

All formatter rules are defined in `settings.ts` as the `formatterSettings` object. Each rule has an `enabled` flag and rule-specific options. Some rules (e.g., `indentJsxContent`, `addEmptyLinesInBlockJsx`) accept component name arrays that ship empty by default — users configure them per-project via `.mdx-formatter.json`.

## Types

All type definitions live in `types.ts`. Import types from there, not from external packages directly. Key types:

- `FormatterSettings` / `FormatOptions` — Configuration
- `FormatterOperation` — Line-based edit operations
- `MdxJsxElement` / `MdxJsxAttribute` — MDX AST node types
- `DeepPartial<T>` — Used for partial settings overrides
