# Full Token Reference

Sources of truth (zudo-doc 11.0.0, Graphite theme pack):

- Package tokens: `doc/node_modules/@takazudo/zudo-doc/dist/theme.css` (plain `:root` custom properties; the `zudoDoc()` preset maps them to zudo-wind utility tokens)
- Graphite palette and line/control-border roles: `doc/node_modules/@takazudo/zudo-doc/dist/theme-packs/graphite/pack.css`
- Host overrides and playground classes: `doc/src/styles/global.css` (`:root {}` slot)

zudo-wind has no numeric spacing unit in this preset: only the named tokens below generate CSS.

## Horizontal Spacing (hsp)

| Token     | Value          | Typical use                     |
| --------- | -------------- | ------------------------------- |
| `hsp-2xs` | 0.125rem (2px) | Tight inline padding            |
| `hsp-xs`  | 0.375rem (6px) | Compact inline gaps             |
| `hsp-sm`  | 0.5rem (8px)   | Small buttons, small padding    |
| `hsp-md`  | 0.75rem (12px) | Default gaps, list items        |
| `hsp-lg`  | 1rem (16px)    | Standard padding, larger gaps   |
| `hsp-xl`  | 1.5rem (24px)  | Generous padding, content edges |
| `hsp-2xl` | 2rem (32px)    | Large padding blocks            |

## Vertical Spacing (vsp)

| Token     | Value           | Typical use                 |
| --------- | --------------- | --------------------------- |
| `vsp-3xs` | 0.25rem (4px)   | Hairline gaps               |
| `vsp-2xs` | 0.4375rem (7px) | Tight gaps                  |
| `vsp-xs`  | 0.875rem (14px) | Small gaps, list items      |
| `vsp-sm`  | 1.25rem (20px)  | Compact sections            |
| `vsp-md`  | 1.5rem (24px)   | Standard gap between blocks |
| `vsp-lg`  | 1.75rem (28px)  | Section-to-section gap      |
| `vsp-xl`  | 2.5rem (40px)   | Large section gap           |
| `vsp-2xl` | 3.5rem (56px)   | Page-level breaks           |

## Icon Sizes

| Token     | Value          |
| --------- | -------------- |
| `icon-xs` | 0.75rem (12px) |
| `icon-sm` | 1rem (16px)    |
| `icon-md` | 1.25rem (20px) |
| `icon-lg` | 1.5rem (24px)  |

## Semantic Colors (Graphite)

Each `--zd-*` role is set with `light-dark(light, dark)` on `html[data-theme-pack="graphite"]`; utilities read them through `--color-*`.

| Token          | Light     | Dark      | Use                                  |
| -------------- | --------- | --------- | ------------------------------------ |
| `bg`           | `#F2F3F2` | `#242629` | Page background                      |
| `fg`           | `#3A4146` | `#D3D5D9` | Main text                            |
| `surface`      | `#E8EBEA` | `#2D3034` | Panels, cards, header/footer         |
| `muted`        | `#566168` | `#ADB2B8` | Secondary text, labels, placeholders |
| `accent`       | `#9A4919` | `#E9AA79` | Links, CTAs, active states, focus    |
| `accent-hover` | `#934619` | `#EAAF81` | Hover for accent                     |
| `code-bg`      | `#E8EBEA` | `#202225` | Code blocks, code textareas, inputs  |
| `code-fg`      | `#3A4146` | `#D3D5D9` | Code text                            |
| `success`      | `#4E6552` | `#9DBA9A` | Positive                             |
| `danger`       | `#89504E` | `#CE9B97` | Error                                |
| `warning`      | `#775B2E` | `#CEB077` | Caution                              |
| `info`         | `#4B6373` | `#9DB6C5` | Informational                        |

### Line and control-border roles

Graphite separates muted text from decorative lines and necessary control boundaries. These have no public token; the pack inlines them, and `global.css` mirrors them for the playground.

| Role           | Light     | Dark      | Host variable / class                 |
| -------------- | --------- | --------- | ------------------------------------- |
| line           | `#D2D8DC` | `#41464D` | `--fp-line` / `.fp-line`              |
| control border | `#737D86` | `#858D96` | `--fp-control-border` / `.fp-control` |

Under any other pack both host variables fall back to `color-mix(in oklab, var(--zd-muted) 30%, transparent)`.

Focus: Graphite draws `outline: 2px solid var(--zd-accent)` with a 3px offset on every `:focus-visible` element.

## Typography

### Font Families

- `font-sans`: `system-ui, sans-serif` (Graphite loads no web fonts)
- `font-mono`: `ui-monospace, monospace`

### Font Sizes

| Token          | Value  | rem      |
| -------------- | ------ | -------- |
| `text-micro`   | 12px   | 0.75rem  |
| `text-caption` | 14px   | 0.875rem |
| `text-small`   | 16px   | 1rem     |
| `text-body`    | 19.2px | 1.2rem   |
| `text-title`   | 22.4px | 1.4rem   |
| `text-heading` | 48px   | 3rem     |
| `text-display` | 60px   | 3.75rem  |

### Line Heights

| Token             | Value |
| ----------------- | ----- |
| `leading-none`    | 1     |
| `leading-tight`   | 1.25  |
| `leading-snug`    | 1.375 |
| `leading-normal`  | 1.5   |
| `leading-relaxed` | 1.625 |

### Font Weights

| Token           | Value |
| --------------- | ----- |
| `font-normal`   | 400   |
| `font-medium`   | 500   |
| `font-semibold` | 600   |
| `font-bold`     | 700   |

## Border Radius

| Token          | Value         |
| -------------- | ------------- |
| `rounded`      | 0.25rem (4px) |
| `rounded-lg`   | 0.5rem (8px)  |
| `rounded-full` | 9999px        |

## Breakpoints

| Token | Value  | Use                      |
| ----- | ------ | ------------------------ |
| `sm:` | 640px  | Tablet                   |
| `lg:` | 1024px | Desktop, sidebar appears |
| `xl:` | 1280px | Wide desktop             |

## Content Styling (.zd-content)

Applied to article elements by `@takazudo/zudo-doc/content.css`; selectors use `:where()` for zero specificity.

- Flow spacing: blocks get `margin-top: var(--flow-space, vsp-md)`
- Lists: `padding-left: hsp-xl`, li spacing `vsp-xs`
- Code: `font-mono`; fenced code is highlighted at build time by zfb (`hi-*` classes resolved through `--zd-syntax-*`)
- Admonitions: 4px left border in the state colour

## Layout Constants

- Header height: `--zd-header-h` 80px (anchor `scroll-margin-top`)
- Sidebar width: `--zd-sidebar-w` `clamp(14rem, 20vw, 22rem)`
