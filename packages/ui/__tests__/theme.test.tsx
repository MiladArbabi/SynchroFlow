// packages/ui/__tests__/theme.test.tsx
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../src/App';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '../src/assets/theme';
import { MaterialUIControllerProvider } from '../src/contexts/MaterialUI';
import { UserProvider } from '../src/contexts/UserContext';

describe('App Theme', () => {
  it('should apply a background color to the body', () => {
    render(
      <MemoryRouter>
        <MaterialUIControllerProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <UserProvider>
              <App />
            </UserProvider>
          </ThemeProvider>
        </MaterialUIControllerProvider>
    </MemoryRouter>
    );

    // After the theme is applied, the body will have a specific background color.
    // We'll test for any background color other than the default.
    const bodyStyles = window.getComputedStyle(document.body);
    expect(bodyStyles.backgroundColor).not.toBe('');
  });
});