/**
 * Post-process the formatted output to fix autolink and spacing issues
 * @param {string} content - The formatted content
 * @returns {string} - The fixed content
 */
export function fixAutolinkOutput(content) {
  let fixed = content;

  // 1. Remove angle brackets around URLs
  // Matches <https://...> or <http://...> and replaces with just the URL
  fixed = fixed.replace(/<(https?:\/\/[^>]+)>/g, '$1');

  // 2. Fix spacing before URLs
  // Ensure there's a space before standalone URLs (not in markdown links)
  // Match word characters directly followed by http without space
  fixed = fixed.replace(/([a-zA-Z0-9])https:\/\//g, '$1 https://');

  // 3. Fix spacing before markdown links
  // Match word characters directly followed by [link]
  fixed = fixed.replace(/([a-zA-Z0-9])(\[)/g, '$1 $2');

  // 4. Fix spacing after colons before URLs
  // Match colon directly followed by http without space
  fixed = fixed.replace(/:https:\/\//g, ': https://');

  // 5. Don't escape colons unnecessarily
  // Remark escapes colons in some contexts, but they don't need escaping in most cases
  // Only keep escaped colons at the start of a line (where they could be confused with definitions)
  fixed = fixed.replace(/([^\n])\\:/g, '$1:');

  return fixed;
}
