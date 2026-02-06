/**
 * Main entry point for the markdown formatter
 * Uses HybridFormatter for AST-based formatting
 */

import { promises as fs } from 'fs';
import { HybridFormatter } from './hybrid-formatter.js';
import { loadConfig } from './load-config.js';

/**
 * Check if content is likely MDX
 * @param {string} content - File content to check
 * @returns {boolean} True if content appears to be MDX
 */
export function detectMdx(content) {
  // Check for MDX-specific features
  const mdxPatterns = [/^import\s+/m, /^export\s+/m, /<[A-Z]\w*[^>]*>/, /^\s*---\s*$/m];

  return mdxPatterns.some((pattern) => pattern.test(content));
}

/**
 * Format markdown/MDX content using hybrid AST approach
 * @param {string} content - Content to format
 * @param {Object} [options] - Formatting options
 * @param {string} [options.config] - Path to config file
 * @param {Object} [options.settings] - Direct settings overrides
 * @returns {Promise<string>} Formatted content
 */
export async function format(content, options = {}) {
  try {
    const settings = loadConfig(options);
    const formatter = new HybridFormatter(content, settings);
    return formatter.format();
  } catch {
    // Silently return original content if formatting fails
    // This is expected for files with certain JSX patterns that remark-mdx doesn't like
    return content;
  }
}

/**
 * Format a file and write it back if changed
 * @param {string} filePath - Path to the file
 * @param {Object} [options] - Formatting options
 * @returns {Promise<boolean>} True if file was changed
 */
export async function formatFile(filePath, options = {}) {
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
 * @param {string} filePath - Path to the file
 * @param {Object} [options] - Formatting options
 * @returns {Promise<boolean>} True if file needs formatting
 */
export async function checkFile(filePath, options = {}) {
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
