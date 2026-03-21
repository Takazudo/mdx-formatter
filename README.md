# @takazudo/mdx-formatter

AST-based markdown and MDX formatter with Japanese text support. Uses remark for AST parsing, then applies targeted line-based operations to the original source text.

## Features

- **Hybrid formatter** — Parses via remark AST, applies edits to original source lines (no lossy round-trip)
- **MDX support** — Full support for MDX syntax including JSX components, imports, exports
- **Japanese text handling** — Preserves Japanese punctuation and text formatting
- **Docusaurus admonitions** — Preserves `:::note`, `:::tip`, `:::warning` etc. syntax
- **HTML block formatting** — Proper indentation for HTML blocks (dl, table, ul, div, etc.) via Prettier
- **GFM features** — Tables, strikethrough, task lists
- **YAML frontmatter** — Formatting with safe value pre-processing
- **CLI and API** — Use as command-line tool or import as library
- **Browser export** — `@takazudo/mdx-formatter/browser` for Vite/WebView/Tauri builds
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

### Browser / WebView

```javascript
import { format } from '@takazudo/mdx-formatter/browser';

const formatted = await format('# Hello\nWorld');
```

The browser export avoids Node.js `fs`/`path` dependencies. See [Browser Usage](https://takazudomodular.com/pj/mdx-formatter/docs/overview/browser-usage) for details.

## Documentation

Full documentation at **[takazudomodular.com/pj/mdx-formatter](https://takazudomodular.com/pj/mdx-formatter/)**:

- [Overview](https://takazudomodular.com/pj/mdx-formatter/docs/overview) — Installation, usage, API, configuration
- [Formatting Rules](https://takazudomodular.com/pj/mdx-formatter/docs/formatting) — How the formatter handles each construct
- [Options](https://takazudomodular.com/pj/mdx-formatter/docs/options) — Per-rule configuration reference
- [Architecture](https://takazudomodular.com/pj/mdx-formatter/docs/architecture) — Hybrid formatter approach, Rust rewrite strategy
- [Changelog](https://takazudomodular.com/pj/mdx-formatter/docs/changelog) — Release history

## Rust Implementation

A production-ready Rust implementation using [markdown-rs](https://github.com/wooorm/markdown-rs) and [napi-rs](https://napi.rs/) is available at `crates/`. It provides 3-7x performance improvement over TypeScript, with full feature parity (342 Rust tests + 85 passthrough tests). Includes a standalone CLI binary and WASM support for browsers. See [Architecture: Rust Rewrite](https://takazudomodular.com/pj/mdx-formatter/docs/architecture/rust-rewrite) for details.

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
