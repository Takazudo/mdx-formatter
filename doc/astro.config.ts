import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { transformerMetaHighlight, transformerMetaWordHighlight } from '@shikijs/transformers';
import tailwindcss from '@tailwindcss/vite';
import astroD2 from 'astro-d2';
import { colorSchemes } from './src/config/color-schemes';
import { settings } from './src/config/settings';
import { searchIndexIntegration } from './src/integrations/search-index';
import remarkDirective from 'remark-directive';
import { remarkAdmonitions } from './src/plugins/remark-admonitions';
import { rehypeCodeTitle } from './src/plugins/rehype-code-title';
import { rehypeHeadingLinks } from './src/plugins/rehype-heading-links';
import { rehypeMermaid } from './src/plugins/rehype-mermaid';
import { rehypeStripMdExtension } from './src/plugins/rehype-strip-md-extension';
import { remarkD2Client } from './src/plugins/remark-d2-client';
import { claudeResourcesIntegration } from './src/integrations/claude-resources';

const isDev = import.meta.env?.DEV ?? process.argv.includes('dev');

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
    // In dev: D2 code blocks are rendered client-side via @terrastruct/d2 WASM (instant feedback)
    // In build: astro-d2 generates static SVGs via D2 CLI
    ...(!isDev
      ? [astroD2({ skipGeneration: !!process.env.CI })]
      : []),
    mdx(),
    react(),
    searchIndexIntegration(),
    ...(settings.claudeResources
      ? [claudeResourcesIntegration(settings.claudeResources)]
      : []),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
  markdown: {
    shikiConfig,
    remarkPlugins: [
      // In dev mode, transform D2 code blocks for client-side WASM rendering
      // Must run BEFORE Shiki (which would lose the "d2" language identifier)
      ...(isDev ? [remarkD2Client] : []),
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
