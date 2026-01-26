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
          '--ft2-surface-bg': lightPalette.background.paper,
          '--ft2-surface-inset-bg': lightPalette.action.hover,
          '--ft2-surface-divider': lightPalette.divider,

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
          },

        '[data-color-scheme="dark"]': {
          '--ft2-surface-bg': darkPalette.background.paper,
          '--ft2-surface-inset-bg': darkPalette.action.hover,
          '--ft2-surface-divider': darkPalette.divider,

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