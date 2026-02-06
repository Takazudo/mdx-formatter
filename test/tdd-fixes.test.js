import { describe, it, expect } from 'vitest';
import { format } from '../src/index.js';
import { testSettings } from './test-helpers.js';

describe('TDD: MDX Formatter Fixes', () => {
  describe('Issue 1: Empty lines between JSX elements and text', () => {
    it('should add empty line between JSX component and following text paragraph', async () => {
      const input = `<ExImg src="/test.jpg" alt="test" />
次の段落のテキストです。`;

      // expandSingleLineJsx is disabled, so JSX stays single-line
      const expected = `<ExImg src="/test.jpg" alt="test" />

次の段落のテキストです。`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between multi-line JSX and text', async () => {
      const input = `<ExImg
  src="/test.jpg"
  alt="test"
  className="wide"
/>
This is the next paragraph text.`;

      const expected = `<ExImg
  src="/test.jpg"
  alt="test"
  className="wide" />

This is the next paragraph text.`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should not add empty line if one already exists', async () => {
      const input = `<ExImg src="/test.jpg" alt="test" />

This text already has a blank line before it.`;

      const expected = `<ExImg src="/test.jpg" alt="test" />

This text already has a blank line before it.`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle multiple JSX components in sequence', async () => {
      const input = `<ExImg src="/test1.jpg" alt="test1" />
<ExImg src="/test2.jpg" alt="test2" />
次の段落のテキストです。`;

      // Single-line JSX stays single-line (expandSingleLineJsx disabled)
      const expected = `<ExImg src="/test1.jpg" alt="test1" />
<ExImg src="/test2.jpg" alt="test2" />

次の段落のテキストです。`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });

  describe('Issue 2: List indentation (should have no leading spaces)', () => {
    it('should format lists without leading spaces', async () => {
      const input = `  - First item
  - Second item
  - Third item`;

      const expected = `- First item
- Second item
- Third item`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve nested list indentation correctly', async () => {
      const input = `  - Parent item
    - Nested item 1
    - Nested item 2
  - Another parent`;

      const expected = `- Parent item
  - Nested item 1
  - Nested item 2
- Another parent`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle numbered lists without leading spaces', async () => {
      const input = `  1. First item
  2. Second item
  3. Third item`;

      const expected = `1. First item
2. Second item
3. Third item`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle mixed content with lists', async () => {
      const input = `Here is a paragraph.

  - List item 1
  - List item 2

Another paragraph.`;

      const expected = `Here is a paragraph.

- List item 1
- List item 2

Another paragraph.`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });

  describe('Issue 3: dl/dt/dd with div wrapper formatting', () => {
    it('should format dl with div-wrapped dt/dd pairs correctly', async () => {
      const input = `<dl>
<div>
<dt>Term 1</dt>
<dd>Definition 1</dd>
</div>
<div>
<dt>Term 2</dt>
<dd>Definition 2</dd>
</div>
</dl>`;

      const expected = `<dl>
  <div>
    <dt>Term 1</dt>
    <dd>Definition 1</dd>
  </div>
  <div>
    <dt>Term 2</dt>
    <dd>Definition 2</dd>
  </div>
</dl>`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle dl without div wrappers', async () => {
      const input = `<dl>
<dt>Term</dt>
<dd>Definition</dd>
</dl>`;

      const expected = `<dl>
  <dt>Term</dt>
  <dd>Definition</dd>
</dl>`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle complex dl with mixed content', async () => {
      const input = `<dl>
<div>
<dt>Complex Term</dt>
<dd>This is a longer definition that spans multiple words</dd>
</div>
<dt>Simple Term</dt>
<dd>Simple def</dd>
<div>
<dt>Another wrapped term</dt>
<dd>Another wrapped definition</dd>
</div>
</dl>`;

      const expected = `<dl>
  <div>
    <dt>Complex Term</dt>
    <dd>This is a longer definition that spans multiple words</dd>
  </div>
  <dt>Simple Term</dt>
  <dd>Simple def</dd>
  <div>
    <dt>Another wrapped term</dt>
    <dd>Another wrapped definition</dd>
  </div>
</dl>`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve text content inside dt/dd elements', async () => {
      const input = `<dl>
  <div>
    <dt>日本語の用語</dt>
    <dd>日本語の定義です。</dd>
  </div>
</dl>`;

      const result = await format(input, { settings: testSettings });
      expect(result).toContain('日本語の用語');
      expect(result).toContain('日本語の定義です。');
    });
  });

  describe('Combined scenarios', () => {
    it('should handle all three issues in a single document', async () => {
      const input = `# Heading

<ExImg src="/test.jpg" alt="test" />
This paragraph follows an image.

  - List item with wrong indentation
  - Another item

<dl>
<div>
<dt>Term</dt>
<dd>Definition</dd>
</div>
</dl>`;

      // JSX stays single-line (expandSingleLineJsx disabled)
      const expected = `# Heading

<ExImg src="/test.jpg" alt="test" />

This paragraph follows an image.

- List item with wrong indentation
- Another item

<dl>
  <div>
    <dt>Term</dt>
    <dd>Definition</dd>
  </div>
</dl>`;

      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });
});
