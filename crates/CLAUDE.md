# crates/ — Rust Formatting Engine

The sole formatting engine for mdx-formatter. Built with markdown-rs and napi-rs.

## Workspace Structure

- `mdx-formatter-core/` — Pure Rust library: parser, formatter, config, types
- `mdx-formatter-cli/` — Standalone CLI binary (clap-based)
- `mdx-formatter-napi/` — napi-rs bindings for Node.js
- `mdx-formatter-wasm/` — WASM bindings for browser use

## Building and Testing

```bash
. "$HOME/.cargo/env"     # Source Rust environment
cargo build              # Build all crates
cargo test               # Run all Rust tests (342 tests)
cargo build -p mdx-formatter-napi  # Build just the napi module
```

## Architecture

Hybrid formatter approach:

1. Parse markdown/MDX into mdast via `markdown::to_mdast()` (with MDX, GFM, frontmatter)
2. Walk AST to collect line-based `FormatterOperation` values
3. Apply operations to original source lines (not AST round-trip)
4. Convergence loop: repeat up to 3 times until output stabilizes

Key modules in `mdx-formatter-core/src/`:

- `formatter.rs` — Hybrid formatter (convergence loop + all rules)
- `html_formatter.rs` — HTML block indentation formatter
- `config.rs` — Config file loading (3-layer merge)
- `parser.rs` — markdown-rs integration (mdast parsing)
- `types.rs` — Settings, operations, type definitions

## Status

- All formatting rules implemented and tested
- 342 tests passing (124 unit + 165 cross-platform + 42 plugin validation + 11 spacing recursion)
- CLI binary working (`--write`, `--check`, `--config`, glob patterns)
- Browser/WASM support implemented (`mdx-formatter-wasm` crate, web + bundler targets)
- napi-rs CI build pipeline — in progress (cross-platform binary generation)
