/**
 * Test helpers for mdx-formatter tests
 *
 * Provides the old project-specific settings that tests were written against.
 * The library now ships with empty component arrays by default, but tests
 * need the original component names to verify behavior.
 */

import type { DeepPartial, FormatterSettings } from '../src/types.js';

export const testSettings: DeepPartial<FormatterSettings> = {
  addEmptyLinesInBlockJsx: {
    blockComponents: ['Outro', 'InfoBox', 'LayoutDivideItem', 'Column'],
  },
  indentJsxContent: {
    containerComponents: ['Outro', 'InfoBox', 'LayoutDivide', 'LayoutDivideItem', 'Column'],
  },
  formatMultiLineJsx: {
    ignoreComponents: ['CodeBlock'],
  },
};
