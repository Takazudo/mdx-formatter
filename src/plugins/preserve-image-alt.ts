/**
 * Pre-process content to preserve image alt text from directive parsing
 */
export function protectImageAltText(content: string): string {
  // Replace colons in image alt text with a placeholder that won't be parsed as a directive
  // Match ![...] patterns and protect ALL colons within them
  return content.replace(/!\[([^\]]*)\]/g, (_match, altText: string) => {
    // Replace all colons in the alt text with a placeholder
    const protectedAlt = altText.replace(/:/g, '___COLON___');
    return `![${protectedAlt}]`;
  });
}

/**
 * Post-process content to restore image alt text
 */
export function restoreImageAltText(content: string): string {
  // Restore the colons in image alt text - handle both escaped and unescaped versions
  return content.replace(/___COLON___/g, ':').replace(/\\_\\_\\_COLON\\_\\_\\_/g, ':'); // In case underscores got escaped
}
