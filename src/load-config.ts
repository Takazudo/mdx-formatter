/**
 * Configuration loading for mdx-formatter
 *
 * Loads and merges settings from three layers:
 * 1. Built-in defaults (from settings.ts)
 * 2. Config file (.mdx-formatter.json or "mdx-formatter" key in package.json)
 * 3. Programmatic options (passed to format())
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { formatterSettings } from './settings.js';
import { deepCloneSettings, deepMerge } from './utils.js';
import type { FormatterSettings, FormatOptions } from './types.js';

/**
 * Try to find and read a config file
 */
function findConfigFile(configPath?: string): Record<string, unknown> | null {
  // If explicit path given, use it
  if (configPath) {
    try {
      const content = readFileSync(resolve(configPath), 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Try .mdx-formatter.json in cwd
  try {
    const content = readFileSync(resolve('.mdx-formatter.json'), 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    // Not found, try package.json
  }

  // Try "mdx-formatter" key in package.json
  try {
    const content = readFileSync(resolve('package.json'), 'utf-8');
    const pkg = JSON.parse(content) as Record<string, unknown>;
    if (pkg['mdx-formatter'] && typeof pkg['mdx-formatter'] === 'object') {
      return pkg['mdx-formatter'] as Record<string, unknown>;
    }
  } catch {
    // Not found
  }

  return null;
}

/**
 * Load and merge all configuration layers
 */
export function loadConfig(options: FormatOptions = {}): FormatterSettings {
  // Layer 1: Built-in defaults
  let settings = deepCloneSettings(formatterSettings);

  // Layer 2: Config file
  const fileConfig = findConfigFile(options.config);
  if (fileConfig) {
    settings = deepMerge(
      settings as unknown as Record<string, unknown>,
      fileConfig,
    ) as unknown as FormatterSettings;
  }

  // Layer 3: Programmatic options
  if (options.settings) {
    settings = deepMerge(
      settings as unknown as Record<string, unknown>,
      options.settings as Record<string, unknown>,
    ) as unknown as FormatterSettings;
  }

  return settings;
}
