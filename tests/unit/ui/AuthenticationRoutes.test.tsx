// tests/unit/ui/AuthenticationRoutes.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils'; // Use alias
import App from 'App'; // Import the main App component using alias
import { useAuth } from 'contexts/AuthContext'; // Import useAuth to mock

// Mock child components simplified for routing test
jest.mock('pages/authentication/LoginPage', () => () => <div>Login Page Content</div>);
jest.mock('pages/authentication/RegisterPage', () => () => <div>Register Page Content</div>);
// Add mocks for other pages if App tries to render them based on routes
jest.mock('pages/DashboardPage', () => ({ // <-- FIX: Mock the NAMED export
  DashboardPage: () => <div>Dashboard Page Content</div>
}));

// --- Mock useAuth hook ---
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    isLoggedIn: false,
    isLoading: false,
  })),
}));
const mockedUseAuth = useAuth as jest.Mock;

describe('Authentication Routing', () => {
  it('renders Login page for /login route', () => {
    // Render the whole App, telling the MemoryRouter to start at /login
    renderWithProviders(<App />, {
      routerProps: { initialEntries: ['/login'] }
    });
    // Expect the mocked Login page content to be present
    expect(screen.getByText(/Login Page Content/i)).toBeInTheDocument();
  });

  it('renders Register page for /register route', () => {
    // Render the whole App, telling the MemoryRouter to start at /register
    renderWithProviders(<App />, {
      routerProps: { initialEntries: ['/register'] }
    });
    // Expect the mocked Register page content to be present
    expect(screen.getByText(/Register Page Content/i)).toBeInTheDocument();
  });

  it('redirects to /login if user is NOT authenticated and tries to access /dashboard', () => {
    // Mock is NOT logged in
    mockedUseAuth.mockReturnValue({ isLoggedIn: false, isLoading: false });

    renderWithProviders(<App />, {
      routerProps: { initialEntries: ['/dashboard'] }
    });

    // --- RED TEST ---
    // Expect to find Login page content, not Dashboard content
    expect(screen.getByText(/Login Page Content/i)).toBeInTheDocument();
    expect(screen.queryByText(/Dashboard Page Content/i)).not.toBeInTheDocument();
  });

  it('renders /dashboard if user IS authenticated', () => {
    // Mock is logged in
    mockedUseAuth.mockReturnValue({ isLoggedIn: true, isLoading: false });

    renderWithProviders(<App />, {
      routerProps: { initialEntries: ['/dashboard'] }
    });

    // Expect to find Dashboard content
    expect(screen.queryByText(/Login Page Content/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Dashboard Page Content/i)).toBeInTheDocument();
  });
});