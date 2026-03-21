/**
 * Shared utility functions for mdx-formatter
 */

import { MdxFormatter } from './mdx-formatter.js';
import type { FormatterSettings } from './types.js';

/**
 * Run the formatter in a convergence loop until output stabilizes.
 * Some rule interactions may require multiple passes (most files converge
 * in 1, edge cases in 2). 3 iterations is sufficient for all known cases.
 */
export async function formatWithConvergence(
  content: string,
  settings: FormatterSettings,
  maxIterations = 3,
): Promise<string> {
  let result = content;
  for (let i = 0; i < maxIterations; i++) {
    const formatter = new MdxFormatter(result, settings);
    const formatted = await formatter.format();
    if (formatted === result) break;
    result = formatted;
  }
  return result;
}

/**
 * Deep clone a settings object to prevent global mutation
 */
export function deepCloneSettings<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepCloneSettings(item)) as T;
  }

  const clonedObj: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.hasOwn(obj as object, key)) {
      clonedObj[key] = deepCloneSettings((obj as Record<string, unknown>)[key]);
    }
  }
  return clonedObj as T;
}

/**
 * Deep merge source into target, returning a new object.
 * Arrays are replaced (not concatenated).
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = deepCloneSettings(target);

  for (const key of Object.keys(source)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    const sourceVal = source[key];
    const targetVal = result[key];

    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      result[key] = deepCloneSettings(sourceVal);
    }
  }

  return result;
}
