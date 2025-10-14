import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { MaterialUIControllerProvider } from './contexts/MaterialUI';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './assets/theme';
import { UserProvider } from './contexts/UserContext';

test('renders the professional layout with Sidenav and Navbar', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
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

  // Assert that the main brand name is visible in the new Sidenav.
  expect(screen.getByText(/SynchroFlow/i)).toBeInTheDocument();

  // As a bonus, let's check for an element in the new DashboardNavbar.
  expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument();
});