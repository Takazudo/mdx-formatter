// @ts-check
import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'mdx-formatter',
  tagline: 'AST-based markdown and MDX formatter with Japanese text support',
  favicon: 'img/favicon.ico',

  // Future flags
  future: {
    v4: true,
  },

  // Set the production url of your site here
  url: 'https://takazudomodular.com',
  baseUrl: '/pj/mdx-formatter/',

  // Don't add trailing slash
  trailingSlash: false,

  onBrokenLinks: 'throw',

  // English locale
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Enable Mermaid diagrams
  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: '/docs',
          editUrl: undefined,
          // Show last update time and author from git history
          showLastUpdateTime: true,
          showLastUpdateAuthor: true,
          // Add remark plugin to inject creation dates
          beforeDefaultRemarkPlugins: [[require('./plugins/remark-creation-date.js'), {}]],
        },
        // Disable blog feature
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Force dark mode and disable theme switching
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: true,
        respectPrefersColorScheme: false,
      },
      navbar: {
        title: 'mdx-formatter',
        items: [
          {
            type: 'doc',
            docId: 'overview/index',
            position: 'left',
            label: 'Overview',
          },
          {
            type: 'doc',
            docId: 'formatting/index',
            position: 'left',
            label: 'Formatting',
          },
          {
            type: 'doc',
            docId: 'options/index',
            position: 'left',
            label: 'Options',
          },
          {
            type: 'doc',
            docId: 'inbox/index',
            position: 'left',
            label: 'INBOX',
          },
          {
            type: 'html',
            position: 'right',
            value:
              '<a href="https://takazudomodular.com/" class="navbar__takazudo-modular" rel="noopener noreferrer"><img src="/pj/mdx-formatter/img/logo.svg" alt="" /><span>Takazudo Modular</span></a>',
          },
        ],
      },
      footer: {
        style: 'dark',
        copyright: `Copyright © ${new Date().getFullYear()} Takazudo. Documentation built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.oneDark,
      },
    }),
};

export default config;
