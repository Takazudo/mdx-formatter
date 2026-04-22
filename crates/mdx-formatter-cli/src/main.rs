use clap::Parser;
use colored::Colorize;
use glob::glob;
use mdx_formatter_core::{
    load_full_config, try_format, try_format_with_sink, FullConfig, ReportEntry, VecSink,
};
use std::collections::HashSet;
use std::fs;
use std::io::{self, Write};
use std::path::PathBuf;
use std::process;

/// AST-based markdown and MDX formatter
#[derive(Parser)]
#[command(name = "mdx-formatter", version, about)]
struct Cli {
    /// Glob patterns for files to format
    #[arg(default_values_t = vec!["**/*.md".to_string(), "**/*.mdx".to_string()])]
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
    #[arg(long, default_value = "node_modules/**,dist/**,build/**,.git/**,worktrees/**")]
    ignore: String,
}

/// Normalize a path string: strip leading "./" so glob patterns match consistently
fn normalize_path(path: &str) -> &str {
    path.strip_prefix("./").unwrap_or(path)
}

/// Compile ignore patterns once, silently skipping invalid ones
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

/// Collect files matching the given patterns, excluding ignored ones
fn collect_files(patterns: &[String], ignore_patterns: &[String]) -> Vec<PathBuf> {
    let compiled = compile_ignore_patterns(ignore_patterns);
    let mut seen = HashSet::new();
    let mut files = Vec::new();

    for pattern in patterns {
        if let Ok(entries) = glob(pattern) {
            for entry in entries.flatten() {
                // Skip directories
                if entry.is_dir() {
                    continue;
                }

                let path_str = entry.to_string_lossy().to_string();
                let normalized = normalize_path(&path_str).to_string();

                // Skip ignored paths
                if is_ignored(&normalized, &compiled) {
                    continue;
                }

                // Deduplicate by normalized path
                if seen.insert(normalized) {
                    files.push(entry);
                }
            }
        }
    }

    files
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

    // Merge CLI ignore patterns with config exclude patterns
    let mut all_ignore: Vec<String> = cli
        .ignore
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();
    for pattern in &loaded.exclude_patterns {
        if !all_ignore.contains(pattern) {
            all_ignore.push(pattern.clone());
        }
    }

    // Collect files
    let files = collect_files(&cli.patterns, &all_ignore);

    if files.is_empty() {
        if cli.dry_run {
            eprintln!("{}", "No files found matching the patterns.".yellow());
        } else {
            println!("{}", "No files found matching the patterns.".yellow());
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
        let path_str = file.to_string_lossy();

        match fs::read_to_string(file) {
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
                        if let Err(e) = fs::write(file, &formatted) {
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
        eprintln!(
            "{}",
            format!("✗ {} error(s) occurred", error_count).red()
        );
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
fn run_dry_run(files: &[PathBuf], loaded: &FullConfig) {
    let stderr = io::stderr();
    let mut err = stderr.lock();
    let mut total_entries = 0usize;
    let mut files_with_changes = 0usize;

    for file in files {
        let path_str = file.to_string_lossy();
        let content = match fs::read_to_string(file) {
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
            let _ = write_report_entry(&mut err, &path_str, entry);
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
