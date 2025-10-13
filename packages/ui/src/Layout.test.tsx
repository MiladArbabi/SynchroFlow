// packages/ui/src/Layout.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Layout } from './Layout';
import { UserProvider } from './contexts/UserContext';

test('renders the main layout with a sidebar and header on the root route', () => {
  render(
    <MemoryRouter initialEntries={['/']}>
      <UserProvider>
        <Layout />
      </UserProvider>
    </MemoryRouter>
  );

  // Look for a navigation link in the sidebar
  const productLink = screen.getByRole('link', { name: /products/i });
  expect(productLink).toHaveAttribute('href', '/products');
  expect(screen.getByRole('link', { name: /product intelligence/i })).toHaveAttribute('href', '/product-intelligence');
});