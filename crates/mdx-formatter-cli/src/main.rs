use clap::Parser;
use colored::Colorize;
use glob::glob;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use ignore::WalkBuilder;
use mdx_formatter_core::{
    load_full_config, try_format, try_format_with_sink, FullConfig, ReportEntry, VecSink,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::process;

/// AST-based markdown and MDX formatter
#[derive(Parser)]
#[command(name = "mdx-formatter", version, about)]
struct Cli {
    /// Glob patterns for files to format
    patterns: Vec<String>,

    /// Write formatted files in place
    #[arg(short, long)]
    write: bool,

    /// Check if files need formatting (exit 1 if any need formatting)
    #[arg(short, long, conflicts_with = "write")]
    check: bool,

    /// Preview every change on stderr without touching files or stdout.
    ///
    /// Each entry is: `<path>:<start>-<end> [<rule>]`, followed by indented
    /// `- <before>` / `+ <after>` lines (≤3 each, truncated with `…`).
    /// Exits 0 whether or not there was anything to report.
    #[arg(long, conflicts_with_all = ["write", "check"])]
    dry_run: bool,

    /// Path to config file (.mdx-formatter.json)
    #[arg(long)]
    config: Option<String>,

    /// Comma-separated patterns to ignore
    #[arg(
        long,
        default_value = "node_modules/**,dist/**,build/**,.git/**,worktrees/**"
    )]
    ignore: String,

    /// Read additional ignore rules from a file (repeatable)
    #[arg(long = "ignore-path", value_name = "FILE")]
    ignore_paths: Vec<String>,

    /// Do not automatically load .gitignore files
    #[arg(long)]
    no_gitignore: bool,
}

#[derive(Debug)]
struct DiscoveredFile {
    path: PathBuf,
    display: String,
}

#[derive(Default)]
struct DiscoveryResult {
    files: Vec<DiscoveredFile>,
    had_matches: bool,
    had_filtered_matches: bool,
}

/// Normalize separators for matching. The original operand is retained for diagnostics.
fn normalize_operand(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    normalized
        .strip_prefix("./")
        .unwrap_or(&normalized)
        .to_string()
}

fn lexical_absolute(cwd: &Path, path: &Path) -> PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    let mut normalized = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    normalized
}

fn matching_path(path: &Path, cwd: &Path) -> String {
    let relative = path.strip_prefix(cwd).unwrap_or(path);
    relative.to_string_lossy().replace('\\', "/")
}

fn pattern_is_within_cwd(pattern: &str, cwd: &Path) -> bool {
    let path = Path::new(pattern);
    if path.is_absolute() {
        let cwd = cwd.to_string_lossy().replace('\\', "/");
        return pattern == cwd || pattern.starts_with(&format!("{cwd}/"));
    }
    !path
        .components()
        .any(|component| component == Component::ParentDir)
}

/// Rust's glob crate deliberately has no brace expansion. Consequently `{` is
/// not magic here: a missing `a{b,c}.md` is reported as a missing literal.
fn has_glob_magic(operand: &str) -> bool {
    let mut escaped = false;
    for ch in operand.chars() {
        if escaped {
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if matches!(ch, '*' | '?' | '[') {
            return true;
        }
    }
    false
}

/// Compile CLI/config patterns once, silently skipping invalid ones (legacy behavior).
fn compile_ignore_patterns(patterns: &[String]) -> Vec<glob::Pattern> {
    patterns
        .iter()
        .filter_map(|p| glob::Pattern::new(p).ok())
        .collect()
}

/// Check if a normalized path matches any compiled ignore pattern
fn is_ignored(normalized_path: &str, compiled_patterns: &[glob::Pattern]) -> bool {
    compiled_patterns
        .iter()
        .any(|pat| pat.matches(normalized_path))
}

struct GitignoreCache {
    cwd: PathBuf,
    matchers: HashMap<PathBuf, Option<Gitignore>>,
}

impl GitignoreCache {
    fn new(cwd: PathBuf) -> Self {
        Self {
            cwd,
            matchers: HashMap::new(),
        }
    }

    fn matcher(&mut self, directory: &Path) -> Option<&Gitignore> {
        self.matchers
            .entry(directory.to_path_buf())
            .or_insert_with(|| {
                let path = directory.join(".gitignore");
                if !path.is_file() {
                    return None;
                }
                let mut builder = GitignoreBuilder::new(directory);
                if builder.case_insensitive(false).is_err() {
                    return None;
                }
                let _ = builder.add(path);
                builder.build().ok()
            });
        self.matchers.get(directory).and_then(Option::as_ref)
    }

    fn is_ignored(&mut self, path: &Path) -> bool {
        let Some(parent) = path.parent() else {
            return false;
        };
        if !parent.starts_with(&self.cwd) {
            return false;
        }

        let directories: Vec<PathBuf> = parent
            .ancestors()
            .take_while(|directory| directory.starts_with(&self.cwd))
            .map(Path::to_path_buf)
            .collect();
        let mut ignored = false;
        for directory in directories.iter().rev() {
            if let Some(matcher) = self.matcher(directory) {
                let relative = path.strip_prefix(directory).unwrap_or(path);
                let matched = matcher.matched_path_or_any_parents(relative, false);
                if matched.is_ignore() {
                    ignored = true;
                } else if matched.is_whitelist() {
                    ignored = false;
                }
            }
        }
        ignored
    }
}

fn compile_ignore_file(original: &str, cwd: &Path) -> Result<(PathBuf, Gitignore), String> {
    let normalized = normalize_operand(original);
    let absolute = lexical_absolute(cwd, Path::new(&normalized));
    let directory = absolute.parent().unwrap_or(cwd);
    let mut builder = GitignoreBuilder::new(directory);
    builder
        .case_insensitive(false)
        .map_err(|error| format!("{}: {}", original, error))?;
    if let Some(error) = builder.add(&absolute) {
        return Err(format!("{}: {}", original, error));
    }
    builder
        .build()
        .map(|matcher| (directory.to_path_buf(), matcher))
        .map_err(|error| format!("{}: {}", original, error))
}

fn ignored_by_files(path: &Path, matchers: &[(PathBuf, Gitignore)]) -> bool {
    let mut ignored = false;
    for (directory, matcher) in matchers {
        let Ok(relative) = path.strip_prefix(directory) else {
            continue;
        };
        let matched = matcher.matched_path_or_any_parents(relative, false);
        if matched.is_ignore() {
            ignored = true;
        } else if matched.is_whitelist() {
            ignored = false;
        }
    }
    ignored
}

fn collect_files(
    operands: &[String],
    cli_ignore_patterns: &[String],
    config_exclude_patterns: &[String],
    ignore_files: &[(PathBuf, Gitignore)],
    use_gitignore: bool,
) -> Result<DiscoveryResult, Vec<String>> {
    let cwd = std::env::current_dir().map_err(|error| vec![error.to_string()])?;
    let cli_ignores = compile_ignore_patterns(cli_ignore_patterns);
    let config_excludes = compile_ignore_patterns(config_exclude_patterns);
    let mut gitignores = GitignoreCache::new(cwd.clone());
    let mut errors = Vec::new();
    let mut explicit = Vec::new();
    let mut patterns = Vec::new();

    for original in operands {
        let normalized = normalize_operand(original);
        let absolute = lexical_absolute(&cwd, Path::new(&normalized));
        match fs::metadata(&absolute) {
            Ok(metadata) if metadata.is_file() => explicit.push((absolute, original.clone())),
            Ok(metadata) if metadata.is_dir() => errors.push(format!(
                "{}: is a directory (pass a glob such as '{}/**/*.md' to format its contents)",
                original,
                original.trim_end_matches(['/', '\\'])
            )),
            Ok(_) => errors.push(format!("{}: no such file", original)),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if has_glob_magic(&normalized) {
                    patterns.push(normalized);
                } else {
                    errors.push(format!("{}: no such file", original));
                }
            }
            Err(error) => errors.push(format!("{}: {}", original, error)),
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    let mut result = DiscoveryResult::default();
    let mut seen = HashSet::new();

    // Explicit operands are inserted first so they win deduplication against glob matches.
    for (path, display) in explicit {
        result.had_matches = true;
        let normalized = matching_path(&path, &cwd);
        if is_ignored(&normalized, &cli_ignores) || ignored_by_files(&path, ignore_files) {
            result.had_filtered_matches = true;
        } else if seen.insert(path.clone()) {
            result.files.push(DiscoveredFile { path, display });
        }
    }

    let compiled_patterns: Vec<(String, glob::Pattern)> = patterns
        .iter()
        .filter(|pattern| pattern_is_within_cwd(pattern, &cwd))
        .filter_map(|pattern| {
            glob::Pattern::new(pattern)
                .ok()
                .map(|compiled| (pattern.clone(), compiled))
        })
        .collect();

    // WalkBuilder prunes ignored directories while loading only per-tree .gitignore
    // files. Explicitly disable every additional ignore source that the Node CLI
    // does not consult.
    let mut walker = WalkBuilder::new(&cwd);
    walker
        .hidden(false)
        .ignore(false)
        .git_ignore(use_gitignore)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .follow_links(false);
    for entry in walker.build().filter_map(Result::ok) {
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() && !entry.path().is_file() {
            continue;
        }
        let absolute = lexical_absolute(&cwd, entry.path());
        let relative = matching_path(&absolute, &cwd);
        let matched_pattern = compiled_patterns.iter().find(|(source, compiled)| {
            if Path::new(source).is_absolute() {
                compiled.matches(&absolute.to_string_lossy().replace('\\', "/"))
            } else {
                compiled.matches(&relative)
            }
        });
        let Some((source, _)) = matched_pattern else {
            continue;
        };
        result.had_matches = true;
        if seen.contains(&absolute) {
            continue;
        }
        let filtered = is_ignored(&relative, &cli_ignores)
            || is_ignored(&relative, &config_excludes)
            || ignored_by_files(&absolute, ignore_files);
        if filtered {
            result.had_filtered_matches = true;
        } else {
            seen.insert(absolute.clone());
            result.files.push(DiscoveredFile {
                path: absolute.clone(),
                display: if Path::new(source).is_absolute() {
                    absolute.to_string_lossy().into_owned()
                } else {
                    relative
                },
            });
        }
    }

    // Patterns rooted outside cwd cannot be served by the cwd pruning walk.
    // Preserve the CLI's existing support for those operands with glob's
    // no-follow traversal; cwd .gitignore files intentionally do not apply.
    for pattern in patterns
        .iter()
        .filter(|pattern| !pattern_is_within_cwd(pattern, &cwd))
    {
        if let Ok(entries) = glob(pattern) {
            for entry in entries.flatten().filter(|entry| entry.is_file()) {
                result.had_matches = true;
                let absolute = lexical_absolute(&cwd, &entry);
                if seen.contains(&absolute) {
                    continue;
                }
                let normalized = matching_path(&absolute, &cwd);
                let filtered = is_ignored(&normalized, &cli_ignores)
                    || is_ignored(&normalized, &config_excludes)
                    || ignored_by_files(&absolute, ignore_files);
                if filtered {
                    result.had_filtered_matches = true;
                } else {
                    seen.insert(absolute.clone());
                    result.files.push(DiscoveredFile {
                        path: absolute,
                        display: entry.to_string_lossy().into_owned(),
                    });
                }
            }
        }
    }

    // The pruning walk cannot yield a file hidden by .gitignore. Probe only
    // until the first such match so D4 can distinguish "no match" from "all
    // filtered" without computing or reporting a pre-filter count.
    if use_gitignore && !result.had_matches {
        'patterns: for pattern in patterns {
            if let Ok(entries) = glob(&pattern) {
                for entry in entries.flatten() {
                    if entry.is_file() {
                        let absolute = lexical_absolute(&cwd, &entry);
                        if gitignores.is_ignored(&absolute) {
                            result.had_matches = true;
                            result.had_filtered_matches = true;
                            break 'patterns;
                        }
                    }
                }
            }
        }
    }
    Ok(result)
}

/// Render one ReportEntry to `stderr` in the stable `--dry-run` format.
///
/// Format — greppable by path, filterable by rule token:
///   <path>:<start>-<end> [<rule>]
///     - <before line 1>
///     - <before line 2>
///     - …           (when > 3 lines)
///     + <after line 1>
///     + <after line 2>
///     + …           (when > 3 lines)
///
/// Lines are 1-based in output (CLI-facing) even though the core tracks them
/// 0-based internally.
fn write_report_entry<W: Write>(out: &mut W, path: &str, entry: &ReportEntry) -> io::Result<()> {
    let start_1 = entry.start_line + 1;
    let end_1 = entry.end_line + 1;
    writeln!(out, "{}:{}-{} [{}]", path, start_1, end_1, entry.rule)?;
    write_snippet(out, &entry.before, '-')?;
    write_snippet(out, &entry.after, '+')?;
    Ok(())
}

/// Write up to 3 lines of a before/after snippet, truncating the rest with `…`.
/// Prefix is `-` for before, `+` for after. Empty snippets (e.g. tighten ops
/// that delete a blank line) render as a single "(deleted)" marker so the
/// user can tell the rule meant to remove content.
fn write_snippet<W: Write>(out: &mut W, snippet: &[String], prefix: char) -> io::Result<()> {
    if snippet.is_empty() {
        writeln!(out, "  {} (no lines)", prefix)?;
        return Ok(());
    }
    const MAX_LINES: usize = 3;
    for line in snippet.iter().take(MAX_LINES) {
        writeln!(out, "  {} {}", prefix, line)?;
    }
    if snippet.len() > MAX_LINES {
        writeln!(out, "  {} …", prefix)?;
    }
    Ok(())
}

fn main() {
    let cli = Cli::parse();

    // Load config using the core library's 3-layer merge
    let loaded: FullConfig = load_full_config(cli.config.as_deref(), None);

    let cli_ignore: Vec<String> = cli
        .ignore
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();

    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(error) => {
            eprintln!("{}", error);
            process::exit(1);
        }
    };
    let mut ignore_files = Vec::new();
    let mut ignore_file_errors = Vec::new();
    for path in &cli.ignore_paths {
        match compile_ignore_file(path, &cwd) {
            Ok(matcher) => ignore_files.push(matcher),
            Err(error) => ignore_file_errors.push(error),
        }
    }
    if !ignore_file_errors.is_empty() {
        for error in ignore_file_errors {
            eprintln!("{}", error);
        }
        process::exit(1);
    }

    let patterns = if cli.patterns.is_empty() {
        vec!["**/*.md".to_string(), "**/*.mdx".to_string()]
    } else {
        cli.patterns.clone()
    };
    let discovery = match collect_files(
        &patterns,
        &cli_ignore,
        &loaded.exclude_patterns,
        &ignore_files,
        !cli.no_gitignore,
    ) {
        Ok(discovery) => discovery,
        Err(errors) => {
            for error in errors {
                eprintln!("{}", error);
            }
            process::exit(1);
        }
    };
    let files = discovery.files;

    if files.is_empty() {
        let message = if discovery.had_matches && discovery.had_filtered_matches {
            "All matching files were excluded by ignore/exclude patterns — 0 files to process."
        } else {
            "No files found matching the patterns."
        };
        if cli.dry_run {
            eprintln!("{}", message.yellow());
        } else {
            println!("{}", message.yellow());
        }
        return;
    }

    if cli.dry_run {
        run_dry_run(&files, &loaded);
        return;
    }

    println!(
        "{}",
        format!("Processing {} file(s)...", files.len()).blue()
    );

    let mut changed_count = 0u32;
    let mut error_count = 0u32;

    for file in &files {
        let path_str = &file.display;

        match fs::read_to_string(&file.path) {
            Ok(content) => {
                let formatted = match try_format(&content, &loaded.settings) {
                    Ok(result) => result,
                    Err(e) => {
                        error_count += 1;
                        eprintln!(
                            "{} {} {}",
                            "✗".red(),
                            path_str.dimmed(),
                            e.to_string().red()
                        );
                        continue;
                    }
                };
                let needs_formatting = formatted != content;

                if cli.write {
                    if needs_formatting {
                        if let Err(e) = fs::write(&file.path, &formatted) {
                            error_count += 1;
                            eprintln!(
                                "{} {} {}",
                                "✗".red(),
                                path_str.dimmed(),
                                e.to_string().red()
                            );
                            continue;
                        }
                        changed_count += 1;
                        println!(
                            "{} {} {}",
                            "✓".green(),
                            path_str.dimmed(),
                            "formatted".green()
                        );
                    } else {
                        println!(
                            "{} {} {}",
                            "○".dimmed(),
                            path_str.dimmed(),
                            "unchanged".dimmed()
                        );
                    }
                } else if cli.check {
                    if needs_formatting {
                        changed_count += 1;
                        println!(
                            "{} {} {}",
                            "⚠".yellow(),
                            path_str.dimmed(),
                            "needs formatting".yellow()
                        );
                    } else {
                        println!(
                            "{} {} {}",
                            "✓".green(),
                            path_str.dimmed(),
                            "formatted correctly".green()
                        );
                    }
                } else {
                    // Default: show what would be done
                    if needs_formatting {
                        changed_count += 1;
                        println!(
                            "{} {} {}",
                            "→".blue(),
                            path_str.dimmed(),
                            "would be formatted".blue()
                        );
                    } else {
                        println!(
                            "{} {} {}",
                            "○".dimmed(),
                            path_str.dimmed(),
                            "already formatted".dimmed()
                        );
                    }
                }
            }
            Err(e) => {
                error_count += 1;
                eprintln!(
                    "{} {} {}",
                    "✗".red(),
                    path_str.dimmed(),
                    e.to_string().red()
                );
            }
        }
    }

    // Summary
    println!();

    if cli.write {
        if changed_count > 0 {
            println!(
                "{}",
                format!("✓ Formatted {} file(s)", changed_count).green()
            );
        } else {
            println!("{}", "All files are already formatted".dimmed());
        }
    } else if cli.check {
        if changed_count > 0 {
            println!(
                "{}",
                format!("⚠ {} file(s) need formatting", changed_count).yellow()
            );
        } else {
            println!("{}", "✓ All files are formatted correctly".green());
        }
    } else if changed_count > 0 {
        println!(
            "{}",
            format!("→ {} file(s) would be formatted", changed_count).blue()
        );
        println!("{}", "Use --write to apply changes".dimmed());
    } else {
        println!("{}", "All files are already formatted".dimmed());
    }

    if error_count > 0 {
        eprintln!("{}", format!("✗ {} error(s) occurred", error_count).red());
        process::exit(1);
    }

    if cli.check && changed_count > 0 {
        process::exit(1);
    }
}

/// `--dry-run` handler. Writes EVERYTHING to stderr: nothing to stdout, nothing
/// to disk. Always exits 0. Errors reading/parsing individual files are
/// reported as stderr lines but do NOT change the exit code — dry-run is an
/// audit tool and must not fail CI when a file is malformed.
fn run_dry_run(files: &[DiscoveredFile], loaded: &FullConfig) {
    let stderr = io::stderr();
    let mut err = stderr.lock();
    let mut total_entries = 0usize;
    let mut files_with_changes = 0usize;

    for file in files {
        let path_str = &file.display;
        let content = match fs::read_to_string(&file.path) {
            Ok(c) => c,
            Err(e) => {
                let _ = writeln!(err, "{}: read error: {}", path_str, e);
                continue;
            }
        };

        let mut sink = VecSink::default();
        match try_format_with_sink(&content, &loaded.settings, &mut sink) {
            Ok(_) => {}
            Err(e) => {
                let _ = writeln!(err, "{}: parse error: {}", path_str, e);
                continue;
            }
        }

        if sink.entries.is_empty() {
            continue;
        }

        files_with_changes += 1;
        for entry in &sink.entries {
            total_entries += 1;
            let _ = write_report_entry(&mut err, path_str, entry);
        }
    }

    let _ = writeln!(
        err,
        "\n{} entr{} across {} file{} (dry-run; no files were modified).",
        total_entries,
        if total_entries == 1 { "y" } else { "ies" },
        files_with_changes,
        if files_with_changes == 1 { "" } else { "s" },
    );
}
