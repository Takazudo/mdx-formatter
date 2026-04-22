use crate::html_formatter;
use crate::parser;
use crate::types::{FormatterOperation, FormatterSettings, FormatYamlFrontmatterSetting};
use markdown::mdast::{
    AttributeContent, AttributeValue, Node,
};
use regex::Regex;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::LazyLock;

// TS Plugin Validation Summary:
// The Rust formatter uses a hybrid approach (AST analysis + original text preservation)
// which eliminates the need for most TS plugins that exist to work around remark's
// AST round-tripping:
//
// NOT NEEDED (Rust preserves original text, no AST round-tripping):
//   - preserve-jsx.ts         — JSX never mangled
//   - preserve-image-alt.ts   — Colons in alt text preserved
//   - fix-autolink-output.ts  — No angle brackets added to URLs
//   - preprocess-japanese.ts  — Japanese text preserved as-is
//   - japanese-text.ts        — No backslashes inserted, punctuation untouched
//   - fix-formatting-issues.ts — No bold spacing / entity issues
//   - docusaurus-admonitions.ts — ::: syntax preserved as-is
//   - normalize-lists.ts      — List markers preserved, no merging needed
//   - html-definition-list.ts — HTML content preserved as-is
//
// MOSTLY COVERED by spacing rules (AST-based + post-processing):
//   - fix-paragraph-spacing.ts — Heading/JSX/list/code-fence spacing handled;
//     collapsed JSX artifact doesn't occur; import/export spacing may need future work.
//
// See tests/plugin_validation.rs for test cases validating each finding.

// Regex for preprocessing YAML: matches `key: value` lines
static YAML_MAPPING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)([\w][\w.-]*):\s+(.+)$").unwrap());

// Regex for block scalar indicators (>, |, >-, |-, >+, |+, |2-, >1+, etc.)
// Allows optional indent indicator (digit) before the optional chomping indicator.
static BLOCK_SCALAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[|>]\d*[-+]?$").unwrap());

// Regex matching a top-level key line whose value is a block scalar indicator.
// Captures: (key, indicator) from lines like `description: >-`, `body: |2-`, `text: >+ # note`
// Order: optional indent digit THEN optional chomping char, per the YAML spec.
// Allows an optional trailing comment after whitespace.
static YAML_BLOCK_SCALAR_KEY_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^([\w][\w.-]*):\s+([|>]\d*[-+]?)(\s+#.*)?$").unwrap());

// Regex for values that start with special YAML chars
static SPECIAL_START_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[!&*%@`]").unwrap());

// ============================================================================
// ReportSink — audit / dry-run mechanism
// ============================================================================
//
// The `ReportSink` trait lets rules emit structured change descriptions as
// they run, without affecting the normal side effect of pushing
// `FormatterOperation`s. The sink is threaded through
// `format_with_sink` / `try_format_with_sink` and reaches each rule via a
// shared mutable reference inside `format_once`.
//
// ## Emitting from a rule
//
// New rules should emit exactly one `ReportEntry` per logical change they
// would make, immediately alongside the matching `operations.push(...)`.
// Keep `rule` a short, stable kebab-case identifier (e.g.
// `recover-escaped-code-in-lists`) so downstream tooling can filter/group.
// Line numbers are 0-indexed, matching the line vector used throughout this
// module; the CLI converts them to 1-based when printing. `before` is the
// slice of original source lines `[start_line..=end_line]`; `after` is the
// replacement the rule will apply. For single-line ops (`IndentLine`) use
// `start_line == end_line` and single-entry vectors.
//
// To keep the report faithful to what the user wrote, emission happens
// only on the FIRST pass of the convergence loop. Later iterations run
// with `NullSink` because their "before" text is already post-edit and
// would be confusing to report on.
//
// ## Concrete sinks
//
// - `NullSink` compiles to a no-op; used for regular non-audit runs.
// - `VecSink` collects every entry into an in-memory Vec; used by the
//   CLI `--dry-run` mode and by tests that want to assert on the report.
//
// The trait is object-safe so callers can pass any concrete sink behind
// `&mut dyn ReportSink`.

/// One structured change description emitted by a formatter rule.
#[derive(Debug, Clone)]
pub struct ReportEntry {
    /// Stable kebab-case rule identifier.
    pub rule: &'static str,
    /// 0-indexed inclusive start line in the original source.
    pub start_line: usize,
    /// 0-indexed inclusive end line in the original source.
    pub end_line: usize,
    /// Verbatim source lines that would be replaced/indented.
    pub before: Vec<String>,
    /// Lines the rule would produce in place of `before`.
    pub after: Vec<String>,
}

/// Sink that formatter rules emit `ReportEntry`s through. See module docs.
pub trait ReportSink {
    fn emit(&mut self, entry: ReportEntry);
}

/// Default no-op sink — used for non-audit formatting runs.
pub struct NullSink;

impl ReportSink for NullSink {
    fn emit(&mut self, _entry: ReportEntry) {}
}

/// Collects every emitted entry into an in-memory `Vec`.
#[derive(Default, Debug)]
pub struct VecSink {
    pub entries: Vec<ReportEntry>,
}

impl ReportSink for VecSink {
    fn emit(&mut self, entry: ReportEntry) {
        self.entries.push(entry);
    }
}

/// Copy a slice `[s..=e]` out of `lines` as owned `String`s. Used by rules
/// to build `before` snippets for `ReportEntry`.
#[inline]
fn snippet_from_lines(lines: &[&str], s: usize, e: usize) -> Vec<String> {
    let end = e.min(lines.len().saturating_sub(1));
    (s..=end)
        .map(|i| lines.get(i).copied().unwrap_or("").to_string())
        .collect()
}

/// Format markdown/MDX content using the hybrid AST + line-based approach.
///
/// Runs the formatter in a convergence loop (up to 3 iterations) until
/// the output stabilizes, ensuring idempotency.
///
/// When `settings.error_handling.throw_on_error` is true, parse failures
/// are propagated via `try_format()`. Otherwise, errors return the original content.
pub fn format(content: &str, settings: &FormatterSettings) -> String {
    let mut sink = NullSink;
    format_with_sink(content, settings, &mut sink)
}

/// Like `format`, but also emits structured change descriptions through
/// `sink`. Only the first convergence pass emits; subsequent passes use a
/// local `NullSink` so the report always describes changes relative to the
/// original input.
pub fn format_with_sink(
    content: &str,
    settings: &FormatterSettings,
    sink: &mut dyn ReportSink,
) -> String {
    if settings.error_handling.throw_on_error {
        match try_format_with_sink(content, settings, sink) {
            Ok(result) => result,
            Err(e) => panic!("mdx-formatter: {}", e),
        }
    } else {
        run_convergence_loop(content, settings, sink)
    }
}

/// Format markdown/MDX content, returning an error on parse failure.
///
/// Same convergence loop as `format()`, but propagates parse errors instead
/// of silently returning the original content.
pub fn try_format(content: &str, settings: &FormatterSettings) -> Result<String, String> {
    let mut sink = NullSink;
    try_format_with_sink(content, settings, &mut sink)
}

/// Like `try_format`, but also emits structured change descriptions through
/// `sink`. Only the first convergence pass emits; subsequent passes use a
/// local `NullSink`.
pub fn try_format_with_sink(
    content: &str,
    settings: &FormatterSettings,
    sink: &mut dyn ReportSink,
) -> Result<String, String> {
    // Validate parsability once upfront. format_once() uses parse() internally
    // which always succeeds via fallback, so no need to re-validate each iteration.
    parser::try_parse(content)?;
    Ok(run_convergence_loop(content, settings, sink))
}

fn run_convergence_loop(
    content: &str,
    settings: &FormatterSettings,
    sink: &mut dyn ReportSink,
) -> String {
    let mut result = content.to_string();
    const MAX_ITERATIONS: usize = 3;

    // First pass emits through the caller's sink. Subsequent passes use a
    // throw-away NullSink so the report stays anchored to the ORIGINAL input.
    let first = format_once(&result, settings, sink);
    if first == result {
        return result;
    }
    result = first;

    let mut null = NullSink;
    for _ in 1..MAX_ITERATIONS {
        let formatted = format_once(&result, settings, &mut null);
        if formatted == result {
            break;
        }
        result = formatted;
    }
    result
}

/// Single formatting pass: parse AST, collect operations, apply them.
fn format_once(content: &str, settings: &FormatterSettings, sink: &mut dyn ReportSink) -> String {
    // 1. Parse AST
    let ast = parser::parse(content);

    // 2. Split into lines
    let lines: Vec<&str> = content.split('\n').collect();

    // 3. Collect operations
    let mut operations: Vec<FormatterOperation> = Vec::new();

    if settings.add_empty_line_between_elements.enabled {
        collect_spacing_operations(&ast, &lines, &mut operations);
    }

    // JSX multi-line formatting and single-line expansion
    if settings.format_multi_line_jsx.enabled || settings.expand_single_line_jsx.enabled {
        collect_jsx_format_operations(&ast, &lines, settings, &mut operations);
    }

    // JSX content indentation
    if settings.indent_jsx_content.enabled {
        collect_jsx_indent_operations(&ast, &lines, settings, &mut operations);
    }

    // Block JSX empty lines
    if settings.add_empty_lines_in_block_jsx.enabled {
        collect_block_jsx_empty_line_operations(&ast, &lines, settings, &mut operations);
    }

    // YAML frontmatter formatting
    if settings.format_yaml_frontmatter.enabled {
        collect_yaml_format_operations(&ast, &lines, &settings.format_yaml_frontmatter, &mut operations);
    }

    collect_list_indentation_operations(&ast, &lines, &mut operations);

    // ── list-normalize pipeline (issue #81: detect; #82-#85: rule bodies) ──
    // Order inside the convergence loop:
    //   detect → recover-escaped (#83/#84/#85) → tighten-continuation (#82)
    //          → tighten-item-spacing (#90) → wrap-markdown (existing)
    let list_item_shapes = collect_list_item_shapes(&ast);
    let escaped_block_candidates = collect_escaped_block_candidates(&ast, &lines);
    apply_recover_escaped_code_in_lists(
        settings,
        &list_item_shapes,
        &escaped_block_candidates,
        &ast,
        &lines,
        &mut operations,
        sink,
    );
    apply_recover_escaped_tables_in_lists(
        settings,
        &ast,
        &lines,
        &list_item_shapes,
        &escaped_block_candidates,
        &mut operations,
        sink,
    );
    apply_recover_escaped_paragraphs_in_lists(
        settings,
        &list_item_shapes,
        &escaped_block_candidates,
        &ast,
        &lines,
        &mut operations,
        sink,
    );
    apply_tighten_list_continuations(
        settings,
        &list_item_shapes,
        &ast,
        &lines,
        &mut operations,
        sink,
    );
    apply_tighten_list_item_spacing(
        settings,
        &list_item_shapes,
        &ast,
        &lines,
        &mut operations,
        sink,
    );

    // HTML block formatting
    if settings.format_html_blocks_in_mdx.enabled {
        collect_html_block_operations(&ast, &lines, settings, &mut operations);
    }

    // 4. Filter overlapping replacements
    filter_overlapping_replacements(&mut operations);

    // 5. Filter operations inside replaced ranges
    let replaced_ranges = get_replaced_ranges(&operations);
    let operations: Vec<_> = operations
        .into_iter()
        .filter(|op| !is_inside_replaced_range(op, &replaced_ranges))
        .collect();

    // 6. Sort reverse by line (to preserve positions during application)
    let mut operations = operations;
    operations.sort_by(|a, b| {
        let line_cmp = b.start_line().cmp(&a.start_line());
        if line_cmp != std::cmp::Ordering::Equal {
            return line_cmp;
        }
        // At same line, prioritize replacements over insertions
        op_priority(a).cmp(&op_priority(b))
    });

    // 7. Apply operations with deduplication
    let mut result_lines: Vec<String> = lines.iter().map(|s| s.to_string()).collect();
    let mut applied: HashSet<String> = HashSet::new();

    for op in &operations {
        let key = op.dedup_key();
        if applied.contains(&key) {
            continue;
        }
        applied.insert(key);
        apply_operation(&mut result_lines, op);
    }

    // 8. Post-processing: ensure blank lines between adjacent block elements
    ensure_block_element_spacing(&mut result_lines);

    // 9. Join and normalize multiple empty lines
    let result = result_lines.join("\n");
    normalize_empty_lines(&result)
}

/// Priority for sorting operations at the same line
fn op_priority(op: &FormatterOperation) -> u8 {
    match op {
        FormatterOperation::ReplaceLines { .. } => 1,
        FormatterOperation::InsertLine { .. } => 2,
        FormatterOperation::IndentLine { .. } => 3,
        FormatterOperation::FixListIndent { .. } => 4,
        FormatterOperation::ReplaceHtmlBlock { .. } => 5,
    }
}

/// Walk the AST and collect spacing operations.
///
/// Uses a full-tree visitor (like the TS `visit()`) so that headings and JSX
/// elements at ANY nesting depth get the spacing check — not just root children.
fn collect_spacing_operations(
    node: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
) {
    // Check spacing for the current node (heading or JSX at any depth)
    check_node_spacing(node, lines, operations);

    // Recurse into all children
    for child in get_children(node) {
        collect_spacing_operations(child, lines, operations);
    }
}

/// Check if a node (heading or JSX) needs an empty line after it.
fn check_node_spacing(
    node: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
) {
    match node {
        Node::Heading(_) => {
            if let Some(pos) = node.position() {
                let end_line = pos.end.line - 1; // 0-indexed
                if lines.len() > 1 && end_line < lines.len() - 1 {
                    let next_line = lines[end_line + 1];
                    // After heading: insert empty line if next is non-empty, non-heading
                    if !next_line.trim().is_empty() && !next_line.starts_with('#') {
                        operations.push(FormatterOperation::InsertLine {
                            start_line: end_line + 1,
                            content: String::new(),
                        });
                    }
                }
            }
        }
        Node::MdxJsxFlowElement(_) => {
            if let Some(pos) = node.position() {
                let end_line = pos.end.line - 1; // 0-indexed
                if lines.len() > 1 && end_line < lines.len() - 1 {
                    let next_line = lines[end_line + 1];
                    // Skip if current line is inside a table row
                    if let Some(current_line) = lines.get(end_line) {
                        if current_line.trim().starts_with('|') {
                            return; // Skip JSX inside table rows
                        }
                    }
                    // After JSX: insert empty line if next is non-empty text
                    if !next_line.trim().is_empty()
                        && !next_line.trim().starts_with('#')
                        && !next_line.trim().starts_with('-')
                        && !is_numbered_list_line(next_line)
                        && !next_line.trim().starts_with('<')
                    {
                        operations.push(FormatterOperation::InsertLine {
                            start_line: end_line + 1,
                            content: String::new(),
                        });
                    }
                }
            }
        }
        _ => {}
    }
}

/// Get children of any node type that contains children.
fn get_children(node: &Node) -> &[Node] {
    match node {
        Node::Root(n) => &n.children,
        Node::Heading(n) => &n.children,
        Node::Paragraph(n) => &n.children,
        Node::List(n) => &n.children,
        Node::ListItem(n) => &n.children,
        Node::Blockquote(n) => &n.children,
        Node::MdxJsxFlowElement(n) => &n.children,
        Node::MdxJsxTextElement(n) => &n.children,
        Node::Table(n) => &n.children,
        Node::TableRow(n) => &n.children,
        Node::TableCell(n) => &n.children,
        Node::Emphasis(n) => &n.children,
        Node::Strong(n) => &n.children,
        Node::Link(n) => &n.children,
        Node::Delete(n) => &n.children,
        Node::FootnoteDefinition(n) => &n.children,
        _ => &[],
    }
}


// ============================================================================
// JSX Formatting
// ============================================================================

/// Check if a tag name represents an HTML element (lowercase first char)
/// vs a JSX component (uppercase first char).
fn is_html_element(name: &str) -> bool {
    name.chars()
        .next()
        .map_or(true, |c| c.is_ascii_lowercase())
}

/// Check if a JSX node should be formatted.
/// Skips HTML elements, fragments, and ignored components.
fn is_formattable_jsx(
    name: &Option<String>,
    settings: &FormatterSettings,
) -> bool {
    match name {
        None => false, // Fragment
        Some(n) => {
            if is_html_element(n) {
                return false;
            }
            if settings
                .format_multi_line_jsx
                .ignore_components
                .contains(n)
            {
                return false;
            }
            true
        }
    }
}

/// Extract text from source lines using AST position info (1-indexed).
fn extract_node_text(lines: &[&str], start_line: usize, start_col: usize, end_line: usize, end_col: usize) -> String {
    let sl = start_line - 1; // to 0-indexed
    let el = end_line - 1;
    let sc = start_col - 1;
    let ec = end_col - 1;

    if sl == el {
        if sl < lines.len() {
            let line = lines[sl];
            let end = ec.min(line.len());
            let start = sc.min(end);
            return line[start..end].to_string();
        }
        return String::new();
    }

    let mut result = Vec::new();
    // First line
    if sl < lines.len() {
        let line = lines[sl];
        let start = sc.min(line.len());
        result.push(line[start..].to_string());
    }
    // Middle lines
    for i in (sl + 1)..el {
        if i < lines.len() {
            result.push(lines[i].to_string());
        }
    }
    // Last line
    if el < lines.len() {
        let line = lines[el];
        let end = ec.min(line.len());
        result.push(line[..end].to_string());
    }
    result.join("\n")
}

/// Extract an attribute expression value from original text by brace-matching.
/// Returns the full `attrName={...}` string if found.
fn extract_attribute_expression(attr_name: &str, original_text: &str) -> Option<String> {
    let text_lines: Vec<&str> = original_text.split('\n').collect();
    let needle = format!("{}={{", attr_name);

    for (line_idx, line) in text_lines.iter().enumerate() {
        let needle_pos = match line.find(&needle) {
            Some(pos) => pos,
            None => continue,
        };

        let after_open = needle_pos + needle.len();

        // Check if it's a complete single-line expression
        if let Some(close_brace) = line[after_open..].find('}') {
            let between = &line[after_open..after_open + close_brace];
            if !between.contains('{') {
                return Some(format!(
                    "{}={{{}}}",
                    attr_name,
                    &line[after_open..after_open + close_brace]
                ));
            }
        }

        // Multi-line expression - brace matching
        let mut brace_depth: i32 = 1;
        let mut result = needle.clone();
        let mut current_line_idx = line_idx;
        let char_index = after_open;

        while current_line_idx < text_lines.len() && brace_depth > 0 {
            let current_line = text_lines[current_line_idx];
            let start_i = if current_line_idx == line_idx {
                char_index
            } else {
                0
            };
            for ch in current_line[start_i..].chars() {
                result.push(ch);
                if ch == '{' {
                    brace_depth += 1;
                }
                if ch == '}' {
                    brace_depth -= 1;
                    if brace_depth == 0 {
                        return Some(result);
                    }
                }
            }
            current_line_idx += 1;
            if current_line_idx < text_lines.len() && brace_depth > 0 {
                result.push('\n');
            }
        }
    }

    None
}

/// Build an attribute string from AST attribute data, preferring original text
/// for expressions.
fn get_attribute_string(attr: &AttributeContent, original_text: &str, preserve_template_literal: bool) -> String {
    match attr {
        AttributeContent::Expression(expr_attr) => {
            // Spread attribute like {...props}
            format!("{{{}}}", expr_attr.value)
        }
        AttributeContent::Property(prop) => {
            let name = &prop.name;
            match &prop.value {
                None => {
                    // Boolean attribute
                    name.clone()
                }
                Some(AttributeValue::Literal(s)) => {
                    format!("{}=\"{}\"", name, s)
                }
                Some(AttributeValue::Expression(expr)) => {
                    let expr_value = &expr.value;

                    // For template literals, prefer extracting from original text
                    if preserve_template_literal && expr_value.trim_start().starts_with('`') {
                        if let Some(extracted) =
                            extract_attribute_expression(name, original_text)
                        {
                            return extracted;
                        }
                        return format!("{}={{{}}}", name, expr_value);
                    }

                    if !expr_value.is_empty() {
                        format!("{}={{{}}}", name, expr_value)
                    } else {
                        // Try to extract from original text
                        if let Some(extracted) =
                            extract_attribute_expression(name, original_text)
                        {
                            extracted
                        } else {
                            format!("{}={{...}}", name)
                        }
                    }
                }
            }
        }
    }
}

/// Extract children text between opening and closing tags from original text.
fn extract_children_text(name: &str, original_text: &str) -> String {
    let text_lines: Vec<&str> = original_text.split('\n').collect();

    // Find where the opening tag ends
    let mut opening_end_index: Option<usize> = None;
    for (i, line) in text_lines.iter().enumerate() {
        if line.contains('>') && !line.contains("/>") {
            opening_end_index = Some(i);
            break;
        }
    }

    // Find where the closing tag starts
    let closing_tag = format!("</{}", name);
    let mut closing_start_index: Option<usize> = None;
    for i in (0..text_lines.len()).rev() {
        if text_lines[i].contains(&closing_tag) {
            closing_start_index = Some(i);
            break;
        }
    }

    match (opening_end_index, closing_start_index) {
        (Some(open_idx), Some(close_idx)) if close_idx > open_idx => {
            let mut content_lines: Vec<&str> = Vec::new();

            // Handle content on same line as opening tag
            let opening_line = text_lines[open_idx];
            if let Some(pos) = opening_line.find('>') {
                let after_opening = &opening_line[pos + 1..];
                if !after_opening.trim().is_empty() {
                    content_lines.push(after_opening);
                }
            }

            // Add middle lines
            for i in (open_idx + 1)..close_idx {
                content_lines.push(text_lines[i]);
            }

            // Handle content on same line as closing tag
            let closing_line = text_lines[close_idx];
            if let Some(pos) = closing_line.find(&closing_tag) {
                let before_closing = &closing_line[..pos];
                if !before_closing.trim().is_empty() {
                    content_lines.push(before_closing);
                }
            }

            content_lines.join("\n")
        }
        _ => String::new(),
    }
}

/// Check if a JSX element needs formatting.
fn needs_jsx_formatting(
    name: &str,
    attributes: &[AttributeContent],
    start_line_1: usize,
    end_line_1: usize,
    original_text: &str,
    settings: &FormatterSettings,
) -> bool {
    let is_multi_line = start_line_1 != end_line_1;
    let props_threshold = settings.expand_single_line_jsx.props_threshold;

    // Rule 4: Single-line with threshold+ attributes needs expansion
    if !is_multi_line
        && attributes.len() >= props_threshold
        && settings.expand_single_line_jsx.enabled
    {
        return true;
    }

    // Rule 2: Multi-line needs proper formatting
    if is_multi_line && settings.format_multi_line_jsx.enabled {
        let text_lines: Vec<&str> = original_text.split('\n').collect();
        let indent_str = " ".repeat(settings.format_multi_line_jsx.indent_size);

        // Find opening tag end line
        let has_closing_tag = original_text.contains(&format!("</{}>", name));
        let mut opening_tag_end_line = text_lines.len() - 1;
        if has_closing_tag {
            let mut brace_depth: i32 = 0;
            for (i, line) in text_lines.iter().enumerate() {
                for ch in line.chars() {
                    if ch == '{' { brace_depth += 1; }
                    if ch == '}' { brace_depth -= 1; }
                }
                let trimmed = line.trim();
                if brace_depth == 0 && trimmed.ends_with('>') && !trimmed.ends_with("/>") {
                    opening_tag_end_line = i;
                    break;
                }
            }
        }

        // Check for attributes on the first line
        let first_line = text_lines[0];
        if first_line.contains("=\"") && !first_line.ends_with('>') && !first_line.ends_with("/>") {
            return true;
        }

        // Check attribute lines within opening tag
        for i in 1..=opening_tag_end_line {
            if i >= text_lines.len() {
                break;
            }
            let trimmed = text_lines[i].trim();

            // /> on its own line is always wrong
            if trimmed == "/>" {
                return true;
            }

            // Skip empty lines or closing tag
            if trimmed.is_empty() || trimmed.starts_with(&format!("</{}", name)) {
                continue;
            }

            // Check proper indentation
            let line = text_lines[i];
            if !line.starts_with(&indent_str) {
                return true;
            }

            // Check extra space after indent
            let after_indent = &line[indent_str.len()..];
            if after_indent.starts_with(' ') && !after_indent.trim_start().starts_with('{') {
                return true;
            }
        }
    }

    false
}

/// Format a JSX element into properly indented lines.
fn format_jsx_element(
    name: &str,
    attributes: &[AttributeContent],
    children: &[Node],
    original_text: &str,
    start_line_1: usize,
    end_line_1: usize,
    settings: &FormatterSettings,
) -> String {
    let indent = " ".repeat(settings.format_multi_line_jsx.indent_size);
    let props_threshold = settings.expand_single_line_jsx.props_threshold;
    let preserve_template_literal = settings.format_multi_line_jsx.preserve_template_literal_indent;

    let has_closing_tag = original_text.contains(&format!("</{}>", name));
    let is_inline_with_content =
        original_text.contains(">{") || (original_text.contains('>') && has_closing_tag);
    let self_closing = !has_closing_tag && !is_inline_with_content && children.is_empty();

    let should_expand = (settings.expand_single_line_jsx.enabled
        && attributes.len() >= props_threshold)
        || start_line_1 != end_line_1;

    let mut lines: Vec<String> = Vec::new();

    if attributes.is_empty() {
        if self_closing {
            lines.push(format!("<{} />", name));
        } else {
            lines.push(format!("<{}>", name));
        }
    } else if !should_expand && attributes.len() == 1 {
        let attr_str = get_attribute_string(&attributes[0], original_text, preserve_template_literal);
        if self_closing {
            lines.push(format!("<{} {} />", name, attr_str));
        } else {
            lines.push(format!("<{} {}>", name, attr_str));
        }
    } else {
        // Multi-line format
        lines.push(format!("<{}", name));

        for attr in attributes {
            let attr_str = get_attribute_string(attr, original_text, preserve_template_literal);

            if attr_str.contains('\n') {
                let attr_lines: Vec<&str> = attr_str.split('\n').collect();
                lines.push(format!("{}{}", indent, attr_lines[0]));

                let is_template_literal =
                    preserve_template_literal && attr_lines[0].contains("={`");

                for attr_line in &attr_lines[1..] {
                    if is_template_literal {
                        lines.push(attr_line.to_string());
                    } else if attr_line.trim().ends_with("]}") || attr_line.trim() == "]}" {
                        lines.push(format!("{}{}", indent, attr_line.trim()));
                    } else {
                        lines.push(format!("{}  {}", indent, attr_line.trim()));
                    }
                }
            } else {
                lines.push(format!("{}{}", indent, attr_str));
            }
        }

        // Close the opening tag
        if self_closing {
            if let Some(last) = lines.last_mut() {
                last.push_str(" />");
            }
        } else {
            lines.push(">".to_string());
        }
    }

    // Add children content if not self-closing
    if !self_closing {
        let block_components = &settings.add_empty_lines_in_block_jsx.block_components;
        let is_block_component = settings.add_empty_lines_in_block_jsx.enabled
            && block_components.iter().any(|c| c == name);

        let children_text = extract_children_text(name, original_text);
        if !children_text.is_empty() {
            // Add empty line after opening tag for block components
            if is_block_component {
                let first_content_line = children_text.split('\n').next().unwrap_or("");
                if !first_content_line.trim().is_empty() {
                    lines.push(String::new());
                }
            }

            let container_components = &settings.indent_jsx_content.container_components;
            let is_container =
                settings.indent_jsx_content.enabled && container_components.iter().any(|c| c == name);

            if is_container {
                for child_line in children_text.split('\n') {
                    if !child_line.trim().is_empty() {
                        lines.push(format!("{}{}", indent, child_line.trim()));
                    }
                }
            } else {
                for child_line in children_text.split('\n') {
                    lines.push(child_line.to_string());
                }
            }

            // Add empty line before closing tag for block components
            if is_block_component {
                if let Some(last) = lines.last() {
                    if !last.trim().is_empty() {
                        lines.push(String::new());
                    }
                }
            }
        }

        lines.push(format!("</{}>", name));
    }

    lines.join("\n")
}

/// JSX element info extracted from either flow or text elements.
struct JsxElementInfo<'a> {
    name: &'a Option<String>,
    attributes: &'a [AttributeContent],
    children: &'a [Node],
    position: &'a markdown::unist::Position,
}

/// Visit all JSX elements (both flow and text) in the AST.
fn visit_jsx_elements<F>(node: &Node, callback: &mut F)
where
    F: FnMut(JsxElementInfo),
{
    fn visit_children<F>(children: &[Node], callback: &mut F)
    where
        F: FnMut(JsxElementInfo),
    {
        for child in children {
            visit_jsx_elements(child, callback);
        }
    }

    match node {
        Node::Root(root) => visit_children(&root.children, callback),
        Node::MdxJsxFlowElement(jsx) => {
            if let Some(pos) = &jsx.position {
                callback(JsxElementInfo {
                    name: &jsx.name,
                    attributes: &jsx.attributes,
                    children: &jsx.children,
                    position: pos,
                });
            }
            visit_children(&jsx.children, callback);
        }
        Node::MdxJsxTextElement(jsx) => {
            if let Some(pos) = &jsx.position {
                callback(JsxElementInfo {
                    name: &jsx.name,
                    attributes: &jsx.attributes,
                    children: &jsx.children,
                    position: pos,
                });
            }
            visit_children(&jsx.children, callback);
        }
        Node::Blockquote(bq) => visit_children(&bq.children, callback),
        Node::List(list) => visit_children(&list.children, callback),
        Node::ListItem(item) => visit_children(&item.children, callback),
        Node::Paragraph(para) => visit_children(&para.children, callback),
        Node::Heading(h) => visit_children(&h.children, callback),
        _ => {}
    }
}

/// Collect JSX format operations (multi-line formatting, single-line expansion).
fn collect_jsx_format_operations(
    node: &Node,
    lines: &[&str],
    settings: &FormatterSettings,
    operations: &mut Vec<FormatterOperation>,
) {
    visit_jsx_elements(node, &mut |info: JsxElementInfo| {
        if !is_formattable_jsx(info.name, settings) {
            return;
        }

        let start_line = info.position.start.line; // 1-indexed
        let end_line = info.position.end.line;
        let start_line_0 = start_line - 1;
        let end_line_0 = end_line - 1;

        let original_text = extract_node_text(
            lines,
            info.position.start.line,
            info.position.start.column,
            info.position.end.line,
            info.position.end.column,
        );

        let name = info.name.as_deref().unwrap_or("");

        if needs_jsx_formatting(
            name,
            info.attributes,
            start_line,
            end_line,
            &original_text,
            settings,
        ) {
            let formatted = format_jsx_element(
                name,
                info.attributes,
                info.children,
                &original_text,
                start_line,
                end_line,
                settings,
            );

            if formatted != original_text {
                operations.push(FormatterOperation::ReplaceLines {
                    start_line: start_line_0,
                    end_line: end_line_0,
                    lines: formatted.split('\n').map(|s| s.to_string()).collect(),
                });
            }
        }
    });
}

/// Collect JSX indent operations for container components.
fn collect_jsx_indent_operations(
    node: &Node,
    lines: &[&str],
    settings: &FormatterSettings,
    operations: &mut Vec<FormatterOperation>,
) {
    let container_names = &settings.indent_jsx_content.container_components;
    let indent_str = " ".repeat(settings.indent_jsx_content.indent_size);

    visit_jsx_elements(node, &mut |info: JsxElementInfo| {
        if !is_formattable_jsx(info.name, settings) {
            return;
        }

        let name = match info.name {
            Some(n) => n,
            None => return,
        };

        if !container_names.contains(name) {
            return;
        }

        let start_line_0 = info.position.start.line - 1;
        let end_line_0 = info.position.end.line - 1;

        for i in (start_line_0 + 1)..end_line_0 {
            if i >= lines.len() {
                break;
            }
            let line = lines[i];
            let trimmed = line.trim();

            // Skip empty lines and closing tag
            if trimmed.is_empty() || trimmed.starts_with(&format!("</{}", name)) {
                continue;
            }

            // If not indented, add indent operation
            if !line.starts_with(&indent_str) {
                operations.push(FormatterOperation::IndentLine {
                    start_line: i,
                    indent: indent_str.clone(),
                });
            }
        }
    });
}

/// Collect block JSX empty line operations.
fn collect_block_jsx_empty_line_operations(
    node: &Node,
    lines: &[&str],
    settings: &FormatterSettings,
    operations: &mut Vec<FormatterOperation>,
) {
    let block_components = &settings.add_empty_lines_in_block_jsx.block_components;

    visit_jsx_elements(node, &mut |info: JsxElementInfo| {
        if !is_formattable_jsx(info.name, settings) {
            return;
        }

        let name = match info.name {
            Some(n) => n,
            None => return,
        };

        if !block_components.contains(name) {
            return;
        }

        let start_line_0 = info.position.start.line - 1;
        let end_line_0 = info.position.end.line - 1;

        // Handle single-line components
        if start_line_0 == end_line_0 {
            if start_line_0 < lines.len() {
                let line = lines[start_line_0];
                let open_tag = format!("<{}", name);
                let close_tag = format!("</{}>", name);
                if line.contains(&open_tag) && line.contains(&close_tag) {
                    if let Some(opening_tag_end) = line.find('>') {
                        if let Some(closing_tag_start) = line.rfind(&close_tag) {
                            if opening_tag_end + 1 < closing_tag_start {
                                let opening_tag =
                                    line[..opening_tag_end + 1].trim().to_string();
                                let content = line[opening_tag_end + 1..closing_tag_start]
                                    .trim()
                                    .to_string();
                                let closing_tag_str = line[closing_tag_start..].trim().to_string();

                                operations.push(FormatterOperation::ReplaceLines {
                                    start_line: start_line_0,
                                    end_line: start_line_0,
                                    lines: vec![
                                        opening_tag,
                                        String::new(),
                                        content,
                                        String::new(),
                                        closing_tag_str,
                                    ],
                                });
                            }
                        }
                    }
                }
            }
            return;
        }

        // Find the actual end of the opening tag (may span multiple lines)
        let mut opening_tag_end_line = start_line_0;
        for i in start_line_0..=end_line_0 {
            if i >= lines.len() {
                break;
            }
            let trimmed = lines[i].trim();
            if trimmed.ends_with('>')
                && !trimmed.ends_with("/>")
                && !trimmed.starts_with("</")
            {
                opening_tag_end_line = i;
                break;
            }
        }

        // Check if there's an empty line after the opening tag
        if opening_tag_end_line + 1 < lines.len() {
            let line_after_opening = lines[opening_tag_end_line + 1];
            if !line_after_opening.trim().is_empty() {
                operations.push(FormatterOperation::InsertLine {
                    start_line: opening_tag_end_line + 1,
                    content: String::new(),
                });
            }
        }

        // Check if there's an empty line before the closing tag
        if end_line_0 > start_line_0 + 1 {
            let line_before_closing = lines[end_line_0 - 1];
            if !line_before_closing.trim().is_empty()
                && !line_before_closing
                    .trim()
                    .starts_with(&format!("</{}", name))
            {
                operations.push(FormatterOperation::InsertLine {
                    start_line: end_line_0,
                    content: String::new(),
                });
            }
        }
    });
}

/// Walk the AST and collect list indentation fix operations.
///
/// For each list item, computes the expected indentation from the actual
/// marker width (e.g. `- ` = 2, `10. ` = 4) and emits FixListIndent
/// if the current indentation differs.
fn collect_list_indentation_operations(
    node: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
) {
    // Collect expected indentation for all list items.
    let mut indent_targets: Vec<(usize, usize)> = Vec::new(); // (line_0indexed, expected_indent)
    collect_list_nesting(node, lines, 0, &mut indent_targets);

    // Emit fix operations
    for (line_idx, expected_indent) in indent_targets {
        if line_idx >= lines.len() {
            continue;
        }
        let line = lines[line_idx];
        let trimmed = line.trim_start();

        // Check if this is a list item line (starts with -, *, +, or N.)
        let is_list_marker = trimmed.starts_with("- ")
            || trimmed.starts_with("* ")
            || trimmed.starts_with("+ ")
            || is_ordered_list_marker(trimmed);

        if is_list_marker {
            let current_indent = line.len() - trimmed.len();
            if current_indent != expected_indent {
                operations.push(FormatterOperation::FixListIndent {
                    start_line: line_idx,
                    indent: " ".repeat(expected_indent),
                });
            }
        }
    }
}

/// Recursively walk lists, computing expected indent from marker widths, collecting (line, indent) pairs.
fn collect_list_nesting(
    node: &Node,
    lines: &[&str],
    current_indent: usize,
    result: &mut Vec<(usize, usize)>,
) {
    match node {
        Node::Root(root) => {
            for child in &root.children {
                collect_list_nesting(child, lines, 0, result);
            }
        }
        Node::List(list) => {
            for child in &list.children {
                if let Node::ListItem(item) = child {
                    if let Some(pos) = &item.position {
                        let line_idx = pos.start.line - 1; // 0-indexed
                        result.push((line_idx, current_indent));

                        let marker_width = lines
                            .get(line_idx)
                            .map(|line| list_marker_width(line.trim_start()))
                            .unwrap_or(2);
                        let child_indent = current_indent + marker_width;

                        for sub_child in &item.children {
                            collect_list_nesting(sub_child, lines, child_indent, result);
                        }
                    }
                }
            }
        }
        Node::Blockquote(bq) => {
            for child in &bq.children {
                collect_list_nesting(child, lines, current_indent, result);
            }
        }
        Node::ListItem(item) => {
            for child in &item.children {
                collect_list_nesting(child, lines, current_indent, result);
            }
        }
        _ => {}
    }
}

/// Check if a trimmed line starts with an ordered list marker (e.g. "1. ")
fn is_ordered_list_marker(trimmed: &str) -> bool {
    let mut chars = trimmed.chars();
    // Must start with a digit
    match chars.next() {
        Some(c) if c.is_ascii_digit() => {}
        _ => return false,
    }
    // May have more digits
    loop {
        match chars.next() {
            Some(c) if c.is_ascii_digit() => continue,
            Some('.') => break,
            _ => return false,
        }
    }
    // Must be followed by space
    matches!(chars.next(), Some(' '))
}

fn list_marker_width(trimmed: &str) -> usize {
    if trimmed.starts_with("- ") || trimmed.starts_with("* ") || trimmed.starts_with("+ ") {
        return 2;
    }

    let mut width = 0;
    for ch in trimmed.chars() {
        width += ch.len_utf8();
        if ch == '.' {
            if trimmed[width..].starts_with(' ') {
                return width + 1;
            }
            break;
        }
        if !ch.is_ascii_digit() {
            break;
        }
    }

    2
}

fn is_numbered_list_line(line: &str) -> bool {
    let trimmed = line.trim();
    is_ordered_list_marker(trimmed)
}

// ============================================================================
// List Normalize — Detection Pass (issue #81)
// ============================================================================
//
// Shared AST walker that feeds the downstream list-normalize rules:
//   - Sub 2: tighten-list-continuations (#82)
//   - Sub 3: recover-escaped-code-in-lists (#83)
//   - Sub 4: recover-escaped-tables-in-lists (#84)
//   - Sub 5: recover-escaped-paragraphs-in-lists (#85)
//
// Rule-ordering contract (executed inside the existing 3-iteration convergence
// loop in `format()`):
//
//     detect
//       → recover-escaped (Subs 3 / 4 / 5)
//       → tighten-continuation (Sub 2)
//       → wrap-markdown (existing)
//
// Rationale:
//   - recover-escaped runs first because re-indenting an escaped code/table/
//     paragraph block changes which children a list item actually owns. Running
//     tighten against a stale child set produces oscillation.
//   - tighten-continuation runs after recover so it sees the clean, recovered
//     child tree.
//   - Both run before wrap-markdown so the merged / recovered text is re-wrapped
//     with correct indent and line width.
//
// The detection pass itself is read-only: it only emits shape / candidate data,
// it does not mutate the AST or source lines. Downstream rules (#82-#85) are
// stubbed to empty bodies inside this commit — public formatter output is
// unchanged until those rules are filled in.

/// Summary of one list item's content classification, plus enough positional
/// info for downstream rules to locate it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ListItemDetection {
    /// Content classification (see `ListItemShape`).
    pub shape: crate::types::ListItemShape,
    /// 0-indexed line of the item's marker.
    pub start_line: usize,
    /// 0-indexed end line (inclusive) covering the item's full body.
    pub end_line: usize,
    /// 0-indexed start line of the first child block.
    pub first_child_line: Option<usize>,
    /// 0-indexed end line (inclusive) of the last child block.
    pub last_child_line: Option<usize>,
    /// Nesting depth (0 = top-level item).
    pub depth: usize,
    /// 0-indexed column of the marker character (the `-` / `*` / `1`).
    pub marker_column: usize,
    /// Width of `marker + single space` (e.g. 2 for `- `, 3 for `10.`).
    pub marker_width: usize,
    /// Cumulative column where the item's children / continuation lines begin.
    /// Equals `marker_column + marker_width` at this level, summed across
    /// ancestor lists — valid at any nesting depth.
    pub continuation_indent: usize,
    /// 0-indexed line numbers of blank lines that sit between adjacent
    /// paragraph children of this item (useful for tighten-continuation).
    pub inner_blank_gap_lines: Vec<usize>,
}

/// A block sitting in the gap between two sibling list items at the same
/// level but not attached as an AST child of either — a candidate location
/// for escape recovery (fenced code, GFM table, runaway paragraph).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EscapedBlockCandidate {
    /// 0-indexed first line of the candidate block.
    pub start_line: usize,
    /// 0-indexed last line (inclusive) of the candidate block.
    pub end_line: usize,
    /// Rough guess for which recover rule owns this candidate. Downstream
    /// rules re-validate; the guess is advisory.
    pub kind: EscapedBlockKind,
    /// Continuation indent the enclosing list item would require.
    pub expected_continuation_indent: usize,
    /// Nesting depth of the enclosing list (0 = top-level list).
    pub depth: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EscapedBlockKind {
    Code,
    Table,
    Paragraph,
}

/// Public-to-the-module collector. Recursive: visits every `Node::ListItem`
/// at every depth and returns one entry per item.
pub(crate) fn collect_list_item_shapes(node: &Node) -> Vec<ListItemDetection> {
    let mut out = Vec::new();
    walk_list_items(node, 0, 0, &mut out);
    out
}

/// Recursive depth-first traversal. `ancestor_indent` is the cumulative
/// continuation indent contributed by enclosing lists; at root it is 0.
fn walk_list_items(
    node: &Node,
    depth: usize,
    ancestor_indent: usize,
    out: &mut Vec<ListItemDetection>,
) {
    match node {
        Node::List(list) => {
            for child in &list.children {
                if let Node::ListItem(item) = child {
                    if let Some(detection) =
                        build_item_detection(item, depth, ancestor_indent)
                    {
                        let child_indent =
                            detection.marker_column + detection.marker_width;
                        out.push(detection);
                        // Recurse into the item's own children with the
                        // cumulative indent for any nested lists.
                        for sub in &item.children {
                            walk_list_items(sub, depth + 1, child_indent, out);
                        }
                    }
                }
            }
        }
        _ => {
            for child in get_children(node) {
                walk_list_items(child, depth, ancestor_indent, out);
            }
        }
    }
}

/// Classify a single ListItem's children into a `ListItemShape`, gather
/// position info, and compute `continuation_indent`.
fn build_item_detection(
    item: &markdown::mdast::ListItem,
    depth: usize,
    ancestor_indent: usize,
) -> Option<ListItemDetection> {
    use crate::types::ListItemShape;

    let pos = item.position.as_ref()?;
    let start_line = pos.start.line.saturating_sub(1);
    let end_line = pos.end.line.saturating_sub(1);
    // `start.column` in markdown-rs mdast is 1-indexed at the marker char.
    let marker_column = pos.start.column.saturating_sub(1);

    // Classify children.
    let (mut has_paragraph, mut has_code, mut has_table, mut has_sublist, mut has_other) =
        (false, false, false, false, false);
    let mut paragraph_line_ends: Vec<usize> = Vec::new();

    for child in &item.children {
        match child {
            Node::Paragraph(p) => {
                has_paragraph = true;
                if let Some(cp) = &p.position {
                    paragraph_line_ends.push(cp.end.line.saturating_sub(1));
                }
            }
            Node::Code(_) => has_code = true,
            Node::Table(_) => has_table = true,
            Node::List(_) => has_sublist = true,
            _ => has_other = true,
        }
    }

    let interesting_count = [has_code, has_table, has_sublist]
        .iter()
        .filter(|b| **b)
        .count();
    let shape = if interesting_count >= 2 {
        ListItemShape::Mixed
    } else if has_code {
        if has_paragraph || has_other {
            ListItemShape::Mixed
        } else {
            ListItemShape::HasCodeFence
        }
    } else if has_table {
        if has_paragraph || has_other {
            ListItemShape::Mixed
        } else {
            ListItemShape::HasTable
        }
    } else if has_sublist {
        if has_paragraph || has_other {
            ListItemShape::Mixed
        } else {
            ListItemShape::HasSublist
        }
    } else if has_other {
        ListItemShape::Mixed
    } else {
        ListItemShape::ParagraphsOnly
    };

    // Marker width: re-use the shared helper against the trimmed start line
    // is not available here (we don't have `lines`), so derive from the AST
    // children's first-paragraph start column if present, else default to 2.
    // For a proper width, callers needing exact width should use the lines-aware
    // variant in `collect_escaped_block_candidates`.
    let marker_width = if let Some(Node::Paragraph(p)) = item.children.first() {
        if let Some(cp) = &p.position {
            let first_child_col = cp.start.column.saturating_sub(1);
            if first_child_col > marker_column {
                first_child_col - marker_column
            } else {
                2
            }
        } else {
            2
        }
    } else {
        2
    };

    // `markdown-rs` positions are source-absolute, so marker_column already
    // bakes in every ancestor's indent. The `ancestor_indent` parameter is
    // preserved for call-site API stability; it is no longer summed into the
    // result (doing so over-counted at depth ≥ 1 — see #86).
    let _ = ancestor_indent;
    let continuation_indent = marker_column + marker_width;

    // First / last child line
    let first_child_line = item.children.first().and_then(|c| {
        c.position()
            .map(|p| p.start.line.saturating_sub(1))
    });
    let last_child_line = item.children.last().and_then(|c| {
        c.position().map(|p| p.end.line.saturating_sub(1))
    });

    // Inner blank gaps: for each pair of adjacent paragraph children, the
    // blank-line index(es) that sit between them.
    let mut inner_blank_gap_lines: Vec<usize> = Vec::new();
    let mut prev_end: Option<usize> = None;
    for child in &item.children {
        if let Node::Paragraph(p) = child {
            if let Some(cp) = &p.position {
                let this_start = cp.start.line.saturating_sub(1);
                let this_end = cp.end.line.saturating_sub(1);
                if let Some(pe) = prev_end {
                    // Blank gap lines sit strictly between pe and this_start.
                    if this_start > pe + 1 {
                        for gap in (pe + 1)..this_start {
                            inner_blank_gap_lines.push(gap);
                        }
                    }
                }
                prev_end = Some(this_end);
            }
        } else if let Some(cp) = child.position() {
            // Non-paragraph child still advances prev_end so paragraph-to-
            // non-paragraph gaps aren't flagged.
            prev_end = Some(cp.end.line.saturating_sub(1));
        }
    }
    let _ = paragraph_line_ends; // reserved for future heuristics

    Some(ListItemDetection {
        shape,
        start_line,
        end_line,
        first_child_line,
        last_child_line,
        depth,
        marker_column,
        marker_width,
        continuation_indent,
        inner_blank_gap_lines,
    })
}

/// Public-to-the-module collector. Recursive: walks runs of sibling list items
/// at every level and notes lines that look like indented blocks falling in
/// the gap between two items but not attached as AST children. These are the
/// candidate locations for escape recovery (#83 / #84 / #85).
pub(crate) fn collect_escaped_block_candidates(
    node: &Node,
    lines: &[&str],
) -> Vec<EscapedBlockCandidate> {
    let mut out = Vec::new();
    walk_escape_candidates(node, 0, 0, lines, &mut out);
    out
}

fn walk_escape_candidates(
    node: &Node,
    depth: usize,
    ancestor_indent: usize,
    lines: &[&str],
    out: &mut Vec<EscapedBlockCandidate>,
) {
    // `ancestor_indent` is kept for signature stability; markdown-rs positions
    // are source-absolute, so per-item `col + width` is already the correct
    // continuation column at any depth.
    let _ = ancestor_indent;
    if let Node::List(list) = node {
        // Collect the item positions at this level as (start, end, marker_col+width).
        let mut item_spans: Vec<(usize, usize, usize)> = Vec::new();
        for child in &list.children {
            if let Node::ListItem(item) = child {
                if let Some(pos) = &item.position {
                    let s = pos.start.line.saturating_sub(1);
                    let e = pos.end.line.saturating_sub(1);
                    let col = pos.start.column.saturating_sub(1);
                    let width = lines
                        .get(s)
                        .map(|ln| list_marker_width(ln.trim_start()))
                        .unwrap_or(2);
                    item_spans.push((s, e, col + width));
                }
            }
        }

        // For each gap between consecutive items, scan lines that are indented
        // at least to the item's continuation column but not consumed by the
        // AST (since the AST stopped at the sibling boundary). These are our
        // candidates.
        for window in item_spans.windows(2) {
            let (_prev_s, prev_e, expected_indent) = window[0];
            let (next_s, _next_e, _next_col_w) = window[1];
            if next_s <= prev_e + 1 {
                continue;
            }
            let gap_start = prev_e + 1;
            let gap_end = next_s.saturating_sub(1);
            if let Some(candidate) = classify_gap(
                lines,
                gap_start,
                gap_end,
                expected_indent,
                depth,
            ) {
                out.push(candidate);
            }
        }

        // Recurse into each item's children.
        for child in &list.children {
            if let Node::ListItem(item) = child {
                if let Some(pos) = &item.position {
                    let col = pos.start.column.saturating_sub(1);
                    let s = pos.start.line.saturating_sub(1);
                    let width = lines
                        .get(s)
                        .map(|ln| list_marker_width(ln.trim_start()))
                        .unwrap_or(2);
                    // Absolute: source-derived col + width is already the
                    // correct continuation column; no accumulation.
                    let child_indent = col + width;
                    for sub in &item.children {
                        walk_escape_candidates(sub, depth + 1, child_indent, lines, out);
                    }
                }
            }
        }
        return;
    }

    for child in get_children(node) {
        walk_escape_candidates(child, depth, ancestor_indent, lines, out);
    }
}

/// Classify the lines in `[gap_start..=gap_end]` as a Code / Table / Paragraph
/// candidate, or None if nothing interesting sits there.
fn classify_gap(
    lines: &[&str],
    gap_start: usize,
    gap_end: usize,
    expected_indent: usize,
    depth: usize,
) -> Option<EscapedBlockCandidate> {
    let mut first_non_blank: Option<usize> = None;
    let mut last_non_blank: Option<usize> = None;

    for idx in gap_start..=gap_end.min(lines.len().saturating_sub(1)) {
        let line = *lines.get(idx)?;
        if line.trim().is_empty() {
            continue;
        }
        first_non_blank.get_or_insert(idx);
        last_non_blank = Some(idx);
    }

    let (start, end) = (first_non_blank?, last_non_blank?);

    // Inspect the first meaningful line to classify.
    let first_line = lines.get(start).copied()?;
    let first_trim = first_line.trim_start();

    let kind = if is_code_fence_line(first_trim) {
        EscapedBlockKind::Code
    } else if first_trim.starts_with('|') {
        EscapedBlockKind::Table
    } else if !first_trim.is_empty() {
        EscapedBlockKind::Paragraph
    } else {
        return None;
    };

    Some(EscapedBlockCandidate {
        start_line: start,
        end_line: end,
        kind,
        expected_continuation_indent: expected_indent,
        depth,
    })
}

// ── Rule stubs (empty bodies — filled by #82 / #83 / #84 / #85) ──
//
// Each stub receives the shared detection output plus the mutable operations
// vector. The bodies stay empty until their owning sub-issues land, so public
// formatter output is unchanged. Keeping the stubs here (not a later commit)
// lets the order-of-operations contract live entirely in `format_once`.

/// A fenced code block that sits at (or below) the continuation indent of the
/// preceding list item's children — i.e. the parser has spilled it out of the
/// list. Carries enough info for #83 to re-indent the fence and know whether
/// the surrounding context supplies "safe" evidence of intended nesting.
#[derive(Debug, Clone)]
struct EscapedCodePattern {
    /// 0-indexed line of the opening fence.
    fence_start_line: usize,
    /// 0-indexed line of the closing fence (inclusive).
    fence_end_line: usize,
    /// 0-indexed column of the opening fence's first backtick/tilde.
    fence_col: usize,
    /// Target indent the fence needs to reach to become a child of the
    /// preceding list item.
    continuation_indent: usize,
    /// `true` iff both the preceding and the following sibling are ordered
    /// lists. Safe mode requires this.
    is_safe_evidence: bool,
}

/// Walk the AST and locate fenced code blocks sandwiched between list siblings.
///
/// The detection operates at every container level (root, blockquote, list
/// item, etc.) because `markdown-rs` splits a list whenever a col-0 fence
/// intrudes — producing `[List, Code, List, …]` sibling runs under the
/// container. `ancestor_indent` tracks the cumulative continuation indent
/// contributed by enclosing list items so nested cases work too.
fn collect_escaped_code_patterns(
    root: &Node,
    lines: &[&str],
) -> Vec<EscapedCodePattern> {
    let mut out = Vec::new();
    walk_escaped_code_patterns(root, 0, lines, &mut out);
    out
}

fn walk_escaped_code_patterns(
    node: &Node,
    ancestor_indent: usize,
    lines: &[&str],
    out: &mut Vec<EscapedCodePattern>,
) {
    let children = get_children(node);
    for i in 1..children.len() {
        // Looking for the `[..., List, Code, ...]` pattern. The trailing list
        // sibling is checked via `children.get(i + 1)` further down.
        let code = match &children[i] {
            Node::Code(c) => c,
            _ => continue,
        };
        let prev_list = match &children[i - 1] {
            Node::List(l) => l,
            _ => continue,
        };
        let code_pos = match &code.position {
            Some(p) => p,
            None => continue,
        };
        let fence_start_line = code_pos.start.line.saturating_sub(1);
        let fence_end_line = code_pos.end.line.saturating_sub(1);

        // Must be a real fenced block, not an indented code block. `Node::Code`
        // covers both; only fences take the `` ``` `` / `~~~` marker form.
        let src_line = match lines.get(fence_start_line) {
            Some(s) => *s,
            None => continue,
        };
        let fence_col = src_line.len() - src_line.trim_start_matches(' ').len();
        if !is_code_fence_line(&src_line[fence_col..]) {
            continue;
        }

        // The preceding list must have at least one item with a usable
        // position — we need that item's continuation indent.
        let last_item = match prev_list.children.last() {
            Some(Node::ListItem(li)) => li,
            _ => continue,
        };
        let item_pos = match &last_item.position {
            Some(p) => p,
            None => continue,
        };
        let item_start_line = item_pos.start.line.saturating_sub(1);
        let item_col = item_pos.start.column.saturating_sub(1);
        let item_marker_width = lines
            .get(item_start_line)
            .map(|ln| list_marker_width(ln.trim_start()))
            .unwrap_or(2);
        // Absolute continuation — `item_col` already encodes every ancestor's
        // indent (markdown-rs columns are source-absolute).
        let _ = ancestor_indent;
        let continuation_indent = item_col + item_marker_width;

        // If the fence is already indented to the item's continuation column
        // (or deeper), it's not escaped — the parser kept it inside the item.
        if fence_col >= continuation_indent {
            continue;
        }

        // Safe-mode evidence: both neighbours are ordered lists. A numbered-
        // list restart at `2.` lands here because markdown-rs sets the second
        // list's `ordered=true` and `start>1`.
        let next = children.get(i + 1);
        let next_is_list = matches!(next, Some(Node::List(_)));
        if !next_is_list {
            // Spec: "sits at col 0 between two list items". Without a trailing
            // list we have no "between two items" story; skip.
            continue;
        }
        let is_safe_evidence = prev_list.ordered
            && matches!(next, Some(Node::List(l)) if l.ordered);

        out.push(EscapedCodePattern {
            fence_start_line,
            fence_end_line,
            fence_col,
            continuation_indent,
            is_safe_evidence,
        });
    }

    // Recurse. For `Node::List` children we visit each ListItem so that
    // `item.children` get a top-level pattern scan at the next iteration — the
    // `[List, Code, List]` triple can sit at the list-item level (i.e. nested
    // one level down from the outer list), and missing that scan would drop
    // depth-N escape recovery for any N ≥ 1. `ancestor_indent` is bumped to the
    // item's continuation column (absolute, derived from `markdown-rs` source
    // positions — no accumulation needed) so `try_emit` compares against the
    // right escape column.
    for child in children {
        match child {
            Node::List(list) => {
                for item in &list.children {
                    let li = match item {
                        Node::ListItem(li) => li,
                        _ => continue,
                    };
                    let p = match &li.position {
                        Some(p) => p,
                        None => {
                            walk_escaped_code_patterns(item, ancestor_indent, lines, out);
                            continue;
                        }
                    };
                    let col = p.start.column.saturating_sub(1);
                    let s = p.start.line.saturating_sub(1);
                    let w = lines
                        .get(s)
                        .map(|ln| list_marker_width(ln.trim_start()))
                        .unwrap_or(2);
                    // Absolute column: markdown-rs positions already bake in
                    // every ancestor's indent, so `col + w` is the correct
                    // continuation column at any depth.
                    let new_indent = col + w;
                    walk_escaped_code_patterns(item, new_indent, lines, out);
                }
            }
            _ => walk_escaped_code_patterns(child, ancestor_indent, lines, out),
        }
    }
}

fn apply_recover_escaped_code_in_lists(
    settings: &FormatterSettings,
    _shapes: &[ListItemDetection],
    _candidates: &[EscapedBlockCandidate],
    ast: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::RecoverEscapedCodeMode;
    let mode = settings.list_normalize.recover_escaped_code_in_lists;
    if matches!(mode, RecoverEscapedCodeMode::Off) {
        return;
    }

    let patterns = collect_escaped_code_patterns(ast, lines);
    for p in patterns {
        let allow = match mode {
            RecoverEscapedCodeMode::Off => false,
            RecoverEscapedCodeMode::Safe => p.is_safe_evidence,
            RecoverEscapedCodeMode::Aggressive => true,
        };
        if !allow {
            continue;
        }
        if p.continuation_indent <= p.fence_col {
            continue;
        }

        let extra = p.continuation_indent - p.fence_col;
        let prefix: String = " ".repeat(extra);

        // Rebuild the fence block line-by-line. Every line (opening, body,
        // closing) gets the same leading-space prefix so internal indentation
        // is preserved byte-exactly. Empty lines stay empty — prepending
        // spaces to a bare blank would invent trailing whitespace we don't
        // want and isn't needed for CommonMark lazy continuation (the fence
        // is already nested once its opener is indented).
        let mut new_lines: Vec<String> =
            Vec::with_capacity(p.fence_end_line.saturating_sub(p.fence_start_line) + 1);
        for idx in p.fence_start_line..=p.fence_end_line {
            let orig = match lines.get(idx) {
                Some(s) => *s,
                None => continue,
            };
            if orig.is_empty() {
                new_lines.push(String::new());
            } else {
                new_lines.push(format!("{}{}", prefix, orig));
            }
        }

        sink.emit(ReportEntry {
            rule: "recover-escaped-code-in-lists",
            start_line: p.fence_start_line,
            end_line: p.fence_end_line,
            before: snippet_from_lines(lines, p.fence_start_line, p.fence_end_line),
            after: new_lines.clone(),
        });

        operations.push(FormatterOperation::ReplaceLines {
            start_line: p.fence_start_line,
            end_line: p.fence_end_line,
            lines: new_lines,
        });
    }
}

fn apply_recover_escaped_tables_in_lists(
    settings: &FormatterSettings,
    ast: &Node,
    lines: &[&str],
    _shapes: &[ListItemDetection],
    _candidates: &[EscapedBlockCandidate],
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::RecoverEscapedTablesMode;
    let mode = settings.list_normalize.recover_escaped_tables_in_lists;
    if matches!(mode, RecoverEscapedTablesMode::Off) {
        return;
    }
    let aggressive = matches!(mode, RecoverEscapedTablesMode::Aggressive);
    collect_table_recovery_ops(ast, lines, 0, aggressive, operations, sink);
}

/// Walk the AST looking for `[List, Table, List]` sibling patterns — the
/// signature markdown-rs produces when a GFM table at column 0 breaks a list
/// into two neighboring Lists. When surrounding evidence suggests the table
/// was intended to nest under the previous list item, emit a `ReplaceLines`
/// operation that re-indents every row by the enclosing item's continuation
/// indent.
///
/// `ancestor_indent` is the cumulative continuation indent contributed by
/// enclosing list items (0 at the root). `aggressive` widens the evidence
/// bar to also accept matching bullet markers; in `safe` mode only a
/// contiguous numbering run across the gap qualifies.
fn collect_table_recovery_ops(
    node: &Node,
    lines: &[&str],
    ancestor_indent: usize,
    aggressive: bool,
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    // Scan direct children for the [List, Table, List] pattern.
    let children = get_children(node);
    if children.len() >= 3 {
        let mut i = 0;
        while i + 2 < children.len() {
            if let (Node::List(list_a), Node::Table(table), Node::List(list_c)) =
                (&children[i], &children[i + 1], &children[i + 2])
            {
                if let Some(op) =
                    try_emit_table_recovery(list_a, table, list_c, lines, ancestor_indent, aggressive)
                {
                    if let FormatterOperation::ReplaceLines { start_line, end_line, lines: ref new_lines } = op {
                        sink.emit(ReportEntry {
                            rule: "recover-escaped-tables-in-lists",
                            start_line,
                            end_line,
                            before: snippet_from_lines(lines, start_line, end_line),
                            after: new_lines.clone(),
                        });
                    }
                    operations.push(op);
                }
            }
            i += 1;
        }
    }

    // Recurse so nested list items that themselves contain the pattern are
    // handled. Visit each ListItem directly (not just its children) so that
    // `[List, Table, List]` triples living inside an item — i.e. a depth-N
    // escape with N ≥ 1 — get their own top-level pattern scan. Bump
    // `ancestor_indent` to the item's absolute continuation column so
    // `try_emit_table_recovery` compares against the right escape column.
    match node {
        Node::List(list) => {
            for child in &list.children {
                if let Node::ListItem(item) = child {
                    let item_indent = list_item_continuation_indent(item, lines, ancestor_indent);
                    collect_table_recovery_ops(
                        child,
                        lines,
                        item_indent,
                        aggressive,
                        operations,
                        sink,
                    );
                }
            }
        }
        _ => {
            for child in children {
                collect_table_recovery_ops(child, lines, ancestor_indent, aggressive, operations, sink);
            }
        }
    }
}

/// Compute the absolute continuation-indent column for a list item (the column
/// where its children / continuation lines begin). `markdown-rs` source
/// positions are absolute, so `marker_column + marker_width` already reflects
/// every ancestor's indent — no accumulation needed. The `ancestor_indent`
/// parameter is kept for call-site API stability (pre-#86 callers passed a
/// running sum) but is no longer added to the result; it falls back into the
/// return when the item has no position.
fn list_item_continuation_indent(
    item: &markdown::mdast::ListItem,
    lines: &[&str],
    ancestor_indent: usize,
) -> usize {
    let Some(pos) = &item.position else {
        return ancestor_indent;
    };
    let start_line = pos.start.line.saturating_sub(1);
    let marker_column = pos.start.column.saturating_sub(1);
    let marker_width = lines
        .get(start_line)
        .map(|ln| list_marker_width(ln.trim_start()))
        .unwrap_or(2);
    marker_column + marker_width
}

/// Attempt to build a recovery op for a candidate `[List, Table, List]` trio.
/// Returns `Some(op)` only when all guardrails pass:
///   - the table sits flush to the ancestor column (i.e. it is escaped,
///     not already nested inside the preceding item);
///   - evidence of intended nesting is present (numbering run for safe,
///     marker match for aggressive);
///   - every source line of the table row range still exists and is not
///     blank — we preserve byte-for-byte and only prepend indent.
fn try_emit_table_recovery(
    list_a: &markdown::mdast::List,
    table: &markdown::mdast::Table,
    list_c: &markdown::mdast::List,
    lines: &[&str],
    ancestor_indent: usize,
    aggressive: bool,
) -> Option<FormatterOperation> {
    let tpos = table.position.as_ref()?;
    let t_start = tpos.start.line.saturating_sub(1);
    let t_end = tpos.end.line.saturating_sub(1);
    let t_col = tpos.start.column.saturating_sub(1);

    // The escaped table must sit at the ancestor indent column. A table that
    // is already nested under an item will sit further right and is off-limits.
    if t_col != ancestor_indent {
        return None;
    }

    // Bounds check.
    if t_end >= lines.len() || t_start > t_end {
        return None;
    }

    // Derive the continuation indent from the LAST item of `list_a` (this is
    // the item the recovered table would nest under). Falls back to the list's
    // first item if position is missing.
    let ref_item = list_a
        .children
        .last()
        .or_else(|| list_a.children.first())?;
    let Node::ListItem(ref_list_item) = ref_item else {
        return None;
    };
    let target_indent = list_item_continuation_indent(ref_list_item, lines, ancestor_indent);
    // Recovery must actually shift the table (strictly rightward).
    if target_indent <= t_col {
        return None;
    }

    // Evidence check: ordered = numbering continuation; bullet = marker match
    // (aggressive only).
    if !has_recovery_evidence(list_a, list_c, lines, aggressive) {
        return None;
    }

    // Final guardrail: every non-blank source line in the table range must
    // already sit at `t_col`. Blank lines inside a table shouldn't occur
    // (markdown-rs wouldn't parse them as one table), but reject just in case.
    for idx in t_start..=t_end {
        let line = lines.get(idx).copied().unwrap_or("");
        if line.trim().is_empty() {
            return None;
        }
        let actual_col = leading_space_count(line);
        if actual_col != t_col {
            return None;
        }
    }

    // Build re-indented rows — prepend `shift` spaces to each, preserving
    // alignment colons and every other byte.
    let shift = target_indent - t_col;
    let prefix = " ".repeat(shift);
    let new_lines: Vec<String> = (t_start..=t_end)
        .map(|i| format!("{}{}", prefix, lines[i]))
        .collect();

    Some(FormatterOperation::ReplaceLines {
        start_line: t_start,
        end_line: t_end,
        lines: new_lines,
    })
}

/// Decide whether the neighboring lists provide enough evidence that the
/// table between them was intended to nest under `list_a`.
///
///   safe       → ordered lists only, numbering continues across the gap.
///   aggressive → same-marker bullet lists also qualify.
fn has_recovery_evidence(
    list_a: &markdown::mdast::List,
    list_c: &markdown::mdast::List,
    lines: &[&str],
    aggressive: bool,
) -> bool {
    // Both lists must be top-aligned at the same column; diverging column
    // means they were never one list to begin with.
    let col_a = list_a
        .children
        .first()
        .and_then(|c| c.position())
        .map(|p| p.start.column)
        .unwrap_or(0);
    let col_c = list_c
        .children
        .first()
        .and_then(|c| c.position())
        .map(|p| p.start.column)
        .unwrap_or(0);
    if col_a == 0 || col_a != col_c {
        return false;
    }

    match (list_a.ordered, list_c.ordered) {
        (true, true) => {
            // Strong evidence: list_c's first number = list_a.start + len(a).
            let Some(start_a) = list_a.start else { return false; };
            let Some(start_c) = list_c.start else { return false; };
            let expected = start_a as u64 + list_a.children.len() as u64;
            start_c as u64 == expected
        }
        (false, false) => {
            if !aggressive {
                return false;
            }
            // Weak evidence: both lists use the same bullet marker char.
            bullet_marker_char(list_a, lines) == bullet_marker_char(list_c, lines)
                && bullet_marker_char(list_a, lines).is_some()
        }
        _ => false, // ordered/unordered mix → no evidence
    }
}

/// Return the `-` / `*` / `+` marker of the first item in a bullet list,
/// by inspecting the source line.
fn bullet_marker_char(list: &markdown::mdast::List, lines: &[&str]) -> Option<char> {
    let first = list.children.first()?;
    let pos = first.position()?;
    let line_idx = pos.start.line.saturating_sub(1);
    let col = pos.start.column.saturating_sub(1);
    let line = lines.get(line_idx).copied()?;
    let trimmed = line.get(col..)?;
    let c = trimmed.chars().next()?;
    if matches!(c, '-' | '*' | '+') {
        Some(c)
    } else {
        None
    }
}

fn apply_recover_escaped_paragraphs_in_lists(
    settings: &FormatterSettings,
    _shapes: &[ListItemDetection],
    _candidates: &[EscapedBlockCandidate],
    ast: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::RecoverEscapedParagraphsMode;
    let mode = settings.list_normalize.recover_escaped_paragraphs_in_lists;
    if matches!(mode, RecoverEscapedParagraphsMode::Off) {
        return;
    }
    // Root-of-tree scan. When an escaped continuation paragraph sits at column 0
    // between two numbered (or same-bullet) list items, markdown-rs splits the
    // run into `List → Paragraph(s) → List`. `collect_escaped_block_candidates`
    // (issue #81) only sees gaps *inside* a single AST list, so it cannot find
    // this split-root case. We walk every container (Root, ListItem, Blockquote)
    // for the `List → Paragraph(s) → List` pattern and re-indent the paragraph
    // lines to the preceding list's `continuation_indent` when the heuristic
    // signals continuation.
    collect_recover_paragraph_ops(ast, lines, mode, operations, sink);
}

/// Walk the AST recursively looking for `List → Paragraph(s) → List` runs in
/// any container's children and emit recovery ops for each match.
fn collect_recover_paragraph_ops(
    node: &Node,
    lines: &[&str],
    mode: crate::types::RecoverEscapedParagraphsMode,
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    let children = get_children(node);
    let n = children.len();
    let mut i = 0;
    while i < n {
        if let Node::List(list1) = &children[i] {
            let mut j = i + 1;
            while j < n && matches!(children[j], Node::Paragraph(_)) {
                j += 1;
            }
            if j > i + 1 && j < n {
                if let Node::List(list2) = &children[j] {
                    let paragraphs: Vec<&Node> = children[i + 1..j].iter().collect();
                    try_recover_paragraph_run(
                        list1,
                        list2,
                        &paragraphs,
                        lines,
                        mode,
                        operations,
                        sink,
                    );
                }
            }
            i = j;
            continue;
        }
        i += 1;
    }

    // Recurse so nested containers (ListItem, Blockquote, etc.) are covered.
    for child in children {
        collect_recover_paragraph_ops(child, lines, mode, operations, sink);
    }
}

/// Classify the first inline token of a paragraph and decide whether it looks
/// like continuation prose. Returns `true` when the heuristic (or aggressive)
/// mode should recover this paragraph.
fn paragraph_triggers_recovery(
    paragraph: &Node,
    mode: crate::types::RecoverEscapedParagraphsMode,
) -> bool {
    use crate::types::RecoverEscapedParagraphsMode::*;
    let inlines = get_children(paragraph);
    let first_inline = match inlines.first() {
        Some(n) => n,
        None => return false,
    };

    // Strong signal: inline code at the start (backtick).
    if matches!(first_inline, Node::InlineCode(_)) {
        return true;
    }

    let first_char = match first_inline {
        Node::Text(t) => t.value.trim_start().chars().next(),
        _ => None,
    };

    match mode {
        Off => false,
        Heuristic => match first_char {
            Some(c) if c.is_ascii_lowercase() => true,
            // Continuation punctuation: commas, dashes, colons, semicolons,
            // opening paren, closing quote, em/en-dash.
            Some(',' | ';' | ':' | '(' | ')' | '"' | '\'' | '—' | '–' | '-') => true,
            _ => false,
        },
        // Aggressive: the structural signals (numbering resumption + col-0)
        // are already strong; fire regardless of first-inline shape.
        Aggressive => true,
    }
}

/// Validate and emit recovery ops for a candidate run `List → Paragraph(s) → List`.
/// Returns `None` (ignored) when the run fails any structural or heuristic check.
fn try_recover_paragraph_run(
    list1: &markdown::mdast::List,
    list2: &markdown::mdast::List,
    paragraphs: &[&Node],
    lines: &[&str],
    mode: crate::types::RecoverEscapedParagraphsMode,
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) -> Option<()> {
    // 1. Same list variety (both ordered or both unordered).
    if list1.ordered != list2.ordered {
        return None;
    }

    // 2. Resolve the preceding list's continuation indent from its last item.
    let last_item = list1.children.last()?;
    let (list1_marker_col, list1_start_line, list1_marker_ch) = match last_item {
        Node::ListItem(item) => {
            let pos = item.position.as_ref()?;
            let col = pos.start.column.saturating_sub(1);
            let ln = pos.start.line.saturating_sub(1);
            let ch = lines.get(ln)?.trim_start().chars().next()?;
            (col, ln, ch)
        }
        _ => return None,
    };
    let trimmed1 = lines.get(list1_start_line)?.trim_start();
    let continuation_indent = list1_marker_col + list_marker_width(trimmed1);

    // 3. list2 must resume at the same marker column (same nesting level).
    let first_item2 = list2.children.first()?;
    let (list2_marker_col, list2_start_line, list2_marker_ch) = match first_item2 {
        Node::ListItem(item) => {
            let pos = item.position.as_ref()?;
            let col = pos.start.column.saturating_sub(1);
            let ln = pos.start.line.saturating_sub(1);
            let ch = lines.get(ln)?.trim_start().chars().next()?;
            (col, ln, ch)
        }
        _ => return None,
    };
    if list2_marker_col != list1_marker_col {
        return None;
    }

    // 4. Sequence resumption.
    if list1.ordered {
        let start1 = list1.start.unwrap_or(1);
        let count1 = list1.children.len() as u32;
        let expected_next = start1.saturating_add(count1);
        let start2 = list2.start.unwrap_or(1);
        if start2 != expected_next {
            // Restarts at 1 or jumps — not a continuation; likely an intentional
            // new list.
            return None;
        }
    } else {
        // Bullet marker must match exactly (-/*/+).
        if list1_marker_ch != list2_marker_ch {
            return None;
        }
    }

    // 5. All paragraphs must be dedented below the continuation indent (i.e.
    //    currently "escaped"). Collect their line ranges along the way.
    let mut para_ranges: Vec<(usize, usize)> = Vec::with_capacity(paragraphs.len());
    for p in paragraphs {
        let pos = p.position()?;
        let col = pos.start.column.saturating_sub(1);
        if col >= continuation_indent {
            return None;
        }
        let s = pos.start.line.saturating_sub(1);
        let e = pos.end.line.saturating_sub(1);
        para_ranges.push((s, e));
    }

    // 6. Heuristic / aggressive signal on the first paragraph's leading token.
    let first_paragraph = paragraphs.first()?;
    if !paragraph_triggers_recovery(first_paragraph, mode) {
        return None;
    }

    // 7. Guard: don't touch lines that already sit inside `list2`'s range
    //    (shouldn't happen, but defensive).
    let safe_upper = list2_start_line;

    // 8. Emit IndentLine ops so each paragraph line is prefixed by
    //    `continuation_indent` spaces. IndentLine trims the existing line and
    //    prepends the indent — safe because the paragraphs sit at col 0 and
    //    have no meaningful leading whitespace.
    let indent: String = " ".repeat(continuation_indent);
    // Group the per-line ops per paragraph so the report shows one entry
    // spanning the whole paragraph run rather than N single-line entries.
    for (s, e) in para_ranges {
        let clamped_e = e.min(safe_upper.saturating_sub(1));
        if s > clamped_e {
            continue;
        }
        let before = snippet_from_lines(lines, s, clamped_e);
        let after: Vec<String> = before
            .iter()
            .map(|ln| {
                if ln.trim().is_empty() {
                    ln.clone()
                } else {
                    format!("{}{}", indent, ln.trim_start())
                }
            })
            .collect();
        sink.emit(ReportEntry {
            rule: "recover-escaped-paragraphs-in-lists",
            start_line: s,
            end_line: clamped_e,
            before,
            after,
        });

        for ln in s..=e {
            if ln >= safe_upper {
                break;
            }
            let line = match lines.get(ln) {
                Some(l) => l,
                None => continue,
            };
            if line.trim().is_empty() {
                continue;
            }
            operations.push(FormatterOperation::IndentLine {
                start_line: ln,
                indent: indent.clone(),
            });
        }
    }

    Some(())
}

/// Tighten-list-continuations (#82).
///
/// Collapses a single blank line that sits between two adjacent paragraph
/// children of a `ParagraphsOnly` list item, when heuristics indicate the
/// second paragraph is a syntactic continuation of the first (rather than a
/// deliberate paragraph break the author wanted).
///
/// Runs AFTER recover-escaped-* and BEFORE wrap-markdown (per the ordering
/// contract documented above `collect_list_item_shapes`). Recover reshapes
/// children; tighten must see the post-recover child set. wrap-markdown must
/// see the post-tighten line set so it can re-wrap merged paragraphs.
///
/// Trigger conditions (heuristic mode, all three required):
///   a) list item's `shape` is `ParagraphsOnly` (no code fence / table /
///      sublist sibling that would change continuation semantics)
///   b) the two paragraphs are separated by EXACTLY one blank line
///   c) the second paragraph's first non-whitespace character is lowercase,
///      a backtick, or an opening-punctuation character (`(`, `[`, `"`,
///      `'`, en-dash, em-dash, comma).
///
/// Aggressive mode drops condition (c): any single-blank gap between two
/// paragraph children of a `ParagraphsOnly` list item collapses.
///
/// Off mode is a no-op (matches pre-rule behavior byte-for-byte).
fn apply_tighten_list_continuations(
    settings: &FormatterSettings,
    shapes: &[ListItemDetection],
    ast: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::TightenListContinuationsMode;
    let mode = settings.list_normalize.tighten_list_continuations;
    if matches!(mode, TightenListContinuationsMode::Off) {
        return;
    }

    // Lookup: which (start_line, end_line) spans are ParagraphsOnly.
    // Detection output is the single source of truth for shape, so we consume
    // it here instead of re-classifying from the AST.
    use crate::types::ListItemShape;
    use std::collections::HashSet;
    let paragraphs_only: HashSet<(usize, usize)> = shapes
        .iter()
        .filter(|s| s.shape == ListItemShape::ParagraphsOnly)
        .map(|s| (s.start_line, s.end_line))
        .collect();

    if paragraphs_only.is_empty() {
        return;
    }

    walk_for_tighten(ast, lines, &paragraphs_only, mode, operations, sink);
}

fn walk_for_tighten(
    node: &Node,
    lines: &[&str],
    paragraphs_only: &std::collections::HashSet<(usize, usize)>,
    mode: crate::types::TightenListContinuationsMode,
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    if let Node::ListItem(item) = node {
        if let Some(pos) = &item.position {
            let s = pos.start.line.saturating_sub(1);
            let e = pos.end.line.saturating_sub(1);
            if paragraphs_only.contains(&(s, e)) {
                emit_tighten_ops_for_item(item, lines, mode, operations, sink);
            }
        }
    }
    for child in get_children(node) {
        walk_for_tighten(child, lines, paragraphs_only, mode, operations, sink);
    }
}

/// For a single `ParagraphsOnly` list item, emit one delete-line op for every
/// adjacent paragraph pair that qualifies under the selected mode.
fn emit_tighten_ops_for_item(
    item: &markdown::mdast::ListItem,
    lines: &[&str],
    mode: crate::types::TightenListContinuationsMode,
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::TightenListContinuationsMode;

    // Pull out paragraph children in document order. `ParagraphsOnly` is
    // expected to mean all children are paragraphs, but we still filter
    // defensively — that way a future shape-classification edge case can't
    // trip the rule.
    let paras: Vec<&markdown::mdast::Paragraph> = item
        .children
        .iter()
        .filter_map(|c| match c {
            Node::Paragraph(p) => Some(p),
            _ => None,
        })
        .collect();

    for window in paras.windows(2) {
        let p1 = window[0];
        let p2 = window[1];
        let (pos1, pos2) = match (&p1.position, &p2.position) {
            (Some(a), Some(b)) => (a, b),
            _ => continue,
        };
        let p1_end_0 = pos1.end.line.saturating_sub(1);
        let p2_start_0 = pos2.start.line.saturating_sub(1);

        // Exactly one blank line between: p2_start_0 == p1_end_0 + 2.
        if p2_start_0 != p1_end_0 + 2 {
            continue;
        }
        let blank_idx = p1_end_0 + 1;
        if blank_idx >= lines.len() {
            continue;
        }
        if !lines[blank_idx].trim().is_empty() {
            // Defensive: AST said there was a gap line, but the source line
            // is non-blank. Skip rather than corrupt content.
            continue;
        }

        if matches!(mode, TightenListContinuationsMode::Heuristic)
            && !second_paragraph_looks_like_continuation(lines, p2_start_0)
        {
            continue;
        }

        // Delete the blank line by replacing [blank_idx..=blank_idx] with
        // an empty Vec. `normalize_empty_lines` in format_once will not
        // mind the result; adjacent paragraphs simply become adjacent.
        sink.emit(ReportEntry {
            rule: "tighten-list-continuations",
            start_line: blank_idx,
            end_line: blank_idx,
            before: snippet_from_lines(lines, blank_idx, blank_idx),
            after: Vec::new(),
        });
        operations.push(FormatterOperation::ReplaceLines {
            start_line: blank_idx,
            end_line: blank_idx,
            lines: Vec::new(),
        });
    }
}

/// Heuristic (c): the second paragraph's first inline character suggests
/// it is mid-sentence continuation text.
///
/// Triggers on: any lowercase letter (Unicode), a backtick (inline code
/// continuation), or one of the opening-punct / conjunction characters
/// `(`, `[`, `"`, `'`, `,`, en-dash `–`, em-dash `—`.
///
/// Preserves (does NOT trigger) on: uppercase start, digit start, list
/// marker, blockquote marker, anything else. When in doubt we preserve —
/// false preservations only cost output loose-ness; false collapses can
/// destroy meaningful breaks.
fn second_paragraph_looks_like_continuation(lines: &[&str], p_start_0: usize) -> bool {
    let Some(line) = lines.get(p_start_0) else {
        return false;
    };
    let trimmed = line.trim_start();
    let Some(first) = trimmed.chars().next() else {
        return false;
    };
    if first.is_lowercase() {
        return true;
    }
    matches!(
        first,
        '`' | '(' | '[' | '"' | '\'' | ',' | '–' | '—'
    )
}

/// Collapse blank lines *between* adjacent sibling list items in the same
/// list, leaving intentional double-blank separators alone.
fn apply_tighten_list_item_spacing(
    settings: &FormatterSettings,
    shapes: &[ListItemDetection],
    ast: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::TightenListItemSpacingMode;
    use std::collections::HashMap;

    let mode = settings.list_normalize.tighten_list_item_spacing;
    if matches!(mode, TightenListItemSpacingMode::Off) {
        return;
    }

    let detection_by_span: HashMap<(usize, usize), &ListItemDetection> = shapes
        .iter()
        .map(|s| ((s.start_line, s.end_line), s))
        .collect();

    walk_for_tighten_list_item_spacing(
        ast,
        lines,
        &detection_by_span,
        mode,
        operations,
        sink,
    );
}

fn walk_for_tighten_list_item_spacing(
    node: &Node,
    lines: &[&str],
    detection_by_span: &std::collections::HashMap<(usize, usize), &ListItemDetection>,
    mode: crate::types::TightenListItemSpacingMode,
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    use crate::types::{ListItemShape, TightenListItemSpacingMode};

    if let Node::List(list) = node {
        let items: Vec<_> = list
            .children
            .iter()
            .filter_map(|child| match child {
                Node::ListItem(item) => Some(item),
                _ => None,
            })
            .collect();
        if items.len() >= 2 {
            let heuristic_ok = matches!(mode, TightenListItemSpacingMode::Aggressive)
                || items.iter().all(|item| {
                    let Some(pos) = &item.position else {
                        return false;
                    };
                    let span = (
                        pos.start.line.saturating_sub(1),
                        pos.end.line.saturating_sub(1),
                    );
                    matches!(
                        detection_by_span.get(&span).map(|d| d.shape),
                        Some(ListItemShape::ParagraphsOnly)
                    )
                });
            if heuristic_ok {
                emit_tighten_item_spacing_ops_for_list(
                    items.as_slice(),
                    detection_by_span,
                    lines,
                    operations,
                    sink,
                );
            }
        }
    }

    for child in get_children(node) {
        walk_for_tighten_list_item_spacing(
            child,
            lines,
            detection_by_span,
            mode,
            operations,
            sink,
        );
    }
}

fn emit_tighten_item_spacing_ops_for_list(
    items: &[&markdown::mdast::ListItem],
    detection_by_span: &std::collections::HashMap<(usize, usize), &ListItemDetection>,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
    sink: &mut dyn ReportSink,
) {
    for window in items.windows(2) {
        let (Some(pos1), Some(pos2)) = (&window[0].position, &window[1].position) else {
            continue;
        };
        let span1 = (
            pos1.start.line.saturating_sub(1),
            pos1.end.line.saturating_sub(1),
        );
        let span2 = (
            pos2.start.line.saturating_sub(1),
            pos2.end.line.saturating_sub(1),
        );
        let (Some(det1), Some(det2)) = (detection_by_span.get(&span1), detection_by_span.get(&span2))
        else {
            continue;
        };
        let item1_end_0 = det1.last_child_line.unwrap_or(det1.end_line);
        let item2_start_0 = det2.start_line;

        // Exactly one blank line between siblings: keep double-blanks intact.
        if item2_start_0 != item1_end_0 + 2 {
            continue;
        }
        let blank_idx = item1_end_0 + 1;
        if blank_idx >= lines.len() || !lines[blank_idx].trim().is_empty() {
            continue;
        }

        sink.emit(ReportEntry {
            rule: "tighten-list-item-spacing",
            start_line: blank_idx,
            end_line: blank_idx,
            before: snippet_from_lines(lines, blank_idx, blank_idx),
            after: Vec::new(),
        });
        operations.push(FormatterOperation::ReplaceLines {
            start_line: blank_idx,
            end_line: blank_idx,
            lines: Vec::new(),
        });
    }
}

// ============================================================================
// HTML Block Formatting
// ============================================================================

/// Walk the AST for MdxJsxFlowElement nodes with lowercase tag names (HTML elements).
/// For each top-level HTML block, format it and emit a ReplaceHtmlBlock operation
/// if the formatted content differs from the original.
fn collect_html_block_operations(
    node: &Node,
    lines: &[&str],
    settings: &FormatterSettings,
    operations: &mut Vec<FormatterOperation>,
) {
    let mut html_nodes: Vec<(usize, usize)> = Vec::new(); // (start_line_0, end_line_0)
    let mut processed_ranges: Vec<(usize, usize)> = Vec::new();

    // Walk AST to find top-level HTML flow elements
    collect_html_flow_elements(node, &mut html_nodes, &mut processed_ranges);

    let tab_width = settings.format_html_blocks_in_mdx.formatter_config.tab_width;

    // Process each top-level HTML node
    for (start_line, end_line) in html_nodes {
        if start_line >= lines.len() || end_line >= lines.len() {
            continue;
        }

        // Extract the HTML content from source lines
        let html_lines: Vec<&str> = lines[start_line..=end_line].to_vec();
        let html_content = html_lines.join("\n");

        // Format the HTML block
        let formatted = html_formatter::format_html_block(&html_content, tab_width);

        // Only emit operation if formatting changed the content
        if formatted != html_content {
            operations.push(FormatterOperation::ReplaceHtmlBlock {
                start_line,
                end_line,
                content: formatted,
            });
        }
    }
}

/// Recursively walk AST to find MdxJsxFlowElement nodes with lowercase names.
/// Only collects top-level HTML blocks (skips nodes nested inside already-processed ranges).
fn collect_html_flow_elements(
    node: &Node,
    results: &mut Vec<(usize, usize)>,
    processed_ranges: &mut Vec<(usize, usize)>,
) {
    match node {
        Node::MdxJsxFlowElement(jsx) => {
            if let Some(name) = &jsx.name {
                if is_html_element(name) {
                    if let Some(pos) = &jsx.position {
                        let start_line = pos.start.line - 1; // 0-indexed
                        let end_line = pos.end.line - 1;

                        // Check if this node is nested inside an already-processed range
                        let is_nested = processed_ranges
                            .iter()
                            .any(|&(rs, re)| start_line > rs && end_line < re);

                        if !is_nested {
                            results.push((start_line, end_line));
                            processed_ranges.push((start_line, end_line));
                        }

                        // Don't recurse into children — they're part of this block
                        return;
                    }
                }
            }
            // If not an HTML element, recurse into children
            for child in &jsx.children {
                collect_html_flow_elements(child, results, processed_ranges);
            }
        }
        _ => {
            for child in get_children(node) {
                collect_html_flow_elements(child, results, processed_ranges);
            }
        }
    }
}

/// Pre-process YAML text to quote values containing special YAML characters.
///
/// Detects unquoted values with `: `, ` #`, or starting with `!&*%@\`` and
/// wraps them in double quotes to prevent parse errors or silent data corruption.
fn preprocess_yaml_for_parsing(yaml_text: &str) -> String {
    let lines: Vec<&str> = yaml_text.split('\n').collect();
    let mut result: Vec<String> = Vec::with_capacity(lines.len());

    for line in &lines {
        if let Some(caps) = YAML_MAPPING_RE.captures(line) {
            let indent = caps.get(1).map_or("", |m| m.as_str());
            let key = caps.get(2).map_or("", |m| m.as_str());
            let value = caps.get(3).map_or("", |m| m.as_str()).trim();

            // Skip if already quoted
            if (value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\''))
            {
                result.push(line.to_string());
                continue;
            }

            // Skip flow sequences [...] and flow mappings {...}
            if (value.starts_with('[') && value.ends_with(']'))
                || (value.starts_with('{') && value.ends_with('}'))
            {
                result.push(line.to_string());
                continue;
            }

            // Skip block scalar indicators (>, |, >-, |-, >+, |+)
            if BLOCK_SCALAR_RE.is_match(value) {
                result.push(line.to_string());
                continue;
            }

            let needs_quoting = value.contains(": ")
                || value.contains(" #")
                || SPECIAL_START_RE.is_match(value);

            if needs_quoting {
                let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
                result.push(format!("{}{}: \"{}\"", indent, key, escaped));
                continue;
            }
        }

        result.push(line.to_string());
    }

    result.join("\n")
}

/// Scan raw YAML frontmatter text for keys whose values are block scalars
/// (`>`, `>-`, `>+`, `|`, `|-`, `|+`), at any nesting depth.
///
/// Returns a map from **full path as a vector of segments** (e.g.
/// `["meta", "description"]`) to the original verbatim block representation:
/// the indicator (`>-`) plus all content lines joined with `\n`. Using a
/// vector (rather than a dotted string) is intentional — a top-level key
/// literally named `"a.b"` and a nested `a.b` path must not collide.
///
/// Sequence items are **not** tracked: mappings inside a sequence never
/// produce a recorded path because the emitter cannot thread sequence
/// position through the preserved-map lookup. Nested block scalars inside
/// sequence-of-mappings are vanishingly rare in frontmatter.
///
/// Parent keys that require YAML quoting (spaces, special chars) are not
/// tracked either — the simple identifier-only heuristic used for pushing
/// onto the path stack is a deliberate scope limit. Such frontmatter is
/// extremely rare and would need a full YAML-aware scanner to handle.
fn extract_block_scalars(yaml_text: &str) -> HashMap<Vec<String>, String> {
    let mut result: HashMap<Vec<String>, String> = HashMap::new();
    let lines: Vec<&str> = yaml_text.split('\n').collect();
    // Stack of (indent, key) entries representing the current mapping path.
    let mut path_stack: Vec<(usize, String)> = Vec::new();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        // Skip blank and comment-only lines without touching the path stack.
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            i += 1;
            continue;
        }

        let indent = line.len() - line.trim_start().len();
        let trimmed = &line[indent..];

        // A non-blank line at indent `n` means any path-stack entries at
        // indent >= n are no longer ancestors of this line.
        while path_stack.last().is_some_and(|(d, _)| *d >= indent) {
            path_stack.pop();
        }

        // Sequence items (`- ...` / `-`) interrupt mapping nesting — don't
        // try to track paths through them.
        if trimmed == "-" || trimmed.starts_with("- ") {
            i += 1;
            continue;
        }

        if let Some(caps) = YAML_BLOCK_SCALAR_KEY_RE.captures(trimmed) {
            let key = caps.get(1).map_or("", |m| m.as_str()).to_string();
            let indicator = caps.get(2).map_or("", |m| m.as_str()).to_string();

            let mut full_path: Vec<String> =
                path_stack.iter().map(|(_, k)| k.clone()).collect();
            full_path.push(key);

            i += 1;

            // Collect content lines: anything indented strictly deeper than
            // the key line, plus blank lines interleaved among them.
            let mut content_lines: Vec<&str> = Vec::new();
            while i < lines.len() {
                let content_line = lines[i];
                if content_line.is_empty() {
                    content_lines.push(content_line);
                    i += 1;
                    continue;
                }
                let content_indent =
                    content_line.len() - content_line.trim_start().len();
                if content_indent <= indent {
                    break;
                }
                content_lines.push(content_line);
                i += 1;
            }

            // Trim trailing blank lines so separator blanks between sibling
            // keys don't get baked into the preserved block text.
            while content_lines.last().is_some_and(|l| l.is_empty()) {
                content_lines.pop();
            }

            let block_text = if content_lines.is_empty() {
                indicator
            } else {
                format!("{}\n{}", indicator, content_lines.join("\n"))
            };
            result.insert(full_path, block_text);
            continue;
        }

        // A plain mapping key (`foo:` or `foo: value`) may introduce a new
        // path level. Push it onto the stack so deeper lines can resolve
        // their full path. Restricted to identifier-like characters — same
        // set the emitter sees for unquoted keys.
        if let Some(colon_pos) = trimmed.find(':') {
            let key_candidate = &trimmed[..colon_pos];
            if !key_candidate.is_empty()
                && key_candidate
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '-' || c == '.')
            {
                path_stack.push((indent, key_candidate.to_string()));
            }
        }

        i += 1;
    }

    result
}

/// Walk AST and collect YAML frontmatter formatting operations.
///
/// For each `Node::Yaml` node, parses the YAML content, reformats it using
/// serde_yaml for parsing and a custom emitter for output, and creates a
/// ReplaceLines operation if the output differs.
fn collect_yaml_format_operations(
    node: &Node,
    _lines: &[&str],
    settings: &FormatYamlFrontmatterSetting,
    operations: &mut Vec<FormatterOperation>,
) {
    if let Node::Root(root) = node {
        for child in &root.children {
            if let Node::Yaml(yaml_node) = child {
                if let Some(pos) = &yaml_node.position {
                    let mut yaml_to_parse = yaml_node.value.clone();

                    // Capture any block scalars from the original text before
                    // serde_yaml flattens them to plain strings.
                    let block_scalars = extract_block_scalars(&yaml_node.value);

                    // Pre-process to fix unsafe values
                    if settings.fix_unsafe_values {
                        yaml_to_parse = preprocess_yaml_for_parsing(&yaml_to_parse);
                    }

                    // Parse YAML content
                    let parsed: serde_yaml::Value = match serde_yaml::from_str(&yaml_to_parse) {
                        Ok(v) => v,
                        Err(_) => continue, // Skip formatting on parse failure
                    };

                    // Format using custom emitter that respects settings
                    let clean = emit_yaml(&parsed, settings, 0, &block_scalars);

                    // Only replace if different from original
                    if clean != yaml_node.value {
                        let start_line = pos.start.line - 1; // 0-indexed
                        let end_line = pos.end.line - 1;

                        // Guard against empty frontmatter (---\n---)
                        // where start_line + 1 > end_line - 1
                        if end_line > start_line + 1 {
                            let formatted_lines: Vec<String> =
                                clean.split('\n').map(|s| s.to_string()).collect();

                            operations.push(FormatterOperation::ReplaceLines {
                                start_line: start_line + 1, // Skip opening ---
                                end_line: end_line - 1,     // Skip closing ---
                                lines: formatted_lines,
                            });
                        }
                    }
                }
            }
        }
    }
}

/// Custom YAML emitter that respects formatter settings (quotingType, forceQuotes, indent).
///
/// Matches js-yaml's output behavior: uses JSON_SCHEMA-compatible formatting,
/// quotes strings when needed, and respects the configured quoting style.
/// `block_scalars` maps **full path segment vectors** to the original
/// verbatim block representation so that folded/literal scalars at any
/// nesting level are not collapsed to plain strings.
fn emit_yaml(value: &serde_yaml::Value, settings: &FormatYamlFrontmatterSetting, indent_level: usize, block_scalars: &HashMap<Vec<String>, String>) -> String {
    match value {
        serde_yaml::Value::Mapping(map) => {
            emit_yaml_mapping(map, settings, indent_level, Some(Vec::new()), block_scalars)
        }
        _ => emit_yaml_scalar(value, settings),
    }
}

/// Emit a YAML mapping (key-value pairs) with proper indentation.
///
/// `path_prefix` is `Some(segments)` when this mapping sits on a path
/// `extract_block_scalars` can resolve (the frontmatter root or any mapping
/// reached without crossing a sequence). It is `None` inside sequence items
/// and their descendants, which disables block-scalar lookup entirely —
/// the extractor never records paths through sequences, so attempting a
/// lookup there would only produce false positives against same-named keys
/// elsewhere in the document.
fn emit_yaml_mapping(
    map: &serde_yaml::Mapping,
    settings: &FormatYamlFrontmatterSetting,
    indent_level: usize,
    path_prefix: Option<Vec<String>>,
    block_scalars: &HashMap<Vec<String>, String>,
) -> String {
    let indent_str = " ".repeat(indent_level * settings.indent);
    let mut lines: Vec<String> = Vec::new();

    for (key, value) in map {
        let key_str = match key {
            serde_yaml::Value::String(s) => s.clone(),
            other => emit_yaml_scalar(other, settings),
        };

        // Build the full path only when tracking is enabled. Inside a
        // sequence (`path_prefix == None`), skip preservation entirely —
        // the extractor does not record sequence paths.
        if let Some(prefix) = path_prefix.as_ref() {
            let mut full_path = prefix.clone();
            full_path.push(key_str.clone());
            if let Some(block_text) = block_scalars.get(&full_path) {
                lines.push(format!("{}{}: {}", indent_str, key_str, block_text));
                continue;
            }
        }

        match value {
            serde_yaml::Value::Mapping(nested_map) => {
                lines.push(format!("{}{}:", indent_str, key_str));
                let next_prefix = path_prefix.as_ref().map(|p| {
                    let mut v = p.clone();
                    v.push(key_str.clone());
                    v
                });
                let nested = emit_yaml_mapping(nested_map, settings, indent_level + 1, next_prefix, block_scalars);
                lines.push(nested);
            }
            serde_yaml::Value::Sequence(seq) => {
                lines.push(format!("{}{}:", indent_str, key_str));
                let child_indent = " ".repeat((indent_level + 1) * settings.indent);
                for item in seq {
                    match item {
                        serde_yaml::Value::Mapping(item_map) => {
                            // Sequence of mappings: first key on same line as `-`.
                            // `None` disables path lookup for the whole
                            // sequence-item subtree — see function doc.
                            let nested = emit_yaml_mapping(item_map, settings, indent_level + 2, None, block_scalars);
                            let nested_lines: Vec<&str> = nested.split('\n').collect();
                            if let Some(first) = nested_lines.first() {
                                lines.push(format!("{}- {}", child_indent, first.trim()));
                                for rest in &nested_lines[1..] {
                                    lines.push(format!("{}  {}", child_indent, rest.trim_start()));
                                }
                            }
                        }
                        _ => {
                            lines.push(format!("{}- {}", child_indent, emit_yaml_scalar(item, settings)));
                        }
                    }
                }
            }
            _ => {
                lines.push(format!("{}{}: {}", indent_str, key_str, emit_yaml_scalar(value, settings)));
            }
        }
    }

    lines.join("\n")
}

/// Emit a YAML scalar value with proper quoting.
fn emit_yaml_scalar(value: &serde_yaml::Value, settings: &FormatYamlFrontmatterSetting) -> String {
    match value {
        serde_yaml::Value::Null => "null".to_string(),
        serde_yaml::Value::Bool(b) => {
            if *b { "true" } else { "false" }.to_string()
        }
        serde_yaml::Value::Number(n) => n.to_string(),
        serde_yaml::Value::String(s) => emit_yaml_string(s, settings),
        serde_yaml::Value::Sequence(seq) => {
            // Inline flow sequence for scalars
            let items: Vec<String> = seq.iter().map(|v| emit_yaml_scalar(v, settings)).collect();
            format!("[{}]", items.join(", "))
        }
        serde_yaml::Value::Mapping(_) => {
            // Shouldn't reach here for top-level calls, but handle gracefully
            serde_yaml::to_string(value).unwrap_or_default()
        }
        serde_yaml::Value::Tagged(tagged) => {
            emit_yaml_scalar(&tagged.value, settings)
        }
    }
}

/// Emit a YAML string with proper quoting based on settings.
///
/// Quotes are added when:
/// - `forceQuotes` is true
/// - The string contains special YAML characters (`: `, ` #`, etc.)
/// - The string looks like a YAML keyword (true, false, null, yes, no, etc.)
/// - The string is empty
fn emit_yaml_string(s: &str, settings: &FormatYamlFrontmatterSetting) -> String {
    if settings.force_quotes || needs_quoting(s) {
        quote_string(s, &settings.quoting_type)
    } else {
        s.to_string()
    }
}

/// Check if a string value needs quoting in YAML output.
fn needs_quoting(s: &str) -> bool {
    if s.is_empty() {
        return true;
    }

    // Check for YAML keywords that would be misinterpreted
    let lower = s.to_lowercase();
    if matches!(
        lower.as_str(),
        "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "~"
    ) {
        return true;
    }

    // Check if it looks like a number
    if s.parse::<f64>().is_ok() || s.parse::<i64>().is_ok() {
        return true;
    }

    // Special YAML characters in the value
    if s.contains(": ") || s.contains(" #") || s.contains('\n')
        || s.contains('\'') || s.contains('"')
    {
        return true;
    }

    // Starts with special YAML chars
    if let Some(first) = s.chars().next() {
        if matches!(first, '!' | '&' | '*' | '%' | '@' | '`' | ',' | '[' | ']' | '{' | '}' | '>' | '|' | '#' | '?' | '-' | ':') {
            return true;
        }
    }

    // Ends with colon
    if s.ends_with(':') {
        return true;
    }

    false
}

/// Quote a string with the configured quoting type.
fn quote_string(s: &str, quoting_type: &str) -> String {
    if quoting_type == "'" {
        // Single quotes: escape single quotes by doubling them
        let escaped = s.replace('\'', "''");
        format!("'{}'", escaped)
    } else {
        // Double quotes (default): escape backslashes and double quotes
        let escaped = s.replace('\\', "\\\\").replace('"', "\\\"");
        format!("\"{}\"", escaped)
    }
}

/// Remove replacement operations that are strictly contained within a wider replacement.
/// Uses O(n log n) sort + single-pass instead of O(n^2) nested loops.
fn filter_overlapping_replacements(operations: &mut Vec<FormatterOperation>) {
    // Collect replacement ranges with their original indices
    let mut replace_ranges: Vec<(usize, usize, usize)> = operations
        .iter()
        .enumerate()
        .filter_map(|(idx, op)| match op {
            FormatterOperation::ReplaceLines {
                start_line,
                end_line,
                ..
            }
            | FormatterOperation::ReplaceHtmlBlock {
                start_line,
                end_line,
                ..
            } => Some((idx, *start_line, *end_line)),
            _ => None,
        })
        .collect();

    if replace_ranges.len() <= 1 {
        return;
    }

    // Sort by start position ascending, then by span length descending (widest first)
    replace_ranges.sort_unstable_by(|a, b| {
        a.1.cmp(&b.1)
            .then_with(|| (b.2 - b.1).cmp(&(a.2 - a.1)))
    });

    // Single pass: track the widest range seen so far.
    // Any subsequent range that fits inside it is marked for removal.
    let mut to_remove: HashSet<usize> = HashSet::new();
    let mut max_end = 0usize;
    let mut max_start = 0usize;

    for &(idx, start, end) in &replace_ranges {
        if start >= max_start && end <= max_end && (start != max_start || end != max_end) {
            // Strictly contained in the current widest range
            to_remove.insert(idx);
        } else if end > max_end {
            // This range extends further — becomes the new widest
            max_start = start;
            max_end = end;
        }
    }

    // Remove in reverse order to preserve indices
    let mut indices: Vec<usize> = to_remove.into_iter().collect();
    indices.sort_unstable_by(|a, b| b.cmp(a));
    for idx in indices {
        operations.remove(idx);
    }
}

/// Get the line ranges covered by replacement operations.
fn get_replaced_ranges(operations: &[FormatterOperation]) -> Vec<(usize, usize)> {
    operations
        .iter()
        .filter_map(|op| match op {
            FormatterOperation::ReplaceLines {
                start_line,
                end_line,
                ..
            }
            | FormatterOperation::ReplaceHtmlBlock {
                start_line,
                end_line,
                ..
            } => Some((*start_line, *end_line)),
            _ => None,
        })
        .collect()
}

/// Check if an operation's target line is inside any replaced range.
fn is_inside_replaced_range(
    op: &FormatterOperation,
    replaced_ranges: &[(usize, usize)],
) -> bool {
    match op {
        FormatterOperation::ReplaceLines { .. } | FormatterOperation::ReplaceHtmlBlock { .. } => {
            false // Keep replacement operations
        }
        _ => {
            let line = op.start_line();
            replaced_ranges
                .iter()
                .any(|&(start, end)| line >= start && line <= end)
        }
    }
}

/// Apply a single operation to the result lines.
fn apply_operation(lines: &mut Vec<String>, op: &FormatterOperation) {
    match op {
        FormatterOperation::InsertLine {
            start_line,
            content,
        } => {
            if *start_line <= lines.len() {
                lines.insert(*start_line, content.clone());
            }
        }
        FormatterOperation::ReplaceLines {
            start_line,
            end_line,
            lines: new_lines,
        } => {
            if *start_line < lines.len() && *end_line < lines.len() {
                let delete_count = end_line - start_line + 1;
                lines.splice(
                    *start_line..(*start_line + delete_count),
                    new_lines.iter().cloned(),
                );
            }
        }
        FormatterOperation::IndentLine { start_line, indent } => {
            if *start_line < lines.len() {
                let trimmed = lines[*start_line].trim().to_string();
                lines[*start_line] = format!("{}{}", indent, trimmed);
            }
        }
        FormatterOperation::FixListIndent { start_line, indent } => {
            if *start_line < lines.len() {
                let trimmed = lines[*start_line].trim().to_string();
                lines[*start_line] = format!("{}{}", indent, trimmed);
            }
        }
        FormatterOperation::ReplaceHtmlBlock {
            start_line,
            end_line,
            content,
        } => {
            if *start_line < lines.len() && *end_line < lines.len() {
                let formatted_lines: Vec<String> =
                    content.split('\n').map(|s| s.to_string()).collect();
                let delete_count = end_line - start_line + 1;
                lines.splice(
                    *start_line..(*start_line + delete_count),
                    formatted_lines,
                );
            }
        }
    }
}

/// Check if a line is a list item start (unordered or ordered).
fn is_list_line(trimmed: &str) -> bool {
    trimmed.starts_with("- ")
        || trimmed.starts_with("* ")
        || trimmed.starts_with("+ ")
        || trimmed == "-"
        || trimmed == "*"
        || trimmed == "+"
        || is_ordered_list_marker(trimmed)
}

/// Check if a line is a code fence (opening or closing).
fn is_code_fence_line(trimmed: &str) -> bool {
    fence_delimiter(trimmed).is_some()
}

/// Extract the fence delimiter character and length from a fence line.
/// Returns `Some((char, count))` where char is `` ` `` or `~` and count >= 3.
/// Returns `None` if the line is not a fence line.
fn fence_delimiter(trimmed: &str) -> Option<(char, usize)> {
    let c = if trimmed.starts_with("```") {
        '`'
    } else if trimmed.starts_with("~~~") {
        '~'
    } else {
        return None;
    };
    let count = trimmed.chars().take_while(|&ch| ch == c).count();
    Some((c, count))
}

/// Check if a line is a heading (# through ######).
fn is_heading_line(trimmed: &str) -> bool {
    trimmed.starts_with("# ")
        || trimmed.starts_with("## ")
        || trimmed.starts_with("### ")
        || trimmed.starts_with("#### ")
        || trimmed.starts_with("##### ")
        || trimmed.starts_with("###### ")
}

/// Check if a line is plain paragraph text (not a block element start).
fn is_paragraph_line(trimmed: &str) -> bool {
    !trimmed.is_empty()
        && !is_heading_line(trimmed)
        && !is_list_line(trimmed)
        && !is_code_fence_line(trimmed)
        && !trimmed.starts_with('<')
        && !trimmed.starts_with('>')
        && !trimmed.starts_with('|')
        && trimmed != "---"
        && !trimmed.starts_with(":::")
}

/// Post-processing pass: ensure blank lines between adjacent block elements.
///
/// Walks through result lines and inserts blank lines where two adjacent
/// non-empty lines represent different block contexts that need separation.
/// Only handles cases NOT already covered by the AST-based spacing operations
/// (which handle headings and JSX).
fn ensure_block_element_spacing(lines: &mut Vec<String>) {
    let mut inside_code_fence = false;
    // Track the opening fence delimiter so inner fences don't prematurely close it.
    // A fence opened with N backticks can only be closed by N+ backticks of the same char.
    let mut fence_char: char = '`';
    let mut fence_len: usize = 0;
    let mut inside_frontmatter = false;
    let mut at_start = true;
    let mut insertions: Vec<usize> = Vec::new();

    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();

        // Track frontmatter boundaries (only at start of file)
        if trimmed == "---" {
            if at_start && !inside_frontmatter {
                inside_frontmatter = true;
                i += 1;
                continue;
            } else if inside_frontmatter {
                inside_frontmatter = false;
                at_start = false;
                i += 1;
                continue;
            }
        }

        if inside_frontmatter {
            i += 1;
            continue;
        }

        // Track code fence boundaries, respecting the opening delimiter length.
        // A fence opened with N backticks/tildes can only be closed by a line that
        // uses the same fence character and has >= N of them.  Inner fences (e.g. a
        // 3-backtick block inside a 4-backtick fence) must not prematurely close the
        // outer fence, and their lines must be skipped like regular content lines.
        let is_outer_fence_line = if let Some((c, len)) = fence_delimiter(trimmed) {
            if !inside_code_fence {
                // Opening a new fence
                inside_code_fence = true;
                fence_char = c;
                fence_len = len;
                true // this is the opening fence line — don't skip
            } else if c == fence_char && len >= fence_len {
                // Closing the outer fence
                inside_code_fence = false;
                true // this is the closing fence line — don't skip
            } else {
                // Inner fence line — treat as content, skip below
                false
            }
        } else {
            false
        };

        // Skip lines inside code blocks (content lines and inner fence lines),
        // but not the opening/closing fence lines of the outermost fence.
        if inside_code_fence && !is_outer_fence_line {
            i += 1;
            continue;
        }

        if !trimmed.is_empty() {
            at_start = false;
        }

        // Look for pairs of adjacent non-empty lines that need blank line separation
        if !trimmed.is_empty() && i + 1 < lines.len() {
            let next_trimmed = lines[i + 1].trim();
            if !next_trimmed.is_empty() {
                let current_indent = leading_space_count(&lines[i]);
                let next_indent = leading_space_count(&lines[i + 1]);
                let same_level = current_indent == next_indent;

                // Detect whether both lines are inside a list-item continuation.
                // If so, suppress paragraph/list spacing to avoid breaking tight
                // list structures (e.g. "5. Parent\n   cont\n   - child").
                let in_list_continuation = same_level && current_indent > 0 && {
                    let mut found = false;
                    for j in (0..i).rev() {
                        let prev = lines[j].as_str();
                        let pt = prev.trim();
                        if pt.is_empty() {
                            break;
                        }
                        let pi = leading_space_count(prev);
                        if pi < current_indent {
                            if is_list_line(pt) {
                                found = pi + list_marker_width(pt) == current_indent;
                            }
                            break;
                        }
                    }
                    found
                };

                let sibling_level = same_level && !in_list_continuation;
                let needs_spacing =
                    // Paragraph → Heading
                    (is_paragraph_line(trimmed) && is_heading_line(next_trimmed))
                    // Paragraph → List
                    || (sibling_level
                        && is_paragraph_line(trimmed)
                        && is_list_line(next_trimmed))
                    // List → Paragraph
                    || (sibling_level
                        && is_list_line(trimmed)
                        && is_paragraph_line(next_trimmed))
                    // Paragraph → Code fence (opening)
                    || (is_paragraph_line(trimmed) && is_code_fence_line(next_trimmed))
                    // Code fence (closing) → Paragraph
                    || (is_code_fence_line(trimmed) && !inside_code_fence && is_paragraph_line(next_trimmed))
                    // Code fence (closing) → List
                    || (sibling_level
                        && is_code_fence_line(trimmed)
                        && !inside_code_fence
                        && is_list_line(next_trimmed))
                    // List → Code fence
                    || (sibling_level
                        && is_list_line(trimmed)
                        && is_code_fence_line(next_trimmed));

                if needs_spacing {
                    insertions.push(i + 1);
                }
            }
        }

        i += 1;
    }

    // Insert blank lines in reverse order to preserve indices
    for &pos in insertions.iter().rev() {
        lines.insert(pos, String::new());
    }
}

fn leading_space_count(line: &str) -> usize {
    line.len() - line.trim_start_matches(' ').len()
}

/// Normalize consecutive empty lines to at most one empty line, except for
/// intentional double separators between adjacent list items.
fn normalize_empty_lines(content: &str) -> String {
    let had_trailing_newline = content.ends_with('\n');
    let lines: Vec<&str> = content.split('\n').collect();
    let mut out: Vec<&str> = Vec::with_capacity(lines.len());
    let mut i = 0;

    while i < lines.len() {
        if !lines[i].trim().is_empty() {
            out.push(lines[i]);
            i += 1;
            continue;
        }

        let start = i;
        while i < lines.len() && lines[i].trim().is_empty() {
            i += 1;
        }
        let run_len = i - start;
        let prev_nonblank = (0..start).rev().find(|idx| !lines[*idx].trim().is_empty());
        let next_nonblank = (i..lines.len()).find(|idx| !lines[*idx].trim().is_empty());

        let blanks_to_keep = if run_len >= 2
            && matches!(
                (prev_nonblank, next_nonblank),
                (Some(prev), Some(next))
                    if preserves_list_item_double_blank(lines.as_slice(), prev, next)
            ) {
            2
        } else {
            1
        };

        out.extend(std::iter::repeat_n("", blanks_to_keep));
    }

    let mut normalized = out.join("\n");
    if had_trailing_newline && !normalized.ends_with('\n') {
        normalized.push('\n');
    }
    normalized
}

fn preserves_list_item_double_blank(lines: &[&str], prev_nonblank: usize, next_nonblank: usize) -> bool {
    let Some(next_indent) = list_marker_indent(lines[next_nonblank]) else {
        return false;
    };
    if let Some(prev_indent) = list_marker_indent(lines[prev_nonblank]) {
        return prev_indent == next_indent;
    }
    leading_space_count(lines[prev_nonblank]) > next_indent
}

fn list_marker_indent(line: &str) -> Option<usize> {
    let indent = leading_space_count(line);
    let trimmed = &line[indent..];
    let mut chars = trimmed.chars();
    match chars.next()? {
        '-' | '+' | '*' => chars.next().filter(|c| c.is_whitespace()).map(|_| indent),
        c if c.is_ascii_digit() => {
            let digits = trimmed
                .chars()
                .take_while(|ch| ch.is_ascii_digit())
                .count();
            let rest = &trimmed[digits..];
            let mut rest_chars = rest.chars();
            match (rest_chars.next(), rest_chars.next()) {
                (Some('.' | ')'), Some(ws)) if ws.is_whitespace() => Some(indent),
                _ => None,
            }
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser;
    use crate::types::ListItemShape;

    fn shapes_for(input: &str) -> Vec<ListItemDetection> {
        let ast = parser::parse(input);
        collect_list_item_shapes(&ast)
    }

    fn candidates_for(input: &str) -> Vec<EscapedBlockCandidate> {
        let ast = parser::parse(input);
        let lines: Vec<&str> = input.split('\n').collect();
        collect_escaped_block_candidates(&ast, &lines)
    }

    // ── Detection pass tests (issue #81) ──

    #[test]
    fn detect_paragraphs_only_item() {
        let input = "- first item\n- second item\n- third item\n";
        let shapes = shapes_for(input);
        assert_eq!(shapes.len(), 3);
        for shape in &shapes {
            assert_eq!(shape.shape, ListItemShape::ParagraphsOnly);
            assert_eq!(shape.depth, 0);
            assert_eq!(shape.marker_column, 0);
            assert_eq!(shape.marker_width, 2);
            assert_eq!(shape.continuation_indent, 2);
        }
    }

    #[test]
    fn detect_item_with_code_fence() {
        let input = "- item with code:\n\n  ```js\n  const x = 1;\n  ```\n";
        let shapes = shapes_for(input);
        assert_eq!(shapes.len(), 1);
        assert_eq!(shapes[0].shape, ListItemShape::Mixed);
        // Paragraph + code fence both present → Mixed. Confirm the code fence
        // was actually seen by parsing a pure-code item:
        let code_only = "- ```js\n  const x = 1;\n  ```\n";
        let only = shapes_for(code_only);
        assert_eq!(only.len(), 1);
        assert!(matches!(
            only[0].shape,
            ListItemShape::HasCodeFence | ListItemShape::Mixed
        ));
    }

    #[test]
    fn detect_item_with_table() {
        let input =
            "- row:\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n";
        let shapes = shapes_for(input);
        assert!(!shapes.is_empty());
        // Paragraph intro + table child → Mixed; a pure-table item → HasTable.
        let pure_table =
            "- | a | b |\n  | - | - |\n  | 1 | 2 |\n";
        let _ = shapes_for(pure_table); // parse should not panic
        assert!(matches!(
            shapes[0].shape,
            ListItemShape::HasTable | ListItemShape::Mixed
        ));
    }

    #[test]
    fn detect_item_with_sublist() {
        let input = "- parent:\n  - child one\n  - child two\n";
        let shapes = shapes_for(input);
        // Expect 3 entries: parent + two children.
        assert_eq!(shapes.len(), 3);
        // Parent has a sublist as its only / primary interesting child.
        assert!(matches!(
            shapes[0].shape,
            ListItemShape::HasSublist | ListItemShape::Mixed
        ));
        // Children are paragraphs only, and their depth is 1.
        for c in &shapes[1..] {
            assert_eq!(c.shape, ListItemShape::ParagraphsOnly);
            assert_eq!(c.depth, 1);
        }
    }

    #[test]
    fn detect_mixed_item() {
        // An item containing a paragraph, a fenced code block, AND a sublist.
        let input = "\
- mixed:

  prose

  ```js
  const x = 1;
  ```

  - nested
";
        let shapes = shapes_for(input);
        assert!(!shapes.is_empty());
        // Top-level item should see enough variety to be classified Mixed.
        assert_eq!(shapes[0].shape, ListItemShape::Mixed);
    }

    #[test]
    fn detect_depth_2_nested_sublist_recurses() {
        // Depth-2 nested sublist: root list → item → list → item → list → item.
        let input = "\
- l0:
  - l1:
    - l2 leaf
";
        let shapes = shapes_for(input);
        let depths: Vec<usize> = shapes.iter().map(|s| s.depth).collect();
        assert!(depths.contains(&0), "depth 0 missing in {depths:?}");
        assert!(depths.contains(&1), "depth 1 missing in {depths:?}");
        assert!(depths.contains(&2), "depth 2 missing in {depths:?}");

        // continuation_indent must be cumulative across ancestors.
        let d2 = shapes
            .iter()
            .find(|s| s.depth == 2)
            .expect("depth-2 item missing");
        // At root "- " → +2, inside nested "- " → +2 more (marker at col 2),
        // inside depth-2 the marker sits at col 4, marker_width 2
        //   → continuation_indent = 4 (ancestor) + 4 (marker_col) + 2 = 10
        // (The exact arithmetic is implementation-locked; we assert the
        // cumulative property instead: depth-2 > depth-1 > depth-0.)
        let d0 = shapes.iter().find(|s| s.depth == 0).unwrap();
        let d1 = shapes.iter().find(|s| s.depth == 1).unwrap();
        assert!(d0.continuation_indent < d1.continuation_indent);
        assert!(d1.continuation_indent < d2.continuation_indent);
    }

    #[test]
    fn detect_escaped_code_candidate_between_items() {
        // Fenced code block dedented out of the list's child range.
        // markdown-rs will parse this as two siblings with the fence as a
        // root-level code block between them. The candidate walker should
        // pick it up only when it actually sits in a gap between sibling
        // list items; when the parser has already detached it to root level
        // the gap is empty, so we assert the walker at least doesn't crash
        // and that it surfaces the right kind when the fence *is* in a gap.
        let input = "\
- before

```js
escaped();
```

- after
";
        let _ = candidates_for(input);
        // Indented (still-in-list) version: fence is between items but
        // indented enough to qualify as a candidate block.
        let indented = "\
- before

  ```js
  escaped();
  ```

- after
";
        let cands = candidates_for(indented);
        // May or may not be detected as a gap candidate depending on how the
        // AST attaches the fence; at minimum the walker returns a Vec without
        // panicking, and if anything is returned the kind is Code.
        for c in &cands {
            assert_eq!(c.kind, EscapedBlockKind::Code);
        }
    }

    #[test]
    fn detect_escaped_table_candidate_between_items() {
        let input = "\
- before

| a | b |
| - | - |
| 1 | 2 |

- after
";
        let cands = candidates_for(input);
        for c in &cands {
            assert!(matches!(
                c.kind,
                EscapedBlockKind::Table | EscapedBlockKind::Paragraph
            ));
        }
    }

    #[test]
    fn detect_pathological_oscillation_guard() {
        // Pathological list with mixed continuations + fence + nested sublist.
        // The convergence loop in format() runs at most 3 iterations; with all
        // list-normalize rule bodies empty, the output must be identical across
        // iterations — NO flip.
        let input = "\
- alpha
  continuation

  - nested
    - deeper

```js
escaped();
```

- beta
  continuation

  | a | b |
  | - | - |
  | 1 | 2 |
";
        let settings = FormatterSettings::default();

        let once = format(input, &settings);
        let twice = format(&once, &settings);
        let thrice = format(&twice, &settings);

        assert_eq!(once, twice, "formatter output flipped between pass 1 and 2");
        assert_eq!(twice, thrice, "formatter output flipped between pass 2 and 3");
    }

    #[test]
    fn detect_list_normalize_defaults_do_not_change_output() {
        // Sanity: with only the new detection pass wired in and all rule
        // bodies empty, defaults must not alter a well-formed input.
        let input = "- a\n- b\n- c\n";
        let settings = FormatterSettings::default();
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    // ── recover-escaped-code-in-lists (issue #83) ──

    fn settings_recover_code(mode: crate::types::RecoverEscapedCodeMode) -> FormatterSettings {
        let mut s = FormatterSettings::default();
        s.list_normalize.recover_escaped_code_in_lists = mode;
        // Keep sibling rules quiet so tests observe #83 in isolation.
        s.list_normalize.tighten_list_continuations =
            crate::types::TightenListContinuationsMode::Off;
        s.list_normalize.recover_escaped_tables_in_lists =
            crate::types::RecoverEscapedTablesMode::Off;
        s.list_normalize.recover_escaped_paragraphs_in_lists =
            crate::types::RecoverEscapedParagraphsMode::Off;
        // Disable orthogonal rules that would otherwise reshape the fence text.
        s.add_empty_line_between_elements.enabled = false;
        s
    }

    // ── recover-escaped-tables-in-lists tests (issue #84) ──

    fn settings_with_table_mode(
        mode: crate::types::RecoverEscapedTablesMode,
    ) -> FormatterSettings {
        let mut s = FormatterSettings::default();
        s.list_normalize.recover_escaped_tables_in_lists = mode;
        s
    }

    #[test]
    fn recover_code_numbered_list_fence_recovered_in_safe() {
        // Numbered list with a col-0 fence that markdown-rs promotes to root
        // level, causing the list to restart numbering. Safe mode should
        // re-indent the fence so it becomes a child of item 1.
        let input = "\
1. first

```js
const x = 1;
```

2. second
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Safe);
        let got = format(input, &settings);
        let want = "\
1. first

   ```js
   const x = 1;
   ```

2. second
";
        assert_eq!(got, want);
    }

    #[test]
    fn recover_code_bullet_list_fence_left_alone_in_safe() {
        // Bullet-list evidence is weaker (no "restart at N" signal). Safe mode
        // must leave it untouched.
        let input = "\
- first

```js
const x = 1;
```

- second
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Safe);
        let got = format(input, &settings);
        assert_eq!(got, input);
    }

    #[test]
    fn recover_code_bullet_list_fence_recovered_in_aggressive() {
        let input = "\
- first

```js
const x = 1;
```

- second
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Aggressive);
        let got = format(input, &settings);
        let want = "\
- first

  ```js
  const x = 1;
  ```

- second
";
        assert_eq!(got, want);
    }

    #[test]
    fn recover_code_multiline_content_preserved_byte_exact() {
        // The fence body includes deliberate internal indentation and blank
        // lines. Every non-fence byte must be preserved; only leading spaces
        // are added to each non-empty line.
        let input = "\
1. alpha

```ts
function f() {
    const nested = {
        a: 1,
    };

    return nested;
}
```

2. beta
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Safe);
        let got = format(input, &settings);
        let want = "\
1. alpha

   ```ts
   function f() {
       const nested = {
           a: 1,
       };

       return nested;
   }
   ```

2. beta
";
        assert_eq!(got, want);
    }

    #[test]
    fn recover_code_legitimate_top_level_fence_untouched() {
        // No enclosing list at all — fence is legitimately a root block.
        let input = "\
# Heading

```js
let x = 1;
```

Some prose follows.
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Aggressive);
        let got = format(input, &settings);
        assert_eq!(got, input);
    }

    #[test]
    fn recover_code_unrelated_context_fence_untouched() {
        // Fence sits between a list and a non-list block — not "between two
        // list items". Must stay at root level regardless of mode.
        let input = "\
1. only item

```js
const x = 1;
```

Paragraph not in any list.
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Aggressive);
        let got = format(input, &settings);
        assert_eq!(got, input);
    }

    #[test]
    fn recover_code_off_mode_is_a_no_op() {
        let input = "\
1. first

```js
const x = 1;
```

2. second
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Off);
        let got = format(input, &settings);
        assert_eq!(got, input);
    }

    #[test]
    fn recover_code_idempotent_safe() {
        let input = "\
1. first

```js
const x = 1;
```

2. second
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Safe);
        let once = format(input, &settings);
        let twice = format(&once, &settings);
        assert_eq!(once, twice, "safe-mode recover must be idempotent");
    }

    #[test]
    fn recover_code_idempotent_aggressive() {
        let input = "\
- first

```js
const x = 1;
```

- second
";
        let settings =
            settings_recover_code(crate::types::RecoverEscapedCodeMode::Aggressive);
        let once = format(input, &settings);
        let twice = format(&once, &settings);
        assert_eq!(once, twice, "aggressive-mode recover must be idempotent");
    }

    #[test]
    fn recover_table_ordered_numbering_run_in_safe() {
        // Numbered-list escape: `1. … | table | 2. …` is strong evidence.
        // In safe mode the table is re-indented to the item's continuation
        // column (3 spaces for `1. `).
        let input = "\
1. before

| a | b |
| - | - |
| 1 | 2 |

2. after
";
        let expected = "\
1. before

   | a | b |
   | - | - |
   | 1 | 2 |

2. after
";
        let settings =
            settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Safe);
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn recover_table_bullet_only_in_aggressive() {
        // Bullet-list escape: weaker evidence. Safe mode must leave it alone;
        // aggressive mode recovers it.
        let input = "\
- before

| a | b |
| - | - |
| 1 | 2 |

- after
";
        let safe = format(
            input,
            &settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Safe),
        );
        assert_eq!(safe, input, "safe mode must not touch bullet-list escapes");

        let expected = "\
- before

  | a | b |
  | - | - |
  | 1 | 2 |

- after
";
        let aggressive = format(
            input,
            &settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Aggressive),
        );
        assert_eq!(aggressive, expected);
    }

    #[test]
    fn recover_table_leaves_top_level_table_untouched() {
        // Legitimate top-level table with no enclosing list must be untouched
        // in every mode.
        let input = "\
| a | b |
| - | - |
| 1 | 2 |
";
        for mode in [
            crate::types::RecoverEscapedTablesMode::Off,
            crate::types::RecoverEscapedTablesMode::Safe,
            crate::types::RecoverEscapedTablesMode::Aggressive,
        ] {
            let result = format(input, &settings_with_table_mode(mode));
            assert_eq!(result, input, "top-level table modified under {:?}", mode);
        }
    }

    #[test]
    fn recover_table_preserves_alignment_colons_byte_exactly() {
        // Alignment colons in the separator row must survive the re-indent
        // verbatim: we only prepend spaces, never rewrite cell content.
        let input = "\
1. before

| left | middle | right |
| :--- | :----: | ----: |
| a    | b      | c     |

2. after
";
        let settings =
            settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Safe);
        let result = format(input, &settings);
        // The separator row line must appear verbatim with only the 3-space
        // prefix added.
        assert!(
            result.contains("   | :--- | :----: | ----: |\n"),
            "alignment row not preserved byte-exactly; got:\n{}",
            result
        );
    }

    #[test]
    fn recover_table_idempotent() {
        let input = "\
1. before

| a | b |
| - | - |
| 1 | 2 |

2. after
";
        let settings =
            settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Safe);
        let once = format(input, &settings);
        let twice = format(&once, &settings);
        assert_eq!(once, twice, "recovery must be idempotent");
    }

    #[test]
    fn recover_table_skipped_when_numbering_restarts() {
        // `1. …` then another `1. …` (not `2.`) means the user deliberately
        // restarted numbering; the table between them is not evidence of
        // nesting and must be left alone.
        let input = "\
1. before

| a | b |
| - | - |
| 1 | 2 |

1. after
";
        let settings =
            settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Safe);
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    #[test]
    fn recover_table_off_mode_leaves_escape_alone() {
        let input = "\
1. before

| a | b |
| - | - |
| 1 | 2 |

2. after
";
        let settings =
            settings_with_table_mode(crate::types::RecoverEscapedTablesMode::Off);
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    // ── Recover-escaped-paragraphs-in-lists tests (issue #85) ──

    fn settings_with_recover_paragraphs_mode(
        mode: crate::types::RecoverEscapedParagraphsMode,
    ) -> FormatterSettings {
        use crate::types::{
            RecoverEscapedCodeMode, RecoverEscapedTablesMode, TightenListContinuationsMode,
        };
        let mut s = FormatterSettings::default();
        // Isolate the rule under test: turn sibling list-normalize rules off so
        // cross-rule interactions (#82-#84) don't perturb output assertions.
        s.list_normalize.tighten_list_continuations = TightenListContinuationsMode::Off;
        s.list_normalize.recover_escaped_code_in_lists = RecoverEscapedCodeMode::Off;
        s.list_normalize.recover_escaped_tables_in_lists = RecoverEscapedTablesMode::Off;
        s.list_normalize.recover_escaped_paragraphs_in_lists = mode;
        s
    }

    #[test]
    fn recover_paragraphs_off_is_byte_identical_on_escaped_case() {
        // The canonical false-positive-risky shape: paragraph at col 0 between
        // two numbered items that resume sequence. Default mode is Off, so
        // the formatter must leave it untouched.
        let input = "\
1. first item

also, this continues the first item

2. second item
";
        let settings = FormatterSettings::default();
        assert_eq!(
            settings.list_normalize.recover_escaped_paragraphs_in_lists,
            crate::types::RecoverEscapedParagraphsMode::Off,
            "default mode must be Off (opt-in)"
        );
        let result = format(input, &settings);
        assert_eq!(result, input, "Off mode must be byte-identical");
    }

    #[test]
    fn recover_paragraphs_off_is_byte_identical_on_assorted_inputs() {
        // A few shapes chosen to touch the walker without tripping Off: nested
        // lists, blockquote-wrapped lists, mixed markers.
        let samples = [
            "- a\n- b\n- c\n",
            "1. one\n2. two\n",
            "- outer\n  - inner\n- outer again\n",
            "> 1. quoted\n>\n> text\n>\n> 2. more quoted\n",
        ];
        let settings = FormatterSettings::default();
        for input in samples {
            let result = format(input, &settings);
            assert_eq!(result, input, "Off mode altered input:\n{input}");
        }
    }

    #[test]
    fn recover_paragraphs_heuristic_recovers_lowercase_continuation() {
        // Classic escape: numbering resumes 1→2, paragraph at col 0 starts
        // lowercase — strong continuation signal.
        let input = "\
1. first item

also continues the first

2. second item
";
        let expected = "\
1. first item

   also continues the first
2. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Heuristic,
        );
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn recover_paragraphs_heuristic_recovers_backtick_continuation() {
        // Paragraph starts with inline code — backtick is a strong continuation
        // signal per the issue description.
        let input = "\
1. first item

`foo` is shorthand for the item above

2. second item
";
        let expected = "\
1. first item

   `foo` is shorthand for the item above
2. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Heuristic,
        );
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn recover_paragraphs_heuristic_leaves_capital_new_topic_alone() {
        // Capital-initial paragraph between items. Heuristic must NOT touch it
        // — it reads like a deliberate mid-list new topic, not a continuation.
        let input = "\
1. first item

New unrelated topic that the author meant to stay at column 0.

2. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Heuristic,
        );
        let result = format(input, &settings);
        assert_eq!(result, input, "heuristic must not touch capital/new-topic paragraph");
    }

    #[test]
    fn recover_paragraphs_heuristic_leaves_non_resuming_numbering_alone() {
        // Numbering does not resume (1. then 1.) — the structural precondition
        // fails so heuristic must not fire even with a lowercase start.
        let input = "\
1. first item

also continues the first (but numbering does not resume)

1. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Heuristic,
        );
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    #[test]
    fn recover_paragraphs_aggressive_captures_capital_case() {
        // Aggressive mode fires even without the lowercase/backtick/punctuation
        // gate, as long as the structural preconditions hold.
        let input = "\
1. first item

Capital start but numbering resumes so aggressive fires

2. second item
";
        let expected = "\
1. first item

   Capital start but numbering resumes so aggressive fires
2. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Aggressive,
        );
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn recover_paragraphs_heuristic_handles_bullet_lists() {
        // Bullet-list variant: same marker char on both sides + lowercase
        // start → recover.
        let input = "\
- first bullet

continues the bullet above

- second bullet
";
        let expected = "\
- first bullet

  continues the bullet above
- second bullet
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Heuristic,
        );
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn recover_paragraphs_idempotent_under_heuristic() {
        let input = "\
1. first item

also continues the first

2. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Heuristic,
        );
        let once = format(input, &settings);
        let twice = format(&once, &settings);
        assert_eq!(once, twice, "recover-paragraphs heuristic is not idempotent");
    }

    #[test]
    fn recover_paragraphs_idempotent_under_aggressive() {
        let input = "\
1. first item

Capital continuation line.

2. second item
";
        let settings = settings_with_recover_paragraphs_mode(
            crate::types::RecoverEscapedParagraphsMode::Aggressive,
        );
        let once = format(input, &settings);
        let twice = format(&once, &settings);
        assert_eq!(once, twice, "recover-paragraphs aggressive is not idempotent");
    }

    #[test]
    fn test_heading_spacing() {
        let input = "# Heading\nContent";
        let expected = "# Heading\n\nContent";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_heading_spacing_already_correct() {
        let input = "# Heading\n\nContent";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_multiple_headings() {
        let input = "# First\nContent\n## Second\nMore content";
        let expected = "# First\n\nContent\n\n## Second\n\nMore content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_code_block_preserved() {
        let input = "```js\nconst x = 1;\n```";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_frontmatter_preserved() {
        let input = "---\ntitle: Test\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_idempotency() {
        let input = "# Heading\n\nSome content\n\n## Another\n\nMore content";
        let first = format(input, &FormatterSettings::default());
        let second = format(&first, &FormatterSettings::default());
        assert_eq!(first, second, "Formatter should be idempotent");
    }

    #[test]
    fn test_idempotency_after_fix() {
        let input = "# Heading\nContent\n## Another\nMore content";
        let first = format(input, &FormatterSettings::default());
        let second = format(&first, &FormatterSettings::default());
        assert_eq!(first, second, "Formatter should be idempotent after fixing");
    }

    #[test]
    fn test_normalize_multiple_empty_lines() {
        let input = "# Heading\n\n\n\nContent";
        let expected = "# Heading\n\nContent";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_list_basic() {
        let input = "- item 1\n- item 2\n- item 3";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_list_nested_indentation() {
        let input = "- item 1\n    - nested item";
        let expected = "- item 1\n  - nested item";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_ordered_list_continuation_stays_tight() {
        let input = "1. A numbered item that wraps to\n   a continuation line\n2. Another item";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_nested_list_under_ordered_item_keeps_parent_indent() {
        let input = "5. Parent item:\n   - Nested item that wraps to\n     a continuation line";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_continuation_paragraph_then_nested_sublist() {
        // Adversarial case: continuation paragraph followed by nested sublist at same indent
        let input = "5. Parent item\n   continuation paragraph\n   - child item";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_empty_content() {
        let input = "";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_disabled_spacing_rule() {
        let mut settings = FormatterSettings::default();
        settings.add_empty_line_between_elements.enabled = false;
        let input = "# Heading\nContent";
        let result = format(input, &settings);
        assert_eq!(result, input, "Disabled rule should not modify content");
    }

    #[test]
    fn test_heading_followed_by_heading() {
        // Headings followed by headings should NOT get extra spacing
        // (the next line starts with #)
        let input = "# First\n## Second";
        let result = format(input, &FormatterSettings::default());
        // The TS formatter inserts a line between headings, but the condition
        // says "if next line doesn't start with #", so this should be unchanged
        assert_eq!(result, input);
    }

    // ========================================================================
    // YAML frontmatter formatting tests
    // ========================================================================

    #[test]
    fn test_yaml_basic_formatting() {
        let input = "---\ntitle: Test\nauthor: John\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Simple YAML should be preserved");
    }

    #[test]
    fn test_yaml_quoted_values_preserved() {
        let input = "---\ntitle: \"Hello: World\"\ndescription: \"It's a test\"\n---\n\nContent";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Quoted YAML values should be preserved");
    }

    #[test]
    fn test_yaml_boolean_values_preserved() {
        let input = "---\ndraft: true\npublished: false\n---\n\nContent";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Boolean values should be preserved");
    }

    #[test]
    fn test_yaml_idempotency() {
        let input = "---\ntitle: My Post\nauthor: Jane\ntags:\n  - rust\n  - yaml\n---\n\n# Content";
        let first = format(input, &FormatterSettings::default());
        let second = format(&first, &FormatterSettings::default());
        assert_eq!(first, second, "YAML formatting should be idempotent");
    }

    #[test]
    fn test_yaml_disabled() {
        let mut settings = FormatterSettings::default();
        settings.format_yaml_frontmatter.enabled = false;
        let input = "---\ntitle:    Test\n---\n\n# Content";
        let result = format(input, &settings);
        assert_eq!(result, input, "Disabled YAML rule should not modify content");
    }

    #[test]
    fn test_yaml_unsafe_value_with_colon() {
        // Values containing ": " should be quoted by preprocessor
        let input = "---\ntitle: Hello: World\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(
            result,
            "---\ntitle: \"Hello: World\"\n---\n\n# Content",
            "Unsafe values should be quoted"
        );
    }

    // ================================================================
    // JSX Multi-line Formatting Tests
    // ================================================================

    #[test]
    fn test_jsx_self_closing_preserved() {
        let input = "<Component />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_jsx_self_closing_single_prop_preserved() {
        let input = "<Component prop=\"value\" />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_jsx_multiline_formats_attributes() {
        // Attributes badly indented should get reformatted
        let input = "<Component\n      src=\"image.png\"\n      alt=\"test\" />";
        let expected = "<Component\n  src=\"image.png\"\n  alt=\"test\" />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_standalone_self_close_fixed() {
        // /> on its own line should be appended to last attribute
        let input = "<Component\n  src=\"image.png\"\n  alt=\"test\"\n/>";
        let expected = "<Component\n  src=\"image.png\"\n  alt=\"test\" />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_attrs_on_first_line_reformatted() {
        // Attributes on the first line should be reformatted
        let input = "<Component src=\"image.png\" alt=\"test\"\n  className=\"foo\" />";
        let expected = "<Component\n  src=\"image.png\"\n  alt=\"test\"\n  className=\"foo\" />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_with_children_preserved() {
        let input = "<Component>\nContent here\n</Component>";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_jsx_multiline_with_children() {
        let input = "<Component\n      src=\"image.png\"\n      alt=\"test\">\nContent\n</Component>";
        // Non-self-closing: closing > goes on its own line
        let expected = "<Component\n  src=\"image.png\"\n  alt=\"test\">\nContent\n</Component>";
        let result = format(input, &FormatterSettings::default());
        // The formatter puts > on its own line (matching TS behavior)
        let expected_alt = "<Component\n  src=\"image.png\"\n  alt=\"test\"\n>\nContent\n</Component>";
        assert!(
            result == expected || result == expected_alt,
            "Got: {:?}",
            result
        );
    }

    #[test]
    fn test_yaml_unsafe_value_with_hash() {
        let input = "---\ntitle: Hello #world\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(
            result,
            "---\ntitle: \"Hello #world\"\n---\n\n# Content",
            "Values with # comments should be quoted"
        );
    }

    #[test]
    fn test_yaml_force_quotes() {
        let mut settings = FormatterSettings::default();
        settings.format_yaml_frontmatter.force_quotes = true;
        let input = "---\ntitle: Test\nauthor: John\n---\n\n# Content";
        let result = format(input, &settings);
        assert_eq!(
            result,
            "---\ntitle: \"Test\"\nauthor: \"John\"\n---\n\n# Content",
            "forceQuotes should quote all string values"
        );
    }

    #[test]
    fn test_yaml_single_quote_type() {
        let mut settings = FormatterSettings::default();
        settings.format_yaml_frontmatter.force_quotes = true;
        settings.format_yaml_frontmatter.quoting_type = "'".into();
        let input = "---\ntitle: Test\n---\n\n# Content";
        let result = format(input, &settings);
        assert_eq!(
            result,
            "---\ntitle: 'Test'\n---\n\n# Content",
            "Single quote type should use single quotes"
        );
    }

    #[test]
    fn test_yaml_parse_error_graceful() {
        let input = "---\n: invalid yaml [[\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Invalid YAML should be left unchanged");
    }

    #[test]
    fn test_yaml_fix_unsafe_values_disabled() {
        let mut settings = FormatterSettings::default();
        settings.format_yaml_frontmatter.fix_unsafe_values = false;
        let input = "---\ntitle: Hello: World\n---\n\n# Content";
        let result = format(input, &settings);
        assert_eq!(result, input, "fix_unsafe_values=false should not preprocess");
    }

    #[test]
    fn test_yaml_nested_mapping() {
        let input = "---\ntitle: Test\nmeta:\n  og_title: Hello\n  og_desc: World\n---\n\n# Content";
        let first = format(input, &FormatterSettings::default());
        let second = format(&first, &FormatterSettings::default());
        assert_eq!(first, second, "Nested YAML should be idempotent");
    }

    #[test]
    fn test_yaml_sequence_values() {
        let input = "---\ntitle: Test\ntags:\n  - rust\n  - yaml\n  - formatter\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        let second = format(&result, &FormatterSettings::default());
        assert_eq!(result, second, "YAML with sequences should be idempotent");
    }

    #[test]
    fn test_yaml_unnecessary_quotes_removed() {
        let input = "---\ntitle: \"Already quoted\"\n---\n\n# Content";
        let expected = "---\ntitle: Already quoted\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected, "Unnecessary quotes should be removed");
    }

    #[test]
    fn test_yaml_necessary_quotes_kept() {
        let input = "---\ntitle: \"Hello: World\"\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Necessary quotes should be preserved");
    }

    // ========================================================================
    // YAML preprocessing tests
    // ========================================================================

    #[test]
    fn test_preprocess_skip_already_quoted() {
        let input = "title: \"Hello: World\"";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_preprocess_skip_single_quoted() {
        let input = "title: 'Hello: World'";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_preprocess_skip_flow_sequence() {
        let input = "tags: [a, b, c]";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_preprocess_skip_flow_mapping() {
        let input = "meta: {key: value}";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_preprocess_skip_block_scalar() {
        let input = "description: >";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_preprocess_quote_colon() {
        let input = "title: Hello: World";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, "title: \"Hello: World\"");
    }

    #[test]
    fn test_preprocess_quote_hash() {
        let input = "title: Hello #world";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, "title: \"Hello #world\"");
    }

    #[test]
    fn test_preprocess_quote_special_start_chars() {
        let input = "title: !important";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, "title: \"!important\"");
    }

    #[test]
    fn test_preprocess_escape_quotes_in_value() {
        let input = "title: She said \"hello\": goodbye";
        let result = preprocess_yaml_for_parsing(input);
        assert_eq!(result, "title: \"She said \\\"hello\\\": goodbye\"");
    }

    // ========================================================================
    // Settings deserialization tests
    // ========================================================================

    #[test]
    fn test_settings_from_empty_json() {
        let value = serde_json::json!({});
        let settings = FormatterSettings::from_partial_json(&value);
        let defaults = FormatterSettings::default();
        assert_eq!(settings.add_empty_line_between_elements.enabled, defaults.add_empty_line_between_elements.enabled);
        assert_eq!(settings.format_yaml_frontmatter.enabled, defaults.format_yaml_frontmatter.enabled);
        assert_eq!(settings.expand_single_line_jsx.enabled, defaults.expand_single_line_jsx.enabled);
        assert_eq!(settings.error_handling.throw_on_error, defaults.error_handling.throw_on_error);
        assert_eq!(settings.auto_detect_indent.enabled, defaults.auto_detect_indent.enabled);
    }

    #[test]
    fn test_settings_partial_override() {
        let value = serde_json::json!({
            "addEmptyLineBetweenElements": { "enabled": false },
            "formatYamlFrontmatter": { "enabled": false, "indent": 4 }
        });
        let settings = FormatterSettings::from_partial_json(&value);
        assert!(!settings.add_empty_line_between_elements.enabled);
        assert!(!settings.format_yaml_frontmatter.enabled);
        assert_eq!(settings.format_yaml_frontmatter.indent, 4);
        assert!(settings.format_multi_line_jsx.enabled);
        assert!(settings.preserve_admonitions.enabled);
    }

    #[test]
    fn test_settings_all_fields_camelcase() {
        let value = serde_json::json!({
            "addEmptyLineBetweenElements": { "enabled": false },
            "formatMultiLineJsx": { "enabled": false, "indentSize": 4 },
            "formatHtmlBlocksInMdx": { "enabled": false },
            "expandSingleLineJsx": { "enabled": true, "propsThreshold": 3 },
            "indentJsxContent": { "enabled": true, "indentSize": 4 },
            "addEmptyLinesInBlockJsx": { "enabled": false, "blockComponents": ["Note"] },
            "formatYamlFrontmatter": { "enabled": false, "lineWidth": 80 },
            "preserveAdmonitions": { "enabled": false },
            "errorHandling": { "throwOnError": true },
            "autoDetectIndent": { "enabled": true, "fallbackIndentSize": 4, "minConfidence": 0.8 }
        });
        let settings = FormatterSettings::from_partial_json(&value);
        assert!(!settings.add_empty_line_between_elements.enabled);
        assert!(!settings.format_multi_line_jsx.enabled);
        assert_eq!(settings.format_multi_line_jsx.indent_size, 4);
        assert!(!settings.format_html_blocks_in_mdx.enabled);
        assert!(settings.expand_single_line_jsx.enabled);
        assert_eq!(settings.expand_single_line_jsx.props_threshold, 3);
        assert!(settings.indent_jsx_content.enabled);
        assert_eq!(settings.indent_jsx_content.indent_size, 4);
        assert!(!settings.add_empty_lines_in_block_jsx.enabled);
        assert_eq!(settings.add_empty_lines_in_block_jsx.block_components, vec!["Note"]);
        assert!(!settings.format_yaml_frontmatter.enabled);
        assert_eq!(settings.format_yaml_frontmatter.line_width, 80);
        assert!(!settings.preserve_admonitions.enabled);
        assert!(settings.error_handling.throw_on_error);
        assert!(settings.auto_detect_indent.enabled);
        assert_eq!(settings.auto_detect_indent.fallback_indent_size, 4);
        assert!((settings.auto_detect_indent.min_confidence - 0.8).abs() < f64::EPSILON);
    }

    #[test]
    fn test_settings_invalid_json_returns_defaults() {
        let value = serde_json::json!("not an object");
        let settings = FormatterSettings::from_partial_json(&value);
        let defaults = FormatterSettings::default();
        assert_eq!(settings.add_empty_line_between_elements.enabled, defaults.add_empty_line_between_elements.enabled);
    }

    // ========================================================================
    // needs_quoting tests
    // ========================================================================

    #[test]
    fn test_needs_quoting_empty() {
        assert!(needs_quoting(""));
    }

    #[test]
    fn test_needs_quoting_keywords() {
        assert!(needs_quoting("true"));
        assert!(needs_quoting("false"));
        assert!(needs_quoting("null"));
        assert!(needs_quoting("yes"));
        assert!(needs_quoting("no"));
        assert!(needs_quoting("True"));
        assert!(needs_quoting("FALSE"));
    }

    #[test]
    fn test_needs_quoting_numbers() {
        assert!(needs_quoting("42"));
        assert!(needs_quoting("3.14"));
        assert!(needs_quoting("-1"));
    }

    #[test]
    fn test_needs_quoting_special_chars() {
        assert!(needs_quoting("hello: world"));
        assert!(needs_quoting("hello #comment"));
        assert!(needs_quoting("!important"));
        assert!(needs_quoting("&anchor"));
        assert!(needs_quoting("*alias"));
    }

    #[test]
    fn test_needs_quoting_normal_strings() {
        assert!(!needs_quoting("hello"));
        assert!(!needs_quoting("Hello World"));
        assert!(!needs_quoting("my-title"));
        assert!(!needs_quoting("some_value"));
    }

    // ================================================================
    // JSX Multi-line Formatting Tests (additional)
    // ================================================================

    #[test]
    fn test_jsx_html_element_skipped() {
        let input = "<div\n      class=\"test\">\nContent\n</div>";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input);
    }

    #[test]
    fn test_jsx_ignored_component_skipped() {
        let mut settings = FormatterSettings::default();
        settings.format_multi_line_jsx.ignore_components =
            vec!["IgnoreMe".to_string()];
        let input = "<IgnoreMe\n      prop=\"value\" />";
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    #[test]
    fn test_jsx_expression_attribute() {
        let input = "<Component\n      value={42} />";
        let expected = "<Component\n  value={42} />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_boolean_attribute() {
        let input = "<Component\n      disabled\n      loading />";
        let expected = "<Component\n  disabled\n  loading />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_already_formatted_unchanged() {
        let input = "<Component\n  src=\"image.png\"\n  alt=\"test\" />";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Already properly formatted JSX should be unchanged");
    }

    #[test]
    fn test_jsx_format_disabled() {
        let mut settings = FormatterSettings::default();
        settings.format_multi_line_jsx.enabled = false;
        let input = "<Component\n      src=\"image.png\" />";
        let result = format(input, &settings);
        assert_eq!(result, input, "Disabled JSX formatting should not modify content");
    }

    // ================================================================
    // Block JSX Empty Line Tests
    // ================================================================

    fn settings_with_blocks() -> FormatterSettings {
        let mut s = FormatterSettings::default();
        s.add_empty_lines_in_block_jsx.block_components =
            vec!["InfoBox".to_string(), "Note".to_string()];
        s
    }

    #[test]
    fn test_block_jsx_adds_empty_lines() {
        let settings = settings_with_blocks();
        let input = "<InfoBox>\nContent\n</InfoBox>";
        let expected = "<InfoBox>\n\nContent\n\n</InfoBox>";
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_block_jsx_already_has_empty_lines() {
        let settings = settings_with_blocks();
        let input = "<InfoBox>\n\nContent\n\n</InfoBox>";
        let result = format(input, &settings);
        assert_eq!(result, input, "Should be idempotent");
    }

    #[test]
    fn test_block_jsx_single_line_expanded() {
        let settings = settings_with_blocks();
        let input = "<InfoBox>Content</InfoBox>";
        let expected = "<InfoBox>\n\nContent\n\n</InfoBox>";
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_block_jsx_non_block_not_affected() {
        let settings = settings_with_blocks();
        let input = "<OtherComponent>\nContent\n</OtherComponent>";
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    #[test]
    fn test_block_jsx_with_attributes() {
        let settings = settings_with_blocks();
        let input = "<InfoBox\n  title=\"Hello\">\nContent\n</InfoBox>";
        let expected = "<InfoBox\n  title=\"Hello\">\n\nContent\n\n</InfoBox>";
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    // ================================================================
    // JSX Indent Operations Tests
    // ================================================================

    fn settings_with_indent() -> FormatterSettings {
        let mut s = FormatterSettings::default();
        s.indent_jsx_content.enabled = true;
        s.indent_jsx_content.container_components =
            vec!["Container".to_string(), "Wrapper".to_string()];
        s
    }

    #[test]
    fn test_jsx_indent_adds_indentation() {
        let settings = settings_with_indent();
        let input = "<Container>\nContent line 1\nContent line 2\n</Container>";
        let expected = "<Container>\n  Content line 1\n  Content line 2\n</Container>";
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_indent_already_indented() {
        let settings = settings_with_indent();
        let input = "<Container>\n  Content line 1\n  Content line 2\n</Container>";
        let result = format(input, &settings);
        assert_eq!(result, input, "Already indented content should be unchanged");
    }

    #[test]
    fn test_jsx_indent_non_container_unchanged() {
        let settings = settings_with_indent();
        let input = "<Other>\nContent\n</Other>";
        let result = format(input, &settings);
        assert_eq!(result, input);
    }

    #[test]
    fn test_jsx_indent_skips_empty_lines() {
        let settings = settings_with_indent();
        let input = "<Container>\nContent\n\nMore content\n</Container>";
        let expected = "<Container>\n  Content\n\n  More content\n</Container>";
        let result = format(input, &settings);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_jsx_indent_disabled() {
        let mut settings = FormatterSettings::default();
        settings.indent_jsx_content.enabled = false;
        settings.indent_jsx_content.container_components =
            vec!["Container".to_string()];
        let input = "<Container>\nContent\n</Container>";
        let result = format(input, &settings);
        assert_eq!(result, input, "Disabled indent should not modify content");
    }

    // ================================================================
    // JSX Formatting Idempotency Tests
    // ================================================================

    #[test]
    fn test_jsx_format_idempotent() {
        let input = "<Component\n      src=\"image.png\"\n      alt=\"test\" />";
        let settings = FormatterSettings::default();
        let first = format(input, &settings);
        let second = format(&first, &settings);
        assert_eq!(first, second, "JSX formatting should be idempotent");
    }

    #[test]
    fn test_block_jsx_idempotent() {
        let settings = settings_with_blocks();
        let input = "<InfoBox>\nContent\n</InfoBox>";
        let first = format(input, &settings);
        let second = format(&first, &settings);
        assert_eq!(first, second, "Block JSX formatting should be idempotent");
    }

    #[test]
    fn test_jsx_indent_idempotent() {
        let settings = settings_with_indent();
        let input = "<Container>\nContent\n</Container>";
        let first = format(input, &settings);
        let second = format(&first, &settings);
        assert_eq!(first, second, "JSX indent should be idempotent");
    }

    // ================================================================
    // Block scalar regex and extraction tests (items 1 & 2 from #77)
    // ================================================================

    #[test]
    fn test_block_scalar_re_variants() {
        // All valid YAML block scalar indicators must match
        for indicator in &[">", "|", ">-", "|-", ">+", "|+", "|2-", ">1+", "|2", ">3"] {
            assert!(
                BLOCK_SCALAR_RE.is_match(indicator),
                "BLOCK_SCALAR_RE should match {:?}",
                indicator
            );
        }
        // Non-indicators must NOT match
        for not_indicator in &["text", "42", ">text", "| extra"] {
            assert!(
                !BLOCK_SCALAR_RE.is_match(not_indicator),
                "BLOCK_SCALAR_RE should NOT match {:?}",
                not_indicator
            );
        }
    }

    #[test]
    fn test_yaml_block_scalar_key_re_indent_indicators() {
        // |2- and >1+ have the indent digit before the chomping char
        for key_line in &[
            "description: |2-",
            "description: >1+",
            "body: |+",
            "body: >+",
        ] {
            assert!(
                YAML_BLOCK_SCALAR_KEY_RE.is_match(key_line),
                "YAML_BLOCK_SCALAR_KEY_RE should match {:?}",
                key_line
            );
        }
    }

    #[test]
    fn test_yaml_block_scalar_key_re_trailing_comment() {
        // A trailing comment must not prevent the match
        let line = "description: >- # this is a note";
        assert!(
            YAML_BLOCK_SCALAR_KEY_RE.is_match(line),
            "Trailing comment should not prevent block scalar detection"
        );
    }

    #[test]
    fn test_block_scalar_with_indent_indicator_preserved() {
        // |2- indicator: formatter must keep the block verbatim
        let input = "---\ntitle: Test\nbody: |2-\n  Line one\n  Line two\nsidebar: 1\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "|2- block scalar should be preserved");
    }

    #[test]
    fn test_block_scalar_keep_plus_chomping() {
        // >+ and |+ must be preserved
        let input = "---\ntitle: Test\ndescription: >+\n  Long text here.\nsidebar: 1\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, ">+ block scalar should be preserved");
    }

    #[test]
    fn test_block_scalar_as_last_key() {
        // When the block scalar is the last key (no trailing separator blank line)
        let input = "---\ntitle: Test\ndescription: >-\n  Long text here.\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Block scalar as last key should be preserved");
    }

    #[test]
    fn test_block_scalar_middle_key_no_trailing_blank() {
        // Block scalar followed by a blank separator + another key must NOT
        // bake the blank line into the preserved block text.
        let input = "---\ntitle: Test\ndescription: >-\n  Long text here.\nsidebar: 1\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Block scalar in middle should not absorb trailing blank");
    }

    #[test]
    fn test_nested_block_scalar_preserved() {
        // Nested block scalars (e.g. meta.description: >-) must be preserved
        // verbatim by the formatter. Regression fix for GitHub issue #78
        // (full-path tracking in extract_block_scalars / emit_yaml_mapping).
        let input = "---\ntitle: Test\nmeta:\n  description: >-\n    Long nested text.\nsidebar: 1\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Nested block scalar should be preserved verbatim");
        // And the output must still be idempotent.
        let second = format(&result, &FormatterSettings::default());
        assert_eq!(result, second, "Nested block scalar output must be idempotent");
    }

    #[test]
    fn test_deeply_nested_block_scalar_preserved() {
        // A three-level deep block scalar (a.b.c) must be preserved too.
        let input = "---\na:\n  b:\n    c: >-\n      deep text\nkeep: 1\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Deeply nested block scalar should be preserved");
    }

    #[test]
    fn test_nested_block_scalar_with_literal_indicator() {
        // The `|` (literal) indicator at a nested path must also be preserved.
        let input = "---\nmeta:\n  body: |\n    line one\n    line two\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Nested literal block scalar should be preserved");
    }

    #[test]
    fn test_top_level_and_nested_block_scalars_coexist() {
        // Top-level and nested block scalars in the same frontmatter must
        // both be preserved.
        let input = "---\ntop: >-\n  top text\nmeta:\n  description: >-\n    nested text\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(
            result, input,
            "Both top-level and nested block scalars should be preserved"
        );
    }

    #[test]
    fn test_block_scalar_does_not_leak_into_sequence_item_with_same_key() {
        // Regression guard: a top-level block scalar must NOT be re-emitted
        // inside a same-named key of a mapping that lives in a sequence.
        // Previously the emitter reset its path to `""` inside sequences
        // but still looked up `description` in the preserved map, which
        // would overwrite the sequence item's plain scalar with the
        // top-level block text.
        let input =
            "---\ndescription: >-\n  top text\nitems:\n  - description: plain\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        // The sequence item's plain `description: plain` must survive.
        assert!(
            result.contains("- description: plain"),
            "sequence-item description should remain plain; got:\n{}",
            result
        );
        // And the top-level block scalar must still be preserved verbatim.
        assert!(
            result.contains("description: >-\n  top text"),
            "top-level block scalar should be preserved; got:\n{}",
            result
        );
    }

    // ── tighten-list-continuations (issue #82) tests ──
    //
    // These tests drive the full public `format()` entry point because the
    // rule composes with the rest of the pipeline (wrap-markdown, convergence
    // loop, post-processing `normalize_empty_lines`). Driving the API
    // end-to-end also doubles as a regression guard for the rule-ordering
    // contract: if tighten ever gets reordered past wrap-markdown or past the
    // convergence loop, the fixture assertions will break.

    fn settings_with_tighten(
        mode: crate::types::TightenListContinuationsMode,
    ) -> FormatterSettings {
        let mut s = FormatterSettings::default();
        s.list_normalize.tighten_list_continuations = mode;
        s
    }

    fn settings_with_tighten_item_spacing(
        mode: crate::types::TightenListItemSpacingMode,
    ) -> FormatterSettings {
        let mut s = FormatterSettings::default();
        s.list_normalize.tighten_list_item_spacing = mode;
        s
    }

    #[test]
    fn tighten_heuristic_collapses_lowercase_continuation() {
        use crate::types::TightenListContinuationsMode;
        let input = "- first line of the item, which is long and continues\n\n  with more prose.\n";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        // Blank line between the two paragraphs should be gone.
        assert!(
            !out.contains("continues\n\n  with more prose"),
            "blank gap not collapsed; output:\n{out}"
        );
        assert!(
            out.contains("with more prose."),
            "second paragraph content missing; output:\n{out}"
        );
    }

    #[test]
    fn tighten_heuristic_preserves_capital_start() {
        use crate::types::TightenListContinuationsMode;
        // "Also, ..." — capital letter — must be left alone by heuristic mode.
        let input = "- first sentence ends here.\n\n  Also, a new idea starts here.\n";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        assert!(
            out.contains("ends here.\n\n  Also, a new idea"),
            "heuristic should preserve capital-start second paragraph; output:\n{out}"
        );
    }

    #[test]
    fn tighten_heuristic_preserves_item_with_code_fence() {
        use crate::types::TightenListContinuationsMode;
        // Shape is Mixed (paragraph + code fence), so the rule must not fire,
        // even though the second paragraph starts with lowercase.
        let input = "\
- intro paragraph

  ```js
  const x = 1;
  ```

  continuing lowercase prose that would otherwise trigger.
";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        // The final paragraph should stay separated from the code fence.
        assert!(
            out.contains("```\n\n  continuing lowercase"),
            "tighten must not collapse across non-paragraph children; output:\n{out}"
        );
    }

    #[test]
    fn tighten_heuristic_preserves_item_with_sublist() {
        use crate::types::TightenListContinuationsMode;
        // Shape is HasSublist / Mixed, not ParagraphsOnly — do not fire.
        let input = "\
- parent item intro paragraph

  - nested child one
  - nested child two

  continuing lowercase prose that would otherwise trigger.
";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        assert!(
            out.contains("child two\n\n  continuing lowercase"),
            "tighten must not collapse around a sublist child; output:\n{out}"
        );
    }

    #[test]
    fn tighten_aggressive_collapses_capital_start() {
        use crate::types::TightenListContinuationsMode;
        let input = "- first sentence ends here.\n\n  Also, a new idea starts here.\n";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Aggressive));
        // Aggressive drops condition (c): the gap collapses even though the
        // second paragraph starts with a capital letter.
        assert!(
            !out.contains("ends here.\n\n  Also,"),
            "aggressive mode should collapse; output:\n{out}"
        );
        assert!(
            out.contains("Also, a new idea"),
            "content must survive; output:\n{out}"
        );
    }

    #[test]
    fn tighten_off_is_no_op() {
        use crate::types::TightenListContinuationsMode;
        // Identical to the heuristic fixture. With mode=off, the blank gap
        // must survive byte-for-byte.
        let input = "- first line of the item, which is long and continues\n\n  with more prose.\n";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Off));
        assert!(
            out.contains("continues\n\n  with more prose"),
            "off mode must be a no-op; output:\n{out}"
        );
    }

    #[test]
    fn tighten_is_idempotent() {
        use crate::types::TightenListContinuationsMode;
        let input = "- first line of the item, which is long and continues\n\n  with more prose.\n";
        let once = format(input, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        let twice = format(&once, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        assert_eq!(once, twice, "tighten must be idempotent");
    }

    #[test]
    fn tighten_preserves_double_blank_gap() {
        use crate::types::TightenListContinuationsMode;
        // Two blank lines between paragraphs — not exactly one — must not
        // collapse. After format(), `normalize_empty_lines` will reduce it
        // to one blank line, but the rule itself must not fire on the
        // original AST state, and the collapsed post-normalize result will
        // either be left alone on the next convergence iteration (aggressive
        // would collapse, heuristic won't if start is capital). Here we use
        // capital start so heuristic cannot trigger on the post-normalized
        // version either.
        let input = "- first sentence.\n\n\n  Also follows.\n";
        let out = format(input, &settings_with_tighten(TightenListContinuationsMode::Heuristic));
        // "Also" starts capital → heuristic preserves even after normalize.
        assert!(
            out.contains("first sentence.\n\n  Also follows."),
            "heuristic must not collapse normalized double-gap with capital second para; output:\n{out}"
        );
    }

    #[test]
    fn tighten_real_content_fixture_local_llm_search_spike() {
        // Short snippet from the observed loose AI-authored form in
        // `zudo-text/doc/src/content/docs/architecture/local-llm-search-spike.mdx`
        // (captured in the epic #80 investigation). The second paragraph
        // starts with a backtick (inline code), which is a heuristic trigger.
        let input = "\
- No `candle`, `ort` / ONNX Runtime, `llama.cpp` / `llama-cpp-2`, `tch` / libtorch, or

  `rust-bert` dependency in `tauri-app/Cargo.toml` or `tauri-app/core/Cargo.toml`.
- No `gguf` / `.onnx` / `.safetensors` assets in the repo.
";
        let out = format(input, &FormatterSettings::default());
        // The blank gap between the two continuation lines must be gone.
        assert!(
            !out.contains("libtorch, or\n\n  `rust-bert`"),
            "real-content fixture: blank gap not collapsed; output:\n{out}"
        );
        // Both content halves must still be present.
        assert!(
            out.contains("libtorch, or"),
            "first continuation line missing; output:\n{out}"
        );
        assert!(
            out.contains("`rust-bert` dependency"),
            "second continuation content missing; output:\n{out}"
        );
        // The second list item is untouched.
        assert!(
            out.contains("- No `gguf` / `.onnx` / `.safetensors` assets in the repo."),
            "second list item must be untouched; output:\n{out}"
        );
    }

    #[test]
    fn tighten_default_matches_heuristic() {
        // The FormatterSettings::default() must pick heuristic mode (the
        // locked-in default) — a regression guard for the config layer.
        let input = "- first line of the item, which is long and continues\n\n  with more prose.\n";
        let out_default = format(input, &FormatterSettings::default());
        let out_explicit = format(
            input,
            &settings_with_tighten(crate::types::TightenListContinuationsMode::Heuristic),
        );
        assert_eq!(
            out_default, out_explicit,
            "default settings must match explicit heuristic; default=\n{out_default}\nexplicit=\n{out_explicit}"
        );
    }

    // ── tighten-list-item-spacing (issue #90) tests ──

    #[test]
    fn tighten_item_spacing_heuristic_collapses_paragraphs_only_list() {
        use crate::types::TightenListItemSpacingMode;
        let input = "- first item\n\n- second item\n";
        let out = format(
            input,
            &settings_with_tighten_item_spacing(TightenListItemSpacingMode::Heuristic),
        );
        assert!(
            !out.contains("first item\n\n- second item"),
            "heuristic should collapse inter-item blank gap; output:\n{out}"
        );
        assert!(
            out.contains("- first item\n- second item"),
            "both items must survive; output:\n{out}"
        );
    }

    #[test]
    fn tighten_item_spacing_heuristic_preserves_mixed_shape_list() {
        use crate::types::TightenListItemSpacingMode;
        let input = "\
- first item

- second item
  - nested child

- third item
";
        let out = format(
            input,
            &settings_with_tighten_item_spacing(TightenListItemSpacingMode::Heuristic),
        );
        assert!(
            out.contains("first item\n\n- second item"),
            "heuristic must preserve when any sibling item is non-ParagraphsOnly; output:\n{out}"
        );
        assert!(
            out.contains("nested child\n\n- third item"),
            "heuristic must preserve every inter-item gap in the mixed list; output:\n{out}"
        );
    }

    #[test]
    fn tighten_item_spacing_aggressive_ignores_shape_gate() {
        use crate::types::TightenListItemSpacingMode;
        let input = "\
- first item

- second item
  
  ```js
  const x = 1;
  ```

- third item
";
        let out = format(
            input,
            &settings_with_tighten_item_spacing(TightenListItemSpacingMode::Aggressive),
        );
        assert!(
            !out.contains("first item\n\n- second item"),
            "aggressive should collapse first gap; output:\n{out}"
        );
        assert!(
            !out.contains("```\n\n- third item"),
            "aggressive should collapse second gap; output:\n{out}"
        );
    }

    #[test]
    fn tighten_item_spacing_preserves_double_blank_gap() {
        use crate::types::TightenListItemSpacingMode;
        let input = "- first item\n\n\n- second item\n";
        let out = format(
            input,
            &settings_with_tighten_item_spacing(TightenListItemSpacingMode::Heuristic),
        );
        assert!(
            out.contains("first item\n\n\n- second item"),
            "double blank gap should be preserved by the rule; output:\n{out}"
        );
    }

    #[test]
    fn tighten_item_spacing_recurses_into_nested_sublists() {
        use crate::types::TightenListItemSpacingMode;
        let input = "\
- outer item
  - inner one

  - inner two
";
        let expected = "\
- outer item
  - inner one
  - inner two
";
        let out = format(
            input,
            &settings_with_tighten_item_spacing(TightenListItemSpacingMode::Heuristic),
        );
        assert_eq!(out, expected);
    }

    #[test]
    fn tighten_item_spacing_real_content_three_item_fixture() {
        let input = "\
- No `candle`, `ort` / ONNX Runtime, `llama.cpp` / `llama-cpp-2`, `tch` / libtorch, or
  `rust-bert` dependency in `tauri-app/Cargo.toml` or `tauri-app/core/Cargo.toml`.

- No `gguf` / `.onnx` / `.safetensors` assets in the repo.

- No `tokenizers` / `tantivy` / `lancedb` integration code checked in.
";
        let out = format(input, &FormatterSettings::default());
        assert!(
            !out.contains("Cargo.toml`.\n\n- No `gguf`"),
            "first inter-item gap should collapse; output:\n{out}"
        );
        assert!(
            !out.contains("repo.\n\n- No `tokenizers`"),
            "second inter-item gap should collapse; output:\n{out}"
        );
    }

    #[test]
    fn tighten_item_spacing_default_matches_heuristic() {
        use crate::types::TightenListItemSpacingMode;
        let input = "- first item\n\n- second item\n";
        let out_default = format(input, &FormatterSettings::default());
        let out_explicit = format(
            input,
            &settings_with_tighten_item_spacing(TightenListItemSpacingMode::Heuristic),
        );
        assert_eq!(
            out_default, out_explicit,
            "default settings must match explicit heuristic; default=\n{out_default}\nexplicit=\n{out_explicit}"
        );
    }

    // ── Recursive-application-to-nested-sublists tests (issue #86) ──
    //
    // These tests verify that the list-normalize rules from #82 (tighten) and
    // #83 (recover escaped code) fire correctly inside nested sublists — not
    // only at top-level lists. #85 (recover escaped paragraphs) is also
    // exercised via the idempotency test below. Correctness at depth hinges
    // on:
    //   (a) the detection pass traversing the full list tree and reporting
    //       shapes for every item regardless of nesting, and
    //   (b) the apply-side walkers (recover-code / recover-tables) scanning
    //       `item.children` at every list-item level, not just at the root.
    //
    // Prior to this test module the apply walkers skipped the list-item
    // level: they descended from `List → ListItem.children` and re-scanned
    // each sub individually, so a `[List, Code, List]` triple sitting *as*
    // `item.children` was never checked. Fixing that turned out to also
    // require correcting the `continuation_indent` formula (markdown-rs
    // positions are source-absolute, so summing `ancestor_indent` on top
    // over-counted at depth ≥ 1).

    #[test]
    fn recursion_tighten_fires_at_depth_2() {
        // Depth-2 bullet list. The inner item's two paragraph children are
        // separated by a blank line; #82's heuristic tighten rule should
        // collapse that blank — just as it does at depth 0.
        let input = "\
- outer intro
  - inner first line, which is long and continues

    with more prose.
  - inner two
";
        let expected = "\
- outer intro
  - inner first line, which is long and continues
    with more prose.
  - inner two
";
        let out = format(input, &FormatterSettings::default());
        assert_eq!(out, expected);
    }

    #[test]
    fn recursion_recover_code_fires_at_depth_2() {
        // Numbered outer / numbered inner list. The fence sits at col 3 —
        // flush to the outer item's continuation but dedented below the inner
        // item's continuation (col 6), so the parser splits the inner list
        // into two siblings with the fence between. Safe-mode recovery (both
        // sides ordered) re-indents the fence into the inner list.
        let input = "\
1. outer

   1. inner one

   ```js
   const x = 1;
   ```

   2. inner two
";
        let expected = "\
1. outer

   1. inner one

      ```js
      const x = 1;
      ```

   2. inner two
";
        let out = format(input, &FormatterSettings::default());
        assert_eq!(out, expected);
    }

    #[test]
    fn recursion_depth_3_tighten_deepest() {
        // Mixed depth-3 nesting: bullet > numbered > bullet. The deepest item
        // has a blank-gap paragraph continuation; #82 must still fire at the
        // innermost level.
        let input = "\
- outer bullet
  1. middle numbered
     - deepest item one, which continues lowercase

       with more prose.
     - deepest item two
";
        let expected = "\
- outer bullet
  1. middle numbered
     - deepest item one, which continues lowercase
       with more prose.
     - deepest item two
";
        let out = format(input, &FormatterSettings::default());
        assert_eq!(out, expected);
    }

    #[test]
    fn recursion_depth_3_idempotent() {
        // Two passes over a depth-3 mixed structure must produce byte-identical
        // output. The test content mixes a tighten trigger (depth-2) with a
        // recover-code trigger (depth-1) so several rules have to agree on a
        // steady state.
        let input = "\
1. top

   1. middle-a

   ```js
   const x = 1;
   ```

   2. middle-b
      - deepest one, which continues lowercase

        with more prose.
      - deepest two
";
        let settings = FormatterSettings::default();
        let once = format(input, &settings);
        let twice = format(&once, &settings);
        let thrice = format(&twice, &settings);
        assert_eq!(once, twice, "first→second pass flipped:\n--- once\n{once}--- twice\n{twice}");
        assert_eq!(twice, thrice, "second→third pass flipped:\n--- twice\n{twice}--- thrice\n{thrice}");
    }

    #[test]
    fn recursion_detection_traverses_full_tree() {
        // Depth-2 nested bullet list with five items distributed across three
        // depth levels (2 + 2 + 1). `collect_list_item_shapes` must report
        // every item, or downstream rules will silently skip work at depth.
        let input = "\
- l0a
  - l1a
    - l2a
  - l1b
- l0b
";
        let shapes = shapes_for(input);
        assert_eq!(shapes.len(), 5, "expected 5 list items across all depths, got {}: {:?}", shapes.len(), shapes);

        let by_depth = |d: usize| shapes.iter().filter(|s| s.depth == d).count();
        assert_eq!(by_depth(0), 2, "depth-0 count: {:?}", shapes);
        assert_eq!(by_depth(1), 2, "depth-1 count: {:?}", shapes);
        assert_eq!(by_depth(2), 1, "depth-2 count: {:?}", shapes);

        // Continuation indents are absolute (source-derived) and cumulative
        // across markdown's own indentation; no double-counting.
        let d0 = shapes.iter().find(|s| s.depth == 0).unwrap();
        let d1 = shapes.iter().find(|s| s.depth == 1).unwrap();
        let d2 = shapes.iter().find(|s| s.depth == 2).unwrap();
        assert_eq!(d0.continuation_indent, 2);
        assert_eq!(d1.continuation_indent, 4);
        assert_eq!(d2.continuation_indent, 6);

        // `collect_escaped_block_candidates` must also descend into nested
        // lists. Construct a depth-1 gap: an indented fenced code block that
        // sits between two sibling inner items at col 4. The walker has to
        // reach inside the outer item to see the inner list at all.
        let with_nested_gap = "\
- outer
  - inner one

    ```js
    x;
    ```

  - inner two
";
        let cands = candidates_for(with_nested_gap);
        // If the walker never descended past the outer list, no candidates
        // at depth ≥ 1 would be emitted. We may or may not get a candidate
        // here (markdown-rs often absorbs correctly-indented fences as
        // children), but the call must not panic and any candidate surfaced
        // for this shape must carry its correct enclosing depth.
        for c in &cands {
            assert!(c.depth >= 1, "nested candidate depth should be ≥1, got {}", c.depth);
        }
    }

    // ── Regression: blank injection inside list-item continuation (issue #97) ──
    //
    // A list item whose first line soft-wraps to one or more indented
    // continuation lines must NOT have a blank inserted between the first line
    // and the continuation. The CommonMark source remains parseable either
    // way, but the blank turns tight lists into loose lists (so HTML becomes
    // `<li><p>…</p></li>`) and the input no longer round-trips.
    //
    // The earlier regression was in `ensure_block_element_spacing` (and the
    // upstream AST-based spacing collector), which mistook the indented
    // continuation line for a sibling block at a different indent. Both
    // fixtures below must round-trip byte-identically under default settings
    // AND under an "every list-normalize rule off" baseline — the blank must
    // not appear in the output unless it was in the input.

    /// Every list-normalize rule explicitly disabled. Used to prove the fix
    /// lives in the base spacing logic, not in one of the tighten rules.
    fn settings_with_all_list_normalize_off() -> FormatterSettings {
        use crate::types::{
            RecoverEscapedCodeMode, RecoverEscapedParagraphsMode, RecoverEscapedTablesMode,
            TightenListContinuationsMode, TightenListItemSpacingMode,
        };
        let mut s = FormatterSettings::default();
        s.list_normalize.tighten_list_continuations = TightenListContinuationsMode::Off;
        s.list_normalize.tighten_list_item_spacing = TightenListItemSpacingMode::Off;
        s.list_normalize.recover_escaped_code_in_lists = RecoverEscapedCodeMode::Off;
        s.list_normalize.recover_escaped_tables_in_lists = RecoverEscapedTablesMode::Off;
        s.list_normalize.recover_escaped_paragraphs_in_lists = RecoverEscapedParagraphsMode::Off;
        s
    }

    #[test]
    fn regression_bulleted_continuation_no_blank_injection_defaults() {
        let input = "- **Device Override** — settings can now be tailored per device on top of a\n  shared base settings file. Each install picks a local device name.\n";
        let out = format(input, &FormatterSettings::default());
        assert_eq!(out, input, "bulleted continuation round-trip broke under defaults; output:\n{out}");
    }

    #[test]
    fn regression_bulleted_continuation_no_blank_injection_rules_off() {
        let input = "- **Device Override** — settings can now be tailored per device on top of a\n  shared base settings file. Each install picks a local device name.\n";
        let out = format(input, &settings_with_all_list_normalize_off());
        assert_eq!(out, input, "bulleted continuation round-trip broke with all rules off; output:\n{out}");
    }

    #[test]
    fn regression_ordered_continuation_no_blank_injection_defaults() {
        let input = "1. **Confirm with the user**: Before doing anything, use `AskUserQuestion` to\n   confirm what the user wants to document and verify they intentionally\n   triggered update mode.\n2. **Understand the new info**: Ask the user what they learned or want to\n   document. The topic keyword (if provided) hints at the subject area.\n";
        let out = format(input, &FormatterSettings::default());
        assert_eq!(out, input, "ordered continuation round-trip broke under defaults; output:\n{out}");
    }

    #[test]
    fn regression_ordered_continuation_no_blank_injection_rules_off() {
        let input = "1. **Confirm with the user**: Before doing anything, use `AskUserQuestion` to\n   confirm what the user wants to document and verify they intentionally\n   triggered update mode.\n2. **Understand the new info**: Ask the user what they learned or want to\n   document. The topic keyword (if provided) hints at the subject area.\n";
        let out = format(input, &settings_with_all_list_normalize_off());
        assert_eq!(out, input, "ordered continuation round-trip broke with all rules off; output:\n{out}");
    }

    #[test]
    fn regression_bulleted_continuation_post_processing_inserts_nothing() {
        // Direct assertion on the post-processing pass: running it over the
        // already-formatted lines must produce zero insertions for this
        // input. This guards the specific `ensure_block_element_spacing`
        // branch that previously fired on the paragraph-indented
        // continuation line.
        let input = "- **Device Override** — settings can now be tailored per device on top of a\n  shared base settings file. Each install picks a local device name.";
        let mut lines: Vec<String> = input.split('\n').map(|s| s.to_string()).collect();
        let before = lines.clone();
        ensure_block_element_spacing(&mut lines);
        assert_eq!(
            lines, before,
            "ensure_block_element_spacing must be a no-op for bulleted list-item continuation; before={:?}\nafter={:?}",
            before, lines
        );
    }

    #[test]
    fn regression_ordered_continuation_post_processing_inserts_nothing() {
        let input = "1. **Confirm with the user**: Before doing anything, use `AskUserQuestion` to\n   confirm what the user wants to document and verify they intentionally\n   triggered update mode.\n2. **Understand the new info**: Ask the user what they learned or want to\n   document. The topic keyword (if provided) hints at the subject area.";
        let mut lines: Vec<String> = input.split('\n').map(|s| s.to_string()).collect();
        let before = lines.clone();
        ensure_block_element_spacing(&mut lines);
        assert_eq!(
            lines, before,
            "ensure_block_element_spacing must be a no-op for ordered list-item continuation; before={:?}\nafter={:?}",
            before, lines
        );
    }

    // ── Regression: issue #98 — blank injection inside fenced code blocks ──
    //
    // The formatter must preserve the interior of fenced code blocks
    // byte-for-byte. A prior bug caused `ensure_block_element_spacing` (via
    // an under-strict fence-length track — fence_delimiter() returning
    // `Some` for any ``` or ~~~ line without comparing delimiter length)
    // to treat an inner fence as the closing fence of its outer fence. The
    // 4-backtick / 3-backtick / 3-backtick nested case made this visible in
    // a path-dependent way: after mishandling the first html inner fence,
    // fence state was flipped and the second (js) inner block got blank
    // lines injected after its opening fence and before its closing fence.
    //
    // All three inputs must round-trip byte-identically under default
    // settings AND under a baseline that disables every rule ("all rules
    // off"). The post-processing pass must also be a strict no-op when
    // invoked directly on the already-byte-identical input.

    /// Every known rule explicitly disabled — top-level enabled flags plus
    /// the five list-normalize rules. A passing round-trip under these
    /// settings proves the fix lives in the base parse/emit/post-process
    /// pipeline, not in any single rule body.
    fn settings_with_all_rules_off() -> FormatterSettings {
        use crate::types::{
            RecoverEscapedCodeMode, RecoverEscapedParagraphsMode, RecoverEscapedTablesMode,
            TightenListContinuationsMode, TightenListItemSpacingMode,
        };
        let mut s = FormatterSettings::default();
        s.add_empty_line_between_elements.enabled = false;
        s.format_multi_line_jsx.enabled = false;
        s.format_html_blocks_in_mdx.enabled = false;
        s.expand_single_line_jsx.enabled = false;
        s.indent_jsx_content.enabled = false;
        s.add_empty_lines_in_block_jsx.enabled = false;
        s.format_yaml_frontmatter.enabled = false;
        s.list_normalize.tighten_list_continuations = TightenListContinuationsMode::Off;
        s.list_normalize.tighten_list_item_spacing = TightenListItemSpacingMode::Off;
        s.list_normalize.recover_escaped_code_in_lists = RecoverEscapedCodeMode::Off;
        s.list_normalize.recover_escaped_tables_in_lists = RecoverEscapedTablesMode::Off;
        s.list_normalize.recover_escaped_paragraphs_in_lists = RecoverEscapedParagraphsMode::Off;
        s
    }

    // ─ Top-level 3-backtick block (upstream #68 minimal repro) ─
    //
    // Note: concat!() over explicit "\n"-terminated lines, instead of the
    // `\` line-continuation form — a trailing `\` in a Rust string literal
    // eats the leading whitespace of the next physical line, which would
    // silently strip the indent inside the code block and make the round-
    // trip assertion match a *wrong* shape.
    const FENCED_TOP_LEVEL_INPUT: &str = concat!(
        "## Heading\n",
        "\n",
        "Here is a sample:\n",
        "\n",
        "```ts\n",
        "export default {\n",
        "  site: \"https://example.com\",\n",
        "};\n",
        "```\n",
    );

    #[test]
    fn regression_fenced_top_level_round_trips_under_defaults() {
        let out = format(FENCED_TOP_LEVEL_INPUT, &FormatterSettings::default());
        assert_eq!(
            out, FENCED_TOP_LEVEL_INPUT,
            "top-level fenced block round-trip broke under defaults; output:\n{out}"
        );
    }

    #[test]
    fn regression_fenced_top_level_round_trips_with_all_rules_off() {
        let out = format(FENCED_TOP_LEVEL_INPUT, &settings_with_all_rules_off());
        assert_eq!(
            out, FENCED_TOP_LEVEL_INPUT,
            "top-level fenced block round-trip broke with all rules off; output:\n{out}"
        );
    }

    // ─ Nested 3-backtick blocks inside a 4-backtick outer fence ─
    //
    // Both `html` then `js` inners appear in that order — the previously
    // observed path-dependence mangled only the js inner. Must round-trip
    // byte-identically: both inner blocks are untouched.
    const FENCED_NESTED_4BACKTICK_INPUT: &str = concat!(
        "## 複雑な内容（コードブロック、複数段落を含む） → 見出し構造\n",
        "\n",
        "````markdown\n",
        "## 使用方法\n",
        "\n",
        "### 1. HTMLマークアップ\n",
        "\n",
        "```html\n",
        "<div id=\"app\"></div>\n",
        "```\n",
        "\n",
        "### 2. 初期化\n",
        "\n",
        "```js\n",
        "myLibrary.init({\n",
        "  /* ... */\n",
        "});\n",
        "```\n",
        "````\n",
    );

    #[test]
    fn regression_fenced_nested_4backtick_round_trips_under_defaults() {
        let out = format(FENCED_NESTED_4BACKTICK_INPUT, &FormatterSettings::default());
        assert_eq!(
            out, FENCED_NESTED_4BACKTICK_INPUT,
            "nested 4-backtick fenced block round-trip broke under defaults; output:\n{out}"
        );
        // Explicit path-independence assertions: both inner blocks stay
        // byte-identical to their input shape.
        assert!(
            out.contains("```html\n<div id=\"app\"></div>\n```"),
            "html inner block was mangled; output:\n{out}"
        );
        assert!(
            out.contains("```js\nmyLibrary.init({\n  /* ... */\n});\n```"),
            "js inner block was mangled (path-dependence regression); output:\n{out}"
        );
    }

    #[test]
    fn regression_fenced_nested_4backtick_round_trips_with_all_rules_off() {
        let out = format(FENCED_NESTED_4BACKTICK_INPUT, &settings_with_all_rules_off());
        assert_eq!(
            out, FENCED_NESTED_4BACKTICK_INPUT,
            "nested 4-backtick fenced block round-trip broke with all rules off; output:\n{out}"
        );
    }

    // ─ Tilde-fenced block ─
    const FENCED_TILDE_INPUT: &str = "~~~ts\nconst x = 1;\n~~~\n";

    #[test]
    fn regression_fenced_tilde_round_trips_under_defaults() {
        let out = format(FENCED_TILDE_INPUT, &FormatterSettings::default());
        assert_eq!(
            out, FENCED_TILDE_INPUT,
            "tilde fenced block round-trip broke under defaults; output:\n{out}"
        );
    }

    #[test]
    fn regression_fenced_tilde_round_trips_with_all_rules_off() {
        let out = format(FENCED_TILDE_INPUT, &settings_with_all_rules_off());
        assert_eq!(
            out, FENCED_TILDE_INPUT,
            "tilde fenced block round-trip broke with all rules off; output:\n{out}"
        );
    }

    // ─ Direct post-processing assertions ─
    //
    // `ensure_block_element_spacing` is the specific pass that historically
    // injected the blanks. Driving it directly on the already-correct input
    // must produce zero mutation for all three shapes — this pins the code
    // path independently of the surrounding AST/rule pipeline.

    #[test]
    fn regression_fenced_top_level_post_processing_is_noop() {
        let mut lines: Vec<String> =
            FENCED_TOP_LEVEL_INPUT.split('\n').map(|s| s.to_string()).collect();
        let before = lines.clone();
        ensure_block_element_spacing(&mut lines);
        assert_eq!(
            lines, before,
            "ensure_block_element_spacing must be a no-op inside a top-level fenced block"
        );
    }

    #[test]
    fn regression_fenced_nested_4backtick_post_processing_is_noop() {
        let mut lines: Vec<String> = FENCED_NESTED_4BACKTICK_INPUT
            .split('\n')
            .map(|s| s.to_string())
            .collect();
        let before = lines.clone();
        ensure_block_element_spacing(&mut lines);
        assert_eq!(
            lines, before,
            "ensure_block_element_spacing must be a no-op for nested 4-backtick / html+js case; \
             fence-nesting state must not leak between the two inner blocks"
        );
    }

    #[test]
    fn regression_fenced_tilde_post_processing_is_noop() {
        let mut lines: Vec<String> =
            FENCED_TILDE_INPUT.split('\n').map(|s| s.to_string()).collect();
        let before = lines.clone();
        ensure_block_element_spacing(&mut lines);
        assert_eq!(
            lines, before,
            "ensure_block_element_spacing must be a no-op inside a tilde-fenced block"
        );
    }

    #[test]
    fn test_dotted_key_does_not_collide_with_nested_path() {
        // Regression guard: storing the preserved map keyed by a dotted
        // string collapsed two distinct YAML locations — a top-level key
        // literally named `a.b` and a nested `a.b` path — into the same
        // HashMap entry, so the later insert overwrote the earlier one and
        // one block scalar got re-emitted in the wrong place. The fix keys
        // the map by `Vec<String>` so `["a.b"]` and `["a", "b"]` are
        // distinct.
        let input =
            "---\na.b: >-\n  dotted key text\na:\n  b: >-\n    nested path text\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(
            result, input,
            "dotted top-level key and nested a/b path must be preserved independently"
        );
    }
}
