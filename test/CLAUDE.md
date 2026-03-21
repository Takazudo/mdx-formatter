# test/ — Test Suite

## Framework

Tests use vitest with `globals: true` (no need to import `describe`/`it`/`expect`).

## Test Helpers

`test-helpers.ts` exports `testSettings` — a `DeepPartial<FormatterSettings>` with component names that tests were written against. The library ships with empty component arrays by default, so **always pass `{ settings: testSettings }` when testing component-specific behavior** (e.g., block JSX, container indentation, ignore components).

## Test Files

- `formatter.test.ts` — Core formatting: headings, paragraphs, spacing, frontmatter, lists, MDX/JSX
- `html-blocks.test.ts` — HTML block formatting within MDX
- `mdx-formatter.test.ts` — MdxFormatter internals (AST operations, JSX handling)
- `url-autolink.test.ts` — URL autolink handling
- `idempotency.test.ts` — Single-pass stability tests
- `load-config.test.ts` — Config file loading and merging
- `rust-formatter.test.ts` — Rust napi formatter tests (skips if native module unavailable)
- `rust-passthrough.test.ts` — TS vs Rust behavior comparison (85 passthrough tests)

## Patterns

- Test files are named `{feature}.test.ts`
- Tests use inline markdown strings with the `format()` API
- Typical pattern: `expect(await format(input, { settings: testSettings })).toBe(expected)`
