// @ts-check

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/**
 * Creating a sidebar enables you to:
 - create an ordered group of docs
 - render a sidebar for each doc of that group
 - provide next/previous navigation

 The sidebars can be generated from the filesystem, or explicitly defined here.

 Create as many sidebars as you want.

 @type {import('@docusaurus/plugin-content-docs').SidebarsConfig}
 */
const sidebars = {
  overviewSidebar: [
    'overview/index',
    'overview/installation',
    'overview/usage',
    'overview/configuration',
    'overview/api',
  ],
  optionsSidebar: [
    'options/index',
    'options/add-empty-line-between-elements',
    'options/format-multi-line-jsx',
    'options/format-html-blocks-in-mdx',
    'options/expand-single-line-jsx',
    'options/indent-jsx-content',
    'options/add-empty-lines-in-block-jsx',
    'options/format-yaml-frontmatter',
    'options/preserve-admonitions',
    'options/auto-detect-indent',
    'options/error-handling',
  ],
  formattingSidebar: [
    'formatting/index',
    'formatting/headings',
    'formatting/lists',
    'formatting/code-blocks',
    'formatting/tables',
    'formatting/japanese-text',
    'formatting/mdx-jsx',
    'formatting/html-blocks',
    'formatting/docusaurus-admonitions',
  ],
  changelogSidebar: ['changelog/index', 'changelog/v0.1.2', 'changelog/v0.1.1', 'changelog/v0.1.0'],
  inboxSidebar: ['inbox/index'],
};

export default sidebars;
