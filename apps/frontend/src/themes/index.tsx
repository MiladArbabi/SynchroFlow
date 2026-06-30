// apps/frontend/src/themes/index.tsx
import React, { useMemo } from 'react';

// material-ui
import CssBaseline from '@mui/material/CssBaseline';
import {
  createTheme,
  ThemeProvider,
  StyledEngineProvider,
} from '@mui/material/styles';

// project imports
import { CSS_VAR_PREFIX, DEFAULT_THEME_MODE, ThemeMode } from 'config';
import useConfig from 'hooks/useConfig';
import { buildPalette } from './palette';
import Typography from './typography';
import CustomShadows from './custom-shadows';
import componentsOverrides from './overrides';
import { withAlpha } from 'utils/colorUtils';

// ==============================|| DEFAULT THEME - MAIN ||============================== //

type ThemeCustomizationProps = {
  children: React.ReactNode;
};

export default function ThemeCustomization({ children }: ThemeCustomizationProps) {
  const {
    state: { borderRadius, fontFamily, outlinedFilled, themeDirection },
  } = useConfig();

  const themeTypography = useMemo(
    () => Typography(fontFamily),
    [fontFamily]
  );

  /**
   * Theme options with two explicit color schemes only.
   * No presets. No system mode.
   */
  const themeOptions = useMemo(
    () => ({
      direction: themeDirection,
      mixins: {
        toolbar: {
          minHeight: '48px',
          padding: '16px',
          '@media (min-width: 600px)': {
            minHeight: '48px',
          },
        },
      },
      typography: themeTypography,
      colorSchemes: {
        light: {
          palette: buildPalette(ThemeMode.LIGHT),
          customShadows: CustomShadows(
            buildPalette(ThemeMode.LIGHT),
            ThemeMode.LIGHT
          ),
        },
        dark: {
          palette: buildPalette(ThemeMode.DARK),
          customShadows: CustomShadows(
            buildPalette(ThemeMode.DARK),
            ThemeMode.DARK
          ),
        },
      },
      cssVariables: {
        cssVarPrefix: CSS_VAR_PREFIX,
        colorSchemeSelector: 'data-color-scheme',
      },
    }),
    [themeDirection, themeTypography]
  );

  const theme = createTheme(themeOptions);

  /**
   * Component overrides + FT2 surface bindings.
   * FT2 variables MUST be scheme-scoped (not :root).
   */
  theme.components = useMemo(() => {
    const base = componentsOverrides(theme, borderRadius, outlinedFilled);

    const lightPalette = buildPalette(ThemeMode.LIGHT);
    const darkPalette = buildPalette(ThemeMode.DARK);

    return {
      ...base,

    MuiCssBaseline: {
      styleOverrides: {
        '[data-color-scheme="light"]': {
          /**
           * FT2 Page Background
           * -------------------
           * Ensures dashboard page background is
           * visually distinct from panel surfaces.
           */
          backgroundColor: 'var(--ft2-page-bg)',
          /**
           * FT2 Panel Surface
           * -----------------
           * Panels must visually lift from the page background.
           */
          /**
           * Panel surface
           * Must be brighter than page background
           * to create surface lift.
           */
          '--ft2-surface-bg': '#FFFFFF',

          /**
           * Panel header zone
           * Slight inset to separate header from panel body.
           */
          '--ft2-surface-inset-bg': lightPalette.action.hover,
          '--ft2-surface-divider': lightPalette.divider,

          '--ft2-page-bg': lightPalette.background.default,

          '--ft2-surface-shadow': `0 1px 2px ${withAlpha('#000000', 0.12)}, 
                         0 2px 4px ${withAlpha('#000000', 0.08)}`,

          '--ft2-surface-shadow-hover': `0 2px 4px ${withAlpha('#000000', 0.16)}`,

          '--ft2-infoblock-bg': '#FAFAFA',
          '--ft2-infoblock-border': '#EAE7E7',

          '--ft2-infoblock-header-bg': '#F4F2F2',
          '--ft2-infoblock-header-text': '#000000',

          '--ft2-infoblock-row-text': '#353535',

          '--ft2-infoblock-footer-bg': '#D9D9D9',
          '--ft2-infoblock-footer-text': '#000000',

          '--ft2-infoblock-diff-neutral': '#6B6B6B',
          '--ft2-infoblock-diff-up': '#2E7D32',    // green
          '--ft2-infoblock-diff-down': '#C62828',  // red

          // ── LaSyncro design tokens (light) ──────────────────
          '--accent':        '#FF6B2B',
          '--accent-hover':  '#FF8C5A',
          '--accent-ghost':  '#FFF0E8',
          '--accent-border': '#FFDCCA',
          '--accent-ink':    '#10151E',
          // Confirmed/success state ONLY (Thread B, 2026-06-30) — exception
          // to the orange-only CTA system, documented in modules-ux-playbook.md.
          // Not for general use. Anchored to --ft2-infoblock-diff-up (#2E7D32).
          '--confirm-ghost':  '#E8F5E9',
          '--confirm-border': '#A5D6A7',
          '--confirm-ink':    '#2E7D32',
          '--bg':            '#FAFAF8',
          '--bg-2':          '#F3F2EF',
          '--bg-3':          '#E8E6E0',
          '--surface':       '#FFFFFF',
          '--ink':           '#0F0E0D',
          '--ink-2':         '#3A3835',
          '--ink-3':         '#6B7280',
          '--ink-4':         '#9CA3AF',
          '--rule':          '#E8E6E0',
          '--rule-2':        '#D1CFC8',
          '--space-azure':   '#1FA8FF',
          '--zone-lane':       '217,179,83',
          '--zone-shelf':      '217,179,83',
          '--zone-warehouse':  '217,179,83',
          '--zone-storage':    '36,48,80',
          '--zone-pick':       '31,168,255',
          '--zone-pack':       '255,107,43',
          '--zone-receive':    '76,175,122',
          '--zone-ship':       '31,168,255',
          '--zone-returns':    '251,113,133',
          '--zone-quarantine': '239,68,68',
          '--zone-kitting':    '139,92,246',
          },

        '[data-color-scheme="dark"]': {
          backgroundColor: 'var(--ft2-page-bg)',

          /**
           * Panel surface
           * Slight lift above dark page background.
           */
          '--ft2-surface-bg': '#171A21',
          '--ft2-surface-inset-bg': darkPalette.action.hover,
          '--ft2-surface-divider': darkPalette.divider,

          '--ft2-page-bg': darkPalette.background.default,

          '--ft2-surface-shadow': `0 1px 2px ${withAlpha('#FFFFFF', 0.10)}, 
                         0 2px 4px ${withAlpha('#FFFFFF', 0.06)}`,

          '--ft2-surface-shadow-hover': `0 2px 4px ${withAlpha('#FFFFFF', 0.14)}`,

          '--ft2-infoblock-bg': '#1E1E1E',
          '--ft2-infoblock-border': '#2A2A2A',

          '--ft2-infoblock-header-bg': '#242424',
          '--ft2-infoblock-header-text': '#E6E6E6',

          '--ft2-infoblock-row-text': '#D0D0D0',

          '--ft2-infoblock-footer-bg': '#181818',
          '--ft2-infoblock-footer-text': '#CFCFCF',

          '--ft2-infoblock-diff-neutral': '#9A9A9A',
          '--ft2-infoblock-diff-up': '#6FCF97',    // softer green
          '--ft2-infoblock-diff-down': '#EF5350',  // softer red

          // ── LaSyncro design tokens (dark) ───────────────────
          '--accent':        '#FF6B2B',
          '--accent-hover':  '#FF8C5A',
          '--accent-ghost':  'rgba(255,107,43,0.12)',
          '--accent-border': 'rgba(255,107,43,0.25)',
          '--accent-ink':    '#10151E',
          '--confirm-ghost':  'rgba(76,175,80,0.12)',
          '--confirm-border': 'rgba(76,175,80,0.35)',
          '--confirm-ink':    '#66BB6A',
          '--bg':            '#151D29',
          '--bg-2':          '#1C2740',
          '--bg-3':          '#243050',
          '--surface':       '#1C2740',
          '--ink':           '#F0EEE8',
          '--ink-2':         '#C8C4BB',
          '--ink-3':         '#8B8F9A',
          '--ink-4':         '#5A5F6E',
          '--rule':          'rgba(255,255,255,0.08)',
          '--rule-2':        'rgba(255,255,255,0.14)',
          '--space-azure':   '#1FA8FF',
          '--zone-lane':       '217,179,83',
          '--zone-shelf':      '217,179,83',
          '--zone-warehouse':  '217,179,83',
          '--zone-storage':    '36,48,80',
          '--zone-pick':       '31,168,255',
          '--zone-pack':       '255,107,43',
          '--zone-receive':    '76,175,122',
          '--zone-ship':       '31,168,255',
          '--zone-returns':    '251,113,133',
          '--zone-quarantine': '239,68,68',
          '--zone-kitting':    '139,92,246',
        },
      },
    },
    };
  }, [theme, borderRadius, outlinedFilled]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider
        theme={theme}
        disableTransitionOnChange
        modeStorageKey="theme-mode"
        defaultMode={DEFAULT_THEME_MODE}
      >
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  );
}