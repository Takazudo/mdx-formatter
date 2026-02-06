import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node } from 'unist';

interface DirectiveNode extends Node {
  name: string;
  label?: string;
  data?: Record<string, unknown>;
  children?: DirectiveChildNode[];
}

interface DirectiveChildNode extends Node {
  type: string;
  lang?: string;
  meta?: string | null;
}

/**
 * Plugin to handle Docusaurus-style admonitions (:::note, :::tip, etc.)
 */
export function docusaurusAdmonitionsPlugin() {
  return (tree: Root) => {
    visit(tree, 'containerDirective', (node: Node) => {
      const directive = node as DirectiveNode;
      // Docusaurus admonitions are container directives
      const admonitionTypes = ['note', 'tip', 'info', 'warning', 'danger', 'caution'];

      if (admonitionTypes.includes(directive.name)) {
        // Preserve the admonition structure
        // The directive plugin handles the parsing, we just need to ensure
        // proper formatting is maintained

        // If there's a label, it's stored in node.label
        if (directive.label) {
          directive.data = directive.data || {};
          directive.data.directiveLabel = directive.label;
        }

        // Ensure content inside admonitions is properly formatted
        if (directive.children) {
          directive.children.forEach((child) => {
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
    visit(tree, ['leafDirective', 'textDirective'], (node: Node) => {
      const directive = node as DirectiveNode;
      // Preserve any custom directive formatting
      if (directive.data && directive.data.directiveLabel) {
        // Ensure the label is preserved in the output
        directive.label = directive.data.directiveLabel as string;
      }
    });
  };
}
