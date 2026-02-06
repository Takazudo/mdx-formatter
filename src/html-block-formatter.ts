/**
 * HTML Block Formatter
 * Formats HTML blocks within MDX content using Prettier or built-in formatting
 */

import * as prettier from 'prettier';
import type { FormatHtmlBlocksInMdxSetting } from './types.js';

interface HtmlBlockFormatterSettings {
  enabled?: boolean;
  formatterConfig: {
    parser: string;
    tabWidth: number;
    useTabs: boolean;
  };
}

export class HtmlBlockFormatter {
  settings: HtmlBlockFormatterSettings;
  htmlElements: Set<string>;

  constructor(settings: Partial<FormatHtmlBlocksInMdxSetting> = {}) {
    this.settings = {
      formatterConfig: {
        parser: 'html',
        tabWidth: 2,
        useTabs: false,
      },
      ...settings,
    } as HtmlBlockFormatterSettings;

    // List of HTML elements (not JSX components which start with uppercase)
    this.htmlElements = new Set([
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
  }

  /**
   * Check if a tag name is an HTML element (not a JSX component)
   */
  isHtmlElement(tagName: string): boolean {
    if (!tagName) return false;
    // HTML elements are lowercase or known HTML elements
    return this.htmlElements.has(tagName.toLowerCase());
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
        tabWidth: this.settings.formatterConfig.tabWidth || 2,
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

  /**
   * Extract HTML block from position in original content
   */
  extractHtmlBlock(
    content: string,
    startPos: { line: number; column: number },
    endPos: { line: number; column: number },
  ): string {
    const lines = content.split('\n');
    const startLine = startPos.line - 1;
    const endLine = endPos.line - 1;
    const startCol = startPos.column - 1;
    const endCol = endPos.column - 1;

    if (startLine === endLine) {
      // Single line
      return lines[startLine].substring(startCol, endCol);
    } else {
      // Multi-line
      const extractedLines: string[] = [];
      extractedLines.push(lines[startLine].substring(startCol));

      for (let i = startLine + 1; i < endLine; i++) {
        extractedLines.push(lines[i]);
      }

      extractedLines.push(lines[endLine].substring(0, endCol));
      return extractedLines.join('\n');
    }
  }

  /**
   * Find matching closing tag for an opening tag
   */
  findMatchingClosingTag(content: string, startIndex: number, tagName: string): number {
    let depth = 1;
    let index = startIndex;
    const openPattern = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'gi');
    const closePattern = new RegExp(`<\\/${tagName}>`, 'gi');

    while (depth > 0 && index < content.length) {
      // Reset lastIndex for each search
      openPattern.lastIndex = index;
      closePattern.lastIndex = index;

      const openMatch = openPattern.exec(content);
      const closeMatch = closePattern.exec(content);

      if (!closeMatch) {
        // No closing tag found
        return -1;
      }

      if (!openMatch || closeMatch.index < openMatch.index) {
        // Found closing tag before next opening tag
        depth--;
        index = closeMatch.index + closeMatch[0].length;
      } else {
        // Found opening tag before closing tag
        depth++;
        index = openMatch.index + openMatch[0].length;
      }
    }

    return depth === 0 ? index : -1;
  }

  /**
   * Format MDX content with HTML block formatting
   */
  async format(content: string): Promise<string> {
    if (!this.settings.enabled) {
      return content;
    }

    try {
      // Find HTML blocks - handle nested tags properly
      const blocks: { start: number; end: number; content: string; tagName: string }[] = [];
      const processedRanges = new Set<[number, number]>();

      // First pass: find all opening tags
      const openingTagPattern = /<(\w+)(?:\s[^>]*)?>(?!.*\/>)/g;
      let match;

      while ((match = openingTagPattern.exec(content)) !== null) {
        const tagName = match[1];
        if (this.isHtmlElement(tagName)) {
          const startIndex = match.index;
          const afterOpenTag = match.index + match[0].length;

          // Find the matching closing tag
          const endIndex = this.findMatchingClosingTag(content, afterOpenTag, tagName);

          if (endIndex !== -1) {
            // Check if this range overlaps with any processed range
            let overlaps = false;
            for (const range of processedRanges) {
              if (
                (startIndex >= range[0] && startIndex < range[1]) ||
                (endIndex > range[0] && endIndex <= range[1])
              ) {
                overlaps = true;
                break;
              }
            }

            if (!overlaps) {
              blocks.push({
                start: startIndex,
                end: endIndex,
                content: content.substring(startIndex, endIndex),
                tagName: tagName,
              });
              processedRanges.add([startIndex, endIndex]);
            }
          }
        }
      }

      // Also handle self-closing tags
      const selfClosingPattern = /<(\w+)(?:\s[^>]*)?\/>/g;
      while ((match = selfClosingPattern.exec(content)) !== null) {
        const tagName = match[1];
        if (this.isHtmlElement(tagName)) {
          const startIndex = match.index;
          const endIndex = match.index + match[0].length;

          // Check if this is within an already processed block
          let inBlock = false;
          for (const range of processedRanges) {
            if (startIndex >= range[0] && endIndex <= range[1]) {
              inBlock = true;
              break;
            }
          }

          if (!inBlock) {
            blocks.push({
              start: startIndex,
              end: endIndex,
              content: match[0],
              tagName: tagName,
            });
          }
        }
      }

      // Sort blocks by position (reverse order to maintain positions)
      blocks.sort((a, b) => b.start - a.start);

      // Apply formatting to each HTML block
      let result = content;
      for (const block of blocks) {
        // Always use Prettier for HTML formatting
        const formatted = await this.formatWithPrettier(block.content);

        // Replace the original HTML with formatted version
        result = result.substring(0, block.start) + formatted + result.substring(block.end);
      }

      return result;
    } catch {
      return content;
    }
  }

  /**
   * Replace HTML block in content with formatted version
   */
  replaceHtmlBlock(
    content: string,
    startPos: { line: number; column: number },
    endPos: { line: number; column: number },
    replacement: string,
  ): string {
    const lines = content.split('\n');
    const startLine = startPos.line - 1;
    const endLine = endPos.line - 1;
    const startCol = startPos.column - 1;
    const endCol = endPos.column - 1;

    if (startLine === endLine) {
      // Single line replacement
      lines[startLine] =
        lines[startLine].substring(0, startCol) + replacement + lines[startLine].substring(endCol);
    } else {
      // Multi-line replacement
      const replacementLines = replacement.split('\n');

      // Create new line array
      const newLines: string[] = [];

      // Add lines before the block
      for (let i = 0; i < startLine; i++) {
        newLines.push(lines[i]);
      }

      // Add first line (partial) + first replacement line
      if (replacementLines.length === 1) {
        // Single line replacement for multi-line original
        newLines.push(
          lines[startLine].substring(0, startCol) +
            replacementLines[0] +
            lines[endLine].substring(endCol),
        );
      } else {
        // Multi-line replacement
        newLines.push(lines[startLine].substring(0, startCol) + replacementLines[0]);

        // Add middle replacement lines
        for (let i = 1; i < replacementLines.length - 1; i++) {
          newLines.push(replacementLines[i]);
        }

        // Add last replacement line + rest of last original line
        newLines.push(
          replacementLines[replacementLines.length - 1] + lines[endLine].substring(endCol),
        );
      }

      // Add lines after the block
      for (let i = endLine + 1; i < lines.length; i++) {
        newLines.push(lines[i]);
      }

      return newLines.join('\n');
    }

    return lines.join('\n');
  }
}
