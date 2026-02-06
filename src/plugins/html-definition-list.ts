import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node } from 'unist';
import type { HtmlNode, ParentNode } from '../types.js';

/**
 * Plugin to convert HTML definition lists to markdown
 */
export function htmlDefinitionListPlugin() {
  return (tree: Root) => {
    // In MDX, raw HTML can appear as either 'html' or 'mdxFlowExpression' nodes
    // We need to handle both cases
    visit(tree, (node: Node, index, parent) => {
      if (node.type !== 'html' && node.type !== 'raw') return;
      const htmlNode = node as HtmlNode;
      const parentNode = parent as ParentNode | null;
      // For 'raw' nodes (MDX), the content is in node.value
      // For 'html' nodes (regular markdown), it's also in node.value
      if (!htmlNode.value) return;

      // Check if this is a definition list
      const dlMatch = htmlNode.value.match(/^<dl[^>]*>([\s\S]*?)<\/dl>$/);
      if (!dlMatch) return;

      const content = dlMatch[1];
      const items: Node[] = [];

      // Parse dt/dd pairs
      const regex = /<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g;
      let match;

      while ((match = regex.exec(content)) !== null) {
        const term = cleanHtml(match[1].trim());
        const definition = cleanHtml(match[2].trim());

        // Create markdown definition list nodes
        items.push({
          type: 'paragraph',
          children: [
            {
              type: 'strong',
              children: [{ type: 'text', value: term }],
            },
          ],
        } as Node);

        items.push({
          type: 'paragraph',
          children: [{ type: 'text', value: ': ' + definition }],
        } as Node);
      }

      // Replace the HTML node with markdown nodes
      if (items.length > 0 && parentNode && typeof index === 'number') {
        parentNode.children.splice(index, 1, ...items);
      }
    });
  };
}

/**
 * Clean HTML tags from text content
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`')
    .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
    .replace(/<[^>]+>/g, '')
    .trim();
}
