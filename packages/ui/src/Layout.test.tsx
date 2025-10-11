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
  expect(screen.getByRole('heading', { name: /FinOps Command Center/i })).toBeInTheDocument();

  // Look for a navigation link in the sidebar
  const productLink = screen.getByRole('link', { name: /products/i });
  expect(productLink).toHaveAttribute('href', '/products');
  expect(screen.getByRole('link', { name: /product intelligence/i })).toHaveAttribute('href', '/product-intelligence');
});