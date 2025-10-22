// packages/ui/src/themes/index.tsx
import React, { useMemo } from 'react';

// material-ui
import { createTheme, ThemeProvider, StyledEngineProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';

// project imports
import { CSS_VAR_PREFIX, DEFAULT_THEME_MODE, ThemeMode } from 'config';
import CustomShadows from './custom-shadows';
import useConfig from 'hooks/useConfig';
import { buildPalette } from './palette';
import Typography from './typography';
import componentsOverrides from './overrides/index';

// ==============================|| DEFAULT THEME - MAIN ||============================== //

type ThemeCustomizationProps = {
  children: React.ReactNode;
};

export default function ThemeCustomization({ children }: ThemeCustomizationProps) {
  const {
    state: { borderRadius, fontFamily, outlinedFilled, presetColor, themeDirection }
  } = useConfig();

  const palette = useMemo(() => buildPalette(presetColor), [presetColor]);
  const themeTypography = useMemo(() => Typography(fontFamily), [fontFamily]);
  const themeCustomShadows = useMemo(() => CustomShadows(palette.light, ThemeMode.LIGHT), [palette.light]);
  const themeCustomShadowsDark = useMemo(() => CustomShadows(palette.dark, ThemeMode.DARK), [palette.dark]);

  const themeOptions = useMemo(
    () => ({
      direction: themeDirection,
      mixins: {
        toolbar: {
          minHeight: '48px',
          padding: '16px',
          '@media (min-width: 600px)': {
            minHeight: '48px'
          }
        }
      },
      typography: themeTypography,
      colorSchemes: {
        light: {
          palette: palette.light,
          customShadows: themeCustomShadows
        },
        dark: {
          palette: palette.dark,
          customShadows: themeCustomShadowsDark
        }
      },
      cssVariables: {
        cssVarPrefix: CSS_VAR_PREFIX,
        colorSchemeSelector: 'data-color-scheme'
      }
    }),
    [themeDirection, themeTypography, palette, themeCustomShadows, themeCustomShadowsDark]
  );

  // @ts-expect-error: We'll fix this later if needed
  const themes = createTheme(themeOptions);
  themes.components = useMemo(() => componentsOverrides(themes, borderRadius, outlinedFilled), [themes, borderRadius, outlinedFilled]);

  return (
    <StyledEngineProvider injectFirst>
      <ThemeProvider disableTransitionOnChange theme={themes} modeStorageKey="theme-mode" defaultMode={DEFAULT_THEME_MODE}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </StyledEngineProvider>
  );
}