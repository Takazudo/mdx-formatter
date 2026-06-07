//! Cross-platform validation tests
//! Ported from the TypeScript test suite to ensure the Rust formatter
//! produces identical output to the TypeScript implementation.
//!
//! Tests marked with "PARTIAL:" indicate that the Rust formatter
//! only partially handles the case (missing rule implementation).
//! Tests marked with "TODO:" indicate tests that will pass once
//! the corresponding rule is implemented in Rust.
//!
//! Current Rust formatter capabilities:
//! - Spacing rule (empty lines after headings and JSX at root level)
//! - JSX multi-line formatting (attribute indentation, self-closing fix, block JSX empty lines)
//! - YAML frontmatter formatting (parse, reformat, unsafe value quoting)
//! - List indentation normalization
//! - HTML block formatting (indentation of HTML elements in MDX)
//! - Convergence loop (max 3 iterations)
//! - Empty line normalization (collapse 3+ newlines to 2)

use mdx_formatter_core::format;
use mdx_formatter_core::types::FormatterSettings;

// ============================================================================
// Helper functions
// ============================================================================

fn default_settings() -> FormatterSettings {
    FormatterSettings::default()
}

fn settings_with_block_components() -> FormatterSettings {
    let mut settings = FormatterSettings::default();
    settings.add_empty_lines_in_block_jsx.block_components = vec![
        "InfoBox".to_string(),
        "Outro".to_string(),
        "Note".to_string(),
        "Warning".to_string(),
    ];
    settings
}

fn settings_with_spacing_disabled() -> FormatterSettings {
    let mut settings = FormatterSettings::default();
    settings.add_empty_line_between_elements.enabled = false;
    settings
}

/// The exact workaround config from issue #109: skip the affected component,
/// disable HTML-block formatting and single-line JSX expansion. Pinned so the
/// documented escape hatch keeps working after the real fix.
fn settings_issue_109_workaround() -> FormatterSettings {
    let mut settings = FormatterSettings::default();
    settings.format_multi_line_jsx.ignore_components = vec!["Demo".to_string()];
    settings.format_multi_line_jsx.preserve_template_literal_indent = true;
    settings.format_html_blocks_in_mdx.enabled = false;
    settings.expand_single_line_jsx.enabled = false;
    settings
}

// ============================================================================
// 1. Basic Markdown Formatting (from formatter.test.ts)
// ============================================================================

#[test]
fn heading_spacing_adds_empty_line() {
    let input = "# Heading\nContent";
    let expected = "# Heading\n\nContent";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn heading_spacing_already_correct() {
    let input = "# Heading\n\nContent";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn multiple_headings_with_content() {
    let input = "# First\nContent\n## Second\nMore content";
    let expected = "# First\n\nContent\n\n## Second\n\nMore content";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn code_block_preserved() {
    let input = "```js\nconst x = 1;\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn frontmatter_preserved() {
    let input = "---\ntitle: Test\n---\n\n# Content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn empty_input_handled() {
    let input = "";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn heading_levels_1_through_6() {
    // All 6 ATX heading levels — no content follows so no empty lines inserted
    let input = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "All heading levels should be preserved");
}

#[test]
fn heading_level_1_with_content() {
    let input = "# Title\nParagraph";
    let expected = "# Title\n\nParagraph";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn heading_level_3_with_content() {
    let input = "### Section\nParagraph text here";
    let expected = "### Section\n\nParagraph text here";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn heading_level_6_with_content() {
    let input = "###### Deep Heading\nSome text";
    let expected = "###### Deep Heading\n\nSome text";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn heading_followed_by_heading_no_extra_spacing() {
    // The Rust formatter checks "next line doesn't start with #" so heading→heading stays unchanged
    let input = "# First\n## Second";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn disabled_spacing_rule_no_modification() {
    let input = "# Heading\nContent";
    let result = format(input, &settings_with_spacing_disabled());
    assert_eq!(result, input, "Disabled rule should not modify content");
}

#[test]
fn normalize_multiple_empty_lines() {
    let input = "# Heading\n\n\n\nContent";
    let expected = "# Heading\n\nContent";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn normalize_four_empty_lines() {
    let input = "Paragraph 1\n\n\n\n\nParagraph 2";
    let expected = "Paragraph 1\n\nParagraph 2";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

// ============================================================================
// 2. List Indentation (from formatter.test.ts)
// ============================================================================

#[test]
fn list_basic_no_change() {
    let input = "- item 1\n- item 2\n- item 3";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn list_remove_leading_spaces() {
    let input = "  - First item\n  - Second item\n  - Third item";
    let expected = "- First item\n- Second item\n- Third item";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn list_nested_indentation_normalized() {
    let input = "- item 1\n    - nested item";
    let expected = "- item 1\n  - nested item";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn list_nested_indentation_from_wrong_top_level() {
    let input = "  - Parent item\n    - Nested item 1\n    - Nested item 2\n  - Another parent";
    let expected = "- Parent item\n  - Nested item 1\n  - Nested item 2\n- Another parent";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn numbered_list_without_leading_spaces() {
    let input = "  1. First item\n  2. Second item\n  3. Third item";
    let expected = "1. First item\n2. Second item\n3. Third item";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn mixed_content_with_lists() {
    let input = "Here is a paragraph.\n\n  - List item 1\n  - List item 2\n\nAnother paragraph.";
    let expected = "Here is a paragraph.\n\n- List item 1\n- List item 2\n\nAnother paragraph.";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn list_with_star_marker() {
    let input = "  * Item 1\n  * Item 2";
    let expected = "* Item 1\n* Item 2";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn list_with_plus_marker() {
    let input = "  + Item 1\n  + Item 2";
    let expected = "+ Item 1\n+ Item 2";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn task_list_preserved() {
    let input = "- [x] Done\n- [ ] Todo";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 3. Idempotency (from idempotency.test.ts)
// ============================================================================

#[test]
fn idempotency_already_formatted() {
    let input = "# Heading\n\nSome content\n\n## Another\n\nMore content";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Formatter should be idempotent");
}

#[test]
fn idempotency_after_fix() {
    let input = "# Heading\nContent\n## Another\nMore content";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(
        first, second,
        "Formatter should be idempotent after fixing"
    );
}

#[test]
fn idempotency_simple_content() {
    let input = "Just a simple paragraph.";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

#[test]
fn idempotency_complex_document() {
    let input = "---\ntitle: Test\n---\n\n# Heading\n\nParagraph\n\n- List 1\n- List 2\n\n## Sub heading\n\nMore text\n\n```js\ncode();\n```\n\nFinal paragraph.";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Complex document should be idempotent");
}

#[test]
fn idempotency_heading_fix_then_stable() {
    let input = "# H1\nText\n## H2\nMore text\n### H3\nEven more";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

#[test]
fn idempotency_list_indent_fix_then_stable() {
    let input = "  - item 1\n    - nested\n  - item 2";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

#[test]
fn idempotency_empty_line_normalization() {
    let input = "# Heading\n\n\n\n\nContent\n\n\n\nMore";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

#[test]
fn idempotency_jsx_and_text() {
    let input = "<Component />\n\nSome text\n\n<AnotherComponent />";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

#[test]
fn idempotency_frontmatter_and_content() {
    let input = "---\ntitle: Test\n---\n# Heading\nContent";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

// ============================================================================
// 4. MDX/JSX Preservation (from formatter.test.ts)
// ============================================================================

#[test]
fn jsx_self_closing_preserved() {
    let input = "<Youtube url=\"https://example.com\" />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ── issue #109 / #112: self-closing JSX with template-literal props ──
//
// A self-closing component whose multi-line template-literal prop contains
// braces / markup was corrupted by --write (`/>` → `>`, prop block duplicated,
// stray `</Name>` appended → invalid MDX). These pin the fix and its controls.

/// (a) The exact #109 repro round-trips byte-identical under default settings.
#[test]
fn issue_109_full_repro_roundtrips() {
    let input = "# Title\n\n<Demo\n  html={`    <div class=\"box\">\n      <pre><code>{\".box { color: red; }\"}</code></pre>\n    </div>`}\n  css={`    .box { color: red; }\n  `}\n/>\n\nDone.\n";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "#109 repro must round-trip byte-identical");
}

/// (a') Same repro under the documented #109 workaround config must also be
/// untouched (the escape hatch keeps working).
#[test]
fn issue_109_full_repro_roundtrips_with_workaround() {
    let input = "# Title\n\n<Demo\n  html={`    <div class=\"box\">\n      <pre><code>{\".box { color: red; }\"}</code></pre>\n    </div>`}\n  css={`    .box { color: red; }\n  `}\n/>\n\nDone.\n";
    let result = format(input, &settings_issue_109_workaround());
    assert_eq!(result, input, "#109 workaround config must leave the file untouched");
}

/// (b) Minimal repro: self-closing component, template-literal prop with an
/// inner expression, plus a trailing single-line attr. The template-literal
/// prop forces multi-line; the LAST attr is single-line so `/>` collapses onto
/// it (matches existing `preserve_jsx_multi_line` behavior). Must not corrupt.
#[test]
fn issue_109_minimal_repro_no_corruption() {
    let input = "<Demo\n  html={`<span>{x}</span>`}\n  foo=\"bar\"\n/>\n";
    let expected = "<Demo\n  html={`<span>{x}</span>`}\n  foo=\"bar\" />\n";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
    // Idempotent on the formatted form.
    let twice = format(&result, &default_settings());
    assert_eq!(twice, result);
}

/// (c) Idempotency: format(format(x)) == format(x) for the full repro.
#[test]
fn issue_109_idempotent() {
    let input = "# Title\n\n<Demo\n  html={`    <div class=\"box\">\n      <pre><code>{\".box { color: red; }\"}</code></pre>\n    </div>`}\n  css={`    .box { color: red; }\n  `}\n/>\n\nDone.\n";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second);
}

/// (d) Control cases that must NOT change behavior — no silent collapse of a
/// paired element into self-closing.
#[test]
fn issue_109_control_paired_with_expression_child() {
    // <Foo>{children}</Foo> — paired with an expression child, stays paired.
    let input = "<Foo>{children}</Foo>";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn issue_109_control_empty_paired_not_collapsed() {
    // <Demo></Demo> — empty paired element must NOT become <Demo />.
    let input = "<Demo></Demo>";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "empty paired element must not collapse to self-closing");
}

#[test]
fn issue_109_control_whitespace_only_paired_not_collapsed() {
    // <Demo>\n</Demo> — whitespace-only body stays paired.
    let input = "<Demo>\n</Demo>";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "whitespace-only paired element must stay paired");
}

/// (e) Works-today control: self-closing component with a multi-line
/// template-literal prop containing NO inner braces. Round-trips unchanged;
/// pinned so the scanners cannot widen their match and regress it.
#[test]
fn issue_109_control_brace_free_template_literal() {
    let input = "<Demo\n  css={`    .box { color: red; }\n  `}\n/>\n";
    // The css template literal DOES contain braces in its CSS text, but no JSX
    // expression braces; this shape formats fine today and must stay identical.
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn issue_109_control_brace_free_template_literal_truly_no_braces() {
    let input = "<Demo\n  css={`    plain css text no braces\n  `}\n/>\n";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

/// Item-2 discriminator: a PAIRED element whose template-literal prop embeds a
/// `>` (here HTML markup). The old children-scanner matched that `>` and slurped
/// attribute lines as bogus children, corrupting the file. The
/// template-literal-aware opening-tag scan fixes it.
#[test]
fn issue_109_paired_with_gt_in_template_prop() {
    let input = "<Container\n  label={`<a href=\"x\">link</a>`}\n>\n  Hello\n</Container>";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "`>` inside a template-literal prop must not be read as the opening-tag close");
    let twice = format(&result, &default_settings());
    assert_eq!(twice, result);
}

#[test]
fn mdx_import_preserved() {
    let input = "import { Component } from \"./component\";\n\n# Content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn mdx_export_preserved() {
    let input = "export const meta = { title: \"Test\" };\n\n# Content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn jsx_with_expression_preserved() {
    let input = "<Component value={1 + 1} />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn jsx_self_closing_with_text_spacing() {
    // JSX followed by text paragraph should get empty line
    let input = "<ExImg src=\"/test.jpg\" alt=\"test\" />\n次の段落のテキストです。";
    let expected = "<ExImg src=\"/test.jpg\" alt=\"test\" />\n\n次の段落のテキストです。";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn jsx_followed_by_heading_no_extra_line() {
    // PARTIAL: Rust formatter skips spacing when next line starts with '#'.
    // TypeScript formatter adds spacing here. This test documents current Rust behaviour.
    let input = "<Component />\n# Heading";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn jsx_followed_by_list_no_extra_line() {
    // PARTIAL: Rust formatter skips spacing when next line starts with '-'.
    // TypeScript formatter adds spacing here. This test documents current Rust behaviour.
    let input = "<Component />\n- item 1";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn jsx_followed_by_jsx_no_extra_line() {
    // PARTIAL: Rust formatter skips spacing when next line starts with '<'.
    // TypeScript formatter adds spacing here. This test documents current Rust behaviour.
    let input = "<Component1 />\n<Component2 />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn multiple_jsx_components_separated() {
    let input = "<Youtube url=\"https://youtu.be/1\" />\n\n<Youtube url=\"https://youtu.be/2\" />\n\n<Youtube url=\"https://youtu.be/3\" />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
    // Verify they don't collapse (3 occurrences, not 1 merged)
    assert_eq!(result.matches("<Youtube").count(), 3);
}

#[test]
fn import_with_jsx_preserved() {
    let input = "import Frame from '../fragments/frame';\n\n<Frame />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn jsx_mercari_nav_with_array_expression() {
    // JSX with complex expression attributes
    let input =
        "<MercariNav ids={['synth-module-pro-nostalgia', 'synth-module-pro-black']} />";
    let result = format(input, &default_settings());
    assert!(
        result.contains("MercariNav"),
        "Should preserve MercariNav component"
    );
    assert!(
        result.contains("synth-module-pro-nostalgia"),
        "Should preserve ids"
    );
}

// ============================================================================
// 5. Parsing Validation — CommonMark edge cases
// ============================================================================

#[test]
fn parse_fenced_code_block_js() {
    let input = "```js\nconst x = 1;\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_fenced_code_block_python() {
    let input = "```python\nprint('hello')\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_fenced_code_block_rust() {
    let input = "```rust\nfn main() { println!(\"hello\"); }\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_fenced_code_block_no_language() {
    let input = "```\nplain code block\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_indented_code_block() {
    let input = "    code line 1\n    code line 2";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_blockquote() {
    let input = "> This is a quote\n> Second line";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_nested_blockquote() {
    let input = "> Outer quote\n>> Nested quote";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_thematic_break_dashes() {
    let input = "Content\n\n---\n\nMore content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_thematic_break_asterisks() {
    let input = "Content\n\n***\n\nMore content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_thematic_break_underscores() {
    let input = "Content\n\n___\n\nMore content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_hard_line_break() {
    let input = "Line 1  \nLine 2";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_emphasis_italic() {
    let input = "*italic text*";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_emphasis_bold() {
    let input = "**bold text**";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_emphasis_both() {
    let input = "***bold and italic***";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_mixed_emphasis() {
    let input = "*italic* and **bold** and ***both***";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_link() {
    let input = "[Link text](https://example.com)";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_link_with_title() {
    let input = "[Link text](https://example.com \"Title\")";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_image() {
    let input = "![Alt text](image.png)";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_image_with_title() {
    let input = "![Alt text](image.png \"Image title\")";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_inline_code() {
    let input = "Use `inline code` here";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_escape_sequences() {
    let input = "\\*not italic\\*";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 5b. Parsing Validation — GFM features
// ============================================================================

#[test]
fn parse_gfm_table() {
    let input = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_gfm_table_with_alignment() {
    let input = "| Left | Center | Right |\n| :--- | :---: | ---: |\n| A | B | C |";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_gfm_strikethrough() {
    let input = "~~deleted text~~";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_gfm_task_list() {
    let input = "- [x] Completed\n- [ ] Pending\n- [x] Also done";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 5c. Parsing Validation — MDX features
// ============================================================================

#[test]
fn parse_mdx_jsx_flow_self_closing() {
    let input = "<Component />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_mdx_jsx_flow_with_props() {
    let input = "<Component prop=\"value\" />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_mdx_jsx_expression() {
    let input = "<Component value={1 + 1} />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_mdx_esm_import() {
    let input = "import { useState } from 'react';";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_mdx_esm_export() {
    let input = "export const meta = { title: 'Test' };";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_mdx_expression_in_text() {
    let input = "The value is {variable}.";
    let result = format(input, &default_settings());
    assert!(
        result.contains("variable"),
        "MDX expression should be preserved"
    );
}

// ============================================================================
// 5d. Parsing Validation — Frontmatter
// ============================================================================

#[test]
fn parse_frontmatter_basic() {
    let input = "---\ntitle: Test\n---\n\n# Content";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_frontmatter_multiple_fields() {
    let input = "---\ntitle: Test\nauthor: John\ndate: 2024-01-01\n---\n\n# Heading";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_frontmatter_special_characters() {
    let input = "---\ntitle: \"Hello: World\"\ndescription: \"It's a test\"\n---\n\nContent";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn parse_frontmatter_boolean_values() {
    let input = "---\ndraft: true\npublished: false\n---\n\nContent";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 6. Japanese Text (from formatter.test.ts)
// ============================================================================

#[test]
fn japanese_heading_with_spacing() {
    let input = "# 日本語の見出し\n内容です。";
    let expected = "# 日本語の見出し\n\n内容です。";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn japanese_punctuation_preserved() {
    let input = "これは、日本語の文章です。";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn japanese_multi_line_preserved() {
    let input = "こんにちは、Takazudoです。\n次の行です。";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn japanese_no_backslash_at_line_end() {
    let input = "これは日本語のテキストです";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
    assert!(!result.ends_with('\\'));
}

#[test]
fn japanese_no_backslash_after_punctuation() {
    let input = "これは文章です。";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
    assert!(!result.contains("。\\"));
}

#[test]
fn japanese_multi_line_no_backslash() {
    let input = "これは最初の行\nこれは次の行";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
    assert!(!result.contains('\\'), "Should not add any backslashes");
}

#[test]
fn japanese_paragraphs_preserved() {
    let input = "段落1です。\n\n段落2です。\n\n段落3です。";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn japanese_question_mark_space_preserved() {
    let input = "シンセのDIYってどういうこと？ 自分で作れたり";
    let result = format(input, &default_settings());
    assert!(
        result.contains("？ 自分で"),
        "Space after question mark should be preserved"
    );
}

#[test]
fn japanese_list_formatting_preserved() {
    let input = "- 項目1：説明文\n- 項目2：説明文";
    let result = format(input, &default_settings());
    assert!(result.contains("- 項目1：説明文"));
    assert!(result.contains("- 項目2：説明文"));
}

#[test]
fn japanese_bold_text_preserved() {
    let input = "**重要** な情報です";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn japanese_with_jsx_spacing() {
    // JSX followed by Japanese text should get empty line
    let input =
        "テキストです。\n\n<Youtube url=\"https://example.com\" />";
    let result = format(input, &default_settings());
    assert!(result.contains("テキストです。\n\n<Youtube"));
}

// ============================================================================
// 7. Content Preservation Tests
// ============================================================================

#[test]
fn bold_text_with_multiplication_sign() {
    let input = "**×2**";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn bold_text_with_multiplication_in_sentence() {
    let input = "この値を **×2** します";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn image_alt_text_with_colon() {
    let input = "![図:VCAによるオーディオシグナルの減衰処理](/images/p/vca-exp-2)";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn image_alt_text_multiple_colons() {
    let input = "![図:VCA:エンベロープ処理](/images/p/test)";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn image_alt_text_colon_at_start() {
    let input = "![:VCAモジュール](/images/p/vca)";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn url_with_underscores_preserved() {
    let input = "[Link text](/images/p/design_blank_frame)";
    let result = format(input, &default_settings());
    assert!(
        result.contains("/images/p/design_blank_frame"),
        "Underscores in URLs should be preserved"
    );
    assert!(
        !result.contains("\\_"),
        "Underscores should not be escaped"
    );
}

#[test]
fn spaces_between_bold_elements() {
    let input = "**VCA** + **Decay Envelope**";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn spaces_around_plus_between_bold() {
    let input = "**Item1** + **Item2** = **Result**";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn multiple_bold_with_connectors() {
    let input = "**A** and **B** or **C**";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn html_entities_preserved() {
    let input = "&amp; &lt; &gt;";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn inline_code_with_angle_brackets() {
    let input = "Use `<Component />` in your code";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn list_with_colon_and_bold() {
    let input = "- Synth Module Pro Nostalgia: **153,800円**";
    let result = format(input, &default_settings());
    assert!(
        result.contains(": **153,800円**"),
        "Space after colon should be preserved"
    );
}

// ============================================================================
// 8. JSX Spacing Rules (from formatter.test.ts)
// ============================================================================

#[test]
fn jsx_with_existing_blank_line_before_text() {
    let input =
        "<ExImg src=\"/test.jpg\" alt=\"test\" />\n\nThis text already has a blank line before it.";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn multiple_jsx_then_text() {
    // Two JSX components then text — only the last JSX→text gets spacing
    let input = "<ExImg src=\"/test1.jpg\" alt=\"test1\" />\n<ExImg src=\"/test2.jpg\" alt=\"test2\" />\n次の段落のテキストです。";
    let expected = "<ExImg src=\"/test1.jpg\" alt=\"test1\" />\n<ExImg src=\"/test2.jpg\" alt=\"test2\" />\n\n次の段落のテキストです。";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn multiple_jsx_components_not_collapsed() {
    let input = "<Youtube url=\"https://youtu.be/59CxE076HDM\" />\n\n<Youtube url=\"https://youtu.be/MsfVwQ3i4xg\" />\n\n<Youtube url=\"https://youtu.be/-0dyIu5RekY\" />";
    let result = format(input, &default_settings());
    assert!(
        !result.contains("/><Youtube"),
        "JSX components should not collapse"
    );
    // Use matches() instead of split() to count occurrences robustly
    assert_eq!(result.matches("<Youtube").count(), 3);
}

#[test]
fn import_statement_not_merged_with_following() {
    let input = "import Frame from '../fragments/frame';\n\n<Frame />";
    let result = format(input, &default_settings());
    assert!(
        !result.contains("';<Frame"),
        "Import should not merge with JSX"
    );
    assert!(result.contains("';\n\n<Frame"));
}

// ============================================================================
// 9. Heading and Content Interaction
// ============================================================================

#[test]
fn heading_followed_by_jsx_preserved() {
    // Heading then JSX: heading adds empty line even before JSX
    // Wait — let's test what actually happens. The heading rule adds empty line
    // if next line is non-empty and doesn't start with #.
    // JSX line starts with '<' which doesn't start with '#', so spacing IS added.
    let input = "## 価格とご予約について\n\n<ExImg src=\"test.jpg\" />";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn heading_then_jsx_adds_spacing() {
    let input = "## Heading\n<Component />";
    let expected = "## Heading\n\n<Component />";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

// ============================================================================
// 10. Code Block Interaction
// ============================================================================

#[test]
fn code_block_after_heading() {
    let input = "# Heading\n```js\ncode();\n```";
    let expected = "# Heading\n\n```js\ncode();\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn code_block_jsx_like_content_inside() {
    // Content inside code blocks should not be processed
    let input = "```jsx\n<Component prop=\"value\" />\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn code_block_with_jsx_not_formatted() {
    let input = "```\n<InfoBox>\nNot formatted\n</InfoBox>\n```";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn javascript_code_block_preserved() {
    let input = "```javascript\nconst example = 'hello';\n```\n\nNext paragraph here.";
    let result = format(input, &default_settings());
    assert!(
        result.contains("```\n\nNext paragraph"),
        "Code block and paragraph should be separated"
    );
}

// ============================================================================
// 11. Blockquote Tests
// ============================================================================

#[test]
fn blockquote_simple() {
    let input = "> Quote text";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn blockquote_multiline() {
    let input = "> Line 1\n> Line 2\n> Line 3";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn blockquote_with_empty_line() {
    let input = "> First paragraph\n>\n> Second paragraph";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 12. Error Handling / Edge Cases
// ============================================================================

#[test]
fn unclosed_code_block_handled() {
    let input = "# Heading\n```\nUnclosed code block";
    let result = format(input, &default_settings());
    assert!(
        result.contains("# Heading"),
        "Should contain original heading"
    );
}

#[test]
fn whitespace_only_input() {
    let input = "   \n   \n   ";
    // Should not crash and should not add content
    let result = format(input, &default_settings());
    assert!(
        !result.contains("# ") && !result.contains("- "),
        "Whitespace-only input should not produce markdown elements"
    );
}

#[test]
fn single_newline() {
    let input = "\n";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn content_with_only_frontmatter() {
    let input = "---\ntitle: Test\n---";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 13. Regression Tests (from formatter.test.ts)
// ============================================================================

#[test]
fn regression_multi_paragraph_not_merged() {
    let input = "こんにちは、Takazudo Modularです。\nTakazudo Modular Highlightsなどというメルマガの名前にしてみました。\nそんな年中送るかは分かりませんが……。";
    let result = format(input, &default_settings());
    let lines: Vec<&str> = result.trim().split('\n').collect();
    assert!(lines.len() > 1, "Should not merge paragraphs into one line");
    assert!(result.contains("こんにちは、Takazudo Modularです。"));
    assert!(result.contains(
        "Takazudo Modular Highlightsなどというメルマガの名前にしてみました。"
    ));
}

#[test]
fn regression_paragraph_breaks_preserved() {
    let input = "段落1です。\n\n段落2です。\n\n段落3です。";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn regression_jsx_and_text_blank_line() {
    let input = "そんなわけで、以下がVol.1の内容となります。\n\n<ExImg src=\"/images/p/highlights-vol-1-hero\" extraWide alt=\"メルマガ写真\" />";
    let result = format(input, &default_settings());
    assert!(result.contains("となります。\n\n<ExImg"));
}

#[test]
fn regression_text_then_jsx_separate_lines() {
    let input =
        "テキストです。\n\n<Youtube url=\"https://example.com\" />";
    let result = format(input, &default_settings());
    assert!(result.contains("テキストです。\n\n<Youtube"));
}

// ============================================================================
// 14. Complex Documents
// ============================================================================

#[test]
fn complex_document_with_headings_and_lists() {
    let input = "# Title\nIntro paragraph.\n\n## Section 1\n  - Item A\n  - Item B\n\n## Section 2\nAnother paragraph.";
    let result = format(input, &default_settings());
    // Heading spacing
    assert!(result.contains("# Title\n\nIntro paragraph."));
    // List indent normalization
    assert!(result.contains("- Item A\n- Item B"));
    // Section 2 heading spacing
    assert!(result.contains("## Section 2\n\nAnother paragraph."));
}

#[test]
fn complex_document_frontmatter_headings_code() {
    let input = "---\ntitle: Test\n---\n\n# Heading\n\nParagraph\n\n```js\ncode();\n```\n\nFinal paragraph.";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "Already formatted document should be unchanged");
}

#[test]
fn complex_document_with_jsx_and_lists() {
    let input = "# Heading\n\n<ExImg src=\"/test.jpg\" alt=\"test\" />\n\nSome text.\n\n- List item 1\n- List item 2";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "Well-formatted document should be stable");
}

// ============================================================================
// 15. Features ported from TypeScript (previously TODO)
// ============================================================================

#[test]
fn jsx_empty_lines_in_block_component() {
    // addEmptyLinesInBlockJsx: adds empty lines after opening and before closing tags
    let settings = settings_with_block_components();
    let input = "<InfoBox>\nContent\n</InfoBox>";
    let expected = "<InfoBox>\n\nContent\n\n</InfoBox>";
    let result = format(input, &settings);
    assert_eq!(result, expected);
}

#[test]
fn jsx_multiline_indentation_disabled_by_default() {
    // indentJsxContent is disabled by default, so content is preserved as-is
    let input = "<InfoBox>\nContent here\n</InfoBox>";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn nested_jsx_indentation_disabled_by_default() {
    // indentJsxContent is disabled by default, so nested content is preserved as-is
    let input = "<Outer>\n<Inner>\nContent\n</Inner>\n</Outer>";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn admonition_preservation() {
    // Admonitions (:::) are preserved as-is — no special handling needed in Rust
    let input = ":::note\nThis is a note\n:::";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn admonition_with_title() {
    // Admonitions with bracket titles are preserved as-is
    let input = ":::tip[Pro Tip]\nThis is a tip\n:::";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn todo_html_definition_list_formatting() {
    // TODO: HTML block formatting not yet implemented — blocked on Prettier replacement decision.
    // Once implemented, expected should be:
    // "<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>"
    let input = "<dl>\n<dt>Term</dt>\n<dd>Definition</dd>\n</dl>";
    let result = format(input, &default_settings());
    assert!(result.contains("Term"));
    assert!(result.contains("Definition"));
}

#[test]
fn yaml_frontmatter_formatting() {
    // YAML frontmatter is reformatted: extra spaces are normalized
    let input = "---\ntitle:   Test   \n---\n\nContent";
    let expected = "---\ntitle: Test\n---\n\nContent";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

// ============================================================================
// 16. Settings Configuration Tests
// ============================================================================

#[test]
fn settings_default_has_spacing_enabled() {
    let settings = default_settings();
    assert!(settings.add_empty_line_between_elements.enabled);
}

#[test]
fn settings_disabled_spacing_skips_heading_fix() {
    let settings = settings_with_spacing_disabled();
    let input = "# Heading\nContent";
    let result = format(input, &settings);
    assert_eq!(result, input, "With spacing disabled, no empty line added");
}

#[test]
fn settings_from_partial_json_basic() {
    let json: serde_json::Value = serde_json::json!({
        "addEmptyLineBetweenElements": { "enabled": false }
    });
    let settings = FormatterSettings::from_partial_json(&json);
    assert!(!settings.add_empty_line_between_elements.enabled);
}

#[test]
fn settings_from_partial_json_block_components() {
    let json: serde_json::Value = serde_json::json!({
        "addEmptyLinesInBlockJsx": {
            "enabled": true,
            "blockComponents": ["InfoBox", "Note"]
        }
    });
    let settings = FormatterSettings::from_partial_json(&json);
    assert!(settings.add_empty_lines_in_block_jsx.enabled);
    assert_eq!(
        settings.add_empty_lines_in_block_jsx.block_components,
        vec!["InfoBox", "Note"]
    );
}

#[test]
fn settings_from_partial_json_empty() {
    let json: serde_json::Value = serde_json::json!({});
    let settings = FormatterSettings::from_partial_json(&json);
    // Should use defaults
    assert!(settings.add_empty_line_between_elements.enabled);
    assert!(settings.format_multi_line_jsx.enabled);
}

// ============================================================================
// 17. Convergence Loop Tests
// ============================================================================

#[test]
fn convergence_stops_when_stable() {
    // Input that needs one fix — should converge in 1 iteration
    let input = "# Heading\nContent";
    let result = format(input, &default_settings());
    let expected = "# Heading\n\nContent";
    assert_eq!(result, expected);
    // Verify it's actually stable
    let again = format(&result, &default_settings());
    assert_eq!(result, again);
}

#[test]
fn convergence_multiple_fixes() {
    // Input that needs multiple fixes — heading spacing + list indent
    let input = "# Title\nText\n\n  - Item 1\n    - Nested\n  - Item 2";
    let result = format(input, &default_settings());
    let again = format(&result, &default_settings());
    assert_eq!(result, again, "Should converge within max iterations");
}

#[test]
fn convergence_already_formatted() {
    // Already formatted — should return immediately
    let input = "# Title\n\nText\n\n- Item 1\n  - Nested\n- Item 2";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

// ============================================================================
// 18. Mixed Content Stress Tests
// ============================================================================

#[test]
fn stress_many_headings_and_paragraphs() {
    let input = "# H1\nP1\n## H2\nP2\n### H3\nP3\n#### H4\nP4\n##### H5\nP5\n###### H6\nP6";
    let result = format(input, &default_settings());
    // Each heading→paragraph should get empty line
    assert!(result.contains("# H1\n\nP1"));
    assert!(result.contains("## H2\n\nP2"));
    assert!(result.contains("### H3\n\nP3"));
    assert!(result.contains("#### H4\n\nP4"));
    assert!(result.contains("##### H5\n\nP5"));
    assert!(result.contains("###### H6\n\nP6"));
}

#[test]
fn stress_deeply_nested_lists() {
    let input = "- Level 0\n  - Level 1\n    - Level 2\n      - Level 3";
    let result = format(input, &default_settings());
    // All nesting should be normalized to 2-space increments
    assert!(result.contains("- Level 0"));
    assert!(result.contains("  - Level 1"));
    // Deeper levels depend on parser nesting detection
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Deep nesting should be idempotent");
}

#[test]
fn stress_mixed_jsx_headings_lists() {
    let input = "# Title\n<Component />\n- item 1\n  - nested\n## Sub\nParagraph\n<Another prop=\"val\" />\nText after.";
    let result = format(input, &default_settings());
    // Should be idempotent
    let again = format(&result, &default_settings());
    assert_eq!(result, again);
    // Heading spacing should be applied
    assert!(result.contains("# Title\n\n<Component />"));
    assert!(result.contains("## Sub\n\nParagraph"));
}

#[test]
fn stress_frontmatter_jsx_lists_code() {
    let input = "---\ntitle: Complex\n---\n\n# Title\n\nIntro text.\n\n<Widget type=\"fancy\" />\n\n- Item 1\n- Item 2\n\n```ts\nconst x = 1;\n```\n\n## Conclusion\n\nFinal words.";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "Well-structured document should be stable");
}

// ============================================================================
// HTML Block Formatting (from html-blocks.test.ts)
// ============================================================================

#[test]
fn html_block_simple_dl() {
    let input = "<dl>\n<dt>Term 1</dt>\n<dd>Definition 1</dd>\n</dl>";
    let expected = "<dl>\n  <dt>Term 1</dt>\n  <dd>Definition 1</dd>\n</dl>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_dl_excessive_whitespace() {
    let input = "<dl>\n  <dt>  Term with spaces  </dt>\n  <dd>   Definition with spaces   </dd>\n</dl>";
    let expected = "<dl>\n  <dt>Term with spaces</dt>\n  <dd>Definition with spaces</dd>\n</dl>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_dl_with_div_wrappers() {
    let input = "<dl>\n<div>\n<dt>Term 1</dt>\n<dd>Definition 1</dd>\n</div>\n<div>\n<dt>Term 2</dt>\n<dd>Definition 2</dd>\n</div>\n</dl>";
    let expected = "<dl>\n  <div>\n    <dt>Term 1</dt>\n    <dd>Definition 1</dd>\n  </div>\n  <div>\n    <dt>Term 2</dt>\n    <dd>Definition 2</dd>\n  </div>\n</dl>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_nested_definition_lists() {
    let input = "<dl>\n<dt>Outer Term</dt>\n<dd>\n<dl>\n<dt>Inner Term</dt>\n<dd>Inner Definition</dd>\n</dl>\n</dd>\n</dl>";
    let expected = "<dl>\n  <dt>Outer Term</dt>\n  <dd>\n    <dl>\n      <dt>Inner Term</dt>\n      <dd>Inner Definition</dd>\n    </dl>\n  </dd>\n</dl>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_simple_table() {
    let input = "<table>\n<tr>\n<td>Cell 1</td>\n<td>Cell 2</td>\n</tr>\n<tr>\n<td>Cell 3</td>\n<td>Cell 4</td>\n</tr>\n</table>";
    let expected = "<table>\n  <tr>\n    <td>Cell 1</td>\n    <td>Cell 2</td>\n  </tr>\n  <tr>\n    <td>Cell 3</td>\n    <td>Cell 4</td>\n  </tr>\n</table>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_table_with_thead_tbody() {
    let input = "<table>\n<thead>\n<tr>\n<th>Header 1</th>\n<th>Header 2</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>Data 1</td>\n<td>Data 2</td>\n</tr>\n</tbody>\n</table>";
    let expected = "<table>\n  <thead>\n    <tr>\n      <th>Header 1</th>\n      <th>Header 2</th>\n    </tr>\n  </thead>\n  <tbody>\n    <tr>\n      <td>Data 1</td>\n      <td>Data 2</td>\n    </tr>\n  </tbody>\n</table>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_table_with_attributes() {
    let input = "<table class=\"data-table\" id=\"results\">\n<tr class=\"row-highlight\">\n<td colspan=\"2\">Merged Cell</td>\n</tr>\n</table>";
    let expected = "<table class=\"data-table\" id=\"results\">\n  <tr class=\"row-highlight\">\n    <td colspan=\"2\">Merged Cell</td>\n  </tr>\n</table>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_unordered_list() {
    let input = "<ul>\n<li>Item 1</li>\n<li>Item 2</li>\n<li>Item 3</li>\n</ul>";
    let expected = "<ul>\n  <li>Item 1</li>\n  <li>Item 2</li>\n  <li>Item 3</li>\n</ul>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_ordered_list() {
    let input = "<ol>\n<li>First</li>\n<li>Second</li>\n<li>Third</li>\n</ol>";
    let expected = "<ol>\n  <li>First</li>\n  <li>Second</li>\n  <li>Third</li>\n</ol>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_nested_divs() {
    let input = "<div class=\"container\">\n<div class=\"row\">\n<div class=\"col\">Content</div>\n</div>\n</div>";
    let expected = "<div class=\"container\">\n  <div class=\"row\">\n    <div class=\"col\">Content</div>\n  </div>\n</div>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_div_with_mixed_content() {
    let input = "<div>\n<h3>Title</h3>\n<p>Paragraph text here.</p>\n<ul>\n<li>List item</li>\n</ul>\n</div>";
    let expected = "<div>\n  <h3>Title</h3>\n  <p>Paragraph text here.</p>\n  <ul>\n    <li>List item</li>\n  </ul>\n</div>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_select_options() {
    let input = "<select name=\"choice\">\n<option value=\"1\">Option 1</option>\n<option value=\"2\">Option 2</option>\n<option value=\"3\">Option 3</option>\n</select>";
    let expected = "<select name=\"choice\">\n  <option value=\"1\">Option 1</option>\n  <option value=\"2\">Option 2</option>\n  <option value=\"3\">Option 3</option>\n</select>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_mixed_mdx_content() {
    let input = "# Heading\n\nSome paragraph text.\n\n<dl>\n<dt>Term</dt>\n<dd>Definition</dd>\n</dl>\n\nMore content here.\n\n<table>\n<tr>\n<td>Data</td>\n</tr>\n</table>";
    let expected = "# Heading\n\nSome paragraph text.\n\n<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>\n\nMore content here.\n\n<table>\n  <tr>\n    <td>Data</td>\n  </tr>\n</table>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_empty_elements() {
    let input = "<div></div>\n<span></span>\n<p></p>";
    let result = format(input, &default_settings());
    assert_eq!(result, input);
}

#[test]
fn html_block_self_closing_void_elements() {
    let input = "<div>\n<img src=\"image.jpg\" alt=\"Test\" />\n<br />\n<hr />\n</div>";
    let expected = "<div>\n  <img src=\"image.jpg\" alt=\"Test\" />\n  <br />\n  <hr />\n</div>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_deeply_nested() {
    let input = "<div>\n<section>\n<article>\n<header>\n<h1>Title</h1>\n</header>\n<main>\n<p>Content</p>\n</main>\n<footer>\n<p>Footer</p>\n</footer>\n</article>\n</section>\n</div>";
    let expected = "<div>\n  <section>\n    <article>\n      <header>\n        <h1>Title</h1>\n      </header>\n      <main>\n        <p>Content</p>\n      </main>\n      <footer>\n        <p>Footer</p>\n      </footer>\n    </article>\n  </section>\n</div>";
    let result = format(input, &default_settings());
    assert_eq!(result, expected);
}

#[test]
fn html_block_disabled_setting() {
    let input = "<dl>\n<dt>Term</dt>\n<dd>Definition</dd>\n</dl>";
    let mut settings = default_settings();
    settings.format_html_blocks_in_mdx.enabled = false;
    let result = format(input, &settings);
    assert_eq!(result, input, "Should not change when disabled");
}

#[test]
fn html_block_long_attributes_no_wrapping() {
    let input = "<div class=\"very-long-class-name-that-exceeds-normal-width\" id=\"very-long-id-value\" data-attribute=\"very-long-attribute-value\">\n<p>Content</p>\n</div>";
    let result = format(input, &default_settings());
    assert!(result.contains("very-long-class-name-that-exceeds-normal-width"));
    assert!(result.contains("<p>Content</p>"));
}

#[test]
fn html_block_backward_compat_trimmed_dt_dd() {
    let input = "<dl>\n  <dt>  Term with spaces  </dt>\n  <dd>   Definition with spaces   </dd>\n</dl>";
    let result = format(input, &default_settings());
    assert!(result.contains("<dt>Term with spaces</dt>"));
    assert!(result.contains("<dd>Definition with spaces</dd>"));
}

#[test]
fn html_block_idempotent() {
    // Formatting already-formatted HTML should produce the same output
    let formatted = "<dl>\n  <dt>Term</dt>\n  <dd>Definition</dd>\n</dl>";
    let result = format(formatted, &default_settings());
    assert_eq!(result, formatted, "HTML block formatting should be idempotent");
}

#[test]
fn html_block_inline_span_preserves_content() {
    let input = "<div>\n<span class=\"highlight\">Important</span> text with <span>inline</span> elements.\n</div>";
    let result = format(input, &default_settings());
    assert!(result.contains("Important"));
    assert!(result.contains("inline"));
}
