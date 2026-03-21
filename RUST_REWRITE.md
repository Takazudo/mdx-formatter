# Rust Rewrite

The Rust implementation of mdx-formatter reimplements the full formatting engine using markdown-rs for AST parsing and napi-rs for Node.js bindings. All formatting rules from the TypeScript version are implemented and tested.

## Architecture

```
Rust Core (mdx-formatter-core)
├── parser.rs          - markdown-rs integration (mdast parsing)
├── formatter.rs       - Hybrid formatter (AST analysis → line operations)
├── html_formatter.rs  - HTML block indentation formatter
└── types.rs           - Settings, operations, type definitions

napi-rs Bridge (mdx-formatter-napi)
└── lib.rs             - Node.js native bindings

TypeScript Bridge
└── src/rust-formatter.ts  - JS wrapper that loads native module
```

## How It Works

The Rust formatter uses the same hybrid approach as the TypeScript implementation:

1. Parse markdown/MDX into an mdast AST using `markdown-rs`
2. Analyze the AST to collect line-based formatting operations
3. Apply operations to the original source lines (not AST round-trip)
4. Post-process: ensure block-level spacing between elements
5. Run convergence loop (max 3 iterations) until output stabilizes

## Prerequisites

- Rust toolchain (install via rustup)
- Node.js >= 18
- pnpm

## Building

```bash
# Build the Rust formatter (debug)
pnpm build:rust

# Build release version (optimized)
pnpm build:rust:release

# Or manually:
cargo build -p mdx-formatter-napi
cp target/debug/libmdx_formatter_napi.so crates/mdx-formatter-napi/mdx-formatter-napi.node
```

## Testing

```bash
# Run Rust unit tests (315 tests)
cargo test

# Run JS tests against Rust formatter (requires build first)
pnpm test:rust              # 29 Rust-specific tests
pnpm test:rust-passthrough  # 85 tests — full TS behavior comparison
```

## Implemented Formatting Rules

All formatting rules from the TypeScript version are implemented:

- [x] Spacing rule (empty lines after headings/JSX at all AST depths)
- [x] Block-level spacing (paragraph ↔ heading, list, code block transitions)
- [x] List indentation normalization
- [x] JSX multi-line formatting (attribute indentation, standalone `/>` fix)
- [x] Block JSX empty lines (opening/closing tag spacing for configured components)
- [x] JSX content indentation (for configured container components)
- [x] YAML frontmatter formatting (parse, reformat, unsafe value quoting)
- [x] HTML block formatting (minimal indentation formatter replacing Prettier)
- [x] Full settings deserialization (all 10 fields via serde with camelCase JSON)
- [x] Convergence loop and empty line normalization

### Plugin Validation

9 of 10 TypeScript plugins are NOT needed in Rust because the hybrid approach preserves original text (no AST round-tripping):

- preserve-jsx, preserve-image-alt, fix-autolink-output, preprocess-japanese, japanese-text, fix-formatting-issues, docusaurus-admonitions, normalize-lists, html-definition-list

The remaining plugin (fix-paragraph-spacing) is covered by the block-level spacing post-processor.

## Not Yet Implemented (Infrastructure)

- [ ] Config file loading (`.mdx-formatter.json`, `package.json` key)
- [ ] CLI binary (standalone Rust CLI)
- [ ] napi-rs CI build pipeline (cross-platform binaries)
- [ ] Browser/WASM support

## npm Distribution Plan

For production distribution, napi-rs publishes platform-specific binaries as optional dependencies:

```
@takazudo/mdx-formatter                  ← main package
@takazudo/mdx-formatter-darwin-arm64     ← macOS Apple Silicon
@takazudo/mdx-formatter-darwin-x64       ← macOS Intel
@takazudo/mdx-formatter-linux-x64-gnu   ← Linux
@takazudo/mdx-formatter-win32-x64-msvc  ← Windows
```

This is the same approach used by SWC, Biome, and Lightning CSS.
