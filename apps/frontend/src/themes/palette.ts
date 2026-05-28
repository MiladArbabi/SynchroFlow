// apps/frontend/src/themes/palette.ts
// ==========================================================
// LaSyncro Color System — v1 (FOUNDATIONAL)
//
// IMPORTANT:
// - Only TWO modes exist: light | dark
// - No presets, no variants, no IDs
// - Blue = structural interaction
// - Orange = brand whisper (non-signal)
// - Red / Yellow / Green = semantic health signals
//
// This file is the SINGLE SOURCE OF TRUTH for color.
// Any deviation elsewhere is a bug.
// ==========================================================

import { ThemeOptions } from '@mui/material/styles';
import { ThemeMode } from 'config';

/**
 * buildPalette
 * ------------
 * Deterministic palette builder.
 * Accepts ONLY the color mode.
 *
 * This function must stay:
 * - side-effect free
 * - preset-free
 * - scale-free
 */
export function buildPalette(mode: ThemeMode): ThemeOptions['palette'] {
  const isDark = mode === ThemeMode.DARK;

  // ----------------------------------------------------------
  // ABSOLUTE ANCHORS (never change)
  // ----------------------------------------------------------
  const WHITE = '#FFFFFF';
  const BLACK = '#000000';

  // ----------------------------------------------------------
  // NEUTRAL SYSTEM
  // One surface + one text color per mode.
  // No grey scales. No ambiguity.
  // ----------------------------------------------------------
  const neutralSurface = isDark ? '#0D1526' : '#F1F5F9';       // page background
  const neutralElevated = isDark ? '#1C2740' : '#FFFFFF';       // card / panel surface — matches --surface token
  const neutralText = isDark ? '#E5E7EB' : '#0F172A';

  // ----------------------------------------------------------
  // STRUCTURAL ACCENT — BLUE
  // Used for:
  // - focus
  // - selection
  // - active navigation
  // - interactive affordances
  // ----------------------------------------------------------
  const structuralBlue = isDark ? '#60A5FA' : '#2563EB';

  // ----------------------------------------------------------
  // BRAND WHISPER — ORANGE
  // Used ONLY for subtle brand presence.
  // Never for interaction or signals.
  // ----------------------------------------------------------
  const brandOrange = isDark ? '#FDBA74' : '#F59E0B';

  // ----------------------------------------------------------
  // SEMANTIC HEALTH SIGNALS
  // These are RESERVED and must not be reused.
  // ----------------------------------------------------------
  const success = isDark ? '#4ADE80' : '#16A34A';
  const warning = isDark ? '#FACC15' : '#CA8A04';
  const error = isDark ? '#F87171' : '#DC2626';

  return {
    mode: isDark ? 'dark' : 'light',

    // ----- Required MUI keys -----
    common: {
      white: WHITE,
      black: BLACK,
    },

    background: {
      default: neutralSurface,   // page / outlet background
      paper: neutralElevated,    // cards, panels, modals — visually elevated above page
    },

    text: {
      primary: neutralText,
      secondary: isDark ? '#9CA3AF' : '#475569',
    },

    divider: isDark ? 'rgba(255,255,255,0.08)' : '#E5E7EB',

    // ----- STRUCTURAL INTERACTION COLOR -----
    primary: {
      main: structuralBlue,
      contrastText: WHITE,
    },

    // ----- BRAND (NON-INTERACTIVE) -----
    secondary: {
      main: brandOrange,
      contrastText: BLACK,
    },

    // ----- SEMANTIC SIGNALS -----
    success: { main: success },
    warning: { main: warning },
    error: { main: error },

    // ----- ACTION STATES (DERIVED, NOT CREATIVE) -----
    action: {
      active: structuralBlue,
      hover: isDark
        ? 'rgba(96,165,250,0.08)'
        : 'rgba(37,99,235,0.08)',
      selected: isDark
        ? 'rgba(96,165,250,0.16)'
        : 'rgba(37,99,235,0.16)',
      disabled: isDark
        ? 'rgba(229,231,235,0.3)'
        : 'rgba(15,23,42,0.3)',
      disabledBackground: isDark
        ? 'rgba(229,231,235,0.12)'
        : 'rgba(15,23,42,0.12)',
      focus: isDark
        ? 'rgba(96,165,250,0.24)'
        : 'rgba(37,99,235,0.24)',
    },
  };
}
