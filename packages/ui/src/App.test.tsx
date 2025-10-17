/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { UserProvider } from './contexts/UserContext';
import { MaterialUIControllerProvider } from './contexts/MaterialUI';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './assets/theme';

const renderWithProviders = (
  ui: React.ReactElement,
  { userProviderProps = {}, routerProps = {} } = {}
) => {
  return render(
    <MemoryRouter {...routerProps}>
      <MaterialUIControllerProvider>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <UserProvider>{ui}</UserProvider>
        </ThemeProvider>
      </MaterialUIControllerProvider>
    </MemoryRouter>
  );
};


test('renders the login page on the root route', () => {
  renderWithProviders(<App />, { routerProps: { initialEntries: ['/login'] } });  // Verify the login page content is visible on the root path
  expect(screen.getByRole('heading', { name: /Sign In/i })).toBeInTheDocument();

  // A robust check: ensure dashboard-specific elements are NOT present
  expect(screen.queryByRole('textbox', { name: /search here/i })).not.toBeInTheDocument();
 });