/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/test-utils.tsx
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom'; // Use MemoryRouter for tests
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { UserProvider } from './contexts/UserContext';
import { QueryClient, QueryClientProvider, QueryCache } from '@tanstack/react-query';
import { IntlProvider } from 'react-intl';

// This is our enhanced render options type
interface ExtendedRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  routerProps?: MemoryRouterProps;
}

// --- Create a new QueryClient for each test ---
const createTestQueryClient = () => new QueryClient({
  // Use synchronous retries for tests to avoid dangling timers
  defaultOptions: { queries: { retry: false } },
});

const renderWithProviders = (
  ui: ReactElement,
  { routerProps, ...renderOptions }: ExtendedRenderOptions = {}
) => {
  const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
    const theme = createTheme();
    // Create a fresh client for each render
    const queryClient = createTestQueryClient();

    return (
      <QueryClientProvider client={queryClient}> 
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
      </QueryClientProvider>
    );
  };

  return render(ui, { wrapper: AllTheProviders, ...renderOptions });
};

export { renderWithProviders };