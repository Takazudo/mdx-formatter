import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyOperands, discoverFiles } from '../src/discover.js';
import { runCli } from './test-helpers.js';

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mdx-discover-'));
}

async function writeFile(root: string, relativePath: string, content = '# Title\n'): Promise<void> {
  const file = path.join(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf-8');
}

describe('classifyOperands', () => {
  it('stats operands before checking glob magic and reports every bad operand', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'plain.md');
    await writeFile(cwd, 'a[1].md');
    await writeFile(cwd, '.claude/skills/x/SKILL.md');
    await fs.mkdir(path.join(cwd, 'docs'));
    await fs.symlink('plain.md', path.join(cwd, 'linked.md'));
    await fs.symlink('absent.md', path.join(cwd, 'dangling.md'));

    const result = classifyOperands(
      [
        'plain.md',
        'a[1].md',
        'a{b,c}.md',
        '**/*.md',
        'docs',
        'nope.md',
        'linked.md',
        'dangling.md',
        '.claude/skills/x/SKILL.md',
      ],
      cwd,
    );

    expect(result.explicitPaths).toEqual([
      'plain.md',
      'a[1].md',
      'linked.md',
      '.claude/skills/x/SKILL.md',
    ]);
    expect(result.globPatterns).toEqual(['a{b,c}.md', '**/*.md']);
    expect(result.badOperands).toEqual([
      { operand: 'docs', reason: 'directory' },
      { operand: 'nope.md', reason: 'missing' },
      { operand: 'dangling.md', reason: 'missing' },
    ]);
  });

  it('accepts Windows separators while preserving the operand spelling', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'nested/file.md');
    const operand = 'nested\\file.md';

    expect(classifyOperands([operand], cwd).explicitPaths).toEqual([operand]);
  });
});

describe('discoverFiles', () => {
  const baseOptions = { cliIgnorePatterns: [], excludePatterns: [] };

  it('lets explicit paths bypass config exclude and gives them dedupe precedence', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'foo.md');

    const result = await discoverFiles(['foo.md', '*.md'], {
      cwd,
      cliIgnorePatterns: [],
      excludePatterns: ['foo.md'],
    });

    expect(result.files).toEqual(['foo.md']);
    expect(result.anyMatchedBeforeFilter).toBe(true);
    expect(result.badOperands).toEqual([]);
  });

  it.each([
    ['foo.md', 'foo.md'],
    ['tests/foo.md', 'tests/**'],
  ])('applies CLI ignore to explicit path %s with %s', async (operand, ignorePattern) => {
    const cwd = await makeTempDir();
    await writeFile(cwd, operand);

    const result = await discoverFiles([operand], {
      cwd,
      cliIgnorePatterns: [ignorePattern],
      excludePatterns: [],
    });

    expect(result.files).toEqual([]);
    expect(result.anyMatchedBeforeFilter).toBe(true);
  });

  it('distinguishes an excluded glob match from a glob with no matches', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'tests/foo.md');
    const options = {
      cwd,
      cliIgnorePatterns: [],
      excludePatterns: ['tests/**'],
    };

    const excluded = await discoverFiles(['tests/**/*.md'], options);
    const unmatched = await discoverFiles(['missing/**/*.md'], options);

    expect(excluded.files).toEqual([]);
    expect(excluded.anyMatchedBeforeFilter).toBe(true);
    expect(unmatched.files).toEqual([]);
    expect(unmatched.anyMatchedBeforeFilter).toBe(false);
  });

  it('does not treat an empty ignored directory as a filtered match', async () => {
    const cwd = await makeTempDir();
    await fs.mkdir(path.join(cwd, 'build'));

    const result = await discoverFiles(['**/*.md'], {
      cwd,
      cliIgnorePatterns: ['build/**'],
      excludePatterns: [],
    });

    expect(result.files).toEqual([]);
    expect(result.anyMatchedBeforeFilter).toBe(false);
  });

  it('preserves Windows spelling for an explicit result', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'nested/file.md');
    const operand = 'nested\\file.md';

    const result = await discoverFiles([operand], {
      cwd,
      cliIgnorePatterns: [],
      excludePatterns: [],
    });

    expect(result.files).toEqual([operand]);
  });

  it('honors root and nested gitignore files using each file as its anchor', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', '/root-only.md\n');
    await writeFile(cwd, 'docs/.gitignore', 'generated/\n');
    await writeFile(cwd, 'root-only.md');
    await writeFile(cwd, 'docs/root-only.md');
    await writeFile(cwd, 'docs/generated/page.mdx');
    await writeFile(cwd, 'generated/page.mdx');

    const result = await discoverFiles(['**/*.{md,mdx}'], { cwd, ...baseOptions });

    expect(result.files.sort()).toEqual(['docs/root-only.md', 'generated/page.mdx']);
  });

  it('lets deeper gitignore decisions override shallower decisions', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', '*.md\n');
    await writeFile(cwd, 'docs/.gitignore', '!keep.md\n');
    await writeFile(cwd, 'root.md');
    await writeFile(cwd, 'docs/drop.md');
    await writeFile(cwd, 'docs/keep.md');

    const result = await discoverFiles(['**/*.md'], { cwd, ...baseOptions });

    expect(result.files).toEqual(['docs/keep.md']);
  });

  it('uses valid git negation semantics to re-include a child', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', 'generated/*\n!generated/keep.md\n');
    await writeFile(cwd, 'generated/drop.md');
    await writeFile(cwd, 'generated/keep.md');

    const result = await discoverFiles(['**/*.md'], { cwd, ...baseOptions });

    expect(result.files).toEqual(['generated/keep.md']);
  });

  it('does not consult gitignore files above cwd', async () => {
    const parent = await makeTempDir();
    const cwd = path.join(parent, 'project');
    await writeFile(parent, '.gitignore', '*.md\n');
    await writeFile(parent, 'project/keep.md');

    const result = await discoverFiles(['**/*.md'], { cwd, ...baseOptions });

    expect(result.files).toEqual(['keep.md']);
  });

  it('lets explicit paths bypass automatic gitignore but not supplied ignore files', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', 'generated/\n');
    await writeFile(cwd, '.caller-ignore', 'generated/keep.md\n');
    await writeFile(cwd, 'generated/keep.md');

    const automatic = await discoverFiles(['generated/keep.md'], { cwd, ...baseOptions });
    const supplied = await discoverFiles(['generated/keep.md'], {
      cwd,
      ...baseOptions,
      ignorePaths: ['.caller-ignore'],
    });

    expect(automatic.files).toEqual(['generated/keep.md']);
    expect(supplied.files).toEqual([]);
  });

  it('anchors supplied ignore files and lets later files override earlier ones', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'docs/.first-ignore', 'generated/*\n');
    await writeFile(cwd, 'docs/.second-ignore', '!generated/keep.md\n');
    await writeFile(cwd, 'docs/generated/drop.md');
    await writeFile(cwd, 'docs/generated/keep.md');
    await writeFile(cwd, 'generated/drop.md');

    const result = await discoverFiles(['**/*.md'], {
      cwd,
      ...baseOptions,
      ignorePaths: ['docs/.first-ignore', 'docs/.second-ignore'],
    });

    expect(result.files.sort()).toEqual(['docs/generated/keep.md', 'generated/drop.md']);
  });

  it('can disable automatic gitignore discovery', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', 'generated/\n');
    await writeFile(cwd, 'generated/page.mdx');

    const result = await discoverFiles(['**/*.mdx'], {
      cwd,
      ...baseOptions,
      useGitignore: false,
    });

    expect(result.files).toEqual(['generated/page.mdx']);
  });

  it('prunes a directory ignored with directory-form gitignore syntax', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, '.gitignore', 'generated/\n');
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        writeFile(cwd, `generated/level-${index}/page-${index}.md`),
      ),
    );
    await writeFile(cwd, 'keep.md');

    const result = await discoverFiles(['**/*.md'], { cwd, ...baseOptions });

    expect(result.files).toEqual(['keep.md']);
    expect(result.anyMatchedBeforeFilter).toBe(true);
  });
});

describe('CLI discovery', () => {
  it.each([
    ['.claude/skills/example/SKILL.md', '.claude/**'],
    ['tests/foo.md', 'tests/**'],
  ])(
    'checks explicit %s despite config exclude',
    async (operand, exclude) => {
      const cwd = await makeTempDir();
      await writeFile(cwd, operand);
      await writeFile(cwd, '.mdx-formatter.json', JSON.stringify({ exclude }));

      const result = await runCli(['--check', operand], { cwd });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Processing 1 file(s)...');
      expect(result.stdout).toContain(operand);
      expect(result.stdout).not.toContain('No files found');
    },
    30_000,
  );

  it('keeps explicit discovery unchanged with an empty exclude', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'foo.md');
    await writeFile(cwd, '.mdx-formatter.json', JSON.stringify({ exclude: [] }));

    const result = await runCli(['--check', 'foo.md'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Processing 1 file(s)...');
  }, 30_000);

  it('gives --write explicit paths the config-exclude bypass', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'foo.md');
    await writeFile(cwd, '.mdx-formatter.json', JSON.stringify({ exclude: ['foo.md'] }));

    const result = await runCli(['--write', 'foo.md'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Processing 1 file(s)...');
  }, 30_000);

  it('keeps CLI ignore authoritative for explicit paths', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'foo.md');

    const result = await runCli(['--check', 'foo.md', '--ignore', 'foo.md'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'All matching files were excluded by ignore/exclude patterns — 0 files to process.',
    );
  }, 30_000);

  it('reports when config exclude filters every glob match', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'tests/foo.md');
    await writeFile(cwd, '.mdx-formatter.json', JSON.stringify({ exclude: ['tests/**'] }));

    const result = await runCli(['--check', 'tests/**/*.md'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      'All matching files were excluded by ignore/exclude patterns — 0 files to process.',
    );
  }, 30_000);

  it('writes the excluded-zero message only to stderr in dry-run mode', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'tests/foo.md');
    await writeFile(cwd, '.mdx-formatter.json', JSON.stringify({ exclude: ['tests/**'] }));

    const result = await runCli(['--dry-run', 'tests/**/*.md'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(
      'All matching files were excluded by ignore/exclude patterns — 0 files to process.',
    );
  }, 30_000);

  it('reports no matches separately', async () => {
    const cwd = await makeTempDir();

    const result = await runCli(['--check', 'missing/**/*.md'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('No files found matching the patterns.');
  }, 30_000);

  it('applies default patterns only when no operands were supplied', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'default.md');

    const result = await runCli(['--check'], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Processing 1 file(s)...');
    expect(result.stdout).toContain('default.md');
  }, 30_000);

  it('reports all bad operands and never processes the valid subset', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'valid.md');
    await fs.mkdir(path.join(cwd, 'docs'));

    const result = await runCli(['--check', 'valid.md', 'nope.md', 'docs'], { cwd });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('nope.md: no such file');
    expect(result.stderr).toContain(
      "docs: is a directory (pass a glob such as 'docs/**/*.md' to format its contents)",
    );
    expect(result.stdout).not.toContain('Processing');
  }, 30_000);

  it('treats bad dry-run operands as usage errors', async () => {
    const cwd = await makeTempDir();

    const result = await runCli(['--dry-run', 'nope.md'], { cwd });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('nope.md: no such file');
  }, 30_000);

  it('processes Windows-separated explicit paths and preserves their output spelling', async () => {
    const cwd = await makeTempDir();
    await writeFile(cwd, 'nested/file.md');
    const operand = 'nested\\file.md';

    const result = await runCli(['--check', operand], { cwd });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(operand);
  }, 30_000);
});
