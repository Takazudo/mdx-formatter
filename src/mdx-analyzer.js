/**
 * MDXAnalyzer - Uses AST to understand MDX structure without reformatting
 * This is the proper hybrid approach: parse to understand, fix the original
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';

export class MDXAnalyzer {
  constructor(content, settings = {}) {
    this.original = content;
    this.lines = content.split('\n');
    this.settings = settings;
    this.ast = this.parse(content);
    this.map = this.buildMap();
  }

  parse(content) {
    const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx);

    return processor.parse(content);
  }

  buildMap() {
    const map = {
      frontmatter: null,
      jsxComponents: [],
      headings: [],
      paragraphs: [],
      lists: [],
      codeBlocks: [],
      containerComponents: [], // Outro, InfoBox, LayoutDivide, etc.
    };

    visit(this.ast, (node) => {
      // Track frontmatter
      if (node.type === 'yaml') {
        map.frontmatter = {
          start: node.position.start,
          end: node.position.end,
          value: node.value,
        };
      }

      // Track JSX elements (mdxJsxFlowElement for block, mdxJsxTextElement for inline)
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        const componentInfo = {
          name: node.name,
          type: node.type,
          position: node.position,
          attributes: node.attributes || [],
          children: node.children || [],
          selfClosing: !node.children || node.children.length === 0,
          multiLine: node.position.start.line !== node.position.end.line,
        };

        map.jsxComponents.push(componentInfo);

        // Check if it's a container component
        const containerNames =
          (this.settings.indentJsxContent && this.settings.indentJsxContent.containerComponents) ||
          [];
        if (containerNames.includes(node.name)) {
          map.containerComponents.push(componentInfo);
        }
      }

      // Track headings
      if (node.type === 'heading') {
        map.headings.push({
          depth: node.depth,
          position: node.position,
          text: this.getNodeText(node),
        });
      }

      // Track code blocks
      if (node.type === 'code') {
        map.codeBlocks.push({
          lang: node.lang,
          position: node.position,
          value: node.value,
        });
      }

      // Track lists
      if (node.type === 'list') {
        map.lists.push({
          ordered: node.ordered,
          position: node.position,
        });
      }

      // Track paragraphs
      if (node.type === 'paragraph') {
        map.paragraphs.push({
          position: node.position,
          text: this.getNodeText(node),
        });
      }
    });

    return map;
  }

  getNodeText(node) {
    if (node.type === 'text') {
      return node.value;
    }
    if (node.children) {
      return node.children.map((child) => this.getNodeText(child)).join('');
    }
    return '';
  }

  /**
   * Find JSX components that need formatting
   */
  findJsxToFormat() {
    const toFormat = [];

    for (const component of this.map.jsxComponents) {
      // Components with 2+ props on single line
      if (component.attributes.length >= 2 && !component.multiLine) {
        toFormat.push({
          type: 'expandSingleLineJsx',
          component,
        });
      }

      // Multi-line components that need proper indentation
      if (component.multiLine && component.attributes.length > 0) {
        const hasProperIndentation = component.attributes.every((attr) => {
          if (!attr.position) return true;
          const attrLine = this.lines[attr.position.start.line - 1];
          return attrLine.match(/^\s{2}/); // Check for 2-space indent
        });

        if (!hasProperIndentation) {
          toFormat.push({
            type: 'fixJsxIndentation',
            component,
          });
        }
      }
    }

    return toFormat;
  }

  /**
   * Find container components that need content indentation
   */
  findContainersToIndent() {
    const toIndent = [];

    for (const container of this.map.containerComponents) {
      // Check if content inside needs indentation
      const needsIndentation = this.checkContainerIndentation(container);
      if (needsIndentation) {
        toIndent.push(container);
      }
    }

    return toIndent;
  }

  checkContainerIndentation(container) {
    // Get lines inside the container
    const startLine = container.position.start.line;
    const endLine = container.position.end.line;

    if (startLine >= endLine) return false;

    // Check if content lines are properly indented
    for (let i = startLine; i < endLine - 1; i++) {
      const line = this.lines[i];
      // Skip empty lines and opening/closing tags
      if (
        line.trim() === '' ||
        line.includes(`<${container.name}`) ||
        line.includes(`</${container.name}`)
      ) {
        continue;
      }
      // Content should be indented with 2 spaces
      if (!line.startsWith('  ')) {
        return true; // Needs indentation
      }
    }

    return false;
  }

  /**
   * Check if content needs spacing between elements
   */
  findSpacingIssues() {
    const issues = [];

    // Check spacing after headings
    for (const heading of this.map.headings) {
      const headingLine = heading.position.end.line - 1;
      const nextLine = this.lines[headingLine + 1];

      // Skip if we're inside a container or code block
      if (this.isInsideSpecialBlock(heading.position)) continue;

      if (nextLine && nextLine.trim() !== '' && !nextLine.startsWith('#')) {
        issues.push({
          type: 'addSpaceAfterHeading',
          line: headingLine,
          position: heading.position,
        });
      }
    }

    // Check spacing between different element types
    // This is more complex and would need careful implementation

    return issues;
  }

  isInsideSpecialBlock(position) {
    // Check if position is inside a code block
    for (const block of this.map.codeBlocks) {
      if (
        position.start.line >= block.position.start.line &&
        position.end.line <= block.position.end.line
      ) {
        return true;
      }
    }

    // Check if inside frontmatter
    if (this.map.frontmatter) {
      if (
        position.start.line >= this.map.frontmatter.start.line &&
        position.end.line <= this.map.frontmatter.end.line
      ) {
        return true;
      }
    }

    return false;
  }
}
