# Changelog

All notable changes to `@takazudo/mdx-formatter` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Dated release entries mirror the per-version pages under
`doc/src/content/docs/changelog/`.

## [Unreleased]

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
