import { describe, it, expect, test } from 'vitest';
import { MdxFormatter } from '../src/mdx-formatter.js';
import { testSettings } from './test-helpers.js';
import { loadConfig } from '../src/load-config.js';
import type { DeepPartial, FormatterSettings } from '../src/types.js';

const settings = loadConfig({ settings: testSettings });

describe('MdxFormatter - AST-based MDX Formatter', () => {
  const tabSettings = loadConfig({
    settings: {
      ...testSettings,
      addEmptyLinesInBlockJsx: {
        blockComponents: ['Tabs', 'TabItem'],
      },
      indentJsxContent: {
        containerComponents: ['Tabs', 'TabItem'],
      },
    },
  });

  const blockSettings = loadConfig({
    settings: {
      ...testSettings,
      addEmptyLinesInBlockJsx: {
        blockComponents: ['Outro', 'InfoBox', 'LayoutDivideItem', 'Column', 'Danger'],
      },
    },
  });

  describe('Critical: Multi-line JSX Detection and Formatting', () => {
    it('should detect and format multi-line JSX with improper line breaks', async () => {
      const input = `<ExImg src="/images/p/oxi-one-display-select-type" className="mx-auto md:ml-0 md:mr-auto" restrictedWidth="500"
  alt="ディスプレイ: Sequencer Mode選択の図"
/>`;

      const expected = `<ExImg
  src="/images/p/oxi-one-display-select-type"
  className="mx-auto md:ml-0 md:mr-auto"
  restrictedWidth="500"
  alt="ディスプレイ: Sequencer Mode選択の図" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle multi-line JSX that starts properly but has mixed formatting', async () => {
      const input = `<Youtube
url="https://youtube.com/watch?v=123" title="Demo Video"
/>`;

      const expected = `<Youtube
  url="https://youtube.com/watch?v=123"
  title="Demo Video" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should detect JSX across many lines with inconsistent indentation', async () => {
      const input = `<ImgsGrid
srcs={[
"https://example.com/1.jpg",
    "https://example.com/2.jpg"
]}
  alts={["Image 1", "Image 2"]}
divide="3"
/>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      // Verify proper indentation applied
      expect(result).toContain('  srcs={');
      expect(result).toContain('  alts={');
      expect(result).toContain('  divide="3"');
    });
  });

  describe('Rule 1: Add Empty Lines Between Elements', () => {
    it('should add empty line after heading', async () => {
      const input = `## Heading
Content here`;

      const expected = `## Heading

Content here`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should add empty line after JSX component', async () => {
      const input = `<ExImg src="/test.jpg" alt="test" />
Next paragraph`;

      const expected = `<ExImg src="/test.jpg" alt="test" />

Next paragraph`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should not add empty line if already exists', async () => {
      const input = `## Heading

Content here`;

      const expected = `## Heading

Content here`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should add empty line between consecutive headings', async () => {
      const input = `## Heading 1
### Heading 2`;

      const expected = `## Heading 1

### Heading 2`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Rule 2: Format Multi-line JSX', () => {
    it('should properly indent attributes in multi-line JSX', async () => {
      const input = `<ExImg
src="/test.jpg"
alt="test"
className="center"
/>`;

      const expected = `<ExImg
  src="/test.jpg"
  alt="test"
  className="center" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle JSX with expression props', async () => {
      const input = `<Component
prop1={value1}
prop2={value2}
stringProp="test"
/>`;

      const expected = `<Component
  prop1={value1}
  prop2={value2}
  stringProp="test" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Rule 3: Trim dl/dt/dd Spacing', () => {
    it('should remove extra whitespace in dl/dt/dd elements', async () => {
      const input = `<dl>
  <dt>  Term 1  </dt>
  <dd>  Definition 1  </dd>
</dl>`;

      const expected = `<dl>
  <dt>Term 1</dt>
  <dd>Definition 1</dd>
</dl>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle multiple dt/dd pairs', async () => {
      const input = `<dl>
  <dt> Term 1 </dt>
  <dd> Def 1 </dd>
  <dt> Term 2 </dt>
  <dd> Def 2 </dd>
</dl>`;

      const expected = `<dl>
  <dt>Term 1</dt>
  <dd>Def 1</dd>
  <dt>Term 2</dt>
  <dd>Def 2</dd>
</dl>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Rule 5: Empty Lines in Block JSX Components', () => {
    it('should add empty lines after opening and before closing tags for Outro', async () => {
      const input = `<Outro>
This is the outro content.
Multiple lines here.
</Outro>`;

      const expected = `<Outro>

This is the outro content.
Multiple lines here.

</Outro>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should add empty lines for InfoBox component', async () => {
      const input = `<InfoBox>
Important information
- Point 1
- Point 2
</InfoBox>`;

      const expected = `<InfoBox>

Important information
- Point 1
- Point 2

</InfoBox>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should add empty lines for LayoutDivideItem with heading', async () => {
      const input = `<LayoutDivideItem>
### 8つの強力なシーケンサー
複雑な作曲...
</LayoutDivideItem>`;

      const expected = `<LayoutDivideItem>

### 8つの強力なシーケンサー

複雑な作曲...

</LayoutDivideItem>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should add empty lines for Column component', async () => {
      const input = `<Column>
Some content in column
More content
</Column>`;

      const expected = `<Column>

Some content in column
More content

</Column>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should NOT add empty lines for LayoutDivide component', async () => {
      const input = `<LayoutDivide>
<LayoutDivideItem>
Left content
</LayoutDivideItem>
<LayoutDivideItem>
Right content
</LayoutDivideItem>
</LayoutDivide>`;

      const expected = `<LayoutDivide>
<LayoutDivideItem>

Left content

</LayoutDivideItem>

<LayoutDivideItem>

Right content

</LayoutDivideItem>
</LayoutDivide>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should not add multiple empty lines if they already exist', async () => {
      const input = `<Outro>

Content already has empty line above.

</Outro>`;

      const expected = `<Outro>

Content already has empty line above.

</Outro>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle block component with single line content', async () => {
      const input = `<InfoBox>Single line content</InfoBox>`;

      const expected = `<InfoBox>

Single line content

</InfoBox>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle nested block components correctly', async () => {
      const input = `<Column>
<InfoBox>
Nested info
</InfoBox>
Other content
</Column>`;

      const expected = `<Column>

<InfoBox>

Nested info

</InfoBox>

Other content

</Column>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should preserve existing proper formatting', async () => {
      const input = `<Outro>

Already properly formatted content.
With multiple lines.

</Outro>`;

      const expected = `<Outro>

Already properly formatted content.
With multiple lines.

</Outro>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Rule 6: Indent JSX Container Content (when enabled)', () => {
    it('should indent content inside Outro component', async () => {
      const input = `<Outro>
This is the outro content.
Multiple lines here.
</Outro>`;

      const expected = `<Outro>
  This is the outro content.
  Multiple lines here.
</Outro>`;

      const formatter = new MdxFormatter(input, settings);
      // Temporarily enable indentation rule for this test
      formatter.settings.indentJsxContent.enabled = true;
      formatter.settings.addEmptyLinesInBlockJsx = { enabled: false };
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should indent content inside InfoBox component', async () => {
      const input = `<InfoBox>
Important information
- Point 1
- Point 2
</InfoBox>`;

      const expected = `<InfoBox>
  Important information
  - Point 1
  - Point 2
</InfoBox>`;

      const formatter = new MdxFormatter(input, settings);
      // Temporarily enable indentation rule for this test
      formatter.settings.indentJsxContent.enabled = true;
      formatter.settings.addEmptyLinesInBlockJsx = { enabled: false };
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle nested container components', async () => {
      const input = `<LayoutDivide>
<LayoutDivideItem>
Left content
</LayoutDivideItem>
<LayoutDivideItem>
Right content
</LayoutDivideItem>
</LayoutDivide>`;

      const formatter = new MdxFormatter(input, settings);
      // Temporarily enable indentation rule for this test
      formatter.settings.indentJsxContent.enabled = true;
      formatter.settings.addEmptyLinesInBlockJsx = { enabled: false };
      const result = await formatter.format();
      // Verify indentation is applied to nested components
      expect(result).toContain('  <LayoutDivideItem>');
      expect(result).toContain('Left content');
      expect(result).toContain('Right content');
    });
  });

  describe('Rule 6: Preserve Admonitions', () => {
    it('should preserve Docusaurus admonitions', async () => {
      const input = `:::note
This is a note
:::`;

      const expected = `:::note
This is a note
:::`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should preserve admonitions with titles', async () => {
      const input = `:::tip[Pro Tip]
Advanced usage here
:::`;

      const expected = `:::tip[Pro Tip]
Advanced usage here
:::`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Complex Real-World Scenarios', () => {
    it('should handle MDX with frontmatter, headings, and JSX', async () => {
      const input = `---
title: Test Article
---

# Main Title
<ExImg src="/banner.jpg" alt="Banner" className="hero" restrictedWidth="1200" />
## Introduction
This is the introduction paragraph.

<InfoBox>
Important note here
</InfoBox>`;

      const expected = `---
title: Test Article
---

# Main Title

<ExImg src="/banner.jpg" alt="Banner" className="hero" restrictedWidth="1200" />
## Introduction

This is the introduction paragraph.

<InfoBox>

Important note here

</InfoBox>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle mixed content with lists and JSX', async () => {
      const input = `## Features
- Feature 1
- Feature 2
<Youtube url="https://youtube.com/watch?v=123" title="Demo" />
More content here`;

      const expected = `## Features

- Feature 1
- Feature 2
<Youtube url="https://youtube.com/watch?v=123" title="Demo" />

More content here`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle real-world broken JSX from the example', async () => {
      const input = `商品の詳細：

<ExImg src="/images/p/oxi-one-display-select-type" className="mx-auto md:ml-0 md:mr-auto" restrictedWidth="500"
  alt="ディスプレイ: Sequencer Mode選択の図"
/>

次のセクション`;

      const expected = `商品の詳細：

<ExImg
  src="/images/p/oxi-one-display-select-type"
  className="mx-auto md:ml-0 md:mr-auto"
  restrictedWidth="500"
  alt="ディスプレイ: Sequencer Mode選択の図" />

次のセクション`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty content', async () => {
      const input = '';
      const expected = '';

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle content with only whitespace', async () => {
      const input = '   \n\n   ';
      const expected = '';

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result.trim()).toBe(expected);
    });

    it('should preserve code blocks without modification', async () => {
      const input = `\`\`\`jsx
<ExImg src="/test.jpg" alt="test" />
\`\`\``;

      const expected = `\`\`\`jsx
<ExImg src="/test.jpg" alt="test" />
\`\`\``;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should not format JSX inside code blocks', async () => {
      const input = `Here is code:

\`\`\`jsx
<Component prop1="value1" prop2="value2" prop3="value3" />
\`\`\`

<Component prop1="value1" prop2="value2" prop3="value3" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      // Code block content should be preserved
      expect(result).toContain(
        '```jsx\n<Component prop1="value1" prop2="value2" prop3="value3" />\n```',
      );
      // JSX outside code block stays as-is (expandSingleLineJsx disabled)
      expect(result).toMatch(/<Component prop1="value1" prop2="value2" prop3="value3" \/>/);
    });

    it('should handle JSX with Japanese content in attributes', async () => {
      // Single-line JSX stays single-line (expandSingleLineJsx disabled)
      const input = `<ExImg src="/test.jpg" alt="テスト画像" title="これはテストです" className="center" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });
  });

  describe('Settings and Configuration', () => {
    it('should respect disabled rules', async () => {
      const input = `<ExImg src="/test.jpg" alt="test" className="center" />`;

      const formatter = new MdxFormatter(input, settings);
      // Disable single-line expansion
      formatter.settings.expandSingleLineJsx.enabled = false;

      const result = await formatter.format();
      expect(result).toBe(input); // Should remain unchanged
    });

    it('should use configurable indent size', async () => {
      const input = `<ExImg
src="/test.jpg"
alt="test"
/>`;

      const formatter = new MdxFormatter(input, settings);
      formatter.settings.formatMultiLineJsx.indentSize = 4;

      const expected = `<ExImg
    src="/test.jpg"
    alt="test" />`;

      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('HTML Content Duplication Prevention', () => {
    describe('Critical: DL element with nested DIV elements duplication', () => {
      it('should NOT duplicate content when formatting dl with nested div elements', async () => {
        // This is the exact structure from the problematic file
        const input = `<dl classname="flow-root">
  <div>
    <dt>1. LINE LEVEL コントロール</dt>
    <dd>このノブは\`LIVE LEVEL IN\`で受けるシグナルの大きさを調整します。
        <strong>3時の位置で100%</strong>
。より右に回すと、入力シグナルを100%を超えて増幅させます。このシグナルの増幅は、ノーマライズされていない小さいボリュームのオーディオを持ち上げたり、入力シグナルにサチュレーション効果を与えるために使用することが可能です。</dd>
  </div>
  <div>
    <dt>2. EURO LEVEL コントロール</dt>
    <dd>このノブは\`EURO LEVEL IN\`の音量を調整します。<strong>時計回りに回し切った状態で100%</strong>
です。</dd>
  </div>
  <div>
    <dt>3. LINE LEVEL IN</dt>
    <dd>2つの入力ジャックは、ラインレベルのステレオシグナルを受け取ることができます。左は右にノーマル接続されているため、右入力にケーブルが差し込まれていない場合、左が受けるシグナルが右にも渡されます。</dd>
  </div>
  <div>
    <dt>4. EURO LEVEL IN</dt>
    <dd>2つの入力ジャックは、ユーロレベルのステレオシグナルを受け取ることが出来ます。左は右にノーマル接続されているため、右入力にケーブルが差し込まれていない場合、左が受けるシグナルが右にも渡されます。</dd>
  </div>
  <div>
    <dt>5. LINE LEVEL OUT</dt>
    <dd>これらはユーロレベル入力信号のラインレベル出力です。</dd>
  </div>
  <div>
    <dt>6. EUROLEVEL OUT</dt>
    <dd>これらはラインレベル入力信号のユーロレベル出力です。</dd>
  </div>
</dl>`;

        // The expected output should be properly formatted but NOT duplicated
        // Note: The formatter keeps dd content on a single line when possible
        const expected = `<dl classname="flow-root">
  <div>
    <dt>1. LINE LEVEL コントロール</dt>
    <dd>このノブは\`LIVE LEVEL IN\`で受けるシグナルの大きさを調整します。 <strong>3時の位置で100%</strong> 。より右に回すと、入力シグナルを100%を超えて増幅させます。このシグナルの増幅は、ノーマライズされていない小さいボリュームのオーディオを持ち上げたり、入力シグナルにサチュレーション効果を与えるために使用することが可能です。</dd>
  </div>
  <div>
    <dt>2. EURO LEVEL コントロール</dt>
    <dd>このノブは\`EURO LEVEL IN\`の音量を調整します。<strong>時計回りに回し切った状態で100%</strong> です。</dd>
  </div>
  <div>
    <dt>3. LINE LEVEL IN</dt>
    <dd>2つの入力ジャックは、ラインレベルのステレオシグナルを受け取ることができます。左は右にノーマル接続されているため、右入力にケーブルが差し込まれていない場合、左が受けるシグナルが右にも渡されます。</dd>
  </div>
  <div>
    <dt>4. EURO LEVEL IN</dt>
    <dd>2つの入力ジャックは、ユーロレベルのステレオシグナルを受け取ることが出来ます。左は右にノーマル接続されているため、右入力にケーブルが差し込まれていない場合、左が受けるシグナルが右にも渡されます。</dd>
  </div>
  <div>
    <dt>5. LINE LEVEL OUT</dt>
    <dd>これらはユーロレベル入力信号のラインレベル出力です。</dd>
  </div>
  <div>
    <dt>6. EUROLEVEL OUT</dt>
    <dd>これらはラインレベル入力信号のユーロレベル出力です。</dd>
  </div>
</dl>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Check that there are no duplicate closing tags
        expect(result.match(/<\/dl>/g)?.length).toBe(1);

        // Check that content is not duplicated
        expect(result.indexOf('1. LINE LEVEL コントロール')).not.toBe(-1);
        expect(result.lastIndexOf('1. LINE LEVEL コントロール')).toBe(
          result.indexOf('1. LINE LEVEL コントロール'),
        );

        // Check the exact output
        expect(result).toBe(expected);
      });

      it('should handle nested HTML elements without duplication', async () => {
        const input = `<div>
  <p>First paragraph</p>
  <div>
    <span>Nested content</span>
  </div>
  <p>Last paragraph</p>
</div>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Ensure no duplication
        expect(result.match(/<\/div>/g)?.length).toBe(2); // One for outer, one for inner
        expect(result.match(/<\/p>/g)?.length).toBe(2);
        expect(result.match(/<\/span>/g)?.length).toBe(1);

        // Check content appears only once
        expect(result.split('First paragraph').length - 1).toBe(1);
        expect(result.split('Nested content').length - 1).toBe(1);
        expect(result.split('Last paragraph').length - 1).toBe(1);
      });

      it('should handle deeply nested HTML structures', async () => {
        const input = `<article>
  <section>
    <div>
      <ul>
        <li>Item 1</li>
        <li>Item 2</li>
      </ul>
    </div>
  </section>
</article>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Check for correct number of closing tags
        expect(result.match(/<\/article>/g)?.length).toBe(1);
        expect(result.match(/<\/section>/g)?.length).toBe(1);
        expect(result.match(/<\/div>/g)?.length).toBe(1);
        expect(result.match(/<\/ul>/g)?.length).toBe(1);
        expect(result.match(/<\/li>/g)?.length).toBe(2);

        // Ensure content is not duplicated
        expect(result.split('Item 1').length - 1).toBe(1);
        expect(result.split('Item 2').length - 1).toBe(1);
      });

      it('should handle HTML blocks in MDX context', async () => {
        const input = `---
title: Test Document
---

# Heading

Some text before HTML.

<dl classname="flow-root">
  <div>
    <dt>Term 1</dt>
    <dd>Definition 1</dd>
  </div>
  <div>
    <dt>Term 2</dt>
    <dd>Definition 2</dd>
  </div>
</dl>

Text after HTML block.

## Another Heading`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Ensure HTML block is not duplicated
        expect(result.match(/<dl classname="flow-root">/g)?.length).toBe(1);
        expect(result.match(/<\/dl>/g)?.length).toBe(1);

        // Ensure surrounding content is preserved
        expect(result).toContain('# Heading');
        expect(result).toContain('Some text before HTML.');
        expect(result).toContain('Text after HTML block.');
        expect(result).toContain('## Another Heading');

        // Ensure content within HTML is not duplicated
        expect(result.split('Term 1').length - 1).toBe(1);
        expect(result.split('Definition 1').length - 1).toBe(1);
      });

      it('should preserve MDX expressions within HTML elements', async () => {
        const input = `<dl classname="flow-root">
  <div>
    <dt>Item with code</dt>
    <dd>This uses \`inline code\` and **bold text**.</dd>
  </div>
</dl>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Check that MDX expressions are preserved
        expect(result).toContain('`inline code`');
        expect(result).toContain('**bold text**');

        // Ensure no duplication
        expect(result.match(/<\/dl>/g)?.length).toBe(1);
        expect(result.split('Item with code').length - 1).toBe(1);
      });

      it('should handle HTML with attributes correctly', async () => {
        const input = `<dl classname="flow-root" id="definitions" data-test="value">
  <div class="definition-item">
    <dt>Term</dt>
    <dd>Definition</dd>
  </div>
</dl>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Check attributes are preserved
        expect(result).toContain('classname="flow-root"');
        expect(result).toContain('id="definitions"');
        expect(result).toContain('data-test="value"');
        expect(result).toContain('class="definition-item"');

        // Ensure no duplication
        expect(result.match(/<\/dl>/g)?.length).toBe(1);
        expect(result.match(/<\/div>/g)?.length).toBe(1);
      });

      it('should not duplicate when HTML has irregular spacing', async () => {
        const input = `<dl   classname="flow-root"  >
    <div>
      <dt>  Term with spaces  </dt>
      <dd>
        Definition with
        line breaks
      </dd>
    </div>
</dl>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // Ensure no duplication of closing tags
        expect(result.match(/<\/dl>/g)?.length).toBe(1);
        expect(result.match(/<\/div>/g)?.length).toBe(1);

        // Content should appear only once
        expect(result.split('Term with spaces').length - 1).toBe(1);
        expect(result.split('Definition with').length - 1).toBe(1);
      });
    });

    describe('Edge cases and regression tests', () => {
      it('should handle empty HTML elements', async () => {
        const input = `<dl>
  <div></div>
</dl>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        expect(result.match(/<\/dl>/g)?.length).toBe(1);
        expect(result.match(/<\/div>/g)?.length).toBe(1);
      });

      it('should handle self-closing tags within HTML blocks', async () => {
        const input = `<div>
  <img src="test.jpg" />
  <br />
  <p>Text</p>
</div>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        expect(result.match(/<\/div>/g)?.length).toBe(1);
        expect(result.match(/<\/p>/g)?.length).toBe(1);
        expect(result).toContain('<img src="test.jpg"');
        expect(result).toContain('<br');
      });

      it('should handle mixed JSX and HTML elements', async () => {
        const input = `<div>
  <CustomComponent />
  <p>HTML paragraph</p>
</div>`;

        const formatter = new MdxFormatter(input, settings);
        const result = await formatter.format();

        // CustomComponent should be preserved as JSX
        expect(result).toContain('<CustomComponent />');
        expect(result.match(/<\/div>/g)?.length).toBe(1);
        expect(result.match(/<\/p>/g)?.length).toBe(1);
      });
    });
  });

  describe('YAML Frontmatter Formatting', () => {
    test('should format YAML frontmatter with extra blank lines', async () => {
      const input = `---
title: "Test Article"

description: "A long description"

tags:

  - tag1
  - tag2
---

Content here`;

      const expected = `---
title: Test Article
description: A long description
tags:
  - tag1
  - tag2
---

Content here`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should handle complex YAML formatting', async () => {
      const input = `---
title:   "Article Title"
tags: [tag1, tag2]
---

Content`;

      const expected = `---
title: Article Title
tags:
  - tag1
  - tag2
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should auto-quote frontmatter values containing colons', async () => {
      const input = `---
title: Claude Codeの/batchとAgent Teams: 2つのエージェント並列実行の比較
---

Content here`;

      const expected = `---
title: "Claude Codeの/batchとAgent Teams: 2つのエージェント並列実行の比較"
---

Content here`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should auto-quote multiple frontmatter values containing colons', async () => {
      const input = `---
title: foo: bar
description: A normal description
subtitle: key: value pair here
---

Content`;

      const expected = `---
title: "foo: bar"
description: A normal description
subtitle: "key: value pair here"
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should not double-quote already quoted values with colons', async () => {
      const input = `---
title: "Already quoted: value"
---

Content`;

      const expected = `---
title: "Already quoted: value"
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should format YAML frontmatter with blank lines in arrays (4-space indent)', async () => {
      const input = `---
title: foo
description: bar
tags:
    - foo
    - mew

    - moo

---

Content here`;

      const expected = `---
title: foo
description: bar
tags:
  - foo
  - mew
  - moo
---

Content here`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should preserve hash characters in frontmatter values', async () => {
      const input = `---
title: My Post # Draft
description: Section #1 of the guide
---

Content`;

      const expected = `---
title: "My Post # Draft"
description: "Section #1 of the guide"
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should preserve date strings without converting to ISO format', async () => {
      const input = `---
title: Test
date: 2024-01-15
---

Content`;

      const expected = `---
title: Test
date: 2024-01-15
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should quote values starting with YAML indicators', async () => {
      const input = `---
tag: "!important"
ref: "*main"
---

Content`;

      const expected = `---
tag: "!important"
ref: "*main"
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should auto-quote unquoted values starting with YAML indicators', async () => {
      const input = `---
tag: !important
---

Content`;

      const expected = `---
tag: "!important"
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should preserve leading zeros in numeric values', async () => {
      const input = `---
code: "00123"
zip: "00750"
---

Content`;

      const expected = `---
code: "00123"
zip: "00750"
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should handle block scalar indicators in frontmatter without errors', async () => {
      const input = `---
title: Test
description: >
  This is a
  folded value
---

Content`;

      // yaml.load/dump round-trip normalizes folded (>) to literal (|)
      // and folds the content into a single line. The key point is no crash.
      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toContain('description:');
      expect(result).toContain('This is a folded value');
      expect(result).not.toContain('">"');
    });

    test('should properly escape values with both colons and embedded quotes', async () => {
      const input = `---
title: He said "hello: world"
---

Content`;

      const expected = `---
title: "He said \\"hello: world\\""
---

Content`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    test('should skip unsafe value fixing when fixUnsafeValues is false', async () => {
      const settingsWithoutFix = loadConfig({
        settings: {
          ...testSettings,
          formatYamlFrontmatter: { fixUnsafeValues: false },
        },
      });

      // With fixUnsafeValues disabled, the colon value won't be quoted
      // and yaml.load() will fail, so the frontmatter is left unchanged
      const input = `---
title: foo: bar
---

Content`;

      const formatter = new MdxFormatter(input, settingsWithoutFix);
      const result = await formatter.format();
      // Should be unchanged since yaml.load() fails without preprocessing
      expect(result).toBe(input);
    });
  });

  describe('Template literal indentation preservation', () => {
    it('should preserve indentation inside template literal JSX attributes', async () => {
      const input = `<CssPreview
  title="test"
  html={\`<div class="demo">
  <div class="inner">
    <p>Hello</p>
  </div>
</div>\`}
  height={320} />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should preserve CSS indentation inside template literal attributes', async () => {
      const input = `<CssPreview
  title="test"
  css={\`.demo {
  color: red;
  .inner {
    padding: 8px;
  }
}\`}
  height={320} />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should preserve indentation in multiple template literal attributes', async () => {
      const input = `<CssPreview
  title="test"
  html={\`<div class="card">
  <div class="card__header">
    <h2>Title</h2>
  </div>
  <div class="card__body">
    <p>Content</p>
  </div>
</div>\`}
  css={\`.card {
  border: 1px solid hsl(0 0% 80%);
  .card__header {
    padding: 8px 16px;
  }
  .card__body {
    padding: 16px;
  }
}\`}
  height={400} />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should preserve template literal with interpolation expressions', async () => {
      const input = `<CssPreview
  title="test"
  html={\`<div class="\${styles.demo}">
  <div class="\${styles.inner}">
    <p>Hello</p>
  </div>
</div>\`}
  height={320} />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should handle single-line template literal without breaking', async () => {
      const input = `<CssPreview
  title="test"
  html={\`<p>Simple</p>\`}
  height={320} />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should handle empty template literal without breaking', async () => {
      const input = `<CssPreview
  title="test"
  html={\`\`}
  height={320} />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should flatten template literal indentation when preserveTemplateLiteralIndent is false', async () => {
      const input = `<CssPreview
  title="test"
  html={\`<div class="demo">
  <div class="inner">
    <p>Hello</p>
  </div>
</div>\`}
  height={320} />`;

      const disabledSettings: DeepPartial<FormatterSettings> = {
        ...testSettings,
        formatMultiLineJsx: {
          ...testSettings.formatMultiLineJsx,
          preserveTemplateLiteralIndent: false,
        },
      };

      const formatter = new MdxFormatter(input, loadConfig({ settings: disabledSettings }));
      const result = await formatter.format();
      // When disabled, the formatter flattens template literal indentation
      expect(result).not.toBe(input);
      // The inner HTML lines should be trimmed and uniformly re-indented (indent + 2 = 4 spaces)
      expect(result).toContain('    <div class="inner">');
    });
  });

  describe('Table with inline JSX elements', () => {
    it('should not insert empty lines between table rows containing inline JSX elements', async () => {
      const input = `| Key | Action |
| --- | ------ |
| <kbd>Tab</kbd> | Move focus |
| <kbd>Enter</kbd> | Activate |
| <kbd>Escape</kbd> | Close |`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should not insert empty lines between table rows with mixed inline HTML elements', async () => {
      const input = `| Element | Description |
| --- | --- |
| <code>const</code> | Variable declaration |
| <strong>bold</strong> | Bold text |
| <em>italic</em> | Italic text |`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });

    it('should still add spacing after JSX components outside tables', async () => {
      const input = `<ExternalLink url="https://example.com" />
Some text after the component.`;

      const expected = `<ExternalLink url="https://example.com" />

Some text after the component.`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should maintain spacing around tables with headings and paragraphs', async () => {
      const input = `## Keyboard Shortcuts

| Key | Action |
| --- | ------ |
| <kbd>Tab</kbd> | Move focus |
| <kbd>Enter</kbd> | Activate |

Some text after the table.`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });
  });

  describe('Bug fix: TabItem closing tag duplication', () => {
    it('should not duplicate closing tags when formatting TabItem with attributes', async () => {
      const input = `<Tabs>
  <TabItem label="npm" value="npm" default>
    \`\`\`bash
    npm install zudo-doc
    \`\`\`
  </TabItem>
  <TabItem label="pnpm" value="pnpm">
    \`\`\`bash
    pnpm add zudo-doc
    \`\`\`
  </TabItem>
</Tabs>`;

      const formatter = new MdxFormatter(input, tabSettings);
      const result = await formatter.format();

      // The closing tags should NOT be duplicated
      const tabItemCloseCount = (result.match(/<\/TabItem>/g) || []).length;
      expect(tabItemCloseCount).toBe(2);

      const tabsCloseCount = (result.match(/<\/Tabs>/g) || []).length;
      expect(tabsCloseCount).toBe(1);
    });

    it('should be idempotent when formatting TabItem components', async () => {
      const input = `<Tabs>
  <TabItem label="npm" value="npm" default>
    \`\`\`bash
    npm install zudo-doc
    \`\`\`
  </TabItem>
  <TabItem label="pnpm" value="pnpm">
    \`\`\`bash
    pnpm add zudo-doc
    \`\`\`
  </TabItem>
</Tabs>`;

      const formatter1 = new MdxFormatter(input, tabSettings);
      const result1 = await formatter1.format();

      const formatter2 = new MdxFormatter(result1, tabSettings);
      const result2 = await formatter2.format();

      // Second formatting pass should produce the same result (idempotent)
      expect(result2).toBe(result1);
    });
  });

  describe('Bug fix: trailing blank line oscillation in block JSX', () => {
    it('should not oscillate trailing blank line before closing tag of block component at end of file', async () => {
      const input = `Some content before.

<Outro>

This is the outro content.
Multiple lines here.

</Outro>`;

      const formatter1 = new MdxFormatter(input, settings);
      const result1 = await formatter1.format();

      const formatter2 = new MdxFormatter(result1, settings);
      const result2 = await formatter2.format();

      // Must be idempotent - second pass should produce same result
      expect(result2).toBe(result1);
    });

    it('should not oscillate when file ends with block JSX containing a code block', async () => {
      const input = `<Danger title="Color Anti-Patterns">

**Don't use Tailwind defaults**

\`\`\`html
<!-- example -->
\`\`\`

</Danger>`;

      const formatter1 = new MdxFormatter(input, blockSettings);
      const result1 = await formatter1.format();

      const formatter2 = new MdxFormatter(result1, blockSettings);
      const result2 = await formatter2.format();

      // Must be idempotent
      expect(result2).toBe(result1);
    });

    it('should produce stable output for block JSX with code block and no trailing blank line', async () => {
      const input = `<Danger title="Anti-Patterns">

**Some bold text**

\`\`\`html
<!-- example -->
\`\`\`
</Danger>`;

      const formatter1 = new MdxFormatter(input, blockSettings);
      const result1 = await formatter1.format();

      const formatter2 = new MdxFormatter(result1, blockSettings);
      const result2 = await formatter2.format();

      // Must be idempotent
      expect(result2).toBe(result1);
    });
  });

  describe('Exact output assertions', () => {
    it('should produce exact output for single TabItem with attributes', async () => {
      const input = `<TabItem label="npm" value="npm" default>

\`\`\`bash
npm install zudo-doc
\`\`\`

</TabItem>`;

      const expected = `<TabItem label="npm" value="npm" default>

\`\`\`bash
npm install zudo-doc
\`\`\`

</TabItem>`;

      const formatter = new MdxFormatter(input, tabSettings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should produce exact output for nested Tabs > TabItem formatting', async () => {
      const input = `<Tabs>
  <TabItem label="npm" value="npm" default>
    \`\`\`bash
    npm install zudo-doc
    \`\`\`
  </TabItem>
  <TabItem label="pnpm" value="pnpm">
    \`\`\`bash
    pnpm add zudo-doc
    \`\`\`
  </TabItem>
</Tabs>`;

      const expected = `<Tabs>

  <TabItem label="npm" value="npm" default>

    \`\`\`bash
    npm install zudo-doc
    \`\`\`

  </TabItem>

  <TabItem label="pnpm" value="pnpm">

    \`\`\`bash
    pnpm add zudo-doc
    \`\`\`

  </TabItem>

</Tabs>`;

      const formatter = new MdxFormatter(input, tabSettings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should produce exact output for Danger block with code block', async () => {
      const input = `<Danger title="Color Anti-Patterns">

**Do not use Tailwind defaults**

\`\`\`html
<!-- example -->
\`\`\`

</Danger>`;

      const expected = `<Danger title="Color Anti-Patterns">

**Do not use Tailwind defaults**

\`\`\`html
<!-- example -->
\`\`\`

</Danger>`;

      const formatter = new MdxFormatter(input, blockSettings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Edge cases', () => {
    it('should handle expression attributes containing > correctly', async () => {
      const input = `<Component
  condition={a > b}
  name="test" />`;

      const expected = `<Component
  condition={a > b}
  name="test" />`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle deeply nested JSX (Tabs > TabItem > Note) without duplication', async () => {
      const deepSettings = loadConfig({
        settings: {
          ...testSettings,
          addEmptyLinesInBlockJsx: {
            blockComponents: ['Tabs', 'TabItem', 'Note'],
          },
          indentJsxContent: {
            containerComponents: ['Tabs', 'TabItem', 'Note'],
          },
        },
      });

      const input = `<Tabs>
  <TabItem label="first" value="first">
    <Note>
      Important info
    </Note>
  </TabItem>
</Tabs>`;

      const expected = `<Tabs>

  <TabItem label="first" value="first">

    <Note>

      Important info

    </Note>

  </TabItem>

</Tabs>`;

      const formatter = new MdxFormatter(input, deepSettings);
      const result = await formatter.format();
      expect(result).toBe(expected);

      // Verify no closing tag duplication
      expect((result.match(/<\/Tabs>/g) || []).length).toBe(1);
      expect((result.match(/<\/TabItem>/g) || []).length).toBe(1);
      expect((result.match(/<\/Note>/g) || []).length).toBe(1);

      // Verify idempotency
      const formatter2 = new MdxFormatter(result, deepSettings);
      const result2 = await formatter2.format();
      expect(result2).toBe(result);
    });

    it('should be idempotent for multi-line opening tag in block component (oscillation bug)', async () => {
      // When a block component has a multi-line opening tag, the formatter
      // should converge — formatting twice must produce the same output.
      const input = `<Danger
  title="Color Anti-Patterns"
>

Content here.

</Danger>`;

      const formatter1 = new MdxFormatter(input, blockSettings);
      const result1 = await formatter1.format();

      // Second pass must be identical (no oscillation)
      const formatter2 = new MdxFormatter(result1, blockSettings);
      const result2 = await formatter2.format();
      expect(result2).toBe(result1);

      // Third pass for good measure
      const formatter3 = new MdxFormatter(result2, blockSettings);
      const result3 = await formatter3.format();
      expect(result3).toBe(result2);
    });

    it('should be idempotent for multi-line opening tag block component without initial empty lines', async () => {
      // Same bug but starting without empty lines — formatJsxElement adds them,
      // then collectBlockJsxEmptyLineOperations should not re-add on next pass.
      const input = `<Danger
  title="Color Anti-Patterns"
>
Content here.
</Danger>`;

      const formatter1 = new MdxFormatter(input, blockSettings);
      const result1 = await formatter1.format();

      // Must have empty lines after opening tag and before closing tag
      expect(result1).toContain('>\n\nContent');
      expect(result1).toContain('Content here.\n\n</Danger>');

      // Second pass must be identical
      const formatter2 = new MdxFormatter(result1, blockSettings);
      const result2 = await formatter2.format();
      expect(result2).toBe(result1);
    });

    it('should handle self-closing elements inside block components', async () => {
      const input = `<InfoBox>

Some text

<ExImg src="/test.jpg" alt="test" />

</InfoBox>`;

      const expected = `<InfoBox>

Some text

<ExImg src="/test.jpg" alt="test" />

</InfoBox>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);

      // Verify InfoBox tags are not duplicated
      expect((result.match(/<\/InfoBox>/g) || []).length).toBe(1);
    });
  });
});
