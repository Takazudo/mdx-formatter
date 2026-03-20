/**
 * Core type definitions for mdx-formatter
 */

import type { Node, Parent, Position } from 'unist';
import type { Root } from 'mdast';

// Re-export useful AST types
export type { Node, Parent, Position, Root };

/**
 * Common AST node interfaces used across plugins
 */
export interface ParentNode extends Node {
  children: Node[];
}

export interface TextNode extends Node {
  type: 'text';
  value: string;
}

export interface HeadingNode extends Node {
  type: 'heading';
  children: Node[];
}

export interface HtmlNode extends Node {
  value?: string;
}

export interface ListNode extends Node {
  type: 'list';
  ordered?: boolean;
  start?: number | null;
  spread?: boolean;
  children: ListItemNode[];
}

export interface ListItemNode extends Node {
  type: 'listItem';
  spread?: boolean;
  data?: Record<string, unknown>;
}

/**
 * MDX JSX attribute value expression node
 */
export interface MdxJsxAttributeValueExpression {
  type: 'mdxJsxAttributeValueExpression';
  value?: string;
  position?: Position;
  data?: {
    estree?: unknown;
  };
}

/**
 * MDX JSX attribute node
 */
export interface MdxJsxAttribute {
  type: 'mdxJsxAttribute';
  name: string;
  value: string | MdxJsxAttributeValueExpression | null | undefined;
}

/**
 * MDX JSX element node (flow or text)
 */
export interface MdxJsxElement extends Node {
  type: 'mdxJsxFlowElement' | 'mdxJsxTextElement';
  name: string | null;
  attributes: MdxJsxAttribute[];
  children: Node[];
  selfClosing?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Individual formatter setting rule configurations
 */
export interface AddEmptyLineBetweenElementsSetting {
  enabled: boolean;
  description: string;
}

export interface FormatMultiLineJsxSetting {
  enabled: boolean;
  description: string;
  indentSize: number;
  indentType?: string;
  ignoreComponents: string[];
  preserveTemplateLiteralIndent: boolean;
}

export interface FormatHtmlBlocksInMdxSetting {
  enabled: boolean;
  description: string;
  formatterConfig: {
    parser: string;
    tabWidth: number;
    useTabs: boolean;
  };
}

export interface ExpandSingleLineJsxSetting {
  enabled: boolean;
  description: string;
  propsThreshold: number;
}

export interface IndentJsxContentSetting {
  enabled: boolean;
  description: string;
  indentSize: number;
  indentType?: string;
  containerComponents: string[];
}

export interface AddEmptyLinesInBlockJsxSetting {
  enabled: boolean;
  description: string;
  blockComponents: string[];
}

export interface FormatYamlFrontmatterSetting {
  enabled: boolean;
  description: string;
  indent: number;
  lineWidth: number;
  quotingType: string;
  forceQuotes: boolean;
  noCompatMode: boolean;
  fixUnsafeValues: boolean;
}

export interface PreserveAdmonitionsSetting {
  enabled: boolean;
  description: string;
}

export interface ErrorHandlingSetting {
  throwOnError: boolean;
  description: string;
}

export interface AutoDetectIndentSetting {
  enabled: boolean;
  description: string;
  fallbackIndentSize: number;
  fallbackIndentType: string;
  minConfidence: number;
}

/**
 * Complete formatter settings object
 */
export interface FormatterSettings {
  addEmptyLineBetweenElements: AddEmptyLineBetweenElementsSetting;
  formatMultiLineJsx: FormatMultiLineJsxSetting;
  formatHtmlBlocksInMdx: FormatHtmlBlocksInMdxSetting;
  expandSingleLineJsx: ExpandSingleLineJsxSetting;
  indentJsxContent: IndentJsxContentSetting;
  addEmptyLinesInBlockJsx: AddEmptyLinesInBlockJsxSetting;
  formatYamlFrontmatter: FormatYamlFrontmatterSetting;
  preserveAdmonitions: PreserveAdmonitionsSetting;
  errorHandling: ErrorHandlingSetting;
  autoDetectIndent: AutoDetectIndentSetting;
}

/**
 * Options passed to the format() API
 */
export interface FormatOptions {
  config?: string;
  settings?: DeepPartial<FormatterSettings>;
}

/**
 * Deep partial utility type
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

/**
 * Formatter operation types used in MdxFormatter
 */
export type FormatterOperation =
  | {
      type: 'insertLine';
      startLine: number;
      content: string;
    }
  | {
      type: 'replaceLines';
      startLine: number;
      endLine: number;
      lines: string[];
    }
  | {
      type: 'indentLine';
      startLine: number;
      indent: string;
    }
  | {
      type: 'fixListIndent';
      startLine: number;
      indent: string;
    }
  | {
      type: 'replaceHtmlBlock';
      startLine: number;
      endLine: number;
      content: string;
    };

/**
 * Position map entry for line/character mapping
 */
export interface PositionMapEntry {
  line: number;
  start: number;
  end: number;
}

/**
 * Indent detector interface (for duck-typed fallback)
 */
export interface IndentDetectorLike {
  getIndentSize(): number;
  getIndentType(): string;
  getIndentString(): string;
  getConfidence(): number;
  formatWithIndent(text: string, level: number): string;
}

/**
 * Indent detection statistics
 */
export interface IndentStats {
  totalLines: number;
  indentedLines: number;
  patterns: Record<string, number>;
  tabLines: number;
  spaceLines: number;
}

/**
 * Indent pattern entry
 */
export interface IndentPattern {
  type: 'tab' | 'space';
  size: number;
}

/**
 * JSX stack entry (legacy, retained for type compatibility)
 */
export interface JsxStackEntry {
  name: string;
  isContainer: boolean;
  hasContent: boolean;
}
