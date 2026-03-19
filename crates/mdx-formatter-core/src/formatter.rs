use crate::parser;
use crate::types::{FormatterOperation, FormatterSettings};
use markdown::mdast::Node;
use regex::Regex;
use std::collections::HashSet;
use std::sync::LazyLock;

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
}
