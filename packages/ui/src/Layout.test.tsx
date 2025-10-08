// packages/ui/src/Layout.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders the main layout with a sidebar and header on the root route', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>
  );

  // Look for the main dashboard heading
  expect(screen.getByRole('heading', { name: /Welcome to the FinOps Command Center/i })).toBeInTheDocument();

  // Look for a navigation link in the sidebar
  expect(screen.getByRole('link', { name: /inventory/i })).toBeInTheDocument();
});