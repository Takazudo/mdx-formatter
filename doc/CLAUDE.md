# doc/ — Docusaurus Documentation Site

## Setup

This is a separate pnpm workspace. Install and build independently:

```bash
cd doc && pnpm install
pnpm start           # Dev server at http://mdx-formatter.localhost:33771
pnpm build           # Production build (runs generate scripts first)
```

## Structure

- `docs/` — Markdown/MDX content organized by category: `overview/`, `options/`, `formatting/`, `changelog/`, `inbox/`
- `src/components/` — Custom React components (`CategoryNav`, `DocsSitemap`)
- `src/data/` — Auto-generated JSON (`doc-titles.json`, `category-nav.json`) — do not edit manually
- `scripts/` — Node.js generators that run before build:
  - `generate-doc-titles.js` — Extracts titles from all docs into `src/data/doc-titles.json`
  - `generate-category-nav.js` — Builds category navigation data into `src/data/category-nav.json`
- `plugins/` — Custom remark plugins (e.g., `remark-creation-date.js`)

## Sidebar Convention

Each doc category has its own sidebar in `sidebars.js` (e.g., `overviewSidebar`, `optionsSidebar`, `changelogSidebar`). Navbar items in `docusaurus.config.js` link to each category's `index` doc.

## Adding a New Category

1. Create `docs/{category}/index.mdx` with `sidebar_position` and `CategoryNav` component
2. Add `{category}Sidebar` array to `sidebars.js`
3. Add navbar item to `docusaurus.config.js`
4. Add entry to `CATEGORY_STRUCTURE` in `scripts/generate-category-nav.js`

## Adding a Changelog Entry

Use the `/l-version-increment` skill, which automates creating the changelog doc, updating `sidebars.js`, and regenerating category nav.
