/**
 * Rust napi formatter loader.
 * Loads the native Rust formatter compiled via napi-rs.
 * This is the sole formatting engine — no TypeScript fallback.
 */

import { createRequire } from 'module';
import { platform, arch } from 'os';

const require = createRequire(import.meta.url);

type NativeFormat = (content: string, settingsJson: string) => string;
type NativeDryRunReport = (content: string, settingsJson: string) => string;

/**
 * One dry-run report entry, as produced by the Rust `ReportSink` and
 * serialized through the napi `dry_run_report` / `dryRunReport` export.
 * Line numbers are 0-indexed; the TS CLI converts them to 1-based when
 * printing.
 */
export interface DryRunReportEntry {
  rule: string;
  startLine: number;
  endLine: number;
  before: string[];
  after: string[];
}

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

interface NativeModule {
  format: NativeFormat;
  dryRunReport?: NativeDryRunReport;
}

function loadNativeModule(): NativeModule {
  // In the repo, prefer a freshly built local native module so tests exercise
  // the code from the current checkout instead of the last published binary.
  try {
    const native = require('../crates/mdx-formatter-napi/mdx-formatter-napi.node') as NativeModule;
    return native;
  } catch {
    // Local build not present, fall back to platform-specific npm package.
  }

  const packageName = getPackageName();
  if (packageName) {
    try {
      const native = require(packageName) as NativeModule;
      return native;
    } catch {
      // Platform package not installed, surface a build hint below.
    }
  }

  throw new Error('Rust native module not available. Build it with: pnpm build:rust');
}

const nativeModule: NativeModule = loadNativeModule();

/**
 * The native format function. Loaded once at module init.
 * Throws if the native module is not available.
 */
export const nativeFormat: NativeFormat = nativeModule.format;

/**
 * Compute the dry-run report for `content`. Returns a parsed array of
 * `DryRunReportEntry`. Throws if the binary is older than this TS build and
 * does not yet export `dryRunReport` (see `build:rust`).
 */
export function nativeDryRunReport(content: string, settingsJson: string): DryRunReportEntry[] {
  if (typeof nativeModule.dryRunReport !== 'function') {
    throw new Error(
      'The loaded Rust native module does not export `dryRunReport`. ' +
        'Rebuild it with: pnpm build:rust',
    );
  }
  const json = nativeModule.dryRunReport(content, settingsJson);
  return JSON.parse(json) as DryRunReportEntry[];
}

/**
 * Check if the Rust formatter is available
 */
export function isRustFormatterAvailable(): boolean {
  return true; // If we got here, the module loaded successfully
}
