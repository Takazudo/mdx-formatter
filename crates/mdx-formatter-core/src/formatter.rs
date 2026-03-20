use crate::parser;
use crate::types::{FormatterOperation, FormatterSettings, FormatYamlFrontmatterSetting};
use markdown::mdast::Node;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

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
/// Adds empty lines after headings when the next line is non-empty content
/// (not another heading). Also handles spacing after JSX flow elements.
fn collect_spacing_operations(
    node: &Node,
    lines: &[&str],
    operations: &mut Vec<FormatterOperation>,
) {
    match node {
        Node::Root(root) => {
            for child in &root.children {
                // Check for spacing needed after this child
                if let Some(pos) = child.position() {
                    let end_line = pos.end.line - 1; // 0-indexed

                    if end_line < lines.len() - 1 {
                        let next_line = lines[end_line + 1];

                        match child {
                            Node::Heading(_) => {
                                // After heading: insert empty line if next is non-empty, non-heading
                                if !next_line.trim().is_empty()
                                    && !next_line.starts_with('#')
                                {
                                    operations.push(FormatterOperation::InsertLine {
                                        start_line: end_line + 1,
                                        content: String::new(),
                                    });
                                }
                            }
                            Node::MdxJsxFlowElement(_) => {
                                // After JSX: insert empty line if next is non-empty text
                                // Skip if next line is inside a table row
                                if let Some(current_line) = lines.get(end_line) {
                                    if current_line.trim().starts_with('|') {
                                        // Skip JSX inside table rows
                                    } else if !next_line.trim().is_empty()
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
                            _ => {}
                        }
                    }

                }

                // Recurse into children
                collect_spacing_operations(child, lines, operations);
            }
        }
        // Recurse into nodes that have children
        Node::Heading(heading) => {
            for child in &heading.children {
                collect_spacing_operations(child, lines, operations);
            }
        }
        Node::Paragraph(para) => {
            for child in &para.children {
                collect_spacing_operations(child, lines, operations);
            }
        }
        Node::List(list) => {
            for child in &list.children {
                collect_spacing_operations(child, lines, operations);
            }
        }
        Node::ListItem(item) => {
            for child in &item.children {
                collect_spacing_operations(child, lines, operations);
            }
        }
        Node::Blockquote(bq) => {
            for child in &bq.children {
                collect_spacing_operations(child, lines, operations);
            }
        }
        Node::MdxJsxFlowElement(jsx) => {
            for child in &jsx.children {
                collect_spacing_operations(child, lines, operations);
            }
        }
        _ => {}
    }
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
        // Invalid YAML should be left unchanged
        let input = "---\n: invalid yaml [[\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, input, "Invalid YAML should be left unchanged");
    }

    #[test]
    fn test_yaml_fix_unsafe_values_disabled() {
        let mut settings = FormatterSettings::default();
        settings.format_yaml_frontmatter.fix_unsafe_values = false;
        // Without fix_unsafe_values, the colon in the value causes a parse error,
        // so the frontmatter should be left unchanged
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
        // Strings that don't need quoting have quotes removed (normalized)
        let input = "---\ntitle: \"Already quoted\"\n---\n\n# Content";
        let expected = "---\ntitle: Already quoted\n---\n\n# Content";
        let result = format(input, &FormatterSettings::default());
        assert_eq!(result, expected, "Unnecessary quotes should be removed");
    }

    #[test]
    fn test_yaml_necessary_quotes_kept() {
        // Strings that need quoting should keep their quotes
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
        // Other settings should retain defaults
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
}
