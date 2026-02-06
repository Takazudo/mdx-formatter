/**
 * MDX Analyzer - Parse MDX to understand structure without modifying content
 * Core principle: Parse to understand, but never stringify
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMdx from 'remark-mdx';
import remarkFrontmatter from 'remark-frontmatter';
import { visit } from 'unist-util-visit';

class MDXAnalyzer {
  constructor(content) {
    this.original = content;
    this.lines = content.split('\n');
    this.ast = null;
    this.map = null;
  }

  async analyze() {
    // Parse but DON'T stringify
    const processor = unified().use(remarkParse).use(remarkFrontmatter).use(remarkMdx);

    this.ast = processor.parse(this.original);
    this.map = await this.buildMap();
    return this;
  }

  async buildMap() {
    const map = {
      frontmatter: null,
      htmlElements: [],
      jsxComponents: [],
      japaneseUrls: [],
      admonitions: [],
      punctuationIssues: [],
    };

    // Map frontmatter location
    visit(this.ast, 'yaml', (node) => {
      if (node.position) {
        map.frontmatter = {
          start: node.position.start.line - 1,
          end: node.position.end.line - 1,
        };
      }
    });

    // Find HTML definition lists
    visit(this.ast, 'html', (node) => {
      if (node.value && node.value.includes('<dl>')) {
        const startLine = node.position.start.line - 1;
        const endLine = node.position.end.line - 1;

        // Extract the actual HTML content
        const match = node.value.match(/<dl>[\s\S]*?<\/dl>/);
        if (match) {
          map.htmlElements.push({
            type: 'definitionList',
            content: match[0],
            startLine,
            endLine,
            startOffset: node.position.start.offset,
            endOffset: node.position.end.offset,
          });
        }
      }
    });

    // Find Japanese URL patterns （URL）
    visit(this.ast, 'text', (node, index, parent) => {
      const text = node.value;
      const regex = /（(https?:\/\/[^）]+)）/g;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const url = match[1];
        const fullMatch = match[0];

        // Find the actual position in the original text
        const lineNum = node.position.start.line - 1;
        const line = this.lines[lineNum];
        const columnIndex = line.indexOf(fullMatch);

        if (columnIndex !== -1) {
          // Try to find link text before the URL
          let linkText = '';
          if (index > 0 && parent.children[index - 1].type === 'text') {
            const prevText = parent.children[index - 1].value;
            const words = prevText.split(/\s+/);
            if (words.length > 0) {
              linkText = words[words.length - 1];
            }
          }

          map.japaneseUrls.push({
            url,
            fullMatch,
            linkText: linkText || 'リンク',
            lineNum,
            columnIndex,
          });
        }
      }
    });

    // Find Docusaurus admonitions
    this.lines.forEach((line, lineNum) => {
      if (line.match(/^:::(note|tip|info|warning|danger|caution)/)) {
        // Find the closing :::
        let endLine = lineNum + 1;
        while (endLine < this.lines.length && !this.lines[endLine].match(/^:::$/)) {
          endLine++;
        }

        if (endLine < this.lines.length) {
          map.admonitions.push({
            type: line.match(/^:::(\w+)/)[1],
            startLine: lineNum,
            endLine: endLine,
          });
        }
      }
    });

    // Find Japanese punctuation without spaces
    visit(this.ast, 'text', (node) => {
      const text = node.value;
      const patterns = [{ regex: /[？！](?=[^\s])/g, addSpace: true }];

      patterns.forEach(({ regex, addSpace }) => {
        let match;
        while ((match = regex.exec(text)) !== null) {
          const lineNum = node.position.start.line - 1;
          map.punctuationIssues.push({
            lineNum,
            index: match.index,
            char: match[0],
            addSpace,
          });
        }
      });
    });

    return map;
  }
}

export default MDXAnalyzer;
