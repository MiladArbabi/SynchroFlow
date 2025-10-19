// packages/ui/src/test-utils.tsx
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter, MemoryRouterProps } from 'react-router-dom'; // Use MemoryRouter for tests
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { UserProvider } from './contexts/UserContext';

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
      // Use MemoryRouter to control the route in tests
      <MemoryRouter {...routerProps}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <UserProvider>
            {children}
          </UserProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  };

  return render(ui, { wrapper: AllTheProviders, ...renderOptions });
};

// Override the default render method
export { renderWithProviders };