/**
 * Wrapper for the Rust napi formatter.
 * This module loads the native Rust formatter compiled via napi-rs
 * and exposes the same format() API as the TypeScript implementation.
 */

import { createRequire } from 'module';
import type { FormatOptions } from './types.js';
import { loadConfig } from './load-config.js';

const require = createRequire(import.meta.url);

// Try to load the native module
let nativeFormat: ((content: string, settingsJson: string) => string) | null = null;

try {
  const native = require('../crates/mdx-formatter-napi/mdx-formatter-napi.node') as {
    format: (content: string, settingsJson: string) => string;
  };
  nativeFormat = native.format;
} catch {
  // Native module not available - not built yet or wrong platform
}

/**
 * Check if the Rust formatter is available
 */
export function isRustFormatterAvailable(): boolean {
  return nativeFormat !== null;
}

/**
 * Format markdown/MDX content using the Rust formatter
 * API-compatible with the TypeScript format() function
 */
export async function format(content: string, options: FormatOptions = {}): Promise<string> {
  if (!nativeFormat) {
    throw new Error(
      'Rust formatter not available. Build it first with: cd crates/mdx-formatter-napi && cargo build',
    );
  }

  const settings = loadConfig(options);
  const settingsJson = JSON.stringify(settings);

  return nativeFormat(content, settingsJson);
}
