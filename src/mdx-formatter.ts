/**
 * MdxFormatter - AST-based markdown/MDX formatter
 * Parses content into an AST, then applies targeted line-based operations
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

const ADMONITION_START_RE = /^:::(note|tip|info|warning|danger|caution)/;
const LIST_MARKER_RE = /^[-*+]\s/;
const NUMBERED_LIST_RE = /^\d+\.\s/;

export class MdxFormatter {
  private content: string;
  private lines: string[];
  settings: FormatterSettings;
  private ast: Root;
  private indentDetector: IndentDetectorLike | null;
  private readonly htmlFormatter: HtmlBlockFormatter;

  constructor(content: string, settings: FormatterSettings | null = null) {
    this.content = content;
    this.lines = this.content.split('\n');
    this.settings = settings ? deepCloneSettings(settings) : deepCloneSettings(formatterSettings);
    this.indentDetector = null;
    this.htmlFormatter = new HtmlBlockFormatter(this.settings.formatHtmlBlocksInMdx || {});

    // Auto-detect indentation if enabled
    if (this.settings.autoDetectIndent && this.settings.autoDetectIndent.enabled) {
      this.detectAndApplyIndentation();
    }

    // Parse the AST
    this.ast = this.parseAST(this.content);
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

  /**
   * Get the list of components to ignore during formatting.
   */
  private get ignoreComponents(): string[] {
    return this.settings.formatMultiLineJsx.ignoreComponents || [];
  }

  /**
   * Check if a JSX node should be processed (correct type, has position, not HTML, not ignored).
   */
  private isFormattableJsxNode(node: Node): node is MdxJsxElement {
    if (
      (node.type !== 'mdxJsxFlowElement' && node.type !== 'mdxJsxTextElement') ||
      !node.position
    ) {
      return false;
    }
    const jsxNode = node as MdxJsxElement;
    if (jsxNode.name && this.htmlFormatter.isHtmlElement(jsxNode.name)) {
      return false;
    }
    if (jsxNode.name && this.ignoreComponents.includes(jsxNode.name)) {
      return false;
    }
    return true;
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
      const fallbackSize = this.settings.autoDetectIndent.fallbackIndentSize ?? 2;
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

    // When parent and child JSX elements both produce replaceLines operations
    // with overlapping ranges, keep only the wider range (parent).
    this.filterOverlappingReplacements(operations);

    // Collect line ranges covered by replaceLines/replaceHtmlBlock operations.
    // Other operations (insertLine, indentLine) that fall within these ranges
    // must be dropped to prevent duplication — the replacement already rewrites
    // the entire range.
    const replacedRanges: [number, number][] = [];
    for (const op of operations) {
      if ((op.type === 'replaceLines' || op.type === 'replaceHtmlBlock') && 'endLine' in op) {
        replacedRanges.push([op.startLine, op.endLine]);
      }
    }

    const isInsideReplacedRange = (line: number): boolean => {
      return replacedRanges.some(([start, end]) => line >= start && line <= end);
    };

    // Filter out operations that conflict with replaceLines ranges
    const filteredOperations = operations.filter((op) => {
      if (op.type === 'replaceLines' || op.type === 'replaceHtmlBlock') {
        return true; // Always keep replacement operations
      }
      // Drop insertLine / indentLine / fixListIndent if they target a line
      // inside a range that will be completely replaced
      return !isInsideReplacedRange(op.startLine);
    });

    // Sort operations by position (reverse order to preserve positions)
    // Also sort by operation type to ensure replacements happen before insertions at the same line
    filteredOperations.sort((a, b) => {
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

    for (const op of filteredOperations) {
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

  /**
   * Check if a line is an admonition start marker (:::note, :::tip, etc.)
   */
  private isAdmonitionStartLine(lineIndex: number): boolean {
    const line = this.lines[lineIndex];
    return line !== undefined && ADMONITION_START_RE.test(line.trim());
  }

  /**
   * Check if a line is an admonition closing marker (:::)
   */
  private isAdmonitionEndLine(lineIndex: number): boolean {
    const line = this.lines[lineIndex];
    return line !== undefined && line.trim() === ':::';
  }

  /**
   * Try to insert spacing between two consecutive sibling nodes.
   * Only inserts if there's no blank line between them already.
   */
  private insertSpacingBetween(current: Node, next: Node, operations: FormatterOperation[]): void {
    if (!current.position || !next.position) return;
    const endLine = current.position.end.line - 1;
    const nextStartLine = next.position.start.line - 1;
    if (nextStartLine === endLine + 1) {
      const lineBetween = this.lines[endLine + 1];
      if (lineBetween !== undefined && lineBetween.trim() !== '') {
        operations.push({
          type: 'insertLine',
          startLine: endLine + 1,
          content: '',
        });
      }
    }
  }

  collectSpacingOperations(operations: FormatterOperation[]): void {
    // --- Part 1: Heading and JSX spacing (all depths) via visit() ---
    // This preserves the original behavior for headings and JSX elements
    // which need spacing at any nesting level.
    visit(this.ast, (node: Node) => {
      // Add spacing after headings
      if (node.type === 'heading' && node.position) {
        const headingNode = node as HeadingNode;
        const endLine = headingNode.position.end.line - 1;
        if (endLine < this.lines.length - 1) {
          const nextLine = this.lines[endLine + 1];
          if (nextLine && nextLine.trim() !== '') {
            operations.push({
              type: 'insertLine',
              startLine: endLine + 1,
              content: '',
            });
          }
        }
      }

      // Add spacing after JSX components when followed by non-JSX text
      if (this.isFormattableJsxNode(node)) {
        const jsxNode = node;
        const endLine = jsxNode.position!.end.line - 1;
        // Skip JSX elements inside table rows
        const currentLineContent = this.lines[endLine];
        if (currentLineContent && currentLineContent.trim().startsWith('|')) {
          return;
        }
        if (endLine < this.lines.length - 1) {
          const nextLine = this.lines[endLine + 1];
          if (
            nextLine &&
            nextLine.trim() !== '' &&
            !nextLine.trim().startsWith('#') &&
            !nextLine.trim().startsWith('-') &&
            !nextLine.trim().match(/^\d+\./)
          ) {
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
            } else if (!nextLine.trim().startsWith('<')) {
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

    // --- Part 2: Line-based list boundary detection ---
    // When there's no blank line between a list and following text, remark includes
    // the text inside the list node. We need line-based detection for these cases.
    let inCodeBlock = false;
    let inFrontmatter = false;
    let inAdmonitionBlock = false;
    let jsxDepth = 0;
    for (let lineIdx = 0; lineIdx < this.lines.length - 1; lineIdx++) {
      const line = this.lines[lineIdx];
      const nextLine = this.lines[lineIdx + 1];
      const trimmed = line.trim();
      const trimmedNext = nextLine.trim();

      // Track frontmatter
      if (lineIdx === 0 && trimmed === '---') {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter && trimmed === '---') {
        inFrontmatter = false;
        continue;
      }
      if (inFrontmatter) continue;

      // Track code blocks
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        continue;
      }
      if (inCodeBlock) continue;

      // Track admonitions
      if (ADMONITION_START_RE.test(trimmed)) {
        inAdmonitionBlock = true;
        // Add spacing before admonition start if preceded by non-empty content
        if (lineIdx > 0 && this.lines[lineIdx - 1]?.trim() !== '') {
          // Check we haven't already inserted at this position
          const alreadyInserted = operations.some(
            (op) => op.type === 'insertLine' && op.startLine === lineIdx,
          );
          if (!alreadyInserted) {
            operations.push({ type: 'insertLine', startLine: lineIdx, content: '' });
          }
        }
        continue;
      }
      if (inAdmonitionBlock && trimmed === ':::') {
        inAdmonitionBlock = false;
        // Add spacing after admonition end if followed by non-empty content
        if (trimmedNext && trimmedNext !== '') {
          operations.push({ type: 'insertLine', startLine: lineIdx + 1, content: '' });
        }
        continue;
      }
      if (inAdmonitionBlock) continue;

      // Track JSX nesting depth — don't add list spacing inside JSX blocks
      const openTags = (line.match(/<[A-Z][^>]*(?<!\/\s*)>/g) || []).length;
      const closeTags = (line.match(/<\/[A-Z][^>]*>/g) || []).length;
      jsxDepth = Math.max(0, jsxDepth + openTags - closeTags);
      if (jsxDepth > 0) continue;

      // Skip empty lines and already-spaced transitions
      if (!trimmed || !trimmedNext) continue;

      const isListItem = LIST_MARKER_RE.test(trimmed) || NUMBERED_LIST_RE.test(trimmed);
      const nextIsListItem = LIST_MARKER_RE.test(trimmedNext) || NUMBERED_LIST_RE.test(trimmedNext);

      // List item followed by non-list non-empty line
      if (isListItem && !nextIsListItem) {
        // Don't add spacing before code block fences (handled by Part 3)
        if (trimmedNext.startsWith('```')) continue;
        // Don't add spacing before JSX elements (handled by visit above)
        if (/^<[A-Z]/.test(trimmedNext)) continue;
        operations.push({ type: 'insertLine', startLine: lineIdx + 1, content: '' });
      }

      // Non-list line followed by list item
      if (!isListItem && nextIsListItem) {
        // Don't add if current line is a heading (handled by visit above)
        if (/^#{1,6}\s/.test(trimmed)) continue;
        // Don't add if current line is a JSX element (handled by visit above)
        if (/^<[A-Z]/.test(trimmed)) continue;
        operations.push({ type: 'insertLine', startLine: lineIdx + 1, content: '' });
      }
    }

    // --- Part 3: AST-based paragraph/code spacing (root level) via sibling pairs ---
    // This handles spacing between block elements at the root level.
    const children = (this.ast as Parent).children || [];

    // Track admonition regions to skip spacing inside them
    let inAdmonition = false;

    for (let i = 0; i < children.length - 1; i++) {
      const current = children[i];
      const next = children[i + 1];

      if (!current.position || !next.position) continue;

      // Skip yaml frontmatter nodes
      if (current.type === 'yaml') continue;

      // Track admonition regions (:::note ... :::)
      if (
        current.type === 'paragraph' &&
        this.isAdmonitionStartLine(current.position.start.line - 1)
      ) {
        inAdmonition = true;
      }
      if (
        current.type === 'paragraph' &&
        this.isAdmonitionEndLine(current.position.start.line - 1)
      ) {
        inAdmonition = false;
        // Don't skip — we still check spacing AFTER the closing :::
      }

      // Skip spacing between nodes inside admonition blocks
      if (inAdmonition) continue;

      // Paragraph ↔ list
      if (current.type === 'paragraph' && next.type === 'list') {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }
      if (current.type === 'list' && next.type === 'paragraph') {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }

      // List ↔ other block elements (code, heading handled by visit above)
      if (current.type === 'list' && next.type === 'code') {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }
      if (current.type === 'code' && next.type === 'list') {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }

      // Code ↔ paragraph
      if (current.type === 'code' && next.type === 'paragraph') {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }
      if (current.type === 'paragraph' && next.type === 'code') {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }

      // Non-heading, non-JSX element followed by heading
      // Note: heading → anything is handled by visit() above
      // Note: JSX → heading is handled by visit() above (JSX skips headings intentionally)
      if (
        current.type !== 'heading' &&
        current.type !== 'mdxJsxFlowElement' &&
        current.type !== 'mdxJsxTextElement' &&
        next.type === 'heading'
      ) {
        this.insertSpacingBetween(current, next, operations);
        continue;
      }
    }
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
        const nestingLevel = listNestingLevels.get(key) ?? 0;
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
    visit(this.ast, (node: Node) => {
      if (this.isFormattableJsxNode(node)) {
        const jsxNode = node;

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
    if (node.name && this.ignoreComponents.includes(node.name)) {
      return false;
    }

    const attributes = node.attributes || [];
    const isMultiLine = node.position!.start.line !== node.position!.end.line;
    const propsThreshold = this.settings.expandSingleLineJsx.propsThreshold ?? 2;

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
        : ' '.repeat(this.settings.formatMultiLineJsx.indentSize ?? 2);

      // Determine where the opening tag ends so we only check attribute lines.
      // For self-closing elements the opening tag ends at /> or the last line.
      // For non-self-closing elements the opening tag ends at the first line
      // containing a bare > (not />).
      let openingTagEndLine = lines.length - 1;
      const hasClosingTag = originalText.includes(`</${node.name}>`);
      if (hasClosingTag) {
        let braceDepth = 0;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Track brace depth to avoid matching > inside expressions like {a > b}
          for (const ch of line) {
            if (ch === '{') braceDepth++;
            if (ch === '}') braceDepth--;
          }
          const trimmed = line.trim();
          if (braceDepth === 0 && trimmed.endsWith('>') && !trimmed.endsWith('/>')) {
            openingTagEndLine = i;
            break;
          }
        }
      }

      // Check for attributes split across lines incorrectly
      // Like: <ExImg src="..." className="..."
      //         alt="..." />
      const firstLine = lines[0];
      if (firstLine.includes('="') && !firstLine.endsWith('>') && !firstLine.endsWith('/>')) {
        // Has attributes on first line but doesn't close
        return true;
      }

      // Only check lines within the opening tag (not children content)
      for (let i = 1; i <= openingTagEndLine; i++) {
        const trimmed = lines[i].trim();

        // Check if /> is on its own line (this is always incorrect)
        if (trimmed === '/>') {
          return true;
        }

        // Skip empty lines or closing tag
        if (!trimmed || trimmed.startsWith(`</${node.name}`)) {
          continue;
        }

        // Check proper indentation for attribute lines
        // Attributes should be indented by exactly one indent level
        const line = lines[i];
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
      : ' '.repeat(this.settings.formatMultiLineJsx.indentSize ?? 2);
    const propsThreshold = this.settings.expandSingleLineJsx.propsThreshold ?? 2;

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

        // Handle multi-line expression values (like arrays, template literals)
        if (attrStr.includes('\n')) {
          const attrLines = attrStr.split('\n');
          lines.push(`${indent}${attrLines[0]}`);

          // Check if this is a template literal expression (backtick string)
          // Template literal content has meaningful indentation that must be preserved
          const isTemplateLiteral =
            this.shouldPreserveTemplateLiteral() && attrLines[0].includes('={`');

          // Add subsequent lines with additional indentation for expression content
          for (let i = 1; i < attrLines.length; i++) {
            const line = attrLines[i];

            if (isTemplateLiteral) {
              // Preserve original indentation inside template literals
              lines.push(line);
            } else if (line.trim().endsWith(']}') || line.trim() === ']}') {
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
      // Check if this is a block component that needs empty lines
      const blockComponents = this.settings.addEmptyLinesInBlockJsx?.blockComponents || [];
      const isBlockComponent =
        this.settings.addEmptyLinesInBlockJsx?.enabled !== false && blockComponents.includes(name);

      // Extract children content from original
      const childrenText = this.extractChildrenText(node, originalText);
      if (childrenText) {
        // Add empty line after opening tag for block components
        if (isBlockComponent) {
          const firstContentLine = childrenText.split('\n')[0];
          if (firstContentLine && firstContentLine.trim() !== '') {
            lines.push('');
          }
        }

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

        // Add empty line before closing tag for block components
        if (isBlockComponent) {
          const lastContentLine = lines[lines.length - 1];
          if (lastContentLine && lastContentLine.trim() !== '') {
            lines.push('');
          }
        }
      }

      // Closing tag
      lines.push(`</${name}>`);
    }

    return lines.join('\n');
  }

  /**
   * Check if template literal indentation should be preserved based on settings.
   */
  shouldPreserveTemplateLiteral(): boolean {
    return this.settings.formatMultiLineJsx.preserveTemplateLiteralIndent !== false;
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

        // For template literals, prefer extracting from original text to preserve
        // internal indentation (AST normalizes/strips leading whitespace)
        if (
          this.shouldPreserveTemplateLiteral() &&
          exprValue &&
          exprValue.trimStart().startsWith('`')
        ) {
          const extracted = this.extractAttributeExpression(attr.name, originalText);
          if (extracted) {
            result = extracted;
          } else {
            result += `={${exprValue}}`;
          }
        } else if (exprValue) {
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
      return this.extractNodeText(expr.position);
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
    // Collect all HTML nodes first, tracking parent-child relationships
    const htmlNodes: MdxJsxElement[] = [];
    const processedRanges: [number, number][] = [];

    visit(this.ast, 'mdxJsxFlowElement', (node: Node) => {
      const jsxNode = node as MdxJsxElement;
      // Check if this is an HTML element (not a JSX component)
      if (jsxNode.name && this.htmlFormatter.isHtmlElement(jsxNode.name)) {
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
        const formatted = await this.htmlFormatter.formatWithPrettier(htmlContent);

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
    const indentSize = this.settings.indentJsxContent.indentSize ?? 2;
    const indent = ' '.repeat(indentSize);

    visit(this.ast, (node: Node) => {
      if (this.isFormattableJsxNode(node)) {
        const jsxNode = node;
        if (containerNames.includes(jsxNode.name || '')) {
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
            if (!line.startsWith(indent)) {
              operations.push({
                type: 'indentLine',
                startLine: i,
                indent,
              });
            }
          }
        }
      }
    });
  }

  collectBlockJsxEmptyLineOperations(operations: FormatterOperation[]): void {
    const blockComponents = this.settings.addEmptyLinesInBlockJsx.blockComponents || [];

    visit(this.ast, (node: Node) => {
      if (this.isFormattableJsxNode(node)) {
        const jsxNode = node;
        if (blockComponents.includes(jsxNode.name || '')) {
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

          // Find the actual end of the opening tag (may span multiple lines
          // for elements with attributes like <Danger\n  title="..."\n>)
          let openingTagEndLine = startLine;
          for (let i = startLine; i <= endLine; i++) {
            const trimmed = this.lines[i].trim();
            if (trimmed.endsWith('>') && !trimmed.endsWith('/>') && !trimmed.startsWith('</')) {
              openingTagEndLine = i;
              break;
            }
          }

          // Check if there's an empty line after the opening tag
          if (openingTagEndLine + 1 < this.lines.length) {
            const lineAfterOpening = this.lines[openingTagEndLine + 1];
            if (lineAfterOpening.trim() !== '') {
              // Add empty line after opening tag
              operations.push({
                type: 'insertLine',
                startLine: openingTagEndLine + 1,
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

  /**
   * Pre-process YAML text to fix values that would cause parsing failures
   * or silent data corruption. Detects unquoted values containing special
   * YAML characters and wraps them in double quotes.
   */
  preprocessYamlForParsing(yamlText: string): string {
    const lines = yamlText.split('\n');
    const result: string[] = [];

    for (const line of lines) {
      // Match a YAML mapping entry: optional indent, key, colon, space, value
      // Keys must start with a word char, may contain word chars, dots, hyphens
      const match = line.match(/^(\s*)([\w][\w.-]*):\s+(.+)$/);
      if (match) {
        const [, indent, key, value] = match;
        const trimmedValue = value.trim();

        // Skip if already quoted
        if (
          (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
          (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
        ) {
          result.push(line);
          continue;
        }

        // Skip if the value is a flow sequence [...] or flow mapping {...}
        if (
          (trimmedValue.startsWith('[') && trimmedValue.endsWith(']')) ||
          (trimmedValue.startsWith('{') && trimmedValue.endsWith('}'))
        ) {
          result.push(line);
          continue;
        }

        // Skip block scalar indicators (>, |, >-, |-, >+, |+)
        if (/^[|>][-+]?$/.test(trimmedValue)) {
          result.push(line);
          continue;
        }

        const needsQuoting =
          trimmedValue.includes(': ') ||
          trimmedValue.includes(' #') ||
          /^[!&*%@`]/.test(trimmedValue);

        if (needsQuoting) {
          const escaped = trimmedValue.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
          result.push(`${indent}${key}: "${escaped}"`);
          continue;
        }
      }

      result.push(line);
    }

    return result.join('\n');
  }

  collectYamlFormatOperations(operations: FormatterOperation[]): void {
    const yamlSettings = this.settings.formatYamlFrontmatter;

    visit(this.ast, (node: Node) => {
      if (node.type === 'yaml' && node.position) {
        const yamlNode = node as YamlNode;
        // Skip empty frontmatter (---\n---) to avoid reversed-range operation
        if (!yamlNode.value || !yamlNode.value.trim()) {
          return;
        }
        try {
          let yamlToParse = yamlNode.value;

          // Pre-process YAML to fix unsafe values (e.g., unquoted colons)
          if (yamlSettings.fixUnsafeValues !== false) {
            yamlToParse = this.preprocessYamlForParsing(yamlToParse);
          }

          // Parse the YAML content using JSON_SCHEMA to prevent silent
          // data corruption (e.g., dates parsed as Date objects, octals)
          const parsed = yaml.load(yamlToParse, { schema: yaml.JSON_SCHEMA });

          // Format it back with proper formatting using JSON_SCHEMA
          // to preserve string representations (dates, etc.)
          const formatted = yaml.dump(parsed, {
            schema: yaml.JSON_SCHEMA,
            indent: yamlSettings.indent ?? 2,
            lineWidth: yamlSettings.lineWidth ?? 100,
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

  /**
   * Remove replaceLines/replaceHtmlBlock operations that are strictly contained
   * within a wider replacement range (parent wins over child). Mutates the array in place.
   */
  private filterOverlappingReplacements(operations: FormatterOperation[]): void {
    type ReplaceOp = FormatterOperation & { endLine: number };
    const replaceOps: ReplaceOp[] = [];

    for (const op of operations) {
      if ((op.type === 'replaceLines' || op.type === 'replaceHtmlBlock') && 'endLine' in op) {
        replaceOps.push(op as ReplaceOp);
      }
    }

    // Find ops that are strictly contained within another op's range
    const dropped = new Set<FormatterOperation>();
    for (const inner of replaceOps) {
      for (const outer of replaceOps) {
        if (inner === outer) continue;
        if (
          inner.startLine >= outer.startLine &&
          inner.endLine <= outer.endLine &&
          (inner.startLine !== outer.startLine || inner.endLine !== outer.endLine)
        ) {
          dropped.add(inner);
          break;
        }
      }
    }

    // Remove dropped operations in place
    for (let i = operations.length - 1; i >= 0; i--) {
      if (dropped.has(operations[i])) {
        operations.splice(i, 1);
      }
    }
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
