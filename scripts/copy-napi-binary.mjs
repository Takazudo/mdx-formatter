#!/usr/bin/env node
/**
 * copy-napi-binary.mjs
 *
 * Copy the freshly compiled napi binary to the expected location so that
 * `src/rust-formatter.ts` loadNativeModule() picks up the local build
 * instead of the last published platform package.
 *
 * Usage:
 *   node scripts/copy-napi-binary.mjs            # debug profile
 *   node scripts/copy-napi-binary.mjs --release  # release profile
 *
 * Resolves the cargo target directory via `cargo metadata` so it honours
 * both the default ./target and any CARGO_TARGET_DIR redirect (e.g. the
 * global ~/.cargo/config.toml on developer machines).
 *
 * Supports macOS (darwin) and Linux only. Windows release binaries are
 * produced by the CI cross-build workflow (release.yml), not this script.
 *
 * Uses only Node stdlib. Requires Node >= 18.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

/**
 * Resolve the cargo target directory by calling `cargo metadata`.
 * Respects CARGO_TARGET_DIR redirects in ~/.cargo/config.toml.
 */
function resolveTargetDir() {
  let raw;
  try {
    raw = execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  } catch (err) {
    process.stderr.write(`copy-napi-binary: failed to run 'cargo metadata': ${String(err)}\n`);
    process.exit(1);
  }

  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `copy-napi-binary: failed to parse 'cargo metadata' output: ${String(err)}\n`,
    );
    process.exit(1);
  }

  const targetDir = metadata.target_directory;
  if (typeof targetDir !== 'string' || targetDir.length === 0) {
    process.stderr.write('copy-napi-binary: cargo metadata did not return a target_directory\n');
    process.exit(1);
  }

  return targetDir;
}

/**
 * Return the platform-specific library filename for the napi binary.
 * Exits non-zero on unsupported platforms (Windows is intentionally excluded —
 * release binaries for Windows are built by the CI cross-build workflow).
 */
function libFilename() {
  switch (process.platform) {
    case 'darwin':
      return 'libmdx_formatter_napi.dylib';
    case 'linux':
      return 'libmdx_formatter_napi.so';
    default:
      process.stderr.write(
        `copy-napi-binary: unsupported platform '${process.platform}'. ` +
          'This script supports macOS (darwin) and Linux only.\n',
      );
      process.exit(1);
  }
}

function main() {
  const isRelease = process.argv.includes('--release');
  const profile = isRelease ? 'release' : 'debug';

  const targetDir = resolveTargetDir();
  const srcPath = resolve(targetDir, profile, libFilename());
  const destPath = resolve(repoRoot, 'crates', 'mdx-formatter-napi', 'mdx-formatter-napi.node');

  process.stdout.write(`copy-napi-binary: profile = ${profile}\n`);
  process.stdout.write(`copy-napi-binary: target  = ${targetDir}\n`);
  process.stdout.write(`copy-napi-binary: src     = ${srcPath}\n`);
  process.stdout.write(`copy-napi-binary: dest    = ${destPath}\n`);

  if (!existsSync(srcPath)) {
    process.stderr.write(
      `copy-napi-binary: source binary not found: ${srcPath}\n` +
        'Run `pnpm build:rust` (or `pnpm build:rust:release`) to compile it first.\n',
    );
    process.exit(1);
  }

  copyFileSync(srcPath, destPath);
  process.stdout.write('copy-napi-binary: done.\n');
}

main();
