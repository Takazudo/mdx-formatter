/**
 * Pre-processing plugin to normalize Japanese text before parsing
 * This runs on the raw text before the markdown parser
 */
export function preprocessJapanesePlugin() {
  return function (tree, file) {
    // Work on the raw content before parsing
    const content = String(file);

    // Convert Japanese parentheses with URLs to standard markdown links
    const urlInParensPattern = /([^（）]+)（(https?:\/\/[^）]+)）/g;
    const processed = content.replace(urlInParensPattern, '[$1]($2)');

    // Update the file content
    file.value = processed;
  };
}
