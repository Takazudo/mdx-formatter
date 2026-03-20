import type { Root, Code } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin that transforms D2 code blocks into client-renderable containers.
 *
 * Runs BEFORE Shiki, so we can catch `lang: "d2"` before it falls back to plaintext.
 * Converts D2 code blocks into raw HTML divs that the client-side D2 WASM renderer
 * can pick up and render.
 *
 * Used in dev mode for instant diagram feedback. In production, astro-d2 handles
 * static SVG generation instead.
 */

export function remarkD2Client() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (!parent || index === undefined) return;
      if (node.lang !== 'd2') return;

      // Escape HTML entities in the D2 source
      const escaped = node.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      // Replace the code node with raw HTML that the D2 client renderer picks up
      (parent.children as unknown[])[index] = {
        type: 'html',
        value: `<div class="d2-diagram" data-d2>${escaped}</div>`,
      };
    });
  };
}
