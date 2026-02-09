import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve } from 'path';
import { loadExcludePatterns, loadConfig } from '../src/load-config.js';

describe('loadExcludePatterns', () => {
  const tempConfigPath = resolve('__test-config.json');

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  it('should return empty array when no config file exists', () => {
    const result = loadExcludePatterns('/nonexistent/path/.mdx-formatter.json');
    expect(result).toEqual([]);
  });

  it('should return exclude patterns from config file', () => {
    const config = {
      exclude: ['doc/docs/claude/**', 'generated/**/*.md'],
      formatMultiLineJsx: { enabled: true },
    };
    writeFileSync(tempConfigPath, JSON.stringify(config));
    const result = loadExcludePatterns(tempConfigPath);
    expect(result).toEqual(['doc/docs/claude/**', 'generated/**/*.md']);
  });

  it('should return empty array when config has no exclude key', () => {
    const config = {
      formatMultiLineJsx: { enabled: true },
    };
    writeFileSync(tempConfigPath, JSON.stringify(config));
    const result = loadExcludePatterns(tempConfigPath);
    expect(result).toEqual([]);
  });

  it('should return empty array when exclude is not an array', () => {
    const config = {
      exclude: 'not-an-array',
    };
    writeFileSync(tempConfigPath, JSON.stringify(config));
    const result = loadExcludePatterns(tempConfigPath);
    expect(result).toEqual([]);
  });

  it('should filter out non-string values from exclude array', () => {
    const config = {
      exclude: ['valid/**', 123, null, 'also-valid/**'],
    };
    writeFileSync(tempConfigPath, JSON.stringify(config));
    const result = loadExcludePatterns(tempConfigPath);
    expect(result).toEqual(['valid/**', 'also-valid/**']);
  });
});

describe('loadConfig', () => {
  const tempConfigPath = resolve('__test-config.json');

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
  });

  it('should not include exclude in formatter settings', () => {
    const config = {
      exclude: ['generated/**'],
      formatMultiLineJsx: { ignoreComponents: ['CodeBlock'] },
    };
    writeFileSync(tempConfigPath, JSON.stringify(config));
    const settings = loadConfig({ config: tempConfigPath });
    expect(settings).not.toHaveProperty('exclude');
    expect(settings.formatMultiLineJsx.ignoreComponents).toEqual(['CodeBlock']);
  });
});
