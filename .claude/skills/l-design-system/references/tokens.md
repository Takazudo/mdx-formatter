# Full Token Reference

Source of truth: `doc/src/styles/global.css`

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
| `vsp-2xs` | 0.4375rem (7px) | Tight gaps                  |
| `vsp-xs`  | 0.875rem (14px) | Small gaps, list items      |
| `vsp-sm`  | 1.25rem (20px)  | Compact sections            |
| `vsp-md`  | 1.5rem (24px)   | Standard gap between blocks |
| `vsp-lg`  | 1.75rem (28px)  | Section-to-section gap      |
| `vsp-xl`  | 2.5rem (40px)   | Large section gap           |
| `vsp-2xl` | 3.5rem (56px)   | Page-level breaks           |

## Color Palette (p0-p15)

Raw palette slots exposed as `--color-p0` through `--color-p15`. Values change per color scheme (light/dark). Use semantic aliases instead of raw palette.

## Semantic Colors

| Token          | Light maps to | Dark maps to | Use                        |
| -------------- | ------------- | ------------ | -------------------------- |
| `bg`           | scheme bg     | scheme bg    | Page background            |
| `fg`           | scheme fg     | scheme fg    | Main text                  |
| `surface`      | p0            | p10          | Panels, cards, elevated bg |
| `muted`        | p8            | p8           | Borders, secondary text    |
| `accent`       | p5            | p12          | Links, CTAs, active states |
| `accent-hover` | p14           | p14          | Hover for accent           |
| `code-bg`      | p10           | p10          | Code block background      |
| `code-fg`      | p11           | p11          | Code block text            |
| `success`      | p2            | p2           | Green, positive            |
| `danger`       | p1            | p1           | Red, error                 |
| `warning`      | p3            | p3           | Amber, caution             |
| `info`         | p4            | p4           | Blue, informational        |

## Typography

### Font Families

- `font-sans` / `font-noto`: Noto Sans, Noto Sans JP, system fallbacks
- `font-futura`: Futura, Jost, Century Gothic, system fallbacks
- `font-mono`: ui-monospace, monospace

### Font Sizes

| Token             | Value  | rem      |
| ----------------- | ------ | -------- |
| `text-caption`    | 14px   | 0.875rem |
| `text-small`      | 16px   | 1rem     |
| `text-body`       | 19.2px | 1.2rem   |
| `text-subheading` | 22.4px | 1.4rem   |
| `text-heading`    | 48px   | 3rem     |
| `text-display`    | 60px   | 3.75rem  |

### Line Heights

| Token             | Value |
| ----------------- | ----- |
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

Applied to article elements. Uses `:where()` for zero specificity.

- Default: `text-body`, `leading-relaxed`
- Flow spacing: `> * + *` gets `margin-top: vsp-md`
- Headings: `font-futura`, normal weight
- Links: `color-accent`, underlined, 4px offset
- Lists: disc/decimal, `padding-left: hsp-xl`, li margin-bottom `vsp-xs`
- Blockquotes: left border 3px muted, italic, `padding-left: hsp-lg`
- Code blocks: `text-small`, `leading-relaxed`, Shiki dual theme
- Tables: `text-small`, padding `vsp-xs hsp-md`

## Layout Constants

- Header height: `3.5rem` (56px)
- Sidebar width: `clamp(14rem, 20vw, 22rem)`
- Main content max-width: `clamp(50rem, 75vw, 90rem)`
- Content padding: `px-hsp-xl py-vsp-xl` → `lg:px-hsp-2xl lg:py-vsp-2xl`
