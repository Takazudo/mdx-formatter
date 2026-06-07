# Changelog

All notable changes to `@takazudo/mdx-formatter` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dated release entries mirror the per-version pages under
`doc/src/content/docs/changelog/`.

## [Unreleased]

### Changed

- **`tighten-list-continuations` heuristic: key:value paragraphs are now preserved** (issue #107) — this is a behavior change for all `"heuristic"` mode users. Any continuation paragraph whose first line matches the shape `identifier: value` (a word-character identifier followed by a colon, required whitespace, and a non-empty value) is no longer collapsed, even when it starts with a lowercase letter that would otherwise trigger the continuation signal. Example: a `priority: urgent` metadata paragraph following a task-list item now keeps its blank-line separator. Prose lines that share this shape — such as `Note: see below` — are preserved as a deliberate tradeoff. Bare `key:` (empty value) and URLs (`https://...`) do not match and continue to collapse. `"aggressive"` mode behavior is unchanged.

### Fixed

- **JSX self-closing corruption with template-literal props** (issue #109) — a self-closing MDX component whose attributes include a multi-line template-literal prop containing inner braces (e.g. `html={\`...<code>{x}</code>...\`}`) was corrupted on `--write`: the `/>` was replaced with `>`, the prop block was duplicated, and a stray closing tag was appended. Root cause: the line-based `/>` / `>{` scanner inside `format_jsx_element` matched brace characters inside the template-literal string, mis-classifying the element as paired. Fixed by reading self-closing status directly from the AST node's source span rather than substring-scanning the reconstructed text. (No option semantics changed.)
- **Convergence divergence fail-safe** (issue #114) — when `run_convergence_loop` exhausted its iteration cap without reaching a fixpoint, it previously emitted the last (still-changing) iteration's output, which could corrupt files or cause `--check` and `--write` to disagree. The loop now returns the original input unchanged when it does not converge, so a formatter pass can never make a file worse than leaving it unformatted.

## [1.2.1] — 2026-04-23

### Fixed

- **List-item continuation blank injection** (upstream issue #66) — blank lines
  were injected between a list-item marker line and its continuation paragraph
  when a paragraph wrapped in the middle of a list item. Regression tests:
  `test/fixtures/regression-list-continuation-blank.md` (unordered) and
  `regression-list-continuation-blank-ordered.md` (ordered).
- **Fenced code block interior blank injection** (upstream issue #68) — blank
  lines were injected immediately inside the opening fence and immediately
  before the closing fence, including tilde fences (`~~~`) and nested
  4-backtick fences wrapping a triple-backtick block. Regression tests:
  `test/fixtures/regression-fenced-code-interior-blank.md`,
  `regression-fenced-code-tilde.md`,
  `regression-fenced-code-nested-4backtick.md`.
- Both bugs reproduced **with every rule disabled** — they lived in
  unconditional post-processing passes, not any user-configurable rule. The
  new regression suite pins a tight invariant: _"all rules off ⇒ byte-identical
  output for these repros."_

### Release-notes addendum — stale napi binary in v1.2.0

The underlying Rust fix shipped in the core engine back at commit `54f61a4`,
well before v1.2.0 was tagged. However, the prebuilt napi binary published to
npm as `@takazudo/mdx-formatter` v1.2.0 (and its `@takazudo/mdx-formatter-*`
platform sub-packages at `1.0.0`) was built from a checkout that predated that
commit. Consumers who upgraded to v1.2.0 therefore still observed both bugs
at runtime, even though `crates/` in the repo was already fixed.

**v1.2.1 republishes the napi binary** alongside the version bump so
downstream consumers actually pick up the fix. If you are a contributor
running tests against a local checkout, `pnpm build:rust` rebuilds the
napi `.node` artifact from the current source and is preferred over the
published platform package (see `src/rust-formatter.ts` loader order).

## [1.2.0] — 2026-04-23

### Added — List Normalize rule bundle (epic #80)

Five rules that clean up AI-authored list-item content. Exposed as flat
top-level kebab-case keys in the public config (not nested under a parent
object) so each rule can be opted in/out independently:

- **`tighten-list-continuations`** (`"off"` / `"heuristic"` (default) /
  `"aggressive"`) — Collapse the blank line between two paragraph children
  of a list item when heuristics show the second is a continuation of the
  first sentence (lowercase / backtick / opening-punctuation start).
  (sub-issue #82)
- **`tighten-list-item-spacing`** (`"off"` / `"heuristic"` (default) /
  `"aggressive"`) — Collapse a single blank line between adjacent sibling
  list items. `"heuristic"` fires only when every item in the list is
  `ParagraphsOnly`; `"aggressive"` drops that shape gate. Double-blank
  separators are preserved. (issue #90)
- **`recover-escaped-code-in-lists`** (`"off"` / `"safe"` (default) /
  `"aggressive"`) — Re-indent a fenced code block that escaped to column 0
  between two list items so CommonMark parses it as a child of the
  preceding item. `"safe"` fires only on numbered-list-restart signals;
  `"aggressive"` also recovers bullet-list escapes. (sub-issue #83)
- **`recover-escaped-tables-in-lists`** (`"off"` / `"safe"` (default) /
  `"aggressive"`) — Re-indent a GFM table that escaped to column 0 between
  two list items. Alignment colons in the separator row are preserved
  byte-for-byte. (sub-issue #84)
- **`recover-escaped-paragraphs-in-lists`** (`"off"` (default) /
  `"heuristic"` / `"aggressive"`) — Re-indent a paragraph that escaped to
  column 0 between two list items. Defaults to off because the heuristic
  has the highest false-positive risk of the five rules. (sub-issue #85)

All five rules apply recursively to nested sublists (sub-issue #86) and
share a common detection pass with oscillation guarding (sub-issue #81).

### Added — `--dry-run` CLI + `dryRunReport()` API (sub-issue #87)

- CLI `--dry-run` flag on both the TS CLI (`mdx-formatter`) and the
  standalone Rust CLI. Writes a per-rule change report to stderr
  (`<path>:<start>-<end> [<rule>]` with indented before/after snippets
  capped at 3 lines each). Leaves files byte-identical on disk, always
  exits 0, and conflicts with `--write` / `--check`.
- New `dryRunReport(content, options?)` library export, returning the
  same entries as a typed `DryRunReportEntry[]`.
- New Rust core `ReportSink` trait (`NullSink`, `VecSink`) and
  `format_with_sink` / `try_format_with_sink` entry points for consumers
  that want to capture rule activity programmatically.

### Added — Regression safety net (sub-issue #88)

- `test/fixtures/` — real-content input fixtures for each of the five
  rules, paired with an `.expected.md` baseline consumed by the
  integration tests in `test/formatter.test.ts`.
- `test/fixtures/baseline-loose-list-preserved.md` — the "formatter is
  innocent" assertion: loose-shape snippet from `local-llm-search-spike.mdx`
  round-trips byte-identically when all five list-normalize rules are
  `"off"`. Documents the pre-rule finding from the epic investigation.
- `test/snapshots/` — per-fixture default-settings output baselines.
  `test/snapshots.test.ts` re-runs the formatter and asserts
  byte-equality on every fixture + verifies a second pass is idempotent.
  Regenerate with `npx tsx scripts/gen-fixture-outputs.ts` when a rule
  change is intentional.

### Fixed — napi / wasm settings path dropped list-normalize keys

`crates/mdx-formatter-napi` and `crates/mdx-formatter-wasm` called
`FormatterSettings::from_partial_json` directly, which silently dropped
the five list-normalize top-level kebab-case keys because
`FormatterSettings::list_normalize` is `#[serde(skip)]`. They now route
through a new `from_public_json()` helper in core that lifts those keys
into `settings.list_normalize` before deserializing the rest. Discovered
while wiring the #88 baseline test.
