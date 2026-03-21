import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { transformerMetaHighlight, transformerMetaWordHighlight } from '@shikijs/transformers';
import tailwindcss from '@tailwindcss/vite';
import { colorSchemes } from './src/config/color-schemes';
import { settings } from './src/config/settings';
import { searchIndexIntegration } from './src/integrations/search-index';
import remarkDirective from 'remark-directive';
import { remarkAdmonitions } from './src/plugins/remark-admonitions';
import { rehypeCodeTitle } from './src/plugins/rehype-code-title';
import { rehypeHeadingLinks } from './src/plugins/rehype-heading-links';
import { rehypeMermaid } from './src/plugins/rehype-mermaid';
import { rehypeStripMdExtension } from './src/plugins/rehype-strip-md-extension';
import { claudeResourcesIntegration } from './src/integrations/claude-resources';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const activeScheme = colorSchemes[settings.colorScheme];
const shikiTheme = activeScheme?.shikiTheme ?? 'dracula';

const shikiTransformers = [transformerMetaHighlight(), transformerMetaWordHighlight()];

const shikiConfig = settings.colorMode
  ? {
      themes: {
        light: colorSchemes[settings.colorMode.lightScheme]?.shikiTheme ?? 'github-light',
        dark: colorSchemes[settings.colorMode.darkScheme]?.shikiTheme ?? 'dracula',
      },
      defaultColor: false as const,
      transformers: shikiTransformers,
    }
  : {
      theme: shikiTheme,
      transformers: shikiTransformers,
    };

export default defineConfig({
  output: 'static',
  base: settings.base,
  integrations: [
    mdx(),
    react(),
    searchIndexIntegration(),
    ...(settings.claudeResources
      ? [claudeResourcesIntegration(settings.claudeResources)]
      : []),
  ],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        '@takazudo/mdx-formatter/browser': path.resolve(__dirname, '../dist/browser.js'),
      },
    },
  },
  markdown: {
    shikiConfig,
    remarkPlugins: [
      remarkDirective, // Must run before remarkAdmonitions
      remarkAdmonitions,
    ],
    rehypePlugins: [
      rehypeCodeTitle,
      rehypeHeadingLinks, // Must run before Astro's built-in heading ID plugin
      rehypeStripMdExtension,
      ...(settings.mermaid ? [rehypeMermaid] : []),
    ],
  },
});
