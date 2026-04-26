// apps/mobile/src/theme.ts

/**
 * LASYNCRO MOBILE DESIGN TOKENS
 * ------------------------------
 * Single source of truth for the mobile app.
 * Mirrors the web CSS variables — never deviate.
 *
 * Mobile is always dark mode (operator warehouse context).
 * Light mode is not needed for v1 — operators work in warehouses.
 */

export const colors = {
  // Backgrounds
  bg:       '#151D29',  // --space-1 — page background
  bg2:      '#1C2740',  // --space-2 — cards, modals
  bg3:      '#243050',  // --space-3 — elevated surfaces
  bg4:      '#2E3D62',  // --space-4 — highest elevation

  // Ink
  ink:      '#F0EEE8',  // primary text
  ink2:     '#C8C4BB',  // secondary text
  ink3:     '#8B8F9A',  // captions, hints
  ink4:     '#5A5F6E',  // disabled

  // Accent — orange (never changes between modes)
  accent:        '#FF6B2B',
  accentHover:   '#FF8C5A',
  accentGhost:   'rgba(255, 107, 43, 0.12)',
  accentBorder:  'rgba(255, 107, 43, 0.25)',

  // Rule / border
  rule:   'rgba(255, 255, 255, 0.08)',
  rule2:  'rgba(255, 255, 255, 0.14)',

  // Semantic signals
  success:  '#22c55e',
  warning:  '#f59e0b',
  error:    '#ef4444',
  info:     '#60A5FA',
} as const;

export const spacing = {
  xs:   4,
  sm:   8,
  md:   16,
  lg:   24,
  xl:   32,
  xxl:  48,
} as const;

export const radius = {
  sm:  8,
  md:  12,
  lg:  16,
  xl:  24,
} as const;

export const font = {
  sans: 'System',  // DM Sans when loaded — system fallback for now
  size: {
    xs:   11,
    sm:   13,
    md:   15,
    lg:   17,
    xl:   22,
    xxl:  28,
  },
  weight: {
    regular:  '400' as const,
    medium:   '500' as const,
    semibold: '600' as const,
    bold:     '700' as const,
  },
} as const;