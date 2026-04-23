#!/usr/bin/env node
/**
 * sync-napi-versions.mjs
 *
 * Keep npm/<platform>/package.json version fields and root
 * optionalDependencies entries (prefixed with @takazudo/mdx-formatter-)
 * in lockstep with the root package.json version.
 *
 * Usage:
 *   node scripts/sync-napi-versions.mjs
 *   pnpm sync:napi-versions
 *
 * Exits non-zero with a clear error if the root version is missing or invalid.
 * Re-running the script on an already-synced tree is a no-op.
 *
 * Uses only Node stdlib. Requires Node >= 18.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64-gnu', 'win32-x64-msvc'];

const OPTIONAL_DEP_PREFIX = '@takazudo/mdx-formatter-';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..');

/**
 * Read a JSON file from disk. Returns parsed data and the original raw text
 * so callers can detect no-op writes.
 */
function readJson(path) {
  const raw = readFileSync(path, 'utf8');
  return { raw, data: JSON.parse(raw) };
}

/**
 * Serialize JSON with 2-space indentation and a trailing newline.
 */
function stringifyJson(data) {
  return JSON.stringify(data, null, 2) + '\n';
}

/**
 * Fail with a clear error message and non-zero exit.
 */
function fail(message) {
  process.stderr.write(`sync-napi-versions: ${message}\n`);
  process.exit(1);
}

function main() {
  const rootPkgPath = resolve(repoRoot, 'package.json');
  const { data: rootPkg } = readJson(rootPkgPath);

  const rootVersion = rootPkg.version;
  if (typeof rootVersion !== 'string' || rootVersion.length === 0) {
    fail('Root package.json "version" is missing or invalid');
  }

  process.stdout.write(`sync-napi-versions: root version = ${rootVersion}\n`);

  // 1. Rewrite npm/<platform>/package.json version fields.
  for (const platform of PLATFORMS) {
    const pkgPath = resolve(repoRoot, 'npm', platform, 'package.json');
    const { raw, data: pkg } = readJson(pkgPath);
    const previousVersion = pkg.version;
    pkg.version = rootVersion;
    const nextRaw = stringifyJson(pkg);
    if (nextRaw !== raw) {
      writeFileSync(pkgPath, nextRaw);
    }
    process.stdout.write(`  npm/${platform}/package.json: ${previousVersion} -> ${rootVersion}\n`);
  }

  // 2. Rewrite root optionalDependencies entries matching the prefix.
  // Re-read the root package.json to pick up any in-flight changes (defensive).
  const { raw: rootRaw, data: rootPkg2 } = readJson(rootPkgPath);
  const optionalDeps = rootPkg2.optionalDependencies;

  process.stdout.write(`  optionalDependencies:\n`);
  if (optionalDeps && typeof optionalDeps === 'object') {
    for (const key of Object.keys(optionalDeps)) {
      if (!key.startsWith(OPTIONAL_DEP_PREFIX)) continue;
      const previousValue = optionalDeps[key];
      optionalDeps[key] = rootVersion;
      process.stdout.write(`    ${key}: ${previousValue} -> ${rootVersion}\n`);
    }
  }

  const nextRootRaw = stringifyJson(rootPkg2);
  if (nextRootRaw !== rootRaw) {
    writeFileSync(rootPkgPath, nextRootRaw);
  }
}

main();
