/**
 * Pre-process content to preserve image alt text from directive parsing
 * @param {string} content - The markdown content
 * @returns {string} - Content with protected alt text
 */
export function protectImageAltText(content) {
  // Replace colons in image alt text with a placeholder that won't be parsed as a directive
  // Match ![...] patterns and protect ALL colons within them
  return content.replace(/!\[([^\]]*)\]/g, (match, altText) => {
    // Replace all colons in the alt text with a placeholder
    const protectedAlt = altText.replace(/:/g, '___COLON___');
    return `![${protectedAlt}]`;
  });
}

/**
 * Post-process content to restore image alt text
 * @param {string} content - The formatted content
 * @returns {string} - Content with restored alt text
 */
export function restoreImageAltText(content) {
  // Restore the colons in image alt text - handle both escaped and unescaped versions
  return content.replace(/___COLON___/g, ':').replace(/\\_\\_\\_COLON\\_\\_\\_/g, ':'); // In case underscores got escaped
}
