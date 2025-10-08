// packages/ui/src/pages/ProductIntelligencePage.test.tsx
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProductIntelligencePage } from './ProductIntelligencePage';

test('renders the Product Intelligence page with a search bar and button', () => {
  render(
    <MemoryRouter>
      <ProductIntelligencePage />
    </MemoryRouter>
  );

  // Look for the search input field by its placeholder text
  expect(screen.getByPlaceholderText(/search by sku/i)).toBeInTheDocument();

  // Look for the search button
  expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
});