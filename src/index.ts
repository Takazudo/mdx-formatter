/**
 * Main entry point for the markdown formatter
 * Uses MdxFormatter for AST-based formatting
 */

import { promises as fs } from 'fs';
import { MdxFormatter } from './mdx-formatter.js';
import { loadConfig } from './load-config.js';
import { detectMdx } from './detect-mdx.js';
import type { FormatOptions } from './types.js';

export { detectMdx };

/**
 * Format markdown/MDX content using hybrid AST approach
 */
export async function format(content: string, options: FormatOptions = {}): Promise<string> {
  try {
    const settings = loadConfig(options);
    let result = content;
    // Some rule interactions (e.g., list indent normalization + addEmptyLinesInBlockJsx)
    // may require multiple passes to converge. 3 iterations is sufficient for all known
    // cases (most files converge in 1, edge cases in 2).
    const MAX_ITERATIONS = 3;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const formatter = new MdxFormatter(result, settings);
      const formatted = await formatter.format();
      if (formatted === result) break;
      result = formatted;
    }
    return result;
  } catch {
    // Silently return original content if formatting fails
    // This is expected for files with certain JSX patterns that remark-mdx doesn't like
    return content;
  }
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

// Export all functions
export default {
  format,
  formatFile,
  checkFile,
  detectMdx,
};
