# crates/ — Rust Rewrite

Rust implementation of mdx-formatter using markdown-rs and napi-rs. All formatting rules are implemented and tested.

## Workspace Structure

- `mdx-formatter-core/` — Pure Rust library: parser, formatter, config, types
- `mdx-formatter-cli/` — Standalone CLI binary (clap-based)
- `mdx-formatter-napi/` — napi-rs bindings for Node.js

## Building and Testing

```bash
. "$HOME/.cargo/env"     # Source Rust environment
cargo build              # Build all crates
cargo test               # Run all Rust tests (342 tests)
cargo build -p mdx-formatter-napi  # Build just the napi module
```

## Architecture

Uses the same hybrid approach as the TypeScript implementation:

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

## Current Status

All formatting rules implemented and tested:

- Spacing rule (empty lines after headings/JSX) — working at all AST depths
- JSX multi-line formatting — working (attribute indentation, self-closing fix, block JSX empty lines)
- YAML frontmatter formatting — working (parse, reformat, unsafe value quoting)
- List indentation normalization — working
- HTML block formatting — working (minimal indentation formatter replacing Prettier)
- Full settings deserialization — all 10 fields via serde with camelCase JSON
- Config file loading — working (3-layer merge, `.mdx-formatter.json` + `package.json`, exclude patterns)
- CLI binary — working (`mdx-formatter-cli` crate with `--write`, `--check`, `--config`, glob patterns)
- Auto-detect bridge — working (TS `format()` auto-prefers Rust napi when available)
- 342 tests passing (124 unit + 165 cross-platform + 42 plugin validation + 11 spacing recursion)
- napi-rs CI pipeline — in progress (cross-platform binary generation)
- TS plugin validation complete — 9 of 10 plugins NOT needed in Rust (see formatter.rs header)

## Known Limitations

- napi-rs CI build pipeline — in progress (cross-platform binary generation)
- Browser/WASM support — not yet implemented
