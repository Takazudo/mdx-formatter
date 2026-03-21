/**
 * Core type definitions for mdx-formatter
 */

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
