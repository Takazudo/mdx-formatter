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
 * Type-safe wrapper for merging settings with untyped config objects.
 * The deep merge operates on plain objects, so we cast at the boundary.
 */
function mergeSettings(
  base: FormatterSettings,
  overrides: Record<string, unknown>,
): FormatterSettings {
  return deepMerge(
    base as unknown as Record<string, unknown>,
    overrides,
  ) as unknown as FormatterSettings;
}

/**
 * Try to find and read a config file
 */
function findConfigFile(configPath?: string): Record<string, unknown> | null {
  // If explicit path given, use it
  if (configPath) {
    try {
      const content = readFileSync(resolve(configPath), 'utf-8');
      const parsed: unknown = JSON.parse(content);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Try .mdx-formatter.json in cwd
  try {
    const content = readFileSync(resolve('.mdx-formatter.json'), 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
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
 * Load config file once and return both formatter settings and exclude patterns.
 * This avoids reading the config file multiple times in the CLI path.
 */
export function loadFullConfig(options: FormatOptions = {}): {
  settings: FormatterSettings;
  excludePatterns: string[];
} {
  // Layer 1: Built-in defaults
  let settings = deepCloneSettings(formatterSettings);

  // Layer 2: Config file
  const fileConfig = findConfigFile(options.config);

  // Extract exclude patterns (CLI concern, not formatter settings)
  let excludePatterns: string[] = [];
  if (fileConfig) {
    if (Array.isArray(fileConfig.exclude)) {
      excludePatterns = fileConfig.exclude.filter(
        (item): item is string => typeof item === 'string',
      );
    }
    const formatterConfig = { ...fileConfig };
    delete formatterConfig.exclude;
    settings = mergeSettings(settings, formatterConfig);
  }

  // Layer 3: Programmatic options
  if (options.settings) {
    settings = mergeSettings(settings, options.settings as Record<string, unknown>);
  }

  return { settings, excludePatterns };
}

/**
 * Load exclude patterns from config file.
 * These are glob patterns for files the CLI should skip.
 */
export function loadExcludePatterns(configPath?: string): string[] {
  return loadFullConfig({ config: configPath }).excludePatterns;
}

/**
 * Load and merge all configuration layers
 */
export function loadConfig(options: FormatOptions = {}): FormatterSettings {
  return loadFullConfig(options).settings;
}
