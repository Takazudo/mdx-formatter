/**
 * Plugin to fix paragraph and JSX spacing issues
 * This runs as a post-processing step after stringify
 */
export function fixParagraphSpacing(content: string): string {
  let fixed = content;

  // Fix 0: Split collapsed JSX components (most critical fix)
  // Pattern: /><Component should be />\n\n<Component
  // Use a loop to handle all occurrences (in case of multiple collapsed components)
  let previousFixed = '';
  while (previousFixed !== fixed) {
    previousFixed = fixed;
    fixed = fixed.replace(/(\/>)(<[A-Z][^>]*>)/g, '$1\n\n$2');
  }

  // Fix 1: Ensure blank lines between paragraphs
  // Split content by lines and process
  const lines = fixed.split('\n');
  const processedLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];

    processedLines.push(line);

    // Check if we need to add a blank line
    if (line && nextLine && i < lines.length - 1) {
      const currentEndsWithText = /[。！？\.!?）\]】a-zA-Z0-9]$/.test(line.trim());
      const nextStartsWithJSX = /^<[A-Z]/.test(nextLine.trim());

      // Add blank line between text and JSX components
      if (currentEndsWithText && nextStartsWithJSX) {
        processedLines.push('');
      }
      // Add blank line between heading and content
      else if (/^#{1,6} /.test(line.trim()) && nextLine.trim() && !lines[i - 1]?.trim()) {
        processedLines.push('');
      }
      // Add blank line between import/export and other content
      else if (
        (line.trim().startsWith('import ') || line.trim().startsWith('export ')) &&
        nextLine.trim() &&
        !nextLine.trim().startsWith('import ') &&
        !nextLine.trim().startsWith('export ')
      ) {
        processedLines.push('');
      }
    }
  }

  fixed = processedLines.join('\n');

  // Fix 2: Ensure JSX components are not merged with text on same line
  // Pattern: text<Component should be text\n\n<Component
  fixed = fixed.replace(/([。！？\.!?）\]】a-zA-Z0-9])(<[A-Z][^>]*>)/g, '$1\n\n$2');

  // Fix 3: Ensure import statements are not merged with JSX
  fixed = fixed.replace(/(import [^;]+;)(<[A-Z])/g, '$1\n\n$2');

  // Fix 4: Ensure headings are not merged with content
  fixed = fixed.replace(/(^#{1,6} [^\n]+)(<[A-Z])/gm, '$1\n\n$2');

  // Fix 5: Split merged paragraphs (Japanese text specific)
  // Pattern: 。text should be 。\ntext when it's a new sentence
  fixed = fixed.replace(
    /([。！？])([ぁ-んァ-ヶー一-龠]+)/g,
    (match, punct: string, text: string) => {
      // Check if the text after punctuation looks like a new sentence
      // (starts with a capital-like character or common sentence starters)
      if (/^[こそたなはまやらわがざだばぱ]/.test(text)) {
        return `${punct}\n${text}`;
      }
      return match;
    },
  );

  // Fix 6: Preserve space after question mark in Japanese
  fixed = fixed.replace(/([？！])([^ \n])/g, '$1 $2');

  // Fix 7: Clean up excessive blank lines (more than 2 consecutive)
  fixed = fixed.replace(/\n{4,}/g, '\n\n\n');

  // Fix 8: Fix JSX indentation issues
  // When we have closing tags that lost one space of indentation
  fixed = fixed.replace(/\n( +)<\/([A-Z][^>]+)>/g, (match, spaces: string, tag: string) => {
    // Check if the opening tag had more indentation
    const openingPattern = new RegExp(`\\n(\\s+)<${tag}[^>]*>`, 'g');
    const openingMatch = fixed.match(openingPattern);
    if (openingMatch && openingMatch[0]) {
      const openingSpacesMatch = openingMatch[0].match(/\n(\s+)</);
      if (openingSpacesMatch) {
        const openingSpaces = openingSpacesMatch[1];
        if (openingSpaces.length === spaces.length + 1) {
          // The opening tag has one more space, so add it to closing tag
          return '\n' + spaces + ' </' + tag + '>';
        }
      }
    }
    return match;
  });

  // Fix 9: Fix Outro component spacing specifically
  // Ensure content inside Outro has proper spacing
  fixed = fixed.replace(/<Outro>([\s\S]*?)<\/Outro>/g, (match, content: string) => {
    // Check if there's content
    const trimmedContent = content.trim();
    if (trimmedContent) {
      // Ensure double newlines before and after content
      return '<Outro>\n\n' + trimmedContent + '\n\n</Outro>';
    }
    return match;
  });

  return fixed;
}
