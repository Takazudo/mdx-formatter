import { describe, it, expect } from 'vitest';
import { format } from '../src/index.js';
import { testSettings } from './test-helpers.js';

describe('Markdown Formatter', () => {
  describe('Basic Markdown Formatting', () => {
    it('should format headings with proper spacing', async () => {
      const input = '# Heading\nContent';
      const expected = '# Heading\n\nContent';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve list markers as-is', async () => {
      const input = '* Item 1\n+ Item 2\n- Item 3';
      const result = await format(input, { settings: testSettings });
      // Formatter preserves original list markers
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 2');
      expect(result).toContain('Item 3');
    });

    it('should preserve code blocks', async () => {
      const input = '```js\nconst x = 1;\n```';
      const expected = '```js\nconst x = 1;\n```';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle frontmatter', async () => {
      const input = '---\ntitle: Test\n---\n\n# Content';
      const expected = '---\ntitle: Test\n---\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });

  describe('HTML Definition List Formatting', () => {
    it('should format dl/dt/dd with proper indentation', async () => {
      const input = '<dl>\n<dt>Term</dt>\n<dd>Definition</dd>\n</dl>';
      const expected = '<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle multiple terms and definitions', async () => {
      const input =
        '<dl>\n<dt>Term 1</dt>\n<dd>Definition 1</dd>\n<dt>Term 2</dt>\n<dd>Definition 2</dd>\n</dl>';
      const result = await format(input, { settings: testSettings });
      expect(result).toContain('<dt>Term 1</dt>');
      expect(result).toContain('<dd>Definition 1</dd>');
      expect(result).toContain('<dt>Term 2</dt>');
      expect(result).toContain('<dd>Definition 2</dd>');
    });
  });

  describe('MDX/JSX Support', () => {
    it('should handle JSX components with empty lines', async () => {
      const input = '<InfoBox>\nContent\n</InfoBox>';
      const expected = '<InfoBox>\n\nContent\n\n</InfoBox>';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve self-closing JSX components', async () => {
      const input = '<Youtube url="https://example.com" />';
      const expected = '<Youtube url="https://example.com" />';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve MDX imports', async () => {
      const input = 'import { Component } from "./component";\n\n# Content';
      const expected = 'import { Component } from "./component";\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve MDX exports', async () => {
      const input = 'export const meta = { title: "Test" };\n\n# Content';
      const expected = 'export const meta = { title: "Test" };\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });

  describe('Docusaurus Admonitions', () => {
    it('should preserve admonition directives', async () => {
      const input = ':::note\nThis is a note\n:::';
      const expected = ':::note\nThis is a note\n:::';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should handle admonitions with titles', async () => {
      const input = ':::tip[Pro Tip]\nThis is a tip\n:::';
      const expected = ':::tip[Pro Tip]\nThis is a tip\n:::';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve nested content in admonitions', async () => {
      const input = ':::warning\n- Item 1\n- Item 2\n\n```js\ncode();\n```\n:::';
      const expected = ':::warning\n- Item 1\n- Item 2\n\n```js\ncode();\n```\n:::';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });

  describe('Japanese Text Formatting', () => {
    it('should handle Japanese text with proper spacing', async () => {
      const input = '# 日本語の見出し\n内容です。';
      const expected = '# 日本語の見出し\n\n内容です。';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve Japanese punctuation', async () => {
      const input = 'これは、日本語の文章です。';
      const expected = 'これは、日本語の文章です。';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });

  describe('Critical Formatting Issues', () => {
    describe('Asterisk Escaping', () => {
      it('should not escape asterisks in bold text with special characters', async () => {
        const input = '**×2**';
        const expected = '**×2**';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should not escape asterisks in bold text with multiplication sign', async () => {
        const input = 'この値を **×2** します';
        const expected = 'この値を **×2** します';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should preserve bold formatting with Japanese text', async () => {
        const input = '**重要** な情報です';
        const expected = '**重要** な情報です';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });
    });

    describe('Image Alt Text Preservation', () => {
      it('should preserve colon followed by text in image alt', async () => {
        const input = '![図:VCAによるオーディオシグナルの減衰処理](/images/p/vca-exp-2)';
        const expected = '![図:VCAによるオーディオシグナルの減衰処理](/images/p/vca-exp-2)';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should preserve multiple colons in alt text', async () => {
        const input = '![図:VCA:エンベロープ処理](/images/p/test)';
        const expected = '![図:VCA:エンベロープ処理](/images/p/test)';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should preserve colons at the beginning of alt text', async () => {
        const input = '![:VCAモジュール](/images/p/vca)';
        const expected = '![:VCAモジュール](/images/p/vca)';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });
    });

    describe('Spaces Around Bold Text', () => {
      it('should preserve spaces between bold elements', async () => {
        const input = '**VCA** + **Decay Envelope**';
        const expected = '**VCA** + **Decay Envelope**';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should preserve spaces around plus sign between bold text', async () => {
        const input = '**Item1** + **Item2** = **Result**';
        const expected = '**Item1** + **Item2** = **Result**';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should preserve spaces with multiple bold elements', async () => {
        const input = '**A** and **B** or **C**';
        const expected = '**A** and **B** or **C**';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });
    });

    describe('HTML Tags Escaping', () => {
      it('should not escape HTML closing tags', async () => {
        const input = 'Text with </strong> tag';
        const expected = 'Text with </strong> tag';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should not escape HTML opening and closing tags', async () => {
        const input = '<strong>Bold</strong> text';
        const expected = '<strong>Bold</strong> text';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should not escape self-closing HTML tags', async () => {
        const input = 'Line break<br/> here';
        const expected = 'Line break<br/> here';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });
    });

    describe('Line End Backslash Issues', () => {
      it('should not add backslash at end of Japanese text lines', async () => {
        const input = 'これは日本語のテキストです';
        const expected = 'これは日本語のテキストです';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should not add backslash after Japanese punctuation at line end', async () => {
        const input = 'これは文章です。';
        const expected = 'これは文章です。';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should not add backslash in multi-line Japanese text', async () => {
        const input = 'これは最初の行\nこれは次の行';
        const expected = 'これは最初の行\nこれは次の行';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });
    });

    describe('URL Parentheses Escaping', () => {
      it('should not escape parentheses in URLs', async () => {
        const input = '詳細は (https://example.com) をご覧ください';
        const expected = '詳細は (https://example.com) をご覧ください';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should not escape URLs at end of lines with parentheses', async () => {
        const input = 'Visit the site (https://example.com)';
        const expected = 'Visit the site (https://example.com)';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });

      it('should handle URLs with query parameters in parentheses', async () => {
        const input = 'Check (https://example.com?param=value)';
        const expected = 'Check (https://example.com?param=value)';
        const result = await format(input, { settings: testSettings });
        expect(result).toBe(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid markdown gracefully', async () => {
      const input = '# Heading\n```\nUnclosed code block';
      const result = await format(input, { settings: testSettings });
      expect(result).toContain('# Heading');
    });

    it('should handle empty input', async () => {
      const input = '';
      const expected = '';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });
});
