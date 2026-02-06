import { visit } from 'unist-util-visit';

/**
 * Plugin to handle Docusaurus-style admonitions (:::note, :::tip, etc.)
 */
export function docusaurusAdmonitionsPlugin() {
  return (tree) => {
    visit(tree, 'containerDirective', (node) => {
      // Docusaurus admonitions are container directives
      const admonitionTypes = ['note', 'tip', 'info', 'warning', 'danger', 'caution'];

      if (admonitionTypes.includes(node.name)) {
        // Preserve the admonition structure
        // The directive plugin handles the parsing, we just need to ensure
        // proper formatting is maintained

        // If there's a label, it's stored in node.label
        if (node.label) {
          node.data = node.data || {};
          node.data.directiveLabel = node.label;
        }

        // Ensure content inside admonitions is properly formatted
        if (node.children) {
          node.children.forEach((child) => {
            // Preserve formatting of nested content
            if (child.type === 'code') {
              child.lang = child.lang || '';
              child.meta = child.meta || null;
            }
          });
        }
      }
    });

    // Also handle leaf and text directives that might be admonition-related
    visit(tree, ['leafDirective', 'textDirective'], (node) => {
      // Preserve any custom directive formatting
      if (node.data && node.data.directiveLabel) {
        // Ensure the label is preserved in the output
        node.label = node.data.directiveLabel;
      }
    });
  };
}
