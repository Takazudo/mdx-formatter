/**
 * Shared utility functions for mdx-formatter
 */

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
export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = deepCloneSettings(target);

  for (const key of Object.keys(source)) {
    const sourceVal = (source as Record<string, unknown>)[key];
    const targetVal = (result as Record<string, unknown>)[key];

    if (
      sourceVal &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      targetVal &&
      typeof targetVal === 'object' &&
      !Array.isArray(targetVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = deepCloneSettings(sourceVal);
    }
  }

  return result;
}
