/**
 * SpecificFormatter - Applies only specific formatting rules to MDX content
 * Does NOT reformat everything, only applies targeted fixes
 */

import { formatterSettings } from './settings.js';
import { HtmlBlockFormatter } from './html-block-formatter.js';
import { deepCloneSettings } from './utils.js';
import type { FormatterSettings, JsxStackEntry } from './types.js';

export class SpecificFormatter {
  content: string;
  lines: string[];
  settings: FormatterSettings;

  constructor(content: string, settings: FormatterSettings | null = null) {
    // Normalize line endings to \n
    this.content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    this.lines = this.content.split('\n');
    this.settings = settings ? deepCloneSettings(settings) : deepCloneSettings(formatterSettings);
  }

  async format(): Promise<string> {
    let result = this.content;

    // Apply rules in specific order to avoid conflicts

    // HTML block formatting
    if (this.settings.formatHtmlBlocksInMdx && this.settings.formatHtmlBlocksInMdx.enabled) {
      const htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx);
      result = await htmlFormatter.format(result);
    }

    if (this.settings.expandSingleLineJsx.enabled) {
      result = this.expandSingleLineJsx(result);
    }

    // Combined JSX formatting - do multi-line first, then content indenting
    if (this.settings.formatMultiLineJsx.enabled || this.settings.indentJsxContent.enabled) {
      result = this.formatJsxStructure(result);
    }

    if (this.settings.addEmptyLineBetweenElements.enabled) {
      result = this.addEmptyLineBetweenElements(result);
    }

    if (this.settings.preserveAdmonitions.enabled) {
      // Admonitions are preserved by not touching them
      // This is handled in other methods by detecting and skipping them
    }

    if (this.settings.errorHandling.throwOnError) {
      this.validateMdx(result);
    }

    return result;
  }

  /**
   * Rule 1: Add 1 empty line between elements
   */
  addEmptyLineBetweenElements(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inCodeBlock = false;
    let inJsxBlock = false;
    let inAdmonition = false;
    let inFrontmatter = false;
    let jsxDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = lines[i + 1] || '';
      const trimmedLine = line.trim();
      const trimmedNext = nextLine.trim();

      // Track frontmatter (YAML between --- markers at start of file)
      if (i === 0 && line === '---') {
        inFrontmatter = true;
      } else if (inFrontmatter && line === '---') {
        inFrontmatter = false;
      }

      // Track code blocks
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
      }

      // Track admonitions
      if (line.match(/^:::(note|tip|info|warning|danger|caution)/)) {
        inAdmonition = true;
      } else if (inAdmonition && line === ':::') {
        inAdmonition = false;
      }

      // Track JSX blocks
      if (!inCodeBlock && !inAdmonition && !inFrontmatter) {
        const openTags = (line.match(/<[A-Z][^>]*(?<!\/\s*)>/g) || []).length;
        const closeTags = (line.match(/<\/[A-Z][^>]*>/g) || []).length;
        jsxDepth += openTags - closeTags;
        inJsxBlock = jsxDepth > 0;
      }

      result.push(line);

      // Don't add empty lines inside code blocks, JSX blocks, admonitions, or frontmatter
      if (inCodeBlock || inJsxBlock || inAdmonition || inFrontmatter) {
        continue;
      }

      // Check if we need to add an empty line
      if (i < lines.length - 1 && trimmedLine && trimmedNext && nextLine !== '') {
        const needsEmptyLine = this.shouldAddEmptyLine(line, nextLine);

        // Only add if there isn't already an empty line
        if (needsEmptyLine && lines[i + 1] !== '') {
          result.push('');
        }
      }
    }

    // Remove multiple consecutive empty lines (normalize to 1)
    return result.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  shouldAddEmptyLine(currentLine: string, nextLine: string): boolean {
    const current = currentLine.trim();
    const next = nextLine.trim();

    // Heading followed by anything
    if (current.match(/^#{1,6}\s/)) return true;

    // Anything followed by heading
    if (next.match(/^#{1,6}\s/)) return true;

    // List followed by paragraph
    if (current.match(/^[-*+]\s/) && !next.match(/^[-*+]\s/)) return true;

    // Paragraph followed by list
    if (!current.match(/^[-*+]\s/) && next.match(/^[-*+]\s/)) return true;

    // Code block boundaries
    if (current.startsWith('```')) return true;
    if (next.startsWith('```')) return true;

    // JSX component boundaries (both single line and multi-line)
    if (current.match(/^<[A-Z].*\/>$/)) return true;
    if (next.match(/^<[A-Z].*\/>$/)) return true;
    if (current.match(/^<\/[A-Z]/)) return true; // Closing JSX tag
    if (next.match(/^<[A-Z]/)) return true; // Opening JSX tag

    // Admonition boundaries
    if (current === ':::') return true;
    if (next.match(/^:::(note|tip|info|warning|danger|caution)/)) return true;

    return false;
  }

  /**
   * Combined JSX formatting - handles structure and content indentation together
   */
  formatJsxStructure(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    const jsxStack: JsxStackEntry[] = [];
    let inCodeBlock = false;

    const containerComponents = this.settings.indentJsxContent.containerComponents;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Handle code blocks - but still apply indentation if inside JSX
      if (trimmed.startsWith('```')) {
        if (jsxStack.length > 0) {
          // Code block inside JSX - apply indentation
          const baseIndent = '  '.repeat(jsxStack.length);
          result.push(baseIndent + trimmed);
          inCodeBlock = !inCodeBlock;
        } else {
          // Code block outside JSX - no indentation
          result.push(line);
          inCodeBlock = !inCodeBlock;
        }
        continue;
      }

      if (inCodeBlock) {
        if (jsxStack.length > 0) {
          // Inside code block within JSX - apply indentation
          const baseIndent = '  '.repeat(jsxStack.length);
          result.push(baseIndent + trimmed);
        } else {
          // Inside code block outside JSX - preserve as is
          result.push(line);
        }
        continue;
      }

      // Handle JSX tags
      if (trimmed.match(/^<([A-Z][A-Za-z0-9]*)(?:\s[^>]*)?>$/)) {
        // Opening tag
        const tagMatch = trimmed.match(/^<([A-Z][A-Za-z0-9]*)/);
        const tagName = tagMatch![1];

        // Add appropriate indentation
        const indent = '  '.repeat(jsxStack.length);
        result.push(indent + trimmed);

        // Push to stack if not self-closing
        if (!trimmed.endsWith('/>')) {
          jsxStack.push({
            name: tagName,
            isContainer: containerComponents.includes(tagName),
            hasContent: false,
          });
        }
      } else if (trimmed.match(/^<\/([A-Z][A-Za-z0-9]*)>$/)) {
        // Closing tag
        jsxStack.pop();
        const indent = '  '.repeat(jsxStack.length);
        result.push(indent + trimmed);
      } else if (jsxStack.length > 0) {
        // Content inside JSX
        const currentTag = jsxStack[jsxStack.length - 1];
        const baseIndent = '  '.repeat(jsxStack.length);

        // Add spacing between heading and content if needed
        if (trimmed.match(/^#{1,6}\s/) && currentTag.hasContent) {
          // This is a heading after some content, add blank line before
          result.push('');
        }

        // If the line is empty, just push empty line (no indent)
        if (trimmed === '') {
          result.push('');
        } else {
          result.push(baseIndent + trimmed);
        }

        // Check if we need to add blank line after heading
        if (trimmed.match(/^#{1,6}\s/)) {
          // Look ahead to see if next line is content
          if (
            i + 1 < lines.length &&
            lines[i + 1].trim() &&
            !lines[i + 1].trim().match(/^#{1,6}\s/)
          ) {
            result.push('');
          }
        }

        if (trimmed !== '') {
          currentTag.hasContent = true;
        }
      } else {
        // Regular content outside JSX
        result.push(line);
      }
    }

    return result.join('\n');
  }

  /**
   * Rule 4: Expand single-line JSX with 2+ props
   */
  expandSingleLineJsx(content: string): string {
    const threshold = this.settings.expandSingleLineJsx.propsThreshold;

    // First, handle self-closing tags - use more careful parsing
    const lines = content.split('\n');
    const processedLines = lines.map((line) => {
      // Look for JSX components
      if (line.includes('<') && line.includes('/>')) {
        // Parse more carefully
        const startMatch = line.match(/<([A-Z][A-Za-z0-9]*)\s+/);
        if (startMatch) {
          const componentName = startMatch[1];
          const startIndex = line.indexOf(startMatch[0]);
          const endIndex = line.lastIndexOf('/>');

          if (endIndex > startIndex) {
            const fullTag = line.substring(startIndex, endIndex + 2);
            const propsStart = startMatch[0].length;
            const propsString = fullTag.substring(propsStart, fullTag.length - 2).trim();

            // Parse and count props
            const props = this.parseJsxProps(propsString);

            if (props.length >= threshold) {
              // Format as multi-line
              let result = `<${componentName}`;
              props.forEach((prop) => {
                result += `\n  ${prop}`;
              });
              result += '\n/>';

              // Replace in line
              return line.substring(0, startIndex) + result + line.substring(endIndex + 2);
            }
          }
        }
      }
      return line;
    });

    content = processedLines.join('\n');

    // Then handle opening tags with content
    content = content.replace(
      /<([A-Z][A-Za-z0-9]*)\s+([^>]+)>([^<]*)<\/\1>/g,
      (match, componentName: string, propsString: string, innerContent: string) => {
        // Parse and count props
        const props = this.parseJsxProps(propsString);

        if (props.length >= threshold) {
          // Format as multi-line
          let result = `<${componentName}`;
          props.forEach((prop) => {
            result += `\n  ${prop}`;
          });
          result += '\n>\n  ' + innerContent.trim() + `\n</${componentName}>`;

          return result;
        }

        return match;
      },
    );

    return content;
  }

  parseJsxProps(propsString: string): string[] {
    const props: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    let braceDepth = 0;
    let i = 0;

    while (i < propsString.length) {
      const char = propsString[i];

      if (!inQuotes && braceDepth === 0 && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (inQuotes && char === quoteChar && propsString[i - 1] !== '\\') {
        inQuotes = false;
        quoteChar = '';
        current += char;
      } else if (!inQuotes && char === '{') {
        braceDepth++;
        current += char;
      } else if (!inQuotes && char === '}') {
        braceDepth--;
        current += char;
      } else if (!inQuotes && braceDepth === 0 && char === ' ') {
        if (current.trim()) {
          props.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }

      i++;
    }

    if (current.trim()) {
      props.push(current.trim());
    }

    return props;
  }

  /**
   * Rule 7: Validate MDX and throw errors on invalid content
   */
  validateMdx(content: string): boolean {
    // First, remove all code blocks and inline code to avoid false positives
    let cleanedContent = content;

    // Remove fenced code blocks (```...```)
    cleanedContent = cleanedContent.replace(/```[\s\S]*?```/g, '');

    // Remove inline code (`...`)
    cleanedContent = cleanedContent.replace(/`[^`]*`/g, '');

    // Now validate only the cleaned content

    // Simple check for unclosed quotes - but be more careful with complex props
    const lines = cleanedContent.split('\n');
    for (const line of lines) {
      // Check for unclosed quotes in simpler cases
      let inString = false;
      let stringChar = '';
      let braceDepth = 0;

      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const prevChar = i > 0 ? line[i - 1] : '';

        if (!inString && (char === '"' || char === "'")) {
          inString = true;
          stringChar = char;
        } else if (inString && char === stringChar && prevChar !== '\\') {
          inString = false;
          stringChar = '';
        } else if (!inString && char === '{') {
          braceDepth++;
        } else if (!inString && char === '}') {
          braceDepth--;
        }
      }

      // Only throw error if we have unmatched quotes outside of braces
      if (inString && braceDepth === 0 && line.includes('<') && line.includes('=')) {
        throw new Error('Invalid MDX: Unclosed attribute quotes');
      }
    }

    // Check for unclosed JSX tags, but handle self-closing tags properly
    const openTags: string[] = [];

    // Parse JSX tags more carefully to handle complex props
    let i = 0;
    while (i < cleanedContent.length) {
      if (cleanedContent[i] === '<') {
        // Check if it's a closing tag
        if (cleanedContent[i + 1] === '/') {
          // Find the closing tag name
          let j = i + 2;
          while (j < cleanedContent.length && cleanedContent[j].match(/[A-Za-z0-9]/)) {
            j++;
          }
          if (j > i + 2 && cleanedContent[j] === '>') {
            const tagName = cleanedContent.substring(i + 2, j);
            if (tagName[0] === tagName[0].toUpperCase()) {
              const lastOpen = openTags.pop();
              if (lastOpen !== tagName) {
                throw new Error(
                  `Invalid MDX: Mismatched JSX tags. Expected </${lastOpen}> but found </${tagName}>`,
                );
              }
            }
            i = j + 1;
            continue;
          }
        }
        // Check if it's an opening tag (starts with capital letter)
        else if (cleanedContent[i + 1] && cleanedContent[i + 1].match(/[A-Z]/)) {
          // Find the tag name
          let j = i + 1;
          while (j < cleanedContent.length && cleanedContent[j].match(/[A-Za-z0-9]/)) {
            j++;
          }
          const tagName = cleanedContent.substring(i + 1, j);

          // Make sure this is actually a JSX tag (next char should be space, /, or >)
          if (j < cleanedContent.length && !cleanedContent[j].match(/[\s\/>]/)) {
            // Not a JSX tag, skip it
            i++;
            continue;
          }

          // Now skip to the end of the tag, handling props properly
          let inStr = false;
          let strChar = '';
          let brDepth = 0;
          let isSelfClosing = false;

          while (j < cleanedContent.length) {
            const char = cleanedContent[j];
            const prevChar = j > 0 ? cleanedContent[j - 1] : '';

            if (!inStr && (char === '"' || char === "'")) {
              inStr = true;
              strChar = char;
            } else if (inStr && char === strChar && prevChar !== '\\') {
              inStr = false;
            } else if (!inStr && char === '{') {
              brDepth++;
            } else if (!inStr && char === '}') {
              brDepth--;
            } else if (!inStr && brDepth === 0 && char === '/' && cleanedContent[j + 1] === '>') {
              isSelfClosing = true;
              j += 2;
              break;
            } else if (!inStr && brDepth === 0 && char === '>') {
              j++;
              break;
            }
            j++;
          }

          if (!isSelfClosing) {
            openTags.push(tagName);
          }

          i = j;
          continue;
        }
      }
      i++;
    }

    if (openTags.length > 0) {
      throw new Error(`Invalid MDX: Unclosed JSX tags: ${openTags.join(', ')}`);
    }

    // Check for invalid nesting (simplified check)
    if (cleanedContent.includes('<p>') && cleanedContent.includes('<div>')) {
      // Check if div is inside p (invalid in HTML/MDX)
      const invalidNesting = /<p[^>]*>[\s\S]*?<div[^>]*>[\s\S]*?<\/div>[\s\S]*?<\/p>/;
      if (invalidNesting.test(cleanedContent)) {
        throw new Error('Invalid MDX: <div> cannot be nested inside <p>');
      }
    }

    return true;
  }
}
