#!/usr/bin/env node

import { readFileSync } from 'fs';
import { program } from 'commander';
import { glob } from 'glob';
import chalk from 'chalk';
import { formatFile, checkFile } from './index.js';
import { loadFullConfig } from './load-config.js';
import type { FormatOptions } from './types.js';

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
  .option('--config <path>', 'Path to config file (.mdx-formatter.json)')
  .option(
    '--ignore <patterns>',
    'Comma-separated patterns to ignore',
    'node_modules/**,dist/**,build/**,.git/**,worktrees/**',
  )
  .action(
    async (
      patterns: string[],
      options: { write?: boolean; check?: boolean; config?: string; ignore: string },
    ) => {
      try {
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
  options: { write?: boolean; check?: boolean; config?: string; ignore: string },
): Promise<void> {
  const cliIgnorePatterns = options.ignore.split(',').map((p) => p.trim());

  // Load config once: get both formatter settings and exclude patterns
  const { settings, excludePatterns } = loadFullConfig(
    options.config ? { config: options.config } : {},
  );
  const ignorePatterns = [...new Set([...cliIgnorePatterns, ...excludePatterns])];
  const formatOptions: FormatOptions = { settings };

  // Find all matching files
  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      ignore: ignorePatterns,
      nodir: true,
    });
    files.push(...matches);
  }

  // Remove duplicates
  const uniqueFiles = [...new Set(files)];

  if (uniqueFiles.length === 0) {
    console.log(chalk.yellow('No files found matching the patterns.'));
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
