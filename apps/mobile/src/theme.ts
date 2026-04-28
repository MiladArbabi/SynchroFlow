// apps/mobile/src/theme.ts
/**
 * LASYNCRO MOBILE DESIGN TOKENS
 * ------------------------------
 * Single source of truth for the mobile app.
 * Strictly mirrors the CSS variable dark-mode override block.
 * Mobile is always dark mode — operator warehouse context.
 *
 * NEVER use raw hex or rgba() in screen files.
 * ALWAYS reference a token from this file.
 */

export const colors = {
  // ── Backgrounds (dark mode --space values) ──────────────────────────────
  bg:       '#151D29',  // --space-1 — page background
  bg2:      '#1C2740',  // --space-2 — cards, modals, surface
  bg3:      '#243050',  // --space-3 — elevated surfaces
  bg4:      '#2E3D62',  // --space-4 — highest elevation

  // ── Ink (dark mode) ──────────────────────────────────────────────────────
  ink:      '#F0EEE8',  // --ink   — primary text
  ink2:     '#C8C4BB',  // --ink-2 — secondary text
  ink3:     '#8B8F9A',  // --ink-3 — captions, hints
  ink4:     '#5A5F6E',  // --ink-4 — disabled

  // ── Accent — orange (identical in both modes, never changes) ────────────
  accent:       '#FF6B2B',  // --accent
  accentHover:  '#FF8C5A',  // --accent-hover
  accentGhost:  'rgba(255,107,43,0.12)',  // --accent-ghost dark
  accentBorder: 'rgba(255,107,43,0.25)', // --accent-border dark

  // ── Rule / border (dark mode) ────────────────────────────────────────────
  rule:  'rgba(255,255,255,0.08)',  // --rule dark
  rule2: 'rgba(255,255,255,0.14)', // --rule-2 dark

  // ── Semantic signals (not in brand tokens — use sparingly) ───────────────
  // These are standard semantic colors — green/yellow/red are universal
  success: '#22c55e',
  warning: '#f59e0b',
  error:   '#ef4444',
  info:    '#60A5FA',

  // ── Semantic ghost backgrounds (semantic color + 0.12 alpha) ─────────────
  successGhost:  'rgba(34,197,94,0.12)',
  warningGhost:  'rgba(245,158,11,0.12)',
  errorGhost:    'rgba(239,68,68,0.12)',
  infoGhost:     'rgba(96,165,250,0.12)',
  purpleGhost:   'rgba(167,139,250,0.12)',

  // ── Semantic borders ──────────────────────────────────────────────────────
  successBorder: 'rgba(34,197,94,0.3)',
  errorBorder:   'rgba(239,68,68,0.25)',

  // ── Extended accent ───────────────────────────────────────────────────────
  purple: '#A78BFA',  // task category color — stow/receive

  // ── Camera overlay backgrounds ────────────────────────────────────────────
  // Used exclusively in scan screens where camera is full-screen
  // These are NOT brand colors — they are functional overlays
  cameraOverlay:     'rgba(15,14,13,0.70)',  // top bar on camera
  cameraBg:          'rgba(15,14,13,0.85)',  // standard camera UI panel
  cameraBgDark:      'rgba(15,14,13,0.90)',  // bottom bar on camera
  cameraBgCard:      'rgba(15,14,13,0.75)',  // floating card on camera
  cameraHint:        'rgba(240,238,232,0.6)', // dimmed text on camera
} as const;

export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const font = {
  sans: 'System',  // DM Sans when loaded — system fallback for now
  size: {
    xs:  11,
    sm:  13,
    md:  15,
    lg:  17,
    xl:  22,
    xxl: 28,
  },
  weight: {
    regular:  '400' as const,
    medium:   '500' as const,
    semibold: '600' as const,
    bold:     '700' as const,
  },
} as const;