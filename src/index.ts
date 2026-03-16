/**
 * Main entry point for the markdown formatter
 * Uses HybridFormatter for AST-based formatting
 */

import { promises as fs } from 'fs';
import { HybridFormatter } from './hybrid-formatter.js';
import { loadConfig } from './load-config.js';
import type { FormatOptions } from './types.js';

/**
 * Check if content is likely MDX
 */
export function detectMdx(content: string): boolean {
  // Check for MDX-specific features
  const mdxPatterns = [/^import\s+/m, /^export\s+/m, /<[A-Z]\w*[^>]*>/, /^\s*---\s*$/m];

  return mdxPatterns.some((pattern) => pattern.test(content));
}

/**
 * Format markdown/MDX content using hybrid AST approach
 */
export async function format(content: string, options: FormatOptions = {}): Promise<string> {
  try {
    const settings = loadConfig(options);
    let result = content;
    const MAX_ITERATIONS = 3;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const formatter = new HybridFormatter(result, settings);
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
