import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { VFile } from 'vfile';
import type { Node } from 'unist';

interface JsxNode extends Node {
  position?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  children?: Node[];
  selfClosing?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Plugin to preserve JSX/MDX component formatting and indentation
 */
export function preserveJsxPlugin() {
  return (tree: Root, file: VFile) => {
    const originalContent = String(file);
    const lines = originalContent.split('\n');

    visit(tree, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node: Node) => {
      const jsxNode = node as JsxNode;
      // Store the original JSX content to preserve formatting
      if (jsxNode.position && jsxNode.position.start && jsxNode.position.end) {
        const startLine = jsxNode.position.start.line - 1;
        const startCol = jsxNode.position.start.column - 1;
        const endLine = jsxNode.position.end.line - 1;
        const endCol = jsxNode.position.end.column;

        // Extract the original JSX content preserving indentation
        let originalJsx = '';
        if (startLine === endLine) {
          // Single line JSX
          originalJsx = lines[startLine].substring(startCol, endCol);
        } else {
          // Multi-line JSX - preserve exact formatting
          for (let i = startLine; i <= endLine; i++) {
            if (i === startLine) {
              originalJsx += lines[i].substring(startCol);
            } else if (i === endLine) {
              originalJsx += '\n' + lines[i].substring(0, endCol);
            } else {
              originalJsx += '\n' + lines[i];
            }
          }
        }

        // Store the original content in node data
        jsxNode.data = jsxNode.data || {};
        jsxNode.data.originalJsx = originalJsx;
        jsxNode.data.preserveOriginal = true;
      }

      // Handle self-closing tags
      if (!jsxNode.children || jsxNode.children.length === 0) {
        jsxNode.selfClosing = true;
      }
    });
  };
}
