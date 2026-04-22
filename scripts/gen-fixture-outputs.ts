#!/usr/bin/env tsx
/**
 * Generate expected-output files and snapshot baselines for the
 * list-normalize fixture corpus.
 *
 * Run with: `npx tsx scripts/gen-fixture-outputs.ts`
 *
 * - For every `test/fixtures/*.md` and `*.mdx`, run `format` with default
 *   settings and write the result to `test/snapshots/<same-name>`.
 * - For the rule-targeted fixtures, also write a paired `*.expected.md` with
 *   output under a specific settings profile (so the integration tests can
 *   assert byte-equality with a human-readable expected file).
 * - For `baseline-loose-list-preserved.md`, the "expected" is byte-identical
 *   to the input with rules OFF — that assertion lives in the test itself,
 *   so this script just emits the default-settings snapshot.
 *
 * The script is safe to re-run; it overwrites the generated files.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeepPartial } from '../src/types.js';
import type { FormatterSettings } from '../src/types.js';
import { format } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const fixturesDir = path.join(repoRoot, 'test', 'fixtures');
const snapshotsDir = path.join(repoRoot, 'test', 'snapshots');

// Settings profile for each rule-targeted fixture's `.expected.md`.
// Default settings are used for every other fixture (snapshots only).
type Profile = DeepPartial<FormatterSettings> & Record<string, unknown>;
const expectedProfiles: Record<string, Profile> = {
  // defaults fire tighten=heuristic
  'tighten-continuations.md': {},
  // defaults fire recover-escaped-code-in-lists=safe
  'recover-escaped-code.md': {},
  // defaults fire recover-escaped-tables-in-lists=safe
  'recover-escaped-tables.md': {},
  // default is off — opt into heuristic for this fixture
  'recover-escaped-paragraphs.md': {
    'recover-escaped-paragraphs-in-lists': 'heuristic',
  },
};

async function main(): Promise<void> {
  await fs.mkdir(snapshotsDir, { recursive: true });
  const entries = await fs.readdir(fixturesDir);
  const inputs = entries
    .filter((n) => (n.endsWith('.md') || n.endsWith('.mdx')) && !n.endsWith('.expected.md'))
    .sort();

  for (const name of inputs) {
    const inputPath = path.join(fixturesDir, name);
    const input = await fs.readFile(inputPath, 'utf-8');

    // Snapshot: default settings always.
    const snapshot = await format(input);
    const snapPath = path.join(snapshotsDir, name);
    await fs.writeFile(snapPath, snapshot, 'utf-8');
    console.log(`snapshot:  ${path.relative(repoRoot, snapPath)}`);

    // Expected: only for rule-targeted fixtures.
    const profile = expectedProfiles[name];
    if (profile !== undefined) {
      const expected = await format(input, { settings: profile });
      const expPath = path.join(fixturesDir, name.replace(/\.md$/, '.expected.md'));
      await fs.writeFile(expPath, expected, 'utf-8');
      console.log(`expected:  ${path.relative(repoRoot, expPath)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
