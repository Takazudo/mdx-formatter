use clap::Parser;
use colored::Colorize;
use glob::glob;
use mdx_formatter_core::{format, FormatterSettings};
use std::collections::HashSet;
use std::fs;
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

    /// Path to config file (.mdx-formatter.json)
    #[arg(long)]
    config: Option<String>,

    /// Comma-separated patterns to ignore
    #[arg(long, default_value = "node_modules/**,dist/**,build/**,.git/**,worktrees/**")]
    ignore: String,
}

/// Config file content (settings + optional exclude patterns)
#[derive(Debug)]
struct LoadedConfig {
    settings: FormatterSettings,
    exclude_patterns: Vec<String>,
}

/// Try to find and read a config file, returning the parsed JSON object.
/// Returns Err when an explicit config path is given but fails to load.
fn find_config_file(config_path: Option<&str>) -> Result<Option<serde_json::Value>, String> {
    // If explicit path given, use it and surface errors
    if let Some(path) = config_path {
        let content = fs::read_to_string(path)
            .map_err(|e| format!("Cannot read config file '{}': {}", path, e))?;
        let value = serde_json::from_str(&content)
            .map_err(|e| format!("Invalid JSON in config file '{}': {}", path, e))?;
        return Ok(Some(value));
    }

    // Try .mdx-formatter.json in cwd
    if let Ok(content) = fs::read_to_string(".mdx-formatter.json") {
        if let Ok(value) = serde_json::from_str(&content) {
            return Ok(Some(value));
        }
    }

    // Try "mdx-formatter" key in package.json
    if let Ok(content) = fs::read_to_string("package.json") {
        if let Ok(pkg) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(config) = pkg.get("mdx-formatter") {
                if config.is_object() {
                    return Ok(Some(config.clone()));
                }
            }
        }
    }

    Ok(None)
}

/// Load config: merge file config with defaults and extract exclude patterns
fn load_config(config_path: Option<&str>) -> Result<LoadedConfig, String> {
    let file_config = find_config_file(config_path)?;

    match file_config {
        Some(ref value) => {
            // Extract exclude patterns
            let exclude_patterns = value
                .get("exclude")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|item| item.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            // serde ignores unknown fields ("exclude"), so no need to strip it
            let settings = FormatterSettings::from_partial_json(value);

            Ok(LoadedConfig {
                settings,
                exclude_patterns,
            })
        }
        None => Ok(LoadedConfig {
            settings: FormatterSettings::default(),
            exclude_patterns: vec![],
        }),
    }
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

fn main() {
    let cli = Cli::parse();

    // Load config (explicit --config errors are fatal)
    let loaded = match load_config(cli.config.as_deref()) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("{} {}", "Error:".red(), e);
            process::exit(1);
        }
    };

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
        println!("{}", "No files found matching the patterns.".yellow());
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
                let formatted = format(&content, &loaded.settings);
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
