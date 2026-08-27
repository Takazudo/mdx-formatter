import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { escape, glob, hasMagic } from 'glob';

export interface DiscoveryResult {
  files: string[];
  anyMatchedBeforeFilter: boolean;
  badOperands: Array<{ operand: string; reason: 'missing' | 'directory' }>;
}

export interface DiscoverOptions {
  cliIgnorePatterns: string[];
  excludePatterns: string[];
  cwd?: string;
}

export interface ClassifiedOperands {
  explicitPaths: string[];
  globPatterns: string[];
  badOperands: Array<{ operand: string; reason: 'missing' | 'directory' }>;
}

/** Treat both slash styles as separators, regardless of the host platform. */
export function normalizeOperand(operand: string): string {
  return operand.replaceAll('\\', '/');
}

export function classifyOperands(operands: string[], cwd = process.cwd()): ClassifiedOperands {
  const explicitPaths: string[] = [];
  const globPatterns: string[] = [];
  const badOperands: ClassifiedOperands['badOperands'] = [];

  for (const operand of operands) {
    const normalized = normalizeOperand(operand);
    try {
      const stats = statSync(resolve(cwd, normalized));
      if (stats.isFile()) {
        explicitPaths.push(operand);
      } else if (stats.isDirectory()) {
        badOperands.push({ operand, reason: 'directory' });
      } else {
        badOperands.push({ operand, reason: 'missing' });
      }
    } catch {
      if (hasMagic(normalized, { magicalBraces: true })) {
        globPatterns.push(operand);
      } else {
        badOperands.push({ operand, reason: 'missing' });
      }
    }
  }

  return { explicitPaths, globPatterns, badOperands };
}

async function explicitPathIsIncluded(
  operand: string,
  cwd: string,
  cliIgnorePatterns: string[],
): Promise<boolean> {
  if (cliIgnorePatterns.length === 0) return true;

  const absolutePath = resolve(cwd, normalizeOperand(operand));
  const matches = await glob(escape(absolutePath), {
    cwd,
    ignore: cliIgnorePatterns,
    nodir: true,
  });
  return matches.length > 0;
}

export async function discoverFiles(
  operands: string[],
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const cwd = options.cwd ?? process.cwd();
  const { explicitPaths, globPatterns, badOperands } = classifyOperands(operands, cwd);
  const filesByAbsolutePath = new Map<string, string>();
  let anyMatchedBeforeFilter = explicitPaths.length > 0;

  // Seed explicit paths first so their spelling and filter-bypass semantics win
  // when a later glob resolves to the same file.
  for (const operand of explicitPaths) {
    if (await explicitPathIsIncluded(operand, cwd, options.cliIgnorePatterns)) {
      filesByAbsolutePath.set(resolve(cwd, normalizeOperand(operand)), operand);
    }
  }

  const globIgnorePatterns = [
    ...new Set([...options.cliIgnorePatterns, ...options.excludePatterns]),
  ];
  for (const originalPattern of globPatterns) {
    const pattern = normalizeOperand(originalPattern);
    const matches = await glob(pattern, {
      cwd,
      ignore: globIgnorePatterns,
      nodir: true,
    });

    if (matches.length > 0) {
      anyMatchedBeforeFilter = true;
    } else if (globIgnorePatterns.length > 0) {
      // D4 needs only the existence of a pre-filter match, never an exact
      // count. The follow-up gitignore work replaces this fallback with its
      // pruning-aware ignore callbacks.
      const unfilteredMatches = await glob(pattern, { cwd, nodir: true });
      anyMatchedBeforeFilter ||= unfilteredMatches.length > 0;
    }

    for (const match of matches) {
      const absolutePath = resolve(cwd, normalizeOperand(match));
      if (!filesByAbsolutePath.has(absolutePath)) {
        filesByAbsolutePath.set(absolutePath, match);
      }
    }
  }

  return {
    files: [...filesByAbsolutePath.values()],
    anyMatchedBeforeFilter,
    badOperands,
  };
}
