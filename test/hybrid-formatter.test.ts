import { describe, it, expect, test } from 'vitest';
import { HybridFormatter } from '../src/hybrid-formatter.js';
import { testSettings } from './test-helpers.js';
import { loadConfig } from '../src/load-config.js';

const settings = loadConfig({ settings: testSettings });

describe('HybridFormatter - AST-based MDX Formatter', () => {
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should add empty line after JSX component', async () => {
      const input = `<ExImg src="/test.jpg" alt="test" />
Next paragraph`;

      const expected = `<ExImg src="/test.jpg" alt="test" />

Next paragraph`;

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should not add empty line if already exists', async () => {
      const input = `## Heading

Content here`;

      const expected = `## Heading

Content here`;

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should not add empty line between consecutive headings', async () => {
      const input = `## Heading 1
### Heading 2`;

      const expected = `## Heading 1
### Heading 2`;

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle block component with single line content', async () => {
      const input = `<InfoBox>Single line content</InfoBox>`;

      const expected = `<InfoBox>

Single line content

</InfoBox>`;

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty content', async () => {
      const input = '';
      const expected = '';

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle content with only whitespace', async () => {
      const input = '   \n\n   ';
      const expected = '';

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should not format JSX inside code blocks', async () => {
      const input = `Here is code:

\`\`\`jsx
<Component prop1="value1" prop2="value2" prop3="value3" />
\`\`\`

<Component prop1="value1" prop2="value2" prop3="value3" />`;

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(input);
    });
  });

  describe('Settings and Configuration', () => {
    it('should respect disabled rules', async () => {
      const input = `<ExImg src="/test.jpg" alt="test" className="center" />`;

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      formatter.settings.formatMultiLineJsx.indentSize = 4;

      const expected = `<ExImg
    src="/test.jpg"
    alt="test" />`;

      const result = await formatter.format();
      expect(result).toBe(expected);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });
});
