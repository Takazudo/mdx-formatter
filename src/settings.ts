/**
 * Markdown Formatter Settings - 7 Core Rules
 * Each option can be toggled on/off independently
 */

import type { FormatterSettings } from './types.js';

export const formatterSettings: FormatterSettings = {
  // Rule 1: Add 1 empty line between markdown elements (headings, paragraphs, lists)
  addEmptyLineBetweenElements: {
    enabled: true,
    description: 'Add single empty line between markdown elements',
  },

  // Rule 2: Format multi-line JSX/HTML components with proper indentation
  formatMultiLineJsx: {
    enabled: true,
    description: 'Format JSX/HTML with proper indentation',
    indentSize: 2,
    // Components to ignore (preserve their formatting completely)
    ignoreComponents: [],
    // Preserve indentation inside template literal JSX attributes (html={`...`}, css={`...`})
    preserveTemplateLiteralIndent: true,
  },

  // Rule 3: Format all HTML blocks within MDX using Prettier
  formatHtmlBlocksInMdx: {
    enabled: true,
    description: 'Format all HTML blocks within MDX using Prettier',
    formatterConfig: {
      parser: 'html',
      tabWidth: 2,
      useTabs: false,
    },
  },

  // Rule 4: Convert single-line JSX with multiple props to multi-line format
  expandSingleLineJsx: {
    enabled: false, // disabled until inline JSX content-loss bug is fixed
    description: 'Expand single-line JSX components with multiple props to multi-line',
    propsThreshold: 2, // Expand if this many props or more
    // Also respects ignoreComponents from formatMultiLineJsx
  },

  // Rule 5: Indent content inside JSX container components (DISABLED)
  // Disabled: We prefer flat formatting for simplicity in MDX files
  indentJsxContent: {
    enabled: false,
    description: 'Add indentation to content inside JSX components like <Outro>',
    indentSize: 2,
    // Components that should have their content indented
    containerComponents: [],
  },

  // Rule 6: Add empty lines inside block JSX components
  // Adds empty lines after opening tag and before closing tag for better readability
  addEmptyLinesInBlockJsx: {
    enabled: true,
    description: 'Add empty lines after opening and before closing tags in block JSX components',
    // Components that should have empty lines added
    blockComponents: [],
  },

  // Rule 7: Format YAML frontmatter
  formatYamlFrontmatter: {
    enabled: true,
    description: 'Format YAML frontmatter using proper YAML formatting rules',
    // YAML formatting options
    indent: 2, // Number of spaces for indentation
    lineWidth: 100, // Maximum line width for folded strings
    quotingType: '"', // Quote type for strings that need quoting: '"' or "'"
    forceQuotes: false, // Force quotes on all string values
    noCompatMode: true, // Use YAML 1.2 spec (not 1.1)
    fixUnsafeValues: true, // Pre-process YAML to quote values containing special characters like colons
  },

  // Rule 8: Preserve Docusaurus admonitions
  preserveAdmonitions: {
    enabled: true,
    description: 'Keep Docusaurus admonitions (:::note, :::tip, etc.) intact',
  },

  // Rule 9: Error handling behavior
  errorHandling: {
    throwOnError: false, // Don't throw error, return original content with warning
    description: 'How to handle parsing errors - return original or throw',
  },

  // Rule 10: Auto-detect indentation from file content
  autoDetectIndent: {
    enabled: false,
    description: 'Automatically detect indentation style from file content',
    fallbackIndentSize: 2, // Default indent size if detection fails
    fallbackIndentType: 'space', // Default indent type ('space' or 'tab')
    minConfidence: 0.7, // Minimum confidence score to use detected indentation
  },
};
