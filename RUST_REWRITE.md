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

- [ ] Markdown parsing via markdown-rs (CommonMark + GFM + MDX + frontmatter)
- [ ] Spacing rule (empty lines between elements)
- [ ] List indentation normalization
- [ ] Convergence loop
- [ ] napi-rs bindings (format function)

### Not Yet Implemented

- [ ] YAML frontmatter formatting
- [ ] JSX multi-line formatting
- [ ] HTML block formatting (Prettier equivalent)
- [ ] Japanese text handling
- [ ] Block JSX empty lines
- [ ] Admonition preservation
- [ ] Config file loading
- [ ] CLI binary

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
