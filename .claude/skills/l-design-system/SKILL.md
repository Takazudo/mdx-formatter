---
name: l-design-system
description: >-
  Design system reference for the mdx-formatter doc site (zudo-doc based).
  Use PROACTIVELY when: (1) Writing or modifying any CSS/styling in doc/,
  (2) Creating or editing zudo-react components in doc/src/components/,
  (3) Adding new pages or layouts to the doc site,
  (4) Reviewing UI changes in the doc site.
  Provides token names, spacing scales, color semantics, and typography rules.
  Do NOT invent custom CSS values — always use the design tokens below.
---

# Doc Site Design System

The site runs zudo-doc 11 on zfb 6. Utilities are compiled by **zudo-wind** (zfb's own utility compiler, not Tailwind) from the tokens the `zudoDoc()` preset declares; components use **zudo-react** (`class`, `on:click`, signals). The site follows zudo-doc's default theme pack, **Graphite** (`<html data-theme-pack="graphite">`). There is no numeric spacing scale: `py-0.5`, `w-14`, `h-3`, `text-sm` and similar Tailwind defaults do not exist and fail `zfb wind audit` (ZW006). Use the named tokens below, an arbitrary value only for one-off geometry (`min-h-[32rem]`), or a small host-prefixed class in `doc/src/styles/global.css`.

Check every class change with `pnpm exec zfb wind audit --project-root . --fail-on error` in `doc/` (CI runs it too), and resolve a single candidate with `pnpm exec zfb wind explain --project-root . -- <class>`.

For full token values, read `references/tokens.md`.

## Colors (semantic — auto light/dark)

| Token                                     | Use                                                      |
| ----------------------------------------- | -------------------------------------------------------- |
| `bg` / `fg`                               | Page background / main text                              |
| `surface`                                 | Panels, cards, elevated backgrounds                      |
| `muted`                                   | Secondary text, labels, placeholders (readable contrast) |
| `accent` / `accent-hover`                 | Links, CTAs, focus rings, hover                          |
| `code-bg` / `code-fg`                     | Code blocks, code textareas, inputs                      |
| `success` / `danger` / `warning` / `info` | Status colors                                            |

**Lines and control borders are not `muted` in Graphite.** Graphite keeps `muted` at text contrast and gives two quieter roles their own colours, inlined in the pack CSS (no public `--zd-*` token):

| Role           | Light     | Dark      | Use                                          |
| -------------- | --------- | --------- | -------------------------------------------- |
| line           | `#D2D8DC` | `#41464D` | Decorative rules, panel outlines, separators |
| control border | `#737D86` | `#858D96` | Inputs, textareas, other necessary controls  |

The playground exposes them as `--fp-line` / `--fp-control-border` with the `fp-line` and `fp-control` classes in `global.css` (falling back to `muted` at 30% under other packs). Reuse those instead of `border-muted/30`.

## Spacing

**Horizontal (hsp):** `2xs`(2px) `xs`(6px) `sm`(8px) `md`(12px) `lg`(16px) `xl`(24px) `2xl`(32px)

**Vertical (vsp):** `3xs`(4px) `2xs`(7px) `xs`(14px) `sm`(20px) `md`(24px) `lg`(28px) `xl`(40px) `2xl`(56px)

**Icons:** `icon-xs`(12px) `icon-sm`(16px) `icon-md`(20px) `icon-lg`(24px)

Usage: `px-hsp-md`, `py-vsp-sm`, `gap-hsp-xs`, `gap-vsp-md`, `h-icon-sm w-icon-sm`

## Typography

| Token          | Size   | Use                               |
| -------------- | ------ | --------------------------------- |
| `text-micro`   | 12px   | Compact panel labels              |
| `text-caption` | 14px   | Labels, small UI, buttons, inputs |
| `text-small`   | 16px   | Nav, table headers, code blocks   |
| `text-body`    | 19.2px | Paragraphs, main content          |
| `text-title`   | 22.4px | Card titles, section labels       |
| `text-heading` | 48px   | Page headings                     |
| `text-display` | 60px   | Hero text                         |

**Fonts:** `font-sans` (system UI; Graphite loads no web fonts), `font-mono` (code)

**Line heights:** `leading-none`(1) `leading-tight`(1.25) `leading-snug`(1.375) `leading-normal`(1.5) `leading-relaxed`(1.625)

**Weights:** `font-normal`(400) `font-medium`(500) `font-semibold`(600) `font-bold`(700)

## Radius & Breakpoints

**Radius:** `rounded`(4px) `rounded-lg`(8px) `rounded-full`(pill)

**Breakpoints:** `sm:`(640px) `lg:`(1024px, sidebar) `xl:`(1280px)

## Common Patterns

```
// Button (primary)
rounded-lg bg-accent px-hsp-xl py-hsp-xs text-caption font-semibold text-bg

// Panel/card
fp-line rounded-lg border bg-surface p-hsp-md

// Input field
fp-control rounded border bg-code-bg px-hsp-xs py-hsp-2xs text-caption text-fg focus:border-accent

// Label
text-caption font-semibold text-muted

// Code textarea
fp-control rounded-lg border bg-code-bg p-hsp-md font-mono text-caption leading-relaxed text-code-fg

// Section gap
gap-vsp-sm (between sections), gap-vsp-2xs (within section)
```

## Components

Islands are zudo-react components in a `"use client"` module: `class` (not `className`), `on:click` / `on:input`, `for` (not `htmlFor`), `signal()` / `computed()` created once at setup, `<Show when={signal}>{() => …}</Show>` for conditional regions, `modelValue` / `modelChecked` for text and checkbox controls (number inputs have no model). Register an MDX island in `src/chrome-bindings.tsx` with the Fragment-wrapped fixed-target wrapper; a bare-return wrapper stored in `mdxExtras` fails the island scanner.

## SVG Icons

Use explicit `width`/`height` attributes or the `icon-*` size tokens. Add `shrink-0` in flex.

```tsx
<svg width="12" height="12" class="shrink-0" viewBox="0 0 12 12" fill="currentColor">
```

## Key Source Files

Package tokens: `doc/node_modules/@takazudo/zudo-doc/dist/theme.css`; Graphite palette: `dist/theme-packs/graphite/pack.css` in the same package. Host overrides and playground classes: `doc/src/styles/global.css`.
