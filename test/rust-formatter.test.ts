import { describe, it, expect } from 'vitest';
import { format } from '../src/index.js';
import { testSettings } from './test-helpers.js';

describe('Rust Formatter - Basic Markdown', () => {
  it('should format headings with proper spacing', async () => {
    const input = '# Heading\nContent';
    const expected = '# Heading\n\nContent';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(expected);
  });

  it('should preserve code blocks', async () => {
    const input = '```js\nconst x = 1;\n```';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should handle frontmatter', async () => {
    const input = '---\ntitle: Test\n---\n\n# Content';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should add spacing between heading and paragraph', async () => {
    const input = '# Title\nParagraph text\n## Subtitle\nMore text';
    const expected = '# Title\n\nParagraph text\n\n## Subtitle\n\nMore text';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(expected);
  });

  it('should not add extra spacing when already present', async () => {
    const input = '# Title\n\nParagraph text\n\n## Subtitle\n\nMore text';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should handle empty input', async () => {
    const input = '';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe('');
  });

  it('should preserve paragraph breaks', async () => {
    const input = 'Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });
});

describe('Rust Formatter - Idempotency', () => {
  it('should be idempotent for simple content', async () => {
    const input = '# Heading\n\nSome content\n\n## Another\n\nMore content';
    const first = await format(input, { settings: testSettings });
    const second = await format(first, { settings: testSettings });
    expect(first).toBe(second);
  });

  it('should be idempotent after formatting', async () => {
    const input = '# Heading\nContent\n## Sub\nMore';
    const first = await format(input, { settings: testSettings });
    const second = await format(first, { settings: testSettings });
    expect(first).toBe(second);
  });

  it('should be idempotent for content with frontmatter', async () => {
    const input = '---\ntitle: Test\n---\n\n# Heading\nContent';
    const first = await format(input, { settings: testSettings });
    const second = await format(first, { settings: testSettings });
    expect(first).toBe(second);
  });

  it('should be idempotent for content with code blocks', async () => {
    const input = '# Title\n```js\nconst x = 1;\n```\nParagraph';
    const first = await format(input, { settings: testSettings });
    const second = await format(first, { settings: testSettings });
    expect(first).toBe(second);
  });
});

describe('Rust Formatter - Lists', () => {
  it('should preserve list content', async () => {
    const input = '- Item 1\n- Item 2\n- Item 3';
    const result = await format(input, { settings: testSettings });
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
    expect(result).toContain('Item 3');
  });

  it('should format lists without leading spaces', async () => {
    const input = '  - First item\n  - Second item\n  - Third item';
    const expected = '- First item\n- Second item\n- Third item';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(expected);
  });

  it('should preserve nested list indentation correctly', async () => {
    const input = '  - Parent item\n    - Nested item 1\n    - Nested item 2\n  - Another parent';
    const expected = '- Parent item\n  - Nested item 1\n  - Nested item 2\n- Another parent';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(expected);
  });

  it('should handle numbered lists without leading spaces', async () => {
    const input = '  1. First item\n  2. Second item\n  3. Third item';
    const expected = '1. First item\n2. Second item\n3. Third item';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(expected);
  });
});

describe('Rust Formatter - MDX/JSX', () => {
  it('should preserve self-closing JSX', async () => {
    const input = '<Youtube url="https://example.com" />';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should preserve MDX imports', async () => {
    const input = 'import { Component } from "./component";\n\n# Content';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should preserve MDX exports', async () => {
    const input = 'export const meta = { title: "Test" };\n\n# Content';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should not merge import statements with following content', async () => {
    const input = "import Frame from '../fragments/frame';\n\n<Frame />";
    const result = await format(input, { settings: testSettings });
    expect(result).toContain("';\n\n<Frame");
  });

  it('should not collapse multiple JSX components into single line', async () => {
    const input =
      '<Youtube url="https://youtu.be/a" />\n\n<Youtube url="https://youtu.be/b" />\n\n<Youtube url="https://youtu.be/c" />';
    const result = await format(input, { settings: testSettings });
    expect(result).not.toContain('/><Youtube');
    expect(result.split('<Youtube').length).toBe(4);
  });
});

describe('Rust Formatter - Admonitions', () => {
  it('should preserve admonition directives', async () => {
    const input = ':::note\nThis is a note\n:::';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should handle admonitions with titles', async () => {
    const input = ':::tip[Pro Tip]\nThis is a tip\n:::';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should preserve nested content in admonitions', async () => {
    const input = ':::warning\n- Item 1\n- Item 2\n\n```js\ncode();\n```\n:::';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });
});

describe('Rust Formatter - Japanese Text', () => {
  it('should handle Japanese text with proper spacing', async () => {
    const input = '# 日本語の見出し\n内容です。';
    const expected = '# 日本語の見出し\n\n内容です。';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(expected);
  });

  it('should preserve Japanese punctuation', async () => {
    const input = 'これは、日本語の文章です。';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should not add backslash at end of Japanese text lines', async () => {
    const input = 'これは日本語のテキストです';
    const result = await format(input, { settings: testSettings });
    expect(result).toBe(input);
  });

  it('should preserve space after question mark in Japanese text', async () => {
    const input = 'シンセのDIYってどういうこと？ 自分で作れたり';
    const result = await format(input, { settings: testSettings });
    expect(result).toContain('？ 自分で');
  });
});

describe('Rust Formatter - Combined Scenarios', () => {
  it('should handle a document with mixed content', async () => {
    const input =
      '# Heading\n\n<ExImg src="/test.jpg" alt="test" />\nThis paragraph follows an image.\n\n  - List item with wrong indentation\n  - Another item';

    const result = await format(input, { settings: testSettings });

    // Heading stays separated
    expect(result).toContain('# Heading\n\n');
    // List items have no leading spaces
    expect(result).toContain('- List item with wrong indentation');
    expect(result).toContain('- Another item');
  });

  it('should preserve spacing after code blocks', async () => {
    const input = "```javascript\nconst example = 'hello';\n```\n\nNext paragraph here.";
    const result = await format(input, { settings: testSettings });
    expect(result).toContain('```\n\nNext paragraph');
  });
});
