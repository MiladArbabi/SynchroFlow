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
import { tokenCssVars } from './tokens';

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

    return {
      ...base,

      /**
       * LaSyncro CSS custom properties, scheme-scoped (not :root).
       * Every value comes from ./tokens.ts — the single source of truth
       * shared with buildPalette(). Do not add literal colours here.
       */
      MuiCssBaseline: {
        styleOverrides: {
          '[data-color-scheme="light"]': {
            backgroundColor: 'var(--bg)',
            ...tokenCssVars('light'),
          },
          '[data-color-scheme="dark"]': {
            backgroundColor: 'var(--bg)',
            ...tokenCssVars('dark'),
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