use serde::{Deserialize, Serialize};

/// Individual rule: add empty lines between markdown elements
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AddEmptyLineBetweenElementsSetting {
    pub enabled: bool,
    pub description: String,
}

impl Default for AddEmptyLineBetweenElementsSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            description: "Add single empty line between markdown elements".into(),
        }
    }
}

/// Individual rule: format multi-line JSX
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FormatMultiLineJsxSetting {
    pub enabled: bool,
    pub description: String,
    pub indent_size: usize,
    pub indent_type: Option<String>,
    pub ignore_components: Vec<String>,
    pub preserve_template_literal_indent: bool,
}

impl Default for FormatMultiLineJsxSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            description: "Format JSX/HTML with proper indentation".into(),
            indent_size: 2,
            indent_type: None,
            ignore_components: vec![],
            preserve_template_literal_indent: true,
        }
    }
}

/// Formatter config for HTML blocks (parser, tab width, use tabs)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HtmlFormatterConfig {
    pub parser: String,
    pub tab_width: usize,
    pub use_tabs: bool,
}

impl Default for HtmlFormatterConfig {
    fn default() -> Self {
        Self {
            parser: "html".into(),
            tab_width: 2,
            use_tabs: false,
        }
    }
}

/// Individual rule: format HTML blocks in MDX
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FormatHtmlBlocksInMdxSetting {
    pub enabled: bool,
    pub description: String,
    pub formatter_config: HtmlFormatterConfig,
}

impl Default for FormatHtmlBlocksInMdxSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            description: "Format all HTML blocks within MDX using Prettier".into(),
            formatter_config: HtmlFormatterConfig::default(),
        }
    }
}

/// Individual rule: expand single-line JSX
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExpandSingleLineJsxSetting {
    pub enabled: bool,
    pub description: String,
    pub props_threshold: usize,
}

impl Default for ExpandSingleLineJsxSetting {
    fn default() -> Self {
        Self {
            enabled: false,
            description: "Expand single-line JSX components with multiple props to multi-line"
                .into(),
            props_threshold: 2,
        }
    }
}

/// Individual rule: indent JSX content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct IndentJsxContentSetting {
    pub enabled: bool,
    pub description: String,
    pub indent_size: usize,
    pub indent_type: Option<String>,
    pub container_components: Vec<String>,
}

impl Default for IndentJsxContentSetting {
    fn default() -> Self {
        Self {
            enabled: false,
            description: "Add indentation to content inside JSX components".into(),
            indent_size: 2,
            indent_type: None,
            container_components: vec![],
        }
    }
}

/// Individual rule: add empty lines in block JSX
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AddEmptyLinesInBlockJsxSetting {
    pub enabled: bool,
    pub description: String,
    pub block_components: Vec<String>,
}

impl Default for AddEmptyLinesInBlockJsxSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            description:
                "Add empty lines after opening and before closing tags in block JSX components"
                    .into(),
            block_components: vec![],
        }
    }
}

/// Individual rule: format YAML frontmatter
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct FormatYamlFrontmatterSetting {
    pub enabled: bool,
    pub description: String,
    pub indent: usize,
    pub line_width: usize,
    pub quoting_type: String,
    pub force_quotes: bool,
    pub no_compat_mode: bool,
    pub fix_unsafe_values: bool,
}

impl Default for FormatYamlFrontmatterSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            description: "Format YAML frontmatter using proper YAML formatting rules".into(),
            indent: 2,
            line_width: 100,
            quoting_type: "\"".into(),
            force_quotes: false,
            no_compat_mode: true,
            fix_unsafe_values: true,
        }
    }
}

/// Individual rule: preserve admonitions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PreserveAdmonitionsSetting {
    pub enabled: bool,
    pub description: String,
}

impl Default for PreserveAdmonitionsSetting {
    fn default() -> Self {
        Self {
            enabled: true,
            description: "Keep Docusaurus admonitions (:::note, :::tip, etc.) intact".into(),
        }
    }
}

/// Individual rule: error handling
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ErrorHandlingSetting {
    pub throw_on_error: bool,
    pub description: String,
}

impl Default for ErrorHandlingSetting {
    fn default() -> Self {
        Self {
            throw_on_error: false,
            description: "How to handle parsing errors - return original or throw".into(),
        }
    }
}

/// Individual rule: auto-detect indentation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AutoDetectIndentSetting {
    pub enabled: bool,
    pub description: String,
    pub fallback_indent_size: usize,
    pub fallback_indent_type: String,
    pub min_confidence: f64,
}

impl Default for AutoDetectIndentSetting {
    fn default() -> Self {
        Self {
            enabled: false,
            description: "Automatically detect indentation style from file content".into(),
            fallback_indent_size: 2,
            fallback_indent_type: "space".into(),
            min_confidence: 0.7,
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// List Normalize — config schema (owned by sub-issue #81, filled by #82-#85)
//
// Four cross-cutting list-normalize rules share one parent struct so the
// schema surface is scannable in one place and downstream rules add behavior
// (not schema).
//
// Default values (locked here):
//
//   | Key                                    | Values                             | Default       |
//   |----------------------------------------|------------------------------------|---------------|
//   | tighten-list-continuations             | "off" | "heuristic" | "aggressive" | "heuristic"   |
//   | recover-escaped-code-in-lists          | "off" | "safe"      | "aggressive" | "safe"        |
//   | recover-escaped-tables-in-lists        | "off" | "safe"      | "aggressive" | "safe"        |
//   | recover-escaped-paragraphs-in-lists    | "off" | "heuristic" | "aggressive" | "off"         |
//
// Middle-variant divergence: tighten's middle value is `heuristic` (a structural
// best-effort pass), while the three recover-* rules reserve their middle value
// as `safe` — a "strong-evidence only" mode that refuses to recover blocks unless
// fence / pipe / prose signals are unambiguous. The name difference is intentional
// and documents intent at the config site.
// ────────────────────────────────────────────────────────────────────────────

/// Tighten-list-continuations mode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TightenListContinuationsMode {
    Off,
    #[default]
    Heuristic,
    Aggressive,
}

/// Recover-escaped-code-in-lists mode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecoverEscapedCodeMode {
    Off,
    #[default]
    Safe,
    Aggressive,
}

/// Recover-escaped-tables-in-lists mode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecoverEscapedTablesMode {
    Off,
    #[default]
    Safe,
    Aggressive,
}

/// Recover-escaped-paragraphs-in-lists mode.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RecoverEscapedParagraphsMode {
    #[default]
    Off,
    Heuristic,
    Aggressive,
}

/// Shape of a list item's content, derived by the detection pass in
/// `formatter::collect_list_item_shapes`. Downstream list-normalize rules
/// (#82-#85) dispatch on this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ListItemShape {
    /// Only paragraph children (or empty).
    ParagraphsOnly,
    /// At least one fenced code block child (and no table/sublist).
    HasCodeFence,
    /// At least one GFM table child (and no sublist).
    HasTable,
    /// At least one nested List child (and nothing else interesting).
    HasSublist,
    /// Any combination of the above.
    Mixed,
}

/// Parent struct holding all four list-normalize rule settings. Downstream
/// rules (#82-#85) read their own field here; they do not add keys directly to
/// `FormatterSettings`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "kebab-case")]
pub struct ListNormalizeSettings {
    pub tighten_list_continuations: TightenListContinuationsMode,
    pub recover_escaped_code_in_lists: RecoverEscapedCodeMode,
    pub recover_escaped_tables_in_lists: RecoverEscapedTablesMode,
    pub recover_escaped_paragraphs_in_lists: RecoverEscapedParagraphsMode,
}

/// Complete formatter settings — mirrors the TypeScript FormatterSettings
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
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

    /// List normalize rule bundle. All four rules share a flat top-level key
    /// surface in the public config (see `config.rs` for the lift-in/out glue):
    /// `tighten-list-continuations`, `recover-escaped-code-in-lists`,
    /// `recover-escaped-tables-in-lists`, `recover-escaped-paragraphs-in-lists`.
    #[serde(skip)]
    pub list_normalize: ListNormalizeSettings,
}

impl FormatterSettings {
    /// Create settings from a partial JSON value, merging with defaults.
    ///
    /// Uses serde deserialization with `#[serde(default)]` to automatically
    /// fill missing fields from Default impls. All 10 settings fields are
    /// supported with camelCase JSON keys.
    pub fn from_partial_json(value: &serde_json::Value) -> Self {
        serde_json::from_value(value.clone()).unwrap_or_default()
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
        format!(
            "{}-{}-{}",
            self.type_name(),
            self.start_line(),
            self.end_line()
        )
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
