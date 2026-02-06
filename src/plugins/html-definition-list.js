import { visit } from 'unist-util-visit';

/**
 * Plugin to convert HTML definition lists to markdown
 */
export function htmlDefinitionListPlugin() {
  return (tree) => {
    // In MDX, raw HTML can appear as either 'html' or 'mdxFlowExpression' nodes
    // We need to handle both cases
    visit(tree, ['html', 'raw'], (node, index, parent) => {
      // For 'raw' nodes (MDX), the content is in node.value
      // For 'html' nodes (regular markdown), it's also in node.value
      if (!node.value) return;

      // Check if this is a definition list
      const dlMatch = node.value.match(/^<dl[^>]*>([\s\S]*?)<\/dl>$/);
      if (!dlMatch) return;

      const content = dlMatch[1];
      const items = [];

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
        });

        items.push({
          type: 'paragraph',
          children: [{ type: 'text', value: ': ' + definition }],
        });
      }

      // Replace the HTML node with markdown nodes
      if (items.length > 0 && parent && typeof index === 'number') {
        parent.children.splice(index, 1, ...items);
      }
    });
  };
}

/**
 * Clean HTML tags from text content
 * @param {string} html - HTML string
 * @returns {string} - Cleaned text
 */
function cleanHtml(html) {
  return html
    .replace(/<code[^>]*>(.*?)<\/code>/g, '`$1`')
    .replace(/<strong[^>]*>(.*?)<\/strong>/g, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/g, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/g, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/g, '*$1*')
    .replace(/<[^>]+>/g, '')
    .trim();
}
