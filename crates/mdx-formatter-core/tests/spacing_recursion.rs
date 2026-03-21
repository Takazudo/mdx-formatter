//! Tests for spacing rule recursion — verifying that heading and JSX spacing
//! works at any AST nesting depth, not just at the root level.
//!
//! The TS formatter uses `visit()` which walks the entire tree. The Rust
//! formatter must do the same — checking spacing after headings and JSX
//! elements regardless of parent node type.

use mdx_formatter_core::format;
use mdx_formatter_core::types::FormatterSettings;

fn default_settings() -> FormatterSettings {
    FormatterSettings::default()
}

// ============================================================================
// Heading spacing inside blockquotes
// ============================================================================

#[test]
fn heading_inside_blockquote_gets_spacing() {
    // The heading ends at line 0. Next line `> Content` is non-empty and
    // doesn't start with '#', so an empty line is inserted.
    // This matches TS behavior: the raw-line check doesn't strip blockquote markers.
    let input = "> # Heading\n> Content after heading";
    let result = format(input, &default_settings());
    assert_eq!(result, "> # Heading\n\n> Content after heading");
}

#[test]
fn heading_inside_blockquote_idempotent() {
    let input = "> # Heading\n> Content after heading";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Heading in blockquote spacing should be idempotent");
}

#[test]
fn multiple_headings_in_blockquote() {
    let input = "> # First\n> Content\n> ## Second\n> More content";
    let result = format(input, &default_settings());
    // Both headings should get spacing
    assert!(result.contains("# First\n\n> Content"),
        "First heading in blockquote should get spacing");
    // Idempotent
    let second = format(&result, &default_settings());
    assert_eq!(result, second, "Multiple headings in blockquote should be idempotent");
}

// ============================================================================
// Heading spacing inside JSX containers
// ============================================================================

#[test]
fn heading_inside_jsx_container_gets_spacing() {
    let input = "<Container>\n\n# Inner Heading\nContent inside container\n\n</Container>";
    let result = format(input, &default_settings());
    assert!(result.contains("# Inner Heading\n\nContent inside container"),
        "Heading inside JSX should get spacing");
}

#[test]
fn heading_inside_jsx_already_spaced() {
    let input = "<Container>\n\n# Inner Heading\n\nContent inside container\n\n</Container>";
    let result = format(input, &default_settings());
    assert_eq!(result, input, "Already-spaced heading in JSX should be stable");
}

#[test]
fn heading_in_jsx_container_idempotent() {
    let input = "<Container>\n\n# Inner Heading\nContent inside\n\n</Container>";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Heading in JSX container spacing should be idempotent");
}

// ============================================================================
// JSX spacing at nested levels
// ============================================================================

#[test]
fn jsx_inside_jsx_gets_spacing_before_text() {
    let input = "<Outer>\n\n<Inner />\nText after inner\n\n</Outer>";
    let result = format(input, &default_settings());
    assert!(result.contains("<Inner />\n\nText after inner"),
        "JSX inside JSX should get spacing before text");
}

#[test]
fn jsx_inside_jsx_idempotent() {
    let input = "<Outer>\n\n<Inner />\nText after inner\n\n</Outer>";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Nested JSX spacing should be idempotent");
}

// ============================================================================
// Edge cases
// ============================================================================

#[test]
fn heading_followed_by_heading_in_blockquote() {
    // In blockquote, the next raw line starts with '>' not '#',
    // so spacing IS inserted (unlike root-level heading→heading).
    let input = "> # First\n> ## Second";
    let first = format(input, &default_settings());
    let second = format(&first, &default_settings());
    assert_eq!(first, second, "Should at least be idempotent");
}

#[test]
fn deeply_nested_content_preserved() {
    let input = "> > # Deep heading\n> >\n> > Content";
    let result = format(input, &default_settings());
    assert!(result.contains("Deep heading"), "Deep heading text should be preserved");
    let second = format(&result, &default_settings());
    assert_eq!(result, second, "Deep nesting should be idempotent");
}

#[test]
fn heading_spacing_disabled_no_nested_effect() {
    let mut settings = default_settings();
    settings.add_empty_line_between_elements.enabled = false;
    let input = "<Container>\n\n# Heading\nContent\n\n</Container>";
    let result = format(input, &settings);
    // With spacing disabled, no empty line should be inserted
    assert!(result.contains("# Heading\nContent"),
        "Disabled spacing should not affect nested headings");
}
