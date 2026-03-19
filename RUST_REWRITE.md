# Rust Rewrite - Proof of Concept

This document describes the experimental Rust rewrite of mdx-formatter using markdown-rs for AST parsing and napi-rs for Node.js bindings.

## Architecture

```
Rust Core (mdx-formatter-core)
├── parser.rs     - markdown-rs integration (mdast parsing)
├── formatter.rs  - Hybrid formatter (AST analysis → line operations)
└── types.rs      - Settings, operations, type definitions

napi-rs Bridge (mdx-formatter-napi)
└── lib.rs        - Node.js native bindings

TypeScript Bridge
└── src/rust-formatter.ts  - JS wrapper that loads native module
```

## How It Works

The Rust formatter uses the same hybrid approach as the TypeScript implementation:

1. Parse markdown/MDX into an mdast AST using `markdown-rs`
2. Analyze the AST to collect line-based formatting operations
3. Apply operations to the original source lines (not AST round-trip)
4. Run convergence loop (max 3 iterations) until output stabilizes

## Prerequisites

- Rust toolchain (install via rustup)
- Node.js >= 18
- pnpm

## Building

```bash
# Build the Rust formatter
cargo build

# Build release version (optimized)
cargo build --release

# Build just the napi module
cargo build -p mdx-formatter-napi
```

## Testing

```bash
# Run Rust unit tests
cargo test

# Run JS tests against Rust formatter (requires build first)
pnpm test:rust
```

## Current Status

This is a proof of concept. Current capabilities:

### Working

- [x] Markdown parsing via markdown-rs (CommonMark + GFM + MDX + frontmatter)
- [x] Spacing rule (empty lines between root-level elements; nested elements not yet handled)
- [x] List indentation normalization
- [x] Convergence loop
- [x] napi-rs bindings (format function — scaffold only, needs @napi-rs/cli to build .node)

### Not Yet Implemented

- [ ] YAML frontmatter formatting
- [ ] JSX multi-line formatting
- [ ] HTML block formatting (Prettier equivalent)
- [ ] Japanese text handling
- [ ] Block JSX empty lines
- [ ] Admonition preservation
- [ ] Config file loading
- [ ] CLI binary

## Known Limitations (POC)

- **Spacing only at root level**: `collect_spacing_operations` only handles direct children of Root, unlike the TS implementation's `unist-util-visit` which recurses into all depths (blockquotes, JSX containers, etc.)
- **Partial settings deserialization**: `from_partial_json` only handles 5 of 10 settings fields; the rest are silently ignored. Should migrate to serde derive with `#[serde(default)]`
- **No content in dedup key**: Two different `InsertLine` operations targeting the same line would collide. The TS implementation doesn't have this issue because it uses more specific keys
- **Unused description fields**: Each settings struct carries a `description: String` that's never consumed at runtime — inherited from the TS structure but adds unnecessary heap allocation in Rust

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
