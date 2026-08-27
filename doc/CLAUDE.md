# mdx-formatter Documentation Site

Documentation site built with [zudo-doc](https://github.com/zudolab/zudo-doc) 5.13.0 — a zfb-based documentation framework with MDX, Tailwind CSS v4, and Preact islands. This project is intentionally minimal: one config file (`zfb.config.ts`) plus markdown content — layout, chrome, and islands all ship from `@takazudo/zudo-doc` in `node_modules`. Node.js >= 22 is required.

## Tech Stack

- **zfb** — documentation build framework
- **MDX** — content format, authored under `src/content/`
- **Tailwind CSS v4** — compiled by zfb's embedded Tailwind engine (no `@tailwindcss/vite` plugin, no `tailwindcss` dependency); `src/styles/global.css` imports `tailwindcss/preflight` + `tailwindcss/utilities` and zfb's internal resolver serves both
- **Preact** — for interactive islands only (with compat mode for React API)
- **zfb semantic highlighting** — native build-time fenced-code rendering plus lazy `@takazudo/zfb-md-wasm` for HtmlPreview; both emit `hi-*` classes resolved through `--zd-syntax-*` design tokens
- **@takazudo/zudo-doc** — the package that owns everything: layout, chrome, islands, default `@theme` design tokens, and (via `packageOwnedRoutes`, on by default) the doc routes themselves

## Commands

- `pnpm dev` — runs the zfb dev server (port 4321) and the doc-history API server (port 4322) concurrently via `run-p` (`pnpm dev:zfb` / `pnpm dev:history` individually)
- `pnpm dev:network` — same, but zfb binds `--host 0.0.0.0` for LAN access (`pnpm dev:zfb:network` individually); the doc-history server stays loopback-only and LAN clients reach it through zfb's `/doc-history/*` dev proxy
- **Trusted networks only:** this also serves your git doc-history — including UNPUBLISHED local commits — to anyone on the LAN via the `/doc-history/*` proxy
- `run-p` swallows trailing args, so other zfb flags don't forward through `pnpm dev` — pass them directly instead: `pnpm run dev:zfb -- <flags>`
- `pnpm build` — runs `zfb build` for a static HTML export to `dist/`
- `pnpm check` — runs `zfb check` for type and content checking
- `pnpm preview` — runs `zfb preview` to serve the built `dist/`

The 5.13 scaffold's `scripts/check-links.js` is intentionally not adopted in
this in-place upgrade: strict use would require a separate content/allowlist
policy for the existing link warnings, while `zfb build` remains the current
link-validation gate for this site.

The formatter playground loads project-owned WASM files from `public/wasm/`.
From the repository root, run `pnpm build:wasm:doc` before using the playground
locally. The docs CI action performs this step before `zfb build`.

## Key Directories

```
zfb.config.ts             # THE one config file — zudoDoc({ ...only fields you chose })
pages/
├── index.tsx             # 1-line re-export of the package home route
└── docs/[[...slug]].tsx  # self-contained doc-route stub (required for `pnpm dev`)
  [locale]/docs/[[...slug]].tsx  # same, for non-default locales
src/
├── chrome-bindings.tsx   # optional typed primary chrome / named header / MDX bindings
├── content/
│   ├── docs/             # mdx-formatter's default-locale MDX content
│   ├── docs-ja/          # Japanese MDX content (partial; EN fallback fills gaps)
│   └── docs-v-0x/        # archived TypeScript-engine documentation
└── styles/
    └── global.css        # @import chain + a token-override slot — that's it
```

Everything else — layout, header, sidebar, footer, doc chrome, islands, and the default design tokens — lives in `node_modules/@takazudo/zudo-doc`. For supported markup replacement, create `src/chrome-bindings.tsx` with `defineChromeBindings`, set `chromeBindingsModule`, and use the primary `Header` / `Footer` / `Sidebar` / `Toc` / `Breadcrumb` / `DocPager` slots or the named `headerRightComponents` registry. The generated default, locale, and doc-history route shapes already consume the same binding object; do not fork a route stub for presentational customization. `npx zudo-doc eject <component>` only copies source: heed its primary, nested-chrome, or content-layer remediation before expecting the copy to render. Settings you didn't set explicitly in `zfb.config.ts` use the package's documented defaults — hover `zudoDoc`'s `ZudoDocConfig` argument in your editor to see every field and its `@default`.

## Content Conventions

### Frontmatter

- Required: `title` (string)
- Optional: `description`, `sidebar_position` (number), `category`
- Sidebar order is driven by `sidebar_position`

### Admonitions

Available in all MDX files without imports, via directive syntax: `:::note`, `:::tip`, `:::info`, `:::warning`, `:::danger`, `:::caution`, `:::details`. Each accepts an optional **bracketed** title: `:::note[Custom Title]`.

Docusaurus-style `{title="..."}` is **NOT supported**. MDX parses the braces as a JS expression, so it either fails the build with `ReferenceError: title is not defined` or is silently ignored. Always use the bracketed form.

### Headings

Do NOT use h1 (`#`) in doc content — the page title from frontmatter is rendered as h1. Start content headings from h2 (`##`).

### Built-in MDX components

`@takazudo/zudo-doc` ships a few **globally-available MDX components** — usable in any `.mdx` file with **no import**. The Japanese overview index uses one:

- `<CategoryNav category="..." />` — a card-grid list of the pages in a docs category (used by `src/content/docs-ja/overview/index.mdx`).
- `<CategoryTreeNav category="..." />` — the same listing as a compact nested tree, better for deeper hierarchies.
- `<SiteTreeNavDemo />` — a full-site documentation tree (the MDX-available wrapper of the `SiteTreeNav` island).

Admonitions (above), tabbed content (`<Tabs>` / `<TabItem>`, `<CodeGroup>`), and block math (`<MathBlock>`) work the same way — no import. Full reference: https://zudo-doc.takazudomodular.com/docs/components/

## i18n

- English (default): `/docs/...` — content in `src/content/docs/`
- Japanese: `/ja/docs/...` — content in `src/content/docs-ja/`
- Japanese docs should mirror the English directory structure
- Both `pages/docs/[[...slug]].tsx` and `pages/[locale]/docs/[[...slug]].tsx` are self-contained doc-route stubs shipped by the generator — required so `pnpm dev` doesn't 404 on doc pages (a zfb dev-mode limitation on package-injected dynamic routes). Don't delete them.

## Enabled Features

- **claudeResources** — Auto-generated docs for Claude Code resources
- **sidebarResizer** — Draggable sidebar width
- **sidebarToggle** — Show/hide desktop sidebar
- **versioning** — Multi-version documentation support
- **docHistory** — Document edit history
- **llmsTxt** — Generates llms.txt for LLM consumption
- **changelog** — Changelog page at `/docs/changelog`
