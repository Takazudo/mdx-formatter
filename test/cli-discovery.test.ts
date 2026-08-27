import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCli } from './test-helpers.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mdx-cli-gitignore-'));
}

async function writeFile(root: string, relativePath: string, content = '# Title\n'): Promise<void> {
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

describe('CLI gitignore discovery', () => {
  it('skips the nested #140 repro by default and restores it with --no-gitignore', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'docs/.gitignore', 'generated/\n');
    await writeFile(
      cwd,
      'docs/generated/page.mdx',
      '# Generated\nBody without the required blank line\n',
    );

    const ignored = await runCli(['--check'], { cwd });
    const included = await runCli(['--check', '--no-gitignore'], { cwd });

    expect(ignored.code).toBe(0);
    expect(ignored.stdout).not.toContain('docs/generated/page.mdx');
    expect(included.code).toBe(1);
    expect(included.stdout).toContain('docs/generated/page.mdx');
  }, 30_000);

  it('keeps explicit paths exempt from automatic gitignore', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', 'generated/\n');
    await writeFile(cwd, 'generated/page.mdx');

    const result = await runCli(['--check', 'generated/page.mdx'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Processing 1 file(s)...');
  }, 30_000);

  it('applies repeatable --ignore-path files in order to explicit paths', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.first-ignore', '*.md\n');
    await writeFile(cwd, '.second-ignore', '!keep.md\n');
    await writeFile(cwd, 'keep.md');

    const included = await runCli(
      ['--check', 'keep.md', '--ignore-path', '.first-ignore', '--ignore-path', '.second-ignore'],
      { cwd },
    );
    const excluded = await runCli(['--check', 'keep.md', '--ignore-path', '.first-ignore'], {
      cwd,
    });

    expect(included.code).toBe(0);
    expect(included.stdout).toContain('Processing 1 file(s)...');
    expect(excluded.code).toBe(0);
    expect(excluded.stdout).toContain('All matching files were excluded');
  }, 30_000);

  it('keeps --ignore-path active when --no-gitignore disables automatic files', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', 'keep.md\n');
    await writeFile(cwd, '.caller-ignore', 'drop.md\n');
    await writeFile(cwd, 'keep.md');
    await writeFile(cwd, 'drop.md');

    const result = await runCli(
      ['--check', '*.md', '--no-gitignore', '--ignore-path', '.caller-ignore'],
      { cwd },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Processing 1 file(s)...');
    expect(result.stdout).toContain('keep.md');
    expect(result.stdout).not.toContain('drop.md');
  }, 30_000);

  it('reports a missing --ignore-path as a hard error', async () => {
    const cwd = await makeTempDir();

    const result = await runCli(['--check', '--ignore-path', 'missing.ignore'], { cwd });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Cannot read ignore file 'missing.ignore'");
  }, 30_000);

  it('documents the default gitignore behavior and its opt-out in help', async () => {
    const result = await runCli(['--help']);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('--ignore-path <file>');
    expect(result.stdout).toContain('--no-gitignore');
    expect(result.stdout).toMatch(/enabled by\s+default/);
  }, 30_000);
});
