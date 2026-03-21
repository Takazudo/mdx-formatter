/**
 * HTML Block Formatter
 * Formats HTML blocks within MDX content using Prettier or built-in formatting
 */

import * as prettier from 'prettier';
import type { FormatHtmlBlocksInMdxSetting } from './types.js';

// Module-level constant — avoids rebuilding on every instantiation
const HTML_ELEMENTS = new Set([
  // Structure
  'html',
  'head',
  'body',
  'div',
  'span',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'figure',
  'figcaption',
  // Text
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'i',
  'b',
  'u',
  's',
  'mark',
  'small',
  'del',
  'ins',
  'sub',
  'sup',
  'cite',
  'q',
  'abbr',
  'address',
  'time',
  // Lists
  'ul',
  'ol',
  'li',
  'dl',
  'dt',
  'dd',
  // Tables
  'table',
  'thead',
  'tbody',
  'tfoot',
  'tr',
  'td',
  'th',
  'caption',
  'colgroup',
  'col',
  // Forms
  'form',
  'input',
  'textarea',
  'button',
  'select',
  'option',
  'optgroup',
  'label',
  'fieldset',
  'legend',
  'datalist',
  'output',
  'progress',
  'meter',
  // Media
  'img',
  'audio',
  'video',
  'source',
  'track',
  'picture',
  'iframe',
  'embed',
  'object',
  'param',
  'canvas',
  'svg',
  // Other
  'a',
  'br',
  'hr',
  'details',
  'summary',
  'dialog',
  'menu',
  'menuitem',
  'script',
  'noscript',
  'template',
  'slot',
]);

export class HtmlBlockFormatter {
  private settings: FormatHtmlBlocksInMdxSetting;

  constructor(settings: Partial<FormatHtmlBlocksInMdxSetting> = {}) {
    this.settings = {
      enabled: true,
      description: '',
      formatterConfig: {
        parser: 'html',
        tabWidth: 2,
        useTabs: false,
      },
      ...settings,
    } as FormatHtmlBlocksInMdxSetting;
  }

  /**
   * Check if a tag name is an HTML element (not a JSX component)
   */
  isHtmlElement(tagName: string): boolean {
    if (!tagName) return false;
    // HTML elements are lowercase or known HTML elements
    return HTML_ELEMENTS.has(tagName.toLowerCase());
  }

  /**
   * Format HTML content using Prettier
   */
  async formatWithPrettier(html: string): Promise<string> {
    try {
      // Preprocess: Remove newlines within dd and dt tags to keep them on single lines
      // This is important for Japanese text readability in definition lists
      const preprocessed = html
        .replace(/<dd>([\s\S]*?)<\/dd>/g, (_match, content: string) => {
          // Replace multiple whitespaces (including newlines) with single space
          const cleaned = content.replace(/\s+/g, ' ').trim();
          return `<dd>${cleaned}</dd>`;
        })
        .replace(/<dt>([\s\S]*?)<\/dt>/g, (_match, content: string) => {
          // Same for dt tags
          const cleaned = content.replace(/\s+/g, ' ').trim();
          return `<dt>${cleaned}</dt>`;
        });

      const formatted = await prettier.format(preprocessed, {
        parser: this.settings.formatterConfig.parser || 'html',
        printWidth: 999999, // Never wrap lines
        tabWidth: this.settings.formatterConfig.tabWidth ?? 2,
        useTabs: this.settings.formatterConfig.useTabs || false,
        htmlWhitespaceSensitivity: 'css', // Use CSS mode to handle whitespace better
        bracketSameLine: true, // Keep closing bracket on same line to prevent broken tags
        singleAttributePerLine: false,
      });

      // Remove trailing newline that prettier adds
      let result = formatted.replace(/\n$/, '');

      // Remove self-closing slashes from void elements if not present in original
      // This maintains compatibility with existing MDX content
      const voidElements = ['input', 'br', 'hr', 'img', 'meta', 'link'];
      for (const elem of voidElements) {
        const originalHasSelfClosing = new RegExp(`<${elem}[^>]*/>`, 'i').test(html);
        if (!originalHasSelfClosing) {
          // Remove the self-closing slash that Prettier adds
          result = result.replace(new RegExp(`(<${elem}[^>]*?)\\s*/>`, 'gi'), '$1>');
        }
      }

      // Special handling for dt/dd tags - trim content inside them
      // This preserves the original formatting requirement for definition lists
      result = result.replace(/<(dt|dd)>\s*(.*?)\s*<\/(dt|dd)>/g, '<$1>$2</$1>');

      return result;
    } catch {
      return html;
    }
  }
}
