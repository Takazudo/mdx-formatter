/**
 * Configuration loading for mdx-formatter
 *
 * Loads and merges settings from three layers:
 * 1. Built-in defaults (from settings.mjs)
 * 2. Config file (.mdx-formatter.json or "mdx-formatter" key in package.json)
 * 3. Programmatic options (passed to format())
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { formatterSettings } from './settings.mjs';
import { deepCloneSettings, deepMerge } from './utils.js';

/**
 * Try to find and read a config file
 * @param {string} [configPath] - Explicit config file path
 * @returns {Object|null} Config object or null if not found
 */
function findConfigFile(configPath) {
  // If explicit path given, use it
  if (configPath) {
    try {
      const content = readFileSync(resolve(configPath), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  // Try .mdx-formatter.json in cwd
  try {
    const content = readFileSync(resolve('.mdx-formatter.json'), 'utf-8');
    return JSON.parse(content);
  } catch {
    // Not found, try package.json
  }

  // Try "mdx-formatter" key in package.json
  try {
    const content = readFileSync(resolve('package.json'), 'utf-8');
    const pkg = JSON.parse(content);
    if (pkg['mdx-formatter'] && typeof pkg['mdx-formatter'] === 'object') {
      return pkg['mdx-formatter'];
    }
  } catch {
    // Not found
  }

  return null;
}

/**
 * Load and merge all configuration layers
 * @param {Object} [options] - Programmatic options
 * @param {string} [options.config] - Path to config file
 * @param {Object} [options.settings] - Direct settings overrides
 * @returns {Object} Merged settings
 */
export function loadConfig(options = {}) {
  // Layer 1: Built-in defaults
  let settings = deepCloneSettings(formatterSettings);

  // Layer 2: Config file
  const fileConfig = findConfigFile(options.config);
  if (fileConfig) {
    settings = deepMerge(settings, fileConfig);
  }

  // Layer 3: Programmatic options
  if (options.settings) {
    settings = deepMerge(settings, options.settings);
  }

  return settings;
}
