import { describe, it, expect } from 'vitest';
import { format } from '../src/index.js';
import { testSettings } from './test-helpers.js';

describe('MDX Formatting Issues - Comprehensive Test Suite', () => {
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
      expect(lines.some((line) => line.includes('Synth Module Proの紹介は以上になります。'))).toBe(
        true,
      );
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
});
