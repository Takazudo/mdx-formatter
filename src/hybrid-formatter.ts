/**
 * HybridFormatter - Uses AST analysis to apply targeted fixes
 * This implements the proper hybrid approach from the plan
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';
import yaml from 'js-yaml';
import { formatterSettings } from './settings.js';
import { HtmlBlockFormatter } from './html-block-formatter.js';
import { IndentDetector } from './indent-detector.js';
import { deepCloneSettings } from './utils.js';
import type {
  FormatterSettings,
  FormatterOperation,
  PositionMapEntry,
  IndentDetectorLike,
  MdxJsxElement,
  MdxJsxAttribute,
  MdxJsxAttributeValueExpression,
  Root,
  Node,
  Parent,
} from './types.js';

interface AstNodeWithPosition extends Node {
  position: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

interface HeadingNode extends AstNodeWithPosition {
  type: 'heading';
}

interface YamlNode extends AstNodeWithPosition {
  type: 'yaml';
  value: string;
}

interface ListNode extends AstNodeWithPosition {
  type: 'list';
  children: ListItemNode[];
}

interface ListItemNode extends AstNodeWithPosition {
  type: 'listItem';
  children: Node[];
}

export class HybridFormatter {
  originalContent: string;
  content: string;
  lines: string[];
  settings: FormatterSettings;
  ast: Root;
  positionMap: PositionMapEntry[];
  indentDetector: IndentDetectorLike | null;

  constructor(content: string, settings: FormatterSettings | null = null) {
    this.originalContent = content;
    this.content = content; // Use content directly without preprocessing
    this.lines = this.content.split('\n');
    this.settings = settings ? deepCloneSettings(settings) : deepCloneSettings(formatterSettings);
    this.indentDetector = null;

    // Auto-detect indentation if enabled
    if (this.settings.autoDetectIndent && this.settings.autoDetectIndent.enabled) {
      this.detectAndApplyIndentation();
    }

    // Parse the AST
    this.ast = this.parseAST(this.content);

    // Build a position map for accurate text extraction
    this.positionMap = this.buildPositionMap();
  }

  parseAST(content: string): Root {
    const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx);

    try {
      return processor.parse(content) as Root;
    } catch (error) {
      // If parsing fails, it might be due to JSX with closing /> on its own line
      // Try to fix this common issue and parse again
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('Unexpected closing slash')) {
        const fixed = this.fixStandaloneClosingTags(content);
        try {
          return processor.parse(fixed) as Root;
        } catch {
          // If still fails, throw the original error
          throw new Error(`Invalid MDX syntax: ${message}`);
        }
      }
      // For other errors, throw as is
      throw new Error(`Invalid MDX syntax: ${message}`);
    }
  }

  fixStandaloneClosingTags(content: string): string {
    // Fix JSX with closing /> on its own line
    const lines = content.split('\n');
    const fixed: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // If line is just />
      if (trimmed === '/>') {
        // Look back to find the last line with content
        if (i > 0 && fixed.length > 0) {
          // Append to previous non-empty line
          fixed[fixed.length - 1] += ' />';
        } else {
          fixed.push(line);
        }
      } else {
        fixed.push(line);
      }
    }

    return fixed.join('\n');
  }

  buildPositionMap(): PositionMapEntry[] {
    // Create a map of line numbers to character positions
    const map: PositionMapEntry[] = [];
    let charPos = 0;

    for (let i = 0; i < this.lines.length; i++) {
      map.push({
        line: i,
        start: charPos,
        end: charPos + this.lines[i].length,
      });
      charPos += this.lines[i].length + 1; // +1 for newline
    }

    return map;
  }

  /**
   * Detect indentation from content and update formatter settings
   */
  detectAndApplyIndentation(): void {
    const detector = new IndentDetector(this.content);
    const confidence = detector.getConfidence();
    // Use nullish coalescing to allow explicit 0 value
    const minConfidence = this.settings.autoDetectIndent.minConfidence ?? 0.7;

    // Only use detected indentation if confidence is high enough
    if (confidence >= minConfidence) {
      const detectedSize = detector.getIndentSize();
      const detectedType = detector.getIndentType();

      this.applyIndentationToSettings(detectedSize, detectedType);

      // Store the detector for later use
      this.indentDetector = detector;
    } else {
      // Use fallback settings if confidence is too low
      const fallbackSize = this.settings.autoDetectIndent.fallbackIndentSize || 2;
      const fallbackType = this.settings.autoDetectIndent.fallbackIndentType || 'space';

      // Apply fallback indentation to all settings for consistency
      this.applyIndentationToSettings(fallbackSize, fallbackType);

      // Create a detector with fallback values for consistent API
      this.indentDetector = {
        getIndentSize: () => fallbackSize,
        getIndentType: () => fallbackType,
        getIndentString: () => (fallbackType === 'tab' ? '\t' : ' '.repeat(fallbackSize)),
        getConfidence: () => 0,
        formatWithIndent: (text: string, level: number): string => {
          const indent =
            fallbackType === 'tab' ? '\t'.repeat(level) : ' '.repeat(fallbackSize * level);
          return indent + text;
        },
      };
    }
  }

  /**
   * Apply indentation settings consistently across all formatters
   */
  applyIndentationToSettings(size: number, type: string): void {
    // Update JSX formatting settings
    if (this.settings.formatMultiLineJsx) {
      this.settings.formatMultiLineJsx.indentSize = size;
      this.settings.formatMultiLineJsx.indentType = type;
    }

    // Update JSX content indentation settings
    if (this.settings.indentJsxContent) {
      this.settings.indentJsxContent.indentSize = size;
      this.settings.indentJsxContent.indentType = type;
    }

    // Update HTML block formatter settings
    if (
      this.settings.formatHtmlBlocksInMdx &&
      this.settings.formatHtmlBlocksInMdx.formatterConfig
    ) {
      this.settings.formatHtmlBlocksInMdx.formatterConfig.tabWidth = size;
      this.settings.formatHtmlBlocksInMdx.formatterConfig.useTabs = type === 'tab';
    }

    // Update YAML frontmatter settings
    if (this.settings.formatYamlFrontmatter) {
      this.settings.formatYamlFrontmatter.indent = size;
    }
  }

  async format(): Promise<string> {
    // Collect all formatting operations
    const operations: FormatterOperation[] = [];

    // Rule 1: Add empty lines between elements
    if (this.settings.addEmptyLineBetweenElements.enabled) {
      this.collectSpacingOperations(operations);
    }

    // Rules 2 & 4: Format JSX (multi-line and single-line expansion)
    if (this.settings.formatMultiLineJsx.enabled || this.settings.expandSingleLineJsx.enabled) {
      this.collectJsxFormatOperations(operations);
    }

    // Rule 5: Indent JSX content
    if (this.settings.indentJsxContent.enabled) {
      this.collectJsxIndentOperations(operations);
    }

    // Rule 6: Add empty lines in block JSX components
    if (this.settings.addEmptyLinesInBlockJsx && this.settings.addEmptyLinesInBlockJsx.enabled) {
      this.collectBlockJsxEmptyLineOperations(operations);
    }

    // Rule 7: Format YAML frontmatter
    if (this.settings.formatYamlFrontmatter && this.settings.formatYamlFrontmatter.enabled) {
      this.collectYamlFormatOperations(operations);
    }

    // NEW: Fix list indentation
    this.collectListIndentationOperations(operations);

    // NEW: Format HTML blocks using HtmlBlockFormatter
    if (this.settings.formatHtmlBlocksInMdx && this.settings.formatHtmlBlocksInMdx.enabled) {
      await this.collectHtmlBlockOperations(operations);
    }

    // Sort operations by position (reverse order to preserve positions)
    // Also sort by operation type to ensure replacements happen before insertions at the same line
    operations.sort((a, b) => {
      if (b.startLine !== a.startLine) {
        return b.startLine - a.startLine;
      }
      // If same line, prioritize replaceLines over insertLine
      const priority: Record<string, number> = {
        replaceLines: 1,
        insertLine: 2,
        indentLine: 3,
        fixListIndent: 4,
        replaceHtmlBlock: 5,
      };
      return (priority[a.type] || 99) - (priority[b.type] || 99);
    });

    // Apply operations to lines with deduplication
    const resultLines = [...this.lines];
    const appliedOperations = new Set<string>();

    for (const op of operations) {
      // Create a unique key for this operation
      const endLine = 'endLine' in op ? op.endLine : op.startLine;
      const opKey = `${op.type}-${op.startLine}-${endLine}`;

      // Skip if we've already applied an operation at this location
      if (appliedOperations.has(opKey)) {
        continue;
      }

      appliedOperations.add(opKey);
      this.applyOperation(resultLines, op);
    }

    // Normalize multiple consecutive empty lines to maximum of 1 empty line
    const result = resultLines.join('\n');
    return result.replace(/\n{3,}/g, '\n\n');
  }

  collectSpacingOperations(operations: FormatterOperation[]): void {
    // Initialize HTML formatter to check if elements are HTML
    const htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx || {});

    visit(this.ast, (node: Node) => {
      // Add spacing after headings
      if (node.type === 'heading' && node.position) {
        const headingNode = node as HeadingNode;
        const endLine = headingNode.position.end.line - 1;
        if (endLine < this.lines.length - 1) {
          const nextLine = this.lines[endLine + 1];
          if (nextLine && nextLine.trim() !== '' && !nextLine.startsWith('#')) {
            operations.push({
              type: 'insertLine',
              startLine: endLine + 1,
              content: '',
            });
          }
        }
      }

      // FIXED: Add spacing after JSX components when followed by text or another JSX component
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        node.position
      ) {
        const jsxNode = node as MdxJsxElement;
        // Skip HTML elements - they will be handled by HTML formatter
        if (jsxNode.name && htmlFormatter.isHtmlElement(jsxNode.name)) {
          return;
        }
        const endLine = jsxNode.position!.end.line - 1;
        if (endLine < this.lines.length - 1) {
          const nextLine = this.lines[endLine + 1];
          // Check if next line is text (not empty, not heading)
          if (
            nextLine &&
            nextLine.trim() !== '' &&
            !nextLine.trim().startsWith('#') &&
            !nextLine.trim().startsWith('-') &&
            !nextLine.trim().match(/^\d+\./) // Not a numbered list
          ) {
            // Add spacing between consecutive block components
            const blockComponents = this.settings.addEmptyLinesInBlockJsx.blockComponents || [];
            const isBlockComponent = blockComponents.includes(jsxNode.name || '');
            const nextIsBlockComponent = blockComponents.some((name: string) =>
              nextLine.trim().startsWith(`<${name}`),
            );

            if (isBlockComponent && nextIsBlockComponent) {
              operations.push({
                type: 'insertLine',
                startLine: endLine + 1,
                content: '',
              });
            }
            // Add spacing after JSX when followed by text (not another JSX)
            else if (!nextLine.trim().startsWith('<')) {
              operations.push({
                type: 'insertLine',
                startLine: endLine + 1,
                content: '',
              });
            }
          }
        }
      }
    });
  }

  // NEW: Method to fix list indentation
  collectListIndentationOperations(operations: FormatterOperation[]): void {
    // Track nesting level for list items
    const listNestingLevels = new Map<string, number>();
    const processedLists = new Set<string>();

    // Recursive function to determine nesting levels
    const determineNesting = (node: Node, parentLevel: number = 0): void => {
      if (node.type === 'list') {
        const listNode = node as ListNode;
        // Mark this list as processed to avoid duplicate processing
        const listKey = `${listNode.position.start.line}-${listNode.position.start.column}`;
        if (processedLists.has(listKey)) {
          return; // Already processed this list
        }
        processedLists.add(listKey);

        // Process list items
        if (listNode.children) {
          listNode.children.forEach((child) => {
            if (child.type === 'listItem') {
              const key = `${child.position.start.line}-${child.position.start.column}`;
              // Only set if not already set (preserve the first, correct setting)
              if (!listNestingLevels.has(key)) {
                listNestingLevels.set(key, parentLevel);
              }

              // Check for nested lists within this item
              if (child.children) {
                child.children.forEach((subChild) => {
                  if (subChild.type === 'list') {
                    determineNesting(subChild, parentLevel + 1);
                  }
                });
              }
            }
          });
        }
      } else if ((node as Parent).children) {
        // Process children of non-list nodes
        const parentNode = node as Parent;
        parentNode.children.forEach((child: Node) => {
          if (child.type === 'list') {
            determineNesting(child, parentLevel);
          } else if ((child as Parent).children) {
            // Recursively check for lists
            determineNesting(child, parentLevel);
          }
        });
      }
    };

    // Start from the root
    determineNesting(this.ast, 0);

    // Second pass: fix indentation
    visit(this.ast, (node: Node) => {
      if (node.type === 'listItem' && node.position) {
        const listItemNode = node as ListItemNode;
        const key = `${listItemNode.position.start.line}-${listItemNode.position.start.column}`;
        const nestingLevel = listNestingLevels.get(key) || 0;
        const expectedIndent = nestingLevel * 2;

        // Find the line with the list marker
        const startLine = listItemNode.position.start.line - 1;
        const line = this.lines[startLine];
        const trimmed = line.trim();

        // Check if this is a list item line
        if (trimmed.match(/^[-*+]\s/) || trimmed.match(/^\d+\.\s/)) {
          const currentIndent = line.length - trimmed.length;

          // If the current indentation is wrong, fix it
          if (currentIndent !== expectedIndent) {
            operations.push({
              type: 'fixListIndent',
              startLine: startLine,
              indent: ' '.repeat(expectedIndent),
            });
          }
        }
      }
    });
  }

  collectJsxFormatOperations(operations: FormatterOperation[]): void {
    // Initialize HTML formatter to check if elements are HTML
    const htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx || {});

    visit(this.ast, (node: Node) => {
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        node.position
      ) {
        const jsxNode = node as MdxJsxElement;
        // Skip HTML elements - they will be handled by HTML formatter
        if (jsxNode.name && htmlFormatter.isHtmlElement(jsxNode.name)) {
          return;
        }

        // Skip components in the ignore list
        const ignoreComponents = this.settings.formatMultiLineJsx.ignoreComponents || [];
        if (jsxNode.name && ignoreComponents.includes(jsxNode.name)) {
          return;
        }

        const startLine = jsxNode.position!.start.line - 1;
        const endLine = jsxNode.position!.end.line - 1;

        // Extract the original JSX text
        const originalText = this.extractNodeText(jsxNode.position!);

        // Check if it needs formatting
        if (this.needsJsxFormatting(jsxNode, originalText)) {
          const formatted = this.formatJsxElement(jsxNode, originalText);

          if (formatted !== originalText) {
            operations.push({
              type: 'replaceLines',
              startLine: startLine,
              endLine: endLine,
              lines: formatted.split('\n'),
            });
          }
        }
      }
    });
  }

  needsJsxFormatting(node: MdxJsxElement, originalText: string): boolean {
    // Check if component is in ignore list
    const ignoreComponents = this.settings.formatMultiLineJsx.ignoreComponents || [];
    if (node.name && ignoreComponents.includes(node.name)) {
      return false;
    }

    const attributes = node.attributes || [];
    const isMultiLine = node.position!.start.line !== node.position!.end.line;
    const propsThreshold = this.settings.expandSingleLineJsx.propsThreshold || 2;

    // Rule 4: Single-line with threshold+ attributes needs expansion
    if (
      !isMultiLine &&
      attributes.length >= propsThreshold &&
      this.settings.expandSingleLineJsx.enabled
    ) {
      return true;
    }

    // Rule 2: Multi-line needs proper formatting
    if (isMultiLine && this.settings.formatMultiLineJsx.enabled) {
      // Check if attributes are properly indented
      const lines = originalText.split('\n');
      const expectedIndent = this.indentDetector
        ? this.indentDetector.getIndentString()
        : ' '.repeat(this.settings.formatMultiLineJsx.indentSize || 2);
      // Check for attributes split across lines incorrectly
      // Like: <ExImg src="..." className="..."
      //         alt="..." />
      const firstLine = lines[0];
      if (firstLine.includes('="') && !firstLine.endsWith('>') && !firstLine.endsWith('/>')) {
        // Has attributes on first line but doesn't close
        return true;
      }

      // Check if /> is on its own line (this is always incorrect)
      for (let i = 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed === '/>') {
          // /> should never be on its own line in JSX/MDX
          return true;
        }
      }

      // Check indentation on subsequent lines
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        // Skip empty lines or closing tag
        if (!trimmed || trimmed.startsWith(`</${node.name}`)) {
          continue;
        }

        // Check proper indentation for attribute lines
        // Attributes should be indented by exactly one indent level
        if (!line.startsWith(expectedIndent)) {
          return true;
        }

        // Additional check: ensure there's not extra space after the indent
        // (unless it's part of an expression)
        const afterIndent = line.substring(expectedIndent.length);
        if (afterIndent.startsWith(' ') && !afterIndent.trimStart().startsWith('{')) {
          return true;
        }
      }
    }

    return false;
  }

  formatJsxElement(node: MdxJsxElement, originalText: string): string {
    const name = node.name || '';
    const attributes = node.attributes || [];
    const children = node.children || [];

    // Check if element has content in the original text
    // This is important for JSX inside admonitions where children might not be in AST
    const hasClosingTag = originalText.includes('</' + name + '>');
    // Also check if the original was a single line with content (inline JSX)
    const isInlineWithContent =
      originalText.includes('>{') || (originalText.includes('>') && hasClosingTag);
    const selfClosing =
      !hasClosingTag && !isInlineWithContent && node.selfClosing !== false && children.length === 0;
    // Use detected indentation or fallback to settings
    const indent = this.indentDetector
      ? this.indentDetector.getIndentString()
      : ' '.repeat(this.settings.formatMultiLineJsx.indentSize || 2);
    const propsThreshold = this.settings.expandSingleLineJsx.propsThreshold || 2;

    // Build formatted JSX
    const lines: string[] = [];

    // Determine if we should use multi-line format
    const shouldExpand =
      (this.settings.expandSingleLineJsx.enabled && attributes.length >= propsThreshold) ||
      node.position!.start.line !== node.position!.end.line;

    if (attributes.length === 0) {
      // No attributes
      if (selfClosing) {
        lines.push(`<${name} />`);
      } else {
        lines.push(`<${name}>`);
      }
    } else if (!shouldExpand && attributes.length === 1) {
      // Single attribute, keep on one line
      const attrStr = this.getAttributeString(attributes[0], originalText);
      if (selfClosing) {
        lines.push(`<${name} ${attrStr} />`);
      } else {
        lines.push(`<${name} ${attrStr}>`);
      }
    } else {
      // Multi-line format
      lines.push(`<${name}`);

      // Add each attribute on its own line with proper indent
      for (const attr of attributes) {
        const attrStr = this.getAttributeString(attr, originalText);

        // Handle multi-line expression values (like arrays)
        if (attrStr.includes('\n')) {
          const attrLines = attrStr.split('\n');
          lines.push(`${indent}${attrLines[0]}`);

          // Add subsequent lines with additional indentation for expression content
          for (let i = 1; i < attrLines.length; i++) {
            // Check if this line is part of the expression or the closing
            const line = attrLines[i];
            if (line.trim().endsWith(']}') || line.trim() === ']}') {
              // Closing of array expression
              lines.push(`${indent}${line.trim()}`);
            } else {
              // Content inside expression - add extra indent
              lines.push(`${indent}  ${line.trim()}`);
            }
          }
        } else {
          lines.push(`${indent}${attrStr}`);
        }
      }

      // Close the opening tag
      if (selfClosing) {
        // Append the closing to the last line instead of a new line
        if (lines.length > 0) {
          lines[lines.length - 1] += ' />';
        } else {
          lines.push('/>');
        }
      } else {
        lines.push('>');
      }
    }

    // Add children content if not self-closing
    if (!selfClosing) {
      // Extract children content from original
      const childrenText = this.extractChildrenText(node, originalText);
      if (childrenText) {
        // Check if this is a container component that needs indented content
        const containerComponents = this.settings.indentJsxContent.containerComponents || [];
        const isContainer = containerComponents.includes(name);

        if (isContainer && this.settings.indentJsxContent.enabled) {
          // Indent each line of children
          const childLines = childrenText.split('\n');
          for (const line of childLines) {
            if (line.trim()) {
              lines.push(`${indent}${line.trim()}`);
            }
          }
        } else {
          lines.push(...childrenText.split('\n'));
        }
      }

      // Closing tag
      lines.push(`</${name}>`);
    }

    return lines.join('\n');
  }

  getAttributeString(attr: MdxJsxAttribute, originalText: string): string {
    if (!attr || !attr.name) return '';

    let result = attr.name;

    if (attr.value !== null && attr.value !== undefined) {
      if (typeof attr.value === 'string') {
        // Simple string value
        result += `="${attr.value}"`;
      } else if (attr.value && attr.value.type === 'mdxJsxAttributeValueExpression') {
        // Expression value
        const exprValue = this.extractExpressionValue(attr.value as MdxJsxAttributeValueExpression);
        if (exprValue) {
          result += `={${exprValue}}`;
        } else {
          // Try to extract from original text
          const extracted = this.extractAttributeExpression(attr.name, originalText);
          if (extracted) {
            result = extracted;
          } else {
            result += '={...}';
          }
        }
      }
    }

    return result;
  }

  extractAttributeExpression(attrName: string, originalText: string): string | null {
    // Try to find the attribute expression in the original text
    const lines = originalText.split('\n');
    const needle = `${attrName}={`;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      // Look for the attribute with expression using string matching (not regex)
      const needlePos = line.indexOf(needle);
      if (needlePos === -1) continue;

      // Check if it's a complete single-line expression
      const afterOpen = needlePos + needle.length;
      const closeBrace = line.indexOf('}', afterOpen);
      if (closeBrace !== -1 && !line.substring(afterOpen, closeBrace).includes('{')) {
        return `${attrName}={${line.substring(afterOpen, closeBrace)}}`;
      }

      // Multi-line expression - need to extract across lines
      let braceDepth = 1;
      let result = needle;
      let currentLineIdx = lineIdx;
      const charIndex = afterOpen;

      while (currentLineIdx < lines.length && braceDepth > 0) {
        const currentLine = lines[currentLineIdx];
        for (let i = currentLineIdx === lineIdx ? charIndex : 0; i < currentLine.length; i++) {
          const char = currentLine[i];
          result += char;
          if (char === '{') braceDepth++;
          if (char === '}') {
            braceDepth--;
            if (braceDepth === 0) {
              return result;
            }
          }
        }
        currentLineIdx++;
        if (currentLineIdx < lines.length && braceDepth > 0) {
          result += '\n';
        }
      }
    }

    return null;
  }

  extractExpressionValue(expr: MdxJsxAttributeValueExpression): string {
    // Extract the raw expression value from the AST node
    if (expr.value) {
      return expr.value;
    }

    // If we have position info, extract from original text
    if (expr.position) {
      const text = this.extractNodeText(expr.position);
      return text;
    }

    // Try to get from data
    if (expr.data && expr.data.estree) {
      // For complex expressions, try to extract from position
      if (expr.position) {
        return this.extractNodeText(expr.position);
      }
    }

    return '';
  }

  extractNodeText(position: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  }): string {
    // Extract text from original content using position info
    const startLine = position.start.line - 1;
    const endLine = position.end.line - 1;
    const startCol = position.start.column - 1;
    const endCol = position.end.column - 1;

    if (startLine === endLine) {
      // Single line
      return this.lines[startLine].substring(startCol, endCol);
    } else {
      // Multi-line
      const lines: string[] = [];

      // First line
      lines.push(this.lines[startLine].substring(startCol));

      // Middle lines
      for (let i = startLine + 1; i < endLine; i++) {
        lines.push(this.lines[i]);
      }

      // Last line
      lines.push(this.lines[endLine].substring(0, endCol));

      return lines.join('\n');
    }
  }

  extractChildrenText(node: MdxJsxElement, originalText: string): string {
    if (!node.children || node.children.length === 0) {
      return '';
    }

    // Find the content between opening and closing tags
    const lines = originalText.split('\n');
    const name = node.name;

    // Find where the opening tag ends
    let openingEndIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('>') && !lines[i].includes('/>')) {
        openingEndIndex = i;
        break;
      }
    }

    // Find where the closing tag starts
    let closingStartIndex = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes(`</${name}`)) {
        closingStartIndex = i;
        break;
      }
    }

    if (openingEndIndex >= 0 && closingStartIndex > openingEndIndex) {
      // Extract content between tags
      const contentLines: string[] = [];

      // Handle case where opening tag has content on same line
      const openingLine = lines[openingEndIndex];
      const afterOpening = openingLine.substring(openingLine.indexOf('>') + 1);
      if (afterOpening.trim()) {
        contentLines.push(afterOpening);
      }

      // Add middle lines
      for (let i = openingEndIndex + 1; i < closingStartIndex; i++) {
        contentLines.push(lines[i]);
      }

      // Handle case where closing tag has content on same line
      const closingLine = lines[closingStartIndex];
      const beforeClosing = closingLine.substring(0, closingLine.indexOf(`</${name}`));
      if (beforeClosing.trim()) {
        contentLines.push(beforeClosing);
      }

      return contentLines.join('\n');
    }

    return '';
  }

  /**
   * Collect HTML block formatting operations using HtmlBlockFormatter
   */
  async collectHtmlBlockOperations(operations: FormatterOperation[]): Promise<void> {
    // Initialize the HTML formatter
    const htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx);

    // Collect all HTML nodes first, tracking parent-child relationships
    const htmlNodes: MdxJsxElement[] = [];
    const processedRanges: [number, number][] = [];

    visit(this.ast, 'mdxJsxFlowElement', (node: Node) => {
      const jsxNode = node as MdxJsxElement;
      // Check if this is an HTML element (not a JSX component)
      if (jsxNode.name && htmlFormatter.isHtmlElement(jsxNode.name)) {
        const startLine = jsxNode.position!.start.line;
        const endLine = jsxNode.position!.end.line;

        // Check if this node is within an already processed range
        let isNested = false;
        for (const range of processedRanges) {
          if (startLine > range[0] && endLine < range[1]) {
            isNested = true;
            break;
          }
        }

        // Only process top-level HTML elements, not nested ones
        if (!isNested) {
          htmlNodes.push(jsxNode);
          processedRanges.push([startLine, endLine]);
        }
      }
    });

    // Process each top-level HTML node asynchronously
    for (const node of htmlNodes) {
      // Extract the HTML content from this node
      const htmlContent = this.extractHtmlFromNode(node);

      if (htmlContent) {
        // Format just this HTML block using Prettier
        const formatted = await htmlFormatter.formatWithPrettier(htmlContent);

        // Only add operation if formatting changed the content
        if (formatted !== htmlContent) {
          operations.push({
            type: 'replaceHtmlBlock',
            startLine: node.position!.start.line - 1,
            endLine: node.position!.end.line - 1,
            content: formatted,
          });
        }
      }
    }
  }

  /**
   * Extract HTML content from an AST node
   */
  extractHtmlFromNode(node: MdxJsxElement): string | null {
    if (!node.position) return null;

    const startLine = node.position.start.line - 1;
    const endLine = node.position.end.line - 1;

    // Extract lines for this node
    const htmlLines: string[] = [];
    for (let i = startLine; i <= endLine; i++) {
      htmlLines.push(this.lines[i]);
    }

    return htmlLines.join('\n');
  }

  collectJsxIndentOperations(operations: FormatterOperation[]): void {
    const containerNames = this.settings.indentJsxContent.containerComponents || [];

    // Initialize HTML formatter to check if elements are HTML
    const htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx || {});

    // Get components to ignore
    const ignoreComponents = this.settings.formatMultiLineJsx.ignoreComponents || [];

    visit(this.ast, (node: Node) => {
      if (node.type === 'mdxJsxFlowElement' && node.position) {
        const jsxNode = node as MdxJsxElement;
        if (
          containerNames.includes(jsxNode.name || '') &&
          // Skip HTML elements - they are handled by HTML formatter
          !htmlFormatter.isHtmlElement(jsxNode.name || '') &&
          // Skip ignored components
          !ignoreComponents.includes(jsxNode.name || '')
        ) {
          const startLine = jsxNode.position!.start.line - 1;
          const endLine = jsxNode.position!.end.line - 1;

          // Check if content needs indentation
          for (let i = startLine + 1; i < endLine; i++) {
            const line = this.lines[i];
            const trimmed = line.trim();

            // Skip empty lines and closing tag
            if (!trimmed || trimmed.startsWith(`</${jsxNode.name}`)) {
              continue;
            }

            // If not indented, add operation
            if (!line.startsWith('  ')) {
              operations.push({
                type: 'indentLine',
                startLine: i,
                indent: '  ',
              });
            }
          }
        }
      }
    });
  }

  collectBlockJsxEmptyLineOperations(operations: FormatterOperation[]): void {
    const blockComponents = this.settings.addEmptyLinesInBlockJsx.blockComponents || [];

    // Initialize HTML formatter to check if elements are HTML
    const htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx || {});

    // Get components to ignore
    const ignoreComponents = this.settings.formatMultiLineJsx.ignoreComponents || [];

    visit(this.ast, (node: Node) => {
      if (
        (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') &&
        node.position
      ) {
        const jsxNode = node as MdxJsxElement;
        if (
          blockComponents.includes(jsxNode.name || '') &&
          // Skip HTML elements - they are handled by HTML formatter
          !htmlFormatter.isHtmlElement(jsxNode.name || '') &&
          // Skip ignored components
          !ignoreComponents.includes(jsxNode.name || '')
        ) {
          const startLine = jsxNode.position!.start.line - 1;
          const endLine = jsxNode.position!.end.line - 1;

          // Handle single-line components
          if (startLine === endLine) {
            // For single-line components, we need to expand them first
            const line = this.lines[startLine];
            if (line.includes(`<${jsxNode.name}`) && line.includes(`</${jsxNode.name}>`)) {
              // Extract opening tag, content, and closing tag
              const openingTagEnd = line.indexOf('>') + 1;
              const closingTagStart = line.lastIndexOf(`</${jsxNode.name}`);

              if (openingTagEnd > 0 && closingTagStart > openingTagEnd) {
                const openingTag = line.substring(0, openingTagEnd).trim();
                const content = line.substring(openingTagEnd, closingTagStart).trim();
                const closingTag = line.substring(closingTagStart).trim();

                // Replace with multi-line format with empty lines
                operations.push({
                  type: 'replaceLines',
                  startLine: startLine,
                  endLine: startLine,
                  lines: [openingTag, '', content, '', closingTag],
                });
              }
            }
            return;
          }

          // Check if there's an empty line after the opening tag
          if (startLine + 1 < this.lines.length) {
            const lineAfterOpening = this.lines[startLine + 1];
            if (lineAfterOpening.trim() !== '') {
              // Add empty line after opening tag
              operations.push({
                type: 'insertLine',
                startLine: startLine + 1,
                content: '',
              });
            }
          }

          // Check if there's an empty line before the closing tag
          if (endLine > startLine + 1) {
            const lineBeforeClosing = this.lines[endLine - 1];
            // Make sure the line before closing tag is not already empty and is not the closing tag itself
            if (
              lineBeforeClosing.trim() !== '' &&
              !lineBeforeClosing.trim().startsWith(`</${jsxNode.name}`)
            ) {
              // Add empty line before closing tag
              operations.push({
                type: 'insertLine',
                startLine: endLine,
                content: '',
              });
            }
          }
        }
      }
    });
  }

  collectYamlFormatOperations(operations: FormatterOperation[]): void {
    const yamlSettings = this.settings.formatYamlFrontmatter;

    visit(this.ast, (node: Node) => {
      if (node.type === 'yaml' && node.position) {
        const yamlNode = node as YamlNode;
        try {
          // Parse the YAML content
          const parsed = yaml.load(yamlNode.value);

          // Format it back with proper formatting
          const formatted = yaml.dump(parsed, {
            indent: yamlSettings.indent || 2,
            lineWidth: yamlSettings.lineWidth || 100,
            quotingType: (yamlSettings.quotingType || '"') as '"' | "'",
            forceQuotes: yamlSettings.forceQuotes || false,
            noCompatMode: yamlSettings.noCompatMode !== false, // Default true
            // Additional options for cleaner output
            noRefs: true, // Don't use YAML references
            sortKeys: false, // Keep original key order
            condenseFlow: false, // Don't condense flow collections
          });

          // Remove trailing newline that js-yaml adds
          const cleanFormatted = formatted.replace(/\n$/, '');

          // Only apply if different from original
          if (cleanFormatted !== yamlNode.value) {
            const startLine = yamlNode.position.start.line - 1;
            const endLine = yamlNode.position.end.line - 1;

            // The YAML frontmatter includes the --- markers
            // We need to replace just the content between them
            const formattedLines = cleanFormatted.split('\n');

            operations.push({
              type: 'replaceLines',
              startLine: startLine + 1, // Skip the opening ---
              endLine: endLine - 1, // Skip the closing ---
              lines: formattedLines,
            });
          }
        } catch {
          // If YAML parsing fails, skip formatting for this frontmatter
        }
      }
    });
  }

  getLineAtPosition(charPos: number): number {
    for (let i = 0; i < this.positionMap.length; i++) {
      if (charPos >= this.positionMap[i].start && charPos <= this.positionMap[i].end) {
        return i;
      }
    }
    return this.positionMap.length - 1;
  }

  applyOperation(lines: string[], op: FormatterOperation): void {
    switch (op.type) {
      case 'insertLine':
        lines.splice(op.startLine, 0, op.content);
        break;

      case 'replaceLines': {
        const deleteCount = op.endLine - op.startLine + 1;
        lines.splice(op.startLine, deleteCount, ...op.lines);
        break;
      }

      case 'indentLine': {
        const trimmed = lines[op.startLine].trim();
        lines[op.startLine] = op.indent + trimmed;
        break;
      }

      case 'fixListIndent': {
        // NEW: Handle list indentation fix
        const listLine = lines[op.startLine].trim();
        lines[op.startLine] = op.indent + listLine;
        break;
      }

      case 'replaceHtmlBlock': {
        // NEW: Replace HTML block with formatted content
        const formattedLines = op.content.split('\n');
        // Remove old lines
        lines.splice(op.startLine, op.endLine - op.startLine + 1, ...formattedLines);
        break;
      }
    }
  }
}
