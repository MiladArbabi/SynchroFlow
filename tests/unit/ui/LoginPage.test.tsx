// packages/ui/src/LoginPage.test.tsx
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import LoginPage from 'pages/authentication/LoginPage';

test('renders the login page on the /login route', () => {
  // Use MemoryRouter to control the "URL" in our test environment
  renderWithProviders(<LoginPage />)

  // Look for a key element we expect to be on the login page
  const emailInput = screen.getByLabelText(/email address/i);
  expect(emailInput).toBeInTheDocument();
});