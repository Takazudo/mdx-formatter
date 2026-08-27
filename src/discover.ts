import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { escape, glob, globIterate, hasMagic, Ignore as GlobIgnore } from 'glob';
import ignore, { type Ignore } from 'ignore';

export interface DiscoveryResult {
  files: string[];
  anyMatchedBeforeFilter: boolean;
  badOperands: Array<{ operand: string; reason: 'missing' | 'directory' }>;
}

export interface DiscoverOptions {
  cliIgnorePatterns: string[];
  excludePatterns: string[];
  ignorePaths?: string[];
  useGitignore?: boolean;
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
  suppliedIgnoreFiles: CompiledIgnoreFile[],
): Promise<boolean> {
  const absolutePath = resolve(cwd, normalizeOperand(operand));
  if (cliIgnorePatterns.length > 0) {
    const matches = await glob(escape(absolutePath), {
      cwd,
      ignore: cliIgnorePatterns,
      nodir: true,
    });
    if (matches.length === 0) return false;
  }

  return !ignoreFilesDecision(absolutePath, false, suppliedIgnoreFiles);
}

interface CompiledIgnoreFile {
  directory: string;
  matcher: Ignore;
}

interface GlobPath {
  fullpath(): string;
  isDirectory(): boolean;
}

function pathRelativeTo(directory: string, absolutePath: string): string | undefined {
  const result = relative(directory, absolutePath);
  if (result === '' || result === '..' || result.startsWith(`..${sep}`) || isAbsolute(result)) {
    return undefined;
  }
  return normalizeOperand(result);
}

function testIgnoreFile(
  absolutePath: string,
  isDirectory: boolean,
  compiled: CompiledIgnoreFile,
): boolean | undefined {
  const relativePath = pathRelativeTo(compiled.directory, absolutePath);
  if (relativePath === undefined) return undefined;

  const result = compiled.matcher.test(isDirectory ? `${relativePath}/` : relativePath);
  if (result.ignored) return true;
  if (result.unignored) return false;
  return undefined;
}

/** Evaluate files in the supplied order, retaining the last matching decision. */
function ignoreFilesDecision(
  absolutePath: string,
  isDirectory: boolean,
  compiledFiles: CompiledIgnoreFile[],
): boolean {
  let ignored = false;
  for (const compiled of compiledFiles) {
    const decision = testIgnoreFile(absolutePath, isDirectory, compiled);
    if (decision !== undefined) ignored = decision;
  }
  return ignored;
}

function loadSuppliedIgnoreFiles(paths: string[], cwd: string): CompiledIgnoreFile[] {
  return paths.map((file) => {
    const absolutePath = resolve(cwd, normalizeOperand(file));
    let rules: string;
    try {
      rules = readFileSync(absolutePath, 'utf-8');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Cannot read ignore file '${file}': ${detail}`);
    }
    return {
      directory: dirname(absolutePath),
      matcher: ignore({ ignorecase: false }).add(rules),
    };
  });
}

function createAutoGitignoreLoader(): (directory: string) => CompiledIgnoreFile | null {
  const cache = new Map<string, CompiledIgnoreFile | null>();
  return (directory) => {
    const absoluteDirectory = resolve(directory);
    const cached = cache.get(absoluteDirectory);
    if (cached !== undefined) return cached;

    try {
      const rules = readFileSync(resolve(absoluteDirectory, '.gitignore'), 'utf-8');
      const compiled = {
        directory: absoluteDirectory,
        matcher: ignore({ ignorecase: false }).add(rules),
      };
      cache.set(absoluteDirectory, compiled);
      return compiled;
    } catch {
      cache.set(absoluteDirectory, null);
      return null;
    }
  };
}

function ancestorDirectories(cwd: string, leafDirectory: string): string[] {
  const relativeLeaf = relative(cwd, leafDirectory);
  if (relativeLeaf === '..' || relativeLeaf.startsWith(`..${sep}`) || isAbsolute(relativeLeaf)) {
    return [];
  }

  const directories = [cwd];
  if (relativeLeaf === '') return directories;
  let current = cwd;
  for (const part of relativeLeaf.split(sep)) {
    current = resolve(current, part);
    directories.push(current);
  }
  return directories;
}

export async function discoverFiles(
  operands: string[],
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const cwd = options.cwd ?? process.cwd();
  const { explicitPaths, globPatterns, badOperands } = classifyOperands(operands, cwd);
  const suppliedIgnoreFiles = loadSuppliedIgnoreFiles(options.ignorePaths ?? [], cwd);
  const loadAutoGitignore = createAutoGitignoreLoader();
  const filesByAbsolutePath = new Map<string, string>();
  let anyMatchedBeforeFilter = explicitPaths.length > 0;

  // Seed explicit paths first so their spelling and filter-bypass semantics win
  // when a later glob resolves to the same file.
  for (const operand of explicitPaths) {
    if (
      await explicitPathIsIncluded(operand, cwd, options.cliIgnorePatterns, suppliedIgnoreFiles)
    ) {
      filesByAbsolutePath.set(resolve(cwd, normalizeOperand(operand)), operand);
    }
  }

  const hardIgnore = new GlobIgnore(
    [...new Set([...options.cliIgnorePatterns, ...options.excludePatterns])],
    {},
  );
  const gitignoreEnabled = options.useGitignore ?? true;
  for (const originalPattern of globPatterns) {
    const pattern = normalizeOperand(originalPattern);
    let filteredDuringWalk = false;
    const ignoredByGitRules = (path: GlobPath): boolean => {
      const absolutePath = path.fullpath();
      const directory = path.isDirectory();
      let ignored = false;

      if (gitignoreEnabled) {
        for (const ancestor of ancestorDirectories(cwd, dirname(absolutePath))) {
          const compiled = loadAutoGitignore(ancestor);
          if (compiled === null) continue;
          const decision = testIgnoreFile(absolutePath, directory, compiled);
          if (decision !== undefined) ignored = decision;
        }
      }

      for (const compiled of suppliedIgnoreFiles) {
        const decision = testIgnoreFile(absolutePath, directory, compiled);
        if (decision !== undefined) ignored = decision;
      }
      return ignored;
    };
    const ignoreCallbacks = {
      ignored(path: GlobPath): boolean {
        const result =
          hardIgnore.ignored(path as Parameters<typeof hardIgnore.ignored>[0]) ||
          ignoredByGitRules(path);
        filteredDuringWalk ||= result;
        return result;
      },
      childrenIgnored(path: GlobPath): boolean {
        const result =
          hardIgnore.childrenIgnored(path as Parameters<typeof hardIgnore.childrenIgnored>[0]) ||
          ignoredByGitRules(path);
        filteredDuringWalk ||= result;
        return result;
      },
    };
    const matches = await glob(pattern, {
      cwd,
      ignore: ignoreCallbacks,
      nodir: true,
    });

    if (matches.length > 0) {
      anyMatchedBeforeFilter = true;
    } else if (filteredDuringWalk) {
      // A pruned directory does not tell us whether it contained a matching
      // file. Probe only in this zero-match case so an empty ignored directory
      // still reports "No files found" while a hidden candidate gets D4's
      // filtered message. This is an existence check, not a pre-filter count.
      for await (const firstMatch of globIterate(pattern, { cwd, nodir: true })) {
        void firstMatch;
        anyMatchedBeforeFilter = true;
        break;
      }
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
