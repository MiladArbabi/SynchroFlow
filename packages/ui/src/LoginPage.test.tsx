// packages/ui/src/LoginPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App'; // We will test the main App router

test('renders the login page on the /login route', () => {
  // Use MemoryRouter to control the "URL" in our test environment
  render(
    <MemoryRouter initialEntries={['/login']}>
      <App />
    </MemoryRouter>
  );

  // Look for a key element we expect to be on the login page
  const emailInput = screen.getByLabelText(/email address/i);
  expect(emailInput).toBeInTheDocument();
});