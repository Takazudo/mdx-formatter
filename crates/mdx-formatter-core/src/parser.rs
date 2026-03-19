use markdown::mdast::Node;
use markdown::{Constructs, ParseOptions};

/// Parse markdown/MDX content into an mdast AST using markdown-rs.
///
/// Enables MDX, GFM, and frontmatter constructs for full compatibility
/// with the TypeScript formatter's remark-based parser.
pub fn parse(content: &str) -> Node {
    // In MDX mode, HTML constructs must be disabled because MDX JSX
    // replaces HTML. If both are enabled, the HTML parser wins and JSX
    // elements are parsed as HTML nodes instead of MdxJsxFlowElement.
    let parse_options = ParseOptions {
        constructs: Constructs {
            frontmatter: true,
            gfm_table: true,
            gfm_task_list_item: true,
            gfm_strikethrough: true,
            gfm_autolink_literal: true,
            mdx_jsx_flow: true,
            mdx_jsx_text: true,
            mdx_esm: true,
            mdx_expression_flow: true,
            mdx_expression_text: true,
            // Disable HTML when MDX is enabled (MDX JSX replaces HTML)
            html_flow: false,
            html_text: false,
            ..Constructs::default()
        },
        ..ParseOptions::default()
    };

    match markdown::to_mdast(content, &parse_options) {
        Ok(node) => node,
        Err(_) => {
            // If MDX parsing fails, fall back to basic markdown parsing
            // This handles cases where MDX constructs cause parse errors
            let fallback_options = ParseOptions {
                constructs: Constructs {
                    frontmatter: true,
                    gfm_table: true,
                    gfm_task_list_item: true,
                    gfm_strikethrough: true,
                    gfm_autolink_literal: true,
                    ..Constructs::default()
                },
                ..ParseOptions::default()
            };
            match markdown::to_mdast(content, &fallback_options) {
                Ok(node) => node,
                Err(_) => {
                    // Last resort: parse as basic markdown
                    markdown::to_mdast(content, &ParseOptions::default())
                        .unwrap_or_else(|_| {
                            // Return an empty root node if all parsing fails
                            Node::Root(markdown::mdast::Root {
                                children: vec![],
                                position: None,
                            })
                        })
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_basic_markdown() {
        let content = "# Hello\n\nWorld";
        let ast = parse(content);
        match &ast {
            Node::Root(root) => {
                assert!(!root.children.is_empty());
            }
            _ => panic!("Expected Root node"),
        }
    }

    #[test]
    fn test_parse_frontmatter() {
        let content = "---\ntitle: Test\n---\n\n# Content";
        let ast = parse(content);
        match &ast {
            Node::Root(root) => {
                // First child should be YAML frontmatter
                assert!(matches!(&root.children[0], Node::Yaml(_)));
            }
            _ => panic!("Expected Root node"),
        }
    }

    #[test]
    fn test_parse_mdx_jsx() {
        let content = "<Component prop=\"value\" />";
        let ast = parse(content);
        match &ast {
            Node::Root(root) => {
                assert!(!root.children.is_empty());
                // Should parse as MdxJsxFlowElement
                assert!(
                    matches!(&root.children[0], Node::MdxJsxFlowElement(_)),
                    "Expected MdxJsxFlowElement, got: {:?}",
                    &root.children[0]
                );
            }
            _ => panic!("Expected Root node"),
        }
    }

    #[test]
    fn test_parse_gfm_table() {
        let content = "| Header |\n| --- |\n| Cell |";
        let ast = parse(content);
        match &ast {
            Node::Root(root) => {
                assert!(!root.children.is_empty());
            }
            _ => panic!("Expected Root node"),
        }
    }

    #[test]
    fn test_parse_list() {
        let content = "- item 1\n- item 2\n  - nested";
        let ast = parse(content);
        match &ast {
            Node::Root(root) => {
                assert!(matches!(&root.children[0], Node::List(_)));
            }
            _ => panic!("Expected Root node"),
        }
    }
}
