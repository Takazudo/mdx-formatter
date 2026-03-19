export type {
  HeaderNavItem,
  ColorModeConfig,
  HtmlPreviewConfig,
  LocaleConfig,
  VersionConfig,
  FooterConfig,
} from './settings-types';
import type {
  HeaderNavItem,
  ColorModeConfig,
  HtmlPreviewConfig,
  LocaleConfig,
  VersionConfig,
  FooterConfig,
} from './settings-types';

export const settings = {
  colorScheme: 'Default Dark',
  colorMode: {
    defaultMode: 'dark',
    lightScheme: 'Default Light',
    darkScheme: 'Default Dark',
    respectPrefersColorScheme: true,
  } satisfies ColorModeConfig,
  siteName: 'mdx-formatter',
  siteDescription: 'AST-based markdown and MDX formatter' as string,
  base: '/',
  trailingSlash: false as boolean,
  noindex: false as boolean,
  editUrl: false as string | false,
  siteUrl: '' as string,
  docsDir: 'src/content/docs',
  locales: {} as Record<string, LocaleConfig>,
  mermaid: true,
  sitemap: false,
  docMetainfo: false,
  docTags: false,
  llmsTxt: true,
  math: false,
  aiAssistant: false as boolean,
  docHistory: true,
  colorTweakPanel: false as boolean,
  htmlPreview: undefined as HtmlPreviewConfig | undefined,
  versions: [] as VersionConfig[],
  claudeResources: { claudeDir: '../.claude', projectRoot: '..' } as { claudeDir: string; projectRoot?: string } | false,
  footer: {
    links: [
      {
        title: 'Docs',
        items: [
          { label: 'Overview', href: '/docs/overview' },
          { label: 'Formatting', href: '/docs/formatting' },
          { label: 'Options', href: '/docs/options' },
        ],
      },
      {
        title: 'Links',
        items: [
          { label: 'GitHub', href: 'https://github.com/Takazudo/mdx-formatter' },
          { label: 'npm', href: 'https://www.npmjs.com/package/@takazudo/mdx-formatter' },
        ],
      },
      {
        title: 'More',
        items: [
          { label: 'Takazudo Modular', href: 'https://takazudomodular.com/' },
        ],
      },
    ],
    copyright: '&copy; 2025 Takazudo. MIT License.',
  } satisfies FooterConfig,
  headerNav: [
    { label: 'Overview', path: '/docs/overview', categoryMatch: 'overview' },
    { label: 'Formatting', path: '/docs/formatting', categoryMatch: 'formatting' },
    { label: 'Options', path: '/docs/options', categoryMatch: 'options' },
    { label: 'Changelog', path: '/docs/changelog', categoryMatch: 'changelog' },
    { label: 'Claude', path: '/docs/claude', categoryMatch: 'claude' },
  ] satisfies HeaderNavItem[],
};
