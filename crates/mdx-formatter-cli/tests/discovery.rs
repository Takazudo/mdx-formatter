use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};

fn cli_bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_mdx-formatter"))
}

fn tmpdir() -> PathBuf {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let path = env::temp_dir().join(format!(
        "mdx-formatter-discovery-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn write(root: &Path, relative: &str, content: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn run(root: &Path, args: &[&str]) -> Output {
    Command::new(cli_bin())
        .current_dir(root)
        .args(args)
        .output()
        .unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

#[test]
fn nested_gitignore_hides_generated_mdx_issue_140() {
    let root = tmpdir();
    write(&root, "docs/.gitignore", "generated/\n");
    write(&root, "docs/generated/page.mdx", "# hidden\n");

    let output = run(&root, &["--check", "**/*.mdx"]);
    assert!(output.status.success());
    assert_eq!(
        stdout(&output),
        "All matching files were excluded by ignore/exclude patterns — 0 files to process.\n"
    );

    let output = run(&root, &["--check", "--no-gitignore", "**/*.mdx"]);
    assert!(stdout(&output).contains("Processing 1 file(s)..."));
}

#[test]
fn explicit_dot_path_bypasses_config_exclude_issue_123_cases_1_and_2() {
    let root = tmpdir();
    write(&root, ".claude/skills/example/SKILL.md", "# test\n");
    write(
        &root,
        ".mdx-formatter.json",
        r#"{"exclude":[".claude/**"]}"#,
    );

    let output = run(&root, &["--check", ".claude/skills/example/SKILL.md"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stdout(&output).contains("Processing 1 file(s)..."));

    write(&root, ".mdx-formatter.json", r#"{"exclude":[]}"#);
    let output = run(&root, &["--check", ".claude/skills/example/SKILL.md"]);
    assert!(stdout(&output).contains("Processing 1 file(s)..."));
}

#[test]
fn explicit_plain_path_bypasses_config_exclude_issue_123_case_3() {
    let root = tmpdir();
    write(&root, "tests/foo.md", "# test\n");
    write(&root, ".mdx-formatter.json", r#"{"exclude":["tests/**"]}"#);

    let output = run(&root, &["--check", "tests/foo.md"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stdout(&output).contains("Processing 1 file(s)..."));
}

#[test]
fn glob_matches_still_honor_config_exclude() {
    let root = tmpdir();
    write(&root, "tests/foo.md", "# test\n");
    write(&root, ".mdx-formatter.json", r#"{"exclude":["tests/**"]}"#);

    let output = run(&root, &["--check", "**/*.md"]);
    assert_eq!(
        stdout(&output),
        "All matching files were excluded by ignore/exclude patterns — 0 files to process.\n"
    );
}

#[test]
fn nested_gitignore_deeper_rule_wins_and_negation_reincludes_child() {
    let root = tmpdir();
    write(&root, ".gitignore", "docs/generated/*\n");
    write(&root, "docs/.gitignore", "!generated/keep.md\n");
    write(&root, "docs/generated/drop.md", "# drop\n");
    write(&root, "docs/generated/keep.md", "# keep\n");

    let output = run(&root, &["--check", "**/*.md"]);
    let out = stdout(&output);
    assert!(out.contains("Processing 1 file(s)..."), "{out}");
    assert!(out.contains("docs/generated/keep.md"), "{out}");
    assert!(!out.contains("docs/generated/drop.md"), "{out}");
}

#[test]
fn gitignore_negation_uses_file_pattern_not_ignored_directory() {
    let root = tmpdir();
    write(&root, ".gitignore", "generated/*\n!generated/keep.md\n");
    write(&root, "generated/drop.md", "# drop\n");
    write(&root, "generated/keep.md", "# keep\n");

    let output = run(&root, &["--check", "**/*.md"]);
    let out = stdout(&output);
    assert!(out.contains("generated/keep.md"), "{out}");
    assert!(!out.contains("generated/drop.md"), "{out}");
}

#[test]
fn gitignore_above_cwd_is_not_consulted() {
    let parent = tmpdir();
    write(&parent, ".gitignore", "child/hidden.md\n");
    write(&parent, "child/hidden.md", "# visible\n");

    let output = run(&parent.join("child"), &["--check", "*.md"]);
    assert!(stdout(&output).contains("Processing 1 file(s)..."));
}

#[test]
fn explicit_paths_bypass_gitignore_but_not_cli_ignore() {
    let root = tmpdir();
    write(&root, ".gitignore", "generated.md\n");
    write(&root, "generated.md", "# generated\n");

    let output = run(&root, &["--check", "generated.md"]);
    assert!(stdout(&output).contains("Processing 1 file(s)..."));

    let output = run(
        &root,
        &["--check", "--ignore", "generated.md", "generated.md"],
    );
    assert_eq!(
        stdout(&output),
        "All matching files were excluded by ignore/exclude patterns — 0 files to process.\n"
    );
}

#[test]
fn ignore_path_is_repeatable_later_rules_win_and_applies_to_explicit() {
    let root = tmpdir();
    write(&root, "first.ignore", "area/docs/*.md\n");
    write(&root, "area/second.ignore", "!docs/keep.md\n");
    write(&root, "area/docs/drop.md", "# drop\n");
    write(&root, "area/docs/keep.md", "# keep\n");

    let output = run(
        &root,
        &[
            "--check",
            "--ignore-path",
            "first.ignore",
            "--ignore-path",
            "area/second.ignore",
            "area/docs/drop.md",
            "area/docs/keep.md",
        ],
    );
    let out = stdout(&output);
    assert!(out.contains("Processing 1 file(s)..."), "{out}");
    assert!(out.contains("area/docs/keep.md"), "{out}");
}

#[test]
fn missing_ignore_path_is_a_hard_error() {
    let root = tmpdir();
    let output = run(
        &root,
        &["--check", "--ignore-path", "missing.ignore", "**/*.md"],
    );
    assert!(!output.status.success());
    assert!(stderr(&output).contains("missing.ignore"));
}

#[test]
fn reports_all_bad_operands_and_preserves_original_spelling() {
    let root = tmpdir();
    fs::create_dir(root.join("docs")).unwrap();
    let output = run(&root, &["--check", "docs", "missing.md"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(
        stderr(&output),
        "docs: is a directory (pass a glob such as 'docs/**/*.md' to format its contents)\nmissing.md: no such file\n"
    );
}

#[test]
fn braces_are_literal_and_magic_patterns_with_no_matches_exit_zero() {
    let root = tmpdir();
    let braces = run(&root, &["--check", "a{b,c}.md"]);
    assert_eq!(braces.status.code(), Some(1));
    assert_eq!(stderr(&braces), "a{b,c}.md: no such file\n");

    let magic = run(&root, &["--check", "missing/*.md"]);
    assert!(magic.status.success());
    assert_eq!(stdout(&magic), "No files found matching the patterns.\n");
}

#[test]
fn stat_precedes_magic_for_real_names_containing_glob_characters() {
    let root = tmpdir();
    write(&root, "real[1].md", "# real\n");
    fs::create_dir(root.join("dir*name")).unwrap();

    let file = run(&root, &["--check", "real[1].md"]);
    assert!(stdout(&file).contains("real[1].md"));

    let directory = run(&root, &["--check", "dir*name"]);
    assert_eq!(directory.status.code(), Some(1));
    assert_eq!(
        stderr(&directory),
        "dir*name: is a directory (pass a glob such as 'dir*name/**/*.md' to format its contents)\n"
    );
}

#[test]
fn windows_separators_are_accepted_and_explicit_spelling_is_preserved() {
    let root = tmpdir();
    write(&root, "docs/file.md", "# test\n");
    let output = run(&root, &["--check", "docs\\file.md"]);
    let out = stdout(&output);
    assert!(out.contains("docs\\file.md"), "{out}");
}

#[test]
fn explicit_semantics_win_when_glob_also_matches() {
    let root = tmpdir();
    write(&root, ".gitignore", "docs/file.md\n");
    write(&root, "docs/file.md", "# test\n");
    let output = run(&root, &["--check", "**/*.md", "docs/file.md"]);
    let out = stdout(&output);
    assert!(out.contains("Processing 1 file(s)..."), "{out}");
    assert_eq!(out.matches("docs/file.md").count(), 1);
}

#[test]
fn dry_run_zero_file_messages_are_stderr_only() {
    let root = tmpdir();
    let output = run(&root, &["--dry-run", "**/*.md"]);
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(stderr(&output), "No files found matching the patterns.\n");
}

#[test]
fn dry_run_all_filtered_message_is_stderr_only() {
    let root = tmpdir();
    write(&root, "hidden.md", "# hidden\n");
    let output = run(&root, &["--dry-run", "--ignore", "hidden.md", "*.md"]);
    assert!(output.status.success());
    assert!(output.stdout.is_empty());
    assert_eq!(
        stderr(&output),
        "All matching files were excluded by ignore/exclude patterns — 0 files to process.\n"
    );
}

#[test]
fn default_patterns_are_applied_in_code_and_cover_md_and_mdx() {
    let root = tmpdir();
    write(&root, "one.md", "# one\n");
    write(&root, "nested/two.mdx", "# two\n");
    let output = run(&root, &["--check"]);
    assert!(stdout(&output).contains("Processing 2 file(s)..."));
}

#[test]
fn walk_does_not_consult_dot_ignore_or_git_info_exclude() {
    let root = tmpdir();
    write(&root, ".ignore", "visible.md\n");
    write(&root, ".git/info/exclude", "visible.md\n");
    write(&root, "visible.md", "# visible\n");
    let output = run(&root, &["--check", "*.md"]);
    assert!(stdout(&output).contains("Processing 1 file(s)..."));
}

#[test]
fn no_gitignore_does_not_disable_explicit_ignore_path() {
    let root = tmpdir();
    write(&root, "custom.ignore", "hidden.md\n");
    write(&root, "hidden.md", "# hidden\n");
    let output = run(
        &root,
        &[
            "--check",
            "--no-gitignore",
            "--ignore-path",
            "custom.ignore",
            "*.md",
        ],
    );
    assert_eq!(
        stdout(&output),
        "All matching files were excluded by ignore/exclude patterns — 0 files to process.\n"
    );
}

#[cfg(unix)]
#[test]
fn exact_file_symlink_is_followed_and_dangling_symlink_is_missing() {
    use std::os::unix::fs::symlink;

    let root = tmpdir();
    write(&root, "target.md", "# target\n");
    symlink("target.md", root.join("linked.md")).unwrap();
    symlink("absent.md", root.join("dangling.md")).unwrap();

    let linked = run(&root, &["--check", "linked.md"]);
    assert!(stdout(&linked).contains("linked.md"));

    let dangling = run(&root, &["--check", "dangling.md"]);
    assert_eq!(dangling.status.code(), Some(1));
    assert_eq!(stderr(&dangling), "dangling.md: no such file\n");
}
