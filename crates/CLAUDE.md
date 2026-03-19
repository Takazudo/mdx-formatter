# crates/ — Rust Rewrite (Proof of Concept)

Experimental Rust implementation of mdx-formatter using markdown-rs and napi-rs.

## Workspace Structure

- `mdx-formatter-core/` — Pure Rust library: parser, formatter, types
- `mdx-formatter-napi/` — napi-rs bindings for Node.js

## Building and Testing

```bash
. "$HOME/.cargo/env"     # Source Rust environment
cargo build              # Build all crates
cargo test               # Run all Rust tests (162 tests)
cargo build -p mdx-formatter-napi  # Build just the napi module
```

## Architecture

Uses the same hybrid approach as the TypeScript implementation:

1. Parse markdown/MDX into mdast via `markdown::to_mdast()` (with MDX, GFM, frontmatter)
2. Walk AST to collect line-based `FormatterOperation` values
3. Apply operations to original source lines (not AST round-trip)
4. Convergence loop: repeat up to 3 times until output stabilizes

## Current Status

- Spacing rule (empty lines after headings) — working
- List indentation normalization — working
- 162 tests passing (18 unit + 144 cross-platform)
- napi-rs scaffold ready (needs `@napi-rs/cli` to build `.node`)

## Known Limitations

- Spacing only at root level (no recursion into blockquotes, JSX)
- Partial settings deserialization (5 of 10 fields)
- JSX formatting, YAML formatting, HTML blocks, Japanese text not yet implemented
