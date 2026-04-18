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

    // Regression: issue #68 — a 3-backtick fence INSIDE a 4-backtick outer fence
    // must be treated as verbatim content.  The post-processing pass previously
    // mis-tracked the outer fence boundary and inserted blank lines inside the
    // inner fence (after its opening line and before its closing line).
    it('should not insert blank lines inside a 3-backtick fence that is inside a 4-backtick fence', async () => {
      const input = [
        '````mdx',
        '```ts',
        'export default {',
        '  site: "https://example.com",',
        '};',
        '```',
        '````',
      ].join('\n');
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(input);
    });

    it('should not insert blank lines inside an inner fence when outer fence wraps JSX', async () => {
      const input = [
        '````mdx',
        '<Details title="Example">',
        '',
        '```ts',
        'export default {',
        '  site: "https://example.com",',
        '  output: "static",',
        '};',
        '```',
        '',
        '</Details>',
        '````',
      ].join('\n');
      const result = await format(input, { settings: testSettings });
      // The inner ```ts fence must be verbatim — no blank lines added inside it
      expect(result).not.toMatch(/```ts\n\n/);
      expect(result).not.toMatch(/\n\n```\n/);
    });

    it('should handle frontmatter', async () => {
      const input = '---\ntitle: Test\n---\n\n# Content';
      const expected = '---\ntitle: Test\n---\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should preserve folded chomped scalar (>-) in frontmatter', async () => {
      const input =
        '---\ntitle: Tabs\ndescription: >-\n  Tabbed content panels for showing alternatives like package managers or platform-specific\n  instructions.\nsidebar_position: 3\n---\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(input);
    });

    it('should preserve folded scalar (>) in frontmatter', async () => {
      const input =
        '---\ntitle: Test\ndescription: >\n  This is a long description that spans\n  multiple lines for readability.\nsidebar_position: 1\n---\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(input);
    });

    it('should preserve literal chomped scalar (|-) in frontmatter', async () => {
      const input =
        '---\ntitle: Test\nbody: |-\n  Line one\n  Line two\n  Line three\nsidebar_position: 2\n---\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(input);
    });

    it('should preserve literal scalar (|) in frontmatter', async () => {
      const input =
        '---\ntitle: Test\nbody: |\n  Line one\n  Line two\n  Line three\nsidebar_position: 2\n---\n\n# Content';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(input);
    });

    it('should be idempotent with folded scalar in frontmatter', async () => {
      const input =
        '---\ntitle: Tabs\ndescription: >-\n  Tabbed content panels for showing alternatives like package managers or platform-specific\n  instructions.\nsidebar_position: 3\n---\n\n# Content';
      const first = await format(input, { settings: testSettings });
      const second = await format(first, { settings: testSettings });
      expect(first).toBe(second);
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

  describe('Regression Tests', () => {
    describe('Issue 1: Backslash Line Endings', () => {
      it('should not add backslash at end of lines with Japanese text', async () => {
        const input = `こんにちは、Takazudoです。
次の行です。`;
        const result = await format(input, { settings: testSettings });
        expect(result).not.toContain('です。\\');
        expect(result).not.toContain('\\\\');
      });

      it('should not add backslash after punctuation', async () => {
        const input = `これは文章です。
これも文章です。`;
        const result = await format(input, { settings: testSettings });
        expect(result).not.toContain('。\\');
      });
    });

    describe('Issue 2: JSX Component Adjacency', () => {
      it('should preserve blank line between text and JSX components', async () => {
        const input = `そんなわけで、以下がVol.1の内容となります。

<ExImg src="/images/p/highlights-vol-1-hero" extraWide alt="メルマガ写真" />`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('となります。\n\n<ExImg');
        expect(result).not.toContain('となります。<ExImg');
      });

      it('should keep JSX components on separate lines from text', async () => {
        const input = `テキストです。

<Youtube url="https://example.com" />`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('テキストです。\n\n<Youtube');
      });
    });

    describe('Issue 3: LayoutDivideItem Closing Tag Indentation', () => {
      it('should preserve indentation in nested JSX structures', async () => {
        const input = `<LayoutDivide>
  <LayoutDivideItem>
    Content here
  </LayoutDivideItem>
</LayoutDivide>`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('  </LayoutDivideItem>');
        // Check that we don't have a single-space indented closing tag on its own line
        const lines = result.split('\n');
        const hasSingleSpaceIndent = lines.some((line) => line === ' </LayoutDivideItem>');
        expect(hasSingleSpaceIndent).toBe(false);
      });
    });

    describe('Issue 4: Paragraph Merging', () => {
      it('should not merge multiple paragraphs into single lines', async () => {
        const input = `こんにちは、Takazudo Modularです。
Takazudo Modular Highlightsなどというメルマガの名前にしてみました。
そんな年中送るかは分かりませんが……。`;
        const result = await format(input, { settings: testSettings });
        const lines = result.trim().split('\n');
        expect(lines.length).toBeGreaterThan(1);
        expect(result).toContain('こんにちは、Takazudo Modularです。');
        expect(result).toContain(
          'Takazudo Modular Highlightsなどというメルマガの名前にしてみました。',
        );
      });

      it('should preserve paragraph breaks', async () => {
        const input = `段落1です。

段落2です。

段落3です。`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('段落1です。\n\n段落2です。\n\n段落3です。');
      });
    });

    describe('Issue 5: Component Chain Collapsing', () => {
      it('should not collapse multiple JSX components into single line', async () => {
        const input = `<Youtube url="https://youtu.be/59CxE076HDM" />

<Youtube url="https://youtu.be/MsfVwQ3i4xg" />

<Youtube url="https://youtu.be/-0dyIu5RekY" />`;
        const result = await format(input, { settings: testSettings });
        expect(result).not.toContain('/><Youtube');
        expect(result.split('<Youtube').length).toBe(4); // Original + 3 components
      });
    });

    describe('Issue 6: Import Statement Merging', () => {
      it('should not merge import statements with following content', async () => {
        const input = `import Frame from '../fragments/takazudo-design-blanks-display-frame';

<Frame />`;
        const result = await format(input, { settings: testSettings });
        expect(result).not.toContain(`';<Frame`);
        expect(result).toContain(`';\n\n<Frame`);
      });
    });

    describe('Issue 7: List Format Changes', () => {
      it('should preserve space after colon in lists', async () => {
        const input = `- Synth Module Pro Nostalgia: **153,800円**`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain(': **153,800円**');
        expect(result).not.toContain(':**153,800円**');
      });
    });

    describe('Issue 8: Heading and Content Merging', () => {
      it('should not merge headings with following content', async () => {
        const input = `## 価格とご予約について

<ExImg src="test.jpg" />`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('## 価格とご予約について\n\n<ExImg');
        expect(result).not.toContain('について<ExImg');
      });
    });

    describe('Issue 9: Fragment File Simplification', () => {
      it('should not collapse entire files to single lines', async () => {
        const input = `本品にはディスプレイ用のフレームが付属します。

フレームの大きさは約24HPで、ブランクパネルを装着し、壁に掛けるなどしてもお楽しみ頂けます。

<ExImg src="/images/p/design-blanks-frame" extraWide alt="飾られている写真" />`;
        const result = await format(input, { settings: testSettings });
        const lines = result.trim().split('\n');
        expect(lines.length).toBeGreaterThan(1);
      });
    });

    describe('Issue 10: Question Mark Space Removal', () => {
      it('should preserve space after question mark in Japanese text', async () => {
        const input = `シンセのDIYってどういうこと？ 自分で作れたり`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('？ 自分で');
        expect(result).not.toContain('？自分で');
      });
    });

    describe('Issue 11: Outro Component Content', () => {
      it('should preserve spacing inside Outro components', async () => {
        const input = `<Outro>

  Synth Module Proの紹介は以上になります。

  ご参考になれば幸いです。

</Outro>`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('<Outro>\n\n');
        expect(result).toContain('\n\n</Outro>');
        const lines = result.split('\n');
        expect(
          lines.some((line) => line.includes('Synth Module Proの紹介は以上になります。')),
        ).toBe(true);
        expect(lines.some((line) => line.includes('ご参考になれば幸いです。'))).toBe(true);
      });
    });

    describe('Issue 12: InfoBox Component Line Breaks', () => {
      it('should preserve line breaks inside InfoBox components', async () => {
        const input = `<InfoBox>
  現在、詳細な商品紹介ページが公開されています：
  - [Synth Module Pro 商品詳細ページ](synth-module-pro-black)
  - [Synth Pipe Pro 商品詳細ページ](synth-pipe-pro)
</InfoBox>`;
        const result = await format(input, { settings: testSettings });
        const lines = result.split('\n');
        expect(
          lines.some((line) => line.includes('現在、詳細な商品紹介ページが公開されています：')),
        ).toBe(true);
        expect(lines.some((line) => line.includes('- [Synth Module Pro'))).toBe(true);
        expect(lines.some((line) => line.includes('- [Synth Pipe Pro'))).toBe(true);
      });
    });

    describe('Issue 13: Code Block Adjacent Content', () => {
      it('should preserve spacing after code blocks', async () => {
        const input = `\`\`\`javascript
const example = 'hello';
\`\`\`

Next paragraph here.`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('```\n\nNext paragraph');
        expect(result).not.toContain('```Next paragraph');
      });
    });

    describe('Additional Edge Cases', () => {
      it('should handle MercariNav with multiple ids correctly', async () => {
        const input = `本商品は、以下よりご購入頂けます。

<MercariNav ids={['synth-module-pro-nostalgia', 'synth-module-pro-black']} />`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain(
          `<MercariNav ids={['synth-module-pro-nostalgia', 'synth-module-pro-black']} />`,
        );
      });

      it('should preserve ImgsGrid formatting', async () => {
        const input = `<ImgsGrid
  srcs={['/images/p/synth-module-02-angle', '/images/p/synth-module-03-top']}
  alts={['商品写真']}
  divide={2}
  extraWide
/>`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('ImgsGrid');
        expect(result).toContain('srcs={[');
        expect(result).toContain('divide={2}');
        expect(result).toContain('extraWide');
      });

      it('should not escape underscores in URLs', async () => {
        const input = `[Link text](/images/p/design_blank_frame)`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('/images/p/design_blank_frame');
        expect(result).not.toContain('\\_');
      });

      it('should preserve Japanese list formatting', async () => {
        const input = `- 項目1：説明文
- 項目2：説明文`;
        const result = await format(input, { settings: testSettings });
        expect(result).toContain('- 項目1：説明文');
        expect(result).toContain('- 項目2：説明文');
      });
    });

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

  describe('Issue #27: Paragraph/list spacing in production formatter', () => {
    it('should add empty line between paragraph and list', async () => {
      const input = 'Some text\n- Item 1\n- Item 2';
      const expected = 'Some text\n\n- Item 1\n- Item 2';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between list and paragraph', async () => {
      const input = '- Item 1\n- Item 2\nMore text';
      const expected = '- Item 1\n- Item 2\n\nMore text';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty lines around list surrounded by paragraphs', async () => {
      const input = 'Some text\n- Item 1\n- Item 2\nMore text';
      const expected = 'Some text\n\n- Item 1\n- Item 2\n\nMore text';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between code block and paragraph', async () => {
      const input = '```js\ncode\n```\nParagraph';
      const expected = '```js\ncode\n```\n\nParagraph';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between paragraph and code block', async () => {
      const input = 'Paragraph\n```js\ncode\n```';
      const expected = 'Paragraph\n\n```js\ncode\n```';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between list and code block', async () => {
      const input = '- Item 1\n- Item 2\n```js\ncode\n```';
      const expected = '- Item 1\n- Item 2\n\n```js\ncode\n```';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between paragraph and numbered list', async () => {
      const input = 'Some text\n1. First\n2. Second';
      const expected = 'Some text\n\n1. First\n2. Second';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should add empty line between numbered list and paragraph', async () => {
      const input = '1. First\n2. Second\nMore text';
      const expected = '1. First\n2. Second\n\nMore text';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });

    it('should not add empty lines if already present', async () => {
      const input = 'Some text\n\n- Item 1\n- Item 2\n\nMore text';
      const expected = 'Some text\n\n- Item 1\n- Item 2\n\nMore text';
      const result = await format(input, { settings: testSettings });
      expect(result).toBe(expected);
    });
  });
});
