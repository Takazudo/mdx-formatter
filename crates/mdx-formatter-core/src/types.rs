use serde::{Deserialize, Serialize};

/// Individual rule: add empty lines between markdown elements
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddEmptyLineBetweenElementsSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
}

/// Individual rule: format multi-line JSX
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatMultiLineJsxSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_indent_size")]
    pub indent_size: usize,
    #[serde(default)]
    pub indent_type: Option<String>,
    #[serde(default)]
    pub ignore_components: Vec<String>,
    #[serde(default = "default_true")]
    pub preserve_template_literal_indent: bool,
}

/// Individual rule: format HTML blocks in MDX
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatHtmlBlocksInMdxSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
}

/// Individual rule: expand single-line JSX
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpandSingleLineJsxSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_props_threshold")]
    pub props_threshold: usize,
}

/// Individual rule: indent JSX content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndentJsxContentSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_indent_size")]
    pub indent_size: usize,
    #[serde(default)]
    pub indent_type: Option<String>,
    #[serde(default)]
    pub container_components: Vec<String>,
}

/// Individual rule: add empty lines in block JSX
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddEmptyLinesInBlockJsxSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub block_components: Vec<String>,
}

/// Individual rule: format YAML frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatYamlFrontmatterSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_indent_size")]
    pub indent: usize,
    #[serde(default = "default_line_width")]
    pub line_width: usize,
    #[serde(default = "default_quoting_type")]
    pub quoting_type: String,
    #[serde(default)]
    pub force_quotes: bool,
    #[serde(default = "default_true")]
    pub no_compat_mode: bool,
    #[serde(default = "default_true")]
    pub fix_unsafe_values: bool,
}

/// Individual rule: preserve admonitions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreserveAdmonitionsSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
}

/// Individual rule: error handling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorHandlingSetting {
    #[serde(default)]
    pub throw_on_error: bool,
    #[serde(default)]
    pub description: String,
}

/// Individual rule: auto-detect indentation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoDetectIndentSetting {
    pub enabled: bool,
    #[serde(default)]
    pub description: String,
    #[serde(default = "default_indent_size")]
    pub fallback_indent_size: usize,
    #[serde(default = "default_indent_type_string")]
    pub fallback_indent_type: String,
    #[serde(default = "default_min_confidence")]
    pub min_confidence: f64,
}

/// Complete formatter settings — mirrors the TypeScript FormatterSettings
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatterSettings {
    pub add_empty_line_between_elements: AddEmptyLineBetweenElementsSetting,
    pub format_multi_line_jsx: FormatMultiLineJsxSetting,
    pub format_html_blocks_in_mdx: FormatHtmlBlocksInMdxSetting,
    pub expand_single_line_jsx: ExpandSingleLineJsxSetting,
    pub indent_jsx_content: IndentJsxContentSetting,
    pub add_empty_lines_in_block_jsx: AddEmptyLinesInBlockJsxSetting,
    pub format_yaml_frontmatter: FormatYamlFrontmatterSetting,
    pub preserve_admonitions: PreserveAdmonitionsSetting,
    pub error_handling: ErrorHandlingSetting,
    pub auto_detect_indent: AutoDetectIndentSetting,
}

impl Default for FormatterSettings {
    fn default() -> Self {
        Self {
            add_empty_line_between_elements: AddEmptyLineBetweenElementsSetting {
                enabled: true,
                description: "Add single empty line between markdown elements".into(),
            },
            format_multi_line_jsx: FormatMultiLineJsxSetting {
                enabled: true,
                description: "Format JSX/HTML with proper indentation".into(),
                indent_size: 2,
                indent_type: None,
                ignore_components: vec![],
                preserve_template_literal_indent: true,
            },
            format_html_blocks_in_mdx: FormatHtmlBlocksInMdxSetting {
                enabled: true,
                description: "Format all HTML blocks within MDX using Prettier".into(),
            },
            expand_single_line_jsx: ExpandSingleLineJsxSetting {
                enabled: false,
                description: "Expand single-line JSX components with multiple props to multi-line"
                    .into(),
                props_threshold: 2,
            },
            indent_jsx_content: IndentJsxContentSetting {
                enabled: false,
                description: "Add indentation to content inside JSX components".into(),
                indent_size: 2,
                indent_type: None,
                container_components: vec![],
            },
            add_empty_lines_in_block_jsx: AddEmptyLinesInBlockJsxSetting {
                enabled: true,
                description:
                    "Add empty lines after opening and before closing tags in block JSX components"
                        .into(),
                block_components: vec![],
            },
            format_yaml_frontmatter: FormatYamlFrontmatterSetting {
                enabled: true,
                description: "Format YAML frontmatter using proper YAML formatting rules".into(),
                indent: 2,
                line_width: 100,
                quoting_type: "\"".into(),
                force_quotes: false,
                no_compat_mode: true,
                fix_unsafe_values: true,
            },
            preserve_admonitions: PreserveAdmonitionsSetting {
                enabled: true,
                description: "Keep Docusaurus admonitions (:::note, :::tip, etc.) intact".into(),
            },
            error_handling: ErrorHandlingSetting {
                throw_on_error: false,
                description: "How to handle parsing errors - return original or throw".into(),
            },
            auto_detect_indent: AutoDetectIndentSetting {
                enabled: false,
                description: "Automatically detect indentation style from file content".into(),
                fallback_indent_size: 2,
                fallback_indent_type: "space".into(),
                min_confidence: 0.7,
            },
        }
    }
}

impl FormatterSettings {
    /// Create settings from a partial JSON value, merging with defaults.
    ///
    /// TODO(poc): Currently only covers 5 of 10 settings fields.
    /// A proper implementation would use `#[serde(default, rename_all = "camelCase")]`
    /// on FormatterSettings itself to deserialize from JSON automatically.
    /// Missing: expandSingleLineJsx, indentJsxContent, formatHtmlBlocksInMdx,
    ///          errorHandling, autoDetectIndent.
    pub fn from_partial_json(value: &serde_json::Value) -> Self {
        let mut settings = Self::default();

        if let Some(obj) = value.as_object() {
            if let Some(v) = obj.get("addEmptyLineBetweenElements") {
                if let Some(enabled) = v.get("enabled").and_then(|e| e.as_bool()) {
                    settings.add_empty_line_between_elements.enabled = enabled;
                }
            }
            if let Some(v) = obj.get("formatMultiLineJsx") {
                if let Some(enabled) = v.get("enabled").and_then(|e| e.as_bool()) {
                    settings.format_multi_line_jsx.enabled = enabled;
                }
                if let Some(indent) = v.get("indentSize").and_then(|e| e.as_u64()) {
                    settings.format_multi_line_jsx.indent_size = indent as usize;
                }
            }
            if let Some(v) = obj.get("formatYamlFrontmatter") {
                if let Some(enabled) = v.get("enabled").and_then(|e| e.as_bool()) {
                    settings.format_yaml_frontmatter.enabled = enabled;
                }
            }
            if let Some(v) = obj.get("preserveAdmonitions") {
                if let Some(enabled) = v.get("enabled").and_then(|e| e.as_bool()) {
                    settings.preserve_admonitions.enabled = enabled;
                }
            }
            if let Some(v) = obj.get("addEmptyLinesInBlockJsx") {
                if let Some(enabled) = v.get("enabled").and_then(|e| e.as_bool()) {
                    settings.add_empty_lines_in_block_jsx.enabled = enabled;
                }
                if let Some(components) = v.get("blockComponents").and_then(|e| e.as_array()) {
                    settings.add_empty_lines_in_block_jsx.block_components = components
                        .iter()
                        .filter_map(|c| c.as_str().map(|s| s.to_string()))
                        .collect();
                }
            }
        }

        settings
    }
}

/// Formatter operations — line-based edits to apply to source text
#[derive(Debug, Clone)]
pub enum FormatterOperation {
    InsertLine {
        start_line: usize,
        content: String,
    },
    ReplaceLines {
        start_line: usize,
        end_line: usize,
        lines: Vec<String>,
    },
    IndentLine {
        start_line: usize,
        indent: String,
    },
    FixListIndent {
        start_line: usize,
        indent: String,
    },
    ReplaceHtmlBlock {
        start_line: usize,
        end_line: usize,
        content: String,
    },
}

impl FormatterOperation {
    /// Get the start line of the operation (for sorting)
    pub fn start_line(&self) -> usize {
        match self {
            Self::InsertLine { start_line, .. }
            | Self::ReplaceLines { start_line, .. }
            | Self::IndentLine { start_line, .. }
            | Self::FixListIndent { start_line, .. }
            | Self::ReplaceHtmlBlock { start_line, .. } => *start_line,
        }
    }

    /// Get end line (for range operations) or start_line for single-line ops
    pub fn end_line(&self) -> usize {
        match self {
            Self::ReplaceLines { end_line, .. } | Self::ReplaceHtmlBlock { end_line, .. } => {
                *end_line
            }
            _ => self.start_line(),
        }
    }

    /// Create a deduplication key
    pub fn dedup_key(&self) -> String {
        format!("{}-{}-{}", self.type_name(), self.start_line(), self.end_line())
    }

    fn type_name(&self) -> &'static str {
        match self {
            Self::InsertLine { .. } => "insertLine",
            Self::ReplaceLines { .. } => "replaceLines",
            Self::IndentLine { .. } => "indentLine",
            Self::FixListIndent { .. } => "fixListIndent",
            Self::ReplaceHtmlBlock { .. } => "replaceHtmlBlock",
        }
    }
}

// Default value helpers for serde
fn default_indent_size() -> usize {
    2
}

fn default_true() -> bool {
    true
}

fn default_props_threshold() -> usize {
    2
}

fn default_line_width() -> usize {
    100
}

fn default_quoting_type() -> String {
    "\"".into()
}

fn default_indent_type_string() -> String {
    "space".into()
}

fn default_min_confidence() -> f64 {
    0.7
}
