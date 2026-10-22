# LaSyncro Design Tokens

> **Source of truth:** `apps/frontend/src/themes/tokens.ts`.
> `themes/index.tsx` emits these as CSS custom properties scoped to
> `[data-color-scheme]`, and `themes/palette.ts` builds the MUI palette from the
> same values, so `var(--*)` and `theme.palette.*` always agree. This page
> mirrors that file; if they ever differ, the code wins and this page is the bug.

## Core palette

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#FF6B2B` | `#FF6B2B` | Tier 1 CTA fill, ghost-pill border, focus ring. Never re-tint per mode. |
| `--accent-hover` | `#FF8C5A` | `#FF8C5A` | Hover on accent fills (lighten, never darken). |
| `--accent-ghost` | `#FFF0E8` | `rgba(255,107,43,0.12)` | Tint for selected/accent areas. |
| `--accent-border` | `#FFDCCA` | `rgba(255,107,43,0.25)` | Border for accent-tinted areas. |
| `--accent-ink` | `#10151E` | `#10151E` | Text **on** an accent fill (6.44:1; white fails at 2.84:1). |
| `--accent-text` | `#B93D0A` | `#FF6B2B` | Accent-coloured **text** on bg/surface (≥ 5.2:1). |
| `--bg` | `#FAFAF8` | `#151D29` | Page background. |
| `--bg-2` | `#F3F2EF` | `#18202F` | Hover zones and panels against `--bg`. |
| `--bg-3` | `#E8E6E0` | `#243050` | Frames distinct from `--surface` (tabs, modal header/footer). |
| `--surface` | `#FFFFFF` | `#1C2740` | Cards, panels, inputs, modals. |
| `--ink` | `#0F0E0D` | `#F0EEE8` | Primary text. |
| `--ink-2` | `#3A3835` | `#C8C4BB` | Secondary text. |
| `--ink-3` | `#545A66` | `#A8ACB5` | Captions, metadata, row labels. |
| `--ink-4` | `#656B78` | `#979CA7` | Hints, placeholders, counts. |
| `--rule` | `#E8E6E0` | `rgba(255,255,255,0.08)` | Default border / hairline. |
| `--rule-2` | `#D1CFC8` | `rgba(255,255,255,0.14)` | Stronger separator. |
| `--space-1…4` | `#151D29` `#1C2740` `#243050` `#2E3D62` | same | Dark sections, identical in both modes. |
| `--space-azure` | `#1FA8FF` | `#1FA8FF` | Spatial / live-map highlight. |

All `--ink*` values hold ≥ 4.5:1 on `--bg`, `--bg-2` and `--surface` in both modes.

## Severity and state

| Token | Light | Dark | Use |
|---|---|---|---|
| `--critical-ink` | `#E5484D` | `#E5484D` | Critical dots, bars, fills. |
| `--critical-text` | `#C4262B` | `#FF7A7E` | Critical **text** (≥ 4.5:1). |
| `--warning-ink` | `#EAB308` | `#EAB308` | Warning dots, bars, fills. |
| `--warning-text` | `#8A5A00` | `#EAB308` | Warning **text** (≥ 4.5:1). |
| `--good-ink` | `#2E7D32` | `#4CAF7A` | Good — dots, bars and text. |
| `--*-ghost` / `--*-border` | | | Band and banner fills/borders for critical, warning, good. |
| `--confirm-ink/-ghost/-border` | | | Confirmed/persisted state ONLY — never an actionable CTA. |

## MUI palette mapping

| MUI key | Token |
|---|---|
| `primary.main` / `contrastText` | `--accent` / `--accent-ink` |
| `secondary.main` | `--ink-2` (neutral — never a second brand colour) |
| `success` / `warning` / `error` `.main` | `--good-ink` / `--warning-text` / `--critical-text` |
| `background.default` / `.paper` | `--bg` / `--surface` |
| `text.primary` / `.secondary` / `.disabled` | `--ink` / `--ink-3` / `--ink-4` |
| `divider` | `--rule` |

FT2 variables (`--ft2-page-bg`, `--ft2-surface-bg`, `--ft2-infoblock-*`) are
aliases of the core tokens — see `FT2_ALIASES` in `tokens.ts`.

## Rules

- Components use `var(--token)` or `theme.palette.*` — never hex.
- Coloured text uses the `*-text` token; dots, bars and fills use `*-ink`.
- `--bg-2` and `--surface` must stay distinct in both modes.
- Typography: Plus Jakarta Sans everywhere, inherited from the theme. There is
  no `--serif` / `--sans`; do not set `fontFamily` in components (monospace only
  for machine identifiers — SKUs, barcodes, bin codes).
