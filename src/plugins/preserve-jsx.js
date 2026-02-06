import { visit } from 'unist-util-visit';

/**
 * Plugin to preserve JSX/MDX component formatting and indentation
 */
export function preserveJsxPlugin() {
  return (tree, file) => {
    const originalContent = String(file);
    const lines = originalContent.split('\n');

    visit(tree, ['mdxJsxFlowElement', 'mdxJsxTextElement'], (node) => {
      // Store the original JSX content to preserve formatting
      if (node.position && node.position.start && node.position.end) {
        const startLine = node.position.start.line - 1;
        const startCol = node.position.start.column - 1;
        const endLine = node.position.end.line - 1;
        const endCol = node.position.end.column;

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
        node.data = node.data || {};
        node.data.originalJsx = originalJsx;
        node.data.preserveOriginal = true;
      }

      // Handle self-closing tags
      if (!node.children || node.children.length === 0) {
        node.selfClosing = true;
      }
    });
  };
}
