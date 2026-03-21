/**
 * Main entry point for mdx-formatter.
 * Uses the Rust napi formatter as the sole formatting engine.
 */

import { promises as fs } from 'fs';
import { loadConfig } from './load-config.js';
import { detectMdx } from './detect-mdx.js';
import { nativeFormat } from './rust-formatter.js';
import type { FormatOptions } from './types.js';

export { detectMdx };

/**
 * Format markdown/MDX content using the Rust formatter.
 */
export async function format(content: string, options: FormatOptions = {}): Promise<string> {
  const settings = loadConfig(options);
  const settingsJson = JSON.stringify(settings);
  return nativeFormat(content, settingsJson);
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

export default {
  format,
  formatFile,
  checkFile,
  detectMdx,
};
