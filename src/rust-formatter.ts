/**
 * Rust napi formatter loader.
 * Loads the native Rust formatter compiled via napi-rs.
 * This is the sole formatting engine — no TypeScript fallback.
 */

import { createRequire } from 'module';
import { platform, arch } from 'os';

const require = createRequire(import.meta.url);

type NativeFormat = (content: string, settingsJson: string) => string;

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

function loadNativeModule(): NativeFormat {
  // Try platform-specific npm package first
  const packageName = getPackageName();
  if (packageName) {
    try {
      const native = require(packageName) as { format: NativeFormat };
      return native.format;
    } catch {
      // Platform package not installed, try local build
    }
  }

  // Try local build
  try {
    const native = require('../crates/mdx-formatter-napi/mdx-formatter-napi.node') as {
      format: NativeFormat;
    };
    return native.format;
  } catch {
    throw new Error('Rust native module not available. Build it with: pnpm build:rust');
  }
}

/**
 * The native format function. Loaded once at module init.
 * Throws if the native module is not available.
 */
export const nativeFormat: NativeFormat = loadNativeModule();

/**
 * Check if the Rust formatter is available
 */
export function isRustFormatterAvailable(): boolean {
  return true; // If we got here, the module loaded successfully
}
