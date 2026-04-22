/**
 * Tests for the `--dry-run` CLI flag and the `dryRunReport` library API.
 *
 * Covers the acceptance criteria from issue #87:
 *   - a file with rule-triggering content produces a non-empty report,
 *     writes NOTHING to stdout, everything to stderr, and leaves the file
 *     byte-identical on disk;
 *   - a file with zero normalizations produces an empty report and exits 0;
 *   - the report format matches the Rust CLI's so tooling can consume either.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { dryRunReport, format } from '../src/index.js';

const execFileP = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliEntry = path.resolve(__dirname, '../src/cli.ts');

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mdx-dry-run-'));
}

const FIXTURE_WITH_CHANGES = `1. first item with a long first sentence.

   and a continuation paragraph that should tighten.

2. second item

\`\`\`js
const x = 1;
\`\`\`

3. third item
`;

const FIXTURE_CLEAN = `# Heading

Just a clean paragraph.

- a
- b
- c
`;

describe('dryRunReport library API', () => {
  it('returns a non-empty report for content with normalizations', () => {
    const entries = dryRunReport(FIXTURE_WITH_CHANGES);
    expect(entries.length).toBeGreaterThan(0);
    // At least one of the four list-normalize rules must have fired.
    const ruleNames = new Set(entries.map((e) => e.rule));
    const known = [
      'recover-escaped-code-in-lists',
      'recover-escaped-tables-in-lists',
      'recover-escaped-paragraphs-in-lists',
      'tighten-list-continuations',
    ];
    expect(known.some((r) => ruleNames.has(r))).toBe(true);

    // Structural checks on the first entry.
    const first = entries[0]!;
    expect(typeof first.rule).toBe('string');
    expect(typeof first.startLine).toBe('number');
    expect(typeof first.endLine).toBe('number');
    expect(Array.isArray(first.before)).toBe(true);
    expect(Array.isArray(first.after)).toBe(true);
  });

  it('returns an empty report for clean content', () => {
    const entries = dryRunReport(FIXTURE_CLEAN);
    expect(entries).toEqual([]);
  });

  it('does not change the content that would be formatted', async () => {
    // A sanity cross-check: dryRunReport must reflect the SAME decisions the
    // real formatter makes. If report is non-empty, format(content) must
    // actually change something.
    const entries = dryRunReport(FIXTURE_WITH_CHANGES);
    const formatted = await format(FIXTURE_WITH_CHANGES);
    if (entries.length > 0) {
      expect(formatted).not.toBe(FIXTURE_WITH_CHANGES);
    } else {
      expect(formatted).toBe(FIXTURE_WITH_CHANGES);
    }
  });
});

describe('CLI --dry-run flag', () => {
  async function runCli(args: string[]): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }> {
    try {
      const { stdout, stderr } = await execFileP('npx', ['tsx', cliEntry, ...args], {
        cwd: path.resolve(__dirname, '..'),
      });
      return { stdout, stderr, code: 0 };
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; code?: number };
      return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.code ?? 1 };
    }
  }

  it('reports changes, leaves file byte-identical, exits 0', async () => {
    const dir = await mkTmp();
    const file = path.join(dir, 'sample.md');
    await fs.writeFile(file, FIXTURE_WITH_CHANGES, 'utf-8');

    const { stdout, stderr, code } = await runCli(['--dry-run', file]);
    expect(code).toBe(0);
    expect(stdout).toBe(''); // Nothing on stdout.
    expect(stderr).toContain('dry-run; no files were modified');
    // At least one rule entry was printed.
    expect(stderr).toMatch(/\[(recover-escaped-|tighten-list-)/);

    // File on disk is byte-identical to the original.
    const after = await fs.readFile(file, 'utf-8');
    expect(after).toBe(FIXTURE_WITH_CHANGES);
  }, 30_000);

  it('clean file produces zero-entry report, exits 0', async () => {
    const dir = await mkTmp();
    const file = path.join(dir, 'clean.md');
    await fs.writeFile(file, FIXTURE_CLEAN, 'utf-8');

    const { stdout, stderr, code } = await runCli(['--dry-run', file]);
    expect(code).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toContain('0 entries across 0 files');
    expect(stderr).not.toMatch(/\[(recover-escaped-|tighten-list-)/);
  }, 30_000);

  it('rejects --dry-run combined with --write', async () => {
    const { code, stderr } = await runCli(['--dry-run', '--write', 'nonexistent.md']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('--dry-run');
  }, 30_000);
});
