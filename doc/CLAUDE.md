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

## Styling

Before writing or modifying any CSS, components, or layouts in `doc/`, invoke `/l-design-system` to load the design token reference. The doc site uses a **tight token strategy** (Tailwind v4 with no default theme) — default Tailwind classes like `h-3`, `w-4`, `text-sm` do not exist. Always use the project's semantic tokens (`text-caption`, `px-hsp-md`, `bg-surface`, etc.).

## Adding Documentation

- Each category needs `_category_.json` with `label` and `position`
- All MDX files require `title` in frontmatter (schema enforced)
- Changelog uses `sortOrder: "desc"` — higher `sidebar_position` = newer = first
- Header nav is configured in `src/config/settings.ts` → `headerNav`
