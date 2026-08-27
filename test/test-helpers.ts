/**
 * Test helpers for mdx-formatter tests
 *
 * Provides the old project-specific settings that tests were written against.
 * The library now ships with empty component arrays by default, but tests
 * need the original component names to verify behavior.
 */

import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { DeepPartial, FormatterSettings } from '../src/types.js';

const execFileP = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxEntry = fileURLToPath(import.meta.resolve('tsx/cli'));
const cliEntry = path.resolve(repoRoot, 'src/cli.ts');

export async function runCli(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  try {
    const { stdout, stderr } = await execFileP(process.execPath, [tsxEntry, cliEntry, ...args], {
      cwd: options.cwd ?? repoRoot,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      code: result.code ?? 1,
    };
  }
}

export const testSettings: DeepPartial<FormatterSettings> = {
  addEmptyLinesInBlockJsx: {
    blockComponents: ['Outro', 'InfoBox', 'LayoutDivideItem', 'Column'],
  },
  indentJsxContent: {
    containerComponents: ['Outro', 'InfoBox', 'LayoutDivide', 'LayoutDivideItem', 'Column'],
  },
  formatMultiLineJsx: {
    ignoreComponents: ['CodeBlock'],
  },
};
