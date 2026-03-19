/**
 * Browser-safe entry point for mdx-formatter.
 *
 * Unlike the main entry point (`index.ts`), this module does NOT import
 * `load-config.ts` and therefore avoids pulling in Node's `fs` and `path`.
 * Use this export (`@takazudo/mdx-formatter/browser`) when bundling for
 * Vite, webpack, or any browser environment.
 *
 * Formatting uses default settings only — config file loading is skipped.
 */

import { HybridFormatter } from './hybrid-formatter.js';

const MAX_ITERATIONS = 3;

/**
 * Format markdown/MDX content in browser environments.
 * Uses default settings (no config file loading, avoiding Node fs/path).
 */
export async function format(content: string): Promise<string> {
  try {
    let result = content;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const formatter = new HybridFormatter(result);
      const formatted = await formatter.format();
      if (formatted === result) break;
      result = formatted;
    }
    return result;
  } catch {
    return content;
  }
}

/**
 * Check if content is likely MDX.
 *
 * This is a standalone copy of the function from `index.ts` to avoid
 * importing that module (which transitively imports Node's `fs`).
 */
export function detectMdx(content: string): boolean {
  const mdxPatterns = [/^import\s+/m, /^export\s+/m, /<[A-Z]\w*[^>]*>/, /^\s*---\s*$/m];
  return mdxPatterns.some((pattern) => pattern.test(content));
}
