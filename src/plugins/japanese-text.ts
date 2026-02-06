import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node } from 'unist';

interface TextNode extends Node {
  type: 'text';
  value: string;
}

interface HeadingNode extends Node {
  type: 'heading';
  children: Node[];
}

interface ParentNode extends Node {
  children: Node[];
}

/**
 * Plugin to handle Japanese text formatting rules
 */
export function japaneseTextPlugin() {
  return (tree: Root) => {
    // Note: Japanese URLs are now pre-processed in the main format function
    // to prevent GFM from incorrectly parsing them

    // Clean up Japanese text
    visit(tree, 'text', (node: Node, index, parent) => {
      const textNode = node as TextNode;
      const parentNode = parent as ParentNode | null;
      if (!textNode.value) return;

      // Check if this text node is adjacent to inline code or strong/emphasis
      // If so, preserve spaces around it
      const isBeforeInlineCode =
        parentNode &&
        parentNode.children &&
        typeof index === 'number' &&
        index < parentNode.children.length - 1 &&
        parentNode.children[index + 1].type === 'inlineCode';

      const isAfterInlineCode =
        parentNode &&
        parentNode.children &&
        typeof index === 'number' &&
        index > 0 &&
        parentNode.children[index - 1].type === 'inlineCode';

      // Check if adjacent to strong or emphasis elements
      const isBeforeStrong =
        parentNode &&
        parentNode.children &&
        typeof index === 'number' &&
        index < parentNode.children.length - 1 &&
        (parentNode.children[index + 1].type === 'strong' ||
          parentNode.children[index + 1].type === 'emphasis');

      const isAfterStrong =
        parentNode &&
        parentNode.children &&
        typeof index === 'number' &&
        index > 0 &&
        (parentNode.children[index - 1].type === 'strong' ||
          parentNode.children[index - 1].type === 'emphasis');

      // Preserve Japanese punctuation and spacing
      // Don't add extra spaces around Japanese punctuation
      textNode.value = textNode.value
        .replace(/\s+([、。！？])/g, '$1') // Remove spaces before Japanese punctuation
        .replace(/([、。！？])\s+/g, '$1'); // Remove spaces after Japanese punctuation

      // Only trim trailing spaces if:
      // 1. Not adjacent to code or strong/emphasis elements
      // 2. The text node doesn't contain operators that need spacing
      // This preserves spaces between bold elements like "**VCA** + **Envelope**"
      const hasOperators = /[+\-=*/<>]/.test(textNode.value);

      if (
        !isBeforeInlineCode &&
        !isAfterInlineCode &&
        !isBeforeStrong &&
        !isAfterStrong &&
        !hasOperators
      ) {
        // Only trim if the entire value is whitespace or ends with multiple spaces
        if (textNode.value.trim() === '') {
          textNode.value = '';
        } else if (/\s{2,}$/.test(textNode.value)) {
          // Only trim if there are 2+ trailing spaces
          textNode.value = textNode.value.replace(/\s+$/g, ' ');
        }
      }
    });

    // Handle spacing around Japanese headings
    visit(tree, 'heading', (node: Node) => {
      const heading = node as HeadingNode;
      if (heading.children && heading.children[0] && heading.children[0].type === 'text') {
        const textChild = heading.children[0] as TextNode;
        const text = textChild.value;
        // Check if the heading contains Japanese characters
        if (/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(text)) {
          // Ensure proper formatting for Japanese headings
          textChild.value = text.trim();
        }
      }
    });
  };
}
