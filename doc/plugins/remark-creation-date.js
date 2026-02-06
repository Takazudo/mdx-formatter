const { execSync } = require('child_process');
const path = require('path');

function getGitCreationDate(filePath) {
  try {
    // Find git root directory
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: path.dirname(filePath),
      encoding: 'utf8',
    }).trim();

    // Get relative path from git root
    const relativePath = path.relative(gitRoot, filePath);

    // Get the first commit timestamp for this file
    // Use git's -n 1 with --reverse to get the first commit (cross-platform, no need for head)
    // Use --all to search across all branches (important for worktrees and feature branches)
    const output = execSync(
      `git log --all --follow --format=%at --reverse -n 1 -- "${relativePath}"`,
      {
        cwd: gitRoot,
        encoding: 'utf8',
      },
    ).trim();

    const timestamp = output.split('\n')[0]; // Take first line if multiple exist

    if (!timestamp) {
      return null;
    }

    const date = new Date(parseInt(timestamp) * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return {
      formatted: `${year}/${month}/${day}`,
      timestamp: date.getTime(),
    };
  } catch (error) {
    console.warn(`Could not extract creation date for ${filePath}: ${error.message}`);
    return null;
  }
}

// Remark plugin to inject creation date into frontmatter
function remarkCreationDate() {
  return async (tree, vfile) => {
    const filePath = vfile.history[0];
    if (!filePath) return;

    const creationDate = getGitCreationDate(filePath);
    if (creationDate) {
      // Inject into vfile data that Docusaurus will use
      vfile.data = vfile.data || {};
      vfile.data.frontMatter = vfile.data.frontMatter || {};
      vfile.data.frontMatter.custom_creation_date = creationDate.formatted;
      vfile.data.frontMatter.custom_creation_timestamp = creationDate.timestamp;
    }
  };
}

module.exports = remarkCreationDate;
