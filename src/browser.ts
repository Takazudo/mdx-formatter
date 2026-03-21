/**
 * Browser-safe entry point for mdx-formatter.
 *
 * Unlike the main entry point (`index.ts`), this module does NOT import
 * `load-config.ts` and therefore avoids pulling in Node's `fs` and `path`.
 * Use this export (`@takazudo/mdx-formatter/browser`) when bundling for
 * Vite, webpack, or any browser environment.
 *
 * By default, `formatHtmlBlocksInMdx` is **disabled** in browser mode because
 * that rule depends on prettier, which is a Node.js dependency. If the code
 * path is never reached, bundlers can tree-shake the prettier import away.
 */

import { detectMdx } from './detect-mdx.js';
import { formatterSettings } from './settings.js';
import { deepCloneSettings, deepMerge, formatWithConvergence } from './utils.js';
import type { FormatterSettings, DeepPartial } from './types.js';

export { detectMdx };
export type { FormatterSettings, DeepPartial };

// Browser-safe defaults: disable formatHtmlBlocksInMdx (requires prettier/Node.js)
const browserDefaults: FormatterSettings = {
  ...formatterSettings,
  formatHtmlBlocksInMdx: {
    ...formatterSettings.formatHtmlBlocksInMdx,
    enabled: false,
  },
};

/**
 * Format markdown/MDX content in browser environments.
 *
 * Uses browser-safe defaults (formatHtmlBlocksInMdx disabled).
 * Pass an optional `settings` object to override individual rules.
 */
export async function format(
  content: string,
  settings: DeepPartial<FormatterSettings> = {},
): Promise<string> {
  const merged: FormatterSettings = deepMerge(
    deepCloneSettings(browserDefaults) as unknown as Record<string, unknown>,
    settings as Record<string, unknown>,
  ) as unknown as FormatterSettings;
  try {
    return await formatWithConvergence(content, merged);
  } catch {
    return content;
  }
}
