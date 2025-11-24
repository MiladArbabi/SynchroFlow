// tests/unit/ui/App.test.tsx
import { screen } from '@testing-library/react';
import App from 'App';
import { renderWithProviders } from 'test-utils';

describe.skip('App component', () => {
  test('renders the login page when the route is /login', () => {
    // Use our new, powerful render options to control the URL
    renderWithProviders(<App />, { routerProps: { initialEntries: ['/login'] } });

    // Verify the login page content is visible
    expect(screen.getByRole('heading', { name: /Sign In/i })).toBeInTheDocument();

    // A robust check: ensure dashboard-specific elements are NOT present
    expect(screen.queryByText('SynchroFlow')).not.toBeInTheDocument();
  });

  test('renders the main layout when the route is /dashboard', () => {
    renderWithProviders(<App />, { routerProps: { initialEntries: ['/dashboard'] } });

    // Verify a key part of the layout is now visible
    expect(screen.getByText('SynchroFlow')).toBeInTheDocument();

    // A robust check: ensure login-specific elements are NOT present
    expect(screen.queryByRole('heading', { name: /Sign In/i })).not.toBeInTheDocument();
  });
});