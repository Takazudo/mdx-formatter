/**
 * Snapshot regression suite (issue #88).
 *
 * For every `test/fixtures/*.md` and `*.mdx`, run the formatter with
 * DEFAULT settings and assert the output is byte-identical to the committed
 * baseline under `test/snapshots/<same-name>`.
 *
 * Purpose: any future rule change that accidentally alters the formatter's
 * output for the existing fixture corpus is caught immediately. When a rule
 * change is intentional, regenerate the snapshots with
 * `npx tsx scripts/gen-fixture-outputs.ts`.
 *
 * Excludes `*.expected.md` — those are paired rule-targeted expected outputs
 * consumed by `formatter.test.ts`, not fixture inputs in their own right.
 */

import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const snapshotsDir = path.join(__dirname, 'snapshots');

async function listFixtureInputs(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(fixturesDir);
  } catch {
    return [];
  }
  return entries
    .filter((n) => (n.endsWith('.md') || n.endsWith('.mdx')) && !n.endsWith('.expected.md'))
    .sort();
}

describe('List Normalize Snapshot Regression Suite (issue #88)', () => {
  it('fixture corpus is non-empty', async () => {
    const inputs = await listFixtureInputs();
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('every fixture has a committed snapshot baseline', async () => {
    const inputs = await listFixtureInputs();
    const missing: string[] = [];
    for (const name of inputs) {
      try {
        await fs.access(path.join(snapshotsDir, name));
      } catch {
        missing.push(name);
      }
    }
    expect(missing, 'Regenerate via: npx tsx scripts/gen-fixture-outputs.ts').toEqual([]);
  });

  it('default-settings formatter output matches every snapshot', async () => {
    const inputs = await listFixtureInputs();
    for (const name of inputs) {
      const input = await fs.readFile(path.join(fixturesDir, name), 'utf-8');
      const snapshot = await fs.readFile(path.join(snapshotsDir, name), 'utf-8');
      const formatted = await format(input);
      expect(
        formatted,
        `snapshot mismatch for ${name} — regenerate via scripts/gen-fixture-outputs.ts if intentional`,
      ).toBe(snapshot);
    }
  });

  it('snapshots are idempotent under a second pass', async () => {
    // A second pass of the formatter over a committed snapshot must be a
    // no-op. This catches rules that converge only in two steps for real
    // content.
    const inputs = await listFixtureInputs();
    for (const name of inputs) {
      const snapshot = await fs.readFile(path.join(snapshotsDir, name), 'utf-8');
      const second = await format(snapshot);
      expect(second, `snapshot ${name} is not idempotent`).toBe(snapshot);
    }
  });
});
