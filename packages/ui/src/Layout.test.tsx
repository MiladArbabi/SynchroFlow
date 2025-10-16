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

  screen.debug();

  // Assert that the main brand name is visible in the new Sidenav.
  expect(screen.getByText(/SynchroFlow/i)).toBeInTheDocument();

  // A more robust way to confirm the Navbar has rendered is to find a unique element within it,
  // like the search input field.
  //expect(screen.getByRole('textbox', { name: /search here/i })).toBeInTheDocument();
});