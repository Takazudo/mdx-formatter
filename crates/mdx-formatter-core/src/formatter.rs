use crate::parser;
use crate::types::{FormatterOperation, FormatterSettings, FormatYamlFrontmatterSetting};
use markdown::mdast::{
    AttributeContent, AttributeValue, Node,
};
use regex::Regex;
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
// PARTIALLY COVERED by existing spacing rule:
//   - fix-paragraph-spacing.ts — Heading/JSX spacing handled; collapsed JSX
//     artifact doesn't occur; import/export spacing may need future work.
//
// See tests/plugin_validation.rs for test cases validating each finding.

// Regex for preprocessing YAML: matches `key: value` lines
static YAML_MAPPING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^(\s*)([\w][\w.-]*):\s+(.+)$").unwrap());

// Regex for block scalar indicators (>, |, >-, |-, >+, |+)
static BLOCK_SCALAR_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[|>][-+]?$").unwrap());

// Regex for values that start with special YAML chars
static SPECIAL_START_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^[!&*%@`]").unwrap());

// Compile once at startup, not on every format call
static MULTIPLE_NEWLINES_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\n{3,}").unwrap());

/// Format markdown/MDX content using the hybrid AST + line-based approach.
///
/// Runs the formatter in a convergence loop (up to 3 iterations) until
/// the output stabilizes, ensuring idempotency.
pub fn format(content: &str, settings: &FormatterSettings) -> String {
    let mut result = content.to_string();
    const MAX_ITERATIONS: usize = 3;

    for _ in 0..MAX_ITERATIONS {
        let formatted = format_once(&result, settings);
        if formatted == result {
            break;
        }
        result = formatted;
    }
    result
}

/// Single formatting pass: parse AST, collect operations, apply them.
fn format_once(content: &str, settings: &FormatterSettings) -> String {
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

    // 8. Join and normalize multiple empty lines
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
            && block_components.contains(&name.to_string());

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
                settings.indent_jsx_content.enabled && container_components.contains(&name.to_string());

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
/// For each list item, compares actual indentation against expected
/// (nesting_level * 2 spaces) and emits FixListIndent if different.
fn collect_list_indentation_operations(
    node: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
) {
    // Collect nesting levels for all list items
    let mut nesting_levels: Vec<(usize, usize)> = Vec::new(); // (line_0indexed, expected_indent)
    collect_list_nesting(node, 0, &mut nesting_levels);

    // Emit fix operations
    for (line_idx, expected_indent) in nesting_levels {
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

/// Recursively walk lists, tracking nesting level, collecting (line, indent) pairs.
fn collect_list_nesting(
    node: &Node,
    nesting_level: usize,
    result: &mut Vec<(usize, usize)>,
) {
    match node {
        Node::Root(root) => {
            for child in &root.children {
                collect_list_nesting(child, 0, result);
            }
        }
        Node::List(list) => {
            for child in &list.children {
                if let Node::ListItem(item) = child {
                    if let Some(pos) = &item.position {
                        let line_idx = pos.start.line - 1; // 0-indexed
                        let expected_indent = nesting_level * 2;
                        result.push((line_idx, expected_indent));
                    }
                    // Recurse into list item children looking for nested lists
                    for sub_child in &item.children {
                        if matches!(sub_child, Node::List(_)) {
                            collect_list_nesting(sub_child, nesting_level + 1, result);
                        } else {
                            // Look deeper (e.g. paragraph inside list item may contain a list)
                            collect_list_nesting(sub_child, nesting_level, result);
                        }
                    }
                }
            }
        }
        Node::Blockquote(bq) => {
            for child in &bq.children {
                collect_list_nesting(child, nesting_level, result);
            }
        }
        Node::ListItem(item) => {
            for child in &item.children {
                collect_list_nesting(child, nesting_level, result);
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

fn is_numbered_list_line(line: &str) -> bool {
    let trimmed = line.trim();
    is_ordered_list_marker(trimmed)
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
                    let clean = emit_yaml(&parsed, settings, 0);

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
fn emit_yaml(value: &serde_yaml::Value, settings: &FormatYamlFrontmatterSetting, indent_level: usize) -> String {
    match value {
        serde_yaml::Value::Mapping(map) => {
            emit_yaml_mapping(map, settings, indent_level)
        }
        _ => emit_yaml_scalar(value, settings),
    }
}

/// Emit a YAML mapping (key-value pairs) with proper indentation.
fn emit_yaml_mapping(
    map: &serde_yaml::Mapping,
    settings: &FormatYamlFrontmatterSetting,
    indent_level: usize,
) -> String {
    let indent_str = " ".repeat(indent_level * settings.indent);
    let mut lines: Vec<String> = Vec::new();

    for (key, value) in map {
        let key_str = match key {
            serde_yaml::Value::String(s) => s.clone(),
            other => emit_yaml_scalar(other, settings),
        };

        match value {
            serde_yaml::Value::Mapping(nested_map) => {
                lines.push(format!("{}{}:", indent_str, key_str));
                let nested = emit_yaml_mapping(nested_map, settings, indent_level + 1);
                lines.push(nested);
            }
            serde_yaml::Value::Sequence(seq) => {
                lines.push(format!("{}{}:", indent_str, key_str));
                let child_indent = " ".repeat((indent_level + 1) * settings.indent);
                for item in seq {
                    match item {
                        serde_yaml::Value::Mapping(item_map) => {
                            // Sequence of mappings: first key on same line as `-`
                            let nested = emit_yaml_mapping(item_map, settings, indent_level + 2);
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
fn filter_overlapping_replacements(operations: &mut Vec<FormatterOperation>) {
    // Collect replacement ranges
    let replace_ranges: Vec<(usize, usize, usize)> = operations
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

    let mut to_remove: HashSet<usize> = HashSet::new();

    for &(inner_idx, inner_start, inner_end) in &replace_ranges {
        for &(outer_idx, outer_start, outer_end) in &replace_ranges {
            if inner_idx == outer_idx {
                continue;
            }
            // Inner is strictly contained in outer
            if inner_start >= outer_start
                && inner_end <= outer_end
                && (inner_start != outer_start || inner_end != outer_end)
            {
                to_remove.insert(inner_idx);
                break;
            }
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

/// Normalize consecutive empty lines to at most one empty line.
fn normalize_empty_lines(content: &str) -> String {
    MULTIPLE_NEWLINES_RE.replace_all(content, "\n\n").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

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
        // Note: The Rust formatter currently only adds spacing after headings,
        // not between paragraphs and headings (that's a separate rule in TS).
        let input = "# First\nContent\n## Second\nMore content";
        let expected = "# First\n\nContent\n## Second\n\nMore content";
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
}
