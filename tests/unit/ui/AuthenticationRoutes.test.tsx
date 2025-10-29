// tests/unit/ui/AuthenticationRoutes.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils'; // Use alias
import App from 'App'; // Import the main App component using alias

// Mock child components simplified for routing test
jest.mock('pages/authentication/Login', () => () => <div>Login Page Content</div>);
jest.mock('pages/authentication/Register', () => () => <div>Register Page Content</div>);
// Add mocks for other pages if App tries to render them based on routes
jest.mock('pages/DashboardPage', () => () => <div>Dashboard Page Content</div>);

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
});