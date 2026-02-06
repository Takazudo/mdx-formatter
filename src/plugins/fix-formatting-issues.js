/**
 * Post-processing fixes for common formatting issues
 * @param {string} content - The formatted content
 * @returns {string} - The fixed content
 */
export function fixFormattingIssues(content) {
  let fixed = content;

  // Fix 1: Restore spaces between bold elements and operators
  // When bold text is followed by operators like +, =, etc., ensure there's a space
  // This must be done BEFORE fixing the internal spaces to preserve the pattern
  // Use negative lookahead to avoid matching operators that already have a space
  fixed = fixed.replace(/(\*\*[^*]+\*\*)([+\-=])/g, '$1 $2');

  // Fix 2: Restore spaces before bold elements after operators
  // Ensure there's a space after operators before bold text
  fixed = fixed.replace(/([+\-=])(\*\*[^*]+\*\*)/g, '$1 $2');

  // Fix 3: Restore spaces between word characters and bold elements
  fixed = fixed.replace(/([a-zA-Z])\s*(\*\*[^*]+\*\*)/g, '$1 $2');

  // Fix 4: Remove extra spaces inside bold asterisks (do this LAST)
  // Sometimes remark adds a space before the closing ** for short words
  // Pattern: **word ** -> **word**
  fixed = fixed.replace(/\*\*([^*]+)\s+\*\*/g, '**$1**');

  // Fix 5: Remove unwanted spaces inside HTML tags
  // Pattern: <tag>content </tag> -> <tag>content</tag>
  fixed = fixed.replace(/(<[^/>]+>)([^<]*)\s+(<\/[^>]+>)/g, '$1$2$3');

  // Fix 6: Remove unwanted spaces before self-closing HTML tags
  // Pattern: text <br/> -> text<br/>
  fixed = fixed.replace(/\s+(<[^>]+\/>)/g, '$1');

  // Fix 5: Fix HTML entity encoding for Japanese characters
  // Specifically fix the common case of を being encoded as &#x3092;
  fixed = fixed.replace(/&#x3092;/g, 'を');

  // Fix other common Japanese character encodings if they appear
  fixed = fixed.replace(/&#x([0-9a-fA-F]{4});/g, (match, hex) => {
    const code = parseInt(hex, 16);
    // Only decode Japanese characters (Hiragana, Katakana, Kanji ranges)
    if (
      (code >= 0x3040 && code <= 0x309f) || // Hiragana
      (code >= 0x30a0 && code <= 0x30ff) || // Katakana
      (code >= 0x4e00 && code <= 0x9faf)
    ) {
      // CJK Unified Ideographs
      return String.fromCharCode(code);
    }
    return match;
  });

  return fixed;
}
