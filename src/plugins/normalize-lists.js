import { visit } from 'unist-util-visit';

/**
 * Plugin to normalize list markers and merge adjacent lists
 */
export function normalizeListsPlugin() {
  return (tree) => {
    // First, merge consecutive lists of the same type
    visit(tree, (node) => {
      // Check if this node has children array
      if (!node.children || !Array.isArray(node.children)) return;

      const newChildren = [];
      let i = 0;

      while (i < node.children.length) {
        const child = node.children[i];

        // Check if this is a list and the next child is also a list of the same type
        if (child.type === 'list' && i + 1 < node.children.length) {
          const nextChild = node.children[i + 1];

          if (
            nextChild.type === 'list' &&
            child.ordered === nextChild.ordered &&
            child.start === nextChild.start
          ) {
            // Merge the lists
            child.children = [...child.children, ...nextChild.children];
            i++; // Skip the next child since we merged it
          }
        }

        newChildren.push(child);
        i++;
      }

      node.children = newChildren;
    });

    // Normalize all unordered list items to use - as marker
    visit(tree, 'listItem', (node, index, parent) => {
      if (parent && parent.ordered === false) {
        // This is an unordered list item
        // The marker is controlled by stringify options, but we ensure consistency
        if (node.data) {
          delete node.data.marker; // Remove any specific marker data
        }
      }
    });

    // Ensure list structure is correct
    visit(tree, 'list', (node) => {
      // Ensure ordered property is set correctly
      if (node.ordered === undefined) {
        node.ordered = false; // Default to unordered
      }

      // Mark as tight list if items are not spread
      if (node.children && node.children.every((item) => !item.spread)) {
        node.spread = false;
      }
    });
  };
}
