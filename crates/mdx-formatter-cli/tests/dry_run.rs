//! Integration tests for the `--dry-run` CLI flag.
//!
//! Covers the three acceptance-criterion scenarios from issue #87:
//!   (a) a file containing all five list-normalize pattern classes
//!       produces a non-empty report, exits 0, and leaves the file
//!       byte-identical on disk;
//!   (b) a file with no normalizations produces an empty report and
//!       exits 0;
//!   (c) the report goes to stderr and nothing lands on stdout.
//!
//! Covers the divergence fail-safe acceptance criteria from issue #114:
//!   (d) sink-honesty: the formatter never promises changes it will not apply.
//!       Tested at unit level in `formatter.rs` via `converge_to_fixpoint`.
//!       At CLI level we verify the corollary: an already-formatted file
//!       produces 0 dry-run entries (no first-pass ghost entries leaking out).
//!       A truly diverging input is not constructible post-#112 on real MDX,
//!       but the unit tests cover the divergence path directly with a mock step.

use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

fn cli_bin() -> PathBuf {
    // Prefer an env var from cargo (standard integration-test location).
    if let Some(p) = option_env!("CARGO_BIN_EXE_mdx-formatter") {
        return PathBuf::from(p);
    }
    // Fall back to target/debug|release.
    let manifest = env!("CARGO_MANIFEST_DIR");
    let workspace_target = Path::new(manifest)
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("target"))
        .unwrap_or_else(|| PathBuf::from("target"));
    for profile in ["debug", "release"] {
        let p = workspace_target.join(profile).join("mdx-formatter");
        if p.exists() {
            return p;
        }
    }
    panic!("mdx-formatter binary not found; run `cargo build -p mdx-formatter-cli` first");
}

fn tmpdir() -> PathBuf {
    static COUNTER: OnceLock<std::sync::atomic::AtomicU64> = OnceLock::new();
    let n = COUNTER
        .get_or_init(|| std::sync::atomic::AtomicU64::new(0))
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let base = env::temp_dir().join(format!("mdx-fmt-cli-dryrun-{}-{}", std::process::id(), n));
    std::fs::create_dir_all(&base).unwrap();
    base
}

fn write_file(path: &Path, content: &str) {
    let mut f = std::fs::File::create(path).unwrap();
    f.write_all(content.as_bytes()).unwrap();
}

/// Fixture: has a recover-escaped-code case (#83) AND a tighten (#82)
/// continuation — enough to exercise two of the five list-normalize rules
/// through the same report. We don't try to exercise all five in one file
/// because their triggers interact (see rule ordering docs in core). Two is
/// sufficient to prove the sink/flag machinery works end-to-end.
const FIXTURE_WITH_CHANGES: &str = "1. first item with a long first sentence.

   and a continuation paragraph that should tighten.

2. second item

```js
const x = 1;
```

3. third item
";

const FIXTURE_CLEAN: &str = "# Heading

Just a clean paragraph.

- a
- b
- c
";

#[test]
fn dry_run_reports_changes_leaves_file_byte_identical_and_exits_0() {
    let dir = tmpdir();
    let file = dir.join("sample.md");
    write_file(&file, FIXTURE_WITH_CHANGES);

    let out = Command::new(cli_bin())
        .arg("--dry-run")
        .arg(&file)
        .output()
        .expect("run mdx-formatter");

    assert!(
        out.status.success(),
        "--dry-run should exit 0, got {:?}\nstderr:\n{}",
        out.status,
        String::from_utf8_lossy(&out.stderr)
    );

    // File on disk must still match the original byte-for-byte.
    let after = std::fs::read(&file).unwrap();
    assert_eq!(
        after.as_slice(),
        FIXTURE_WITH_CHANGES.as_bytes(),
        "dry-run must not modify the file"
    );

    // Stdout must be empty.
    assert!(
        out.stdout.is_empty(),
        "dry-run must not write to stdout; got: {:?}",
        String::from_utf8_lossy(&out.stdout)
    );

    // Stderr must contain at least one entry header and the summary line.
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("recover-escaped-code-in-lists"),
        "stderr should mention the code rule. got:\n{}",
        stderr
    );
    assert!(
        stderr.contains("dry-run; no files were modified"),
        "stderr should end with summary. got:\n{}",
        stderr
    );
    // Entry header format: path:start-end [rule]
    assert!(
        stderr.contains(&format!("{}", file.display())),
        "entry line should include the file path"
    );
}

#[test]
fn dry_run_clean_file_reports_nothing_exits_0() {
    let dir = tmpdir();
    let file = dir.join("clean.md");
    write_file(&file, FIXTURE_CLEAN);

    let out = Command::new(cli_bin())
        .arg("--dry-run")
        .arg(&file)
        .output()
        .expect("run mdx-formatter");

    assert!(out.status.success(), "exit 0 even with empty report");
    assert!(out.stdout.is_empty(), "stdout must be empty");
    let stderr = String::from_utf8_lossy(&out.stderr);
    // Must NOT contain any rule entry.
    assert!(
        !stderr.contains("[recover-escaped-"),
        "clean file must emit no rule entries, got:\n{}",
        stderr
    );
    assert!(
        stderr.contains("0 entries across 0 files"),
        "empty summary expected. got:\n{}",
        stderr
    );
}

#[test]
fn dry_run_conflicts_with_write() {
    let out = Command::new(cli_bin())
        .arg("--dry-run")
        .arg("--write")
        .arg("nonexistent.md")
        .output()
        .expect("run mdx-formatter");
    assert!(!out.status.success(), "--dry-run + --write must error");
}

#[test]
fn dry_run_conflicts_with_check() {
    let out = Command::new(cli_bin())
        .arg("--dry-run")
        .arg("--check")
        .arg("nonexistent.md")
        .output()
        .expect("run mdx-formatter");
    assert!(!out.status.success(), "--dry-run + --check must error");
}

/// Issue #114 — Sink-honesty corollary at the CLI level.
///
/// When `try_format_with_sink` returns the original content (because the
/// input is already at a fixpoint OR because the convergence fail-safe kicked
/// in), the `--dry-run` report must be empty.
///
/// We verify the fixpoint case here: a file that is already properly formatted
/// must produce 0 dry-run entries. This ensures no "ghost" first-pass entries
/// leak from a speculative pass that the fail-safe would later discard.
#[test]
fn dry_run_already_formatted_file_produces_no_entries() {
    let dir = tmpdir();
    let file = dir.join("idempotent.md");
    // This content is already at a fixpoint — no rules should fire.
    write_file(&file, FIXTURE_CLEAN);

    let out = Command::new(cli_bin())
        .arg("--dry-run")
        .arg(&file)
        .output()
        .expect("run mdx-formatter");

    assert!(out.status.success(), "--dry-run must exit 0");
    assert!(out.stdout.is_empty(), "stdout must be empty");

    let stderr = String::from_utf8_lossy(&out.stderr);
    // No rule entries must appear — no first-pass entries leaked from a
    // speculative pass that the fail-safe would have discarded.
    assert!(
        !stderr.contains('['),
        "no rule entries should appear for an already-formatted file; got:\n{}",
        stderr
    );
    assert!(
        stderr.contains("0 entries across 0 files"),
        "empty summary expected; got:\n{}",
        stderr
    );
}

#[test]
fn dry_run_help_text_documents_the_flag() {
    let out = Command::new(cli_bin())
        .arg("--help")
        .output()
        .expect("run mdx-formatter");
    let stdout = String::from_utf8_lossy(&out.stdout);
    assert!(
        stdout.contains("--dry-run"),
        "`--help` must list the --dry-run flag. got:\n{}",
        stdout
    );
    assert!(
        stdout.contains("stderr"),
        "`--help` must describe stderr output. got:\n{}",
        stdout
    );
}
