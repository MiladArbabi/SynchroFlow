// packages/ui/src/test-utils.tsx
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom'; // Use MemoryRouter for tests
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { UserProvider } from './contexts/UserContext';
import { IntlProvider } from 'react-intl';

// This is our enhanced render options type
interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  routerProps?: MemoryRouterProps;
}

const renderWithProviders = (
  ui: ReactElement,
  { routerProps, ...renderOptions }: ExtendedRenderOptions = {}
) => {
  const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    const theme = createTheme();

    return (
      // Add IntlProvider
      <IntlProvider locale="en" defaultLocale="en" messages={{}}>
        <MemoryRouter {...routerProps}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <UserProvider>
              {children}
            </UserProvider>
          </ThemeProvider>
        </MemoryRouter>
      </IntlProvider>
    );
  };

  return render(ui, { wrapper: AllTheProviders, ...renderOptions });
};

export { renderWithProviders };