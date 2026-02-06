import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { Node } from 'unist';

interface ListNode extends Node {
  type: 'list';
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  children: ListItemNode[];
}

interface ListItemNode extends Node {
  type: 'listItem';
  spread?: boolean;
  data?: Record<string, unknown>;
}

interface ParentNode extends Node {
  children: Node[];
}

/**
 * Plugin to normalize list markers and merge adjacent lists
 */
export function normalizeListsPlugin() {
  return (tree: Root) => {
    // First, merge consecutive lists of the same type
    visit(tree, (node: Node) => {
      const parent = node as ParentNode;
      // Check if this node has children array
      if (!parent.children || !Array.isArray(parent.children)) return;

      const newChildren: Node[] = [];
      let i = 0;

      while (i < parent.children.length) {
        const child = parent.children[i] as ListNode;

        // Check if this is a list and the next child is also a list of the same type
        if (child.type === 'list' && i + 1 < parent.children.length) {
          const nextChild = parent.children[i + 1] as ListNode;

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

      parent.children = newChildren;
    });

    // Normalize all unordered list items to use - as marker
    visit(tree, 'listItem', (node: Node, _index, parent) => {
      const listItem = node as ListItemNode;
      const parentList = parent as ListNode | null;
      if (parentList && parentList.ordered === false) {
        // This is an unordered list item
        // The marker is controlled by stringify options, but we ensure consistency
        if (listItem.data) {
          delete listItem.data.marker; // Remove any specific marker data
        }
      }
    });

    // Ensure list structure is correct
    visit(tree, 'list', (node: Node) => {
      const list = node as ListNode;
      // Ensure ordered property is set correctly
      if (list.ordered === undefined) {
        list.ordered = false; // Default to unordered
      }

      // Mark as tight list if items are not spread
      if (list.children && list.children.every((item) => !item.spread)) {
        list.spread = false;
      }
    });
  };
}
