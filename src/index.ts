/**
 * Main entry point for mdx-formatter.
 * Uses the Rust napi formatter as the sole formatting engine.
 */

import { promises as fs } from 'fs';
import { loadConfig } from './load-config.js';
import { detectMdx } from './detect-mdx.js';
import { nativeFormat, nativeDryRunReport } from './rust-formatter.js';
import type { DryRunReportEntry } from './rust-formatter.js';
import { formatterSettings } from './settings.js';
import type { FormatOptions } from './types.js';

export { detectMdx };
export type { DryRunReportEntry };

/**
 * Format markdown/MDX content using the Rust formatter.
 */
export async function format(content: string, options: FormatOptions = {}): Promise<string> {
  const settings = loadConfig(options);
  const settingsJson = JSON.stringify(settings);
  return nativeFormat(content, settingsJson);
}

/**
 * Synchronous format with default settings.
 * API-compatible with @takazudo/mdx-formatter-wasm's format_with_defaults().
 * Useful for mocking the WASM module in Node.js test environments.
 */
export function formatSync(content: string): string {
  return nativeFormat(content, JSON.stringify(formatterSettings));
}

/**
 * Format a file and write it back if changed
 */
export async function formatFile(filePath: string, options: FormatOptions = {}): Promise<boolean> {
  const content = await fs.readFile(filePath, 'utf-8');
  const formatted = await format(content, options);

  if (content !== formatted) {
    await fs.writeFile(filePath, formatted, 'utf-8');
    return true;
  }

  return false;
}

/**
 * Check if a file needs formatting
 */
export async function checkFile(filePath: string, options: FormatOptions = {}): Promise<boolean> {
  const content = await fs.readFile(filePath, 'utf-8');
  const formatted = await format(content, options);
  return content !== formatted;
}

/**
 * Compute the dry-run report for `content` without modifying it.
 *
 * Entries describe every change the formatter's rules would make, with
 * 0-indexed line ranges and `before`/`after` snippets. Used by the CLI
 * `--dry-run` flag and exposed here so library consumers can audit a corpus
 * programmatically.
 */
export function dryRunReport(content: string, options: FormatOptions = {}): DryRunReportEntry[] {
  const settings = loadConfig(options);
  return nativeDryRunReport(content, JSON.stringify(settings));
}

export default {
  format,
  formatSync,
  formatFile,
  checkFile,
  dryRunReport,
  detectMdx,
};
