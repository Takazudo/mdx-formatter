#!/usr/bin/env node

import { readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { program } from 'commander';
import chalk from 'chalk';
import { formatFile, checkFile, dryRunReport } from './index.js';
import type { DryRunReportEntry } from './index.js';
import { loadFullConfig } from './load-config.js';
import type { FormatOptions } from './types.js';
import { discoverFiles } from './discover.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf-8')) as {
  version: string;
};

program
  .name('mdx-formatter')
  .description('AST-based markdown and MDX formatter')
  .version(pkg.version)
  .argument('[patterns...]', 'Glob patterns for files to format', ['**/*.{md,mdx}'])
  .option('-w, --write', 'Write formatted files in place')
  .option('-c, --check', 'Check if files need formatting')
  .option(
    '--dry-run',
    [
      'Preview every change on stderr without touching files or stdout.',
      'Each entry is: `<path>:<start>-<end> [<rule>]`, followed by indented',
      '`- <before>` / `+ <after>` lines (≤3 each, truncated with `…`).',
      'Exits 0 whether or not there was anything to report.',
    ].join(' '),
  )
  .option('--config <path>', 'Path to config file (.mdx-formatter.json)')
  .option(
    '--ignore <patterns>',
    'Comma-separated patterns to ignore',
    'node_modules/**,dist/**,build/**,.git/**,worktrees/**',
  )
  .action(
    async (
      patterns: string[],
      options: {
        write?: boolean;
        check?: boolean;
        dryRun?: boolean;
        config?: string;
        ignore: string;
      },
    ) => {
      try {
        // commander does not natively encode "conflicts with" rules; enforce
        // the same constraint the Rust CLI uses so the two stay in lockstep.
        const mutuallyExclusive = [options.write, options.check, options.dryRun].filter(
          Boolean,
        ).length;
        if (mutuallyExclusive > 1) {
          console.error(
            chalk.red('Error:'),
            '--dry-run cannot be combined with --write or --check',
          );
          process.exit(1);
        }
        await main(patterns, options);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red('Error:'), message);
        process.exit(1);
      }
    },
  );

program.parse();

/**
 * Main CLI function
 */
async function main(
  patterns: string[],
  options: {
    write?: boolean;
    check?: boolean;
    dryRun?: boolean;
    config?: string;
    ignore: string;
  },
): Promise<void> {
  const cliIgnorePatterns = options.ignore.split(',').map((p) => p.trim());

  // Load config once: get both formatter settings and exclude patterns
  const { settings, excludePatterns } = loadFullConfig(
    options.config ? { config: options.config } : {},
  );
  const ignorePatterns = [...new Set([...cliIgnorePatterns, ...excludePatterns])];
  const formatOptions: FormatOptions = { settings };

  const uniqueFiles = await discoverFiles(patterns, ignorePatterns);

  if (uniqueFiles.length === 0) {
    if (options.dryRun) {
      console.error(chalk.yellow('No files found matching the patterns.'));
    } else {
      console.log(chalk.yellow('No files found matching the patterns.'));
    }
    return;
  }

  if (options.dryRun) {
    await runDryRun(uniqueFiles, formatOptions);
    return;
  }

  console.log(chalk.blue(`Processing ${uniqueFiles.length} file(s)...`));

  let changedCount = 0;
  let errorCount = 0;

  for (const file of uniqueFiles) {
    try {
      if (options.write) {
        const changed = await formatFile(file, formatOptions);
        if (changed) {
          changedCount++;
          console.log(chalk.green('✓'), chalk.gray(file), chalk.green('formatted'));
        } else {
          console.log(chalk.gray('○'), chalk.gray(file), chalk.gray('unchanged'));
        }
      } else if (options.check) {
        const needsFormatting = await checkFile(file, formatOptions);
        if (needsFormatting) {
          changedCount++;
          console.log(chalk.yellow('⚠'), chalk.gray(file), chalk.yellow('needs formatting'));
        } else {
          console.log(chalk.green('✓'), chalk.gray(file), chalk.green('formatted correctly'));
        }
      } else {
        // Default: just show what would be done
        const needsFormatting = await checkFile(file, formatOptions);
        if (needsFormatting) {
          changedCount++;
          console.log(chalk.blue('→'), chalk.gray(file), chalk.blue('would be formatted'));
        } else {
          console.log(chalk.gray('○'), chalk.gray(file), chalk.gray('already formatted'));
        }
      }
    } catch (error) {
      errorCount++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red('✗'), chalk.gray(file), chalk.red(message));
    }
  }

  // Summary
  console.log();
  if (options.write) {
    if (changedCount > 0) {
      console.log(chalk.green(`✓ Formatted ${changedCount} file(s)`));
    } else {
      console.log(chalk.gray('All files are already formatted'));
    }
  } else if (options.check) {
    if (changedCount > 0) {
      console.log(chalk.yellow(`⚠ ${changedCount} file(s) need formatting`));
      process.exit(1); // Exit with error code for CI
    } else {
      console.log(chalk.green('✓ All files are formatted correctly'));
    }
  } else {
    if (changedCount > 0) {
      console.log(chalk.blue(`→ ${changedCount} file(s) would be formatted`));
      console.log(chalk.gray('Use --write to apply changes'));
    } else {
      console.log(chalk.gray('All files are already formatted'));
    }
  }

  if (errorCount > 0) {
    console.log(chalk.red(`✗ ${errorCount} error(s) occurred`));
    process.exit(1);
  }
}

/**
 * `--dry-run` handler. Mirrors the Rust CLI: writes every report entry +
 * summary to stderr, never touches stdout or disk, and always exits 0 — even
 * when an individual file fails to parse. The report format is identical to
 * the Rust CLI's so tooling can consume either.
 */
async function runDryRun(files: string[], formatOptions: FormatOptions): Promise<void> {
  let totalEntries = 0;
  let filesWithChanges = 0;

  for (const file of files) {
    let content: string;
    try {
      content = await fs.readFile(file, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${file}: read error: ${message}\n`);
      continue;
    }

    let entries: DryRunReportEntry[];
    try {
      entries = dryRunReport(content, formatOptions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${file}: parse error: ${message}\n`);
      continue;
    }

    if (entries.length === 0) continue;

    filesWithChanges += 1;
    for (const entry of entries) {
      totalEntries += 1;
      writeReportEntry(file, entry);
    }
  }

  const entryWord = totalEntries === 1 ? 'entry' : 'entries';
  const fileWord = filesWithChanges === 1 ? 'file' : 'files';
  process.stderr.write(
    `\n${totalEntries} ${entryWord} across ${filesWithChanges} ${fileWord} ` +
      `(dry-run; no files were modified).\n`,
  );
}

/** Render one report entry to stderr in the format shared with the Rust CLI. */
function writeReportEntry(path: string, entry: DryRunReportEntry): void {
  const start1 = entry.startLine + 1;
  const end1 = entry.endLine + 1;
  process.stderr.write(`${path}:${start1}-${end1} [${entry.rule}]\n`);
  writeSnippet(entry.before, '-');
  writeSnippet(entry.after, '+');
}

/**
 * Write up to 3 lines of a before/after snippet, truncating the rest with
 * `…`. Empty snippets render as `(no lines)` so a delete-only change is
 * still visible to the user.
 */
function writeSnippet(snippet: string[], prefix: '-' | '+'): void {
  if (snippet.length === 0) {
    process.stderr.write(`  ${prefix} (no lines)\n`);
    return;
  }
  const MAX = 3;
  for (const line of snippet.slice(0, MAX)) {
    process.stderr.write(`  ${prefix} ${line}\n`);
  }
  if (snippet.length > MAX) {
    process.stderr.write(`  ${prefix} …\n`);
  }
}
