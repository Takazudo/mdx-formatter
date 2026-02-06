import { visit } from 'unist-util-visit';

/**
 * Plugin to handle Japanese text formatting rules
 */
export function japaneseTextPlugin() {
  return (tree) => {
    // Note: Japanese URLs are now pre-processed in the main format function
    // to prevent GFM from incorrectly parsing them

    // Clean up Japanese text
    visit(tree, 'text', (node, index, parent) => {
      if (!node.value) return;

      // Check if this text node is adjacent to inline code or strong/emphasis
      // If so, preserve spaces around it
      const isBeforeInlineCode =
        parent &&
        parent.children &&
        index < parent.children.length - 1 &&
        parent.children[index + 1].type === 'inlineCode';

      const isAfterInlineCode =
        parent && parent.children && index > 0 && parent.children[index - 1].type === 'inlineCode';

      // Check if adjacent to strong or emphasis elements
      const isBeforeStrong =
        parent &&
        parent.children &&
        index < parent.children.length - 1 &&
        (parent.children[index + 1].type === 'strong' ||
          parent.children[index + 1].type === 'emphasis');

      const isAfterStrong =
        parent &&
        parent.children &&
        index > 0 &&
        (parent.children[index - 1].type === 'strong' ||
          parent.children[index - 1].type === 'emphasis');

      // Preserve Japanese punctuation and spacing
      // Don't add extra spaces around Japanese punctuation
      node.value = node.value
        .replace(/\s+([、。！？])/g, '$1') // Remove spaces before Japanese punctuation
        .replace(/([、。！？])\s+/g, '$1'); // Remove spaces after Japanese punctuation

      // Only trim trailing spaces if:
      // 1. Not adjacent to code or strong/emphasis elements
      // 2. The text node doesn't contain operators that need spacing
      // This preserves spaces between bold elements like "**VCA** + **Envelope**"
      const hasOperators = /[+\-=*/<>]/.test(node.value);

      if (
        !isBeforeInlineCode &&
        !isAfterInlineCode &&
        !isBeforeStrong &&
        !isAfterStrong &&
        !hasOperators
      ) {
        // Only trim if the entire value is whitespace or ends with multiple spaces
        if (node.value.trim() === '') {
          node.value = '';
        } else if (/\s{2,}$/.test(node.value)) {
          // Only trim if there are 2+ trailing spaces
          node.value = node.value.replace(/\s+$/g, ' ');
        }
      }
    });

    // Handle spacing around Japanese headings
    visit(tree, 'heading', (node) => {
      if (node.children && node.children[0] && node.children[0].type === 'text') {
        const text = node.children[0].value;
        // Check if the heading contains Japanese characters
        if (/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(text)) {
          // Ensure proper formatting for Japanese headings
          node.children[0].value = text.trim();
        }
      }
    });
  };
}
