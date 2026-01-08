import { render, screen } from '@testing-library/react';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

describe('ProductsModuleFT2', () => {
  it('renders FT2 observability deterministically', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsObserved: 10,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };

    render(<ProductsModuleFT2 {...props} />);

    const root = screen.getByTestId('products-ft2-root');

    expect(root).toHaveTextContent('Products observed');
    expect(root).toHaveTextContent('10');
    expect(root).toHaveTextContent('positive');
    expect(root).toHaveTextContent('unknown');
  });

  it('renders nulls as em dashes', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '', to: '' },
        productsObserved: null,
      },
      outcome: null,
      trend: null,
    };

    render(<ProductsModuleFT2 {...props} />);

    expect(
      screen.getByTestId('products-ft2-root').textContent
    ).toContain('—');
  });
});