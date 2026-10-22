// apps/frontend/src/themes/tokens.ts
// ==========================================================
// LaSyncro Design Tokens — SINGLE SOURCE OF TRUTH
//
// Every colour in the webapp derives from this file:
// - themes/index.tsx emits these as CSS custom properties
//   (`--accent`, `--ink`, …) scoped to [data-color-scheme].
// - themes/palette.ts builds the MUI palette from the same values,
//   so `theme.palette.*` and `var(--*)` can never disagree.
// - docs/color-pallet/index.md mirrors this file for humans.
//
// Rules:
// - Components reference `var(--name)` or `theme.palette.*`, never hex.
// - accent is identical in both modes — never re-tint it per mode.
// - `*-ink` severity colours are for dots, bars and fills.
//   Text uses the `*-text` variant, which holds ≥ 4.5:1 on
//   bg / bg-2 / surface in both modes.
// - bg-2 and surface must stay distinct in BOTH modes (playbook §11).
// ==========================================================

export type TokenMode = 'light' | 'dark';

/** Token names, without the leading `--`. */
export type LaSyncroToken = keyof typeof LIGHT;

const LIGHT = {
  // ── Accent — orange (identical in both modes) ────────────────
  accent: '#FF6B2B', //          Tier 1 fill, ghost-pill border, focus ring
  'accent-hover': '#FF8C5A',
  'accent-ghost': '#FFF0E8',
  'accent-border': '#FFDCCA',
  'accent-ink': '#10151E', //    text ON an accent fill — 6.44:1 (white fails at 2.84:1)
  'accent-text': '#B93D0A', //   accent-coloured TEXT on bg/surface — 5.6:1

  // ── Backgrounds ──────────────────────────────────────────────
  bg: '#FAFAF8', //              page background
  'bg-2': '#F3F2EF', //          hover zones, panels against bg
  'bg-3': '#E8E6E0', //          frames distinct from surface
  surface: '#FFFFFF', //         cards, panels, inputs, modals

  // ── Ink (text) — all ≥ 4.5:1 on bg, bg-2 and surface ─────────
  ink: '#0F0E0D',
  'ink-2': '#3A3835',
  'ink-3': '#545A66', //         captions, metadata
  'ink-4': '#656B78', //         hints, placeholders, counts

  // ── Rules (borders) ──────────────────────────────────────────
  rule: '#E8E6E0',
  'rule-2': '#D1CFC8',

  // ── Space — dark sections, identical in both modes ───────────
  'space-1': '#151D29',
  'space-2': '#1C2740',
  'space-3': '#243050',
  'space-4': '#2E3D62',
  'space-azure': '#1FA8FF',

  // ── Pulse severity — live risk/status metrics (playbook §18) ─
  'critical-ink': '#E5484D',
  'critical-text': '#C4262B',
  'critical-ghost': '#FDEDEE',
  'critical-border': '#F5C2C4',
  'warning-ink': '#EAB308',
  'warning-text': '#8A5A00',
  'warning-ghost': '#FEF9E7',
  'warning-border': '#FDE68A',
  'good-ink': '#2E7D32',
  'good-ghost': '#E8F5E9',
  'good-border': '#A5D6A7',

  // ── Confirmed / persisted state ONLY (playbook §10) ──────────
  'confirm-ink': '#2E7D32',
  'confirm-ghost': '#E8F5E9',
  'confirm-border': '#A5D6A7',

  // ── Computed alpha helpers (cannot be derived in pure CSS) ───
  'row-hover': 'rgba(0,0,0,0.02)',
  'tile-hover': 'rgba(0,0,0,0.04)',
  'accent-selected': 'rgba(255,107,43,0.12)',
  'accent-focus': 'rgba(255,107,43,0.24)',
  'disabled-ink': 'rgba(15,14,13,0.3)',
  'disabled-fill': 'rgba(15,14,13,0.12)',
  'shadow-sm': '0 1px 3px rgba(0,0,0,0.06)',
  'shadow-md': '0 4px 16px rgba(0,0,0,0.10)',
  'ft2-surface-shadow': '0 1px 2px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.08)',
  'ft2-surface-shadow-hover': '0 2px 4px rgba(0,0,0,0.16)',
} as const;

const DARK: Record<LaSyncroToken, string> = {
  accent: '#FF6B2B',
  'accent-hover': '#FF8C5A',
  'accent-ghost': 'rgba(255,107,43,0.12)',
  'accent-border': 'rgba(255,107,43,0.25)',
  'accent-ink': '#10151E',
  'accent-text': '#FF6B2B', //   5.2:1 on surface — the accent itself passes in dark

  bg: '#151D29',
  // Was #1C2740 — identical to surface, so bg-2 panels vanished on
  // surface in dark mode only (playbook §11). Now sits between bg and
  // surface with the same separation light mode has (≈1.1:1).
  'bg-2': '#18202F',
  'bg-3': '#243050',
  surface: '#1C2740',

  ink: '#F0EEE8',
  'ink-2': '#C8C4BB',
  'ink-3': '#A8ACB5',
  'ink-4': '#979CA7',

  rule: 'rgba(255,255,255,0.08)',
  'rule-2': 'rgba(255,255,255,0.14)',

  'space-1': '#151D29',
  'space-2': '#1C2740',
  'space-3': '#243050',
  'space-4': '#2E3D62',
  'space-azure': '#1FA8FF',

  'critical-ink': '#E5484D',
  'critical-text': '#FF7A7E',
  'critical-ghost': 'rgba(229,72,77,0.12)',
  'critical-border': 'rgba(229,72,77,0.35)',
  'warning-ink': '#EAB308',
  'warning-text': '#EAB308',
  'warning-ghost': 'rgba(234,179,8,0.12)',
  'warning-border': 'rgba(234,179,8,0.35)',
  'good-ink': '#4CAF7A',
  'good-ghost': 'rgba(76,175,80,0.12)',
  'good-border': 'rgba(76,175,80,0.35)',

  'confirm-ink': '#66BB6A',
  'confirm-ghost': 'rgba(76,175,80,0.12)',
  'confirm-border': 'rgba(76,175,80,0.35)',

  'row-hover': 'rgba(255,255,255,0.03)',
  'tile-hover': 'rgba(255,255,255,0.06)',
  'accent-selected': 'rgba(255,107,43,0.16)',
  'accent-focus': 'rgba(255,107,43,0.24)',
  'disabled-ink': 'rgba(240,238,232,0.3)',
  'disabled-fill': 'rgba(240,238,232,0.12)',
  'shadow-sm': '0 1px 3px rgba(0,0,0,0.4)',
  'shadow-md': '0 4px 16px rgba(0,0,0,0.5)',
  'ft2-surface-shadow': '0 1px 2px rgba(255,255,255,0.10), 0 2px 4px rgba(255,255,255,0.06)',
  'ft2-surface-shadow-hover': '0 2px 4px rgba(255,255,255,0.14)',
};

export const LASYNCRO_TOKENS: Record<TokenMode, Record<LaSyncroToken, string>> = {
  light: LIGHT,
  dark: DARK,
};

/**
 * Warehouse zone channels — bare "r,g,b" triples, consumed as
 * `rgba(var(--zone-x), α)` by IsometricCanvas overlays. Mode-invariant
 * except zone-storage, lightened in dark so bins stay visible
 * (RECOUNT-CTA-33b).
 */
export const ZONE_CHANNELS: Record<TokenMode, Record<string, string>> = {
  light: {
    'zone-lane': '217,179,83',
    'zone-shelf': '217,179,83',
    'zone-warehouse': '217,179,83',
    'zone-storage': '36,48,80',
    'zone-pick': '31,168,255',
    'zone-pack': '255,107,43',
    'zone-receive': '76,175,122',
    'zone-ship': '31,168,255',
    'zone-returns': '251,113,133',
    'zone-problem': '245,158,11',
    'zone-quarantine': '239,68,68',
    'zone-kitting': '139,92,246',
  },
  dark: {
    'zone-lane': '217,179,83',
    'zone-shelf': '217,179,83',
    'zone-warehouse': '217,179,83',
    'zone-storage': '76,105,169',
    'zone-pick': '31,168,255',
    'zone-pack': '255,107,43',
    'zone-receive': '76,175,122',
    'zone-ship': '31,168,255',
    'zone-returns': '251,113,133',
    'zone-problem': '245,158,11',
    'zone-quarantine': '239,68,68',
    'zone-kitting': '139,92,246',
  },
};

/**
 * FT2 surface variables, expressed as aliases of the core tokens so
 * dashboards share the same surfaces, text and severity colours as the
 * rest of the app (previously a separate grey/slate palette).
 */
export const FT2_ALIASES: Record<string, string> = {
  '--ft2-page-bg': 'var(--bg)',
  '--ft2-surface-bg': 'var(--surface)',
  '--ft2-surface-inset-bg': 'var(--bg-2)',
  '--ft2-surface-divider': 'var(--rule)',
  '--ft2-infoblock-bg': 'var(--surface)',
  '--ft2-infoblock-border': 'var(--rule)',
  '--ft2-infoblock-header-bg': 'var(--bg-3)',
  '--ft2-infoblock-header-text': 'var(--ink)',
  '--ft2-infoblock-row-text': 'var(--ink-2)',
  '--ft2-infoblock-footer-bg': 'var(--bg-3)',
  '--ft2-infoblock-footer-text': 'var(--ink)',
  '--ft2-infoblock-diff-neutral': 'var(--ink-3)',
  '--ft2-infoblock-diff-up': 'var(--good-ink)',
  '--ft2-infoblock-diff-down': 'var(--critical-text)',
};

/** All CSS custom properties for one mode, keyed `--name`. */
export function tokenCssVars(mode: TokenMode): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(LASYNCRO_TOKENS[mode])) vars[`--${name}`] = value;
  for (const [name, value] of Object.entries(ZONE_CHANNELS[mode])) vars[`--${name}`] = value;
  return { ...vars, ...FT2_ALIASES };
}
