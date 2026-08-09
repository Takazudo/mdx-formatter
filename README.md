# @takazudo/mdx-formatter

AST-based markdown and MDX formatter with Japanese text support. Powered by a Rust engine (via napi-rs) for fast, reliable formatting.

## Features

- **Rust-powered** — Native Rust engine via napi-rs, 3-7x faster than pure JS
- **Hybrid formatter** — Parses AST for analysis, applies edits to original source lines (no lossy round-trip)
- **MDX support** — Full support for MDX syntax including JSX components, imports, exports
- **Japanese text handling** — Preserves Japanese punctuation and text formatting
- **Docusaurus admonitions** — Preserves `:::note`, `:::tip`, `:::warning` etc. syntax
- **HTML block formatting** — Proper indentation for HTML blocks (dl, table, ul, div, etc.)
- **GFM features** — Tables, strikethrough, task lists
- **YAML frontmatter** — Formatting with safe value pre-processing
- **CLI and API** — Use as command-line tool or import as library
- **WASM support** — Browser-compatible WASM build available
- **Configurable** — 10 independently toggleable rules via config file or API

## Installation

```bash
npm install @takazudo/mdx-formatter
```

Or use directly with npx:

```bash
npx @takazudo/mdx-formatter --write "**/*.md"
```

### Prerelease (next)

```bash
npm install @takazudo/mdx-formatter@next
```

## Usage

### CLI

```bash
# Check files (exit with error if formatting needed)
mdx-formatter --check "**/*.{md,mdx}"

# Format files in place
mdx-formatter --write "**/*.{md,mdx}"

# With config file
mdx-formatter --config .mdx-formatter.json --write "**/*.mdx"
```

### API

```javascript
import { format } from '@takazudo/mdx-formatter';

const formatted = await format('# Hello\nWorld');
console.log(formatted); // '# Hello\n\nWorld'
```

### List Normalize

Five rules clean up AI-authored list-item content. They are exposed as flat
top-level kebab-case keys (not nested objects):

| Key                                   | Default       | Purpose                                                                           |
| ------------------------------------- | ------------- | --------------------------------------------------------------------------------- |
| `tighten-list-continuations`          | `"heuristic"` | Collapse blank gaps inside list items whose children are continuation paragraphs. |
| `tighten-list-item-spacing`           | `"heuristic"` | Collapse single blank gaps between adjacent sibling list items when safe.         |
| `recover-escaped-code-in-lists`       | `"safe"`      | Re-indent fenced code blocks that escaped to column 0 between list items.         |
| `recover-escaped-tables-in-lists`     | `"safe"`      | Re-indent GFM tables that escaped to column 0 between list items.                 |
| `recover-escaped-paragraphs-in-lists` | `"off"`       | Re-indent continuation paragraphs that escaped to column 0 (opt-in).              |

Each accepts `"off"` to disable, its default middle value (`"heuristic"` or
`"safe"`) for the conservative trigger, or `"aggressive"` to drop the
structural safeguards. See the
[List Normalize options docs](https://mdx-formatter.takazudomodular.com/docs/options/#list-normalize)
for per-rule before/after examples.

### Preview with `--dry-run`

```bash
mdx-formatter --dry-run "**/*.{md,mdx}"
```

Writes every rule-level change to **stderr** without touching the files.
Useful for auditing what the list-normalize rules (or any other rule) would
change before committing. Exits 0 whether or not there was anything to
report; conflicts with `--write` / `--check`. The same report is available
programmatically via the `dryRunReport()` API.

### Browser (WASM)

```bash
npm install @takazudo/mdx-formatter-wasm
```

```javascript
import init, { format_with_defaults } from '@takazudo/mdx-formatter-wasm';

await init();
const formatted = format_with_defaults('# Hello\nWorld');
```

See [Browser Usage](https://mdx-formatter.takazudomodular.com/docs/overview/browser-usage) for details.

## Documentation

Full documentation at **[mdx-formatter.takazudomodular.com](https://mdx-formatter.takazudomodular.com/)**:

- [Overview](https://mdx-formatter.takazudomodular.com/docs/overview) — Installation, usage, API, configuration
- [Formatting Rules](https://mdx-formatter.takazudomodular.com/docs/formatting) — How the formatter handles each construct
- [Options](https://mdx-formatter.takazudomodular.com/docs/options) — Per-rule configuration reference
- [Architecture](https://mdx-formatter.takazudomodular.com/docs/architecture) — Hybrid formatter approach, Rust rewrite strategy
- [Changelog](https://mdx-formatter.takazudomodular.com/docs/changelog) — Release history

## Architecture

The formatting engine is written in Rust using [markdown-rs](https://github.com/wooorm/markdown-rs) and [napi-rs](https://napi.rs/). The npm package loads the native Rust module at runtime. A standalone CLI binary and WASM build for browsers are also available. See [Architecture](https://mdx-formatter.takazudomodular.com/docs/architecture) for details.

## Development

```bash
pnpm install        # Install dependencies
pnpm build          # Compile TypeScript
pnpm test           # Run tests (207 tests)
pnpm test:watch     # Watch mode
pnpm test:coverage  # Coverage report
pnpm lint           # ESLint check
pnpm check          # Prettier + ESLint check
```

### Doc Site

```bash
pnpm --dir doc dev           # Dev server on port 3518
pnpm --dir doc dev:network   # Network accessible (0.0.0.0:3518)
pnpm --dir doc build         # Production build
```

## License

MIT
