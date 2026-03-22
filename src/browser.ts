/**
 * Browser-safe entry point for mdx-formatter.
 *
 * Note: In browser environments, use the WASM module directly instead.
 * This export is kept for API compatibility but requires the napi native
 * module to be available (Node.js only).
 *
 * For true browser usage, see the WASM package at
 * `crates/mdx-formatter-wasm/` or the doc site playground.
 */

export { format, detectMdx } from './index.js';
export type { FormatterSettings, DeepPartial } from './types.js';
