// packages/ui/src/pages/ProductsPage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductsPage } from './ProductsPage';

describe('ProductsPage', () => {
  it('renders the main heading and search components', () => {
    render(
      <MemoryRouter>
        <ProductsPage />
      </MemoryRouter>
    );

    // Check for the main heading
    expect(screen.getByRole('heading', { name: /products/i })).toBeInTheDocument();

    // Check that the search input and button are rendered
    expect(screen.getByLabelText(/search by sku/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });
});