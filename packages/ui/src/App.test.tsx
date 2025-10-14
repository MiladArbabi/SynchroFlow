// packages/ui/src/App.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { UserProvider } from './contexts/UserContext';
import { MaterialUIControllerProvider } from './contexts/MaterialUI';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './assets/theme';

jest.mock('./routes.js', () => []);

test('renders the main App component without crashing', () => {
  try {
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
    expect(screen.getByText(/SynchroFlow/i)).toBeInTheDocument();
  } catch (error) {
    console.error('Render error:', error);
    throw error;
  }
    // A simple test to confirm the app shell renders.
  // We'll look for text that we know is in the new Sidenav.
  const titleElement = screen.getByText(/SynchroFlow/i);
  expect(titleElement).toBeInTheDocument();
});