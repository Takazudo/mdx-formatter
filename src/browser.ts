/**
 * Browser-safe entry point for mdx-formatter.
 *
 * This export provides only browser-safe utilities (no Node.js fs/path deps).
 * For formatting in browser environments, use the WASM package instead:
 *
 *   npm install @takazudo/mdx-formatter-wasm
 *
 * The WASM package provides format() and format_with_defaults() functions
 * that work in any browser environment.
 */

export { detectMdx } from './detect-mdx.js';
export type { FormatterSettings, DeepPartial } from './types.js';
