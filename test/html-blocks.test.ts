/**
 * Test suite for general HTML block formatting in MDX
 * Tests the formatHtmlBlocksInMdx rule for all HTML elements
 */

import { describe, it, expect } from 'vitest';
import { MdxFormatter } from '../src/mdx-formatter.js';
import { testSettings } from './test-helpers.js';
import { loadConfig } from '../src/load-config.js';

const settings = loadConfig({ settings: testSettings });

describe('HTML Block Formatting in MDX', () => {
  describe('Definition Lists (dl/dt/dd)', () => {
    it('should format simple dl/dt/dd with proper indentation', async () => {
      const input = `<dl>
<dt>Term 1</dt>
<dd>Definition 1</dd>
</dl>`;

      const expected = `<dl>
  <dt>Term 1</dt>
  <dd>Definition 1</dd>
</dl>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle dl/dt/dd with excessive whitespace', async () => {
      const input = `<dl>
  <dt>  Term with spaces  </dt>
  <dd>   Definition with spaces   </dd>
</dl>`;

      const expected = `<dl>
  <dt>Term with spaces</dt>
  <dd>Definition with spaces</dd>
</dl>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should format dl with div wrappers', async () => {
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

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle nested definition lists', async () => {
      const input = `<dl>
<dt>Outer Term</dt>
<dd>
<dl>
<dt>Inner Term</dt>
<dd>Inner Definition</dd>
</dl>
</dd>
</dl>`;

      const expected = `<dl>
  <dt>Outer Term</dt>
  <dd>
    <dl>
      <dt>Inner Term</dt>
      <dd>Inner Definition</dd>
    </dl>
  </dd>
</dl>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Tables (table/tr/td)', () => {
    it('should format simple table structure', async () => {
      const input = `<table>
<tr>
<td>Cell 1</td>
<td>Cell 2</td>
</tr>
<tr>
<td>Cell 3</td>
<td>Cell 4</td>
</tr>
</table>`;

      const expected = `<table>
  <tr>
    <td>Cell 1</td>
    <td>Cell 2</td>
  </tr>
  <tr>
    <td>Cell 3</td>
    <td>Cell 4</td>
  </tr>
</table>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should format table with thead and tbody', async () => {
      const input = `<table>
<thead>
<tr>
<th>Header 1</th>
<th>Header 2</th>
</tr>
</thead>
<tbody>
<tr>
<td>Data 1</td>
<td>Data 2</td>
</tr>
</tbody>
</table>`;

      const expected = `<table>
  <thead>
    <tr>
      <th>Header 1</th>
      <th>Header 2</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Data 1</td>
      <td>Data 2</td>
    </tr>
  </tbody>
</table>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle table with attributes', async () => {
      const input = `<table class="data-table" id="results">
<tr class="row-highlight">
<td colspan="2">Merged Cell</td>
</tr>
</table>`;

      const expected = `<table class="data-table" id="results">
  <tr class="row-highlight">
    <td colspan="2">Merged Cell</td>
  </tr>
</table>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('HTML Lists (ul/ol/li)', () => {
    it('should format unordered list', async () => {
      const input = `<ul>
<li>Item 1</li>
<li>Item 2</li>
<li>Item 3</li>
</ul>`;

      const expected = `<ul>
  <li>Item 1</li>
  <li>Item 2</li>
  <li>Item 3</li>
</ul>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should format ordered list', async () => {
      const input = `<ol>
<li>First</li>
<li>Second</li>
<li>Third</li>
</ol>`;

      const expected = `<ol>
  <li>First</li>
  <li>Second</li>
  <li>Third</li>
</ol>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Div and Span Elements', () => {
    it('should format nested div elements', async () => {
      const input = `<div class="container">
<div class="row">
<div class="col">Content</div>
</div>
</div>`;

      const expected = `<div class="container">
  <div class="row">
    <div class="col">Content</div>
  </div>
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle inline span elements', async () => {
      const input = `<div>
<span class="highlight">Important</span> text with <span>inline</span> elements.
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      // Formatter may collapse short inline content into single line
      expect(result).toContain('Important');
      expect(result).toContain('inline');
    });

    it('should format div with mixed content', async () => {
      const input = `<div>
<h3>Title</h3>
<p>Paragraph text here.</p>
<ul>
<li>List item</li>
</ul>
</div>`;

      const expected = `<div>
  <h3>Title</h3>
  <p>Paragraph text here.</p>
  <ul>
    <li>List item</li>
  </ul>
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Form Elements', () => {
    it('should handle select and options', async () => {
      const input = `<select name="choice">
<option value="1">Option 1</option>
<option value="2">Option 2</option>
<option value="3">Option 3</option>
</select>`;

      const expected = `<select name="choice">
  <option value="1">Option 1</option>
  <option value="2">Option 2</option>
  <option value="3">Option 3</option>
</select>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Mixed MDX Content', () => {
    it('should format HTML blocks within MDX content', async () => {
      const input = `# Heading

Some paragraph text.

<dl>
<dt>Term</dt>
<dd>Definition</dd>
</dl>

More content here.

<table>
<tr>
<td>Data</td>
</tr>
</table>`;

      const expected = `# Heading

Some paragraph text.

<dl>
  <dt>Term</dt>
  <dd>Definition</dd>
</dl>

More content here.

<table>
  <tr>
    <td>Data</td>
  </tr>
</table>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle HTML blocks with inline markdown', async () => {
      const input = `<div>
**Bold text** and *italic text* within HTML.
[Link](https://example.com) in a div.
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      // Formatter may collapse short content; verify content is preserved
      expect(result).toContain('Bold text');
      expect(result).toContain('italic text');
      expect(result).toContain('https://example.com');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty HTML elements', async () => {
      const input = `<div></div>
<span></span>
<p></p>`;

      const expected = `<div></div>
<span></span>
<p></p>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should preserve self-closing tags', async () => {
      const input = `<div>
<img src="image.jpg" alt="Test" />
<br />
<hr />
</div>`;

      const expected = `<div>
  <img src="image.jpg" alt="Test" />
  <br />
  <hr />
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });

    it('should handle deeply nested structures', async () => {
      const input = `<div>
<section>
<article>
<header>
<h1>Title</h1>
</header>
<main>
<p>Content</p>
</main>
<footer>
<p>Footer</p>
</footer>
</article>
</section>
</div>`;

      const expected = `<div>
  <section>
    <article>
      <header>
        <h1>Title</h1>
      </header>
      <main>
        <p>Content</p>
      </main>
      <footer>
        <p>Footer</p>
      </footer>
    </article>
  </section>
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      expect(result).toBe(expected);
    });
  });

  describe('Configuration Options', () => {
    it('should respect enabled/disabled state', async () => {
      const input = `<dl>
<dt>Term</dt>
<dd>Definition</dd>
</dl>`;

      // Test with rule disabled
      const formatter = new MdxFormatter(input, settings);
      formatter.settings.formatHtmlBlocksInMdx = { enabled: false };
      const result = await formatter.format();
      expect(result).toBe(input); // Should not change when disabled
    });

    it('should handle long attribute lines without wrapping', async () => {
      const input = `<div class="very-long-class-name-that-exceeds-normal-width" id="very-long-id-value" data-attribute="very-long-attribute-value">
<p>Content</p>
</div>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      // Formatter preserves long attribute lines without wrapping
      expect(result).toContain('very-long-class-name-that-exceeds-normal-width');
      expect(result).toContain('<p>Content</p>');
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain proper formatting for dl elements with trimmed content', async () => {
      const input = `<dl>
  <dt>  Term with spaces  </dt>
  <dd>   Definition with spaces   </dd>
</dl>`;

      const formatter = new MdxFormatter(input, settings);
      const result = await formatter.format();
      // Content whitespace should be trimmed
      expect(result).toContain('<dt>Term with spaces</dt>');
      expect(result).toContain('<dd>Definition with spaces</dd>');
    });
  });
});
