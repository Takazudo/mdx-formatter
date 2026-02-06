/**
 * Shared utility functions for mdx-formatter
 */

/**
 * Deep clone a settings object to prevent global mutation
 * @param {Object} obj - The settings object to clone
 * @returns {Object} A deep clone of the settings
 */
export function deepCloneSettings(obj) {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime());
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepCloneSettings(item));
  }

  if (obj instanceof Object) {
    const clonedObj = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepCloneSettings(obj[key]);
      }
    }
    return clonedObj;
  }
}

/**
 * Deep merge source into target, returning a new object.
 * Arrays are replaced (not concatenated).
 * @param {Object} target - Base settings
 * @param {Object} source - Overrides to apply
 * @returns {Object} Merged settings
 */
export function deepMerge(target, source) {
  const result = deepCloneSettings(target);

  for (const key of Object.keys(source)) {
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
      result[key] = deepMerge(targetVal, sourceVal);
    } else {
      result[key] = deepCloneSettings(sourceVal);
    }
  }

  return result;
}
