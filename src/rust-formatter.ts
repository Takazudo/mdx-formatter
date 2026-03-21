/**
 * Wrapper for the Rust napi formatter.
 * This module loads the native Rust formatter compiled via napi-rs
 * and exposes the same format() API as the TypeScript implementation.
 */

import { createRequire } from 'module';
import { platform, arch } from 'os';
import type { FormatOptions } from './types.js';
import { loadConfig } from './load-config.js';

const require = createRequire(import.meta.url);

function getPackageName(): string {
  const platformName = platform();
  const archName = arch();

  const platformMap: Record<string, Record<string, string>> = {
    darwin: {
      arm64: '@takazudo/mdx-formatter-darwin-arm64',
      x64: '@takazudo/mdx-formatter-darwin-x64',
    },
    linux: {
      x64: '@takazudo/mdx-formatter-linux-x64-gnu',
    },
    win32: {
      x64: '@takazudo/mdx-formatter-win32-x64-msvc',
    },
  };

  return platformMap[platformName]?.[archName] ?? '';
}

let nativeFormat: ((content: string, settingsJson: string) => string) | null = null;

try {
  // Try platform-specific npm package first
  const packageName = getPackageName();
  if (packageName) {
    const native = require(packageName) as {
      format: (content: string, settingsJson: string) => string;
    };
    nativeFormat = native.format;
  }
} catch {
  // Fall back to local build
  try {
    const native = require('../crates/mdx-formatter-napi/mdx-formatter-napi.node') as {
      format: (content: string, settingsJson: string) => string;
    };
    nativeFormat = native.format;
  } catch {
    // Native module not available
  }
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
    throw new Error('Rust formatter not available. Build it first with: pnpm build:rust');
  }

  const settings = loadConfig(options);
  const settingsJson = JSON.stringify(settings);

  return nativeFormat(content, settingsJson);
}
