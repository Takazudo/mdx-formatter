use regex::Regex;
use std::sync::LazyLock;

/// Void HTML elements that never have a closing tag.
const VOID_ELEMENTS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
    "source", "track", "wbr",
];

/// Regex to match an opening HTML tag at the start of a trimmed line.
/// Captures: (1) tag name, (2) rest including attributes and closing bracket.
static OPENING_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>").unwrap());

/// Regex to match a closing HTML tag at the start of a trimmed line.
/// Captures: (1) tag name.
static CLOSING_TAG_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^</([a-zA-Z][a-zA-Z0-9]*)>").unwrap());

/// Regex to match a self-closing tag (e.g. `<br />`, `<img ... />`).
static SELF_CLOSING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?\s*/>").unwrap());

/// Regex to collapse whitespace inside `<dt>...</dt>` tags (single-line after collapse).
/// Only matches dt tags whose content has no nested HTML tags (no `<` in content).
static DT_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<dt>([^<]*)</dt>").unwrap());

/// Regex to collapse whitespace inside `<dd>...</dd>` tags (single-line after collapse).
/// Only matches dd tags whose content has no nested HTML tags (no `<` in content).
static DD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<dd>([^<]*)</dd>").unwrap());

/// Check if a tag name is a void element.
fn is_void_element(tag: &str) -> bool {
    VOID_ELEMENTS.contains(&tag.to_ascii_lowercase().as_str())
}

/// Format an HTML block with proper indentation.
///
/// Algorithm:
/// 1. Pre-process: collapse whitespace inside `<dt>` and `<dd>` tags.
/// 2. Split into lines, trim each.
/// 3. For each line, detect tags and adjust indent depth.
/// 4. Reconstruct with proper indentation.
pub fn format_html_block(html: &str, indent_size: usize) -> String {
    // Guard: skip formatting if input contains multi-line tags (opening tag
    // split across lines). The line-based formatter can't handle these correctly.
    if has_multiline_tags(html) {
        return html.to_string();
    }

    // Step 1: Pre-process dt/dd — collapse internal whitespace to single-line
    let preprocessed = preprocess_dt_dd(html);

    // Step 2: Split into lines and trim
    let raw_lines: Vec<&str> = preprocessed.split('\n').collect();

    // Step 3: Re-indent based on tag nesting
    let mut result_lines: Vec<String> = Vec::new();
    let mut depth: i32 = 0;

    for raw_line in &raw_lines {
        let trimmed = raw_line.trim();
        if trimmed.is_empty() {
            result_lines.push(String::new());
            continue;
        }

        // Calculate depth adjustments for this line
        let (depth_before, depth_after) = compute_depth_changes(trimmed);

        // Apply "before" adjustment (closing tags reduce depth before indenting)
        depth += depth_before;
        if depth < 0 {
            depth = 0;
        }

        // Build indented line
        let indent = " ".repeat((depth as usize) * indent_size);
        result_lines.push(format!("{}{}", indent, trimmed));

        // Apply "after" adjustment (opening tags increase depth after this line)
        depth += depth_after;
        if depth < 0 {
            depth = 0;
        }
    }

    // Step 4: Post-process — trim content inside dt/dd tags
    let result = result_lines.join("\n");
    postprocess_dt_dd(&result)
}

/// Check if the HTML contains multi-line tags (opening tag where `<tagname`
/// appears on one line but the closing `>` is on a subsequent line).
fn has_multiline_tags(html: &str) -> bool {
    for line in html.split('\n') {
        let trimmed = line.trim();
        // Check if line starts with `<tagname` but doesn't contain `>` (split tag)
        if let Some(m) = OPENING_TAG_START_RE.find(trimmed) {
            // If we matched `<tagname` at position 0, check if there's a `>` on this line
            let after_tag = &trimmed[m.end()..];
            if !after_tag.contains('>') {
                return true;
            }
        }
    }
    false
}

/// Regex to detect start of an opening tag (no closing bracket required).
static OPENING_TAG_START_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^<[a-zA-Z][a-zA-Z0-9]*").unwrap());

/// Regex for post-processing dt/dd whitespace trimming.
static POSTPROCESS_DT_DD_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"<(dt|dd)>\s*(.*?)\s*</(dt|dd)>").unwrap());

/// Regex for collapsing whitespace.
static WHITESPACE_RE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\s+").unwrap());

/// Pre-process: collapse whitespace inside `<dt>` and `<dd>` tags so their
/// content becomes a single line. This matches the TS formatter behavior.
fn preprocess_dt_dd(html: &str) -> String {
    let result = DT_RE.replace_all(html, |caps: &regex::Captures| {
        let content = &caps[1];
        let cleaned = collapse_whitespace(content);
        format!("<dt>{}</dt>", cleaned)
    });
    let result = DD_RE.replace_all(&result, |caps: &regex::Captures| {
        let content = &caps[1];
        let cleaned = collapse_whitespace(content);
        format!("<dd>{}</dd>", cleaned)
    });
    result.into_owned()
}

/// Post-process: trim whitespace inside dt/dd tags.
fn postprocess_dt_dd(html: &str) -> String {
    POSTPROCESS_DT_DD_RE
        .replace_all(html, "<$1>$2</$3>")
        .into_owned()
}

/// Collapse multiple whitespace characters (including newlines) into a single space, then trim.
fn collapse_whitespace(s: &str) -> String {
    WHITESPACE_RE.replace_all(s, " ").trim().to_string()
}

/// Compute depth changes for a single line.
///
/// Returns `(depth_before, depth_after)`:
/// - `depth_before`: adjustment to apply BEFORE indenting this line
///   (negative for closing tags at line start that reduce this line's indent)
/// - `depth_after`: adjustment to apply AFTER indenting this line
///   (positive for opening tags that increase indent for subsequent lines)
///
/// Uses a sequential scan: tracks a running `delta` through all tags.
/// The minimum delta seen determines how much to un-indent this line (`before`).
/// The remaining net change applies to subsequent lines (`after`).
fn compute_depth_changes(line: &str) -> (i32, i32) {
    let mut delta: i32 = 0;
    let mut min_delta: i32 = 0;
    let mut pos = 0;
    let bytes = line.as_bytes();

    while pos < bytes.len() {
        if bytes[pos] != b'<' {
            pos += 1;
            continue;
        }

        let remaining = &line[pos..];

        // Try self-closing tag first (e.g., <br />, <img ... />)
        if let Some(m) = SELF_CLOSING_RE.find(remaining) {
            pos += m.end();
            continue;
        }

        // Try closing tag (e.g., </div>)
        if let Some(caps) = CLOSING_TAG_RE.captures(remaining) {
            delta -= 1;
            if delta < min_delta {
                min_delta = delta;
            }
            pos += caps[0].len();
            continue;
        }

        // Try opening tag (e.g., <div>, <table class="...">)
        if let Some(caps) = OPENING_TAG_RE.captures(remaining) {
            let tag = &caps[1];
            if !is_void_element(tag) {
                delta += 1;
            }
            pos += caps[0].len();
            continue;
        }

        pos += 1;
    }

    // min_delta: the lowest point reached by closing tags (≤ 0)
    //   → this is how much to reduce indent BEFORE this line
    // delta - min_delta: remaining net increase from opening tags
    //   → this increases indent AFTER this line
    (min_delta, delta - min_delta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_dl() {
        let input = "<dl>\n<dt>Term 1</dt>\n<dd>Definition 1</dd>\n</dl>";
        let expected = "<dl>\n  <dt>Term 1</dt>\n  <dd>Definition 1</dd>\n</dl>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_dl_with_excessive_whitespace() {
        let input = "<dl>\n  <dt>  Term with spaces  </dt>\n  <dd>   Definition with spaces   </dd>\n</dl>";
        let expected = "<dl>\n  <dt>Term with spaces</dt>\n  <dd>Definition with spaces</dd>\n</dl>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_dl_with_div_wrappers() {
        let input = "<dl>\n<div>\n<dt>Term 1</dt>\n<dd>Definition 1</dd>\n</div>\n<div>\n<dt>Term 2</dt>\n<dd>Definition 2</dd>\n</div>\n</dl>";
        let expected = "<dl>\n  <div>\n    <dt>Term 1</dt>\n    <dd>Definition 1</dd>\n  </div>\n  <div>\n    <dt>Term 2</dt>\n    <dd>Definition 2</dd>\n  </div>\n</dl>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_nested_definition_lists() {
        let input = "<dl>\n<dt>Outer Term</dt>\n<dd>\n<dl>\n<dt>Inner Term</dt>\n<dd>Inner Definition</dd>\n</dl>\n</dd>\n</dl>";
        let expected = "<dl>\n  <dt>Outer Term</dt>\n  <dd>\n    <dl>\n      <dt>Inner Term</dt>\n      <dd>Inner Definition</dd>\n    </dl>\n  </dd>\n</dl>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_simple_table() {
        let input = "<table>\n<tr>\n<td>Cell 1</td>\n<td>Cell 2</td>\n</tr>\n<tr>\n<td>Cell 3</td>\n<td>Cell 4</td>\n</tr>\n</table>";
        let expected = "<table>\n  <tr>\n    <td>Cell 1</td>\n    <td>Cell 2</td>\n  </tr>\n  <tr>\n    <td>Cell 3</td>\n    <td>Cell 4</td>\n  </tr>\n</table>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_table_with_thead_tbody() {
        let input = "<table>\n<thead>\n<tr>\n<th>Header 1</th>\n<th>Header 2</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Data 1</td>\n<td>Data 2</td>\n</tr>\n</tbody>\n</table>";
        let expected = "<table>\n  <thead>\n    <tr>\n      <th>Header 1</th>\n      <th>Header 2</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td>Data 1</td>\n      <td>Data 2</td>\n    </tr>\n  </tbody>\n</table>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_table_with_attributes() {
        let input = "<table class=\"data-table\" id=\"results\">\n<tr class=\"row-highlight\">\n<td colspan=\"2\">Merged Cell</td>\n</tr>\n</table>";
        let expected = "<table class=\"data-table\" id=\"results\">\n  <tr class=\"row-highlight\">\n    <td colspan=\"2\">Merged Cell</td>\n  </tr>\n</table>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_unordered_list() {
        let input = "<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n<li>Item 3</li>\n</ul>";
        let expected = "<ul>\n  <li>Item 1</li>\n  <li>Item 2</li>\n  <li>Item 3</li>\n</ul>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_ordered_list() {
        let input = "<ol>\n<li>First</li>\n<li>Second</li>\n<li>Third</li>\n</ol>";
        let expected = "<ol>\n  <li>First</li>\n  <li>Second</li>\n  <li>Third</li>\n</ol>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_nested_divs() {
        let input = "<div class=\"container\">\n<div class=\"row\">\n<div class=\"col\">Content</div>\n</div>\n</div>";
        let expected = "<div class=\"container\">\n  <div class=\"row\">\n    <div class=\"col\">Content</div>\n  </div>\n</div>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_div_with_mixed_content() {
        let input = "<div>\n<h3>Title</h3>\n<p>Paragraph text here.</p>\n<ul>\n<li>List item</li>\n</ul>\n</div>";
        let expected = "<div>\n  <h3>Title</h3>\n  <p>Paragraph text here.</p>\n  <ul>\n    <li>List item</li>\n  </ul>\n</div>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_select_options() {
        let input = "<select name=\"choice\">\n<option value=\"1\">Option 1</option>\n<option value=\"2\">Option 2</option>\n<option value=\"3\">Option 3</option>\n</select>";
        let expected = "<select name=\"choice\">\n  <option value=\"1\">Option 1</option>\n  <option value=\"2\">Option 2</option>\n  <option value=\"3\">Option 3</option>\n</select>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_empty_elements() {
        // Single-line empty elements should remain unchanged
        let input = "<div></div>";
        let expected = "<div></div>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_self_closing_void_elements() {
        let input = "<div>\n<img src=\"image.jpg\" alt=\"Test\" />\n<br />\n<hr />\n</div>";
        let expected = "<div>\n  <img src=\"image.jpg\" alt=\"Test\" />\n  <br />\n  <hr />\n</div>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_deeply_nested() {
        let input = "<div>\n<section>\n<article>\n<header>\n<h1>Title</h1>\n</header>\n<main>\n<p>Content</p>\n</main>\n<footer>\n<p>Footer</p>\n</footer>\n</article>\n</section>\n</div>";
        let expected = "<div>\n  <section>\n    <article>\n      <header>\n        <h1>Title</h1>\n      </header>\n      <main>\n        <p>Content</p>\n      </main>\n      <footer>\n        <p>Footer</p>\n      </footer>\n    </article>\n  </section>\n</div>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_long_attributes_no_wrapping() {
        let input = "<div class=\"very-long-class-name\" id=\"very-long-id\" data-attribute=\"very-long-value\">\n<p>Content</p>\n</div>";
        let expected = "<div class=\"very-long-class-name\" id=\"very-long-id\" data-attribute=\"very-long-value\">\n  <p>Content</p>\n</div>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_already_formatted() {
        // Input that's already properly indented should not change
        let input = "<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>";
        let expected = "<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_dt_dd_multiline_collapse() {
        // Multi-line dt/dd content should be collapsed to single line
        let input = "<dl>\n<dt>\n  Term across\n  multiple lines\n</dt>\n<dd>\n  Definition across\n  lines\n</dd>\n</dl>";
        let expected = "<dl>\n  <dt>Term across multiple lines</dt>\n  <dd>Definition across lines</dd>\n</dl>";
        assert_eq!(format_html_block(input, 2), expected);
    }

    #[test]
    fn test_inline_span_elements() {
        let input = "<div>\n<span class=\"highlight\">Important</span> text with <span>inline</span> elements.\n</div>";
        let result = format_html_block(input, 2);
        assert!(result.contains("Important"));
        assert!(result.contains("inline"));
    }

    #[test]
    fn test_div_with_markdown_content() {
        let input = "<div>\n**Bold text** and *italic text* within HTML.\n[Link](https://example.com) in a div.\n</div>";
        let result = format_html_block(input, 2);
        assert!(result.contains("Bold text"));
        assert!(result.contains("italic text"));
        assert!(result.contains("https://example.com"));
    }
}
