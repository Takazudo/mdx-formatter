#!/usr/bin/env node
/**
 * Generate category-nav.json for auto-generating navigation lists in category index pages
 * Separate from generate-doc-titles.js - this is a standalone feature
 * Supports nested subcategories with ul > li > ul > li structure
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const DOCS_DIR = path.join(__dirname, '../docs');
const OUTPUT_FILE = path.join(__dirname, '../src/data/category-nav.json');

// Top-level categories and their subcategories
// Add subcategory folder names to the array to enable nested navigation
const CATEGORY_STRUCTURE = {
  overview: [],
  options: [],
  formatting: [],
  changelog: [],
  inbox: [],
};

/**
 * Find all .md and .mdx files in a specific directory (non-recursive)
 */
function findMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const files = fs.readdirSync(dirPath);
  return files
    .filter((file) => {
      const filePath = path.join(dirPath, file);
      const stat = fs.statSync(filePath);
      return stat.isFile() && (file.endsWith('.md') || file.endsWith('.mdx'));
    })
    .map((file) => path.join(dirPath, file));
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
 * Extract sidebar_position from frontmatter (for sorting)
 */
function extractSidebarPosition(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  try {
    const { data } = matter(content);
    if (typeof data.sidebar_position === 'number') {
      return data.sidebar_position;
    }
  } catch (e) {
    // Ignore errors
  }

  return 999; // Default to end
}

/**
 * Get doc ID from file path (relative to docs dir, without extension)
 */
function getDocId(filePath) {
  const relativePath = path.relative(DOCS_DIR, filePath);
  return relativePath.replace(/\.(md|mdx)$/, '').replace(/\\/g, '/');
}

/**
 * Check if file is an index file
 */
function isIndexFile(filePath) {
  const fileName = path.basename(filePath);
  return fileName === 'index.md' || fileName === 'index.mdx';
}

/**
 * Get pages for a directory
 */
function getPagesForDirectory(dirPath) {
  const files = findMarkdownFiles(dirPath);

  return files
    .filter((filePath) => !isIndexFile(filePath))
    .map((filePath) => {
      const docId = getDocId(filePath);
      const title = extractTitle(filePath);
      const position = extractSidebarPosition(filePath);

      return {
        docId,
        title: title || docId,
        position,
      };
    })
    .sort((a, b) => a.position - b.position);
}

/**
 * Get index file info for a directory
 */
function getIndexInfo(dirPath) {
  const indexMd = path.join(dirPath, 'index.md');
  const indexMdx = path.join(dirPath, 'index.mdx');

  let indexPath = null;
  if (fs.existsSync(indexMdx)) {
    indexPath = indexMdx;
  } else if (fs.existsSync(indexMd)) {
    indexPath = indexMd;
  }

  if (!indexPath) {
    return null;
  }

  const docId = getDocId(indexPath);
  const title = extractTitle(indexPath);
  const position = extractSidebarPosition(indexPath);

  return {
    docId,
    title: title || docId,
    position,
  };
}

function main() {
  console.log('Generating category-nav.json...');

  const categoryNav = {};

  Object.entries(CATEGORY_STRUCTURE).forEach(([category, subcategories]) => {
    const categoryDir = path.join(DOCS_DIR, category);
    const pages = getPagesForDirectory(categoryDir);

    const subcats = subcategories
      .map((subcat) => {
        const subcatDir = path.join(categoryDir, subcat);
        const indexInfo = getIndexInfo(subcatDir);
        const subcatPages = getPagesForDirectory(subcatDir);

        if (!indexInfo && subcatPages.length === 0) {
          return null;
        }

        return {
          key: subcat,
          title: indexInfo?.title || subcat,
          docId: indexInfo?.docId || `${category}/${subcat}/index`,
          position: indexInfo?.position || 999,
          pages: subcatPages,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.position - b.position);

    categoryNav[category] = {
      pages,
      subcategories: subcats,
    };

    const totalPages = pages.length + subcats.reduce((sum, s) => sum + s.pages.length, 0);
    console.log(
      `  ${category}: ${pages.length} pages, ${subcats.length} subcategories (${totalPages} total)`,
    );
  });

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write JSON file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(categoryNav, null, 2) + '\n');

  console.log(`\n✅ Generated ${OUTPUT_FILE}`);
}

main();
