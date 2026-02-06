#!/usr/bin/env node
/**
 * Generate doc-titles.json by reading all markdown files in docs/
 * Extracts titles from frontmatter or H1 headings
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DOCS_DIR = path.join(__dirname, '../docs');
const OUTPUT_FILE = path.join(__dirname, '../src/data/doc-titles.json');

/**
 * Recursively find all .md and .mdx files
 */
function findMarkdownFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip hidden directories and special Docusaurus directories
      if (!file.startsWith('.') && !file.startsWith('_')) {
        findMarkdownFiles(filePath, fileList);
      }
    } else if (file.endsWith('.md') || file.endsWith('.mdx')) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

/**
 * Extract title from markdown file
 */
function extractTitle(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  // Try frontmatter first
  try {
    const { data } = matter(content);
    if (data.title) {
      return data.title;
    }
  } catch (e) {
    // Ignore frontmatter errors
  }

  // Fall back to first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1].trim();
  }

  return null;
}

/**
 * Convert file path to doc ID
 */
function getDocId(filePath) {
  const relativePath = path.relative(DOCS_DIR, filePath);
  // Remove extension and convert to doc ID format
  return relativePath.replace(/\.(md|mdx)$/, '').replace(/\\/g, '/');
}

function main() {
  console.log('Generating doc-titles.json...');

  const markdownFiles = findMarkdownFiles(DOCS_DIR);
  const docTitles = {};

  markdownFiles.forEach((filePath) => {
    const docId = getDocId(filePath);
    const title = extractTitle(filePath);

    if (title) {
      docTitles[docId] = title;
      console.log(`  ${docId} → ${title}`);
    } else {
      console.warn(`  ⚠️  No title found for ${docId}`);
    }
  });

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(docTitles, null, 2) + '\n');

  console.log(`\n✅ Generated ${OUTPUT_FILE}`);
  console.log(`   Total: ${Object.keys(docTitles).length} documents`);
}

main();
