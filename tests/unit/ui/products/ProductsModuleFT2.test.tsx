// tests/unit/ui/products/ProductsModuleFT2.test.tsx

import { render, screen } from '@testing-library/react';
import { ProductsModuleFT2 } from '@lasyncro/products';
import type { ProductsModuleFT2Props } from '@lasyncro/products';

describe('ProductsModuleFT2', () => {
  it('renders observability data deterministically', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        productsObserved: 10,
      },
      productSummary: {
        totalRevenue: 1000,
        totalCost: 700,
        netValue: 300,
        currency: 'USD',
      },
      productBreakdown: [
        {
          sku: 'SKU-1',
          revenue: 600,
          cost: 400,
          marginReportedPct: 33,
        },
      ],
      trendSignal: {
        trend: 'stable',
      },
    };

    render(<ProductsModuleFT2 {...props} />);

    const root = screen.getByTestId('products-ft2-root');

    expect(root).toHaveTextContent('Products observed');
    expect(root).toHaveTextContent('10');

    expect(root).toHaveTextContent('Total revenue');
    expect(root).toHaveTextContent('1000');

    expect(root).toHaveTextContent('Net value');
    expect(root).toHaveTextContent('300');

    expect(root).toHaveTextContent('SKU-1');
    expect(root).toHaveTextContent('stable');
  });

  it('renders nulls as em dashes', () => {
    const props: ProductsModuleFT2Props = {
      context: {
        period: { from: '', to: '' },
        productsObserved: null,
      },
      productSummary: {
        totalRevenue: null,
        totalCost: null,
        netValue: null,
        currency: null,
      },
      productBreakdown: null,
      trendSignal: null,
    };

    render(<ProductsModuleFT2 {...props} />);

    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});