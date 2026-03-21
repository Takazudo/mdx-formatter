---
name: l-design-system
description: >-
  Design system reference for the mdx-formatter doc site (zudo-doc based).
  Use PROACTIVELY when: (1) Writing or modifying any CSS/styling in doc/,
  (2) Creating or editing React components in doc/src/components/,
  (3) Adding new pages or layouts to the doc site,
  (4) Reviewing UI changes in the doc site.
  Provides token names, spacing scales, color semantics, and typography rules.
  Do NOT invent custom CSS values — always use the design tokens below.
---

# Doc Site Design System

Tight token strategy: Tailwind v4 with NO default theme. Only project tokens via `@theme` in `doc/src/styles/global.css`. Never use raw pixel/rem values or default Tailwind classes like `h-3`, `w-4`, `text-sm` — they don't exist.

For full token values, read `references/tokens.md`.

## Colors (semantic — auto light/dark)

| Token | Use |
| --- | --- |
| `bg` / `fg` | Page background / main text |
| `surface` | Panels, cards, elevated backgrounds |
| `muted` | Borders, secondary text, disabled. Use `muted/30` for subtle borders |
| `accent` / `accent-hover` | Links, CTAs, focus rings, hover |
| `code-bg` / `code-fg` | Code blocks and inline code |
| `success` / `danger` / `warning` / `info` | Status colors |

## Spacing

**Horizontal (hsp):** `2xs`(2px) `xs`(6px) `sm`(8px) `md`(12px) `lg`(16px) `xl`(24px) `2xl`(32px)

**Vertical (vsp):** `2xs`(7px) `xs`(14px) `sm`(20px) `md`(24px) `lg`(28px) `xl`(40px) `2xl`(56px)

Usage: `px-hsp-md`, `py-vsp-sm`, `gap-hsp-xs`, `gap-vsp-md`, `gap-x-hsp-md`, `gap-y-vsp-xs`

## Typography

| Token | Size | Use |
| --- | --- | --- |
| `text-caption` | 14px | Labels, small UI, buttons, inputs |
| `text-small` | 16px | Nav, table headers, code blocks |
| `text-body` | 19.2px | Paragraphs, main content |
| `text-subheading` | 22.4px | Card titles, h3 |
| `text-heading` | 48px | Page headings |
| `text-display` | 60px | Hero text |

**Fonts:** `font-sans` (Noto Sans JP), `font-futura` (headings/nav), `font-mono` (code)

**Line heights:** `leading-tight`(1.25) `leading-snug`(1.375) `leading-normal`(1.5) `leading-relaxed`(1.625)

**Weights:** `font-normal`(400) `font-medium`(500) `font-semibold`(600) `font-bold`(700)

## Radius & Breakpoints

**Radius:** `rounded`(4px) `rounded-lg`(8px) `rounded-full`(pill)

**Breakpoints:** `sm:`(640px) `lg:`(1024px, sidebar) `xl:`(1280px)

## Common Patterns

```
// Button (primary)
rounded-lg bg-accent px-hsp-xl py-hsp-xs text-caption font-semibold text-bg

// Panel/card
rounded-lg border border-muted/30 bg-surface p-hsp-md

// Input field
rounded border border-muted/30 bg-code-bg px-hsp-xs py-0.5 text-caption text-fg

// Label
text-caption font-semibold text-muted

// Code textarea
bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg

// Section gap
gap-vsp-sm (between sections), gap-vsp-2xs (within section)
```

## SVG Icons

Always use explicit `width`/`height` attributes — Tailwind size classes (`h-N`/`w-N`) don't exist. Add `shrink-0` in flex.

```tsx
<svg width="12" height="12" className="shrink-0" viewBox="0 0 12 12" fill="currentColor">
```

## Key Source File

All tokens are defined in `doc/src/styles/global.css`. When in doubt, read it.
