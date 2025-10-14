// packages/ui/__tests__/theme.test.tsx
import { render } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../src/assets/theme';
import { MaterialUIControllerProvider } from '../src/contexts/MaterialUI';

describe('App Theme', () => {
  it('should apply a background color to the body', () => {
    render(
      // We only need to render the providers and the baseline to test the theme
      <MaterialUIControllerProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
        </ThemeProvider>
      </MaterialUIControllerProvider>
    );

    // After the theme is applied, the body will have a specific background color.
    // We'll test for any background color other than the default.
    const bodyStyles = window.getComputedStyle(document.body);
    expect(bodyStyles.backgroundColor).not.toBe('');
  });
});