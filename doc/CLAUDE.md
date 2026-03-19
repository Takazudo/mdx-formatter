# doc/ — zudo-doc Documentation Site

Documentation site built with zudo-doc (Astro-based).

## Dev Commands

```bash
pnpm --dir doc dev               # Dev server on port 3518
pnpm --dir doc dev:network       # Dev server on 0.0.0.0:3518 (network accessible)
pnpm --dir doc build             # Production build
```

## Structure

- `src/content/docs/` — MDX documentation content
  - `overview/` — Installation, usage, API, configuration
  - `formatting/` — Formatting rules documentation
  - `options/` — Per-rule configuration options
  - `architecture/` — Architecture and Rust rewrite docs
  - `changelog/` — Version release notes (descending sort)
  - `claude/`, `claude-md/`, `claude-skills/` — Auto-generated Claude Code resources
- `src/config/settings.ts` — Site configuration (nav, footer, features, color scheme)
- `src/styles/global.css` — Theme tokens and styles (Futura headings, Noto Sans body)
- `src/integrations/claude-resources/` — Auto-generates docs from `.claude/` directory
- `public/img/` — Static assets (logo SVG)

## Features Enabled

- Search (Pagefind), sidebar filter, light/dark theme
- Claude resources integration (CLAUDE.md, skills)
- llms.txt generation, doc history, versioning (empty)
- Futura + Noto Sans JP font stack

## Adding Documentation

- Each category needs `_category_.json` with `label` and `position`
- All MDX files require `title` in frontmatter (schema enforced)
- Changelog uses `sortOrder: "desc"` — higher `sidebar_position` = newer = first
- Header nav is configured in `src/config/settings.ts` → `headerNav`
