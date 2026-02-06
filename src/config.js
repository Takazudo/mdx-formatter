/**
 * Get remark-stringify options
 * @returns {Object} Stringify options
 */
export function getStringifyOptions() {
  return {
    bullet: '-', // Use - for unordered lists
    bulletOrdered: '.', // Use . for ordered lists
    emphasis: '*', // Use * for emphasis
    fence: '`', // Use ` for code fences
    fences: true, // Use fences for code blocks
    incrementListMarker: true, // Increment ordered list markers
    listItemIndent: 'one', // Use minimal indentation for list items
    quote: '"', // Use " for quotes
    resourceLink: false, // Use inline links
    rule: '-', // Use - for horizontal rules
    ruleRepetition: 3, // Use --- for horizontal rules
    ruleSpaces: false, // No spaces in horizontal rules
    setext: false, // Use ATX headings (#) not setext
    strong: '*', // Use * for strong (will be doubled automatically)
    tightDefinitions: false, // Space between definition terms
    join: [], // Don't join any node types (preserve original spacing)
  };
}

/**
 * Get remark-gfm options
 * @returns {Object} GFM options
 */
export function getGfmOptions() {
  return {
    singleTilde: false, // Use ~~ for strikethrough, not ~
    tablePipeAlign: true, // Align table pipes
  };
}

/**
 * Default options for the formatter
 */
export const defaultOptions = {
  mdx: null, // Auto-detect by default
  filepath: null, // Optional filepath for better detection
};
