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
// - accent (#FF6B2B) is identical in both modes — never branch on it
// - For alpha operations use pal.isDark to derive rgba values
// - rowHover and shadow cannot be CSS vars (require alpha) — computed here
//
// TYPOGRAPHY:
//   font-family: var(--serif)  → Plus Jakarta Sans (headers, hero numbers)
//   font-family: var(--sans)   → sans-serif (body, UI, captions)
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

    // ── Computed (require alpha — cannot be pure CSS vars) ────────
    // Use these for sx props that need rgba values
    rowHover: isDark
      ? 'rgba(255,255,255,0.03)'
      : 'rgba(0,0,0,0.02)',
    tileHover: isDark
      ? 'rgba(255,255,255,0.06)'
      : 'rgba(0,0,0,0.04)',
    shadow: isDark
      ? '0 1px 3px rgba(0,0,0,0.4)'
      : '0 1px 3px rgba(0,0,0,0.06)',
    shadowMd: isDark
      ? '0 4px 16px rgba(0,0,0,0.5)'
      : '0 4px 16px rgba(0,0,0,0.10)',
  } as const;
}

export type AppTheme = ReturnType<typeof useAppTheme>;