// apps/frontend/src/hooks/useAppTheme.ts
//
// CANONICAL THEME HOOK — LaSyncro design tokens
// ----------------------------------------------
// Single source of truth for all component theming.
// Replaces all local useXxxTheme() hooks across modules.
//
// USAGE:
//   const pal = useAppTheme();
//   <Box sx={{ background: pal.surface, borderColor: pal.rule }} />
//
// RULES:
// - Always use CSS vars — never hardcode hex in components
// - Values live in themes/tokens.ts (single source of truth)
// - accent (#FF6B2B) is identical in both modes — never branch on it
// - Accent-coloured TEXT uses accentText; text ON an accent fill uses accentInk
// - Severity colours: *Ink for dots/bars/fills, *Text for text
//
// TYPOGRAPHY:
//   Plus Jakarta Sans everywhere, inherited from the theme — never set
//   fontFamily in components (no --serif / --sans / DM Sans).
//   font-variant-numeric: tabular-nums → always on data numbers

import { useColorScheme } from '@mui/material/styles';
import { ThemeMode } from 'config';

export function useAppTheme() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === ThemeMode.DARK;

  return {
    isDark,

    // ── Backgrounds ─────────────────────────────────────────────
    bg:      'var(--bg)',       // page background
    bg2:     'var(--bg-2)',     // secondary background, hover zones
    bg3:     'var(--bg-3)',     // tertiary, divider fills
    surface: 'var(--surface)',  // card / panel surface

    // ── Ink (text) ───────────────────────────────────────────────
    ink:  'var(--ink)',    // primary text
    ink2: 'var(--ink-2)', // secondary text
    ink3: 'var(--ink-3)', // captions, metadata
    ink4: 'var(--ink-4)', // hints, placeholders

    // ── Rules (borders) ──────────────────────────────────────────
    rule:  'var(--rule)',   // default border
    rule2: 'var(--rule-2)',// stronger border, focus rings

    // ── Accent (orange — identical in both modes) ─────────────────
    accent:       'var(--accent)',        // #FF6B2B
    accentHover:  'var(--accent-hover)',  // #FF8C5A
    accentGhost:  'var(--accent-ghost)',  // bg tint for accent areas
    accentBorder: 'var(--accent-border)',// border for accent areas
    accentInk:    'var(--accent-ink)',   // text ON an accent fill
    accentText:   'var(--accent-text)',  // accent-coloured text on bg/surface

    // ── Alpha helpers (mode-aware CSS vars from themes/tokens.ts) ──
    rowHover:  'var(--row-hover)',
    tileHover: 'var(--tile-hover)',
    shadow:    'var(--shadow-sm)',
    shadowMd:  'var(--shadow-md)',
  } as const;
}

export type AppTheme = ReturnType<typeof useAppTheme>;