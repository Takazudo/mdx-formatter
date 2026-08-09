import { defineConfig } from "zfb/config";
import { zudoDoc } from "@takazudo/zudo-doc/config";

export default defineConfig(
  zudoDoc({
    siteName: "mdx-formatter",
    siteDescription: "AST-based markdown and MDX formatter",
    base: "/pj/mdx-formatter/",
    siteUrl: "https://takazudomodular.com",
    githubUrl: "https://github.com/Takazudo/mdx-formatter",
    entryDocSlug: "overview",
    logo: "/img/logo.svg",
    locales: {
      ja: {
        label: "JA",
        dir: "src/content/docs-ja",
      },
    },
    metaTags: {
      description: true,
      keywords: "mdx, md, fromatter, markdown, Node.js, Rust",
      ogImage: "/img/ogp.png",
      ogSiteName: true,
      twitterCard: "summary",
      twitterCreator: "@Takazudo",
    },
    llmsTxt: true,
    cjkFriendly: true,
    sidebarResizer: true,
    sidebarToggle: true,
    tocToggle: true,
    imageEnlarge: true,
    dynamicPageTransition: true,
    docHistory: true,
    versions: [
      {
        slug: "0x",
        label: "0.x (TypeScript engine)",
        docsDir: "src/content/docs-v-0x",
        banner: "unmaintained",
      },
    ],
    claudeResources: {
      claudeDir: "../.claude",
      scanRoot: "..",
    },
    defaultLocaleOnlyPrefixes: [
      "/docs/claude-md/",
      "/docs/claude-skills/",
      "/docs/claude-agents/",
      "/docs/claude-commands/",
    ],
    footer: {
      links: [
        {
          title: "Docs",
          items: [
            { label: "Overview", href: "/docs/overview" },
            { label: "Formatting", href: "/docs/formatting" },
            { label: "Options", href: "/docs/options" },
          ],
        },
        {
          title: "Links",
          items: [
            { label: "GitHub", href: "https://github.com/Takazudo/mdx-formatter" },
            { label: "npm", href: "https://www.npmjs.com/package/@takazudo/mdx-formatter" },
          ],
        },
        {
          title: "More",
          items: [
            { label: "Takazudo Modular", href: "https://takazudomodular.com/" },
            { label: "zudo-paper", href: "https://takazudomodular.com/pj/zpaper/" },
          ],
        },
      ],
      copyright:
        'Copyright &copy; 2026 Takazudo. Built with <a href="https://takazudomodular.com/pj/zudo-doc">zudo-doc</a>.',
    },
    headerNav: [
      {
        label: "Overview",
        path: "/docs/overview",
        categoryMatch: "overview",
      },
      {
        label: "Playground",
        path: "/docs/playground",
        categoryMatch: "playground",
      },
      {
        label: "Formatting",
        path: "/docs/formatting",
        categoryMatch: "formatting",
      },
      {
        label: "Options",
        path: "/docs/options",
        categoryMatch: "options",
      },
      {
        label: "Architecture",
        path: "/docs/architecture",
        categoryMatch: "architecture",
      },
      {
        label: "Changelog",
        path: "/docs/changelog",
        categoryMatch: "changelog",
      },
      {
        label: "Claude",
        path: "/docs/claude",
        categoryMatch: "claude",
      },
    ],
    headerRightItems: [
      {
        type: "component",
        component: "version-switcher",
      },
      {
        type: "component",
        component: "github-link",
      },
      {
        type: "component",
        component: "theme-toggle",
      },
      {
        type: "component",
        component: "search",
      },
      {
        type: "component",
        component: "language-switcher",
      },
    ],
  }),
);
