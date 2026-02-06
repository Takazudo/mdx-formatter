import { describe, it, expect } from 'vitest';
import { HybridFormatter } from '../src/hybrid-formatter.js';
import { testSettings } from './test-helpers.js';
import { loadConfig } from '../src/load-config.js';

const settings = loadConfig({ settings: testSettings });

describe('HTML Duplication Bug - TDD Tests', () => {
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
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

      const formatter = new HybridFormatter(input, settings);
      const result = await formatter.format();

      // CustomComponent should be preserved as JSX
      expect(result).toContain('<CustomComponent />');
      expect(result.match(/<\/div>/g)?.length).toBe(1);
      expect(result.match(/<\/p>/g)?.length).toBe(1);
    });
  });
});
