// apps/frontend/src/themes/palette.ts
// ==========================================================
// LaSyncro Color System — MUI palette adapter
//
// IMPORTANT:
// - Colour values live in ./tokens.ts (the single source of truth).
//   This file only maps those tokens onto MUI palette keys, so
//   `theme.palette.*` and `var(--*)` always agree.
// - Only TWO colour schemes exist: light | dark
//   (ThemeMode.SYSTEM merely picks one of them from the OS).
// - primary = the orange accent (structural interaction + CTAs)
// - secondary = neutral ink — never a second brand colour
// - success / warning / error = the pulse severity tokens
// ==========================================================

import { ThemeOptions } from '@mui/material/styles';
import { ThemeMode } from 'config';
import { LASYNCRO_TOKENS } from './tokens';

/**
 * buildPalette
 * ------------
 * Deterministic palette builder.
 * Accepts ONLY the color mode. Side-effect free; no hex literals here.
 */
export function buildPalette(mode: ThemeMode): ThemeOptions['palette'] {
  const isDark = mode === ThemeMode.DARK;
  const t = LASYNCRO_TOKENS[isDark ? 'dark' : 'light'];

  return {
    mode: isDark ? 'dark' : 'light',

    common: {
      white: '#FFFFFF',
      black: '#000000',
    },

    background: {
      default: t.bg, //       page / outlet background
      paper: t.surface, //    cards, panels, modals
    },

    text: {
      primary: t.ink,
      secondary: t['ink-3'],
      // Must stay defined: without it MUI falls back to a default that is
      // not scheme-aware and is illegible in dark mode
      // (THEME-TEXT-DISABLED-MISSING-137).
      disabled: t['ink-4'],
    },

    divider: t.rule,

    // ----- INTERACTION: the LaSyncro accent -----
    // contrastText is accent-ink: white on orange fails WCAG AA (2.84:1).
    primary: {
      main: t.accent,
      light: t['accent-hover'],
      dark: t['accent-text'],
      contrastText: t['accent-ink'],
    },

    // ----- NEUTRAL (not a brand colour) -----
    secondary: {
      main: t['ink-2'],
      contrastText: t.surface,
    },

    // ----- SEMANTIC SIGNALS -----
    // main holds the text-safe variant so helper text, Alert and Chip
    // labels pass AA; the brighter *-ink fills are used directly via CSS vars.
    success: { main: t['good-ink'], contrastText: isDark ? t['accent-ink'] : '#FFFFFF' },
    warning: { main: t['warning-text'], contrastText: isDark ? t['accent-ink'] : '#FFFFFF' },
    error: { main: t['critical-text'], contrastText: isDark ? t['accent-ink'] : '#FFFFFF' },

    // ----- ACTION STATES (derived, neutral hover, accent selection) -----
    action: {
      active: t['ink-2'],
      hover: t['tile-hover'],
      selected: t['accent-selected'],
      focus: t['accent-focus'],
      disabled: t['disabled-ink'],
      disabledBackground: t['disabled-fill'],
    },
  };
}
