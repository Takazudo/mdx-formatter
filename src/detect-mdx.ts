/**
 * Detect whether content is likely MDX.
 *
 * Shared between the main (`index.ts`) and browser (`browser.ts`) entry
 * points so the detection logic is not duplicated.
 */

export function detectMdx(content: string): boolean {
  const mdxPatterns = [/^import\s+/m, /^export\s+/m, /<[A-Z]\w*[^>]*>/, /^\s*---\s*$/m];
  return mdxPatterns.some((pattern) => pattern.test(content));
}
